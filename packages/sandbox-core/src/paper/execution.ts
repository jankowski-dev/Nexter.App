import Decimal from 'decimal.js';
import { DecimalInputError, minDecimal, toDecimal } from '../decision/decimal';
import { Reason } from '../decision/reason-codes';
import type { OrderIntent } from '../decision/types';
import type { Candle } from '../types';
import type { BuyFillPlan, PaperRunSettings, SellFillPlan } from './types';

/**
 * Pure next-bar-open paper fill model.
 *
 * A decision at bar close `T` produces an intent; this module prices that intent
 * against the **next** bar's `open`, never the decision close, so the paper run
 * cannot look ahead. It computes fees, slippage, the bar liquidity cap and the
 * cash-buffer floor, then returns a plan.
 *
 * This module books nothing: no ledger entry, no event, no portfolio mutation.
 * Money stays in `Decimal` until formatting (USD 2 decimals, prices and token
 * amounts 8 decimals). Fill-domain problems (missing data, insufficient cash,
 * an existing/no position, zero liquidity) return a `rejected` plan; thrown
 * errors are reserved for programmer misuse such as a mismatched intent side.
 */

export class PaperExecutionInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PaperExecutionInputError';
  }
}

export interface BuyFillInput {
  readonly intent: OrderIntent;
  readonly candle: Candle;
  readonly cashUsd: string;
  readonly equityUsd: string;
  readonly cashBufferPct: number;
  readonly settings: PaperRunSettings;
  readonly hasPosition: boolean;
}

export interface SellFillInput {
  readonly intent: OrderIntent;
  readonly candle: Candle;
  readonly positionAmount: string;
  readonly settings: PaperRunSettings;
}

const BPS = new Decimal(10000);
const HUNDRED = new Decimal(100);
const ONE = new Decimal(1);
const ZERO = new Decimal(0);
const ZERO_USD = '0.00';
const ZERO_UNITS = '0.00000000';

function usd(value: Decimal): string {
  return value.toFixed(2);
}

function units(value: Decimal): string {
  return value.toFixed(8);
}

/** Parses a decimal string, returning `null` for a fill-domain data problem. */
function tryDecimal(value: string, label: string): Decimal | null {
  try {
    return toDecimal(value, label);
  } catch (error) {
    if (error instanceof DecimalInputError) return null;
    throw error;
  }
}

function assertFinite(value: number, label: string): void {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new PaperExecutionInputError(`${label} must be a finite number`);
  }
}

function assertBps(value: number, label: string): void {
  assertFinite(value, label);
  if (value < 0 || value >= 10_000) {
    throw new PaperExecutionInputError(`${label} must be in [0, 10000)`);
  }
}

function assertSettings(settings: PaperRunSettings): void {
  assertBps(settings.feeBps, 'settings.feeBps');
  assertBps(settings.slippageBps, 'settings.slippageBps');
  assertFinite(settings.liquidityCapPct, 'settings.liquidityCapPct');
  if (settings.liquidityCapPct <= 0 || settings.liquidityCapPct > 100) {
    throw new PaperExecutionInputError('settings.liquidityCapPct must be in (0, 100]');
  }
}

function assertCashBufferPct(value: number): void {
  assertFinite(value, 'cashBufferPct');
  if (value < 0 || value > 100) {
    throw new PaperExecutionInputError('cashBufferPct must be in [0, 100]');
  }
}

function assertIntentSide(intent: OrderIntent, candle: Candle, expected: 'buy' | 'sell'): void {
  if (intent.side !== expected) {
    throw new PaperExecutionInputError(
      `plan${expected === 'buy' ? 'Buy' : 'Sell'}Fill received a ${intent.side} intent (${intent.intentId})`,
    );
  }
  if (candle.tokenId !== intent.tokenId) {
    throw new PaperExecutionInputError(
      `Candle token ${candle.tokenId} does not match intent token ${intent.tokenId}`,
    );
  }
}

/** Next-open price and liquidity cap, or `null` when the bar is not tradable. */
interface BarPricing {
  readonly fillPrice: Decimal;
  readonly exactPrice: string;
  readonly liquidityCapUsd: Decimal;
}

function priceBar(
  candle: Candle,
  slippageBps: number,
  liquidityCapPct: number,
  side: 'buy' | 'sell',
): BarPricing | null {
  const open = tryDecimal(candle.open, 'candle.open');
  const volume = tryDecimal(candle.volumeUsd, 'candle.volumeUsd');
  if (open === null || open.lessThanOrEqualTo(0)) return null;
  if (volume === null || volume.lessThanOrEqualTo(0)) return null;

  const slippage = new Decimal(slippageBps).div(BPS);
  const multiplier = side === 'buy' ? ONE.plus(slippage) : ONE.minus(slippage);
  const fillPrice = open.times(multiplier);
  if (fillPrice.lessThanOrEqualTo(0)) return null;
  return {
    fillPrice,
    exactPrice: units(fillPrice),
    liquidityCapUsd: volume.times(liquidityCapPct).div(HUNDRED),
  };
}

function rejectBuy(
  input: BuyFillInput,
  requested: Decimal | null,
  pricing: BarPricing | null,
  reasonCode: BuyFillPlan['reasonCode'],
  reasonText: string,
): BuyFillPlan {
  const requestedUsd = requested === null ? ZERO_USD : usd(requested);
  return {
    status: 'rejected',
    tokenId: input.intent.tokenId,
    intentId: input.intent.intentId,
    requestedUsd,
    filledUsd: ZERO_USD,
    unfilledUsd: requestedUsd,
    amount: ZERO_UNITS,
    priceUsd: pricing === null ? ZERO_UNITS : pricing.exactPrice,
    feeUsd: ZERO_USD,
    reasonCode,
    reasonText,
  };
}

function rejectSell(
  input: SellFillInput,
  requested: Decimal | null,
  pricing: BarPricing | null,
  reasonCode: SellFillPlan['reasonCode'],
  reasonText: string,
): SellFillPlan {
  const requestedAmount = requested === null ? ZERO_UNITS : units(requested);
  return {
    status: 'rejected',
    tokenId: input.intent.tokenId,
    intentId: input.intent.intentId,
    requestedAmount,
    filledAmount: ZERO_UNITS,
    unfilledAmount: requestedAmount,
    priceUsd: pricing === null ? ZERO_UNITS : pricing.exactPrice,
    notionalUsd: ZERO_USD,
    feeUsd: ZERO_USD,
    proceedsUsd: ZERO_USD,
    reasonCode,
    reasonText,
  };
}

/**
 * Plans a buy at the next bar open.
 *
 * The fill is `min(intent.sizeUsd, liquidityCapUsd)`, the fee is charged on the
 * filled notional, and the whole fill is rejected if its cost would take cash
 * below `equity * cashBufferPct / 100`. The unfilled remainder is not retried.
 */
export function planBuyFill(input: BuyFillInput): BuyFillPlan {
  assertIntentSide(input.intent, input.candle, 'buy');
  assertSettings(input.settings);
  assertCashBufferPct(input.cashBufferPct);

  const requested = tryDecimal(input.intent.sizeUsd, 'intent.sizeUsd');
  const positiveRequested = requested !== null && requested.greaterThan(0) ? requested : null;
  const pricing = priceBar(
    input.candle,
    input.settings.slippageBps,
    input.settings.liquidityCapPct,
    'buy',
  );

  if (input.hasPosition) {
    return rejectBuy(
      input,
      positiveRequested,
      pricing,
      Reason.FILL_POSITION_EXISTS,
      `Buy rejected: ${input.intent.tokenId} already has an open position and adds are not allowed`,
    );
  }

  if (positiveRequested === null) {
    return rejectBuy(
      input,
      null,
      pricing,
      Reason.FILL_NO_DATA,
      'Buy rejected: the intent size is not a positive decimal string',
    );
  }

  if (pricing === null) {
    return rejectBuy(
      input,
      positiveRequested,
      null,
      Reason.FILL_NO_DATA,
      'Buy rejected: the fill bar has no positive open or volume',
    );
  }

  const cash = tryDecimal(input.cashUsd, 'cashUsd');
  const equity = tryDecimal(input.equityUsd, 'equityUsd');
  if (cash === null || equity === null) {
    return rejectBuy(
      input,
      positiveRequested,
      pricing,
      Reason.FILL_NO_DATA,
      'Buy rejected: cash and equity must be non-negative decimal strings',
    );
  }

  const fillUsd = minDecimal(positiveRequested, pricing.liquidityCapUsd);
  const fee = fillUsd.times(input.settings.feeBps).div(BPS);
  const cashFloor = equity.times(input.cashBufferPct).div(HUNDRED);
  const available = cash.minus(cashFloor);
  if (fillUsd.plus(fee).greaterThan(available)) {
    return rejectBuy(
      input,
      positiveRequested,
      pricing,
      Reason.FILL_INSUFFICIENT_CASH,
      `Buy rejected: ${usd(fillUsd)} USD plus ${usd(fee)} USD fee exceeds ${usd(available)} USD available above the cash floor`,
    );
  }

  const filledAmount = units(fillUsd.div(pricing.fillPrice));
  if (filledAmount === ZERO_UNITS) {
    return rejectBuy(
      input,
      positiveRequested,
      pricing,
      Reason.FILL_LIQUIDITY,
      `Buy rejected: the liquidity-capped fill for ${input.intent.tokenId} rounds to zero`,
    );
  }

  const partial = fillUsd.lessThan(positiveRequested);
  return {
    status: partial ? 'partial' : 'filled',
    tokenId: input.intent.tokenId,
    intentId: input.intent.intentId,
    requestedUsd: usd(positiveRequested),
    filledUsd: usd(fillUsd),
    unfilledUsd: usd(positiveRequested.minus(fillUsd)),
    amount: filledAmount,
    priceUsd: pricing.exactPrice,
    feeUsd: usd(fee),
    reasonCode: partial ? Reason.FILL_PARTIAL : Reason.FILL_FILLED,
    reasonText: partial
      ? `Partially bought ${usd(fillUsd)} of ${usd(positiveRequested)} USD of ${input.intent.tokenId} at ${pricing.exactPrice} USD on the next bar open; the remainder is not retried`
      : `Bought ${usd(fillUsd)} USD of ${input.intent.tokenId} at ${pricing.exactPrice} USD on the next bar open`,
  };
}

/**
 * Plans a sell at the next bar open.
 *
 * The fill is `min(intent.amount, positionAmount, liquidityCapUsd / fillPrice)`.
 * A zero fill is rejected as `FILL_LIQUIDITY`; a smaller-than-requested fill is
 * an IOC partial and the position keeps the remainder.
 */
export function planSellFill(input: SellFillInput): SellFillPlan {
  assertIntentSide(input.intent, input.candle, 'sell');
  assertSettings(input.settings);

  const requested =
    input.intent.amount === null ? null : tryDecimal(input.intent.amount, 'intent.amount');
  const positiveRequested = requested !== null && requested.greaterThan(0) ? requested : null;
  const position = tryDecimal(input.positionAmount, 'positionAmount');
  const pricing = priceBar(
    input.candle,
    input.settings.slippageBps,
    input.settings.liquidityCapPct,
    'sell',
  );

  if (positiveRequested === null) {
    return rejectSell(
      input,
      null,
      pricing,
      Reason.FILL_NO_DATA,
      'Sell rejected: the intent amount is not a positive decimal string',
    );
  }

  if (position === null) {
    return rejectSell(
      input,
      positiveRequested,
      pricing,
      Reason.FILL_NO_DATA,
      'Sell rejected: the position amount is not a non-negative decimal string',
    );
  }

  if (position.lessThanOrEqualTo(0)) {
    return rejectSell(
      input,
      positiveRequested,
      pricing,
      Reason.FILL_NO_POSITION,
      `Sell rejected: ${input.intent.tokenId} has no open position`,
    );
  }

  if (pricing === null) {
    return rejectSell(
      input,
      positiveRequested,
      null,
      Reason.FILL_NO_DATA,
      'Sell rejected: the fill bar has no positive open or volume',
    );
  }

  const liquidityAmount = pricing.liquidityCapUsd.div(pricing.fillPrice);
  const fillAmount = minDecimal(positiveRequested, position, liquidityAmount);
  const filledAmount = units(fillAmount);
  if (fillAmount.lessThanOrEqualTo(0) || filledAmount === ZERO_UNITS) {
    return rejectSell(
      input,
      positiveRequested,
      pricing,
      Reason.FILL_LIQUIDITY,
      `Sell rejected: liquidity lets ${input.intent.tokenId} fill zero on this bar`,
    );
  }

  const notional = fillAmount.times(pricing.fillPrice);
  const fee = notional.times(input.settings.feeBps).div(BPS);
  const proceeds = notional.minus(fee);
  if (proceeds.lessThan(ZERO)) {
    return rejectSell(
      input,
      positiveRequested,
      pricing,
      Reason.FILL_LIQUIDITY,
      'Sell rejected: the fee exceeds the fill notional',
    );
  }

  const partial = fillAmount.lessThan(positiveRequested);
  return {
    status: partial ? 'partial' : 'filled',
    tokenId: input.intent.tokenId,
    intentId: input.intent.intentId,
    requestedAmount: units(positiveRequested),
    filledAmount,
    unfilledAmount: units(positiveRequested.minus(fillAmount)),
    priceUsd: pricing.exactPrice,
    notionalUsd: usd(notional),
    feeUsd: usd(fee),
    proceedsUsd: usd(proceeds),
    reasonCode: partial ? Reason.FILL_PARTIAL : Reason.FILL_FILLED,
    reasonText: partial
      ? `Partially sold ${filledAmount} of ${units(positiveRequested)} ${input.intent.tokenId} at ${pricing.exactPrice} USD on the next bar open; the remainder is not retried`
      : `Sold ${filledAmount} ${input.intent.tokenId} at ${pricing.exactPrice} USD on the next bar open`,
  };
}

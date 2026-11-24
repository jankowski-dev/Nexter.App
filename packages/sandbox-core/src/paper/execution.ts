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
    liquidityCapUsd: pricing === null ? ZERO_USD : usd(pricing.liquidityCapUsd),
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
    liquidityCapUsd: pricing === null ? ZERO_USD : usd(pricing.liquidityCapUsd),
    reasonCode,
    reasonText,
  };
}

/**
 * Plans a buy at the next bar open.
 *
 * The fill is `min(intent.sizeUsd, liquidityCapUsd)`, floored to cents so the
 * emitted `filledUsd` never exceeds the exact cap. The fee is charged on that
 * booked fill and rounded to cents; the cash-floor veto compares the booked
 * values (`filledUsd + feeUsd`) against `cash - equity * cashBufferPct / 100`,
 * because those strings are what the ledger will actually book. The unfilled
 * remainder is not retried.
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

  // The ledger books the emitted 2-decimal strings, not the exact Decimal. Floor
  // the fill to cents so the booked cost can never exceed the exact liquidity
  // cap, then charge the fee on the booked fill and round that fee to cents. The
  // cash-floor check below uses exactly these booked values; checking the exact
  // values would let rounding push the booked cost (or cash itself) negative.
  const fillUsd = minDecimal(positiveRequested, pricing.liquidityCapUsd);
  const bookedFillStr = fillUsd.toFixed(2, Decimal.ROUND_DOWN);
  const bookedFill = new Decimal(bookedFillStr);
  if (bookedFillStr === ZERO_USD) {
    return rejectBuy(
      input,
      positiveRequested,
      pricing,
      Reason.FILL_LIQUIDITY,
      `Buy rejected: the liquidity-capped fill for ${input.intent.tokenId} rounds to zero`,
    );
  }

  const bookedFeeStr = usd(bookedFill.times(input.settings.feeBps).div(BPS));
  const bookedFee = new Decimal(bookedFeeStr);
  const cashFloor = equity.times(input.cashBufferPct).div(HUNDRED);
  const available = cash.minus(cashFloor);
  if (bookedFill.plus(bookedFee).greaterThan(available)) {
    return rejectBuy(
      input,
      positiveRequested,
      pricing,
      Reason.FILL_INSUFFICIENT_CASH,
      `Buy rejected: ${bookedFillStr} USD plus ${bookedFeeStr} USD fee exceeds ${available.toFixed(2, Decimal.ROUND_DOWN)} USD available above the cash floor`,
    );
  }

  const filledAmount = units(bookedFill.div(pricing.fillPrice));
  if (filledAmount === ZERO_UNITS) {
    return rejectBuy(
      input,
      positiveRequested,
      pricing,
      Reason.FILL_LIQUIDITY,
      `Buy rejected: the liquidity-capped fill for ${input.intent.tokenId} rounds to zero units`,
    );
  }

  const requestedUsd = usd(positiveRequested);
  const partial = bookedFill.lessThan(requestedUsd);
  return {
    status: partial ? 'partial' : 'filled',
    tokenId: input.intent.tokenId,
    intentId: input.intent.intentId,
    requestedUsd,
    filledUsd: bookedFillStr,
    unfilledUsd: usd(positiveRequested.minus(bookedFill)),
    amount: filledAmount,
    priceUsd: pricing.exactPrice,
    feeUsd: bookedFeeStr,
    liquidityCapUsd: usd(pricing.liquidityCapUsd),
    reasonCode: partial ? Reason.FILL_PARTIAL : Reason.FILL_FILLED,
    reasonText: partial
      ? `Partially bought ${bookedFillStr} of ${requestedUsd} USD of ${input.intent.tokenId} at ${pricing.exactPrice} USD on the next bar open; the remainder is not retried`
      : `Bought ${bookedFillStr} USD of ${input.intent.tokenId} at ${pricing.exactPrice} USD on the next bar open`,
  };
}

/**
 * Plans a sell at the next bar open.
 *
 * The fill is `min(intent.amount, positionAmount, liquidityCapUsd / fillPrice)`.
 * The booked notional is rounded once (half-up); the fee is derived from the
 * booked notional and proceeds are `bookedNotional - bookedFee`, so the emitted
 * cents satisfy `notionalUsd - feeUsd = proceedsUsd` by construction. A zero
 * fill is rejected as `FILL_LIQUIDITY`; a smaller-than-requested fill is an IOC
 * partial and the position keeps the remainder.
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

  // Round the notional once, then derive the fee from the booked notional and
  // proceeds as `bookedNotional - bookedFee`. Rounding all three independently
  // would break `notional - fee = proceeds` by a cent in the report/ledger.
  const bookedNotionalStr = usd(fillAmount.times(pricing.fillPrice));
  const bookedNotional = new Decimal(bookedNotionalStr);
  // Mirror the buy-side zero guard: a sub-cent position can have a positive
  // 8-decimal amount whose booked notional rounds to zero. Booking that would
  // hand the ledger a `filled` plan with zero cents, so reject it as dust.
  if (bookedNotional.lessThanOrEqualTo(ZERO)) {
    return rejectSell(
      input,
      positiveRequested,
      pricing,
      Reason.FILL_LIQUIDITY,
      `Sell rejected: the booked notional for ${input.intent.tokenId} rounds to zero; the position is dust`,
    );
  }
  const bookedFeeStr = usd(bookedNotional.times(input.settings.feeBps).div(BPS));
  const bookedFee = new Decimal(bookedFeeStr);
  const bookedProceeds = bookedNotional.minus(bookedFee);
  // Defensive: with a fee below 100% this cannot go negative, but the guard keeps
  // a pathological configuration from booking a negative payout.
  if (bookedProceeds.lessThan(ZERO)) {
    return rejectSell(
      input,
      positiveRequested,
      pricing,
      Reason.FILL_LIQUIDITY,
      'Sell rejected: the booked fee exceeds the booked notional',
    );
  }

  const requestedAmount = units(positiveRequested);
  // Compare the displayed 8-decimal amounts so a sub-8-decimal remainder cannot
  // produce `partial` with an all-zero `unfilledAmount`.
  const partial = new Decimal(filledAmount).lessThan(requestedAmount);
  return {
    status: partial ? 'partial' : 'filled',
    tokenId: input.intent.tokenId,
    intentId: input.intent.intentId,
    requestedAmount,
    filledAmount,
    unfilledAmount: units(new Decimal(requestedAmount).minus(filledAmount)),
    priceUsd: pricing.exactPrice,
    notionalUsd: bookedNotionalStr,
    feeUsd: bookedFeeStr,
    proceedsUsd: bookedProceeds.toFixed(2),
    liquidityCapUsd: usd(pricing.liquidityCapUsd),
    reasonCode: partial ? Reason.FILL_PARTIAL : Reason.FILL_FILLED,
    reasonText: partial
      ? `Partially sold ${filledAmount} of ${requestedAmount} ${input.intent.tokenId} at ${pricing.exactPrice} USD on the next bar open; the remainder is not retried`
      : `Sold ${filledAmount} ${input.intent.tokenId} at ${pricing.exactPrice} USD on the next bar open`,
  };
}

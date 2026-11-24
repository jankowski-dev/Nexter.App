import Decimal from 'decimal.js';
import {
  applyBuyFill,
  applySellFill,
  planBuyFill,
  planSellFill,
  Reason,
  type BuyFillPlan,
  type Candle,
  type IntentRecord,
  type LedgerEntry,
  type OrderIntent,
  type PaperLedgerState,
  type PaperRunSettings,
  type ReasonCode,
  type SellFillPlan,
  type Timestamp,
} from '@nexter/sandbox-core';
import type { SandboxPendingIntent } from './sandbox.repository';

/**
 * Live paper execution for Stage 2.
 *
 * A decision is made on closed 1h candles; the intent is queued and filled on
 * the next tick at the current live quote, never at the historical decision
 * close. The fill model itself is the signed Stage 1C `planBuyFill`/
 * `planSellFill`, fed a synthetic fill candle whose open is the live quote and
 * whose volume is the last closed bar volume. The execution mode is labelled
 * `live-paper`: no wallet, key, signing or real order is ever involved.
 */

export const SANDBOX_LIVE_EXECUTION_MODE = 'live-paper';

export interface SandboxLiveQuote {
  readonly tokenId: string;
  /** Newest provider 1h candle close (the in-progress bar while it is open). */
  readonly priceUsd: string;
  /** USD volume of the last closed 1h bar (fill liquidity cap base). */
  readonly volumeUsd: string;
  readonly asOf: Date;
}

export class SandboxLiveBrokerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SandboxLiveBrokerError';
  }
}

export interface LiveFillOutcome {
  readonly record: IntentRecord;
  readonly ledger: PaperLedgerState;
  readonly plan: BuyFillPlan | SellFillPlan;
  readonly entry: LedgerEntry | null;
  readonly filled: boolean;
}

export interface BuyFillRequest {
  readonly intent: OrderIntent;
  readonly quote: SandboxLiveQuote;
  readonly ledger: PaperLedgerState;
  /** Marked equity immediately before the fill attempt. */
  readonly equityUsd: string;
  readonly cashBufferPct: number;
  readonly settings: PaperRunSettings;
  readonly fillTime: Timestamp;
}

export interface SellFillRequest {
  readonly intent: OrderIntent;
  readonly quote: SandboxLiveQuote;
  readonly ledger: PaperLedgerState;
  readonly settings: PaperRunSettings;
  readonly fillTime: Timestamp;
}

const ZERO_USD = '0.00';
const ZERO_UNITS = '0.00000000';
const ZERO_PRICE = '0.00000000';

const STOP_SELL_REASONS: ReadonlySet<ReasonCode> = new Set<ReasonCode>([
  Reason.TREND_PULLBACK_STOP,
  Reason.RANGE_REVERSION_STOP,
  Reason.RECOVERY_STOP,
]);

export function isStopSellReason(reasonCode: ReasonCode): boolean {
  return STOP_SELL_REASONS.has(reasonCode);
}

/**
 * Synthetic fill candle. Only `open` (the live quote) and `volumeUsd` (the last
 * closed bar) are meaningful to Stage 1C; the OHLC fields are set to the quote
 * so the bar cannot imply an intrabar path that the quote does not support.
 */
export function buildLiveFillCandle(intent: OrderIntent, quote: SandboxLiveQuote): Candle {
  if (quote.tokenId !== intent.tokenId) {
    throw new SandboxLiveBrokerError(
      `Quote token ${quote.tokenId} does not match intent token ${intent.tokenId}`,
    );
  }
  if (!isPositiveDecimal(quote.priceUsd)) {
    throw new SandboxLiveBrokerError(
      `Live quote for ${quote.tokenId} must be a positive decimal string`,
    );
  }
  if (!isPositiveDecimal(quote.volumeUsd)) {
    throw new SandboxLiveBrokerError(
      `Last closed bar volume for ${quote.tokenId} must be a positive decimal string`,
    );
  }

  return {
    tokenId: intent.tokenId,
    timeframe: '1h',
    openTime: intent.clockTime,
    open: quote.priceUsd,
    high: quote.priceUsd,
    low: quote.priceUsd,
    close: quote.priceUsd,
    volumeUsd: quote.volumeUsd,
  };
}

/** Plans and books a live buy at the quote. Rejections never touch the ledger. */
export function fillLiveBuy(request: BuyFillRequest): LiveFillOutcome {
  if (request.intent.side !== 'buy') {
    throw new SandboxLiveBrokerError(
      `fillLiveBuy received a ${request.intent.side} intent (${request.intent.intentId})`,
    );
  }

  const candle = buildLiveFillCandle(request.intent, request.quote);
  const plan = planBuyFill({
    intent: request.intent,
    candle,
    cashUsd: request.ledger.cashUsd,
    equityUsd: request.equityUsd,
    cashBufferPct: request.cashBufferPct,
    settings: request.settings,
    hasPosition: Object.hasOwn(request.ledger.positions, request.intent.tokenId),
  });
  const record = buyRecord(request.intent, plan, request.fillTime);
  if (plan.status === 'rejected') {
    return { record, ledger: request.ledger, plan, entry: null, filled: false };
  }

  const applied = applyBuyFill(request.ledger, plan, request.intent, request.fillTime);
  return {
    record,
    ledger: applied.state,
    plan,
    entry: applied.entry,
    filled: true,
  };
}

/** Plans and books a live sell at the quote. Rejections never touch the ledger. */
export function fillLiveSell(request: SellFillRequest): LiveFillOutcome {
  if (request.intent.side !== 'sell') {
    throw new SandboxLiveBrokerError(
      `fillLiveSell received a ${request.intent.side} intent (${request.intent.intentId})`,
    );
  }

  const position = request.ledger.positions[request.intent.tokenId];
  const candle = buildLiveFillCandle(request.intent, request.quote);
  const plan = planSellFill({
    intent: request.intent,
    candle,
    positionAmount: position?.amount ?? ZERO_UNITS,
    settings: request.settings,
  });
  const record = sellRecord(request.intent, plan, request.fillTime);
  if (plan.status === 'rejected') {
    return { record, ledger: request.ledger, plan, entry: null, filled: false };
  }

  const applied = applySellFill(request.ledger, plan, request.intent, request.fillTime);
  return {
    record,
    ledger: applied.state,
    plan,
    entry: applied.entry,
    filled: true,
  };
}

/** Reconstructs the Stage 1B intent from its persisted pending row. */
export function pendingIntentToOrderIntent(pending: SandboxPendingIntent): OrderIntent {
  return {
    intentId: pending.intentId,
    tokenId: pending.tokenId,
    side: pending.side,
    strategyKey: pending.strategyKey,
    strategyVersion: pending.strategyVersion,
    reasonCode: asReasonCode(pending.strategyReasonCode),
    sizeUsd: pending.requestedUsd ?? ZERO_USD,
    amount: pending.requestedAmount,
    // Pending rows intentionally store the decision payload in the journal, not
    // the full position-protection object; live fills reconstruct no stop/take
    // here and the strategy keeps managing the position on subsequent bars.
    stopLossPct: null,
    takeProfitPct: null,
    decisionPriceUsd: pending.priceUsd ?? ZERO_PRICE,
    clockTime: pending.decisionTime.getTime(),
  };
}

/** Bars an intent has been queued, measured in 1h bars. */
export function pendingBars(decisionTime: Timestamp, now: Timestamp): number {
  return Math.floor(Math.max(0, now - decisionTime) / 3_600_000);
}

/** Terminal record for an intent that waited beyond `maxPendingBars`. */
export function expiredIntentRecord(
  intent: OrderIntent,
  fillTime: Timestamp,
  barsPending: number,
): IntentRecord {
  return unresolvedRecord(
    intent,
    'expired',
    Reason.FILL_EXPIRED,
    `Intent ${intent.intentId} expired after ${barsPending} bar(s) without a live quote`,
    fillTime,
  );
}

/**
 * Terminal record for a new intent that duplicates an already pending one.
 * Like the Stage 1C queue-time duplicate, it never reached a bar, so `fillTime`
 * is `null` and the decision bar is carried by `decisionTime`.
 */
export function duplicateIntentRecord(intent: OrderIntent): IntentRecord {
  return unresolvedRecord(
    intent,
    'rejected',
    Reason.FILL_DUPLICATE,
    `Intent ${intent.intentId} duplicates a pending ${intent.side} for ${intent.tokenId}`,
    null,
  );
}

function buyRecord(intent: OrderIntent, plan: BuyFillPlan, fillTime: Timestamp): IntentRecord {
  return {
    intentId: intent.intentId,
    tokenId: intent.tokenId,
    side: 'buy',
    strategyKey: intent.strategyKey,
    strategyVersion: intent.strategyVersion,
    status: plan.status,
    requestedUsd: plan.requestedUsd,
    requestedAmount: null,
    filledUsd: plan.filledUsd,
    filledAmount: plan.amount,
    priceUsd: priceOrNull(plan.priceUsd),
    feeUsd: plan.feeUsd,
    reasonCode: plan.reasonCode,
    strategyReasonCode: intent.reasonCode,
    reasonText: plan.reasonText,
    decisionTime: intent.clockTime,
    fillTime,
  };
}

function sellRecord(intent: OrderIntent, plan: SellFillPlan, fillTime: Timestamp): IntentRecord {
  return {
    intentId: intent.intentId,
    tokenId: intent.tokenId,
    side: 'sell',
    strategyKey: intent.strategyKey,
    strategyVersion: intent.strategyVersion,
    status: plan.status,
    requestedUsd: null,
    requestedAmount: plan.requestedAmount,
    filledUsd: plan.notionalUsd,
    filledAmount: plan.filledAmount,
    priceUsd: priceOrNull(plan.priceUsd),
    feeUsd: plan.feeUsd,
    reasonCode: plan.reasonCode,
    strategyReasonCode: intent.reasonCode,
    reasonText: plan.reasonText,
    decisionTime: intent.clockTime,
    fillTime,
  };
}

function unresolvedRecord(
  intent: OrderIntent,
  status: IntentRecord['status'],
  reasonCode: ReasonCode,
  reasonText: string,
  fillTime: Timestamp | null,
): IntentRecord {
  return {
    intentId: intent.intentId,
    tokenId: intent.tokenId,
    side: intent.side,
    strategyKey: intent.strategyKey,
    strategyVersion: intent.strategyVersion,
    status,
    requestedUsd: intent.side === 'buy' ? intent.sizeUsd : null,
    requestedAmount: intent.side === 'sell' ? intent.amount : null,
    filledUsd: ZERO_USD,
    filledAmount: ZERO_UNITS,
    priceUsd: null,
    feeUsd: ZERO_USD,
    reasonCode,
    strategyReasonCode: intent.reasonCode,
    reasonText,
    decisionTime: intent.clockTime,
    fillTime,
  };
}

function priceOrNull(value: string): string | null {
  return value === ZERO_PRICE ? null : value;
}

function asReasonCode(value: string): ReasonCode {
  const known = Object.values(Reason) as string[];
  return (known.includes(value) ? value : Reason.INTENT_PENDING) as ReasonCode;
}

function isPositiveDecimal(value: string): boolean {
  if (typeof value !== 'string' || !/^\d+(\.\d+)?$/.test(value)) return false;
  return new Decimal(value).greaterThan(0);
}

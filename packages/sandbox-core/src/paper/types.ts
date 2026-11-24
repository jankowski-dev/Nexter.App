import type { ReasonCode } from '../decision/reason-codes';
import type { StrategyKey } from '../decision/types';
import type { Timestamp } from '../types';

/**
 * Execution settings for one paper run.
 *
 * These are configuration, not hard-coded behavior: the host passes the same
 * object to the fill model on every bar. All values are JSON-safe primitives so
 * they can be hashed into `configVersion` and persisted in the report.
 */
export interface PaperRunSettings {
  /** Fee per side in basis points, applied to the fill notional. */
  readonly feeBps: number;
  /** Slippage per side in basis points, applied against the trader. */
  readonly slippageBps: number;
  /** Maximum share of the fill bar's `volumeUsd` that one fill may consume. */
  readonly liquidityCapPct: number;
  /** Bars an unfilled intent may stay pending before it expires (IOC = 1). */
  readonly maxPendingBars: number;
  /** Cooldown applied to a token after a stop-loss fill, in hours. */
  readonly cooldownHoursAfterStop: number;
  /** Hindsight counterfactual horizon in hours; never fed back to decisions. */
  readonly counterfactualHorizonHours: number;
}

/**
 * Full paper-run configuration: the Stage 1A `RunConfig` fields plus the
 * execution settings.
 *
 * `tokenIds` is readonly, so the host uses `paperConfigVersion` (which copies
 * the array into the mutable Stage 1A shape) instead of calling `configVersion`
 * directly.
 */
export interface PaperRunConfig {
  readonly runId: string;
  readonly seed: number;
  readonly timeframe: string;
  readonly tokenIds: readonly string[];
  readonly initialCapitalUsd: string;
  readonly feeBps: number;
  readonly slippageBps: number;
  readonly liquidityCapPct: number;
  readonly maxPendingBars: number;
  readonly cooldownHoursAfterStop: number;
  readonly counterfactualHorizonHours: number;
}

/** Terminal status of a paper intent; `expired` is owned by the host queue. */
export type FillStatus = 'filled' | 'partial' | 'rejected' | 'expired';

/**
 * Deterministic outcome of applying one buy intent to one bar.
 *
 * Pure data: the plan books nothing. The ledger consumes it in a later stage.
 * USD strings have two decimals, prices and token amounts eight.
 */
export interface BuyFillPlan {
  readonly status: 'filled' | 'partial' | 'rejected';
  readonly tokenId: string;
  readonly intentId: string;
  readonly requestedUsd: string;
  readonly filledUsd: string;
  readonly unfilledUsd: string;
  readonly amount: string;
  readonly priceUsd: string;
  readonly feeUsd: string;
  readonly reasonCode: ReasonCode;
  readonly reasonText: string;
}

/**
 * Deterministic outcome of applying one sell intent to one bar.
 *
 * The plan intentionally does not take the position average cost: realized P&L
 * belongs to the ledger, which reads the position state itself.
 */
export interface SellFillPlan {
  readonly status: 'filled' | 'partial' | 'rejected';
  readonly tokenId: string;
  readonly intentId: string;
  readonly requestedAmount: string;
  readonly filledAmount: string;
  readonly unfilledAmount: string;
  readonly priceUsd: string;
  readonly notionalUsd: string;
  readonly feeUsd: string;
  readonly proceedsUsd: string;
  readonly reasonCode: ReasonCode;
  readonly reasonText: string;
}

/**
 * One open paper position.
 *
 * The sandbox never adds to a position, so `avgCostUsd` is the entry cost per
 * token including the buy fee and is only rounded once at entry. `amount` is an
 * 8-decimal token amount; `feesPaidUsd` is the entry fee.
 */
export interface PaperPosition {
  readonly tokenId: string;
  readonly strategyKey: StrategyKey;
  readonly strategyVersion: number;
  readonly amount: string;
  /** Entry cost per token including buy fees, 8 decimals. */
  readonly avgCostUsd: string;
  readonly openedAt: Timestamp;
  readonly stopLossPct: string | null;
  readonly takeProfitPct: string | null;
  readonly entryIntentId: string;
  readonly feesPaidUsd: string;
}

/**
 * One round trip: opened by a buy fill and closed when the position reaches
 * zero. Partial sells aggregate into the open trade until then.
 *
 * Entry/exit amounts are 8-decimal token amounts; USD strings have two
 * decimals. `realizedPnlUsd` is the sum of the sell fills' realized P&L.
 */
export interface PaperTrade {
  readonly tradeId: string;
  readonly tokenId: string;
  readonly strategyKey: StrategyKey;
  readonly strategyVersion: number;
  readonly entryAt: Timestamp;
  readonly entryPriceUsd: string;
  readonly entryAmount: string;
  readonly entryNotionalUsd: string;
  readonly entryFeeUsd: string;
  readonly entryIntentId: string;
  readonly exitAt: Timestamp | null;
  readonly exitPriceUsd: string | null;
  readonly exitAmount: string;
  readonly exitNotionalUsd: string;
  readonly exitFeeUsd: string;
  readonly exitReasonCode: ReasonCode | null;
  readonly exitIntentId: string | null;
  readonly realizedPnlUsd: string;
  readonly status: 'open' | 'closed';
}

/**
 * One append-only ledger row per booked fill.
 *
 * `entryId` is derived from the intent (`<intentId>:ledger`), so it is unique
 * per intent and deterministic across runs. `sequence` starts at 1 and grows
 * by one. `realizedPnlUsd` is `null` for buys.
 */
export interface LedgerEntry {
  readonly entryId: string;
  readonly sequence: number;
  readonly clockTime: Timestamp;
  readonly tokenId: string;
  readonly side: 'buy' | 'sell';
  readonly intentId: string;
  readonly amount: string;
  readonly priceUsd: string;
  readonly notionalUsd: string;
  readonly feeUsd: string;
  readonly cashAfterUsd: string;
  readonly positionAmountAfter: string;
  readonly positionAvgCostAfter: string | null;
  readonly realizedPnlUsd: string | null;
  readonly reasonCode: ReasonCode;
}

/**
 * Immutable paper ledger snapshot.
 *
 * Buy fees are capitalised in `avgCostUsd`; sell fees reduce proceeds. The
 * ledger only records fills, never marks: mark-to-market lives in
 * `markPortfolio`.
 */
export interface PaperLedgerState {
  readonly cashUsd: string;
  readonly initialCapitalUsd: string;
  readonly positions: Readonly<Record<string, PaperPosition>>;
  readonly entries: readonly LedgerEntry[];
  readonly realizedPnlUsd: string;
  readonly feesPaidUsd: string;
  readonly closedTrades: readonly PaperTrade[];
  readonly openTrades: Readonly<Record<string, PaperTrade>>;
}

export interface LedgerApplyResult {
  readonly state: PaperLedgerState;
  readonly entry: LedgerEntry;
  readonly trade: PaperTrade | null;
}

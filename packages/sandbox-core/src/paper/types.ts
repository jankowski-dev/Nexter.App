import type { ReasonCode } from '../decision/reason-codes';

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

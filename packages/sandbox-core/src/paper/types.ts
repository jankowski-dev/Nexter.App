import type { ReasonCode } from '../decision/reason-codes';
import type {
  EngineState,
  PortfolioPosition,
  SandboxDecisionSettings,
  StrategyKey,
} from '../decision/types';
import type { SandboxEvent } from '../events/event-types';
import type { Candle, Timestamp } from '../types';

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
  /** Bar liquidity cap in USD (2 decimals); `0.00` when the bar was not tradable. */
  readonly liquidityCapUsd: string;
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
  /** Bar liquidity cap in USD (2 decimals); `0.00` when the bar was not tradable. */
  readonly liquidityCapUsd: string;
  readonly reasonCode: ReasonCode;
  readonly reasonText: string;
}

/**
 * One open paper position.
 *
 * The sandbox never adds to a position. `costBasisUsd` is the exact remaining
 * entry cost (filled USD plus the buy fee) in cents and is the only value
 * realized/unrealized P&L may use; `avgCostUsd` is an 8-decimal per-token
 * display/strategy value (it loses precision for low-priced tokens). `amount`
 * is an 8-decimal token amount; `feesPaidUsd` is the entry fee.
 */
export interface PaperPosition {
  readonly tokenId: string;
  readonly strategyKey: StrategyKey;
  readonly strategyVersion: number;
  readonly amount: string;
  /** Exact remaining entry cost including buy fees, 2 decimals. */
  readonly costBasisUsd: string;
  /** Entry cost per token including buy fees, 8 decimals (display only). */
  readonly avgCostUsd: string;
  readonly openedAt: Timestamp;
  readonly stopLossPct: string | null;
  readonly takeProfitPct: string | null;
  readonly entryIntentId: string;
  readonly feesPaidUsd: string;
}

/**
 * One round trip: opened by a buy fill and closed when the position reaches
 * zero. Partial sells aggregate into the open trade until then: amounts,
 * notional, fee and realised P&L sum; `exitAt`, `exitIntentId` and
 * `exitReasonCode` are last-writer-wins (the most recent sell); `exitPriceUsd`
 * is the amount-weighted average of the exits.
 *
 * Entry/exit amounts are 8-decimal token amounts; USD strings have two
 * decimals. `realizedPnlUsd` is the sum of the sell fills' realized P&L, and
 * `entryCostBasisUsd` is the exact entry cost (notional plus buy fee) in cents.
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
  /** Exact entry cost including the buy fee, 2 decimals. */
  readonly entryCostBasisUsd: string;
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
 * by one. `realizedPnlUsd` is `null` for buys. `costBasisReleasedUsd` records
 * the exact cents of entry cost a sell releases (`null` for buys), and
 * `positionCostBasisAfterUsd` is the remaining cost basis after the fill.
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
  /** Entry cost released by a sell, 2 decimals; `null` for a buy. */
  readonly costBasisReleasedUsd: string | null;
  /** Remaining entry cost after the fill, 2 decimals. */
  readonly positionCostBasisAfterUsd: string;
  readonly realizedPnlUsd: string | null;
  readonly reasonCode: ReasonCode;
}

/**
 * Immutable paper ledger snapshot.
 *
 * Buy fees are capitalised in the position `costBasisUsd` (with `avgCostUsd` as
 * an 8-decimal display value); sell fees reduce proceeds. The ledger only
 * records fills, never marks: mark-to-market lives in `markPortfolio`.
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

/**
 * Terminal journal row for exactly one emitted intent.
 *
 * Every intent the engine emits resolves to exactly one record (`filled`,
 * `partial`, `rejected` or `expired`). `filledUsd` is the booked notional for a
 * sell; `priceUsd` is `null` when no tradable bar priced the intent.
 * `decisionTime` is the decision bar close; `fillTime` is the bar open where the
 * fill attempt resolved, or `null` when the intent never reached a bar (a
 * queue-time duplicate rejection).
 */
export interface IntentRecord {
  readonly intentId: string;
  readonly tokenId: string;
  readonly side: 'buy' | 'sell';
  readonly strategyKey: StrategyKey;
  readonly strategyVersion: number;
  readonly status: FillStatus;
  readonly requestedUsd: string | null;
  readonly requestedAmount: string | null;
  readonly filledUsd: string;
  readonly filledAmount: string;
  readonly priceUsd: string | null;
  readonly feeUsd: string;
  /** Fill outcome reason (`FILL_*`). */
  readonly reasonCode: ReasonCode;
  /** Strategy reason that produced the intent (`TREND_PULLBACK_STOP`, `RANGE_REVERSION_ENTRY`, ...). */
  readonly strategyReasonCode: ReasonCode;
  readonly reasonText: string;
  readonly decisionTime: Timestamp;
  readonly fillTime: Timestamp | null;
}

/**
 * One marked equity observation at a decision bar close.
 *
 * `drawdownPct` is measured against the running equity peak at or before this
 * bar, so it is never negative. All money values are 2-decimal USD strings.
 */
export interface EquityPoint {
  readonly clockTime: Timestamp;
  readonly equityUsd: string;
  readonly cashUsd: string;
  readonly positionsValueUsd: string;
  readonly drawdownPct: string;
}

/**
 * One raw equity observation before drawdown is derived.
 *
 * The mark projection (`markPortfolio`) supplies the three money strings; the
 * initial capital is the starting peak that `buildEquityCurve` uses for the
 * first bar.
 */
export interface EquityObservation {
  readonly clockTime: Timestamp;
  readonly equityUsd: string;
  readonly cashUsd: string;
  readonly positionsValueUsd: string;
}

/** Input to `buildEquityCurve`: raw marks plus the starting peak. */
export interface BuildEquityCurveInput {
  readonly initialCapitalUsd: string;
  readonly points: readonly EquityObservation[];
}

/** Closed-trade summary for one strategy key. */
export interface StrategyMetric {
  readonly strategyKey: StrategyKey;
  readonly tradeCount: number;
  readonly wins: number;
  readonly losses: number;
  readonly realizedPnlUsd: string;
  /** `wins / tradeCount * 100`, or `null` when the strategy has no closed trades. */
  readonly winRatePct: string | null;
}

/** Closed-trade summary for one token. */
export interface TokenMetric {
  readonly tokenId: string;
  readonly tradeCount: number;
  readonly wins: number;
  readonly losses: number;
  readonly realizedPnlUsd: string;
  /** `wins / tradeCount * 100`, or `null` when the token has no closed trades. */
  readonly winRatePct: string | null;
}

/**
 * Summary metrics for one finished paper run.
 *
 * Money and percent values are decimal strings with two decimals; counts are
 * integers. Undefined ratios are `null`, never `Infinity` or `NaN`. Per-strategy
 * and per-token summaries cover closed trades only; open positions contribute
 * to `finalPositionsValueUsd` and `unrealizedPnlUsd` instead.
 */
export interface RunMetrics {
  readonly initialCapitalUsd: string;
  readonly finalEquityUsd: string;
  readonly totalReturnPct: string;
  readonly maxDrawdownPct: string;
  readonly peakEquityUsd: string;
  readonly finalCashUsd: string;
  readonly finalPositionsValueUsd: string;
  readonly realizedPnlUsd: string;
  readonly unrealizedPnlUsd: string;
  readonly feesPaidUsd: string;
  readonly tradeCount: number;
  readonly wins: number;
  readonly losses: number;
  readonly winRatePct: string | null;
  readonly profitFactor: string | null;
  readonly averageWinUsd: string | null;
  readonly averageLossUsd: string | null;
  readonly timeInMarketPct: string;
  readonly averageExposurePct: string;
  readonly perStrategy: readonly StrategyMetric[];
  readonly perToken: readonly TokenMetric[];
}

/**
 * Input to `computeMetrics`.
 *
 * Marks cannot be re-derived from the ledger, so the caller passes the final
 * `markPortfolio` projection explicitly: `finalEquityUsd`,
 * `finalPositionsValueUsd` and `unrealizedPnlUsd`. `closedTrades` is the trade
 * journal (normally `ledger.closedTrades`); the ledger supplies cash, realized
 * P&L and fees.
 */
export interface MetricsInput {
  readonly initialCapitalUsd: string;
  readonly finalEquityUsd: string;
  readonly finalPositionsValueUsd: string;
  readonly unrealizedPnlUsd: string;
  readonly equityCurve: readonly EquityPoint[];
  readonly ledger: PaperLedgerState;
  readonly closedTrades: readonly PaperTrade[];
}

/** Hindsight verdict for one rejected buy. */
export type CounterfactualOutcome =
  'missed_opportunity' | 'bad_save' | 'neutral' | 'insufficient_data';

/**
 * A buy the decision engine (or the fill model) did not take.
 *
 * `decisionTime` is the decision bar close, exactly as the paper runner stamps
 * intents. Counterfactual analysis resolves the entry from this timestamp, so
 * the reason code identifies why the buy never happened: no position exists, the
 * cash floor vetoed it, liquidity capped it at zero, or the bar had no data.
 */
export interface RejectedBuy {
  readonly tokenId: string;
  readonly decisionTime: Timestamp;
  readonly reasonCode: ReasonCode;
}

/**
 * One hindsight round trip for a rejected buy.
 *
 * This is a **reporting-only** artifact: `hindsight` is the literal `true` and
 * `usedForDecisions` the literal `false`, so the type system and the persisted
 * report both record that the answer was computed after the fact and can never
 * feed back into a decision.
 *
 * `entryAt` is the entry bar's `openTime`; `exitAt` is the exit bar's close time
 * (`openTime + timeframe`), because that is the instant the exit price was
 * realised. Prices are 8-decimal USD strings, `returnPct` has two decimals.
 *
 * On missing data the record reports `insufficient_data` with `null` where the
 * data was absent: a missing entry leaves every price/time field `null`, while a
 * missing exit keeps the entry and leaves the exit fields and `returnPct` null.
 */
export interface CounterfactualRecord {
  readonly tokenId: string;
  readonly decisionTime: Timestamp;
  readonly reasonCode: ReasonCode;
  readonly entryAt: Timestamp | null;
  readonly entryPriceUsd: string | null;
  readonly exitAt: Timestamp | null;
  readonly exitPriceUsd: string | null;
  readonly returnPct: string | null;
  readonly outcome: CounterfactualOutcome;
  readonly hindsight: true;
  readonly usedForDecisions: false;
}

/**
 * Input to `analyzeRejectedBuys`.
 *
 * `candles` is the run's candle series (one timeframe per token); the analysis
 * never reads outside it. `horizonHours` is the hindsight exit horizon measured
 * from the entry bar open, and `feeBps`/`slippageBps` mirror the paper run so the
 * counterfactual pays the same costs the paper bot would have paid.
 */
export interface CounterfactualInput {
  readonly rejected: readonly RejectedBuy[];
  readonly candles: readonly Candle[];
  readonly horizonHours: number;
  readonly feeBps: number;
  readonly slippageBps: number;
}

/**
 * Input to one deterministic paper run.
 *
 * `initialCapitalUsd` is optional because the approved $1,000 paper capital is
 * a default; a caller may supply a different starting balance.
 */
export interface PaperRunInput {
  readonly runId: string;
  readonly seed: number;
  readonly configVersion: string;
  readonly dataSnapshotId: string;
  readonly tokenIds: readonly string[];
  readonly candles: readonly Candle[];
  readonly settings: SandboxDecisionSettings;
  readonly paper: PaperRunSettings;
  readonly initialState?: EngineState;
  readonly initialCapitalUsd?: string;
}

/**
 * Complete result of one paper run.
 *
 * `eventCount`/`eventHash` cover the whole supplied log (decision engine plus
 * host), and the ledger is the final snapshot after the last bar.
 */
export interface PaperRunResult {
  readonly config: PaperRunConfig;
  readonly configVersion: string;
  readonly dataSnapshotId: string;
  readonly ledger: PaperLedgerState;
  readonly state: EngineState;
  readonly intents: readonly IntentRecord[];
  readonly equityCurve: readonly EquityPoint[];
  readonly eventCount: number;
  readonly eventHash: string;
}

/** Marked period of one paper run. */
export interface ReportPeriod {
  readonly firstBar: Timestamp;
  readonly lastBar: Timestamp;
  readonly bars: number;
  readonly tokens: readonly string[];
}

/**
 * Deterministic JSON/Markdown report for one finished paper run.
 *
 * The report intentionally contains no wall clock (`generatedAt`) so the same
 * run always produces the same `reportHash`. Hashes and counts let a reviewer
 * tie the JSON summary back to the persisted event journal.
 */
export interface RunReport {
  readonly paperVersion: string;
  readonly runId: string;
  readonly seed: number;
  readonly configVersion: string;
  readonly dataSnapshotId: string;
  readonly settingsVersion: string;
  readonly config: PaperRunConfig;
  readonly period: ReportPeriod;
  readonly metrics: RunMetrics;
  readonly equityCurve: readonly EquityPoint[];
  readonly positions: readonly PortfolioPosition[];
  readonly trades: readonly PaperTrade[];
  readonly intentJournal: readonly IntentRecord[];
  readonly counterfactuals: readonly CounterfactualRecord[];
  readonly eventCount: number;
  readonly eventHash: string;
  readonly ledgerEntries: number;
  /** True for every produced report: an unreconciled run throws instead. */
  readonly reconciliationOk: boolean;
  /** Static list of the ledger identities `reconcileLedger` verified. */
  readonly reconciliationChecks: readonly string[];
  readonly reportHash: string;
}

/** Final marked projection supplied by `markPortfolio`. */
export interface FinalMarkProjection {
  readonly equityUsd: string;
  readonly positionsValueUsd: string;
  readonly unrealizedPnlUsd: string;
  readonly positions: readonly PortfolioPosition[];
}

/**
 * Input to `buildReport`.
 *
 * `marks` are the final per-token marks used for reconciliation; `events` are
 * the persisted journal rows (the report keeps only their count/hash). Metrics
 * may be supplied by a caller that already computed them, otherwise the report
 * derives them from the ledger and the final marks.
 */
export interface BuildReportInput {
  readonly result: PaperRunResult;
  readonly finalMark: FinalMarkProjection;
  readonly marks: Readonly<Record<string, string>>;
  readonly events: readonly SandboxEvent[];
  readonly counterfactuals: readonly CounterfactualRecord[];
  readonly settingsVersion: string;
  readonly metrics?: RunMetrics;
}

/** Artifact paths written by `writePaperArtifacts`. */
export interface PaperArtifactPaths {
  readonly outputDir: string;
  readonly eventsPath: string;
  readonly reportJsonPath: string;
  readonly reportMarkdownPath: string;
}

/** Input to `writePaperArtifacts`. */
export interface WritePaperArtifactsInput {
  readonly outputDir: string;
  readonly report: RunReport;
  readonly events: readonly SandboxEvent[];
}

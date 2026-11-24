import { Decimal } from 'decimal.js';
import { z } from 'zod';
import { sandboxRunConfigSchema, type SandboxStatus } from '@nexter/contracts';
import {
  DEFAULT_PAPER_SETTINGS,
  DEFAULT_SETTINGS,
  Reason,
  type EngineState,
  type EquityPoint,
  type IntentRecord,
  type LedgerEntry,
  type PaperLedgerState,
  type PaperPosition,
  type PaperRunSettings,
  type PaperTrade,
  type PortfolioPosition,
  type ReasonCode,
  type Regime,
  type RegimeFeatures,
  type SandboxDecisionSettings,
  type StrategyKey,
  type TokenPhase,
  type TokenRuntimeState,
} from '@nexter/sandbox-core';

/** Injection token for the `SANDBOX_ENABLED` feature flag. */
export const SANDBOX_ENABLED = 'SANDBOX_ENABLED';

/** Contract version exposed by the sandbox status endpoint. */
export const SANDBOX_VERSION = 'sandbox-stage-2';

/** Owner-facing sandbox availability. */
export type { SandboxStatus };

export const SANDBOX_RUN_STATUSES = ['draft', 'running', 'paused', 'stopped', 'failed'] as const;
export type SandboxRunStatus = (typeof SANDBOX_RUN_STATUSES)[number];

export function isSandboxRunStatus(value: string): value is SandboxRunStatus {
  return (SANDBOX_RUN_STATUSES as readonly string[]).includes(value);
}

/**
 * Known Stage 1B strategy and regime keys.
 *
 * Persisted JSONB state is validated against these lists on read: an unknown
 * key means the state was written by a different/older engine and must fail
 * closed rather than be silently coerced.
 */
export const SANDBOX_STRATEGY_KEYS = [
  'trend_pullback',
  'range_reversion',
  'recovery',
] as const satisfies readonly StrategyKey[];

export const SANDBOX_REGIMES = [
  'TREND_UP',
  'TREND_DOWN',
  'RANGE',
  'CRASH',
  'RECOVERY',
  'ILLIQUID',
  'UNKNOWN',
] as const satisfies readonly Regime[];

export const SANDBOX_TOKEN_PHASES = [
  'SLEEPING',
  'ARMED',
  'IN_POSITION',
  'COOLDOWN',
  'BLOCKED',
] as const satisfies readonly TokenPhase[];

export type SandboxPersistenceErrorCode =
  | 'SANDBOX_RUN_NOT_FOUND'
  | 'SANDBOX_STATE_INVALID'
  | 'SANDBOX_EVENT_CHAIN_DESYNC'
  | 'SANDBOX_EVENT_PAYLOAD_INVALID';

/** Typed persistence failure for the sandbox run store and event log. */
export class SandboxPersistenceError extends Error {
  constructor(
    readonly code: SandboxPersistenceErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'SandboxPersistenceError';
  }
}

/** Frozen per-run token snapshot row (`sandbox_run_tokens`). */
export interface SandboxRunToken {
  readonly tokenKey: string;
  readonly symbol: string;
  readonly chain: string;
  readonly contractAddress: string | null;
  readonly enabled: boolean;
}

/**
 * One run plus its validated engine/ledger state.
 *
 * `engineState`/`ledgerState` are `null` while a draft run has not initialised
 * them yet (the schema default is `{}`); any other malformed shape fails closed.
 *
 * `eventSeq` is the number of persisted events, i.e. the sequence the next
 * event will receive (0 for an empty chain). `eventHash` is the head hash
 * (`GENESIS_HASH` when empty).
 */
export interface SandboxRunSnapshot {
  readonly id: string;
  readonly userId: string;
  readonly name: string;
  readonly status: SandboxRunStatus;
  readonly initialCapitalUsd: string;
  readonly cashUsd: string;
  readonly equityUsd: string;
  readonly peakEquityUsd: string;
  readonly dayStartEquityUsd: string;
  readonly settings: Readonly<Record<string, unknown>>;
  readonly engineState: EngineState | null;
  readonly ledgerState: PaperLedgerState | null;
  readonly lastBarClose: Date | null;
  readonly eventSeq: number;
  readonly eventHash: string;
  readonly lastTickAt: Date | null;
  readonly error: string | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly startedAt: Date | null;
  readonly pausedAt: Date | null;
  readonly stoppedAt: Date | null;
  readonly archivedAt: Date | null;
  readonly tokens: readonly SandboxRunToken[];
}

/**
 * Frozen runner configuration resolved from `sandbox_runs.settings`.
 *
 * The contract schema validates the persisted JSON; the returned shape uses the
 * core `SandboxDecisionSettings`/`PaperRunSettings` types so the Stage 1B/1C
 * code can consume it directly.
 */
export interface SandboxRunnerConfig {
  readonly tokenKeys: readonly string[];
  readonly seed: number;
  readonly settings: SandboxDecisionSettings;
  readonly paper: PaperRunSettings;
}

/**
 * Resolves the frozen run config from persisted JSONB.
 *
 * A draft created before start may still carry the schema default `{}`; it is
 * resolved to the approved Stage 1B/1C defaults over the supplied token keys so
 * the owner can start it. Any other malformed shape fails closed.
 */
export function resolveSandboxRunConfig(
  value: unknown,
  fallbackTokenKeys: readonly string[],
): SandboxRunnerConfig {
  if (isEmptyObject(value)) {
    return {
      tokenKeys: [...fallbackTokenKeys],
      seed: 1,
      settings: DEFAULT_SETTINGS,
      paper: DEFAULT_PAPER_SETTINGS,
    };
  }

  const result = sandboxRunConfigSchema.safeParse(value);
  if (!result.success) {
    const detail = result.error.issues
      .map((issue) => `${issue.path.join('.') || 'settings'}: ${issue.message}`)
      .join('; ');
    invalid('settings', detail);
  }

  return {
    tokenKeys: result.data.tokenKeys,
    seed: result.data.seed,
    settings: result.data.settings as SandboxDecisionSettings,
    paper: result.data.paper as PaperRunSettings,
  };
}

/** Everything one persisted tick writes in a single transaction. */
export interface SandboxTickInput {
  readonly status: SandboxRunStatus;
  readonly cashUsd: string;
  readonly equityUsd: string;
  readonly peakEquityUsd: string;
  readonly dayStartEquityUsd: string;
  readonly engineState: EngineState;
  readonly ledgerState: PaperLedgerState;
  /** Marked positions from `markPortfolio` for the same clock time. */
  readonly markedPositions: readonly PortfolioPosition[];
  /**
   * Exact per-token mark used at this tick (the raw provider candle close,
   * typically up to 18 decimals). `markedPositions.marketPriceUsd` is only the
   * 8-decimal display value; the projection and report need the exact mark so a
   * low-priced token's market value and equity reconcile.
   */
  readonly marks: Readonly<Record<string, string>>;
  readonly equityPoint: EquityPoint;
  readonly intents: readonly IntentRecord[];
  readonly lastBarClose: Date;
  readonly lastTickAt: Date;
  readonly error?: string | null;
}

/** Counts written by one tick, for logs and tests. */
export interface SandboxTickSummary {
  readonly eventSeq: number;
  readonly eventHash: string;
  readonly positions: number;
  readonly trades: number;
  readonly ledgerEntries: number;
  readonly intents: number;
}

/** `sandbox_positions` insert shape (delete-free projection). */
export interface SandboxPositionRow {
  readonly runId: string;
  readonly tokenId: string;
  readonly strategyKey: StrategyKey;
  readonly strategyVersion: number;
  readonly amount: string;
  readonly avgCostUsd: string;
  readonly costBasisUsd: string;
  readonly marketPriceUsd: string;
  readonly marketValueUsd: string;
  readonly openedAt: Date;
  readonly stopLossPct: string | null;
  readonly takeProfitPct: string | null;
  readonly entryIntentId: string;
  readonly feesPaidUsd: string;
}

/** `sandbox_trades` insert shape. */
export interface SandboxTradeRow {
  readonly runId: string;
  readonly tradeId: string;
  readonly tokenId: string;
  readonly strategyKey: StrategyKey;
  readonly strategyVersion: number;
  readonly entryAt: Date;
  readonly entryPriceUsd: string;
  readonly entryAmount: string;
  readonly entryNotionalUsd: string;
  readonly entryFeeUsd: string;
  readonly entryCostBasisUsd: string;
  readonly entryIntentId: string | null;
  readonly exitAt: Date | null;
  readonly exitPriceUsd: string | null;
  readonly exitAmount: string;
  readonly exitNotionalUsd: string;
  readonly exitFeeUsd: string;
  readonly exitReasonCode: string | null;
  readonly exitIntentId: string | null;
  readonly realizedPnlUsd: string;
  readonly status: 'open' | 'closed';
}

/** `sandbox_ledger_entries` insert shape. */
export interface SandboxLedgerEntryRow {
  readonly runId: string;
  readonly sequence: number;
  readonly entryId: string;
  readonly clockTime: Date;
  readonly tokenId: string;
  readonly side: 'buy' | 'sell';
  readonly intentId: string;
  readonly amount: string;
  readonly priceUsd: string;
  readonly notionalUsd: string;
  readonly feeUsd: string;
  readonly costBasisReleasedUsd: string | null;
  readonly positionCostBasisAfterUsd: string;
  readonly cashAfterUsd: string;
  readonly positionAmountAfter: string;
  readonly positionAvgCostAfter: string | null;
  readonly realizedPnlUsd: string | null;
  readonly reasonCode: string;
}

/** `sandbox_intents` insert shape. */
export interface SandboxIntentRow {
  readonly runId: string;
  readonly intentId: string;
  readonly tokenId: string;
  readonly side: 'buy' | 'sell';
  readonly strategyKey: StrategyKey;
  readonly strategyVersion: number;
  readonly status: IntentRecord['status'];
  readonly requestedUsd: string | null;
  readonly requestedAmount: string | null;
  readonly filledUsd: string;
  readonly filledAmount: string;
  readonly priceUsd: string | null;
  readonly feeUsd: string;
  readonly reasonCode: string;
  readonly strategyReasonCode: string | null;
  readonly reasonText: string;
  readonly decisionTime: Date;
  readonly fillTime: Date | null;
}

/** `sandbox_equity_points` insert shape. */
export interface SandboxEquityPointRow {
  readonly runId: string;
  readonly clockTime: Date;
  readonly equityUsd: string;
  readonly cashUsd: string;
  readonly positionsValueUsd: string;
  readonly drawdownPct: string;
}

const DECIMAL_STRING = /^-?\d+(\.\d+)?$/;

const decimalString = z.string().regex(DECIMAL_STRING);
const nullableDecimalString = decimalString.nullable();
const timestampMs = z.number().int().nonnegative();
const nullableTimestampMs = timestampMs.nullable();
const reasonCodeSchema = z.enum(Object.values(Reason) as [ReasonCode, ...ReasonCode[]]);

const regimeFeaturesSchema = z
  .object({
    bars: z.number().int().nonnegative(),
    lastClose: nullableDecimalString,
    fastSma: nullableDecimalString,
    slowSma: nullableDecimalString,
    longSma: nullableDecimalString,
    atrPct: nullableDecimalString,
    recentHigh: nullableDecimalString,
    recentLow: nullableDecimalString,
    avgVolumeUsd: nullableDecimalString,
    drawdownPct: nullableDecimalString,
    staleBars: z.number().int().nonnegative(),
  })
  .strict() satisfies z.ZodType<RegimeFeatures>;

const tokenRuntimeStateSchema = z
  .object({
    tokenId: z.string().min(1),
    regime: z
      .object({
        regime: z.enum(SANDBOX_REGIMES),
        reasonCode: reasonCodeSchema,
        candidate: z.enum(SANDBOX_REGIMES).nullable(),
        candidateBars: z.number().int().nonnegative(),
        since: timestampMs,
        rulesVersion: z.string().min(1),
        features: regimeFeaturesSchema,
      })
      .strict(),
    phase: z.enum(SANDBOX_TOKEN_PHASES),
    cooldownUntil: nullableTimestampMs,
    strategyState: z.record(z.string(), z.unknown()),
  })
  .strict() satisfies z.ZodType<TokenRuntimeState>;

const engineStateSchema = z
  .object({
    tokens: z.record(z.string(), tokenRuntimeStateSchema),
  })
  .strict();

const paperPositionSchema = z
  .object({
    tokenId: z.string().min(1),
    strategyKey: z.enum(SANDBOX_STRATEGY_KEYS),
    strategyVersion: z.number().int().positive(),
    amount: decimalString,
    costBasisUsd: decimalString,
    avgCostUsd: decimalString,
    openedAt: timestampMs,
    stopLossPct: nullableDecimalString,
    takeProfitPct: nullableDecimalString,
    entryIntentId: z.string().min(1),
    feesPaidUsd: decimalString,
  })
  .strict() satisfies z.ZodType<PaperPosition>;

const paperTradeSchema = z
  .object({
    tradeId: z.string().min(1),
    tokenId: z.string().min(1),
    strategyKey: z.enum(SANDBOX_STRATEGY_KEYS),
    strategyVersion: z.number().int().positive(),
    entryAt: timestampMs,
    entryPriceUsd: decimalString,
    entryAmount: decimalString,
    entryNotionalUsd: decimalString,
    entryFeeUsd: decimalString,
    entryCostBasisUsd: decimalString,
    entryIntentId: z.string().min(1),
    exitAt: nullableTimestampMs,
    exitPriceUsd: nullableDecimalString,
    exitAmount: decimalString,
    exitNotionalUsd: decimalString,
    exitFeeUsd: decimalString,
    exitReasonCode: reasonCodeSchema.nullable(),
    exitIntentId: z.string().min(1).nullable(),
    realizedPnlUsd: decimalString,
    status: z.enum(['open', 'closed']),
  })
  .strict() satisfies z.ZodType<PaperTrade>;

const ledgerEntrySchema = z
  .object({
    entryId: z.string().min(1),
    sequence: z.number().int().positive(),
    clockTime: timestampMs,
    tokenId: z.string().min(1),
    side: z.enum(['buy', 'sell']),
    intentId: z.string().min(1),
    amount: decimalString,
    priceUsd: decimalString,
    notionalUsd: decimalString,
    feeUsd: decimalString,
    cashAfterUsd: decimalString,
    positionAmountAfter: decimalString,
    positionAvgCostAfter: nullableDecimalString,
    costBasisReleasedUsd: nullableDecimalString,
    positionCostBasisAfterUsd: decimalString,
    realizedPnlUsd: nullableDecimalString,
    reasonCode: reasonCodeSchema,
  })
  .strict() satisfies z.ZodType<LedgerEntry>;

const ledgerStateSchema = z
  .object({
    cashUsd: decimalString,
    initialCapitalUsd: decimalString,
    positions: z.record(z.string(), paperPositionSchema),
    entries: z.array(ledgerEntrySchema),
    realizedPnlUsd: decimalString,
    feesPaidUsd: decimalString,
    closedTrades: z.array(paperTradeSchema),
    openTrades: z.record(z.string(), paperTradeSchema),
  })
  .strict();

function invalid(path: string, message: string): never {
  throw new SandboxPersistenceError('SANDBOX_STATE_INVALID', `${path}: ${message}`);
}

function parseWith<T>(schema: z.ZodType<T>, value: unknown, path: string): T {
  const result = schema.safeParse(value);
  if (result.success) return result.data;

  const detail = result.error.issues
    .map((issue) => `${issue.path.join('.') || path}: ${issue.message}`)
    .join('; ');
  return invalid(path, detail);
}

/**
 * Validates a persisted Stage 1B `EngineState`.
 *
 * Unknown strategy/regime/phase keys, mismatched token keys and malformed
 * timestamps throw `SANDBOX_STATE_INVALID`; nothing is coerced.
 */
export function parseEngineState(value: unknown): EngineState {
  const parsed = parseWith<EngineState>(engineStateSchema, value, 'engineState');
  for (const [tokenId, token] of Object.entries(parsed.tokens)) {
    if (token.tokenId !== tokenId) {
      invalid(`engineState.tokens.${tokenId}.tokenId`, 'must match its record key');
    }
  }
  return parsed;
}

/**
 * Validates a persisted Stage 1C `PaperLedgerState`, including the known
 * strategy keys and the token/trade record keys.
 */
export function parsePaperLedgerState(value: unknown): PaperLedgerState {
  const parsed = parseWith<PaperLedgerState>(ledgerStateSchema, value, 'ledgerState');

  for (const [tokenId, position] of Object.entries(parsed.positions)) {
    if (position.tokenId !== tokenId) {
      invalid(`ledgerState.positions.${tokenId}.tokenId`, 'must match its record key');
    }
  }
  for (const [tokenId, trade] of Object.entries(parsed.openTrades)) {
    if (trade.tokenId !== tokenId) {
      invalid(`ledgerState.openTrades.${tokenId}.tokenId`, 'must match its record key');
    }
    if (trade.status !== 'open') {
      invalid(`ledgerState.openTrades.${tokenId}.status`, 'must be open');
    }
  }
  for (const [index, trade] of parsed.closedTrades.entries()) {
    if (trade.status !== 'closed') {
      invalid(`ledgerState.closedTrades.${index}.status`, 'must be closed');
    }
  }
  const sequences = new Set<number>();
  for (const entry of parsed.entries) {
    if (sequences.has(entry.sequence)) {
      invalid(`ledgerState.entries.${entry.sequence}`, 'duplicate ledger sequence');
    }
    sequences.add(entry.sequence);
  }

  return parsed;
}

/**
 * Parses an uninitialised JSONB state column.
 *
 * Only a draft run may still carry the schema default `{}`; a started (or
 * terminal) run with an empty state is a persistence bug and fails closed.
 * Any other object must validate against the strict engine/ledger schema.
 */
export function parseOptionalEngineState(
  value: unknown,
  status: SandboxRunStatus,
): EngineState | null {
  if (isEmptyObject(value)) {
    if (status !== 'draft') {
      invalid('engineState', `an empty state is only allowed for a draft run (status ${status})`);
    }
    return null;
  }
  return parseEngineState(value);
}

export function parseOptionalLedgerState(
  value: unknown,
  status: SandboxRunStatus,
): PaperLedgerState | null {
  if (isEmptyObject(value)) {
    if (status !== 'draft') {
      invalid('ledgerState', `an empty state is only allowed for a draft run (status ${status})`);
    }
    return null;
  }
  return parsePaperLedgerState(value);
}

function isEmptyObject(value: unknown): boolean {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.keys(value).length === 0
  );
}

/** Validates the run-level money/status fields of a tick. */
export function assertSandboxTickInput(tick: SandboxTickInput): void {
  if (!isSandboxRunStatus(tick.status)) {
    invalid('status', `unknown sandbox run status ${String(tick.status)}`);
  }
  if (typeof tick.marks !== 'object' || tick.marks === null || Array.isArray(tick.marks)) {
    invalid('marks', 'must be an object of exact per-token marks');
  }
  for (const field of ['cashUsd', 'equityUsd', 'peakEquityUsd', 'dayStartEquityUsd'] as const) {
    assertDecimal(tick[field], field);
  }
  for (const field of ['lastBarClose', 'lastTickAt'] as const) {
    if (Number.isNaN(tick[field].getTime())) {
      invalid(field, 'must be a valid date');
    }
  }
  if (Number.isNaN(new Date(tick.equityPoint.clockTime).getTime())) {
    invalid('equityPoint.clockTime', 'must be a valid timestamp');
  }
  for (const field of ['equityUsd', 'cashUsd', 'positionsValueUsd', 'drawdownPct'] as const) {
    assertDecimal(tick.equityPoint[field], `equityPoint.${field}`);
  }
  for (const [index, mark] of tick.markedPositions.entries()) {
    const path = `markedPositions.${index}`;
    if (!mark.tokenId) invalid(`${path}.tokenId`, 'must not be empty');
    if (!(SANDBOX_STRATEGY_KEYS as readonly string[]).includes(mark.strategyKey)) {
      invalid(`${path}.strategyKey`, `unknown strategy key "${String(mark.strategyKey)}"`);
    }
    if (!Number.isInteger(mark.strategyVersion) || mark.strategyVersion < 1) {
      invalid(`${path}.strategyVersion`, 'must be a positive integer');
    }
    assertDecimal(mark.amount, `${path}.amount`);
    assertDecimal(mark.avgCostUsd, `${path}.avgCostUsd`);
    assertDecimal(mark.marketPriceUsd, `${path}.marketPriceUsd`);
    assertDecimal(mark.marketValueUsd, `${path}.marketValueUsd`);
    assertNullableDecimal(mark.stopLossPct, `${path}.stopLossPct`);
    assertNullableDecimal(mark.takeProfitPct, `${path}.takeProfitPct`);
  }

  // Every open ledger position (and therefore every marked position) needs the
  // exact mark that produced its 2-decimal market value; the 8-decimal display
  // price is not enough to reconstruct a low-priced token's equity.
  for (const tokenId of Object.keys(tick.ledgerState.positions)) {
    const exact = tick.marks[tokenId];
    if (exact === undefined) {
      invalid(`marks.${tokenId}`, 'missing exact mark for an open ledger position');
    }
    assertDecimal(exact, `marks.${tokenId}`);
  }
  for (const mark of tick.markedPositions) {
    const exact = tick.marks[mark.tokenId];
    if (exact === undefined) {
      invalid(`marks.${mark.tokenId}`, 'missing exact mark for a marked position');
    }
    if (new Decimal(exact).toFixed(8) !== mark.marketPriceUsd) {
      invalid(`marks.${mark.tokenId}`, 'must round to the marked 8-decimal display price');
    }
  }
}

/**
 * Cross-checks the identities a tick must satisfy before it is persisted.
 *
 * The JSONB ledger/mark state is the source of truth, so a caller that hands in
 * a mismatched run total, equity point or position mark is a bug: fail closed
 * rather than persist a projection that disagrees with the ledger.
 */
export function assertSandboxTickConsistency(tick: SandboxTickInput): void {
  const ledger = tick.ledgerState;
  if (!decimalEquals(tick.cashUsd, ledger.cashUsd)) {
    invalid('cashUsd', 'must equal ledgerState.cashUsd');
  }

  const markedValue = tick.markedPositions.reduce(
    (total, mark) => total.plus(new Decimal(mark.marketValueUsd)),
    new Decimal(0),
  );
  // `markPortfolio` sums unrounded position values and rounds the total, while
  // each projected position is rounded to cents; allow one cent per position.
  const positionRoundingTolerance = new Decimal('0.01').times(
    Math.max(tick.markedPositions.length, 1),
  );
  if (
    new Decimal(tick.equityPoint.positionsValueUsd)
      .minus(markedValue)
      .abs()
      .greaterThan(positionRoundingTolerance)
  ) {
    invalid('equityPoint.positionsValueUsd', 'must equal the sum of marked position market values');
  }
  if (!decimalEquals(tick.equityPoint.cashUsd, ledger.cashUsd)) {
    invalid('equityPoint.cashUsd', 'must equal ledgerState.cashUsd');
  }
  if (!decimalEquals(tick.equityPoint.equityUsd, tick.equityUsd)) {
    invalid('equityPoint.equityUsd', 'must equal the persisted equityUsd');
  }
  const equity = new Decimal(tick.equityPoint.cashUsd).plus(tick.equityPoint.positionsValueUsd);
  if (!equity.equals(new Decimal(tick.equityPoint.equityUsd))) {
    invalid('equityPoint.equityUsd', 'must equal cashUsd + positionsValueUsd');
  }
  if (!decimalEquals(tick.equityUsd, equity.toFixed(2))) {
    invalid('equityUsd', 'must equal equityPoint equityUsd');
  }
  if (new Decimal(tick.peakEquityUsd).lessThan(tick.equityUsd)) {
    invalid('peakEquityUsd', 'must be at least the current equityUsd');
  }
  if (new Decimal(tick.dayStartEquityUsd).lessThanOrEqualTo(0)) {
    invalid('dayStartEquityUsd', 'must be positive');
  }
}

function assertDecimal(value: string, path: string): void {
  if (typeof value !== 'string' || !DECIMAL_STRING.test(value)) {
    invalid(path, 'must be a decimal string');
  }
}

function assertNullableDecimal(value: string | null, path: string): void {
  if (value === null) return;
  assertDecimal(value, path);
}

function decimalEquals(left: string, right: string): boolean {
  return new Decimal(left).equals(new Decimal(right));
}

/**
 * Builds `sandbox_positions` rows from the ledger plus the marked portfolio.
 *
 * The ledger owns entry intent, cost basis and fees; `markPortfolio` owns the
 * mark price/value. A position without a matching mark is a caller error.
 */
export function buildSandboxPositionRows(
  runId: string,
  ledger: PaperLedgerState,
  markedPositions: SandboxTickInput['markedPositions'],
  marks: SandboxTickInput['marks'],
): SandboxPositionRow[] {
  const marked = new Map(markedPositions.map((position) => [position.tokenId, position]));

  return Object.keys(ledger.positions)
    .sort()
    .map((tokenId) => {
      const position = ledger.positions[tokenId];
      if (position === undefined) invalid(`ledgerState.positions.${tokenId}`, 'missing position');
      const mark = marked.get(tokenId);
      if (mark === undefined) {
        invalid(`markedPositions.${tokenId}`, 'missing mark for an open ledger position');
      }
      if (mark.amount !== position.amount) {
        invalid(`markedPositions.${tokenId}.amount`, 'does not match the ledger position');
      }
      const exactMark = marks[tokenId];
      if (exactMark === undefined) {
        invalid(`marks.${tokenId}`, 'missing exact mark for an open ledger position');
      }
      if (new Decimal(exactMark).toFixed(8) !== mark.marketPriceUsd) {
        invalid(`marks.${tokenId}`, 'must round to the marked 8-decimal display price');
      }
      return {
        runId,
        tokenId,
        strategyKey: position.strategyKey,
        strategyVersion: position.strategyVersion,
        amount: position.amount,
        avgCostUsd: position.avgCostUsd,
        costBasisUsd: position.costBasisUsd,
        // Persist the exact tick mark, not the core 8-decimal display value.
        marketPriceUsd: exactMark,
        marketValueUsd: mark.marketValueUsd,
        openedAt: new Date(position.openedAt),
        stopLossPct: position.stopLossPct,
        takeProfitPct: position.takeProfitPct,
        entryIntentId: position.entryIntentId,
        feesPaidUsd: position.feesPaidUsd,
      };
    });
}

/**
 * Returns the token ids whose projection row must be zeroed because the ledger
 * no longer holds the position. Projections are delete-free, so a closed
 * position keeps its row as a zero-amount tombstone.
 */
export function buildSandboxClosedPositionTokenIds(
  existingTokenIds: readonly string[],
  activeTokenIds: readonly string[],
): string[] {
  const active = new Set(activeTokenIds);
  return [...new Set(existingTokenIds)].filter((tokenId) => !active.has(tokenId)).sort();
}

/** Builds `sandbox_trades` rows for closed and open trades. */
export function buildSandboxTradeRows(runId: string, ledger: PaperLedgerState): SandboxTradeRow[] {
  const trades = [...ledger.closedTrades, ...Object.values(ledger.openTrades)];
  const seen = new Set<string>();
  for (const trade of trades) {
    if (seen.has(trade.tradeId)) {
      invalid(
        `ledgerState.trades.${trade.tradeId}`,
        'duplicate tradeId across closed and open trades',
      );
    }
    seen.add(trade.tradeId);
  }

  return trades
    .slice()
    .sort((left, right) =>
      left.tradeId < right.tradeId ? -1 : left.tradeId > right.tradeId ? 1 : 0,
    )
    .map((trade) => ({
      runId,
      tradeId: trade.tradeId,
      tokenId: trade.tokenId,
      strategyKey: trade.strategyKey,
      strategyVersion: trade.strategyVersion,
      entryAt: new Date(trade.entryAt),
      entryPriceUsd: trade.entryPriceUsd,
      entryAmount: trade.entryAmount,
      entryNotionalUsd: trade.entryNotionalUsd,
      entryFeeUsd: trade.entryFeeUsd,
      entryCostBasisUsd: trade.entryCostBasisUsd,
      entryIntentId: trade.entryIntentId,
      exitAt: trade.exitAt === null ? null : new Date(trade.exitAt),
      exitPriceUsd: trade.exitPriceUsd,
      exitAmount: trade.exitAmount,
      exitNotionalUsd: trade.exitNotionalUsd,
      exitFeeUsd: trade.exitFeeUsd,
      exitReasonCode: trade.exitReasonCode,
      exitIntentId: trade.exitIntentId,
      realizedPnlUsd: trade.realizedPnlUsd,
      status: trade.status,
    }));
}

/** Builds append-only `sandbox_ledger_entries` rows from the ledger. */
export function buildSandboxLedgerEntryRows(
  runId: string,
  ledger: PaperLedgerState,
): SandboxLedgerEntryRow[] {
  return ledger.entries
    .slice()
    .sort((left, right) => left.sequence - right.sequence)
    .map((entry) => ({
      runId,
      sequence: entry.sequence,
      entryId: entry.entryId,
      clockTime: new Date(entry.clockTime),
      tokenId: entry.tokenId,
      side: entry.side,
      intentId: entry.intentId,
      amount: entry.amount,
      priceUsd: entry.priceUsd,
      notionalUsd: entry.notionalUsd,
      feeUsd: entry.feeUsd,
      costBasisReleasedUsd: entry.costBasisReleasedUsd,
      positionCostBasisAfterUsd: entry.positionCostBasisAfterUsd,
      cashAfterUsd: entry.cashAfterUsd,
      positionAmountAfter: entry.positionAmountAfter,
      positionAvgCostAfter: entry.positionAvgCostAfter,
      realizedPnlUsd: entry.realizedPnlUsd,
      reasonCode: entry.reasonCode,
    }));
}

/** Builds `sandbox_intents` rows from the Stage 1C intent journal. */
export function buildSandboxIntentRows(
  runId: string,
  intents: readonly IntentRecord[],
): SandboxIntentRow[] {
  const seen = new Set<string>();
  for (const intent of intents) {
    if (seen.has(intent.intentId)) {
      invalid(`sandboxTick.intents.${intent.intentId}`, 'duplicate intentId in one tick');
    }
    seen.add(intent.intentId);
  }

  return intents.map((intent) => ({
    runId,
    intentId: intent.intentId,
    tokenId: intent.tokenId,
    side: intent.side,
    strategyKey: intent.strategyKey,
    strategyVersion: intent.strategyVersion,
    status: intent.status,
    requestedUsd: intent.requestedUsd,
    requestedAmount: intent.requestedAmount,
    filledUsd: intent.filledUsd,
    filledAmount: intent.filledAmount,
    priceUsd: intent.priceUsd,
    feeUsd: intent.feeUsd,
    reasonCode: intent.reasonCode,
    strategyReasonCode: intent.strategyReasonCode ?? null,
    reasonText: intent.reasonText,
    decisionTime: new Date(intent.decisionTime),
    fillTime: intent.fillTime === null ? null : new Date(intent.fillTime),
  }));
}

/** Builds the `sandbox_equity_points` row for one decision bar close. */
export function buildSandboxEquityPointRow(
  runId: string,
  point: EquityPoint,
): SandboxEquityPointRow {
  return {
    runId,
    clockTime: new Date(point.clockTime),
    equityUsd: point.equityUsd,
    cashUsd: point.cashUsd,
    positionsValueUsd: point.positionsValueUsd,
    drawdownPct: point.drawdownPct,
  };
}

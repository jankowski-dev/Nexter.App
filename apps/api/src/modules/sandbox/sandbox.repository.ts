import { Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, gte, inArray, isNull, lt, lte, sql } from 'drizzle-orm';
import {
  sandboxCandles,
  sandboxEquityPoints,
  sandboxIntents,
  sandboxLedgerEntries,
  sandboxPositions,
  sandboxRuns,
  sandboxRunTokens,
  sandboxTokens,
  sandboxTrades,
  type Database,
  type DbExecutor,
  type DbTransaction,
  type SandboxEquityPointRecord,
  type SandboxIntentRecord,
  type SandboxPositionRecord,
  type SandboxTradeRecord,
} from '@nexter/db';
import { SANDBOX_TIMEFRAME, SANDBOX_TIMEFRAME_MS } from '@nexter/contracts';
import {
  Reason,
  type Candle,
  type OrderIntent,
  type SandboxEvent,
  type StrategyKey,
} from '@nexter/sandbox-core';
import { DB } from '../../shared/db/db.module';
import { listAllSandboxEvents, listSandboxEvents, SandboxEventLog } from './sandbox-event-log';
import {
  assertSandboxTickConsistency,
  assertSandboxTickInput,
  buildSandboxClosedPositionTokenIds,
  buildSandboxEquityPointRow,
  buildSandboxIntentRows,
  buildSandboxLedgerEntryRows,
  buildSandboxPositionRows,
  buildSandboxTradeRows,
  isSandboxRunStatus,
  parseEngineState,
  parseOptionalEngineState,
  parseOptionalLedgerState,
  parsePaperLedgerState,
  SandboxPersistenceError,
  type SandboxRunSnapshot,
  type SandboxRunStatus,
  type SandboxTickInput,
  type SandboxTickSummary,
} from './sandbox.types';

/** 180 days of 1h bars plus one, the bounded per-token read window. */
export const SANDBOX_CANDLE_READ_LIMIT = 4321;

export interface SandboxCandleUpsertOptions {
  /**
   * Synthetic (CoinGecko) data may only replace rows that are already
   * synthetic; a real GeckoTerminal/Binance bar always wins.
   */
  protectPrimaryRows?: boolean;
}

export interface SandboxTokenRecord {
  id: string;
  userId: string;
  tokenKey: string;
  symbol: string;
  name: string;
  chain: string;
  contractAddress: string | null;
  coingeckoId: string | null;
  enabled: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface SandboxTokenInsert {
  userId: string;
  tokenKey: string;
  symbol: string;
  name: string;
  chain: string;
  contractAddress: string | null;
  coingeckoId: string | null;
  enabled: boolean;
}

export interface SandboxTokenUpdate {
  symbol?: string;
  name?: string;
  coingeckoId?: string | null;
  enabled?: boolean;
}

export interface SandboxCandleInput {
  tokenKey: string;
  timeframe: typeof SANDBOX_TIMEFRAME;
  openTime: Date;
  open: string;
  high: string;
  low: string;
  close: string;
  volumeUsd: string;
  source: string;
  fetchedAt: Date;
}

export interface SandboxCandleStats {
  available: number;
  firstOpenTime: Date | null;
  lastOpenTime: Date | null;
  syntheticCandles: number;
}

/** One pending live-paper intent read back from `sandbox_intents`. */
export interface SandboxPendingIntent {
  readonly runId: string;
  readonly intentId: string;
  readonly tokenId: string;
  readonly side: 'buy' | 'sell';
  readonly strategyKey: StrategyKey;
  readonly strategyVersion: number;
  readonly requestedUsd: string | null;
  readonly requestedAmount: string | null;
  readonly priceUsd: string | null;
  readonly stopLossPct: string | null;
  readonly takeProfitPct: string | null;
  readonly strategyReasonCode: string;
  readonly reasonText: string;
  readonly decisionTime: Date;
}

export interface SandboxRunCreateInput {
  userId: string;
  name: string;
  initialCapitalUsd: string;
  settings: Record<string, unknown>;
}

export interface SandboxRunDraftPatch {
  name?: string;
  initialCapitalUsd?: string;
  settings?: Record<string, unknown>;
}

export interface SandboxRunTransitionPatch {
  status: 'running' | 'paused' | 'stopped' | 'failed';
  pausedAt?: Date | null;
  stoppedAt?: Date | null;
  error?: string | null;
}

export interface SandboxRunStartInput {
  config: Record<string, unknown>;
  initialCapitalUsd: string;
  engineState: Record<string, unknown>;
  ledgerState: Record<string, unknown>;
  tokens: readonly SandboxTokenSnapshotInput[];
}

/** Lightweight run row for the owner read list/overview (no JSONB state). */
export interface SandboxRunSummaryRow {
  readonly id: string;
  readonly name: string;
  readonly status: SandboxRunStatus;
  readonly initialCapitalUsd: string;
  readonly cashUsd: string;
  readonly equityUsd: string;
  readonly peakEquityUsd: string;
  readonly lastBarClose: Date | null;
  readonly lastTickAt: Date | null;
  readonly error: string | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly startedAt: Date | null;
  readonly stoppedAt: Date | null;
  readonly archivedAt: Date | null;
  readonly tokenCount: number;
}

export interface SandboxRunListOptions {
  status?: SandboxRunStatus;
  includeArchived?: boolean;
  limit?: number;
  offset?: number;
}

export interface SandboxPageOptions {
  limit?: number;
  offset?: number;
}

/** Grouped run counts for the overview; `archived` is not part of `total`. */
export interface SandboxRunStatusCount {
  readonly status: SandboxRunStatus;
  readonly archived: boolean;
  readonly count: number;
}

export interface SandboxTokenSnapshotInput {
  tokenKey: string;
  symbol: string;
  chain: string;
  contractAddress: string | null;
  enabled: boolean;
}

/** Drizzle access for the sandbox token universe and its 1h candle store. */
@Injectable()
export class SandboxRepository {
  constructor(@Inject(DB) private readonly db: Database) {}

  async listTokens(userId: string): Promise<SandboxTokenRecord[]> {
    return this.db
      .select()
      .from(sandboxTokens)
      .where(eq(sandboxTokens.userId, userId))
      .orderBy(asc(sandboxTokens.symbol), asc(sandboxTokens.tokenKey));
  }

  async findTokenById(userId: string, id: string): Promise<SandboxTokenRecord | null> {
    const [row] = await this.db
      .select()
      .from(sandboxTokens)
      .where(and(eq(sandboxTokens.userId, userId), eq(sandboxTokens.id, id)))
      .limit(1);

    return row ?? null;
  }

  async insertToken(input: SandboxTokenInsert): Promise<SandboxTokenRecord> {
    const [row] = await this.db.insert(sandboxTokens).values(input).returning();
    if (!row) throw new Error('Sandbox token insert returned no row');

    return row;
  }

  async updateToken(
    userId: string,
    id: string,
    patch: SandboxTokenUpdate,
  ): Promise<SandboxTokenRecord | null> {
    const set: SandboxTokenUpdate & { updatedAt: Date } = { updatedAt: new Date() };
    if (patch.symbol !== undefined) set.symbol = patch.symbol;
    if (patch.name !== undefined) set.name = patch.name;
    if (patch.coingeckoId !== undefined) set.coingeckoId = patch.coingeckoId;
    if (patch.enabled !== undefined) set.enabled = patch.enabled;

    const [row] = await this.db
      .update(sandboxTokens)
      .set(set)
      .where(and(eq(sandboxTokens.userId, userId), eq(sandboxTokens.id, id)))
      .returning();

    return row ?? null;
  }

  /**
   * Upserts candles by `(tokenKey, timeframe, openTime)`. Candles are shared by
   * provider key because the integration is read-only market data; every query
   * that exposes them is scoped through the owner's token universe.
   *
   * With `protectPrimaryRows`, a synthetic (CoinGecko) row only replaces an
   * existing synthetic row, so a temporary primary-provider failure cannot
   * downgrade real OHLCV.
   */
  async upsertCandles(
    rows: SandboxCandleInput[],
    options: SandboxCandleUpsertOptions = {},
  ): Promise<number> {
    if (rows.length === 0) return 0;

    await this.db
      .insert(sandboxCandles)
      .values(rows)
      .onConflictDoUpdate({
        target: [sandboxCandles.tokenKey, sandboxCandles.timeframe, sandboxCandles.openTime],
        set: {
          open: sql`excluded."open"`,
          high: sql`excluded."high"`,
          low: sql`excluded."low"`,
          close: sql`excluded."close"`,
          volumeUsd: sql`excluded."volume_usd"`,
          source: sql`excluded."source"`,
          fetchedAt: sql`excluded."fetched_at"`,
        },
        setWhere: options.protectPrimaryRows
          ? sql`${sandboxCandles.source} = 'coingecko'`
          : undefined,
      });

    return rows.length;
  }

  async candleStatsMany(tokenKeys: string[]): Promise<Map<string, SandboxCandleStats>> {
    const unique = [...new Set(tokenKeys)];
    if (unique.length === 0) return new Map();

    const rows = await this.db
      .select({
        tokenKey: sandboxCandles.tokenKey,
        available: sql<number>`count(*)::int`,
        firstOpenTime: sql<Date | null>`min(${sandboxCandles.openTime})`,
        lastOpenTime: sql<Date | null>`max(${sandboxCandles.openTime})`,
        syntheticCandles: sql<number>`(count(*) filter (where ${sandboxCandles.source} = 'coingecko'))::int`,
      })
      .from(sandboxCandles)
      .where(
        and(
          eq(sandboxCandles.timeframe, SANDBOX_TIMEFRAME),
          inArray(sandboxCandles.tokenKey, unique),
        ),
      )
      .groupBy(sandboxCandles.tokenKey);

    return new Map(
      rows.map((row) => [
        row.tokenKey,
        {
          available: Number(row.available ?? 0),
          firstOpenTime: row.firstOpenTime ? new Date(row.firstOpenTime) : null,
          lastOpenTime: row.lastOpenTime ? new Date(row.lastOpenTime) : null,
          syntheticCandles: Number(row.syntheticCandles ?? 0),
        },
      ]),
    );
  }

  /**
   * Candle summary for an explicit half-open window `[from, to)`.
   *
   * Used by the historical replay preflight: coverage is window-specific, so a
   * fully covered evaluation window is `ok` even when older history is missing.
   * Candles are shared by provider key; callers scope the keys through the
   * owner's token universe first.
   */
  async candleStatsBetween(
    tokenKeys: readonly string[],
    from: Date,
    to: Date,
  ): Promise<Map<string, SandboxCandleStats>> {
    const unique = [...new Set(tokenKeys)];
    if (unique.length === 0 || from.getTime() >= to.getTime()) return new Map();

    const rows = await this.db
      .select({
        tokenKey: sandboxCandles.tokenKey,
        available: sql<number>`count(*)::int`,
        firstOpenTime: sql<Date | null>`min(${sandboxCandles.openTime})`,
        lastOpenTime: sql<Date | null>`max(${sandboxCandles.openTime})`,
        syntheticCandles: sql<number>`(count(*) filter (where ${sandboxCandles.source} = 'coingecko'))::int`,
      })
      .from(sandboxCandles)
      .where(
        and(
          eq(sandboxCandles.timeframe, SANDBOX_TIMEFRAME),
          inArray(sandboxCandles.tokenKey, unique),
          gte(sandboxCandles.openTime, from),
          lt(sandboxCandles.openTime, to),
        ),
      )
      .groupBy(sandboxCandles.tokenKey);

    return new Map(
      rows.map((row) => [
        row.tokenKey,
        {
          available: Number(row.available ?? 0),
          firstOpenTime: row.firstOpenTime ? new Date(row.firstOpenTime) : null,
          lastOpenTime: row.lastOpenTime ? new Date(row.lastOpenTime) : null,
          syntheticCandles: Number(row.syntheticCandles ?? 0),
        },
      ]),
    );
  }

  /**
   * Latest candle **open** per token whose close is not in the future.
   *
   * A replay ends at the earliest of these across the selected tokens, so every
   * token has data at the end; the stored `to_time` is that open plus one bar.
   */
  async latestClosedOpenTimes(
    tokenKeys: readonly string[],
    now: Date = new Date(),
  ): Promise<Map<string, Date>> {
    const unique = [...new Set(tokenKeys)];
    if (unique.length === 0) return new Map();

    const cutoff = new Date(now.getTime() - SANDBOX_TIMEFRAME_MS);
    const rows = await this.db
      .select({
        tokenKey: sandboxCandles.tokenKey,
        latestOpenTime: sql<Date | null>`max(${sandboxCandles.openTime})`,
      })
      .from(sandboxCandles)
      .where(
        and(
          eq(sandboxCandles.timeframe, SANDBOX_TIMEFRAME),
          inArray(sandboxCandles.tokenKey, unique),
          lte(sandboxCandles.openTime, cutoff),
        ),
      )
      .groupBy(sandboxCandles.tokenKey);

    return new Map(
      rows
        .filter(
          (row): row is { tokenKey: string; latestOpenTime: Date } => row.latestOpenTime !== null,
        )
        .map((row) => [row.tokenKey, new Date(row.latestOpenTime)]),
    );
  }

  /**
   * Loads one run with its frozen token snapshot and validated JSONB state.
   *
   * Returns `null` for an unknown run. A draft run that has not initialised its
   * state yet reports `null` engine/ledger state; any malformed state fails
   * closed with `SANDBOX_STATE_INVALID`.
   */
  async loadRun(runId: string, executor: DbExecutor = this.db): Promise<SandboxRunSnapshot | null> {
    const [row] = await executor
      .select()
      .from(sandboxRuns)
      .where(eq(sandboxRuns.id, runId))
      .limit(1);
    if (!row) return null;

    if (!isSandboxRunStatus(row.status)) {
      throw new SandboxPersistenceError(
        'SANDBOX_STATE_INVALID',
        `Sandbox run ${runId} has an unknown status "${row.status}"`,
      );
    }

    const tokens = await executor
      .select({
        tokenKey: sandboxRunTokens.tokenKey,
        symbol: sandboxRunTokens.symbol,
        chain: sandboxRunTokens.chain,
        contractAddress: sandboxRunTokens.contractAddress,
        enabled: sandboxRunTokens.enabled,
      })
      .from(sandboxRunTokens)
      .where(eq(sandboxRunTokens.runId, runId))
      .orderBy(asc(sandboxRunTokens.tokenKey));

    return {
      id: row.id,
      userId: row.userId,
      name: row.name,
      status: row.status,
      initialCapitalUsd: row.initialCapitalUsd,
      cashUsd: row.cashUsd,
      equityUsd: row.equityUsd,
      peakEquityUsd: row.peakEquityUsd,
      dayStartEquityUsd: row.dayStartEquityUsd,
      settings: row.settings,
      engineState: parseOptionalEngineState(row.engineState, row.status),
      ledgerState: parseOptionalLedgerState(row.ledgerState, row.status),
      lastBarClose: row.lastBarClose ?? null,
      eventSeq: row.eventSeq,
      eventHash: row.eventHash,
      lastTickAt: row.lastTickAt ?? null,
      error: row.error ?? null,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      startedAt: row.startedAt ?? null,
      pausedAt: row.pausedAt ?? null,
      stoppedAt: row.stoppedAt ?? null,
      archivedAt: row.archivedAt ?? null,
      tokens,
    };
  }

  /** Reads a bounded slice of one run's persisted event chain. */
  async listEvents(
    runId: string,
    options: { afterSeq?: number; limit?: number } = {},
  ): Promise<SandboxEvent[]> {
    return listSandboxEvents(this.db, runId, options);
  }

  /**
   * Reads every persisted event for one run.
   *
   * Report generation needs the complete chain to reproduce the Stage 1C
   * `eventCount`/`eventHash` audit check; the journal endpoint keeps using the
   * bounded `listEvents`. The event rows are append-only and validated by the
   * report service before any report is produced.
   */
  async listAllEvents(runId: string): Promise<SandboxEvent[]> {
    return listAllSandboxEvents(this.db, runId);
  }

  /** Owner-scoped run list without loading the JSONB state. */
  async listRuns(
    userId: string,
    options: SandboxRunListOptions = {},
  ): Promise<SandboxRunSummaryRow[]> {
    const conditions = [eq(sandboxRuns.userId, userId)];
    if (!options.includeArchived) conditions.push(isNull(sandboxRuns.archivedAt));
    if (options.status !== undefined) conditions.push(eq(sandboxRuns.status, options.status));

    const rows = await this.db
      .select({
        id: sandboxRuns.id,
        name: sandboxRuns.name,
        status: sandboxRuns.status,
        initialCapitalUsd: sandboxRuns.initialCapitalUsd,
        cashUsd: sandboxRuns.cashUsd,
        equityUsd: sandboxRuns.equityUsd,
        peakEquityUsd: sandboxRuns.peakEquityUsd,
        lastBarClose: sandboxRuns.lastBarClose,
        lastTickAt: sandboxRuns.lastTickAt,
        error: sandboxRuns.error,
        createdAt: sandboxRuns.createdAt,
        updatedAt: sandboxRuns.updatedAt,
        startedAt: sandboxRuns.startedAt,
        stoppedAt: sandboxRuns.stoppedAt,
        archivedAt: sandboxRuns.archivedAt,
        tokenCount: sql<number>`(
          select count(*) from ${sandboxRunTokens}
          where ${sandboxRunTokens.runId} = ${sandboxRuns.id}
        )::int`,
      })
      .from(sandboxRuns)
      .where(and(...conditions))
      .orderBy(desc(sandboxRuns.updatedAt), asc(sandboxRuns.id))
      .limit(options.limit ?? 50)
      .offset(options.offset ?? 0);

    return rows.map((row) => ({
      ...row,
      status: assertRunStatus(row.status, row.id),
      tokenCount: Number(row.tokenCount ?? 0),
    }));
  }

  async countRuns(
    userId: string,
    options: { status?: SandboxRunStatus; includeArchived?: boolean } = {},
  ): Promise<number> {
    const conditions = [eq(sandboxRuns.userId, userId)];
    if (!options.includeArchived) conditions.push(isNull(sandboxRuns.archivedAt));
    if (options.status !== undefined) conditions.push(eq(sandboxRuns.status, options.status));

    const [row] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(sandboxRuns)
      .where(and(...conditions));

    return Number(row?.count ?? 0);
  }

  /** Counts every run by status and archived flag for the overview. */
  async runStatusCounts(userId: string): Promise<SandboxRunStatusCount[]> {
    const archived = sql<boolean>`${sandboxRuns.archivedAt} is not null`;
    const rows = await this.db
      .select({
        status: sandboxRuns.status,
        archived,
        count: sql<number>`count(*)::int`,
      })
      .from(sandboxRuns)
      .where(eq(sandboxRuns.userId, userId))
      .groupBy(sandboxRuns.status, archived);

    return rows.map((row) => ({
      status: assertRunStatus(row.status, 'grouped'),
      archived: row.archived,
      count: Number(row.count ?? 0),
    }));
  }

  /** Newest tick across the owner's non-archived runs. */
  async lastTickAt(userId: string): Promise<Date | null> {
    const [row] = await this.db
      .select({ lastTickAt: sql<Date | null>`max(${sandboxRuns.lastTickAt})` })
      .from(sandboxRuns)
      .where(and(eq(sandboxRuns.userId, userId), isNull(sandboxRuns.archivedAt)));

    return row?.lastTickAt ? new Date(row.lastTickAt) : null;
  }

  /** All position projection rows, including closed zero tombstones. */
  async listPositions(runId: string): Promise<SandboxPositionRecord[]> {
    return this.db
      .select()
      .from(sandboxPositions)
      .where(eq(sandboxPositions.runId, runId))
      .orderBy(asc(sandboxPositions.tokenId));
  }

  /** Number of open positions without loading the projection rows. */
  async countOpenPositions(runId: string): Promise<number> {
    const [row] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(sandboxPositions)
      .where(and(eq(sandboxPositions.runId, runId), sql`${sandboxPositions.amount} > 0`));

    return Number(row?.count ?? 0);
  }

  async listTrades(runId: string, options: SandboxPageOptions = {}): Promise<SandboxTradeRecord[]> {
    return this.db
      .select()
      .from(sandboxTrades)
      .where(eq(sandboxTrades.runId, runId))
      .orderBy(desc(sandboxTrades.entryAt), asc(sandboxTrades.tradeId))
      .limit(options.limit ?? 100)
      .offset(options.offset ?? 0);
  }

  async countTrades(runId: string, status?: 'open' | 'closed'): Promise<number> {
    const conditions = [eq(sandboxTrades.runId, runId)];
    if (status !== undefined) conditions.push(eq(sandboxTrades.status, status));

    const [row] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(sandboxTrades)
      .where(and(...conditions));

    return Number(row?.count ?? 0);
  }

  async listIntents(
    runId: string,
    options: SandboxPageOptions = {},
  ): Promise<SandboxIntentRecord[]> {
    return this.db
      .select()
      .from(sandboxIntents)
      .where(eq(sandboxIntents.runId, runId))
      .orderBy(desc(sandboxIntents.decisionTime), asc(sandboxIntents.intentId))
      .limit(options.limit ?? 100)
      .offset(options.offset ?? 0);
  }

  async countIntents(runId: string, status?: string): Promise<number> {
    const conditions = [eq(sandboxIntents.runId, runId)];
    if (status !== undefined) conditions.push(eq(sandboxIntents.status, status));

    const [row] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(sandboxIntents)
      .where(and(...conditions));

    return Number(row?.count ?? 0);
  }

  /**
   * Terminal intent journal in emission order for the report. Pending intents
   * are not terminal records and are intentionally excluded; the journal
   * endpoint exposes them while a run is live.
   */
  async listTerminalIntents(runId: string): Promise<SandboxIntentRecord[]> {
    return this.db
      .select()
      .from(sandboxIntents)
      .where(
        and(
          eq(sandboxIntents.runId, runId),
          inArray(sandboxIntents.status, ['filled', 'partial', 'rejected', 'expired']),
        ),
      )
      .orderBy(asc(sandboxIntents.decisionTime), asc(sandboxIntents.intentId));
  }

  async listEquityPoints(
    runId: string,
    options: SandboxPageOptions = {},
  ): Promise<SandboxEquityPointRecord[]> {
    return this.db
      .select()
      .from(sandboxEquityPoints)
      .where(eq(sandboxEquityPoints.runId, runId))
      .orderBy(asc(sandboxEquityPoints.clockTime))
      .limit(options.limit ?? 500)
      .offset(options.offset ?? 0);
  }

  /** Every equity point in clock order, used by the deterministic report. */
  async listAllEquityPoints(runId: string): Promise<SandboxEquityPointRecord[]> {
    return this.db
      .select()
      .from(sandboxEquityPoints)
      .where(eq(sandboxEquityPoints.runId, runId))
      .orderBy(asc(sandboxEquityPoints.clockTime));
  }

  async countEquityPoints(runId: string): Promise<number> {
    const [row] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(sandboxEquityPoints)
      .where(eq(sandboxEquityPoints.runId, runId));

    return Number(row?.count ?? 0);
  }

  async countLedgerEntries(runId: string): Promise<number> {
    const [row] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(sandboxLedgerEntries)
      .where(eq(sandboxLedgerEntries.runId, runId));

    return Number(row?.count ?? 0);
  }

  /** Inserts a draft run. The token snapshot is frozen only at start. */
  async createRun(input: SandboxRunCreateInput): Promise<string> {
    const [row] = await this.db
      .insert(sandboxRuns)
      .values({
        userId: input.userId,
        name: input.name,
        status: 'draft',
        initialCapitalUsd: input.initialCapitalUsd,
        cashUsd: input.initialCapitalUsd,
        equityUsd: input.initialCapitalUsd,
        peakEquityUsd: input.initialCapitalUsd,
        dayStartEquityUsd: input.initialCapitalUsd,
        settings: input.settings,
        engineState: {},
        ledgerState: {},
      })
      .returning({ id: sandboxRuns.id });
    if (!row) throw new Error('Sandbox run insert returned no row');

    return row.id;
  }

  /**
   * Updates a draft run. The conditional write refuses a non-draft or archived
   * row so the service can return a precise conflict instead of overwriting a
   * running configuration.
   */
  async updateDraftRun(
    userId: string,
    runId: string,
    patch: SandboxRunDraftPatch,
  ): Promise<boolean> {
    const set: SandboxRunDraftPatch & { updatedAt: Date } = { updatedAt: new Date() };
    if (patch.name !== undefined) set.name = patch.name;
    if (patch.initialCapitalUsd !== undefined) {
      set.initialCapitalUsd = patch.initialCapitalUsd;
    }
    if (patch.settings !== undefined) set.settings = patch.settings;

    const rows = await this.db
      .update(sandboxRuns)
      .set({
        ...set,
        ...(patch.initialCapitalUsd === undefined
          ? {}
          : {
              cashUsd: patch.initialCapitalUsd,
              equityUsd: patch.initialCapitalUsd,
              peakEquityUsd: patch.initialCapitalUsd,
              dayStartEquityUsd: patch.initialCapitalUsd,
            }),
      })
      .where(
        and(
          eq(sandboxRuns.id, runId),
          eq(sandboxRuns.userId, userId),
          eq(sandboxRuns.status, 'draft'),
          isNull(sandboxRuns.archivedAt),
        ),
      )
      .returning({ id: sandboxRuns.id });

    return rows.length > 0;
  }

  /**
   * Freezes the config/token snapshot, initializes the ledger and `{tokens:{}}`
   * engine state, and flips a draft to running in one transaction.
   */
  async startRun(userId: string, runId: string, input: SandboxRunStartInput): Promise<boolean> {
    return this.db.transaction(async (tx) => {
      const [row] = await tx
        .select({ id: sandboxRuns.id })
        .from(sandboxRuns)
        .where(
          and(
            eq(sandboxRuns.id, runId),
            eq(sandboxRuns.userId, userId),
            eq(sandboxRuns.status, 'draft'),
            isNull(sandboxRuns.archivedAt),
          ),
        )
        .for('update');
      if (!row) return false;

      if (input.tokens.length > 0) {
        await tx
          .insert(sandboxRunTokens)
          .values(input.tokens.map((token) => ({ runId, ...token })))
          .onConflictDoNothing();
      }

      const now = new Date();
      await tx
        .update(sandboxRuns)
        .set({
          status: 'running',
          settings: input.config,
          engineState: input.engineState,
          ledgerState: input.ledgerState,
          initialCapitalUsd: input.initialCapitalUsd,
          cashUsd: input.initialCapitalUsd,
          equityUsd: input.initialCapitalUsd,
          peakEquityUsd: input.initialCapitalUsd,
          dayStartEquityUsd: input.initialCapitalUsd,
          lastBarClose: null,
          lastTickAt: null,
          startedAt: now,
          pausedAt: null,
          stoppedAt: null,
          archivedAt: null,
          error: null,
          updatedAt: now,
        })
        .where(eq(sandboxRuns.id, runId));

      return true;
    });
  }

  /** Applies one lifecycle transition; returns false when the row moved on. */
  async transitionRun(
    userId: string,
    runId: string,
    from: readonly string[],
    patch: SandboxRunTransitionPatch,
  ): Promise<boolean> {
    const rows = await this.db
      .update(sandboxRuns)
      .set({ ...patch, updatedAt: new Date() })
      .where(
        and(
          eq(sandboxRuns.id, runId),
          eq(sandboxRuns.userId, userId),
          inArray(sandboxRuns.status, [...from]),
          isNull(sandboxRuns.archivedAt),
        ),
      )
      .returning({ id: sandboxRuns.id });

    return rows.length > 0;
  }

  /**
   * Conditionally transitions a run and expires its pending intents in one
   * transaction, so a stopped/paused transition can never leave a pending row
   * behind if the second write fails.
   */
  async transitionRunAndExpire(
    userId: string,
    runId: string,
    from: readonly string[],
    patch: SandboxRunTransitionPatch,
    reasonText: string,
    at: Date = new Date(),
  ): Promise<{ expiredIntents: number } | null> {
    return this.db.transaction(async (tx) => {
      const rows = await tx
        .update(sandboxRuns)
        .set({ ...patch, updatedAt: at })
        .where(
          and(
            eq(sandboxRuns.id, runId),
            eq(sandboxRuns.userId, userId),
            inArray(sandboxRuns.status, [...from]),
            isNull(sandboxRuns.archivedAt),
          ),
        )
        .returning({ id: sandboxRuns.id });
      if (rows.length === 0) return null;

      const expiredIntents = await expirePendingIntentsWith(tx, runId, reasonText, at);
      return { expiredIntents };
    });
  }

  /**
   * Soft-hides a terminal run and expires its pending intents in one
   * transaction; no row is ever deleted.
   */
  async archiveRunAndExpire(
    userId: string,
    runId: string,
    reasonText: string,
    at: Date = new Date(),
  ): Promise<{ archivedAt: Date; expiredIntents: number } | null> {
    return this.db.transaction(async (tx) => {
      const rows = await tx
        .update(sandboxRuns)
        .set({ archivedAt: at, updatedAt: at })
        .where(
          and(
            eq(sandboxRuns.id, runId),
            eq(sandboxRuns.userId, userId),
            inArray(sandboxRuns.status, ['stopped', 'failed']),
            isNull(sandboxRuns.archivedAt),
          ),
        )
        .returning({ id: sandboxRuns.id });
      if (rows.length === 0) return null;

      const expiredIntents = await expirePendingIntentsWith(tx, runId, reasonText, at);
      return { archivedAt: at, expiredIntents };
    });
  }

  /** Runs the live scheduler may advance: running and not archived. */
  async listRunningRuns(): Promise<Array<{ id: string; userId: string }>> {
    return this.db
      .select({ id: sandboxRuns.id, userId: sandboxRuns.userId })
      .from(sandboxRuns)
      .where(and(eq(sandboxRuns.status, 'running'), isNull(sandboxRuns.archivedAt)))
      .orderBy(asc(sandboxRuns.createdAt));
  }

  /**
   * Locks the run row for the tick transaction and returns its live lifecycle
   * fields. A concurrent pause/stop acquired first is observed here, so a tick
   * that started from a stale snapshot cannot overwrite it back to running.
   */
  async lockRunForTick(
    executor: DbTransaction,
    runId: string,
  ): Promise<{ status: string; archivedAt: Date | null; lastBarClose: Date | null } | null> {
    const [row] = await executor
      .select({
        status: sandboxRuns.status,
        archivedAt: sandboxRuns.archivedAt,
        lastBarClose: sandboxRuns.lastBarClose,
      })
      .from(sandboxRuns)
      .where(eq(sandboxRuns.id, runId))
      .for('update');

    return row ?? null;
  }

  /** Updates `last_tick_at` for a tick that found no new closed bar. */
  async touchRunTick(runId: string, at: Date): Promise<void> {
    await this.db
      .update(sandboxRuns)
      .set({ lastTickAt: at, updatedAt: at })
      .where(and(eq(sandboxRuns.id, runId), eq(sandboxRuns.status, 'running')));
  }

  /**
   * Marks a run failed after a data/engine/reconciliation error. The runner is
   * the only caller; the state is not advanced on the failing tick.
   */
  async markRunFailed(runId: string, error: string): Promise<void> {
    const now = new Date();
    await this.db
      .update(sandboxRuns)
      .set({ status: 'failed', error: error.slice(0, 1000), updatedAt: now })
      .where(and(eq(sandboxRuns.id, runId), eq(sandboxRuns.status, 'running')));
  }

  /**
   * Loads the closed 1h candle series for the run universe.
   *
   * Each token is read newest-first with a bounded `LIMIT`, then reversed to the
   * ascending order the core expects. This avoids reading the whole retained
   * history into memory; the default window is 180 days plus one bar.
   */
  async loadCandles(
    tokenKeys: readonly string[],
    timeframe: string = SANDBOX_TIMEFRAME,
    limitPerToken = SANDBOX_CANDLE_READ_LIMIT,
  ): Promise<Candle[]> {
    const unique = [...new Set(tokenKeys)];
    if (unique.length === 0) return [];

    const candles: Candle[] = [];
    for (const tokenKey of unique) {
      const rows = await this.db
        .select({
          openTime: sandboxCandles.openTime,
          open: sandboxCandles.open,
          high: sandboxCandles.high,
          low: sandboxCandles.low,
          close: sandboxCandles.close,
          volumeUsd: sandboxCandles.volumeUsd,
        })
        .from(sandboxCandles)
        .where(and(eq(sandboxCandles.timeframe, timeframe), eq(sandboxCandles.tokenKey, tokenKey)))
        .orderBy(desc(sandboxCandles.openTime))
        .limit(limitPerToken);

      for (const row of rows.reverse()) {
        candles.push({
          tokenId: tokenKey,
          timeframe,
          openTime: row.openTime.getTime(),
          open: row.open,
          high: row.high,
          low: row.low,
          close: row.close,
          volumeUsd: row.volumeUsd,
        });
      }
    }

    return candles;
  }

  /** Pending live-paper intents for one run, oldest first. */
  async listPendingIntents(
    runId: string,
    executor: DbExecutor = this.db,
  ): Promise<SandboxPendingIntent[]> {
    const rows = await executor
      .select()
      .from(sandboxIntents)
      .where(and(eq(sandboxIntents.runId, runId), eq(sandboxIntents.status, 'pending')))
      .orderBy(asc(sandboxIntents.decisionTime), asc(sandboxIntents.intentId));

    return rows.map((row) => ({
      runId: row.runId,
      intentId: row.intentId,
      tokenId: row.tokenId,
      side: row.side === 'sell' ? 'sell' : 'buy',
      strategyKey: row.strategyKey as StrategyKey,
      strategyVersion: row.strategyVersion,
      requestedUsd: row.requestedUsd,
      requestedAmount: row.requestedAmount,
      priceUsd: row.priceUsd,
      stopLossPct: row.stopLossPct,
      takeProfitPct: row.takeProfitPct,
      strategyReasonCode: row.strategyReasonCode ?? Reason.INTENT_PENDING,
      reasonText: row.reasonText,
      decisionTime: row.decisionTime,
    }));
  }

  /**
   * Inserts the intents a decision queued for the next tick. Pending rows are
   * updated in place by `persistTickInTransaction` when they resolve.
   */
  async insertPendingIntents(
    executor: DbTransaction,
    runId: string,
    intents: readonly OrderIntent[],
  ): Promise<number> {
    if (intents.length === 0) return 0;

    const rows = await executor
      .insert(sandboxIntents)
      .values(
        intents.map((intent) => ({
          runId,
          intentId: intent.intentId,
          tokenId: intent.tokenId,
          side: intent.side,
          strategyKey: intent.strategyKey,
          strategyVersion: intent.strategyVersion,
          status: 'pending',
          requestedUsd: intent.side === 'buy' ? intent.sizeUsd : null,
          requestedAmount: intent.side === 'sell' ? intent.amount : null,
          filledUsd: '0.00',
          filledAmount: '0.00000000',
          priceUsd: intent.decisionPriceUsd,
          stopLossPct: intent.stopLossPct,
          takeProfitPct: intent.takeProfitPct,
          feeUsd: '0.00',
          reasonCode: Reason.INTENT_PENDING,
          strategyReasonCode: intent.reasonCode,
          reasonText: `Queued ${intent.side} intent for ${intent.tokenId} at the next live tick`,
          decisionTime: new Date(intent.clockTime),
          fillTime: null,
        })),
      )
      // The partial unique index on pending (run, token, side) is the last guard
      // against a duplicate close or a second pending intent for the same side.
      .onConflictDoNothing()
      .returning({ intentId: sandboxIntents.intentId });

    return rows.length;
  }

  /** True when a manual or strategy sell is already queued for the token. */
  async hasPendingSell(runId: string, tokenId: string): Promise<boolean> {
    const [row] = await this.db
      .select({ intentId: sandboxIntents.intentId })
      .from(sandboxIntents)
      .where(
        and(
          eq(sandboxIntents.runId, runId),
          eq(sandboxIntents.tokenId, tokenId),
          eq(sandboxIntents.side, 'sell'),
          eq(sandboxIntents.status, 'pending'),
        ),
      )
      .limit(1);

    return row !== undefined;
  }

  /**
   * Inserts one owner-requested manual close as a pending sell intent.
   *
   * Returns `false` when the pending partial unique index rejects it, so a
   * concurrent second close cannot queue a duplicate.
   */
  async insertManualCloseIntent(runId: string, intent: OrderIntent): Promise<boolean> {
    const rows = await this.db
      .insert(sandboxIntents)
      .values({
        runId,
        intentId: intent.intentId,
        tokenId: intent.tokenId,
        side: 'sell',
        strategyKey: intent.strategyKey,
        strategyVersion: intent.strategyVersion,
        status: 'pending',
        requestedUsd: null,
        requestedAmount: intent.amount,
        filledUsd: '0.00',
        filledAmount: '0.00000000',
        priceUsd: null,
        stopLossPct: null,
        takeProfitPct: null,
        feeUsd: '0.00',
        reasonCode: Reason.INTENT_PENDING,
        strategyReasonCode: Reason.MANUAL_CLOSE,
        reasonText: `Owner requested a manual close of ${intent.tokenId}; the next tick sells at the live quote`,
        decisionTime: new Date(intent.clockTime),
        fillTime: null,
      })
      .onConflictDoNothing()
      .returning({ intentId: sandboxIntents.intentId });

    return rows.length > 0;
  }

  /**
   * Terminates every still-pending intent for a run when it stops, fails or is
   * archived, so the journal never keeps a stale `pending` row. The row itself is
   * the terminal journal record; no DELETE occurs.
   */
  async expirePendingIntents(
    runId: string,
    reasonText: string,
    at: Date = new Date(),
  ): Promise<number> {
    return expirePendingIntentsWith(this.db, runId, reasonText, at);
  }

  /**
   * Runs one tick in a single transaction: loads the validated run state and
   * verified event log, lets the caller decide/append events, then persists the
   * resulting state and projections. Any thrown error rolls back events, state
   * and projections together.
   */
  async commitTick(
    runId: string,
    work: (session: SandboxTickSession) => Promise<SandboxTickInput>,
  ): Promise<SandboxTickSummary> {
    return this.db.transaction(async (tx) => {
      const run = await this.loadRun(runId, tx);
      if (!run) {
        throw new SandboxPersistenceError(
          'SANDBOX_RUN_NOT_FOUND',
          `Sandbox run ${runId} does not exist`,
        );
      }
      const eventLog = await SandboxEventLog.load(tx, runId);
      const tick = await work({ tx, run, eventLog });
      return this.persistTickInTransaction(tx, runId, tick);
    });
  }

  /**
   * Persists one tick in its own transaction.
   *
   * Use `commitTick` when the tick also appends events, so the event rows and
   * the run state commit atomically.
   */
  async persistTick(runId: string, tick: SandboxTickInput): Promise<SandboxTickSummary> {
    return this.db.transaction((tx) => this.persistTickInTransaction(tx, runId, tick));
  }

  /**
   * Writes run state and every query projection inside the caller's
   * transaction. Events are written by `SandboxEventLog` in the same
   * transaction; this method persists the post-append `eventSeq`/`eventHash`
   * head explicitly and never invents a chain.
   */
  async persistTickInTransaction(
    executor: DbTransaction,
    runId: string,
    tick: SandboxTickInput,
  ): Promise<SandboxTickSummary> {
    assertSandboxTickInput(tick);
    assertSandboxTickConsistency(tick);
    const engineState = parseEngineState(tick.engineState);
    const ledgerState = parsePaperLedgerState(tick.ledgerState);

    const [head] = await executor
      .select({ eventSeq: sandboxRuns.eventSeq, eventHash: sandboxRuns.eventHash })
      .from(sandboxRuns)
      .where(eq(sandboxRuns.id, runId))
      .limit(1);
    if (!head) {
      throw new SandboxPersistenceError(
        'SANDBOX_RUN_NOT_FOUND',
        `Sandbox run ${runId} does not exist`,
      );
    }

    const now = new Date();
    await executor
      .update(sandboxRuns)
      .set({
        status: tick.status,
        cashUsd: tick.cashUsd,
        equityUsd: tick.equityUsd,
        peakEquityUsd: tick.peakEquityUsd,
        dayStartEquityUsd: tick.dayStartEquityUsd,
        engineState: jsonObject(engineState),
        ledgerState: jsonObject(ledgerState),
        lastBarClose: tick.lastBarClose,
        eventSeq: head.eventSeq,
        eventHash: head.eventHash,
        lastTickAt: tick.lastTickAt,
        error: tick.error ?? null,
        updatedAt: now,
      })
      .where(eq(sandboxRuns.id, runId));

    const positionRows = buildSandboxPositionRows(
      runId,
      ledgerState,
      tick.markedPositions,
      tick.marks,
    );
    if (positionRows.length > 0) {
      await executor
        .insert(sandboxPositions)
        .values(positionRows.map((row) => ({ ...row, updatedAt: now })))
        .onConflictDoUpdate({
          target: [sandboxPositions.runId, sandboxPositions.tokenId],
          set: {
            strategyKey: sql`excluded."strategy_key"`,
            strategyVersion: sql`excluded."strategy_version"`,
            amount: sql`excluded."amount"`,
            avgCostUsd: sql`excluded."avg_cost_usd"`,
            costBasisUsd: sql`excluded."cost_basis_usd"`,
            marketPriceUsd: sql`excluded."market_price_usd"`,
            marketValueUsd: sql`excluded."market_value_usd"`,
            openedAt: sql`excluded."opened_at"`,
            stopLossPct: sql`excluded."stop_loss_pct"`,
            takeProfitPct: sql`excluded."take_profit_pct"`,
            entryIntentId: sql`excluded."entry_intent_id"`,
            feesPaidUsd: sql`excluded."fees_paid_usd"`,
            updatedAt: sql`excluded."updated_at"`,
          },
        });
    }

    // Delete-free close: a position the ledger no longer holds keeps its row as
    // a zero-amount tombstone, so the projection never leaks a stale position.
    const existingPositions = await executor
      .select({ tokenId: sandboxPositions.tokenId })
      .from(sandboxPositions)
      .where(eq(sandboxPositions.runId, runId));
    const closedTokenIds = buildSandboxClosedPositionTokenIds(
      existingPositions.map((row) => row.tokenId),
      positionRows.map((row) => row.tokenId),
    );
    if (closedTokenIds.length > 0) {
      await executor
        .update(sandboxPositions)
        .set({
          // A zero position must not advertise a stop, take-profit, mark or
          // fee; the row is a delete-free "closed" marker only.
          amount: '0.00000000',
          avgCostUsd: '0.000000000000000000',
          costBasisUsd: '0.00',
          marketPriceUsd: '0.000000000000000000',
          marketValueUsd: '0.00',
          stopLossPct: null,
          takeProfitPct: null,
          feesPaidUsd: '0.00',
          updatedAt: now,
        })
        .where(
          and(eq(sandboxPositions.runId, runId), inArray(sandboxPositions.tokenId, closedTokenIds)),
        );
    }

    const tradeRows = buildSandboxTradeRows(runId, ledgerState);
    if (tradeRows.length > 0) {
      await executor
        .insert(sandboxTrades)
        .values(tradeRows.map((row) => ({ ...row, updatedAt: now })))
        .onConflictDoUpdate({
          target: [sandboxTrades.runId, sandboxTrades.tradeId],
          set: {
            tokenId: sql`excluded."token_id"`,
            strategyKey: sql`excluded."strategy_key"`,
            strategyVersion: sql`excluded."strategy_version"`,
            entryAt: sql`excluded."entry_at"`,
            entryPriceUsd: sql`excluded."entry_price_usd"`,
            entryAmount: sql`excluded."entry_amount"`,
            entryNotionalUsd: sql`excluded."entry_notional_usd"`,
            entryFeeUsd: sql`excluded."entry_fee_usd"`,
            entryCostBasisUsd: sql`excluded."entry_cost_basis_usd"`,
            entryIntentId: sql`excluded."entry_intent_id"`,
            exitAt: sql`excluded."exit_at"`,
            exitPriceUsd: sql`excluded."exit_price_usd"`,
            exitAmount: sql`excluded."exit_amount"`,
            exitNotionalUsd: sql`excluded."exit_notional_usd"`,
            exitFeeUsd: sql`excluded."exit_fee_usd"`,
            exitReasonCode: sql`excluded."exit_reason_code"`,
            exitIntentId: sql`excluded."exit_intent_id"`,
            realizedPnlUsd: sql`excluded."realized_pnl_usd"`,
            status: sql`excluded."status"`,
            updatedAt: sql`excluded."updated_at"`,
          },
        });
    }

    // The ledger is append-only: re-persisting an existing sequence is a no-op
    // and never overwrites a booked entry.
    const [ledgerHead] = await executor
      .select({
        sequence: sandboxLedgerEntries.sequence,
        entryId: sandboxLedgerEntries.entryId,
      })
      .from(sandboxLedgerEntries)
      .where(eq(sandboxLedgerEntries.runId, runId))
      .orderBy(desc(sandboxLedgerEntries.sequence))
      .limit(1);
    const lastSequence = ledgerHead?.sequence ?? 0;
    if (ledgerHead) {
      // A restored-older ledger (or a divergent entry id) cannot be projected
      // onto a newer journal: appending would silently fork the run history.
      const persistedHead = ledgerState.entries.find(
        (entry) => entry.sequence === ledgerHead.sequence,
      );
      if (!persistedHead || persistedHead.entryId !== ledgerHead.entryId) {
        throw new SandboxPersistenceError(
          'SANDBOX_STATE_INVALID',
          `Sandbox run ${runId} ledger state does not contain persisted entry ` +
            `${ledgerHead.entryId}#${ledgerHead.sequence}; refusing to project a restored-older ledger`,
        );
      }
    }
    const entryRows = buildSandboxLedgerEntryRows(runId, ledgerState).filter(
      (row) => row.sequence > lastSequence,
    );
    if (entryRows.length > 0) {
      await executor
        .insert(sandboxLedgerEntries)
        .values(entryRows)
        .onConflictDoNothing({
          target: [sandboxLedgerEntries.runId, sandboxLedgerEntries.sequence],
        });
    }

    const intentRows = buildSandboxIntentRows(runId, tick.intents);
    if (intentRows.length > 0) {
      await executor
        .insert(sandboxIntents)
        .values(intentRows)
        .onConflictDoUpdate({
          target: [sandboxIntents.runId, sandboxIntents.intentId],
          set: {
            tokenId: sql`excluded."token_id"`,
            side: sql`excluded."side"`,
            strategyKey: sql`excluded."strategy_key"`,
            strategyVersion: sql`excluded."strategy_version"`,
            status: sql`excluded."status"`,
            requestedUsd: sql`excluded."requested_usd"`,
            requestedAmount: sql`excluded."requested_amount"`,
            filledUsd: sql`excluded."filled_usd"`,
            filledAmount: sql`excluded."filled_amount"`,
            priceUsd: sql`excluded."price_usd"`,
            feeUsd: sql`excluded."fee_usd"`,
            reasonCode: sql`excluded."reason_code"`,
            strategyReasonCode: sql`excluded."strategy_reason_code"`,
            reasonText: sql`excluded."reason_text"`,
            decisionTime: sql`excluded."decision_time"`,
            fillTime: sql`excluded."fill_time"`,
          },
        });
    }

    const equityRow = buildSandboxEquityPointRow(runId, tick.equityPoint);
    await executor
      .insert(sandboxEquityPoints)
      .values(equityRow)
      .onConflictDoUpdate({
        target: [sandboxEquityPoints.runId, sandboxEquityPoints.clockTime],
        set: {
          equityUsd: sql`excluded."equity_usd"`,
          cashUsd: sql`excluded."cash_usd"`,
          positionsValueUsd: sql`excluded."positions_value_usd"`,
          drawdownPct: sql`excluded."drawdown_pct"`,
        },
      });

    return {
      eventSeq: head.eventSeq,
      eventHash: head.eventHash,
      positions: positionRows.length,
      trades: tradeRows.length,
      ledgerEntries: entryRows.length,
      intents: intentRows.length,
    };
  }
}

/**
 * Expires every still-pending intent for a run on the supplied executor. Kept
 * transaction-capable so stop/archive can combine it with the status write.
 */
async function expirePendingIntentsWith(
  executor: DbExecutor,
  runId: string,
  reasonText: string,
  at: Date,
): Promise<number> {
  const rows = await executor
    .update(sandboxIntents)
    .set({
      status: 'expired',
      reasonCode: Reason.FILL_EXPIRED,
      reasonText,
      fillTime: at,
    })
    .where(and(eq(sandboxIntents.runId, runId), eq(sandboxIntents.status, 'pending')))
    .returning({ intentId: sandboxIntents.intentId });

  return rows.length;
}

/** Session handed to `commitTick`; the log is bound to the tick transaction. */
export interface SandboxTickSession {
  readonly tx: DbTransaction;
  readonly run: SandboxRunSnapshot;
  readonly eventLog: SandboxEventLog;
}

/**
 * JSONB columns are declared as `Record<string, unknown>`; the validated core
 * state types are structurally JSON objects but are interfaces without an index
 * signature, so the cast is limited to this boundary.
 */
function jsonObject(value: object): Record<string, unknown> {
  return value as unknown as Record<string, unknown>;
}

/** Rejects an unknown persisted run status instead of presenting it as valid. */
function assertRunStatus(value: string, runId: string): SandboxRunStatus {
  if (!isSandboxRunStatus(value)) {
    throw new SandboxPersistenceError(
      'SANDBOX_STATE_INVALID',
      `Sandbox run ${runId} has an unknown status "${value}"`,
    );
  }
  return value;
}

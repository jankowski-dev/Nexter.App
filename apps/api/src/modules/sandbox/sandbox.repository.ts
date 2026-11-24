import { Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
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
} from '@nexter/db';
import { SANDBOX_TIMEFRAME } from '@nexter/contracts';
import {
  Reason,
  type Candle,
  type OrderIntent,
  type SandboxEvent,
  type StrategyKey,
} from '@nexter/sandbox-core';
import { DB } from '../../shared/db/db.module';
import { listSandboxEvents, SandboxEventLog } from './sandbox-event-log';
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
  type SandboxTickInput,
  type SandboxTickSummary,
} from './sandbox.types';

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

  /** Soft-hides a terminal run; no row is ever deleted. */
  async archiveRun(userId: string, runId: string): Promise<boolean> {
    const now = new Date();
    const rows = await this.db
      .update(sandboxRuns)
      .set({ archivedAt: now, updatedAt: now })
      .where(
        and(
          eq(sandboxRuns.id, runId),
          eq(sandboxRuns.userId, userId),
          inArray(sandboxRuns.status, ['stopped', 'failed']),
          isNull(sandboxRuns.archivedAt),
        ),
      )
      .returning({ id: sandboxRuns.id });

    return rows.length > 0;
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

  /** Loads the closed 1h candle series for the run universe. */
  async loadCandles(
    tokenKeys: readonly string[],
    timeframe: string = SANDBOX_TIMEFRAME,
    limitPerToken = 5000,
  ): Promise<Candle[]> {
    const unique = [...new Set(tokenKeys)];
    if (unique.length === 0) return [];

    const rows = await this.db
      .select({
        tokenKey: sandboxCandles.tokenKey,
        openTime: sandboxCandles.openTime,
        open: sandboxCandles.open,
        high: sandboxCandles.high,
        low: sandboxCandles.low,
        close: sandboxCandles.close,
        volumeUsd: sandboxCandles.volumeUsd,
      })
      .from(sandboxCandles)
      .where(and(eq(sandboxCandles.timeframe, timeframe), inArray(sandboxCandles.tokenKey, unique)))
      .orderBy(asc(sandboxCandles.tokenKey), asc(sandboxCandles.openTime));

    const byToken = new Map<string, Candle[]>();
    for (const row of rows) {
      const list = byToken.get(row.tokenKey) ?? [];
      list.push({
        tokenId: row.tokenKey,
        timeframe,
        openTime: row.openTime.getTime(),
        open: row.open,
        high: row.high,
        low: row.low,
        close: row.close,
        volumeUsd: row.volumeUsd,
      });
      byToken.set(row.tokenKey, list);
    }

    return unique.flatMap((tokenKey) => {
      const list = byToken.get(tokenKey) ?? [];
      return list.slice(Math.max(0, list.length - limitPerToken));
    });
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

    await executor
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
          feeUsd: '0.00',
          reasonCode: Reason.INTENT_PENDING,
          strategyReasonCode: intent.reasonCode,
          reasonText: `Queued ${intent.side} intent for ${intent.tokenId} at the next live tick`,
          decisionTime: new Date(intent.clockTime),
          fillTime: null,
        })),
      )
      .onConflictDoNothing({ target: [sandboxIntents.runId, sandboxIntents.intentId] });

    return intents.length;
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

  /** Inserts one owner-requested manual close as a pending sell intent. */
  async insertManualCloseIntent(runId: string, intent: OrderIntent): Promise<void> {
    await this.db
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
        feeUsd: '0.00',
        reasonCode: Reason.INTENT_PENDING,
        strategyReasonCode: Reason.MANUAL_CLOSE,
        reasonText: `Owner requested a manual close of ${intent.tokenId}; the next tick sells at the live quote`,
        decisionTime: new Date(intent.clockTime),
        fillTime: null,
      })
      .onConflictDoNothing({ target: [sandboxIntents.runId, sandboxIntents.intentId] });
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

    const positionRows = buildSandboxPositionRows(runId, ledgerState, tick.markedPositions);
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

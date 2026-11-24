import { Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
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
import type { SandboxEvent } from '@nexter/sandbox-core';
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

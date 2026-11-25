import { Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, gte, inArray, isNull, lt, sql } from 'drizzle-orm';
import {
  sandboxCandles,
  sandboxReplays,
  type Database,
  type SandboxReplayRecord,
} from '@nexter/db';
import {
  SANDBOX_TIMEFRAME,
  type SandboxReplayPeriod,
  type SandboxReplayStatus,
} from '@nexter/contracts';
import type { Candle } from '@nexter/sandbox-core';
import { DB } from '../../shared/db/db.module';
import { SANDBOX_REPLAY_PREFIX_DAYS } from './sandbox-replay.coverage';

const REPLAY_STATUSES = [
  'queued',
  'running',
  'completed',
  'failed',
  'cancelled',
] as const satisfies readonly SandboxReplayStatus[];

export interface SandboxReplayListOptions {
  status?: SandboxReplayStatus;
  includeArchived?: boolean;
  limit?: number;
  offset?: number;
}

export interface SandboxReplayCreateInput {
  userId: string;
  name: string;
  tokenKeys: readonly string[];
  periodDays: SandboxReplayPeriod;
  fromTime: Date;
  toTime: Date;
  initialCapitalUsd: string;
  seed: number;
  settings: Record<string, unknown>;
  paper: Record<string, unknown>;
  queuedAt: Date;
}

/** Owner read row without the (potentially large) report/candle snapshot. */
export interface SandboxReplaySummaryRecord {
  readonly id: string;
  readonly name: string;
  readonly status: SandboxReplayStatus;
  readonly tokenKeys: string[];
  readonly periodDays: number;
  readonly fromTime: Date;
  readonly toTime: Date;
  readonly initialCapitalUsd: string;
  readonly finalEquityUsd: string | null;
  readonly returnPct: string | null;
  readonly maxDrawdownPct: string | null;
  readonly reportHash: string | null;
  readonly error: string | null;
  readonly queuedAt: Date;
  readonly startedAt: Date | null;
  readonly finishedAt: Date | null;
  readonly archivedAt: Date | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/** Detail row with the frozen config/identity fields (never the report body). */
export interface SandboxReplayDetailRecord extends SandboxReplaySummaryRecord {
  readonly settings: Record<string, unknown>;
  readonly paper: Record<string, unknown>;
  readonly seed: number;
  readonly eventCount: number | null;
  readonly eventHash: string | null;
  readonly dataSnapshotId: string | null;
  readonly candleSnapshotHash: string | null;
}

/**
 * Worker-facing claim row: the frozen config/identity, the owner and any
 * already persisted gzip candle snapshot (so a requeued run reuses its input).
 */
export interface SandboxReplayWorkerRecord extends SandboxReplayDetailRecord {
  readonly userId: string;
  readonly candleSnapshot: Buffer | null;
}

/**
 * Owner-facing report read: the detail identity plus the stored `RunReport`
 * JSONB. The report is the only large field here; the candle snapshot stays out
 * of this selection and is never read on a GET.
 */
export interface SandboxReplayReportRecord extends SandboxReplayDetailRecord {
  readonly report: Record<string, unknown> | null;
}

/** Owner-facing chart source: the detail/report row plus its exact input snapshot. */
export interface SandboxReplayChartSource {
  readonly replay: SandboxReplayReportRecord;
  readonly candleSnapshot: Buffer | null;
}

export interface SandboxReplaySnapshotWrite {
  readonly dataSnapshotId: string;
  readonly candleSnapshot: Buffer;
  readonly candleSnapshotHash: string;
  readonly at: Date;
}

export interface SandboxReplayReportWrite {
  readonly report: Record<string, unknown>;
  readonly reportHash: string;
  readonly eventCount: number;
  readonly eventHash: string;
  readonly dataSnapshotId: string;
  readonly candleSnapshot: Buffer;
  readonly candleSnapshotHash: string;
  readonly at: Date;
}

/** Per-token 1h candle read cap: 180 days plus one bar. */
export const SANDBOX_REPLAY_CANDLE_LIMIT = SANDBOX_REPLAY_PREFIX_DAYS * 24 + 1;

/** Report-derived summary fields; absent until the worker completes. */
const reportMetrics = {
  finalEquityUsd: sql<string | null>`${sandboxReplays.report}->'metrics'->>'finalEquityUsd'`,
  returnPct: sql<string | null>`${sandboxReplays.report}->'metrics'->>'totalReturnPct'`,
  maxDrawdownPct: sql<string | null>`${sandboxReplays.report}->'metrics'->>'maxDrawdownPct'`,
};

const summarySelection = {
  id: sandboxReplays.id,
  name: sandboxReplays.name,
  status: sandboxReplays.status,
  tokenKeys: sandboxReplays.tokenKeys,
  periodDays: sandboxReplays.periodDays,
  fromTime: sandboxReplays.fromTime,
  toTime: sandboxReplays.toTime,
  initialCapitalUsd: sandboxReplays.initialCapitalUsd,
  ...reportMetrics,
  reportHash: sandboxReplays.reportHash,
  error: sandboxReplays.error,
  queuedAt: sandboxReplays.queuedAt,
  startedAt: sandboxReplays.startedAt,
  finishedAt: sandboxReplays.finishedAt,
  archivedAt: sandboxReplays.archivedAt,
  createdAt: sandboxReplays.createdAt,
  updatedAt: sandboxReplays.updatedAt,
};

const detailSelection = {
  ...summarySelection,
  settings: sandboxReplays.settings,
  paper: sandboxReplays.paper,
  seed: sandboxReplays.seed,
  eventCount: sandboxReplays.eventCount,
  eventHash: sandboxReplays.eventHash,
  dataSnapshotId: sandboxReplays.dataSnapshotId,
  candleSnapshotHash: sandboxReplays.candleSnapshotHash,
};

/** Claim selection: detail plus owner scope and the stored snapshot bytes. */
const workerSelection = {
  ...detailSelection,
  userId: sandboxReplays.userId,
  candleSnapshot: sandboxReplays.candleSnapshot,
};

/** Report read selection: detail identity plus the stored report JSONB. */
const reportSelection = {
  ...detailSelection,
  report: sandboxReplays.report,
};

/** Chart read selection: detail, report and the persisted input snapshot. */
const chartSelection = {
  ...reportSelection,
  candleSnapshot: sandboxReplays.candleSnapshot,
};

/** Drizzle access for persisted historical replays. No DELETE is ever issued. */
@Injectable()
export class SandboxReplayRepository {
  constructor(@Inject(DB) private readonly db: Database) {}

  async createReplay(input: SandboxReplayCreateInput): Promise<SandboxReplayDetailRecord> {
    const [row] = await this.db
      .insert(sandboxReplays)
      .values({
        userId: input.userId,
        name: input.name,
        status: 'queued',
        tokenKeys: [...input.tokenKeys],
        periodDays: input.periodDays,
        fromTime: input.fromTime,
        toTime: input.toTime,
        initialCapitalUsd: input.initialCapitalUsd,
        seed: input.seed,
        settings: input.settings,
        paper: input.paper,
        queuedAt: input.queuedAt,
      })
      .returning();
    if (!row) throw new Error('Sandbox replay insert returned no row');

    return detailFromRecord(row);
  }

  async listReplays(
    userId: string,
    options: SandboxReplayListOptions = {},
  ): Promise<SandboxReplaySummaryRecord[]> {
    const conditions = [eq(sandboxReplays.userId, userId)];
    if (!options.includeArchived) conditions.push(isNull(sandboxReplays.archivedAt));
    if (options.status !== undefined) conditions.push(eq(sandboxReplays.status, options.status));

    const rows = await this.db
      .select(summarySelection)
      .from(sandboxReplays)
      .where(and(...conditions))
      .orderBy(desc(sandboxReplays.createdAt), asc(sandboxReplays.id))
      .limit(options.limit ?? 50)
      .offset(options.offset ?? 0);

    return rows.map(summaryFromRow);
  }

  async countReplays(
    userId: string,
    options: { status?: SandboxReplayStatus; includeArchived?: boolean } = {},
  ): Promise<number> {
    const conditions = [eq(sandboxReplays.userId, userId)];
    if (!options.includeArchived) conditions.push(isNull(sandboxReplays.archivedAt));
    if (options.status !== undefined) conditions.push(eq(sandboxReplays.status, options.status));

    const [row] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(sandboxReplays)
      .where(and(...conditions));

    return Number(row?.count ?? 0);
  }

  /** Owner-scoped detail; another owner's/unknown id is `null`. */
  async findReplay(userId: string, id: string): Promise<SandboxReplayDetailRecord | null> {
    const [row] = await this.db
      .select(detailSelection)
      .from(sandboxReplays)
      .where(and(eq(sandboxReplays.id, id), eq(sandboxReplays.userId, userId)))
      .limit(1);
    if (!row) return null;

    return detailFromRow(row);
  }

  /**
   * Owner-scoped read of the stored deterministic report.
   *
   * The report is never recomputed here: the worker already persisted it with
   * the snapshot and hashes, so a GET is a pure read of that JSONB.
   */
  async findReplayReport(userId: string, id: string): Promise<SandboxReplayReportRecord | null> {
    const [row] = await this.db
      .select(reportSelection)
      .from(sandboxReplays)
      .where(and(eq(sandboxReplays.id, id), eq(sandboxReplays.userId, userId)))
      .limit(1);
    if (!row) return null;

    return { ...detailFromRow(row), report: row.report ?? null };
  }

  /**
   * Owner-scoped chart source: the validated report row plus the gzip snapshot
   * used to draw the evaluation-window candles. Read-only; never recomputes or
   * writes the replay.
   */
  async findReplayChartSource(
    userId: string,
    id: string,
  ): Promise<SandboxReplayChartSource | null> {
    const [row] = await this.db
      .select(chartSelection)
      .from(sandboxReplays)
      .where(and(eq(sandboxReplays.id, id), eq(sandboxReplays.userId, userId)))
      .limit(1);
    if (!row) return null;

    return {
      replay: { ...detailFromRow(row), report: row.report ?? null },
      candleSnapshot: row.candleSnapshot ?? null,
    };
  }

  /** Queued -> cancelled only; returns false when the row moved on. */
  async cancelQueuedReplay(userId: string, id: string, at: Date): Promise<boolean> {
    const rows = await this.db
      .update(sandboxReplays)
      .set({ status: 'cancelled', finishedAt: at, updatedAt: at })
      .where(
        and(
          eq(sandboxReplays.id, id),
          eq(sandboxReplays.userId, userId),
          eq(sandboxReplays.status, 'queued'),
          isNull(sandboxReplays.archivedAt),
        ),
      )
      .returning({ id: sandboxReplays.id });

    return rows.length > 0;
  }

  /** Terminal replay -> soft archived only; no row is deleted. */
  async archiveReplay(userId: string, id: string, at: Date): Promise<boolean> {
    const rows = await this.db
      .update(sandboxReplays)
      .set({ archivedAt: at, updatedAt: at })
      .where(
        and(
          eq(sandboxReplays.id, id),
          eq(sandboxReplays.userId, userId),
          inArray(sandboxReplays.status, ['completed', 'failed', 'cancelled']),
          isNull(sandboxReplays.archivedAt),
        ),
      )
      .returning({ id: sandboxReplays.id });

    return rows.length > 0;
  }

  /**
   * Reads the oldest queued replay with `FOR UPDATE SKIP LOCKED`.
   *
   * The worker holds the replay advisory lock, so this is the single claimer;
   * the row lock + `markReplayRunning` let a concurrent owner cancel win before
   * execution starts instead of being overwritten.
   */
  async claimQueuedReplay(): Promise<SandboxReplayWorkerRecord | null> {
    const [row] = await this.db
      .select(workerSelection)
      .from(sandboxReplays)
      .where(and(eq(sandboxReplays.status, 'queued'), isNull(sandboxReplays.archivedAt)))
      .orderBy(asc(sandboxReplays.queuedAt), asc(sandboxReplays.createdAt), asc(sandboxReplays.id))
      .limit(1)
      .for('update', { skipLocked: true });
    if (!row) return null;

    return workerFromRow(row);
  }

  /**
   * Queued -> running with the start time. Returns false when the row moved on
   * (for example the owner cancelled it between claim and start).
   */
  async markReplayRunning(id: string, at: Date): Promise<boolean> {
    const rows = await this.db
      .update(sandboxReplays)
      .set({
        status: 'running',
        startedAt: at,
        finishedAt: null,
        error: null,
        updatedAt: at,
      })
      .where(
        and(
          eq(sandboxReplays.id, id),
          eq(sandboxReplays.status, 'queued'),
          isNull(sandboxReplays.archivedAt),
        ),
      )
      .returning({ id: sandboxReplays.id });

    return rows.length > 0;
  }

  /**
   * Persists the exact gzip input snapshot before the run starts. A restart
   * therefore re-runs the same candles even after `sandbox_candles` changes.
   */
  async storeReplaySnapshot(id: string, input: SandboxReplaySnapshotWrite): Promise<boolean> {
    const rows = await this.db
      .update(sandboxReplays)
      .set({
        dataSnapshotId: input.dataSnapshotId,
        candleSnapshot: input.candleSnapshot,
        candleSnapshotHash: input.candleSnapshotHash,
        updatedAt: input.at,
      })
      .where(and(eq(sandboxReplays.id, id), eq(sandboxReplays.status, 'running')))
      .returning({ id: sandboxReplays.id });

    return rows.length > 0;
  }

  /**
   * Stores the report, its identities and the input snapshot and marks the
   * replay completed in one statement/transaction.
   */
  async storeReplayReport(id: string, input: SandboxReplayReportWrite): Promise<boolean> {
    const rows = await this.db
      .update(sandboxReplays)
      .set({
        status: 'completed',
        report: input.report,
        reportHash: input.reportHash,
        eventCount: input.eventCount,
        eventHash: input.eventHash,
        dataSnapshotId: input.dataSnapshotId,
        candleSnapshot: input.candleSnapshot,
        candleSnapshotHash: input.candleSnapshotHash,
        error: null,
        finishedAt: input.at,
        updatedAt: input.at,
      })
      .where(and(eq(sandboxReplays.id, id), eq(sandboxReplays.status, 'running')))
      .returning({ id: sandboxReplays.id });

    return rows.length > 0;
  }

  /** Running -> failed with a sanitized error; the row is never deleted. */
  async markReplayFailed(id: string, error: string, at: Date): Promise<boolean> {
    const rows = await this.db
      .update(sandboxReplays)
      .set({
        status: 'failed',
        error: error.slice(0, 1000),
        finishedAt: at,
        updatedAt: at,
      })
      .where(and(eq(sandboxReplays.id, id), eq(sandboxReplays.status, 'running')))
      .returning({ id: sandboxReplays.id });

    return rows.length > 0;
  }

  /**
   * Restart recovery: every `running` row is returned to `queued` so the next
   * pass re-claims it. **Only** called while the replay advisory lock is held;
   * a row held by another live instance is therefore never requeued. The
   * snapshot is kept so the retry uses the same input.
   */
  async requeueRunningReplays(at: Date): Promise<Array<{ id: string; userId: string }>> {
    return this.db
      .update(sandboxReplays)
      .set({
        status: 'queued',
        startedAt: null,
        finishedAt: null,
        error: null,
        updatedAt: at,
      })
      .where(eq(sandboxReplays.status, 'running'))
      .returning({ id: sandboxReplays.id, userId: sandboxReplays.userId });
  }

  /**
   * Loads the exact replay data window from `sandbox_candles` only.
   *
   * `to` is exclusive (`openTime < to_time`), matching the half-open evaluation
   * window; `from` is the store's 180-day maximum. Each token is read
   * newest-first with a bounded limit and reversed to ascending order.
   */
  async loadReplayCandles(tokenKeys: readonly string[], from: Date, to: Date): Promise<Candle[]> {
    const unique = [...new Set(tokenKeys)];
    if (unique.length === 0 || from.getTime() >= to.getTime()) return [];

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
        .where(
          and(
            eq(sandboxCandles.timeframe, SANDBOX_TIMEFRAME),
            eq(sandboxCandles.tokenKey, tokenKey),
            gte(sandboxCandles.openTime, from),
            lt(sandboxCandles.openTime, to),
          ),
        )
        .orderBy(desc(sandboxCandles.openTime))
        .limit(SANDBOX_REPLAY_CANDLE_LIMIT);

      for (const row of rows.reverse()) {
        candles.push({
          tokenId: tokenKey,
          timeframe: SANDBOX_TIMEFRAME,
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
}

function summaryFromRow(row: {
  id: string;
  name: string;
  status: string;
  tokenKeys: string[];
  periodDays: number;
  fromTime: Date;
  toTime: Date;
  initialCapitalUsd: string;
  finalEquityUsd: string | null;
  returnPct: string | null;
  maxDrawdownPct: string | null;
  reportHash: string | null;
  error: string | null;
  queuedAt: Date;
  startedAt: Date | null;
  finishedAt: Date | null;
  archivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}): SandboxReplaySummaryRecord {
  return {
    id: row.id,
    name: row.name,
    status: assertReplayStatus(row.status, row.id),
    tokenKeys: [...row.tokenKeys],
    periodDays: row.periodDays,
    fromTime: row.fromTime,
    toTime: row.toTime,
    initialCapitalUsd: row.initialCapitalUsd,
    finalEquityUsd: row.finalEquityUsd,
    returnPct: row.returnPct,
    maxDrawdownPct: row.maxDrawdownPct,
    reportHash: row.reportHash,
    error: row.error,
    queuedAt: row.queuedAt,
    startedAt: row.startedAt,
    finishedAt: row.finishedAt,
    archivedAt: row.archivedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function detailFromRow(row: {
  id: string;
  name: string;
  status: string;
  tokenKeys: string[];
  periodDays: number;
  fromTime: Date;
  toTime: Date;
  initialCapitalUsd: string;
  finalEquityUsd: string | null;
  returnPct: string | null;
  maxDrawdownPct: string | null;
  reportHash: string | null;
  error: string | null;
  queuedAt: Date;
  startedAt: Date | null;
  finishedAt: Date | null;
  archivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  settings: Record<string, unknown>;
  paper: Record<string, unknown>;
  seed: number;
  eventCount: number | null;
  eventHash: string | null;
  dataSnapshotId: string | null;
  candleSnapshotHash: string | null;
}): SandboxReplayDetailRecord {
  return {
    ...summaryFromRow(row),
    settings: row.settings,
    paper: row.paper,
    seed: row.seed,
    eventCount: row.eventCount,
    eventHash: row.eventHash,
    dataSnapshotId: row.dataSnapshotId,
    candleSnapshotHash: row.candleSnapshotHash,
  };
}

/** Claim row (detail + owner + snapshot bytes) -> worker record. */
function workerFromRow(
  row: Parameters<typeof detailFromRow>[0] & {
    userId: string;
    candleSnapshot: Buffer | null;
  },
): SandboxReplayWorkerRecord {
  return {
    ...detailFromRow(row),
    userId: row.userId,
    candleSnapshot: row.candleSnapshot,
  };
}

/** Full insert row (includes the report) -> detail read shape. */
function detailFromRecord(row: SandboxReplayRecord): SandboxReplayDetailRecord {
  const metrics = reportMetricStrings(row.report);
  return {
    id: row.id,
    name: row.name,
    status: assertReplayStatus(row.status, row.id),
    tokenKeys: [...row.tokenKeys],
    periodDays: row.periodDays,
    fromTime: new Date(row.fromTime),
    toTime: new Date(row.toTime),
    initialCapitalUsd: row.initialCapitalUsd,
    finalEquityUsd: metrics.finalEquityUsd,
    returnPct: metrics.returnPct,
    maxDrawdownPct: metrics.maxDrawdownPct,
    reportHash: row.reportHash ?? null,
    error: row.error ?? null,
    queuedAt: new Date(row.queuedAt),
    startedAt: row.startedAt ? new Date(row.startedAt) : null,
    finishedAt: row.finishedAt ? new Date(row.finishedAt) : null,
    archivedAt: row.archivedAt ? new Date(row.archivedAt) : null,
    createdAt: new Date(row.createdAt),
    updatedAt: new Date(row.updatedAt),
    settings: row.settings,
    paper: row.paper,
    seed: row.seed,
    eventCount: row.eventCount ?? null,
    eventHash: row.eventHash ?? null,
    dataSnapshotId: row.dataSnapshotId ?? null,
    candleSnapshotHash: row.candleSnapshotHash ?? null,
  };
}

function reportMetricStrings(report: Record<string, unknown> | null): {
  finalEquityUsd: string | null;
  returnPct: string | null;
  maxDrawdownPct: string | null;
} {
  const metrics =
    report !== null && typeof report.metrics === 'object' && report.metrics !== null
      ? (report.metrics as Record<string, unknown>)
      : {};

  return {
    finalEquityUsd: decimalString(metrics.finalEquityUsd),
    returnPct: decimalString(metrics.totalReturnPct),
    maxDrawdownPct: decimalString(metrics.maxDrawdownPct),
  };
}

function decimalString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function assertReplayStatus(value: string, replayId: string): SandboxReplayStatus {
  if (!(REPLAY_STATUSES as readonly string[]).includes(value)) {
    throw new Error(`Sandbox replay ${replayId} has an unknown status "${value}"`);
  }
  return value as SandboxReplayStatus;
}

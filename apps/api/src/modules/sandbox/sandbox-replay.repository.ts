import { Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { sandboxReplays, type Database, type SandboxReplayRecord } from '@nexter/db';
import type { SandboxReplayPeriod, SandboxReplayStatus } from '@nexter/contracts';
import { DB } from '../../shared/db/db.module';

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

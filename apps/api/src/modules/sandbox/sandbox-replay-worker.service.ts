import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import type { Pool, PoolClient } from 'pg';
import { SANDBOX_TIMEFRAME_MS } from '@nexter/contracts';
import { paperConfigVersion, type PaperRunConfig } from '@nexter/sandbox-core';
import { env } from '../../shared/config/env';
import { AuditService } from '../../shared/audit/audit.service';
import { DB_POOL } from '../../shared/db/db.module';
import { safeErrorMessage } from '../../shared/errors/safe-error';
import { SANDBOX_REPLAY_PREFIX_DAYS } from './sandbox-replay.coverage';
import {
  assertReplayCandles,
  decodeReplaySnapshot,
  ReplayExecutionError,
  SANDBOX_REPLAY_EXECUTOR,
  snapshotReplayCandles,
  toCoreDecisionSettings,
  toCorePaperSettings,
  WorkerThreadReplayExecutor,
  type ReplayCandleSnapshot,
  type ReplayExecutionInput,
  type ReplayExecutor,
} from './sandbox-replay.executor';
import {
  SandboxReplayRepository,
  type SandboxReplayWorkerRecord,
} from './sandbox-replay.repository';
import { SANDBOX_ENABLED } from './sandbox.types';

const REPLAY_WORKER_LOCK_KEY = 'nexter:sandbox-replay-worker';
const REPLAY_WORKER_INTERVAL_MS = 60_000;
const REPLAY_WORKER_INITIAL_DELAY_MS = 15_000;
const DAY_MS = 24 * SANDBOX_TIMEFRAME_MS;

/** Locale-independent ordering, matching the core/CLI deterministic sort. */
function compareCodeUnits(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

/** Clamp/sanitize an arbitrary failure before it reaches a row, log or audit. */
function sanitizeReplayError(error: unknown): string {
  return safeErrorMessage(error).slice(0, 1000);
}

/**
 * 60-second historical replay scheduler.
 *
 * Enabled only when `SANDBOX_ENABLED` is on and the process is not the test
 * environment; tests call `runOnce`. A Postgres advisory lock serializes the
 * worker across API instances for the whole claim → snapshot → run → store
 * cycle. Stale `running` rows are requeued **only after the lock is held**, so
 * a rolling deploy cannot steal a replay another instance is still executing.
 *
 * The CPU-heavy run is delegated to a worker thread by default; the API event
 * loop and the live paper runner stay responsive. Only `sandbox_candles` is
 * read — there is no provider call and no old AI/candle-store access.
 */
@Injectable()
export class SandboxReplayWorkerService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(SandboxReplayWorkerService.name);
  private timer: NodeJS.Timeout | null = null;
  private initialTimer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    @Inject(DB_POOL) private readonly pool: Pool,
    @Inject(SANDBOX_ENABLED) private readonly enabled: boolean,
    private readonly repository: SandboxReplayRepository,
    private readonly audit: AuditService,
    @Inject(SANDBOX_REPLAY_EXECUTOR)
    private readonly executor: ReplayExecutor = new WorkerThreadReplayExecutor(),
  ) {}

  onApplicationBootstrap(): void {
    if (env.NODE_ENV === 'test' || !this.enabled) return;
    this.initialTimer = setTimeout(() => void this.runOnce(), REPLAY_WORKER_INITIAL_DELAY_MS);
    this.initialTimer.unref();
    this.timer = setInterval(() => void this.runOnce(), REPLAY_WORKER_INTERVAL_MS);
    this.timer.unref();
  }

  onApplicationShutdown(): void {
    if (this.timer) clearInterval(this.timer);
    if (this.initialTimer) clearTimeout(this.initialTimer);
    this.timer = null;
    this.initialTimer = null;
  }

  /** One scheduler pass. Tests call this directly with a fake clock/executor. */
  async runOnce(now: Date = new Date(), executor: ReplayExecutor = this.executor): Promise<void> {
    if (this.running) return;
    this.running = true;

    let client: PoolClient | null = null;
    let locked = false;

    try {
      client = await this.pool.connect();
      const lock = await client.query<{ locked: boolean }>(
        'select pg_try_advisory_lock(hashtext($1)::bigint) as locked',
        [REPLAY_WORKER_LOCK_KEY],
      );
      locked = lock.rows[0]?.locked === true;
      if (!locked) return;

      // Restart recovery is lock-gated: a row held by another live instance is
      // never requeued. No time-based sweep happens before the lock.
      await this.requeueStaleReplays(now);

      const claimed = await this.repository.claimQueuedReplay();
      if (!claimed) return;

      const started = await this.repository.markReplayRunning(claimed.id, now);
      if (!started) {
        // The owner cancelled the queued replay between claim and start.
        this.logger.debug(`Sandbox replay ${claimed.id} is no longer queued; skipping`);
        return;
      }

      await this.audit.log({
        userId: claimed.userId,
        action: 'sandbox.replay_started',
        entityType: 'sandbox_replay',
        entityId: claimed.id,
        before: { status: 'queued' },
        after: {
          status: 'running',
          startedAt: now.toISOString(),
          periodDays: claimed.periodDays,
          tokenKeys: [...claimed.tokenKeys],
          fromTime: claimed.fromTime.toISOString(),
          toTime: claimed.toTime.toISOString(),
          seed: claimed.seed,
          executionMode: 'historical-paper',
        },
      });

      await this.executeReplay(claimed, executor);
    } catch (error) {
      // A claim/lock/DB failure must not crash the interval; the next pass
      // retries. Execution failures are handled inside `executeReplay`.
      this.logger.warn(`Sandbox replay worker pass failed: ${sanitizeReplayError(error)}`);
    } finally {
      if (client && locked) {
        await client
          .query('select pg_advisory_unlock(hashtext($1)::bigint)', [REPLAY_WORKER_LOCK_KEY])
          .catch(() => undefined);
      }
      if (client) client.release();
      this.running = false;
    }
  }

  private async requeueStaleReplays(now: Date): Promise<void> {
    const requeued = await this.repository.requeueRunningReplays(now);
    for (const replay of requeued) {
      await this.audit.log({
        userId: replay.userId,
        action: 'sandbox.replay_requeued',
        entityType: 'sandbox_replay',
        entityId: replay.id,
        before: { status: 'running' },
        after: { status: 'queued', reason: 'worker_restart' },
      });
    }
    if (requeued.length > 0) {
      this.logger.warn(
        `Requeued ${requeued.length} interrupted sandbox replay(s) after worker restart`,
      );
    }
  }

  /**
   * Loads or reuses the exact input snapshot, runs the replay in the executor
   * and stores the report. All failures mark the replay failed with a sanitized
   * message and an audit row; the row is never deleted.
   */
  private async executeReplay(
    record: SandboxReplayWorkerRecord,
    executor: ReplayExecutor,
  ): Promise<void> {
    try {
      const snapshot = await this.resolveSnapshot(record);
      if (snapshot === null) return;

      const input = this.buildExecutionInput(record, snapshot);
      assertReplayCandles({
        tokenIds: input.tokenIds,
        candles: input.candles,
        fromTime: record.fromTime.getTime(),
        toTime: record.toTime.getTime(),
      });

      const report = await executor.run(input);
      if (report.runId !== record.id || report.dataSnapshotId !== snapshot.dataSnapshotId) {
        throw new ReplayExecutionError(
          'REPLAY_STATE_INVALID',
          'Replay report identity does not match the claimed replay input',
        );
      }

      const stored = await this.repository.storeReplayReport(record.id, {
        report: report as unknown as Record<string, unknown>,
        reportHash: report.reportHash,
        eventCount: report.eventCount,
        eventHash: report.eventHash,
        dataSnapshotId: snapshot.dataSnapshotId,
        candleSnapshot: snapshot.gzip,
        candleSnapshotHash: snapshot.hash,
        at: new Date(),
      });
      if (!stored) {
        this.logger.warn(`Sandbox replay ${record.id} left running before its report was stored`);
        return;
      }

      await this.audit.log({
        userId: record.userId,
        action: 'sandbox.replay_completed',
        entityType: 'sandbox_replay',
        entityId: record.id,
        before: { status: 'running' },
        after: {
          status: 'completed',
          reportHash: report.reportHash,
          eventCount: report.eventCount,
          eventHash: report.eventHash,
          dataSnapshotId: snapshot.dataSnapshotId,
          candleSnapshotHash: snapshot.hash,
          executionMode: 'historical-paper',
        },
      });
      this.logger.log(
        `Sandbox replay ${record.id} completed: ${report.period.bars} bar(s), ` +
          `report ${report.reportHash.slice(0, 12)}…`,
      );
    } catch (error) {
      await this.failReplay(record, error);
    }
  }

  private async failReplay(record: SandboxReplayWorkerRecord, error: unknown): Promise<void> {
    const message = sanitizeReplayError(error);

    try {
      const marked = await this.repository.markReplayFailed(record.id, message, new Date());
      if (!marked) {
        this.logger.warn(
          `Sandbox replay ${record.id} left running before it could be marked failed`,
        );
        return;
      }
      await this.audit.log({
        userId: record.userId,
        action: 'sandbox.replay_failed',
        entityType: 'sandbox_replay',
        entityId: record.id,
        before: { status: 'running' },
        after: { status: 'failed', error: message, executionMode: 'historical-paper' },
      });
    } catch (failError) {
      this.logger.error(
        `Failed to mark sandbox replay ${record.id} failed: ${sanitizeReplayError(failError)}`,
      );
    }
    this.logger.warn(`Sandbox replay ${record.id} failed: ${message}`);
  }

  /**
   * Reuses the persisted gzip snapshot when a requeued row already has one;
   * otherwise loads the half-open window, snapshots/hashes it and stores it
   * **before** the run. Returns `null` when the row moved on concurrently.
   */
  private async resolveSnapshot(
    record: SandboxReplayWorkerRecord,
  ): Promise<ReplayCandleSnapshot | null> {
    if (record.candleSnapshot !== null) {
      if (record.candleSnapshotHash === null) {
        throw new ReplayExecutionError(
          'REPLAY_STATE_INVALID',
          'Stored replay snapshot is missing its hash',
        );
      }
      return decodeReplaySnapshot(
        record.candleSnapshot,
        record.candleSnapshotHash,
        record.dataSnapshotId,
      );
    }

    const from = new Date(record.toTime.getTime() - SANDBOX_REPLAY_PREFIX_DAYS * DAY_MS);
    const candles = await this.repository.loadReplayCandles(record.tokenKeys, from, record.toTime);
    const snapshot = snapshotReplayCandles(candles);
    assertReplayCandles({
      tokenIds: record.tokenKeys,
      candles: snapshot.candles,
      fromTime: record.fromTime.getTime(),
      toTime: record.toTime.getTime(),
    });

    const stored = await this.repository.storeReplaySnapshot(record.id, {
      dataSnapshotId: snapshot.dataSnapshotId,
      candleSnapshot: snapshot.gzip,
      candleSnapshotHash: snapshot.hash,
      at: new Date(),
    });
    if (!stored) {
      this.logger.warn(`Sandbox replay ${record.id} left running before its snapshot was stored`);
      return null;
    }

    return snapshot;
  }

  /**
   * Builds the core-shaped execution input from the frozen row.
   *
   * `from_time` is the first evaluation candle **open**, passed to the core as
   * `evaluateFrom`; prefix candles stay lookback history. The config version is
   * the Stage 1A `paperConfigVersion` over the same frozen paper settings the
   * report exposes.
   */
  private buildExecutionInput(
    record: SandboxReplayWorkerRecord,
    snapshot: ReplayCandleSnapshot,
  ): ReplayExecutionInput {
    const tokenIds = [...new Set(record.tokenKeys)].sort(compareCodeUnits);
    const settings = toCoreDecisionSettings(record.settings);
    const paper = toCorePaperSettings(record.paper);

    const config: PaperRunConfig = {
      runId: record.id,
      seed: record.seed,
      timeframe: '1h',
      tokenIds,
      initialCapitalUsd: record.initialCapitalUsd,
      ...paper,
    };

    return {
      runId: record.id,
      seed: record.seed,
      configVersion: paperConfigVersion(config),
      dataSnapshotId: snapshot.dataSnapshotId,
      tokenIds,
      candles: snapshot.candles,
      settings,
      paper,
      initialCapitalUsd: record.initialCapitalUsd,
      evaluateFrom: record.fromTime.getTime(),
    };
  }
}

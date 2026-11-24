import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import type { Pool, PoolClient } from 'pg';
import { parseSandboxTokenKey } from '@nexter/contracts';
import { env } from '../../shared/config/env';
import { AuditService } from '../../shared/audit/audit.service';
import { DB_POOL } from '../../shared/db/db.module';
import { SandboxDataService, type SandboxDataSourceToken } from './sandbox-data.service';
import { type SandboxLiveQuote } from './sandbox-live-broker';
import { findNewBarClose, runSandboxLiveTick } from './sandbox-live-tick';
import { SandboxRepository } from './sandbox.repository';
import {
  resolveSandboxRunConfig,
  SANDBOX_ENABLED,
  type SandboxRunSnapshot,
  type SandboxRunnerConfig,
} from './sandbox.types';

const RUNNER_LOCK_KEY = 'nexter:sandbox-runner';
const RUNNER_INTERVAL_MS = 60_000;

/** Internal control flow: a scheduled tick decided not to advance the run. */
class SandboxTickSkip extends Error {
  constructor(readonly reason: string) {
    super(reason);
    this.name = 'SandboxTickSkip';
  }
}

/**
 * 60-second live paper scheduler.
 *
 * Enabled only when `SANDBOX_ENABLED` is on and the process is not the test
 * environment; tests call `runOnce`. One Postgres advisory lock serializes the
 * scheduler across API instances, and each run advances at most once per closed
 * 1h bar (`last_bar_close` is the duplicate guard). Data/quote failures are
 * skipped with a warning; engine/reconciliation failures mark the run failed.
 */
@Injectable()
export class SandboxRunnerService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(SandboxRunnerService.name);
  private timer: NodeJS.Timeout | null = null;
  private initialTimer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    @Inject(DB_POOL) private readonly pool: Pool,
    @Inject(SANDBOX_ENABLED) private readonly enabled: boolean,
    private readonly repository: SandboxRepository,
    private readonly data: SandboxDataService,
    private readonly audit: AuditService,
  ) {}

  onApplicationBootstrap(): void {
    if (env.NODE_ENV === 'test' || !this.enabled) return;
    this.initialTimer = setTimeout(() => void this.runOnce(), 15_000);
    this.initialTimer.unref();
    this.timer = setInterval(() => void this.runOnce(), RUNNER_INTERVAL_MS);
    this.timer.unref();
  }

  onApplicationShutdown(): void {
    if (this.timer) clearInterval(this.timer);
    if (this.initialTimer) clearTimeout(this.initialTimer);
    this.timer = null;
    this.initialTimer = null;
  }

  /** One scheduler pass. Tests call this directly with a fake clock. */
  async runOnce(now: Date = new Date()): Promise<void> {
    if (this.running) return;
    this.running = true;

    let client: PoolClient | null = null;
    let locked = false;

    try {
      client = await this.pool.connect();
      const lock = await client.query<{ locked: boolean }>(
        'select pg_try_advisory_lock(hashtext($1)::bigint) as locked',
        [RUNNER_LOCK_KEY],
      );
      locked = lock.rows[0]?.locked === true;
      if (!locked) return;

      const runs = await this.repository.listRunningRuns();
      for (const run of runs) {
        try {
          await this.advanceRun(run.id, now);
        } catch (error) {
          await this.failRun(run.id, run.userId, error);
        }
      }
    } catch (error) {
      this.logger.warn(
        `Sandbox runner tick failed: ${error instanceof Error ? error.message : 'unknown'}`,
      );
    } finally {
      if (client && locked) {
        await client
          .query('select pg_advisory_unlock(hashtext($1)::bigint)', [RUNNER_LOCK_KEY])
          .catch(() => undefined);
      }
      if (client) client.release();
      this.running = false;
    }
  }

  /**
   * Advances one running run when a new closed 1h bar exists.
   *
   * The quote fetch/upsert and the decision tick are separate: a provider
   * failure keeps the persisted candles usable and merely leaves fills pending.
   */
  async advanceRun(runId: string, now: Date): Promise<void> {
    const before = await this.repository.loadRun(runId);
    if (before === null || before.status !== 'running' || before.archivedAt !== null) {
      return;
    }

    const config = resolveSandboxRunConfig(
      before.settings,
      before.tokens.map((token) => token.tokenKey),
    );
    const quotes = await this.loadQuotes(before, config, now);
    const candles = await this.repository.loadCandles(config.tokenKeys);
    const clockTime = findNewBarClose(candles, config.tokenKeys, before.lastBarClose);
    if (clockTime === null) {
      await this.repository.touchRunTick(runId, now);
      return;
    }

    try {
      const summary = await this.repository.commitTick(runId, async ({ tx, run, eventLog }) => {
        // Re-read under a row lock: a pause/stop/archive that commits first must
        // win over this tick rather than be overwritten by persistTick.
        const current = await this.repository.lockRunForTick(tx, runId);
        if (current === null || current.status !== 'running' || current.archivedAt !== null) {
          throw new SandboxTickSkip('run is no longer running');
        }
        if (current.lastBarClose !== null && clockTime <= current.lastBarClose.getTime()) {
          throw new SandboxTickSkip('bar already processed');
        }

        const pending = await this.repository.listPendingIntents(runId, tx);
        const result = await runSandboxLiveTick({
          run,
          config,
          candles,
          pending,
          quotes,
          clockTime,
          now,
          eventLog,
        });

        await this.repository.insertPendingIntents(tx, runId, result.pendingIntents);
        return result.tick;
      });

      this.logger.debug(
        `Sandbox run ${runId} tick ${new Date(clockTime).toISOString()}: ` +
          `${summary.intents} intent(s), ${summary.ledgerEntries} ledger entry(ies)`,
      );
    } catch (error) {
      if (error instanceof SandboxTickSkip) return;
      throw error;
    }
  }

  private async loadQuotes(
    run: SandboxRunSnapshot,
    config: SandboxRunnerConfig,
    now: Date,
  ): Promise<Map<string, SandboxLiveQuote>> {
    const ownerTokens = await this.repository.listTokens(run.userId);
    const byKey = new Map(ownerTokens.map((token) => [token.tokenKey, token]));
    const quotes = new Map<string, SandboxLiveQuote>();

    for (const tokenKey of config.tokenKeys) {
      const known = byKey.get(tokenKey);
      const parsed = parseSandboxTokenKey(tokenKey);
      const source: SandboxDataSourceToken = {
        tokenKey,
        symbol: known?.symbol ?? parsed?.baseSymbol ?? tokenKey,
        chain: known?.chain ?? parsed?.chain ?? 'bsc',
        contractAddress: known?.contractAddress ?? parsed?.contractAddress ?? null,
        coingeckoId: known?.coingeckoId ?? null,
      };
      try {
        const quote = await this.data.latestPrice(source, { now });
        if (quote !== null) quotes.set(tokenKey, quote);
      } catch (error) {
        this.logger.warn(
          `Sandbox quote refresh failed for ${tokenKey}: ` +
            `${error instanceof Error ? error.message : 'unknown'}`,
        );
      }
    }

    return quotes;
  }

  private async failRun(runId: string, userId: string, error: unknown): Promise<void> {
    const message = (
      error instanceof Error ? error.message : String(error ?? 'unknown sandbox error')
    ).slice(0, 1000);

    try {
      await this.repository.markRunFailed(runId, message);
      await this.audit.log({
        userId,
        action: 'sandbox.run_failed',
        entityType: 'sandbox_run',
        entityId: runId,
        after: { error: message, executionMode: 'live-paper' },
      });
    } catch (auditError) {
      this.logger.error(
        `Failed to mark sandbox run ${runId} failed: ` +
          `${auditError instanceof Error ? auditError.message : 'unknown'}`,
      );
    }
    this.logger.warn(`Sandbox run ${runId} failed: ${message}`);
  }
}

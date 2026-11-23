import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationShutdown,
  type OnModuleInit,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { availableParallelism } from 'node:os';
import { eq, sql } from 'drizzle-orm';
import { aiJobs, type Database } from '@nexter/db';
import { DB } from '../../shared/db/db.module';
import { searchWorkerCount } from './ai-search.helpers';
import { workerFileExists } from './ai-search.pool';
import { AiSearchService } from './ai-search.service';

interface QueuedJob {
  id: string;
  run_id: string;
  profile_id: string;
  payload: Record<string, unknown>;
}

@Injectable()
export class AiSearchWorkerService implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(AiSearchWorkerService.name);
  private readonly instanceId = `api-${randomUUID()}`;
  private timer: NodeJS.Timeout | null = null;
  private initialTimer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly search: AiSearchService,
  ) {}

  onModuleInit(): void {
    if (process.env.NODE_ENV === 'test') return;
    this.logger.log(
      `AI search runtime: cpus=${availableParallelism()} workers=${searchWorkerCount()} workerFile=${workerFileExists()} inline=${process.env.AI_SEARCH_INLINE === '1'}`,
    );
    if (process.env.AI_SEARCH_WORKER_DISABLED === '1') return;
    void this.recoverStaleJobs();
    this.initialTimer = setTimeout(() => void this.tick(), 1_000);
    this.initialTimer.unref();
    this.timer = setInterval(() => void this.tick(), 2_000);
    this.timer.unref();
  }

  onApplicationShutdown(): void {
    if (this.timer) clearInterval(this.timer);
    if (this.initialTimer) clearTimeout(this.initialTimer);
    this.timer = null;
    this.initialTimer = null;
  }

  private async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    let job: QueuedJob | null = null;
    try {
      job = await this.claim();
      if (!job) return;
      const jobId = job.id;
      const heartbeat = setInterval(() => {
        void this.db
          .update(aiJobs)
          .set({ heartbeatAt: new Date(), updatedAt: new Date() })
          .where(eq(aiJobs.id, jobId))
          .catch(() => undefined);
      }, 10_000);
      try {
        await this.search.runQueuedJob({
          id: job.id,
          runId: job.run_id,
          profileId: job.profile_id,
          payload: job.payload,
        });
      } finally {
        clearInterval(heartbeat);
      }
    } catch (error) {
      this.logger.error(
        `AI search job ${job?.id ?? 'claim'} failed: ${
          error instanceof Error ? error.message.slice(0, 300) : String(error)
        }`,
      );
    } finally {
      this.running = false;
    }
  }

  private async claim(): Promise<QueuedJob | null> {
    const result = await this.db.execute(sql`
      update ai_jobs
      set status = 'running',
          locked_by = ${this.instanceId},
          locked_at = now(),
          heartbeat_at = now(),
          attempts = attempts + 1,
          updated_at = now()
      where id = (
        select id from ai_jobs
        where service = 'ai_search' and status = 'queued' and run_at <= now()
        order by priority desc, run_at asc
        limit 1
        for update skip locked
      )
      returning id, run_id, profile_id, payload
    `);
    return (result.rows[0] as unknown as QueuedJob | undefined) ?? null;
  }

  private async recoverStaleJobs(): Promise<void> {
    try {
      const stale = await this.db.execute(sql`
        select id, run_id, attempts, max_attempts
        from ai_jobs
        where service = 'ai_search'
          and status = 'running'
          and (heartbeat_at is null or heartbeat_at < now() - interval '2 minutes')
      `);
      for (const row of stale.rows as Array<{
        id: string;
        run_id: string;
        attempts: number;
        max_attempts: number;
      }>) {
        // A search job is expensive and can block the API for minutes. Never
        // restart it automatically after a crash or deploy: mark it failed and
        // let the owner rerun it explicitly.
        const error =
          Number(row.attempts) >= Number(row.max_attempts)
            ? 'AI_SEARCH_STALE'
            : 'AI_SEARCH_INTERRUPTED';
        await this.db
          .update(aiJobs)
          .set({
            status: 'failed',
            error,
            lockedBy: null,
            lockedAt: null,
            updatedAt: new Date(),
          })
          .where(eq(aiJobs.id, row.id));
        await this.db.execute(sql`
          update ai_pipeline_runs
          set status = 'failed',
              finished_at = now(),
              summary = coalesce(summary, '{}'::jsonb) || jsonb_build_object('error', ${error})
          where id = ${row.run_id} and status in ('queued', 'running')
        `);
        this.logger.warn(`AI search job ${row.id} was interrupted and marked failed`);
      }
    } catch (error) {
      this.logger.warn(
        `Could not recover stale AI search jobs: ${
          error instanceof Error ? error.message.slice(0, 300) : String(error)
        }`,
      );
    }
  }
}

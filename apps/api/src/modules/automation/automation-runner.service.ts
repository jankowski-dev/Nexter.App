import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { eq } from 'drizzle-orm';
import type { Pool, PoolClient } from 'pg';
import { automationRuleState, automationRules, automationRuns, type Database } from '@nexter/db';
import { DB, DB_POOL } from '../../shared/db/db.module';
import { AuditService } from '../../shared/audit/audit.service';
import { env } from '../../shared/config/env';
import { NotificationsService } from '../notifications/notifications.service';
import { SettingsService } from '../settings/settings.service';
import { AutomationEvaluatorService } from './automation-evaluator.service';

const RUNNER_LOCK_KEY = 'nexter:automation-runner';
const RUNNER_INTERVAL_MS = 60_000;

@Injectable()
export class AutomationRunnerService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(AutomationRunnerService.name);
  private timer: NodeJS.Timeout | null = null;
  private initialTimer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(DB_POOL) private readonly pool: Pool,
    private readonly settings: SettingsService,
    private readonly evaluator: AutomationEvaluatorService,
    private readonly notifications: NotificationsService,
    private readonly audit: AuditService,
  ) {}

  onApplicationBootstrap(): void {
    if (env.NODE_ENV === 'test') return;

    this.initialTimer = setTimeout(() => void this.tick(), 10_000);
    this.initialTimer.unref();
    this.timer = setInterval(() => void this.tick(), RUNNER_INTERVAL_MS);
    this.timer.unref();
  }

  onApplicationShutdown(): void {
    if (this.timer) clearInterval(this.timer);
    if (this.initialTimer) clearTimeout(this.initialTimer);
    this.timer = null;
    this.initialTimer = null;
  }

  async runOnce(): Promise<void> {
    await this.tick();
  }

  private async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;

    let client: PoolClient | null = null;
    let locked = false;

    try {
      const runtime = await this.settings.getRuntime();
      if (!runtime.automationEnabled) return;

      client = await this.pool.connect();
      const lock = await client.query<{ locked: boolean }>(
        'select pg_try_advisory_lock(hashtext($1)::bigint) as locked',
        [RUNNER_LOCK_KEY],
      );
      locked = lock.rows[0]?.locked === true;
      if (!locked) return;

      const rules = await this.db
        .select()
        .from(automationRules)
        .where(eq(automationRules.status, 'armed'));

      for (const rule of rules) {
        try {
          await this.processRule(rule);
        } catch (error) {
          this.logger.warn(
            `Automation rule ${rule.id} failed: ${
              error instanceof Error ? error.message : 'unknown'
            }`,
          );
        }
      }
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

  private async processRule(rule: typeof automationRules.$inferSelect): Promise<void> {
    const evaluation = await this.evaluator.evaluate(rule);

    if (evaluation.highWaterUsd) {
      await this.saveState(rule.id, evaluation.highWaterUsd, null);
    }

    if (evaluation.status !== 'would_execute') return;

    const status = rule.executionMode === 'proposal' ? 'proposed' : 'would_execute';
    const [created] = await this.db
      .insert(automationRuns)
      .values({
        ruleId: rule.id,
        userId: rule.userId,
        status,
        triggerKey: evaluation.triggerKey,
        reason: evaluation.reason,
        triggerPriceUsd: evaluation.triggerPriceUsd,
        amount: evaluation.amount,
        usdValue: evaluation.usdValue,
        tradeGroupId: evaluation.tradeGroupId,
      })
      .onConflictDoNothing()
      .returning({ id: automationRuns.id });

    if (!created) return;

    const now = new Date();
    await this.db
      .update(automationRules)
      .set({
        lastTriggeredAt: now,
        triggerCount: rule.triggerCount + 1,
        updatedAt: now,
      })
      .where(eq(automationRules.id, rule.id));

    await this.saveState(rule.id, evaluation.highWaterUsd, now);

    const dryRun = rule.executionMode === 'dry_run';
    await this.notifications
      .create({
        userId: rule.userId,
        type: 'automation_trigger',
        title: dryRun ? `Сработало бы: ${rule.name}` : `Автоматизация: ${rule.name}`,
        body: evaluation.reason,
        href: evaluation.tradeGroupId ? `/trades/${evaluation.tradeGroupId}` : '/portfolio#tokens',
        payload: {
          ruleId: rule.id,
          kind: rule.kind,
          mode: rule.executionMode,
          status,
          triggerPriceUsd: evaluation.triggerPriceUsd,
          amount: evaluation.amount,
          usdValue: evaluation.usdValue,
          tradeGroupId: evaluation.tradeGroupId,
        },
      })
      .catch(() => undefined);

    await this.audit
      .log({
        userId: rule.userId,
        action: 'automation.triggered',
        entityType: 'automation_rule',
        entityId: rule.id,
        after: {
          runId: created.id,
          status,
          reason: evaluation.reason,
          triggerPriceUsd: evaluation.triggerPriceUsd,
          amount: evaluation.amount,
          usdValue: evaluation.usdValue,
        },
      })
      .catch(() => undefined);
  }

  private async saveState(
    ruleId: string,
    highWaterUsd: string | null,
    lastActionAt: Date | null,
  ): Promise<void> {
    const [existing] = await this.db
      .select()
      .from(automationRuleState)
      .where(eq(automationRuleState.ruleId, ruleId))
      .limit(1);

    if (!existing && !highWaterUsd && !lastActionAt) return;

    const now = new Date();
    await this.db
      .insert(automationRuleState)
      .values({
        ruleId,
        highWaterUsd: highWaterUsd ?? null,
        lastActionAt: lastActionAt ?? existing?.lastActionAt ?? null,
        metadata: existing?.metadata ?? {},
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: automationRuleState.ruleId,
        set: {
          highWaterUsd: highWaterUsd ?? existing?.highWaterUsd ?? null,
          lastActionAt: lastActionAt ?? existing?.lastActionAt ?? null,
          updatedAt: now,
        },
      });
  }
}

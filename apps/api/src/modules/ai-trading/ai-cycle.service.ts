import {
  ConflictException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
  type OnModuleInit,
} from '@nestjs/common';
import { and, eq, gte, inArray, isNull, sql } from 'drizzle-orm';
import {
  aiJobs,
  aiPipelineRuns,
  tradingBots,
  watchlist,
  watchlistGroups,
  type Database,
} from '@nexter/db';
import {
  aiCycleStepKeys,
  type AiCycleRequest,
  type AiCycleStatus,
  type AiCycleStep,
  type AiCycleStepKey,
  type AiCycleStepStatus,
  type AiProfileToken,
  type AiSearchCandidate,
  type BotCreateRequest,
} from '@nexter/contracts';
import { AuditService } from '../../shared/audit/audit.service';
import { DB } from '../../shared/db/db.module';
import { TradingBotsService } from '../trading-bots/trading-bots.service';
import { AiDataService } from './ai-data.service';
import { AiSearchService } from './ai-search.service';
import { AiTradingService } from './ai-trading.service';

interface CycleMeta {
  ip?: string;
  userAgent?: string;
}

interface CycleSummary {
  kind: 'cycle';
  assetId: string;
  timeframe: string;
  steps: AiCycleStep[];
  searchRunId: string | null;
  recommended: number;
  draftsCreated: number;
  rejectionReasons: Record<string, number>;
  error?: string | null;
}

const STEP_LABELS: Record<AiCycleStepKey, string> = {
  data: 'Данные',
  search: 'Поиск',
  recommendations: 'Рекомендации',
  drafts: 'Черновики',
};

const MAX_CYCLE_MS = 15 * 60_000;

function emptyStep(key: AiCycleStepKey): AiCycleStep {
  return {
    key,
    status: 'queued',
    message: null,
    error: null,
    startedAt: null,
    finishedAt: null,
  };
}

function readSummary(value: unknown): CycleSummary {
  return value as CycleSummary;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message.slice(0, 500) : 'Неизвестная ошибка';
}

@Injectable()
export class AiCycleService implements OnModuleInit {
  private readonly logger = new Logger(AiCycleService.name);

  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly aiTrading: AiTradingService,
    private readonly aiData: AiDataService,
    private readonly aiSearch: AiSearchService,
    private readonly bots: TradingBotsService,
    private readonly audit: AuditService,
  ) {}

  async onModuleInit(): Promise<void> {
    if (process.env.NODE_ENV === 'test') return;
    await this.recoverStaleCycles();
  }

  async start(
    userId: string,
    input: AiCycleRequest,
    meta: CycleMeta,
  ): Promise<{ cycleId: string }> {
    const profile = await this.aiTrading.getProfile(userId);
    const tokens = await this.aiTrading.listTokens(userId);
    const token = tokens.find((item) => item.enabled && item.asset.id === input.assetId);
    if (!token) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'AI token not found' });
    }
    if (!token.timeframes.includes(input.timeframe)) {
      throw new ConflictException({
        code: 'VALIDATION_ERROR',
        message: `Timeframe ${input.timeframe} is not configured for this token`,
      });
    }

    const [active] = await this.db
      .select({ id: aiPipelineRuns.id })
      .from(aiPipelineRuns)
      .where(
        and(
          eq(aiPipelineRuns.profileId, profile.id),
          inArray(aiPipelineRuns.status, ['queued', 'running']),
          sql`${aiPipelineRuns.summary}->>'kind' = 'cycle'`,
        ),
      )
      .limit(1);
    if (active) {
      throw new ConflictException({
        code: 'AI_CYCLE_BUSY',
        message: 'AI cycle is already running',
      });
    }

    if (input.maxDrafts > 0) {
      const [watched] = await this.db
        .select({ id: watchlist.id })
        .from(watchlist)
        .innerJoin(
          watchlistGroups,
          and(eq(watchlistGroups.id, watchlist.groupId), eq(watchlistGroups.isDefault, true)),
        )
        .where(
          and(
            eq(watchlist.userId, userId),
            eq(watchlist.assetId, input.assetId),
            isNull(watchlist.archivedAt),
          ),
        )
        .limit(1);
      if (!watched) {
        throw new ConflictException({
          code: 'AI_CYCLE_TOKEN_NOT_WATCHLIST',
          message:
            'Чтобы создать черновик, токен должен быть активной записью группы «Основная». Добавьте его в watchlist или выберите «Черновиков: 0».',
        });
      }
    }

    const [daily] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(aiPipelineRuns)
      .where(
        and(
          eq(aiPipelineRuns.profileId, profile.id),
          gte(aiPipelineRuns.createdAt, new Date(Date.now() - 24 * 60 * 60_000)),
          sql`${aiPipelineRuns.summary}->>'kind' = 'cycle'`,
        ),
      );
    if (Number(daily?.count ?? 0) >= 20) {
      throw new HttpException(
        {
          code: 'AI_CYCLE_LIMIT',
          message: 'Дневной лимит циклов исчерпан (20 за 24 часа).',
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const steps = aiCycleStepKeys.map(emptyStep);
    const summary: CycleSummary = {
      kind: 'cycle',
      assetId: input.assetId,
      timeframe: input.timeframe,
      steps,
      searchRunId: null,
      recommended: 0,
      draftsCreated: 0,
      rejectionReasons: {},
      error: null,
    };

    const cycle = await this.db.transaction(async (tx) => {
      const [run] = await tx
        .insert(aiPipelineRuns)
        .values({
          profileId: profile.id,
          trigger: 'manual',
          status: 'running',
          startedAt: new Date(),
          summary: summary as unknown as Record<string, unknown>,
        })
        .returning();
      if (!run) throw new Error('Failed to create AI cycle');
      await tx.insert(aiJobs).values(
        aiCycleStepKeys.map((key) => ({
          profileId: profile.id,
          runId: run.id,
          service: 'ai_cycle',
          stage: key,
          status: 'queued',
          payload: { cycleId: run.id, step: key, label: STEP_LABELS[key] },
          idempotencyKey: `${run.id}:${key}`,
        })),
      );
      return run;
    });

    await this.audit.log({
      userId,
      action: 'ai_trading.cycle_started',
      entityType: 'ai_pipeline_run',
      entityId: cycle.id,
      after: {
        assetId: input.assetId,
        timeframe: input.timeframe,
        horizonDays: input.horizonDays,
        variants: input.variants,
        maxDrafts: input.maxDrafts,
      },
      ip: meta.ip,
      userAgent: meta.userAgent,
    });

    void this.execute(userId, profile.id, cycle.id, token, input, meta).catch((error) => {
      this.logger.error(`AI cycle ${cycle.id} failed: ${errorMessage(error)}`);
    });

    return { cycleId: cycle.id };
  }

  async status(userId: string, cycleId: string): Promise<AiCycleStatus> {
    const profile = await this.aiTrading.getProfile(userId);
    const [run] = await this.db
      .select()
      .from(aiPipelineRuns)
      .where(and(eq(aiPipelineRuns.id, cycleId), eq(aiPipelineRuns.profileId, profile.id)))
      .limit(1);
    if (!run) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'AI cycle not found' });
    }
    const summary = readSummary(run.summary);
    if (summary.kind !== 'cycle') {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'AI cycle not found' });
    }
    return {
      cycleId: run.id,
      status: run.status as AiCycleStatus['status'],
      steps: summary.steps,
      searchRunId: summary.searchRunId,
      recommended: summary.recommended,
      draftsCreated: summary.draftsCreated,
      rejectionReasons: summary.rejectionReasons ?? {},
      error: summary.error ?? null,
      createdAt: run.createdAt.toISOString(),
      finishedAt: run.finishedAt?.toISOString() ?? null,
    };
  }

  private async execute(
    userId: string,
    profileId: string,
    cycleId: string,
    token: AiProfileToken,
    input: AiCycleRequest,
    meta: CycleMeta,
  ): Promise<void> {
    try {
      await this.runDataStep(userId, cycleId, token, input, meta);
      const searchRunId = await this.runSearchStep(userId, cycleId, input, meta);
      const candidates = await this.runRecommendationsStep(userId, cycleId, searchRunId);
      await this.runDraftsStep(
        userId,
        profileId,
        cycleId,
        token,
        candidates,
        input.maxDrafts,
        meta,
      );
      await this.finish(userId, cycleId, 'succeeded');
    } catch (error) {
      const message = errorMessage(error);
      await this.fail(userId, cycleId, message, meta);
    }
  }

  private async runDataStep(
    userId: string,
    cycleId: string,
    token: AiProfileToken,
    input: AiCycleRequest,
    meta: CycleMeta,
  ): Promise<void> {
    await this.setStep(cycleId, 'data', 'running', { message: 'Проверяю покрытие' });
    const before = await this.coverageFor(userId, input.assetId, input.timeframe);
    if (before?.status === 'ok') {
      await this.setStep(cycleId, 'data', 'succeeded', {
        message: `${before.candles} / ${before.expected} свечей`,
      });
      return;
    }

    const refreshed = await this.aiData.refresh(
      userId,
      { assetId: input.assetId, timeframes: [input.timeframe], days: 180 },
      meta,
    );
    const after = await this.coverageFor(userId, input.assetId, input.timeframe);
    if (!after || after.status !== 'ok') {
      const reason =
        refreshed.failed.length > 0
          ? ` Источник: ${refreshed.failed
              .map((item) => `${item.symbol} ${item.timeframe}: ${item.reason}`)
              .join('; ')}`
          : '';
      throw new ServiceUnavailableException({
        code: 'AI_DATA_INSUFFICIENT',
        message: `Недостаточно истории: ${after?.candles ?? 0} из ${after?.expected ?? 0} свечей.${reason}`,
      });
    }
    await this.setStep(cycleId, 'data', 'succeeded', {
      message: `Загружено ${refreshed.upserted} свечей, покрытие ${after.candles} / ${after.expected}`,
    });
  }

  private async coverageFor(userId: string, assetId: string, timeframe: string) {
    const coverage = await this.aiData.coverage(userId);
    return coverage.tokens
      .find((token) => token.assetId === assetId)
      ?.timeframes.find((item) => item.timeframe === timeframe);
  }

  private async runSearchStep(
    userId: string,
    cycleId: string,
    input: AiCycleRequest,
    meta: CycleMeta,
  ): Promise<string> {
    await this.setStep(cycleId, 'search', 'running', { message: 'Запускаю поиск' });
    const { runId } = await this.aiSearch.start(
      userId,
      {
        assetId: input.assetId,
        timeframe: input.timeframe,
        horizonDays: input.horizonDays,
        variants: input.variants,
      },
      meta,
    );
    await this.updateSummary(cycleId, (summary) => {
      summary.searchRunId = runId;
    });

    const deadline = Date.now() + MAX_CYCLE_MS;
    let lastMessage = '';
    while (Date.now() < deadline) {
      const status = await this.aiSearch.status(userId, runId);
      if (status.status === 'succeeded') {
        await this.setStep(cycleId, 'search', 'succeeded', {
          message: `${status.evaluated} / ${status.total} вариантов`,
        });
        return runId;
      }
      if (status.status === 'failed' || status.status === 'cancelled') {
        throw new ServiceUnavailableException({
          code: 'AI_SEARCH_FAILED',
          message: status.error ?? `Поиск завершился статусом ${status.status}`,
        });
      }
      const message = `Поиск: ${status.evaluated} / ${status.total}`;
      if (message !== lastMessage) {
        lastMessage = message;
        await this.setStep(cycleId, 'search', 'running', { message });
      }
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    throw new ServiceUnavailableException({
      code: 'AI_SEARCH_TIMEOUT',
      message: 'Поиск не завершился за 15 минут',
    });
  }

  private async runRecommendationsStep(
    userId: string,
    cycleId: string,
    searchRunId: string,
  ): Promise<AiSearchCandidate[]> {
    await this.setStep(cycleId, 'recommendations', 'running', {
      message: 'Собираю рекомендации',
    });
    const results = await this.aiSearch.results(userId, searchRunId);
    const recommended = results.candidates.filter((item) => item.status === 'recommended');
    await this.updateSummary(cycleId, (summary) => {
      summary.recommended = recommended.length;
      summary.rejectionReasons = results.rejectionReasons;
    });
    await this.setStep(cycleId, 'recommendations', 'succeeded', {
      message: `${recommended.length} рекомендаций`,
    });
    return recommended;
  }

  private async runDraftsStep(
    userId: string,
    profileId: string,
    cycleId: string,
    token: AiProfileToken,
    candidates: AiSearchCandidate[],
    maxDrafts: number,
    meta: CycleMeta,
  ): Promise<void> {
    if (maxDrafts <= 0) {
      await this.setStep(cycleId, 'drafts', 'skipped', {
        message: 'Создание черновиков выключено',
      });
      return;
    }
    if (candidates.length === 0) {
      await this.setStep(cycleId, 'drafts', 'skipped', {
        message: 'Нет рекомендаций для черновиков',
      });
      return;
    }

    await this.setStep(cycleId, 'drafts', 'running', { message: 'Создаю черновики' });
    const profile = await this.aiTrading.getProfile(userId);
    const [existing] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(tradingBots)
      .where(
        and(
          eq(tradingBots.userId, userId),
          eq(tradingBots.origin, 'ai'),
          isNull(tradingBots.archivedAt),
        ),
      );
    const slots = Math.max(0, profile.maxWorkers - Number(existing?.count ?? 0));
    const target = Math.min(maxDrafts, slots, candidates.length);
    if (target <= 0) {
      await this.setStep(cycleId, 'drafts', 'skipped', {
        message: `Нет свободных слотов ИИ-роботов (${profile.maxWorkers})`,
      });
      return;
    }

    const budget = Math.max(
      100,
      (Number(profile.budgetUsd) * profile.maxWorkerAllocationPct) / 100,
    ).toFixed(2);
    let created = 0;
    for (const candidate of candidates.slice(0, target)) {
      try {
        await this.bots.createBot(
          userId,
          {
            name: `AI ${token.asset.symbol} ${candidate.strategyName} ${cycleId.slice(0, 6)}`,
            description: `Цикл ИИ ${cycleId.slice(0, 8)} · OOS ${candidate.oosMedianReturnPct}% · стабильность ${candidate.stabilityPct}%`,
            strategyKey: candidate.strategyKey as BotCreateRequest['strategyKey'],
            strategyParams: candidate.params,
            tokenAssetIds: [token.asset.id],
            budgetUsd: budget,
            maxPositions: 5,
            positionSizePct: 20,
            feeBps: 25,
            slippageBps: 10,
            maxDailyLossPct: 10,
            cooldownMinutes: 15,
            aiCandidateId: candidate.id,
          },
          meta,
        );
        created += 1;
        await this.updateSummary(cycleId, (summary) => {
          summary.draftsCreated = created;
        });
      } catch (error) {
        throw new ServiceUnavailableException({
          code: 'AI_DRAFT_FAILED',
          message: `Не удалось создать черновик ${token.asset.symbol}: ${errorMessage(error)}`,
        });
      }
    }
    await this.updateSummary(cycleId, (summary) => {
      summary.draftsCreated = created;
    });
    await this.setStep(cycleId, 'drafts', 'succeeded', {
      message: `Создано черновиков: ${created}`,
    });
  }

  private async setStep(
    cycleId: string,
    key: AiCycleStepKey,
    status: AiCycleStepStatus,
    patch: { message?: string; error?: string | null } = {},
  ): Promise<void> {
    const now = new Date().toISOString();
    await this.updateSummary(cycleId, (summary) => {
      const step = summary.steps.find((item) => item.key === key);
      if (!step) return;
      step.status = status;
      if (patch.message !== undefined) step.message = patch.message;
      if (patch.error !== undefined) step.error = patch.error;
      if (status === 'running' && !step.startedAt) step.startedAt = now;
      if (['succeeded', 'failed', 'skipped'].includes(status)) step.finishedAt = now;
    });
    await this.db
      .update(aiJobs)
      .set({
        status,
        payload: { cycleId, step: key, label: STEP_LABELS[key], message: patch.message ?? null },
        error: patch.error ?? null,
        updatedAt: new Date(),
      })
      .where(and(eq(aiJobs.runId, cycleId), eq(aiJobs.stage, key)));
  }

  private async updateSummary(
    cycleId: string,
    mutate: (summary: CycleSummary) => void,
  ): Promise<void> {
    const [run] = await this.db
      .select({ summary: aiPipelineRuns.summary })
      .from(aiPipelineRuns)
      .where(eq(aiPipelineRuns.id, cycleId))
      .limit(1);
    if (!run) return;
    const summary = readSummary(run.summary);
    mutate(summary);
    await this.db
      .update(aiPipelineRuns)
      .set({ summary: summary as unknown as Record<string, unknown> })
      .where(eq(aiPipelineRuns.id, cycleId));
  }

  private async finish(
    userId: string,
    cycleId: string,
    status: 'succeeded' | 'failed',
  ): Promise<void> {
    const [run] = await this.db
      .select()
      .from(aiPipelineRuns)
      .where(eq(aiPipelineRuns.id, cycleId))
      .limit(1);
    if (!run) return;
    const summary = readSummary(run.summary);
    summary.error = status === 'failed' ? (summary.error ?? 'Цикл завершился с ошибкой') : null;
    await this.db
      .update(aiPipelineRuns)
      .set({
        status,
        finishedAt: new Date(),
        summary: summary as unknown as Record<string, unknown>,
      })
      .where(eq(aiPipelineRuns.id, cycleId));
    await this.audit.log({
      userId,
      action: status === 'succeeded' ? 'ai_trading.cycle_completed' : 'ai_trading.cycle_failed',
      entityType: 'ai_pipeline_run',
      entityId: cycleId,
      after: {
        status,
        recommended: summary.recommended,
        draftsCreated: summary.draftsCreated,
        error: summary.error,
      },
    });
  }

  private async fail(
    userId: string,
    cycleId: string,
    message: string,
    meta: CycleMeta,
  ): Promise<void> {
    const [run] = await this.db
      .select({ summary: aiPipelineRuns.summary })
      .from(aiPipelineRuns)
      .where(eq(aiPipelineRuns.id, cycleId))
      .limit(1);
    if (!run) return;
    const summary = readSummary(run.summary);
    const active = summary.steps.find((step) => step.status === 'running');
    if (active) {
      active.status = 'failed';
      active.error = message;
      active.finishedAt = new Date().toISOString();
      await this.db
        .update(aiJobs)
        .set({ status: 'failed', error: message, updatedAt: new Date() })
        .where(and(eq(aiJobs.runId, cycleId), eq(aiJobs.stage, active.key)));
    }
    for (const step of summary.steps) {
      if (step.status === 'queued') {
        step.status = 'skipped';
        step.message = 'Цикл остановлен';
        step.finishedAt = new Date().toISOString();
      }
    }
    summary.error = message;
    await this.db
      .update(aiPipelineRuns)
      .set({
        status: 'failed',
        finishedAt: new Date(),
        summary: summary as unknown as Record<string, unknown>,
      })
      .where(eq(aiPipelineRuns.id, cycleId));
    await this.db
      .update(aiJobs)
      .set({ status: 'skipped', error: 'Цикл остановлен', updatedAt: new Date() })
      .where(and(eq(aiJobs.runId, cycleId), eq(aiJobs.status, 'queued')));
    await this.audit.log({
      userId,
      action: 'ai_trading.cycle_failed',
      entityType: 'ai_pipeline_run',
      entityId: cycleId,
      after: { error: message, steps: summary.steps },
      ip: meta.ip,
      userAgent: meta.userAgent,
    });
    this.logger.warn(`AI cycle ${cycleId} failed: ${message}`);
  }

  private async recoverStaleCycles(): Promise<void> {
    const staleRows = await this.db
      .select({ id: aiPipelineRuns.id, summary: aiPipelineRuns.summary })
      .from(aiPipelineRuns)
      .where(
        and(
          inArray(aiPipelineRuns.status, ['queued', 'running']),
          sql`${aiPipelineRuns.summary}->>'kind' = 'cycle'`,
          sql`${aiPipelineRuns.createdAt} < now() - interval '20 minutes'`,
        ),
      )
      .limit(50);
    for (const run of staleRows) {
      const summary = readSummary(run.summary);
      for (const step of summary.steps) {
        if (step.status === 'running' || step.status === 'queued') {
          step.status = 'failed';
          step.error = 'AI_CYCLE_STALE';
          step.finishedAt = new Date().toISOString();
        }
      }
      summary.error = 'AI_CYCLE_STALE';
      await this.db
        .update(aiPipelineRuns)
        .set({
          status: 'failed',
          finishedAt: new Date(),
          summary: summary as unknown as Record<string, unknown>,
        })
        .where(eq(aiPipelineRuns.id, run.id));
      await this.db
        .update(aiJobs)
        .set({ status: 'failed', error: 'AI_CYCLE_STALE', updatedAt: new Date() })
        .where(and(eq(aiJobs.runId, run.id), inArray(aiJobs.status, ['queued', 'running'])));
      this.logger.warn(`Marked stale AI cycle ${run.id} as failed`);
    }
  }
}

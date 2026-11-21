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
import { and, desc, eq, gte, inArray, isNull, sql } from 'drizzle-orm';
import {
  aiJobs,
  aiPipelineRuns,
  assets,
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
  type AiCyclesResponse,
  type AiProfileToken,
  type AiSearchCandidate,
  type AiSearchNearMiss,
  type BotCreateRequest,
} from '@nexter/contracts';
import { AuditService } from '../../shared/audit/audit.service';
import { DB } from '../../shared/db/db.module';
import { TradingBotsService } from '../trading-bots/trading-bots.service';
import { AiDataService } from './ai-data.service';
import {
  DB_UNAVAILABLE_MESSAGE,
  STALE_CYCLE_MESSAGE,
  humanizeCycleError,
  isTransientDbError,
  sanitizeStoredError,
  sleep,
  withDbRetry,
} from './ai-error.helpers';
import { selectDraftCandidates } from './ai-risk.helpers';
import { AiRiskService } from './ai-risk.service';
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
  nearMisses: AiSearchNearMiss[];
  error?: string | null;
}

const STEP_LABELS: Record<AiCycleStepKey, string> = {
  data: 'Данные',
  search: 'Поиск',
  recommendations: 'Рекомендации',
  drafts: 'Черновики',
};

const MAX_CYCLE_MS = 30 * 60_000;
const MAX_DB_POLL_FAILURES = 5;

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

function sanitizeSearchError(message: string | null): string | null {
  if (!message) return null;
  if (/failed query/i.test(message) || /connection terminated|connection timeout/i.test(message)) {
    return DB_UNAVAILABLE_MESSAGE;
  }
  return message.slice(0, 300);
}

const RISK_LABELS: Record<string, string> = {
  'duplicate strategy': 'дубли стратегии',
  'no worker slots': 'нет свободных слотов',
  'budget too small': 'бюджет меньше 100 USD',
  'max invested limit': 'лимит вложений',
  'no free budget': 'свободный бюджет',
  'token exposure limit': 'лимит на токен',
};

function riskLabel(reason: string): string {
  return RISK_LABELS[reason] ?? reason;
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
    private readonly risk: AiRiskService,
    private readonly audit: AuditService,
  ) {}

  async onModuleInit(): Promise<void> {
    if (process.env.NODE_ENV === 'test') return;
    try {
      await this.recoverStaleCycles();
    } catch (error) {
      this.logger.warn(`Could not recover stale AI cycles: ${humanizeCycleError(error)}`);
    }
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
      nearMisses: [],
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

    void this.execute(userId, cycle.id, token, input, meta).catch((error) => {
      this.logger.error(`AI cycle ${cycle.id} failed: ${humanizeCycleError(error)}`);
    });

    return { cycleId: cycle.id };
  }

  async list(userId: string, limit = 20): Promise<AiCyclesResponse> {
    const profile = await this.aiTrading.getProfile(userId);
    const rows = await this.db
      .select({
        id: aiPipelineRuns.id,
        status: aiPipelineRuns.status,
        summary: aiPipelineRuns.summary,
        createdAt: aiPipelineRuns.createdAt,
        finishedAt: aiPipelineRuns.finishedAt,
      })
      .from(aiPipelineRuns)
      .where(
        and(
          eq(aiPipelineRuns.profileId, profile.id),
          sql`${aiPipelineRuns.summary}->>'kind' = 'cycle'`,
        ),
      )
      .orderBy(desc(aiPipelineRuns.createdAt))
      .limit(Math.min(50, Math.max(1, limit)));

    const summaries = rows
      .map((row) => ({ row, summary: readSummary(row.summary) }))
      .filter(
        ({ summary }) =>
          typeof summary.assetId === 'string' && typeof summary.timeframe === 'string',
      );
    const assetIds = [...new Set(summaries.map(({ summary }) => summary.assetId))];
    const assetRows =
      assetIds.length > 0
        ? await this.db
            .select({ id: assets.id, symbol: assets.symbol })
            .from(assets)
            .where(inArray(assets.id, assetIds))
        : [];
    const symbols = new Map(assetRows.map((asset) => [asset.id, asset.symbol]));

    return {
      data: summaries.map(({ row, summary }) => ({
        cycleId: row.id,
        status: row.status as AiCycleStatus['status'],
        assetId: summary.assetId,
        symbol: symbols.get(summary.assetId) ?? '—',
        timeframe: summary.timeframe,
        steps: (Array.isArray(summary.steps) ? summary.steps : []).map((step) => ({
          ...step,
          error: sanitizeStoredError(step.error),
        })),
        searchRunId: summary.searchRunId ?? null,
        recommended: Number.isFinite(summary.recommended) ? summary.recommended : 0,
        draftsCreated: Number.isFinite(summary.draftsCreated) ? summary.draftsCreated : 0,
        error: sanitizeStoredError(summary.error),
        createdAt: row.createdAt.toISOString(),
        finishedAt: row.finishedAt?.toISOString() ?? null,
      })),
    };
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
      nearMisses: summary.nearMisses ?? [],
      error: summary.error ?? null,
      createdAt: run.createdAt.toISOString(),
      finishedAt: run.finishedAt?.toISOString() ?? null,
    };
  }

  private async execute(
    userId: string,
    cycleId: string,
    token: AiProfileToken,
    input: AiCycleRequest,
    meta: CycleMeta,
  ): Promise<void> {
    try {
      await this.runDataStep(userId, cycleId, token, input, meta);
      const searchRunId = await this.runSearchStep(userId, cycleId, input, meta);
      const candidates = await this.runRecommendationsStep(userId, cycleId, searchRunId);
      await this.runDraftsStep(userId, cycleId, token, candidates, input.maxDrafts, meta);
      await this.finish(userId, cycleId, 'succeeded');
    } catch (error) {
      const message = humanizeCycleError(error);
      try {
        await this.fail(userId, cycleId, message, meta);
      } catch (failError) {
        this.logger.error(
          `Could not persist failure for AI cycle ${cycleId}: ${humanizeCycleError(failError)}`,
        );
      }
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
    const profile = await withDbRetry(() => this.aiTrading.getProfile(userId), {
      attempts: 3,
      delayMs: 500,
    });
    let lastMessage = '';
    let dbFailures = 0;
    while (Date.now() < deadline) {
      let status: Awaited<ReturnType<AiSearchService['status']>>;
      try {
        status = await withDbRetry(() => this.aiSearch.statusForProfile(profile.id, runId), {
          attempts: 3,
          delayMs: 500,
        });
        dbFailures = 0;
      } catch (error) {
        if (!isTransientDbError(error)) throw error;
        dbFailures += 1;
        this.logger.warn(
          `AI cycle ${cycleId}: search status unavailable (${dbFailures}/${MAX_DB_POLL_FAILURES})`,
        );
        if (dbFailures >= MAX_DB_POLL_FAILURES) {
          throw new ServiceUnavailableException({
            code: 'AI_CYCLE_DB_UNAVAILABLE',
            message: DB_UNAVAILABLE_MESSAGE,
          });
        }
        await sleep(2_000);
        continue;
      }
      if (status.status === 'succeeded') {
        await this.setStep(cycleId, 'search', 'succeeded', {
          message: `${status.evaluated} / ${status.total} вариантов`,
        });
        return runId;
      }
      if (status.status === 'failed' || status.status === 'cancelled') {
        throw new ServiceUnavailableException({
          code: 'AI_SEARCH_FAILED',
          message:
            sanitizeSearchError(status.error) ?? `Поиск завершился статусом ${status.status}`,
        });
      }
      const message = `Поиск: ${status.evaluated} / ${status.total}`;
      if (message !== lastMessage) {
        lastMessage = message;
        await this.setStep(cycleId, 'search', 'running', { message });
      }
      await sleep(1_000);
    }
    throw new ServiceUnavailableException({
      code: 'AI_SEARCH_TIMEOUT',
      message: 'Поиск не завершился за 30 минут',
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
      summary.nearMisses = results.nearMisses.slice(0, 5);
    });
    await this.setStep(cycleId, 'recommendations', 'succeeded', {
      message: `${recommended.length} рекомендаций`,
    });
    return recommended;
  }

  private async runDraftsStep(
    userId: string,
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

    await this.setStep(cycleId, 'drafts', 'running', { message: 'Проверяю лимиты и бюджет' });
    const capacity = await this.risk.draftCapacity(userId);
    const byId = new Map(candidates.map((candidate) => [candidate.id, candidate]));
    const selection = selectDraftCandidates(
      candidates.map((candidate) => ({
        id: candidate.id,
        assetId: token.asset.id,
        strategyKey: candidate.strategyKey,
      })),
      capacity,
      maxDrafts,
    );
    const skippedText = Object.entries(selection.skipped)
      .map(([reason, count]) => `${riskLabel(reason)} — ${count}`)
      .join('; ');
    if (selection.selected.length === 0) {
      await this.setStep(cycleId, 'drafts', 'skipped', {
        message: `Нет доступного бюджета или лимитов${skippedText ? `: ${skippedText}` : ''}`,
      });
      return;
    }

    const budget = capacity.perBotBudgetUsd;
    let created = 0;
    for (const selected of selection.selected) {
      const candidate = byId.get(selected.id);
      if (!candidate) continue;
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
          message: `Не удалось создать черновик ${token.asset.symbol}: ${humanizeCycleError(error)}`,
        });
      }
    }
    await this.updateSummary(cycleId, (summary) => {
      summary.draftsCreated = created;
    });
    await this.setStep(cycleId, 'drafts', 'succeeded', {
      message: `Создано черновиков: ${created}${skippedText ? `; пропущено: ${skippedText}` : ''}`,
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
    try {
      await withDbRetry(() =>
        this.db
          .update(aiJobs)
          .set({
            status,
            payload: {
              cycleId,
              step: key,
              label: STEP_LABELS[key],
              message: patch.message ?? null,
            },
            error: patch.error ?? null,
            updatedAt: new Date(),
          })
          .where(and(eq(aiJobs.runId, cycleId), eq(aiJobs.stage, key))),
      );
    } catch (error) {
      if (!isTransientDbError(error)) throw error;
      this.logger.warn(`AI cycle ${cycleId}: job update skipped (${humanizeCycleError(error)})`);
    }
  }

  private async updateSummary(
    cycleId: string,
    mutate: (summary: CycleSummary) => void,
  ): Promise<void> {
    try {
      await withDbRetry(async () => {
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
      });
    } catch (error) {
      if (!isTransientDbError(error)) throw error;
      this.logger.warn(
        `AI cycle ${cycleId}: summary update skipped (${humanizeCycleError(error)})`,
      );
    }
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
    await withDbRetry(
      () =>
        this.db
          .update(aiPipelineRuns)
          .set({
            status,
            finishedAt: new Date(),
            summary: summary as unknown as Record<string, unknown>,
          })
          .where(eq(aiPipelineRuns.id, cycleId)),
      { attempts: 5, delayMs: 500 },
    );
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
    const run = await withDbRetry(
      async () => {
        const [row] = await this.db
          .select({ summary: aiPipelineRuns.summary })
          .from(aiPipelineRuns)
          .where(eq(aiPipelineRuns.id, cycleId))
          .limit(1);
        return row;
      },
      { attempts: 5, delayMs: 500 },
    );
    if (!run) return;
    const summary = readSummary(run.summary);
    const active = summary.steps.find((step) => step.status === 'running');
    if (active) {
      active.status = 'failed';
      active.error = message;
      active.finishedAt = new Date().toISOString();
      await withDbRetry(
        () =>
          this.db
            .update(aiJobs)
            .set({ status: 'failed', error: message, updatedAt: new Date() })
            .where(and(eq(aiJobs.runId, cycleId), eq(aiJobs.stage, active.key))),
        { attempts: 5, delayMs: 500 },
      );
    }
    for (const step of summary.steps) {
      if (step.status === 'queued') {
        step.status = 'skipped';
        step.message = 'Цикл остановлен';
        step.finishedAt = new Date().toISOString();
      }
    }
    summary.error = message;
    await withDbRetry(
      () =>
        this.db
          .update(aiPipelineRuns)
          .set({
            status: 'failed',
            finishedAt: new Date(),
            summary: summary as unknown as Record<string, unknown>,
          })
          .where(eq(aiPipelineRuns.id, cycleId)),
      { attempts: 5, delayMs: 500 },
    );
    await withDbRetry(
      () =>
        this.db
          .update(aiJobs)
          .set({ status: 'skipped', error: 'Цикл остановлен', updatedAt: new Date() })
          .where(and(eq(aiJobs.runId, cycleId), eq(aiJobs.status, 'queued'))),
      { attempts: 3, delayMs: 500 },
    );
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
          sql`${aiPipelineRuns.createdAt} < now() - interval '45 minutes'`,
        ),
      )
      .limit(50);
    for (const run of staleRows) {
      const summary = readSummary(run.summary);
      const failed = summary.steps.find((step) => step.status === 'running');
      if (failed) {
        failed.status = 'failed';
        failed.error = STALE_CYCLE_MESSAGE;
        failed.finishedAt = new Date().toISOString();
      }
      for (const step of summary.steps) {
        if (step.status === 'queued') {
          step.status = 'skipped';
          step.message = 'Цикл остановлен';
          step.finishedAt = new Date().toISOString();
        }
      }
      summary.error = STALE_CYCLE_MESSAGE;
      await this.db
        .update(aiPipelineRuns)
        .set({
          status: 'failed',
          finishedAt: new Date(),
          summary: summary as unknown as Record<string, unknown>,
        })
        .where(eq(aiPipelineRuns.id, run.id));
      if (failed) {
        await this.db
          .update(aiJobs)
          .set({ status: 'failed', error: STALE_CYCLE_MESSAGE, updatedAt: new Date() })
          .where(and(eq(aiJobs.runId, run.id), eq(aiJobs.stage, failed.key)));
      }
      await this.db
        .update(aiJobs)
        .set({ status: 'skipped', error: 'Цикл остановлен', updatedAt: new Date() })
        .where(and(eq(aiJobs.runId, run.id), eq(aiJobs.status, 'queued')));
      this.logger.warn(`Marked stale AI cycle ${run.id} as failed`);
    }
  }
}

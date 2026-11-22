import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import {
  aiArtifacts,
  aiCandidates,
  aiJobs,
  aiPipelineRuns,
  assets,
  marketCandles,
  type Database,
} from '@nexter/db';
import type {
  AiSearchCandidate,
  AiSearchFunnel,
  AiSearchRequest,
  AiRecommendationsResponse,
  AiSearchNearMiss,
  AiSearchResults,
  AiSearchRunsResponse,
  AiSearchStats,
  AiSearchStatus,
  AiSearchTimeframe,
  BotCandle,
} from '@nexter/contracts';
import { AuditService } from '../../shared/audit/audit.service';
import { DB } from '../../shared/db/db.module';
import { runBacktest } from '../trading-bots/backtest/backtest.engine';
import { strategyByKey, strategyDefinitions } from '../trading-bots/strategies';
import { AiTradingService } from './ai-trading.service';
import {
  DB_UNAVAILABLE_MESSAGE,
  isTransientDbError,
  sanitizeStoredError,
  withDbRetry,
} from './ai-error.helpers';
import { isRecommendationExpired, recommendationExpiresAt } from './ai-recommendation';
import { evaluateVariantFolds, type VariantFoldEvaluation } from './ai-search.evaluate';
import { screenVariant } from './ai-search.screen';
import {
  buildSearchFolds,
  candlesPerDay,
  generateSearchVariants,
  historyDaysFor,
  holdoutRejection,
  minPositiveFoldsFor,
  minTradesFor,
  stabilityPctFor,
  searchWorkerCount,
  shuffleVariantsInPlace,
  MIN_SEARCH_DAYS,
  type SearchFold,
  type SearchVariant,
  type VariantMetrics,
} from './ai-search.helpers';
import {
  FULL_MAX_DRAWDOWN_PCT,
  FULL_MIN_WORST_RETURN_PCT,
  estimateRecall,
  overallPercent,
  passesFullCriteria,
  seededSample,
  type ControlEstimateInput,
  type FunnelControlHit,
  type FunnelReport,
  type FunnelStageKey,
  type FunnelStageReport,
} from './ai-search.funnel';
import {
  defaultWorkerPath,
  runWorkerPool,
  shouldUseWorkers,
  workerFileExists,
} from './ai-search.pool';

interface SearchMeta {
  ip?: string;
  userAgent?: string;
}

interface SearchProgress {
  stage?: FunnelStageKey;
  stageEvaluated?: number;
  stageTotal?: number;
  stagePercent?: number;
  percent?: number;
  evaluated: number;
  total: number;
}

interface SearchRunSummary {
  assetId: string;
  timeframe: AiSearchTimeframe;
  variants: number;
  lookbackDays?: number;
  progress: SearchProgress;
  stats?: AiSearchStats;
  funnel?: FunnelReport;
  error?: string;
}

interface SearchCandidate extends VariantMetrics {
  variant: SearchVariant;
  holdoutReturnPct: string | null;
}

const FEE_BPS = 25;
const SLIPPAGE_BPS = 10;
const SCREEN_CHUNK = 250;

function envCount(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value >= 0 ? Math.floor(value) : fallback;
}

function toBotCandles(
  rows: Array<{
    openTime: Date;
    open: string;
    high: string;
    low: string;
    close: string;
    volumeUsd: string | null;
    quality: string;
  }>,
): BotCandle[] {
  return rows.map((row) => ({
    date: row.openTime.toISOString(),
    openUsd: row.open,
    highUsd: row.high,
    lowUsd: row.low,
    closeUsd: row.close,
    volumeUsd: row.volumeUsd,
    synthetic: row.quality !== 'ok',
  }));
}

@Injectable()
export class AiSearchService {
  private readonly logger = new Logger(AiSearchService.name);
  private readonly active = new Map<string, { cancelled: boolean }>();

  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly aiTrading: AiTradingService,
    private readonly audit: AuditService,
  ) {}

  async start(
    userId: string,
    input: AiSearchRequest,
    meta: SearchMeta,
  ): Promise<{ runId: string }> {
    const profile = await this.aiTrading.getProfile(userId);
    const tokens = await this.aiTrading.listTokens(userId);
    const token = tokens.find((item) => item.enabled && item.asset.id === input.assetId);
    if (!token) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'AI token not found' });
    }
    if (!token.timeframes.includes(input.timeframe)) {
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: 'Timeframe is not configured for this token',
      });
    }

    const candles = await this.loadCandles(input.assetId, input.timeframe);
    const availableDays = historyDaysFor(candles, input.timeframe);
    if (availableDays < MIN_SEARCH_DAYS) {
      const required = MIN_SEARCH_DAYS * candlesPerDay(input.timeframe);
      throw new UnprocessableEntityException({
        code: 'AI_DATA_INSUFFICIENT',
        message: `Недостаточно истории для поиска: ${availableDays} дн. (${candles.length} свечей), нужно минимум ${MIN_SEARCH_DAYS} дн.`,
        details: { found: candles.length, required, availableDays, minDays: MIN_SEARCH_DAYS },
      });
    }
    const lookbackDays = Math.min(180, availableDays);

    const variants = generateSearchVariants(strategyDefinitions, input.variants, input.seed ?? 7);
    if (variants.length === 0) {
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: 'No valid strategy variants to test',
      });
    }

    if (this.shouldRunInline()) {
      const [run] = await this.db
        .insert(aiPipelineRuns)
        .values({
          profileId: profile.id,
          trigger: 'manual',
          status: 'running',
          startedAt: new Date(),
          summary: {
            assetId: input.assetId,
            timeframe: input.timeframe,
            variants: variants.length,
            lookbackDays,
            progress: { evaluated: 0, total: variants.length },
          } satisfies SearchRunSummary,
        })
        .returning({ id: aiPipelineRuns.id });
      if (!run) throw new Error('Failed to create search run');

      const control = { cancelled: false };
      this.active.set(run.id, control);
      void this.execute(
        userId,
        run.id,
        profile.id,
        input,
        candles,
        variants,
        lookbackDays,
        control,
        meta,
      ).catch(async (error: unknown) => {
        this.active.delete(run.id);
        await this.failRun(userId, run.id, input, variants.length, error);
      });

      return { runId: run.id };
    }

    const created = await this.db.transaction(async (tx) => {
      const [run] = await tx
        .insert(aiPipelineRuns)
        .values({
          profileId: profile.id,
          trigger: 'manual',
          status: 'queued',
          summary: {
            assetId: input.assetId,
            timeframe: input.timeframe,
            variants: variants.length,
            lookbackDays,
            progress: { evaluated: 0, total: variants.length },
          } satisfies SearchRunSummary,
        })
        .returning({ id: aiPipelineRuns.id });
      if (!run) throw new Error('Failed to create search run');
      await tx.insert(aiJobs).values({
        profileId: profile.id,
        runId: run.id,
        service: 'ai_search',
        stage: 'search',
        assetId: input.assetId,
        timeframe: input.timeframe,
        status: 'queued',
        payload: { userId, input, meta },
        idempotencyKey: `search:${run.id}`,
      });
      return run;
    });

    return { runId: created.id };
  }

  private shouldRunInline(): boolean {
    return process.env.NODE_ENV === 'test' || process.env.AI_SEARCH_INLINE === '1';
  }

  private async failRun(
    userId: string,
    runId: string,
    input: AiSearchRequest,
    variantCount: number,
    error: unknown,
  ): Promise<void> {
    const message =
      sanitizeStoredError(error instanceof Error ? error.message : String(error)) ??
      'Поиск завершился с ошибкой';
    try {
      await withDbRetry(
        () =>
          this.db
            .update(aiPipelineRuns)
            .set({
              status: 'failed',
              finishedAt: new Date(),
              summary: {
                assetId: input.assetId,
                timeframe: input.timeframe,
                variants: variantCount,
                progress: { evaluated: 0, total: variantCount },
                error: message,
              } satisfies SearchRunSummary,
            })
            .where(eq(aiPipelineRuns.id, runId)),
        { attempts: 5, delayMs: 500 },
      );
    } catch (dbError) {
      this.logger.error(
        `Could not persist failure for AI search ${runId}: ${
          isTransientDbError(dbError) ? DB_UNAVAILABLE_MESSAGE : String(dbError)
        }`,
      );
    }
  }

  async runQueuedJob(job: {
    id: string;
    runId: string;
    profileId: string;
    payload: Record<string, unknown>;
  }): Promise<void> {
    const userPayload = job.payload as {
      userId?: unknown;
      input?: unknown;
      meta?: unknown;
    };
    const input = userPayload.input as AiSearchRequest | undefined;
    const userId = typeof userPayload.userId === 'string' ? userPayload.userId : null;
    if (!input || !userId) {
      await this.setJobStatus(job.id, 'failed', 'AI_SEARCH_JOB_INVALID');
      return;
    }
    const meta = (userPayload.meta ?? {}) as SearchMeta;

    const [run] = await this.db
      .select({ status: aiPipelineRuns.status, startedAt: aiPipelineRuns.startedAt })
      .from(aiPipelineRuns)
      .where(eq(aiPipelineRuns.id, job.runId))
      .limit(1);
    if (!run) {
      await this.setJobStatus(job.id, 'failed', 'AI_SEARCH_RUN_MISSING');
      return;
    }
    if (run.status === 'succeeded') {
      await this.setJobStatus(job.id, 'succeeded');
      return;
    }
    if (run.status === 'cancelled') {
      await this.setJobStatus(job.id, 'cancelled', 'Отменено владельцем');
      return;
    }
    if (run.status === 'failed') {
      await this.setJobStatus(job.id, 'failed', 'AI_SEARCH_RUN_FAILED');
      return;
    }

    const candles = await this.loadCandles(input.assetId, input.timeframe);
    const availableDays = historyDaysFor(candles, input.timeframe);
    if (availableDays < MIN_SEARCH_DAYS) {
      const message = `Недостаточно истории для поиска: ${availableDays} дн.`;
      await this.setJobStatus(job.id, 'failed', message);
      await this.failRun(userId, job.runId, input, 0, new Error(message));
      return;
    }
    const variants = generateSearchVariants(strategyDefinitions, input.variants, input.seed ?? 7);
    const lookbackDays = Math.min(180, availableDays);
    const control = { cancelled: false };
    this.active.set(job.runId, control);
    await this.db
      .update(aiPipelineRuns)
      .set({ status: 'running', startedAt: run.startedAt ?? new Date() })
      .where(eq(aiPipelineRuns.id, job.runId));

    try {
      await this.execute(
        userId,
        job.runId,
        job.profileId,
        input,
        candles,
        variants,
        lookbackDays,
        control,
        meta,
      );
      const [after] = await this.db
        .select({ status: aiPipelineRuns.status })
        .from(aiPipelineRuns)
        .where(eq(aiPipelineRuns.id, job.runId))
        .limit(1);
      await this.setJobStatus(
        job.id,
        after?.status === 'cancelled' ? 'cancelled' : 'succeeded',
        after?.status === 'cancelled' ? 'Отменено владельцем' : null,
      );
    } catch (error) {
      await this.failRun(userId, job.runId, input, variants.length, error);
      await this.setJobStatus(
        job.id,
        'failed',
        error instanceof Error ? error.message.slice(0, 500) : 'AI_SEARCH_FAILED',
      );
    } finally {
      this.active.delete(job.runId);
    }
  }

  private async setJobStatus(
    jobId: string,
    status: string,
    error: string | null = null,
  ): Promise<void> {
    await this.db
      .update(aiJobs)
      .set({
        status,
        error,
        updatedAt: new Date(),
        lockedBy: null,
        lockedAt: null,
        heartbeatAt: new Date(),
      })
      .where(eq(aiJobs.id, jobId));
  }

  async listRuns(userId: string, limit = 20): Promise<AiSearchRunsResponse> {
    const profile = await this.aiTrading.getProfile(userId);
    const rows = await this.db
      .select()
      .from(aiPipelineRuns)
      .where(
        and(
          eq(aiPipelineRuns.profileId, profile.id),
          sql`${aiPipelineRuns.summary}->>'variants' is not null`,
        ),
      )
      .orderBy(desc(aiPipelineRuns.createdAt))
      .limit(Math.min(50, Math.max(1, limit)));

    const assetIds = [
      ...new Set(
        rows
          .map((row) => (row.summary as Record<string, unknown>).assetId)
          .filter((value): value is string => typeof value === 'string'),
      ),
    ];
    const assetRows =
      assetIds.length > 0
        ? await this.db
            .select({ id: assets.id, symbol: assets.symbol, name: assets.name })
            .from(assets)
            .where(inArray(assets.id, assetIds))
        : [];
    const assetsById = new Map(assetRows.map((asset) => [asset.id, asset]));

    return {
      data: rows.flatMap((row) => {
        const summary = row.summary as Partial<SearchRunSummary> & Record<string, unknown>;
        const assetId = typeof summary.assetId === 'string' ? summary.assetId : null;
        const asset = assetId ? assetsById.get(assetId) : null;
        if (!assetId || !asset) return [];
        return [
          {
            runId: row.id,
            assetId,
            symbol: asset.symbol,
            name: asset.name,
            timeframe: typeof summary.timeframe === 'string' ? summary.timeframe : '1h',
            status: row.status as AiSearchStatus['status'],
            variants: summary.variants ?? summary.progress?.total ?? 0,
            recommended: summary.stats?.recommended ?? 0,
            createdAt: row.createdAt.toISOString(),
            finishedAt: row.finishedAt?.toISOString() ?? null,
            stats: summary.stats ?? null,
          },
        ];
      }),
    };
  }

  async listRecommendations(userId: string): Promise<AiRecommendationsResponse> {
    const profile = await this.aiTrading.getProfile(userId);
    const rows = await this.db
      .select({ candidate: aiCandidates, asset: assets })
      .from(aiCandidates)
      .innerJoin(assets, eq(assets.id, aiCandidates.assetId))
      .where(
        and(
          eq(aiCandidates.profileId, profile.id),
          inArray(aiCandidates.status, ['recommended', 'accepted']),
        ),
      )
      .orderBy(desc(aiCandidates.createdAt))
      .limit(100);

    return {
      data: rows.map(({ candidate, asset }) => {
        const metrics = candidate.metrics as Record<string, unknown>;
        const value = (key: string, fallback: string): string =>
          typeof metrics[key] === 'string' ? (metrics[key] as string) : fallback;
        const expiresAt = recommendationExpiresAt(candidate.createdAt, metrics);
        const status = candidate.status === 'accepted' ? 'accepted' : 'recommended';
        const horizonDays =
          typeof metrics.horizonDays === 'number' ? Math.floor(metrics.horizonDays) : 7;
        const candidateDrawdown = Number(value('maxDrawdownPct', '20'));
        const worstOos = Number(value('oosWorstReturnPct', '-15'));
        const pnlThreshold = Math.min(-5, Number.isFinite(worstOos) ? worstOos : -5).toFixed(2);
        const drawdownThreshold = Math.max(15, candidateDrawdown * 1.5).toFixed(2);
        const allocationPct = Math.min(profile.maxWorkerAllocationPct, profile.maxTokenExposurePct);
        const allocation = Math.max(100, (Number(profile.budgetUsd) * allocationPct) / 100).toFixed(
          2,
        );
        const invalidationRules = [
          {
            code: 'DRAWDOWN' as const,
            label: 'Просадка',
            severity: 'stop' as const,
            detail: `Остановить при просадке выше ${drawdownThreshold}%`,
          },
          {
            code: 'DAILY_LOSS' as const,
            label: 'Дневной убыток',
            severity: 'stop' as const,
            detail: `Остановить при дневном убытке выше ${profile.dailyLossLimitPct}%`,
          },
          {
            code: 'STALE_DATA' as const,
            label: 'Свежие данные',
            severity: 'review' as const,
            detail: 'Пересмотреть, если нет тиков более 10 минут',
          },
          {
            code: 'HORIZON_EXPIRED' as const,
            label: 'Горизонт',
            severity: 'review' as const,
            detail: `Пересмотреть после ${horizonDays} дн. с запуска`,
          },
          {
            code: 'NEGATIVE_PNL' as const,
            label: 'P&L',
            severity: 'review' as const,
            detail: `Пересмотреть при P&L ниже ${pnlThreshold}%`,
          },
          {
            code: 'RECOMMENDATION_EXPIRED' as const,
            label: 'TTL',
            severity: 'review' as const,
            detail: `Действует до ${expiresAt.toISOString().slice(0, 10)}`,
          },
        ];
        return {
          id: candidate.id,
          assetId: asset.id,
          symbol: asset.symbol,
          name: asset.name,
          timeframe: candidate.timeframe,
          status,
          strategyKey: candidate.strategyKey,
          strategyName: strategyByKey.get(candidate.strategyKey)?.name ?? candidate.strategyKey,
          params: candidate.params,
          oosMedianReturnPct: value('oosMedianReturnPct', '0'),
          oosMeanReturnPct: value('oosMeanReturnPct', '0'),
          oosWorstReturnPct: value('oosWorstReturnPct', '0'),
          maxDrawdownPct: value('maxDrawdownPct', '0'),
          trades: typeof metrics.trades === 'number' ? metrics.trades : 0,
          positiveFolds: typeof metrics.positiveFolds === 'number' ? metrics.positiveFolds : 0,
          stabilityPct: value('stabilityPct', '0'),
          holdoutReturnPct:
            typeof metrics.holdoutReturnPct === 'string' ? metrics.holdoutReturnPct : null,
          policyScore: candidate.policyScore ?? '0',
          suggestedAllocationUsd: allocation,
          invalidationRules,
          linkedBotId: typeof metrics.botId === 'string' ? metrics.botId : null,
          createdAt: candidate.createdAt.toISOString(),
          expiresAt: expiresAt.toISOString(),
          expired: isRecommendationExpired(candidate.createdAt, metrics),
        };
      }),
    };
  }

  async recommendation(
    userId: string,
    id: string,
  ): Promise<AiRecommendationsResponse['data'][number]> {
    const list = await this.listRecommendations(userId);
    const found = list.data.find((item) => item.id === id);
    if (!found) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Recommendation not found' });
    }
    return found;
  }

  async reject(
    userId: string,
    id: string,
    meta: SearchMeta,
  ): Promise<{ id: string; status: 'rejected' }> {
    const profile = await this.aiTrading.getProfile(userId);
    const [candidate] = await this.db
      .select()
      .from(aiCandidates)
      .where(and(eq(aiCandidates.id, id), eq(aiCandidates.profileId, profile.id)))
      .limit(1);
    if (!candidate) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Recommendation not found' });
    }
    if (candidate.status !== 'recommended') {
      throw new ConflictException({
        code: 'AI_RECOMMENDATION_NOT_ACTIONABLE',
        message: 'Recommendation is no longer actionable',
      });
    }
    await this.db
      .update(aiCandidates)
      .set({ status: 'rejected', updatedAt: new Date() })
      .where(eq(aiCandidates.id, id));
    await this.audit.log({
      userId,
      action: 'ai_trading.recommendation_rejected',
      entityType: 'ai_candidate',
      entityId: id,
      before: { status: candidate.status },
      after: { status: 'rejected' },
      ip: meta.ip,
      userAgent: meta.userAgent,
    });
    return { id, status: 'rejected' };
  }

  async status(userId: string, runId: string): Promise<AiSearchStatus> {
    const profile = await this.aiTrading.getProfile(userId);
    return this.statusForProfile(profile.id, runId);
  }

  async statusForProfile(profileId: string, runId: string): Promise<AiSearchStatus> {
    const run = await this.requireRun(profileId, runId);
    const summary = run.summary as unknown as Partial<SearchRunSummary>;
    const progress = summary.progress;
    const evaluated = progress?.evaluated ?? 0;
    const total = progress?.total ?? summary.variants ?? 0;
    return {
      runId: run.id,
      status: run.status as AiSearchStatus['status'],
      evaluated,
      total,
      percent:
        progress?.percent ?? (total > 0 ? Math.min(100, Math.round((evaluated / total) * 100)) : 0),
      stage: progress?.stage ?? null,
      stageEvaluated: progress?.stageEvaluated ?? 0,
      stageTotal: progress?.stageTotal ?? 0,
      stagePercent: progress?.stagePercent ?? 0,
      stats: summary.stats ?? null,
      error: summary.error ?? null,
      startedAt: run.startedAt?.toISOString() ?? null,
      finishedAt: run.finishedAt?.toISOString() ?? null,
    };
  }

  async results(userId: string, runId: string): Promise<AiSearchResults> {
    const profile = await this.aiTrading.getProfile(userId);
    const run = await this.requireRun(profile.id, runId);
    const [artifact] = await this.db
      .select()
      .from(aiArtifacts)
      .where(and(eq(aiArtifacts.runId, runId), eq(aiArtifacts.type, 'search')))
      .limit(1);
    const rows = await this.db
      .select()
      .from(aiCandidates)
      .where(eq(aiCandidates.runId, runId))
      .orderBy(desc(aiCandidates.policyScore))
      .limit(20);
    const payload = (artifact?.payload ?? {}) as Record<string, unknown>;
    return {
      runId,
      status: run.status as AiSearchResults['status'],
      stats: (payload.stats as AiSearchStats | undefined) ?? {
        total: 0,
        evaluated: 0,
        screenedOut: 0,
        probeOut: 0,
        budgetOut: 0,
        valid: 0,
        oosPassed: 0,
        holdoutTested: 0,
        recommended: 0,
        bestReturnPct: '0',
        averageReturnPct: '0',
        medianReturnPct: '0',
        worstReturnPct: '0',
        profitablePct: '0',
        averageDrawdownPct: '0',
        bestOosReturnPct: '0',
        medianOosReturnPct: '0',
        worstOosReturnPct: '0',
        stabilityPct: '0',
        holdoutReturnPct: null,
        histogram: [],
      },
      funnel: (payload.funnel as AiSearchFunnel | undefined) ?? null,
      candidates: rows.map((row) => this.toCandidate(row)),
      nearMisses: (payload.nearMisses as AiSearchNearMiss[] | undefined) ?? [],
      rejectionReasons: (payload.rejectionReasons as Record<string, number> | undefined) ?? {},
    };
  }

  async cancel(userId: string, runId: string): Promise<AiSearchStatus> {
    const profile = await this.aiTrading.getProfile(userId);
    const run = await this.requireRun(profile.id, runId);
    const control = this.active.get(runId);
    if (control) control.cancelled = true;
    if (run.status === 'running' || run.status === 'queued') {
      await this.db
        .update(aiPipelineRuns)
        .set({ status: 'cancelled', finishedAt: new Date() })
        .where(eq(aiPipelineRuns.id, runId));
      await this.db
        .update(aiJobs)
        .set({ status: 'cancelled', error: 'Отменено владельцем', updatedAt: new Date() })
        .where(
          and(
            eq(aiJobs.runId, runId),
            eq(aiJobs.service, 'ai_search'),
            inArray(aiJobs.status, ['queued', 'running']),
          ),
        );
    }
    return this.status(userId, runId);
  }

  private async execute(
    userId: string,
    runId: string,
    profileId: string,
    input: AiSearchRequest,
    candles: BotCandle[],
    variants: SearchVariant[],
    lookbackDays: number,
    control: { cancelled: boolean },
    meta: SearchMeta,
  ): Promise<void> {
    // The generator groups variants by strategy. Shuffle deterministically so
    // worker chunks mix fast and slow strategies instead of waiting for one
    // slow stateful chunk.
    shuffleVariantsInPlace(variants, input.seed ?? 7);
    const folds = buildSearchFolds(candles, input.timeframe, lookbackDays);
    const foldCount = folds.folds.length;
    const minTrades = minTradesFor(foldCount);
    const minPositiveFolds = minPositiveFoldsFor(foldCount);
    const metrics: Array<SearchCandidate> = [];
    const allMetrics: Array<{
      returnPct: number;
      drawdown: number;
      positiveFolds: number;
      trades: number;
      policyScore: string;
      variant: SearchVariant;
    }> = [];
    const rejectionReasons: Record<string, number> = {};
    const nearMisses: AiSearchNearMiss[] = [];
    const controlHits: FunnelControlHit[] = [];
    let evaluated = 0;

    const stageKeys: FunnelStageKey[] = ['screen', 'probe', 'budget', 'full', 'control', 'holdout'];
    const stages = new Map<FunnelStageKey, FunnelStageReport>();
    for (const key of stageKeys) {
      stages.set(key, {
        key,
        input: 0,
        output: 0,
        rejected: 0,
        durationMs: 0,
        controlSampled: 0,
        controlPassed: 0,
      });
    }
    const stageReport = (key: FunnelStageKey): FunnelStageReport =>
      stages.get(key) as FunnelStageReport;

    const probeFoldCount = Math.min(
      envCount('AI_SEARCH_PROBE_FOLDS', 0),
      Math.max(0, folds.folds.length),
    );
    const probeEnabled = probeFoldCount > 0;
    const fullBudget = envCount('AI_SEARCH_FULL_BUDGET', 8000);
    const budgetEnabled = fullBudget > 0;
    const controlSampleSize = envCount('AI_SEARCH_CONTROL_SAMPLE', 50);
    const activeStages: FunnelStageKey[] = ['screen'];
    if (probeEnabled) activeStages.push('probe');
    if (budgetEnabled) activeStages.push('budget');
    activeStages.push('full');
    if (controlSampleSize > 0) activeStages.push('control');
    activeStages.push('holdout');

    const progressFor = (
      stage: FunnelStageKey,
      stageEvaluated: number,
      stageTotal: number,
    ): SearchProgress => {
      const fraction = stageTotal > 0 ? stageEvaluated / stageTotal : 0;
      const percent = overallPercent(activeStages, stage, fraction);
      return {
        stage,
        stageEvaluated,
        stageTotal,
        stagePercent: Math.round(fraction * 100),
        percent,
        evaluated: Math.round((percent / 100) * variants.length),
        total: variants.length,
      };
    };

    let lastWriteAt = 0;
    let writeChain = Promise.resolve();
    const writeProgress = (progress: SearchProgress, force = false): Promise<void> => {
      const now = Date.now();
      if (!force && now - lastWriteAt < 1000) return writeChain;
      lastWriteAt = now;
      writeChain = writeChain
        .then(() => this.updateProgress(runId, input, progress))
        .catch(() => undefined);
      return writeChain;
    };

    const reject = (reason: string) => {
      rejectionReasons[reason] = (rejectionReasons[reason] ?? 0) + 1;
    };
    const rejectMany = (reason: string, count: number) => {
      if (count > 0) rejectionReasons[reason] = (rejectionReasons[reason] ?? 0) + count;
    };

    const rememberNearMiss = (
      aggregate: VariantMetrics,
      variant: SearchVariant,
      reasons: string[],
      holdoutReturnPct: string | null = null,
      holdoutDrawdownPct: string | null = null,
    ) => {
      if (aggregate.trades <= 0 || Number(aggregate.oosMedianReturnPct) <= 0) return;
      nearMisses.push({
        strategyKey: variant.strategyKey,
        strategyName: strategyByKey.get(variant.strategyKey)?.name ?? variant.strategyKey,
        params: variant.params,
        oosMedianReturnPct: aggregate.oosMedianReturnPct,
        oosMeanReturnPct: aggregate.oosMeanReturnPct,
        oosWorstReturnPct: aggregate.oosWorstReturnPct,
        maxDrawdownPct: aggregate.maxDrawdownPct,
        trades: aggregate.trades,
        positiveFolds: aggregate.positiveFolds,
        stabilityPct: aggregate.stabilityPct,
        holdoutReturnPct,
        holdoutDrawdownPct,
        policyScore: aggregate.policyScore,
        reasons,
      });
    };

    const cancelRun = async () => {
      await this.db
        .update(aiPipelineRuns)
        .set({ status: 'cancelled', finishedAt: new Date() })
        .where(eq(aiPipelineRuns.id, runId));
      this.active.delete(runId);
    };

    const processEvaluation = (variant: SearchVariant, evaluation: VariantFoldEvaluation) => {
      if (evaluation.unknownStrategy) {
        reject('unknown strategy');
        return;
      }
      const aggregate = evaluation.aggregate;
      if (!aggregate) {
        reject('backtest failed');
        return;
      }

      allMetrics.push({
        returnPct: Number(aggregate.oosMedianReturnPct),
        drawdown: Number(aggregate.maxDrawdownPct),
        positiveFolds: aggregate.positiveFolds,
        trades: aggregate.trades,
        policyScore: aggregate.policyScore,
        variant,
      });
      if (aggregate.trades < minTrades) {
        reject('too few trades');
        rememberNearMiss(aggregate, variant, ['too few trades']);
        return;
      }
      if (Number(aggregate.oosMedianReturnPct) <= 0) {
        reject('non-positive OOS median');
        return;
      }
      if (aggregate.positiveFolds < minPositiveFolds) {
        reject('unstable folds');
        rememberNearMiss(aggregate, variant, ['unstable folds']);
        return;
      }
      if (Number(aggregate.maxDrawdownPct) > FULL_MAX_DRAWDOWN_PCT) {
        reject('drawdown too high');
        rememberNearMiss(aggregate, variant, ['drawdown too high']);
        return;
      }
      if (Number(aggregate.oosWorstReturnPct) < FULL_MIN_WORST_RETURN_PCT) {
        reject('worst fold too deep');
        rememberNearMiss(aggregate, variant, ['worst fold too deep']);
        return;
      }

      metrics.push({ ...aggregate, variant, holdoutReturnPct: null });
    };

    // Stage: safe signal screen over every proposal. Only "too few entry signals"
    // is eligible for the false-negative control sample; invalid params cannot pass.
    let stageStarted = Date.now();
    const screenSurvivors: SearchVariant[] = [];
    const softRejected: SearchVariant[] = [];
    for (let offset = 0; offset < variants.length; offset += SCREEN_CHUNK) {
      if (control.cancelled) {
        await cancelRun();
        return;
      }
      const chunk = variants.slice(offset, offset + SCREEN_CHUNK);
      for (const variant of chunk) {
        const screen = screenVariant(variant, folds.folds, {
          timeframe: input.timeframe,
          minTrades,
        });
        if (screen.ok) {
          screenSurvivors.push(variant);
        } else {
          reject(screen.reason ?? 'screen rejected');
          if (screen.reason === 'too few entry signals') softRejected.push(variant);
        }
      }
      const done = Math.min(variants.length, offset + SCREEN_CHUNK);
      await writeProgress(progressFor('screen', done, variants.length));
      await new Promise((resolve) => setImmediate(resolve));
    }
    stageReport('screen').input = variants.length;
    stageReport('screen').output = screenSurvivors.length;
    stageReport('screen').rejected = variants.length - screenSurvivors.length;
    stageReport('screen').durationMs = Date.now() - stageStarted;
    await writeProgress(progressFor('screen', variants.length, variants.length), true);

    // Stage: one-fold (or N-fold) probe. This is probabilistic: a variant can
    // trade only in later folds, so the probe has its own control sample.
    let probeSurvivors = screenSurvivors;
    const probeRejected: SearchVariant[] = [];
    let probeEvaluations: VariantFoldEvaluation[] = [];
    if (probeEnabled && screenSurvivors.length > 0) {
      stageStarted = Date.now();
      const results = await this.evaluateVariants(
        screenSurvivors,
        folds.folds.slice(0, probeFoldCount),
        input.timeframe,
        control,
        (done) => {
          void writeProgress(progressFor('probe', done, screenSurvivors.length));
        },
      );
      if (!results) {
        await cancelRun();
        return;
      }
      probeEvaluations = results;
      probeSurvivors = [];
      for (let index = 0; index < screenSurvivors.length; index += 1) {
        const variant = screenSurvivors[index] as SearchVariant;
        const result = results[index];
        if (result?.aggregate && result.aggregate.trades >= 1) {
          probeSurvivors.push(variant);
        } else {
          probeRejected.push(variant);
          reject('too few probe trades');
        }
      }
      stageReport('probe').durationMs = Date.now() - stageStarted;
    }
    stageReport('probe').input = screenSurvivors.length;
    stageReport('probe').output = probeSurvivors.length;
    stageReport('probe').rejected = probeRejected.length;
    await writeProgress(progressFor('probe', screenSurvivors.length, screenSurvivors.length), true);

    // Stage: hard evaluation budget. Ranking is only a priority order; the
    // random exploration slice keeps a statistical path for promising variants
    // outside the top of the probe ranking.
    let fullVariants = probeSurvivors;
    let budgetDropped: SearchVariant[] = [];
    stageStarted = Date.now();
    if (budgetEnabled && probeSurvivors.length > fullBudget) {
      if (probeEnabled) {
        const scored = probeSurvivors.map((variant, index) => ({
          variant,
          score: Number(probeEvaluations[index]?.aggregate?.policyScore ?? 0),
        }));
        scored.sort((left, right) => right.score - left.score);
        const exploration = Math.max(1, Math.round(fullBudget * 0.02));
        const topCount = Math.max(0, fullBudget - exploration);
        const top = scored.slice(0, topCount).map((item) => item.variant);
        const rest = scored.slice(topCount).map((item) => item.variant);
        const explorationSlice = seededSample(rest, exploration, `${runId}:budget`);
        const keep = new Set<SearchVariant>(explorationSlice);
        fullVariants = [...top, ...explorationSlice];
        budgetDropped = rest.filter((variant) => !keep.has(variant));
      } else {
        fullVariants = seededSample(probeSurvivors, fullBudget, `${runId}:budget`);
        const keep = new Set<SearchVariant>(fullVariants);
        budgetDropped = probeSurvivors.filter((variant) => !keep.has(variant));
      }
      rejectMany('budget cap', budgetDropped.length);
    }
    stageReport('budget').input = probeSurvivors.length;
    stageReport('budget').output = fullVariants.length;
    stageReport('budget').rejected = budgetDropped.length;
    stageReport('budget').durationMs = Date.now() - stageStarted;
    await writeProgress(progressFor('budget', probeSurvivors.length, probeSurvivors.length), true);

    // Stage: full walk-forward evaluation of the survivors.
    stageStarted = Date.now();
    if (fullVariants.length > 0) {
      const results = await this.evaluateVariants(
        fullVariants,
        folds.folds,
        input.timeframe,
        control,
        (done) => {
          evaluated = done;
          void writeProgress(progressFor('full', done, fullVariants.length));
        },
      );
      if (!results) {
        await cancelRun();
        return;
      }
      evaluated = fullVariants.length;
      results.forEach((result, index) => {
        const variant = fullVariants[index];
        if (variant) processEvaluation(variant, result);
      });
    }
    stageReport('full').input = fullVariants.length;
    stageReport('full').output = metrics.length;
    stageReport('full').rejected = fullVariants.length - metrics.length;
    stageReport('full').durationMs = Date.now() - stageStarted;
    await writeProgress(progressFor('full', fullVariants.length, fullVariants.length), true);

    // Stage: diagnostic control sample. Rejected variants are fully evaluated so
    // the report can estimate false negatives, but they never become candidates.
    const controlEstimates: ControlEstimateInput[] = [];
    stageStarted = Date.now();
    if (controlSampleSize > 0) {
      const groups: Array<{ stage: FunnelStageKey; sample: SearchVariant[]; rejected: number }> = [
        {
          stage: 'screen',
          sample: seededSample(softRejected, controlSampleSize, `${runId}:screen`),
          rejected: softRejected.length,
        },
        {
          stage: 'probe',
          sample: seededSample(probeRejected, controlSampleSize, `${runId}:probe`),
          rejected: probeRejected.length,
        },
        {
          stage: 'budget',
          sample: seededSample(budgetDropped, controlSampleSize, `${runId}:budget`),
          rejected: budgetDropped.length,
        },
      ];
      const controlVariants = groups.flatMap((group) => group.sample);
      stageReport('control').input = controlVariants.length;
      if (controlVariants.length > 0) {
        const results = await this.evaluateVariants(
          controlVariants,
          folds.folds,
          input.timeframe,
          control,
          (done) => {
            void writeProgress(progressFor('control', done, controlVariants.length));
          },
        );
        if (!results) {
          await cancelRun();
          return;
        }
        let cursor = 0;
        for (const group of groups) {
          const start = cursor;
          cursor += group.sample.length;
          let passed = 0;
          for (let index = start; index < cursor; index += 1) {
            const variant = controlVariants[index] as SearchVariant;
            const result = results[index];
            if (
              !result?.aggregate ||
              !passesFullCriteria(result.aggregate, minTrades, minPositiveFolds)
            ) {
              continue;
            }
            passed += 1;
            if (controlHits.length < 10) {
              controlHits.push({
                stage: group.stage,
                strategyKey: variant.strategyKey,
                params: variant.params,
                oosMedianReturnPct: result.aggregate.oosMedianReturnPct,
                maxDrawdownPct: result.aggregate.maxDrawdownPct,
                trades: result.aggregate.trades,
                positiveFolds: result.aggregate.positiveFolds,
              });
            }
          }
          const stage = stageReport(group.stage);
          stage.controlSampled = group.sample.length;
          stage.controlPassed = passed;
          controlEstimates.push({
            rejected: group.rejected,
            sampled: group.sample.length,
            passed,
          });
        }
        stageReport('control').output = controlEstimates.reduce(
          (sum, item) => sum + item.passed,
          0,
        );
        stageReport('control').rejected = controlVariants.length - stageReport('control').output;
      }
    }
    stageReport('control').durationMs = Date.now() - stageStarted;
    await writeProgress(progressFor('control', 1, 1), true);

    // Stage: final untouched holdout for the top OOS candidates.
    metrics.sort((left, right) => Number(right.policyScore) - Number(left.policyScore));
    stageStarted = Date.now();
    const top = metrics.slice(0, 10);
    for (const candidate of top) {
      const definition = strategyByKey.get(candidate.variant.strategyKey);
      if (!definition) continue;
      try {
        const result = runBacktest(
          definition,
          candidate.variant.params,
          [...folds.holdoutWarmup, ...folds.holdout],
          {
            initialCapitalUsd: '1000',
            feeBps: FEE_BPS,
            slippageBps: SLIPPAGE_BPS,
            changeLookbackCandles: candlesPerDay(input.timeframe),
            warmupCandles: folds.holdoutWarmupCandles,
          },
        );
        const returnPct = Number(result.stats.totalReturnPct);
        const drawdown = Number(result.stats.maxDrawdownPct);
        candidate.holdoutReturnPct = result.stats.totalReturnPct;
        const rejection = holdoutRejection(returnPct, drawdown, FULL_MAX_DRAWDOWN_PCT);
        if (rejection !== null) {
          candidate.policyScore = '0';
          reject(rejection);
          rememberNearMiss(
            {
              oosMedianReturnPct: candidate.oosMedianReturnPct,
              oosMeanReturnPct: candidate.oosMeanReturnPct,
              oosWorstReturnPct: candidate.oosWorstReturnPct,
              maxDrawdownPct: candidate.maxDrawdownPct,
              trades: candidate.trades,
              positiveFolds: candidate.positiveFolds,
              stabilityPct: candidate.stabilityPct,
              policyScore: '0',
            },
            candidate.variant,
            [rejection],
            candidate.holdoutReturnPct,
            result.stats.maxDrawdownPct,
          );
        } else if (Number(candidate.policyScore) <= 0) {
          reject('non-positive policy score');
          rememberNearMiss(
            {
              oosMedianReturnPct: candidate.oosMedianReturnPct,
              oosMeanReturnPct: candidate.oosMeanReturnPct,
              oosWorstReturnPct: candidate.oosWorstReturnPct,
              maxDrawdownPct: candidate.maxDrawdownPct,
              trades: candidate.trades,
              positiveFolds: candidate.positiveFolds,
              stabilityPct: candidate.stabilityPct,
              policyScore: candidate.policyScore,
            },
            candidate.variant,
            ['non-positive policy score'],
            candidate.holdoutReturnPct,
            result.stats.maxDrawdownPct,
          );
          candidate.policyScore = '0';
        }
      } catch {
        candidate.holdoutReturnPct = null;
        candidate.policyScore = '0';
        reject('holdout failed');
        rememberNearMiss(
          {
            oosMedianReturnPct: candidate.oosMedianReturnPct,
            oosMeanReturnPct: candidate.oosMeanReturnPct,
            oosWorstReturnPct: candidate.oosWorstReturnPct,
            maxDrawdownPct: candidate.maxDrawdownPct,
            trades: candidate.trades,
            positiveFolds: candidate.positiveFolds,
            stabilityPct: candidate.stabilityPct,
            policyScore: '0',
          },
          candidate.variant,
          ['holdout failed'],
          null,
          null,
        );
      }
    }

    const recommended = top.filter(
      (candidate) =>
        candidate.holdoutReturnPct !== null &&
        Number(candidate.holdoutReturnPct) > 0 &&
        Number(candidate.policyScore) > 0,
    );
    stageReport('holdout').input = top.length;
    stageReport('holdout').output = recommended.length;
    stageReport('holdout').rejected = top.length - recommended.length;
    stageReport('holdout').durationMs = Date.now() - stageStarted;

    const screenedOutCount = variants.length - screenSurvivors.length;
    const probeOutCount = probeRejected.length;
    const budgetOutCount = budgetDropped.length;
    const stats = this.buildStats(
      variants.length,
      evaluated,
      allMetrics,
      recommended,
      folds.folds.length,
      metrics.length,
      top.length,
      screenedOutCount,
      probeOutCount,
      budgetOutCount,
    );
    const recall = estimateRecall(metrics.length, controlEstimates);
    const funnel: FunnelReport = {
      stages: stageKeys.map((key) => stageReport(key)),
      controlHits,
      estimatedMissed: recall.missed,
      estimatedRecallPct: recall.recallPct,
    };
    const holdoutFailed = (item: AiSearchNearMiss) =>
      item.reasons.includes('negative holdout') ||
      item.reasons.includes('holdout drawdown too high') ||
      item.reasons.includes('holdout failed');
    const nearMissesTop = nearMisses
      .sort((left, right) => {
        const priority = Number(holdoutFailed(right)) - Number(holdoutFailed(left));
        return (
          priority ||
          Number(right.policyScore) - Number(left.policyScore) ||
          Number(right.oosMedianReturnPct) - Number(left.oosMedianReturnPct)
        );
      })
      .slice(0, 10);
    const payload = {
      assetId: input.assetId,
      timeframe: input.timeframe,
      variants: variants.length,
      stats,
      funnel,
      candidates: recommended.map((candidate) => ({
        strategyKey: candidate.variant.strategyKey,
        params: candidate.variant.params,
        ...candidate,
      })),
      nearMisses: nearMissesTop,
      rejectionReasons,
      variantMetrics: [...allMetrics]
        .sort((left, right) => Number(right.policyScore) - Number(left.policyScore))
        .slice(0, 2000)
        .map((item) => ({
          strategyKey: item.variant.strategyKey,
          params: item.variant.params,
          trades: item.trades,
          oosMedianReturnPct: item.returnPct.toFixed(2),
          positiveFolds: item.positiveFolds,
          maxDrawdownPct: item.drawdown.toFixed(2),
          policyScore: item.policyScore,
        })),
    };

    if (control.cancelled) {
      await cancelRun();
      return;
    }

    await this.db.transaction(async (tx) => {
      await tx.insert(aiArtifacts).values({
        profileId,
        runId,
        type: 'search',
        payload,
        hash: '',
      });

      if (recommended.length > 0) {
        await tx.insert(aiCandidates).values(
          recommended.map((candidate) => ({
            profileId,
            runId,
            assetId: input.assetId,
            timeframe: input.timeframe,
            strategyKey: candidate.variant.strategyKey,
            params: candidate.variant.params,
            aiRationale: `OOS median ${candidate.oosMedianReturnPct}%, stability ${candidate.stabilityPct}%`,
            metrics: {
              oosMedianReturnPct: candidate.oosMedianReturnPct,
              oosMeanReturnPct: candidate.oosMeanReturnPct,
              oosWorstReturnPct: candidate.oosWorstReturnPct,
              maxDrawdownPct: candidate.maxDrawdownPct,
              trades: candidate.trades,
              positiveFolds: candidate.positiveFolds,
              stabilityPct: candidate.stabilityPct,
              holdoutReturnPct: candidate.holdoutReturnPct,
              policyScore: candidate.policyScore,
              horizonDays: input.horizonDays,
            },
            policyScore: candidate.policyScore,
            status: 'recommended',
          })),
        );
      }

      await tx
        .update(aiPipelineRuns)
        .set({
          status: 'succeeded',
          finishedAt: new Date(),
          summary: {
            assetId: input.assetId,
            timeframe: input.timeframe,
            variants: variants.length,
            lookbackDays,
            progress: {
              stage: 'holdout',
              stageEvaluated: 1,
              stageTotal: 1,
              stagePercent: 100,
              percent: 100,
              evaluated: variants.length,
              total: variants.length,
            },
            stats,
            funnel,
          } satisfies SearchRunSummary,
        })
        .where(eq(aiPipelineRuns.id, runId));

      await this.audit.log(
        {
          userId,
          action: 'ai_trading.search_completed',
          entityType: 'ai_pipeline_run',
          entityId: runId,
          after: {
            assetId: input.assetId,
            timeframe: input.timeframe,
            variants: variants.length,
            evaluated,
            screenedOut: screenedOutCount,
            probeOut: probeOutCount,
            budgetOut: budgetOutCount,
            recommended: recommended.length,
            estimatedRecallPct: recall.recallPct,
            rejectionReasons,
          },
          ip: meta.ip,
          userAgent: meta.userAgent,
        },
        { executor: tx, strict: true },
      );
    });

    this.active.delete(runId);
  }

  private async evaluateVariants(
    variants: SearchVariant[],
    folds: SearchFold[],
    timeframe: AiSearchTimeframe,
    control: { cancelled: boolean },
    onProgress: (evaluated: number) => void,
  ): Promise<VariantFoldEvaluation[] | null> {
    if (variants.length === 0) return [];
    const workerCount = searchWorkerCount();
    if (shouldUseWorkers(process.env, workerCount, workerFileExists())) {
      const pool = await runWorkerPool(variants, folds, timeframe, {
        workerCount,
        workerPath: defaultWorkerPath(),
        control,
        onProgress,
      });
      if (pool.cancelled || control.cancelled) return null;
      return pool.results;
    }
    const results: VariantFoldEvaluation[] = [];
    for (const [index, variant] of variants.entries()) {
      if (index > 0) {
        await new Promise((resolve) => setImmediate(resolve));
      }
      if (control.cancelled) return null;
      results.push(evaluateVariantFolds(variant, folds, timeframe));
      onProgress(index + 1);
    }
    return results;
  }

  private async updateProgress(
    runId: string,
    input: AiSearchRequest,
    progress: SearchProgress,
  ): Promise<void> {
    try {
      await withDbRetry(() =>
        this.db
          .update(aiPipelineRuns)
          .set({
            summary: {
              assetId: input.assetId,
              timeframe: input.timeframe,
              variants: progress.total,
              progress,
            } satisfies SearchRunSummary,
          })
          .where(eq(aiPipelineRuns.id, runId)),
      );
    } catch (error) {
      if (!isTransientDbError(error)) throw error;
      this.logger.warn(`AI search ${runId}: progress update skipped (${DB_UNAVAILABLE_MESSAGE})`);
    }
  }

  private buildStats(
    total: number,
    evaluated: number,
    metrics: Array<{ returnPct: number; drawdown: number; positiveFolds: number }>,
    recommended: SearchCandidate[],
    foldCount: number,
    oosPassed: number,
    holdoutTested: number,
    screenedOut: number,
    probeOut: number,
    budgetOut: number,
  ): AiSearchStats {
    const returns = metrics.map((item) => item.returnPct);
    const drawdowns = metrics.map((item) => item.drawdown);
    const positive = returns.filter((value) => value > 0).length;
    const avg = (values: number[]) =>
      values.length > 0 ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
    const sorted = [...returns].sort((left, right) => left - right);
    const median =
      sorted.length === 0
        ? 0
        : sorted.length % 2 === 0
          ? ((sorted[sorted.length / 2 - 1] as number) + (sorted[sorted.length / 2] as number)) / 2
          : (sorted[Math.floor(sorted.length / 2)] as number);
    const best = sorted.at(-1) ?? 0;
    const worst = sorted[0] ?? 0;
    const histogramRanges = [
      { label: '< -20%', test: (value: number) => value < -20 },
      { label: '-20…-10%', test: (value: number) => value >= -20 && value < -10 },
      { label: '-10…-5%', test: (value: number) => value >= -10 && value < -5 },
      { label: '-5…0%', test: (value: number) => value >= -5 && value < 0 },
      { label: '0…5%', test: (value: number) => value >= 0 && value < 5 },
      { label: '5…10%', test: (value: number) => value >= 5 && value < 10 },
      { label: '10…20%', test: (value: number) => value >= 10 && value < 20 },
      { label: '> 20%', test: (value: number) => value >= 20 },
    ];
    return {
      total,
      evaluated,
      screenedOut,
      probeOut,
      budgetOut,
      valid: metrics.length,
      oosPassed,
      holdoutTested,
      recommended: recommended.length,
      bestReturnPct: best.toFixed(2),
      averageReturnPct: avg(returns).toFixed(2),
      medianReturnPct: median.toFixed(2),
      worstReturnPct: worst.toFixed(2),
      profitablePct: metrics.length > 0 ? ((positive / metrics.length) * 100).toFixed(2) : '0.00',
      averageDrawdownPct: avg(drawdowns).toFixed(2),
      bestOosReturnPct: best.toFixed(2),
      medianOosReturnPct: median.toFixed(2),
      worstOosReturnPct: worst.toFixed(2),
      stabilityPct:
        metrics.length > 0
          ? stabilityPctFor(
              metrics.reduce((sum, item) => sum + item.positiveFolds, 0) / metrics.length,
              foldCount,
            )
          : '0.00',
      holdoutReturnPct: recommended[0]?.holdoutReturnPct ?? null,
      histogram: histogramRanges.map((range) => ({
        label: range.label,
        count: returns.filter(range.test).length,
      })),
    };
  }

  private toCandidate(row: typeof aiCandidates.$inferSelect): AiSearchCandidate {
    const metrics = row.metrics as Record<string, unknown>;
    const value = (key: string, fallback: string): string =>
      typeof metrics[key] === 'string' ? (metrics[key] as string) : fallback;
    const expiresAt = recommendationExpiresAt(row.createdAt, metrics);
    return {
      id: row.id,
      status: row.status === 'accepted' || row.status === 'rejected' ? row.status : 'recommended',
      linkedBotId: typeof metrics.botId === 'string' ? metrics.botId : null,
      expiresAt: expiresAt.toISOString(),
      expired: isRecommendationExpired(row.createdAt, metrics),
      strategyKey: row.strategyKey,
      strategyName: strategyByKey.get(row.strategyKey)?.name ?? row.strategyKey,
      params: row.params,
      oosMedianReturnPct: value('oosMedianReturnPct', '0'),
      oosMeanReturnPct: value('oosMeanReturnPct', '0'),
      oosWorstReturnPct: value('oosWorstReturnPct', '0'),
      maxDrawdownPct: value('maxDrawdownPct', '0'),
      trades: typeof metrics.trades === 'number' ? metrics.trades : 0,
      positiveFolds: typeof metrics.positiveFolds === 'number' ? metrics.positiveFolds : 0,
      stabilityPct: value('stabilityPct', '0'),
      holdoutReturnPct:
        typeof metrics.holdoutReturnPct === 'string' ? metrics.holdoutReturnPct : null,
      policyScore: row.policyScore ?? '0',
    };
  }

  private async loadCandles(assetId: string, timeframe: AiSearchTimeframe): Promise<BotCandle[]> {
    const limit = 180 * candlesPerDay(timeframe);
    const rows = await this.db
      .select({
        openTime: marketCandles.openTime,
        open: marketCandles.open,
        high: marketCandles.high,
        low: marketCandles.low,
        close: marketCandles.close,
        volumeUsd: marketCandles.volumeUsd,
        quality: marketCandles.quality,
      })
      .from(marketCandles)
      .where(and(eq(marketCandles.assetId, assetId), eq(marketCandles.timeframe, timeframe)))
      .orderBy(desc(marketCandles.openTime))
      .limit(limit);
    return toBotCandles(rows.reverse());
  }

  private async requireRun(profileId: string, runId: string) {
    const [run] = await this.db
      .select()
      .from(aiPipelineRuns)
      .where(and(eq(aiPipelineRuns.id, runId), eq(aiPipelineRuns.profileId, profileId)))
      .limit(1);
    if (!run) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Search run not found' });
    return run;
  }
}

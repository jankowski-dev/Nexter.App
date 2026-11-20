import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import {
  aiArtifacts,
  aiCandidates,
  aiPipelineRuns,
  assets,
  marketCandles,
  type Database,
} from '@nexter/db';
import type {
  AiProfileToken,
  AiSearchCandidate,
  AiSearchRequest,
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
import { TIMEFRAME_MS } from './ai-features';
import { isRecommendationExpired, recommendationExpiresAt } from './ai-recommendation';
import {
  aggregateVariant,
  buildSearchFolds,
  generateSearchVariants,
  type SearchVariant,
  type VariantMetrics,
} from './ai-search.helpers';

interface SearchMeta {
  ip?: string;
  userAgent?: string;
}

interface SearchRunSummary {
  assetId: string;
  timeframe: AiSearchTimeframe;
  variants: number;
  progress: { evaluated: number; total: number };
  stats?: AiSearchStats;
  error?: string;
}

interface SearchCandidate extends VariantMetrics {
  variant: SearchVariant;
  holdoutReturnPct: string | null;
}

const FEE_BPS = 25;
const SLIPPAGE_BPS = 10;
const MIN_TRADES = 8;
const MAX_DRAWDOWN_PCT = 20;
const MIN_POSITIVE_FOLDS = 5;
const MIN_WORST_RETURN = -15;

function candlesPerDay(timeframe: AiSearchTimeframe): number {
  return Math.max(1, Math.round(86_400_000 / TIMEFRAME_MS[timeframe]));
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
    const required = 180 * candlesPerDay(input.timeframe);
    if (candles.length < required) {
      throw new UnprocessableEntityException({
        code: 'AI_DATA_INSUFFICIENT',
        message: `Недостаточно свечей для поиска: ${candles.length}, нужно ${required}.`,
        details: { found: candles.length, required },
      });
    }

    const variants = generateSearchVariants(strategyDefinitions, input.variants, input.seed ?? 7);
    if (variants.length === 0) {
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: 'No valid strategy variants to test',
      });
    }

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
      token,
      input,
      candles,
      variants,
      control,
      meta,
    ).catch(async (error: unknown) => {
      this.active.delete(run.id);
      await this.db
        .update(aiPipelineRuns)
        .set({
          status: 'failed',
          finishedAt: new Date(),
          summary: {
            assetId: input.assetId,
            timeframe: input.timeframe,
            variants: variants.length,
            progress: { evaluated: 0, total: variants.length },
            error: error instanceof Error ? error.message.slice(0, 300) : 'search failed',
          } satisfies SearchRunSummary,
        })
        .where(eq(aiPipelineRuns.id, run.id));
    });

    return { runId: run.id };
  }

  async listRuns(userId: string, limit = 20): Promise<AiSearchRunsResponse> {
    const profile = await this.aiTrading.getProfile(userId);
    const rows = await this.db
      .select()
      .from(aiPipelineRuns)
      .where(
        and(
          eq(aiPipelineRuns.profileId, profile.id),
          sql`${aiPipelineRuns.summary}->>'assetId' is not null`,
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

  async status(userId: string, runId: string): Promise<AiSearchStatus> {
    const profile = await this.aiTrading.getProfile(userId);
    const run = await this.requireRun(profile.id, runId);
    const summary = run.summary as unknown as Partial<SearchRunSummary>;
    const evaluated = summary.progress?.evaluated ?? 0;
    const total = summary.progress?.total ?? summary.variants ?? 0;
    return {
      runId: run.id,
      status: run.status as AiSearchStatus['status'],
      evaluated,
      total,
      percent: total > 0 ? Math.min(100, Math.round((evaluated / total) * 100)) : 0,
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
        valid: 0,
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
      },
      candidates: rows.map((row) => this.toCandidate(row)),
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
    }
    return this.status(userId, runId);
  }

  private async execute(
    userId: string,
    runId: string,
    profileId: string,
    token: AiProfileToken,
    input: AiSearchRequest,
    candles: BotCandle[],
    variants: SearchVariant[],
    control: { cancelled: boolean },
    meta: SearchMeta,
  ): Promise<void> {
    const folds = buildSearchFolds(candles, input.timeframe);
    const metrics: Array<SearchCandidate> = [];
    const allMetrics: Array<{ returnPct: number; drawdown: number; positiveFolds: number }> = [];
    const rejectionReasons: Record<string, number> = {};
    let evaluated = 0;

    const reject = (reason: string) => {
      rejectionReasons[reason] = (rejectionReasons[reason] ?? 0) + 1;
    };

    for (const variant of variants) {
      if (control.cancelled) {
        await this.db
          .update(aiPipelineRuns)
          .set({ status: 'cancelled', finishedAt: new Date() })
          .where(eq(aiPipelineRuns.id, runId));
        this.active.delete(runId);
        return;
      }

      evaluated += 1;
      const definition = strategyByKey.get(variant.strategyKey);
      if (!definition) {
        reject('unknown strategy');
        continue;
      }

      const foldResults: Array<{
        totalReturnPct: string;
        maxDrawdownPct: string;
        tradesCount: number;
      }> = [];
      let failed = false;
      for (const fold of folds.folds) {
        try {
          const result = runBacktest(definition, variant.params, fold.oos, {
            initialCapitalUsd: '1000',
            feeBps: FEE_BPS,
            slippageBps: SLIPPAGE_BPS,
            changeLookbackCandles: candlesPerDay(input.timeframe),
          });
          foldResults.push(result.stats);
        } catch {
          failed = true;
          break;
        }
      }
      if (failed || foldResults.length === 0) {
        reject('backtest failed');
        continue;
      }

      const aggregate = aggregateVariant(foldResults);
      allMetrics.push({
        returnPct: Number(aggregate.oosMedianReturnPct),
        drawdown: Number(aggregate.maxDrawdownPct),
        positiveFolds: aggregate.positiveFolds,
      });
      if (aggregate.trades < MIN_TRADES) {
        reject('too few trades');
        continue;
      }
      if (Number(aggregate.oosMedianReturnPct) <= 0) {
        reject('non-positive OOS median');
        continue;
      }
      if (aggregate.positiveFolds < MIN_POSITIVE_FOLDS) {
        reject('unstable folds');
        continue;
      }
      if (Number(aggregate.maxDrawdownPct) > MAX_DRAWDOWN_PCT) {
        reject('drawdown too high');
        continue;
      }
      if (Number(aggregate.oosWorstReturnPct) < MIN_WORST_RETURN) {
        reject('worst fold too deep');
        continue;
      }

      metrics.push({ ...aggregate, variant, holdoutReturnPct: null });
      if (evaluated % 50 === 0) {
        await this.updateProgress(runId, input, variants.length, evaluated);
      }
    }

    metrics.sort((left, right) => Number(right.policyScore) - Number(left.policyScore));
    const top = metrics.slice(0, 10);
    for (const candidate of top) {
      const definition = strategyByKey.get(candidate.variant.strategyKey);
      if (!definition) continue;
      try {
        const result = runBacktest(definition, candidate.variant.params, folds.holdout, {
          initialCapitalUsd: '1000',
          feeBps: FEE_BPS,
          slippageBps: SLIPPAGE_BPS,
          changeLookbackCandles: candlesPerDay(input.timeframe),
        });
        const returnPct = Number(result.stats.totalReturnPct);
        const drawdown = Number(result.stats.maxDrawdownPct);
        candidate.holdoutReturnPct = result.stats.totalReturnPct;
        if (returnPct <= 0 || drawdown > MAX_DRAWDOWN_PCT) {
          candidate.policyScore = '0';
        }
      } catch {
        candidate.holdoutReturnPct = null;
        candidate.policyScore = '0';
      }
    }

    const recommended = top.filter(
      (candidate) =>
        candidate.holdoutReturnPct !== null &&
        Number(candidate.holdoutReturnPct) > 0 &&
        Number(candidate.policyScore) > 0,
    );
    const stats = this.buildStats(variants.length, evaluated, allMetrics, recommended);
    const payload = {
      assetId: input.assetId,
      timeframe: input.timeframe,
      variants: variants.length,
      stats,
      candidates: recommended.map((candidate) => ({
        strategyKey: candidate.variant.strategyKey,
        params: candidate.variant.params,
        ...candidate,
      })),
      rejectionReasons,
    };

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
            assetId: token.asset.id,
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
            progress: { evaluated, total: variants.length },
            stats,
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
            recommended: recommended.length,
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

  private async updateProgress(
    runId: string,
    input: AiSearchRequest,
    total: number,
    evaluated: number,
  ): Promise<void> {
    await this.db
      .update(aiPipelineRuns)
      .set({
        summary: {
          assetId: input.assetId,
          timeframe: input.timeframe,
          variants: total,
          progress: { evaluated, total },
        } satisfies SearchRunSummary,
      })
      .where(eq(aiPipelineRuns.id, runId));
  }

  private buildStats(
    total: number,
    evaluated: number,
    metrics: Array<{ returnPct: number; drawdown: number; positiveFolds: number }>,
    recommended: SearchCandidate[],
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
    return {
      total,
      evaluated,
      valid: metrics.length,
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
          ? (
              (metrics.reduce((sum, item) => sum + item.positiveFolds, 0) / (metrics.length * 8)) *
              100
            ).toFixed(2)
          : '0.00',
      holdoutReturnPct: recommended[0]?.holdoutReturnPct ?? null,
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

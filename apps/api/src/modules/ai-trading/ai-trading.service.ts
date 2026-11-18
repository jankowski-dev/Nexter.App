import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, desc, eq, inArray, isNull } from 'drizzle-orm';
import {
  aiJobs,
  aiPipelineRuns,
  aiProfileTokens,
  aiProfiles,
  aiServiceConfigs,
  assets,
  chains,
  tradingBots,
  type Database,
} from '@nexter/db';
import {
  aiServiceKeys,
  type AiProfile,
  type AiProfileToken,
  type AiProfileTokenCreateRequest,
  type AiProfileTokenUpdateRequest,
  type AiProfileUpdateRequest,
  type AiServiceConfig,
  type AiServiceConfigUpdateRequest,
  type AiTradingDashboard,
} from '@nexter/contracts';
import { AuditService } from '../../shared/audit/audit.service';
import { decimal } from '../../shared/money/decimal';
import { DB } from '../../shared/db/db.module';

interface AiTradingMeta {
  ip?: string;
  userAgent?: string;
}

const defaultModelSettings = {
  model: 'deepseek-flash',
  temperature: 0.2,
  maxTokens: 2000,
  timeoutSeconds: 60,
};

const defaultSchedule = {
  weeklyReview: true,
  weeklyDay: 0,
  weeklyHour: 3,
  events: true,
};

const serviceDefaults: Record<string, Record<string, unknown>> = {
  data: { historyDays: 365, minLiquidityUsd: '25000', timeframes: ['1h', '1d'] },
  analyst: { maxCandidates: 3, minConfidence: 0.5, model: 'deepseek-flash' },
  backtest: {
    minTrades: 20,
    maxDrawdownPct: 15,
    feeBps: 25,
    slippageBps: 10,
    folds: 3,
    maxCombinations: 200,
  },
  risk: { maxCorrelation: 0.8 },
  reporter: { daily: true, weekly: true },
};

function toProfile(row: typeof aiProfiles.$inferSelect): AiProfile {
  return {
    id: row.id,
    name: row.name,
    enabled: row.enabled,
    budgetUsd: row.budgetUsd,
    cashUsd: row.cashUsd,
    reservedUsd: row.reservedUsd,
    maxWorkers: row.maxWorkers,
    maxWorkerAllocationPct: row.maxWorkerAllocationPct,
    maxTokenExposurePct: row.maxTokenExposurePct,
    maxInvestedPct: row.maxInvestedPct,
    riskPerTradePct: row.riskPerTradePct,
    dailyLossLimitPct: row.dailyLossLimitPct,
    maxDrawdownPct: row.maxDrawdownPct,
    maxAiSpendUsd: row.maxAiSpendUsd,
    maxBacktestsPerDay: row.maxBacktestsPerDay,
    workerMaxTokens: row.workerMaxTokens,
    autoApproveWorkerCreate: row.autoApproveWorkerCreate,
    autoApproveParams: row.autoApproveParams,
    autoApproveBudget: row.autoApproveBudget,
    autoApprovePauseClose: row.autoApprovePauseClose,
    autoApproveReoptimize: row.autoApproveReoptimize,
    modelSettings: row.modelSettings as AiProfile['modelSettings'],
    schedule: row.schedule as AiProfile['schedule'],
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toAsset(row: {
  assets: typeof assets.$inferSelect;
  chains: typeof chains.$inferSelect;
}): AiProfileToken['asset'] {
  return {
    id: row.assets.id,
    chainId: row.assets.chainId,
    chainCode: row.chains.code,
    symbol: row.assets.symbol,
    name: row.assets.name,
    decimals: row.assets.decimals,
    contractAddress: row.assets.contractAddress,
    coingeckoId: row.assets.coingeckoId,
    logoUrl: row.assets.logoUrl,
    isStablecoin: row.assets.isStablecoin,
    isCashEquivalent: row.assets.isCashEquivalent,
    isVerified: row.assets.isVerified,
  };
}

function toToken(
  row: typeof aiProfileTokens.$inferSelect,
  asset: AiProfileToken['asset'],
): AiProfileToken {
  return {
    id: row.id,
    asset,
    timeframes: row.timeframes as AiProfileToken['timeframes'],
    priority: row.priority,
    maxAllocationPct: row.maxAllocationPct,
    enabled: row.enabled,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toService(row: typeof aiServiceConfigs.$inferSelect): AiServiceConfig {
  return {
    service: row.service as AiServiceConfig['service'],
    enabled: row.enabled,
    config: row.config,
    concurrency: row.concurrency,
    updatedAt: row.updatedAt.toISOString(),
  };
}

@Injectable()
export class AiTradingService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly audit: AuditService,
  ) {}

  async getProfile(userId: string): Promise<AiProfile> {
    return toProfile(await this.ensureProfile(userId));
  }

  async updateProfile(
    userId: string,
    input: AiProfileUpdateRequest,
    meta: AiTradingMeta,
  ): Promise<AiProfile> {
    const before = await this.ensureProfile(userId);
    const budget = input.budgetUsd !== undefined ? decimal(input.budgetUsd) : null;
    const reserved = decimal(input.reservedUsd ?? before.reservedUsd);
    const derivedCash =
      budget !== null && input.cashUsd === undefined
        ? budget.minus(reserved).lt(0)
          ? '0'
          : budget.minus(reserved).toFixed(8)
        : null;
    const [updated] = await this.db
      .update(aiProfiles)
      .set({
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
        ...(input.budgetUsd !== undefined ? { budgetUsd: input.budgetUsd } : {}),
        ...(input.cashUsd !== undefined
          ? { cashUsd: input.cashUsd }
          : derivedCash !== null
            ? { cashUsd: derivedCash }
            : {}),
        ...(input.reservedUsd !== undefined ? { reservedUsd: input.reservedUsd } : {}),
        ...(input.maxWorkers !== undefined ? { maxWorkers: input.maxWorkers } : {}),
        ...(input.maxWorkerAllocationPct !== undefined
          ? { maxWorkerAllocationPct: input.maxWorkerAllocationPct }
          : {}),
        ...(input.maxTokenExposurePct !== undefined
          ? { maxTokenExposurePct: input.maxTokenExposurePct }
          : {}),
        ...(input.maxInvestedPct !== undefined ? { maxInvestedPct: input.maxInvestedPct } : {}),
        ...(input.riskPerTradePct !== undefined ? { riskPerTradePct: input.riskPerTradePct } : {}),
        ...(input.dailyLossLimitPct !== undefined
          ? { dailyLossLimitPct: input.dailyLossLimitPct }
          : {}),
        ...(input.maxDrawdownPct !== undefined ? { maxDrawdownPct: input.maxDrawdownPct } : {}),
        ...(input.maxAiSpendUsd !== undefined ? { maxAiSpendUsd: input.maxAiSpendUsd } : {}),
        ...(input.maxBacktestsPerDay !== undefined
          ? { maxBacktestsPerDay: input.maxBacktestsPerDay }
          : {}),
        ...(input.workerMaxTokens !== undefined ? { workerMaxTokens: input.workerMaxTokens } : {}),
        ...(input.autoApproveWorkerCreate !== undefined
          ? { autoApproveWorkerCreate: input.autoApproveWorkerCreate }
          : {}),
        ...(input.autoApproveParams !== undefined
          ? { autoApproveParams: input.autoApproveParams }
          : {}),
        ...(input.autoApproveBudget !== undefined
          ? { autoApproveBudget: input.autoApproveBudget }
          : {}),
        ...(input.autoApprovePauseClose !== undefined
          ? { autoApprovePauseClose: input.autoApprovePauseClose }
          : {}),
        ...(input.autoApproveReoptimize !== undefined
          ? { autoApproveReoptimize: input.autoApproveReoptimize }
          : {}),
        ...(input.modelSettings !== undefined ? { modelSettings: input.modelSettings } : {}),
        ...(input.schedule !== undefined ? { schedule: input.schedule } : {}),
        updatedAt: new Date(),
      })
      .where(eq(aiProfiles.id, before.id))
      .returning();

    if (!updated) throw new Error('Failed to update AI profile');

    await this.audit.log(
      {
        userId,
        action: 'ai_trading.profile_updated',
        entityType: 'ai_profile',
        entityId: before.id,
        before: toProfile(before),
        after: input,
        ip: meta.ip,
        userAgent: meta.userAgent,
      },
      { strict: true },
    );

    return toProfile(updated);
  }

  async listTokens(userId: string): Promise<AiProfileToken[]> {
    const profile = await this.ensureProfile(userId);
    const rows = await this.db
      .select({ token: aiProfileTokens, asset: assets, chain: chains })
      .from(aiProfileTokens)
      .innerJoin(assets, eq(assets.id, aiProfileTokens.assetId))
      .innerJoin(chains, eq(chains.id, assets.chainId))
      .where(eq(aiProfileTokens.profileId, profile.id))
      .orderBy(aiProfileTokens.priority, aiProfileTokens.createdAt);

    return rows.map((row) => toToken(row.token, toAsset({ assets: row.asset, chains: row.chain })));
  }

  async addToken(
    userId: string,
    input: AiProfileTokenCreateRequest,
    meta: AiTradingMeta,
  ): Promise<AiProfileToken> {
    const profile = await this.ensureProfile(userId);
    const [assetRow] = await this.db
      .select({ assets: assets, chains: chains })
      .from(assets)
      .innerJoin(chains, eq(chains.id, assets.chainId))
      .where(eq(assets.id, input.assetId))
      .limit(1);

    if (!assetRow) {
      throw new BadRequestException({ code: 'VALIDATION_ERROR', message: 'Asset not found' });
    }

    try {
      const [created] = await this.db
        .insert(aiProfileTokens)
        .values({
          profileId: profile.id,
          assetId: input.assetId,
          timeframes: input.timeframes,
          priority: input.priority,
          maxAllocationPct: input.maxAllocationPct ?? null,
          enabled: input.enabled,
        })
        .returning();

      if (!created) throw new Error('Failed to add AI token');

      await this.audit.log(
        {
          userId,
          action: 'ai_trading.token_added',
          entityType: 'ai_profile_token',
          entityId: created.id,
          after: {
            assetId: created.assetId,
            timeframes: created.timeframes,
            priority: created.priority,
            maxAllocationPct: created.maxAllocationPct,
          },
          ip: meta.ip,
          userAgent: meta.userAgent,
        },
        { strict: true },
      );

      return toToken(created, toAsset(assetRow));
    } catch (error) {
      if (
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        (error as { code?: string }).code === '23505'
      ) {
        throw new ConflictException({
          code: 'CONFLICT',
          message: 'Token is already in the AI universe',
        });
      }
      throw error;
    }
  }

  async updateToken(
    userId: string,
    id: string,
    input: AiProfileTokenUpdateRequest,
    meta: AiTradingMeta,
  ): Promise<AiProfileToken> {
    const profile = await this.ensureProfile(userId);
    const [existing] = await this.db
      .select()
      .from(aiProfileTokens)
      .where(and(eq(aiProfileTokens.id, id), eq(aiProfileTokens.profileId, profile.id)))
      .limit(1);

    if (!existing) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'AI token not found' });
    }

    const [updated] = await this.db
      .update(aiProfileTokens)
      .set({
        ...(input.timeframes !== undefined ? { timeframes: input.timeframes } : {}),
        ...(input.priority !== undefined ? { priority: input.priority } : {}),
        ...(input.maxAllocationPct !== undefined
          ? { maxAllocationPct: input.maxAllocationPct }
          : {}),
        ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
        updatedAt: new Date(),
      })
      .where(eq(aiProfileTokens.id, id))
      .returning();

    if (!updated) throw new Error('Failed to update AI token');

    const [assetRow] = await this.db
      .select({ assets: assets, chains: chains })
      .from(assets)
      .innerJoin(chains, eq(chains.id, assets.chainId))
      .where(eq(assets.id, updated.assetId))
      .limit(1);

    if (!assetRow) throw new Error('AI token asset not found');

    await this.audit.log(
      {
        userId,
        action: 'ai_trading.token_updated',
        entityType: 'ai_profile_token',
        entityId: id,
        before: existing,
        after: input,
        ip: meta.ip,
        userAgent: meta.userAgent,
      },
      { strict: true },
    );

    return toToken(updated, toAsset(assetRow));
  }

  async removeToken(userId: string, id: string, meta: AiTradingMeta): Promise<void> {
    await this.updateToken(userId, id, { enabled: false }, meta);
  }

  async listServices(userId: string): Promise<AiServiceConfig[]> {
    const profile = await this.ensureProfile(userId);
    const existing = await this.db
      .select()
      .from(aiServiceConfigs)
      .where(eq(aiServiceConfigs.profileId, profile.id));
    const byService = new Map(existing.map((row) => [row.service, row]));

    for (const service of aiServiceKeys) {
      if (byService.has(service)) continue;
      const [created] = await this.db
        .insert(aiServiceConfigs)
        .values({
          profileId: profile.id,
          service,
          enabled: true,
          config: serviceDefaults[service] ?? {},
          concurrency: 2,
        })
        .onConflictDoNothing()
        .returning();
      if (created) byService.set(service, created);
    }

    return aiServiceKeys
      .map((service) => byService.get(service))
      .filter((row): row is typeof aiServiceConfigs.$inferSelect => Boolean(row))
      .map(toService);
  }

  async updateService(
    userId: string,
    service: string,
    input: AiServiceConfigUpdateRequest,
    meta: AiTradingMeta,
  ): Promise<AiServiceConfig> {
    if (!aiServiceKeys.includes(service as (typeof aiServiceKeys)[number])) {
      throw new BadRequestException({ code: 'VALIDATION_ERROR', message: 'Unknown AI service' });
    }

    const profile = await this.ensureProfile(userId);
    const [existing] = await this.db
      .select()
      .from(aiServiceConfigs)
      .where(and(eq(aiServiceConfigs.profileId, profile.id), eq(aiServiceConfigs.service, service)))
      .limit(1);

    if (!existing) {
      const [created] = await this.db
        .insert(aiServiceConfigs)
        .values({
          profileId: profile.id,
          service,
          enabled: input.enabled ?? true,
          config: input.config ?? serviceDefaults[service] ?? {},
          concurrency: input.concurrency ?? 2,
        })
        .returning();
      if (!created) throw new Error('Failed to create AI service config');
      return toService(created);
    }

    const [updated] = await this.db
      .update(aiServiceConfigs)
      .set({
        ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
        ...(input.config !== undefined ? { config: { ...existing.config, ...input.config } } : {}),
        ...(input.concurrency !== undefined ? { concurrency: input.concurrency } : {}),
        updatedAt: new Date(),
      })
      .where(eq(aiServiceConfigs.id, existing.id))
      .returning();

    if (!updated) throw new Error('Failed to update AI service config');

    await this.audit.log(
      {
        userId,
        action: 'ai_trading.service_updated',
        entityType: 'ai_service_config',
        entityId: existing.id,
        before: existing,
        after: input,
        ip: meta.ip,
        userAgent: meta.userAgent,
      },
      { strict: true },
    );

    return toService(updated);
  }

  async dashboard(userId: string): Promise<AiTradingDashboard> {
    const profile = await this.ensureProfile(userId);
    const [tokens, workers, activeWorkers, queued, lastRun] = await Promise.all([
      this.db
        .select({ id: aiProfileTokens.id })
        .from(aiProfileTokens)
        .where(eq(aiProfileTokens.profileId, profile.id)),
      this.db
        .select({ id: tradingBots.id })
        .from(tradingBots)
        .where(
          and(
            eq(tradingBots.userId, userId),
            eq(tradingBots.origin, 'ai'),
            isNull(tradingBots.archivedAt),
          ),
        ),
      this.db
        .select({ id: tradingBots.id })
        .from(tradingBots)
        .where(
          and(
            eq(tradingBots.userId, userId),
            eq(tradingBots.origin, 'ai'),
            eq(tradingBots.status, 'running'),
            isNull(tradingBots.archivedAt),
          ),
        ),
      this.db
        .select({ id: aiJobs.id })
        .from(aiJobs)
        .where(
          and(eq(aiJobs.profileId, profile.id), inArray(aiJobs.status, ['queued', 'running'])),
        ),
      this.db
        .select()
        .from(aiPipelineRuns)
        .where(eq(aiPipelineRuns.profileId, profile.id))
        .orderBy(desc(aiPipelineRuns.createdAt))
        .limit(1),
    ]);

    const latest = lastRun[0] ?? null;
    return {
      profile: toProfile(profile),
      tokensCount: tokens.length,
      workersCount: workers.length,
      activeWorkers: activeWorkers.length,
      queueCount: queued.length,
      lastRunAt: latest?.createdAt.toISOString() ?? null,
      lastRunStatus: latest?.status ?? null,
    };
  }

  private async ensureProfile(userId: string): Promise<typeof aiProfiles.$inferSelect> {
    const [existing] = await this.db
      .select()
      .from(aiProfiles)
      .where(eq(aiProfiles.userId, userId))
      .limit(1);

    if (existing) return existing;

    const [created] = await this.db
      .insert(aiProfiles)
      .values({
        userId,
        name: 'AI Trading',
        modelSettings: defaultModelSettings,
        schedule: defaultSchedule,
      })
      .onConflictDoNothing()
      .returning();

    if (created) {
      await this.audit.log(
        {
          userId,
          action: 'ai_trading.profile_created',
          entityType: 'ai_profile',
          entityId: created.id,
          after: { name: created.name },
        },
        { strict: true },
      );
      return created;
    }

    const [fallback] = await this.db
      .select()
      .from(aiProfiles)
      .where(eq(aiProfiles.userId, userId))
      .limit(1);

    if (!fallback) throw new Error('Failed to create AI profile');
    return fallback;
  }
}

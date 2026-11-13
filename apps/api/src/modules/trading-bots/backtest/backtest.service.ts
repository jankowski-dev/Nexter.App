import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, desc, eq } from 'drizzle-orm';
import { ZodError } from 'zod';
import {
  assets,
  botBacktestRuns,
  chains,
  type BotBacktestRunRecord,
  type Database,
} from '@nexter/db';
import type {
  BotBacktestClearResponse,
  BotBacktestListQuery,
  BotBacktestRequest,
  BotBacktestRun,
  BotBacktestRunSummary,
  BotBacktestStats,
  BotBacktestsResponse,
  BotCandle,
  BotStrategyTemplate,
} from '@nexter/contracts';
import { AuditService } from '../../../shared/audit/audit.service';
import { DB } from '../../../shared/db/db.module';
import { decimal } from '../../../shared/money/decimal';
import { strategyByKey, strategyTemplates } from '../strategies';
import { runBacktest } from './backtest.engine';
import { BacktestReportService } from './backtest-report.service';
import { HistoricalDataService } from './historical-data.service';

interface BotMeta {
  ip?: string;
  userAgent?: string;
}

interface RunRow {
  run: BotBacktestRunRecord;
  asset: typeof assets.$inferSelect;
  chainCode: string;
}

@Injectable()
export class BacktestService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly audit: AuditService,
    private readonly historical: HistoricalDataService,
    private readonly reports: BacktestReportService,
  ) {}

  async preview(userId: string, assetId: string, days: number) {
    return this.historical.preview(userId, assetId, days);
  }

  async run(userId: string, input: BotBacktestRequest, meta: BotMeta): Promise<BotBacktestRun> {
    const definition = strategyByKey.get(input.strategyKey);
    if (!definition) {
      throw new BadRequestException({ code: 'VALIDATION_ERROR', message: 'Unknown strategy' });
    }
    const params = parseStrategyParams(
      definition,
      input.strategyParams ?? definition.defaultParams,
    );
    const asset = await this.historical.requireAsset(userId, input.assetId);
    const series = await this.historical.getSeries(asset, input.days);
    const result = runBacktest(definition, params, series.candles, {
      useStopLoss: input.useStopLoss,
      useTakeProfit: input.useTakeProfit,
      reinvestProfit: input.reinvestProfit,
    });

    const id = await this.db.transaction(async (tx) => {
      const [created] = await tx
        .insert(botBacktestRuns)
        .values({
          userId,
          strategyKey: definition.key,
          strategyParams: params,
          assetId: asset.id,
          days: input.days,
          source: series.source,
          useStopLoss: input.useStopLoss,
          useTakeProfit: input.useTakeProfit,
          reinvestProfit: input.reinvestProfit,
          initialCapitalUsd: result.stats.initialCapitalUsd,
          finalEquityUsd: result.stats.finalEquityUsd,
          totalPnlUsd: result.stats.totalPnlUsd,
          totalReturnPct: result.stats.totalReturnPct,
          grossProfitUsd: result.stats.grossProfitUsd,
          grossLossUsd: result.stats.grossLossUsd,
          profitFactor: result.stats.profitFactor,
          winRate: result.stats.winRate,
          tradesCount: result.stats.tradesCount,
          wins: result.stats.wins,
          losses: result.stats.losses,
          maxDrawdownPct: result.stats.maxDrawdownPct,
          buyHoldReturnPct: result.stats.buyHoldReturnPct,
          candles: series.candles,
          trades: result.trades,
          equityCurve: result.equityCurve,
        })
        .returning({ id: botBacktestRuns.id });

      if (!created) throw new Error('Failed to create backtest run');

      await this.audit.log(
        {
          userId,
          action: 'bot.backtest_created',
          entityType: 'bot_backtest',
          entityId: created.id,
          after: {
            strategyKey: definition.key,
            strategyParams: params,
            assetId: asset.id,
            days: input.days,
            useStopLoss: input.useStopLoss,
            useTakeProfit: input.useTakeProfit,
            reinvestProfit: input.reinvestProfit,
            totalPnlUsd: result.stats.totalPnlUsd,
            tradesCount: result.stats.tradesCount,
          },
          ip: meta.ip,
          userAgent: meta.userAgent,
        },
        { executor: tx, strict: true },
      );

      return created.id;
    });

    return this.get(userId, id);
  }

  async list(userId: string, query: BotBacktestListQuery): Promise<BotBacktestsResponse> {
    const where = and(
      eq(botBacktestRuns.userId, userId),
      query.strategyKey ? eq(botBacktestRuns.strategyKey, query.strategyKey) : undefined,
      query.assetId ? eq(botBacktestRuns.assetId, query.assetId) : undefined,
    );

    const rows = await this.db
      .select({ run: botBacktestRuns, asset: assets, chainCode: chains.code })
      .from(botBacktestRuns)
      .innerJoin(assets, eq(botBacktestRuns.assetId, assets.id))
      .innerJoin(chains, eq(assets.chainId, chains.id))
      .where(where)
      .orderBy(desc(botBacktestRuns.createdAt))
      .limit(query.limit);

    return { data: rows.map((row) => toSummary(row)) };
  }

  async get(userId: string, id: string): Promise<BotBacktestRun> {
    const [row] = await this.db
      .select({ run: botBacktestRuns, asset: assets, chainCode: chains.code })
      .from(botBacktestRuns)
      .innerJoin(assets, eq(botBacktestRuns.assetId, assets.id))
      .innerJoin(chains, eq(assets.chainId, chains.id))
      .where(and(eq(botBacktestRuns.id, id), eq(botBacktestRuns.userId, userId)))
      .limit(1);

    if (!row) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Backtest run not found' });
    }

    const strategy = templateFor(row.run.strategyKey);
    return {
      ...toSummary(row),
      strategyName: strategy.name,
      strategyParams: row.run.strategyParams,
      candles: row.run.candles as BotCandle[],
      trades: row.run.trades as BotBacktestRun['trades'],
      equityCurve: row.run.equityCurve as BotBacktestRun['equityCurve'],
    };
  }

  async report(userId: string, id: string): Promise<{ buffer: Buffer; filename: string }> {
    const run = await this.get(userId, id);
    const strategy = templateFor(run.strategyKey);
    const buffer = await this.reports.build(run, strategy);
    return {
      buffer,
      filename: `nexter-backtest-${run.asset.symbol.replaceAll(/[^a-zA-Z0-9_-]/g, '_')}-${run.createdAt.slice(0, 10)}.pdf`,
    };
  }

  async deleteRun(userId: string, id: string, meta: BotMeta): Promise<BotBacktestClearResponse> {
    const [row] = await this.db
      .select()
      .from(botBacktestRuns)
      .where(and(eq(botBacktestRuns.id, id), eq(botBacktestRuns.userId, userId)))
      .limit(1);
    if (!row) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Backtest run not found' });
    }

    await this.db.transaction(async (tx) => {
      await tx
        .delete(botBacktestRuns)
        .where(and(eq(botBacktestRuns.id, id), eq(botBacktestRuns.userId, userId)));
      await this.audit.log(
        {
          userId,
          action: 'bot.backtest_deleted',
          entityType: 'bot_backtest',
          entityId: id,
          before: {
            strategyKey: row.strategyKey,
            assetId: row.assetId,
            days: row.days,
            totalPnlUsd: row.totalPnlUsd,
            tradesCount: row.tradesCount,
          },
          after: { deleted: true },
          ip: meta.ip,
          userAgent: meta.userAgent,
        },
        { executor: tx, strict: true },
      );
    });

    return { deleted: 1 };
  }

  async clear(
    userId: string,
    strategyKey: string | undefined,
    meta: BotMeta,
  ): Promise<BotBacktestClearResponse> {
    const where = and(
      eq(botBacktestRuns.userId, userId),
      strategyKey ? eq(botBacktestRuns.strategyKey, strategyKey) : undefined,
    );

    const deleted = await this.db.transaction(async (tx) => {
      const rows = await tx
        .delete(botBacktestRuns)
        .where(where)
        .returning({ id: botBacktestRuns.id });
      await this.audit.log(
        {
          userId,
          action: 'bot.backtest_deleted',
          entityType: 'bot_backtest',
          entityId: null,
          after: { deleted: rows.length, strategyKey: strategyKey ?? null },
          ip: meta.ip,
          userAgent: meta.userAgent,
        },
        { executor: tx, strict: true },
      );
      return rows.length;
    });

    return { deleted };
  }
}

function parseStrategyParams(
  definition: { parseParams: (value: Record<string, unknown>) => Record<string, unknown> },
  params: Record<string, unknown>,
): Record<string, unknown> {
  try {
    return definition.parseParams(params);
  } catch (error) {
    throw new BadRequestException({
      code: 'VALIDATION_ERROR',
      message: 'Invalid strategy parameters',
      details: error instanceof ZodError ? error.issues : undefined,
    });
  }
}

function templateFor(key: string): BotStrategyTemplate {
  const template = strategyTemplates().find((item) => item.key === key);
  if (!template) {
    throw new NotFoundException({ code: 'NOT_FOUND', message: 'Strategy not found' });
  }
  return template as BotStrategyTemplate;
}

function toSummary(row: RunRow): BotBacktestRunSummary {
  return {
    id: row.run.id,
    strategyKey: row.run.strategyKey as BotBacktestRunSummary['strategyKey'],
    strategyName: strategyByKey.get(row.run.strategyKey)?.name ?? row.run.strategyKey,
    asset: {
      id: row.asset.id,
      symbol: row.asset.symbol,
      name: row.asset.name,
      chainCode: row.chainCode,
      logoUrl: row.asset.logoUrl,
    },
    days: row.run.days,
    source: row.run.source,
    useStopLoss: row.run.useStopLoss,
    useTakeProfit: row.run.useTakeProfit,
    reinvestProfit: row.run.reinvestProfit,
    stats: statsFromRow(row.run),
    createdAt: row.run.createdAt.toISOString(),
  };
}

function statsFromRow(row: BotBacktestRunRecord): BotBacktestStats {
  return {
    initialCapitalUsd: row.initialCapitalUsd,
    finalEquityUsd: row.finalEquityUsd,
    totalPnlUsd: row.totalPnlUsd,
    totalReturnPct: decimal(row.totalReturnPct).toFixed(2),
    grossProfitUsd: row.grossProfitUsd,
    grossLossUsd: row.grossLossUsd,
    profitFactor: row.profitFactor === null ? null : decimal(row.profitFactor).toFixed(2),
    winRate: row.winRate === null ? null : decimal(row.winRate).toFixed(2),
    tradesCount: row.tradesCount,
    wins: row.wins,
    losses: row.losses,
    maxDrawdownPct: decimal(row.maxDrawdownPct).toFixed(2),
    buyHoldReturnPct:
      row.buyHoldReturnPct === null ? null : decimal(row.buyHoldReturnPct).toFixed(2),
  };
}

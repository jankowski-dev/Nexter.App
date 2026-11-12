import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { ZodError } from 'zod';
import {
  assets,
  botEquitySnapshots,
  botEvents,
  botPositions,
  botStrategies,
  botTokens,
  botTrades,
  chains,
  tradingBots,
  watchlist,
  type BotEquitySnapshotRecord,
  type BotEventRecord,
  type BotStrategyRecord,
  type BotTradeRecord,
  type Database,
  type TradingBotRecord,
} from '@nexter/db';
import type {
  BotCreateRequest,
  BotDetailResponse,
  BotEquityPoint,
  BotEquityResponse,
  BotEvent,
  BotEventsResponse,
  BotPosition,
  BotStrategy,
  BotStrategyCreateRequest,
  BotStrategyTemplate,
  BotStrategyUpdateRequest,
  BotStrategiesResponse,
  BotSummary,
  BotToken,
  BotTrade,
  BotTradesResponse,
  TradingBotsResponse,
  BotUpdateRequest,
} from '@nexter/contracts';
import { AuditService } from '../../shared/audit/audit.service';
import { DB } from '../../shared/db/db.module';
import { Decimal, decimal, usdString } from '../../shared/money/decimal';
import { MarketQuoteService } from '../market-data/market-quote.service';
import { strategyByKey, strategyTemplates } from './strategies';

interface BotMeta {
  ip?: string;
  userAgent?: string;
}

function toStrategy(row: BotStrategyRecord): BotStrategy {
  return {
    id: row.id,
    key: row.key as BotStrategy['key'],
    name: row.name,
    description: row.description,
    icon: strategyByKey.get(row.key)?.icon ?? 'beaker',
    version: row.version,
    params: row.params,
    archivedAt: row.archivedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toEvent(row: BotEventRecord): BotEvent {
  return {
    id: row.id,
    type: row.type,
    message: row.message,
    payload: row.payload,
    createdAt: row.createdAt.toISOString(),
  };
}

function toTrade(row: BotTradeRecord, asset: BotTrade['asset']): BotTrade {
  return {
    id: row.id,
    asset,
    side: row.side as BotTrade['side'],
    amount: row.amount,
    priceUsd: row.priceUsd,
    usdValue: row.usdValue,
    feeUsd: row.feeUsd,
    slippageUsd: row.slippageUsd,
    realizedPnlUsd: row.realizedPnlUsd,
    reason: row.reason,
    executedAt: row.executedAt.toISOString(),
  };
}

function toEquityPoint(row: BotEquitySnapshotRecord): BotEquityPoint {
  return {
    capturedAt: row.capturedAt.toISOString(),
    cashUsd: row.cashUsd,
    positionsValueUsd: row.positionsValueUsd,
    equityUsd: row.equityUsd,
    realizedPnlUsd: row.realizedPnlUsd,
    unrealizedPnlUsd: row.unrealizedPnlUsd,
  };
}

function assetContract(
  row: {
    id: string;
    chainId: string;
    symbol: string;
    name: string;
    decimals: number;
    contractAddress: string | null;
    coingeckoId: string | null;
    logoUrl: string | null;
    isStablecoin: boolean;
    isCashEquivalent: boolean;
    isVerified: boolean;
  },
  chainCode: string,
) {
  return {
    id: row.id,
    chainId: row.chainId,
    chainCode,
    symbol: row.symbol,
    name: row.name,
    decimals: row.decimals,
    contractAddress: row.contractAddress,
    coingeckoId: row.coingeckoId,
    logoUrl: row.logoUrl,
    isStablecoin: row.isStablecoin,
    isCashEquivalent: row.isCashEquivalent,
    isVerified: row.isVerified,
  };
}

function pctString(value: number): string {
  return decimal(String(value)).toFixed(2);
}

function uniqueAssetIds(assetIds: string[]): string[] {
  return [...new Set(assetIds)];
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: string }).code === '23505'
  );
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

@Injectable()
export class TradingBotsService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly audit: AuditService,
    private readonly quotes: MarketQuoteService,
  ) {}

  templates(): BotStrategyTemplate[] {
    return strategyTemplates() as BotStrategyTemplate[];
  }

  async listStrategies(userId: string): Promise<BotStrategiesResponse> {
    const rows = await this.db
      .select()
      .from(botStrategies)
      .where(and(eq(botStrategies.userId, userId), isNull(botStrategies.archivedAt)))
      .orderBy(desc(botStrategies.updatedAt));

    return { templates: this.templates(), data: rows.map(toStrategy) };
  }

  async createStrategy(
    userId: string,
    input: BotStrategyCreateRequest,
    meta: BotMeta,
  ): Promise<BotStrategy> {
    const definition = strategyByKey.get(input.key);
    if (!definition) {
      throw new BadRequestException({ code: 'VALIDATION_ERROR', message: 'Unknown strategy' });
    }

    const params = parseStrategyParams(definition, input.params ?? definition.defaultParams);
    let created: BotStrategyRecord | undefined;

    try {
      created = await this.db.transaction(async (tx) => {
        const [row] = await tx
          .insert(botStrategies)
          .values({
            userId,
            key: definition.key,
            name: input.name,
            description: input.description ?? '',
            version: definition.version,
            params,
          })
          .returning();

        if (!row) throw new Error('Failed to create strategy');

        await this.audit.log(
          {
            userId,
            action: 'bot.strategy_created',
            entityType: 'bot_strategy',
            entityId: row.id,
            after: { key: row.key, name: row.name },
            ip: meta.ip,
            userAgent: meta.userAgent,
          },
          { executor: tx, strict: true },
        );

        return row;
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException({
          code: 'CONFLICT',
          message: 'A strategy with this name already exists',
        });
      }
      throw error;
    }

    if (!created) throw new Error('Failed to create strategy');

    return toStrategy(created);
  }

  async updateStrategy(
    userId: string,
    id: string,
    input: BotStrategyUpdateRequest,
    meta: BotMeta,
  ): Promise<BotStrategy> {
    const [existing] = await this.db
      .select()
      .from(botStrategies)
      .where(and(eq(botStrategies.id, id), eq(botStrategies.userId, userId)))
      .limit(1);

    if (!existing) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Strategy not found' });
    }

    if (input.archived === true) {
      const [running] = await this.db
        .select({ id: tradingBots.id })
        .from(tradingBots)
        .where(
          and(
            eq(tradingBots.userId, userId),
            eq(tradingBots.strategyId, id),
            eq(tradingBots.status, 'running'),
          ),
        )
        .limit(1);
      if (running) {
        throw new ConflictException({
          code: 'CONFLICT',
          message: 'Stop running bots before archiving their strategy',
        });
      }
    }

    const definition = strategyByKey.get(existing.key);
    if (!definition) {
      throw new BadRequestException({ code: 'VALIDATION_ERROR', message: 'Unknown strategy' });
    }

    let updated: BotStrategyRecord | undefined;

    try {
      updated = await this.db.transaction(async (tx) => {
        const [row] = await tx
          .update(botStrategies)
          .set({
            ...(input.name !== undefined ? { name: input.name } : {}),
            ...(input.description !== undefined ? { description: input.description } : {}),
            ...(input.params !== undefined
              ? { params: parseStrategyParams(definition, input.params) }
              : {}),
            ...(input.archived !== undefined
              ? { archivedAt: input.archived ? new Date() : null }
              : {}),
            updatedAt: new Date(),
          })
          .where(eq(botStrategies.id, id))
          .returning();

        if (!row) throw new Error('Failed to update strategy');

        await this.audit.log(
          {
            userId,
            action: 'bot.strategy_updated',
            entityType: 'bot_strategy',
            entityId: id,
            before: { name: existing.name, params: existing.params },
            after: { name: row.name, params: row.params },
            ip: meta.ip,
            userAgent: meta.userAgent,
          },
          { executor: tx, strict: true },
        );

        return row;
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException({
          code: 'CONFLICT',
          message: 'A strategy with this name already exists',
        });
      }
      throw error;
    }

    if (!updated) throw new Error('Failed to update strategy');

    return toStrategy(updated);
  }

  async listBots(userId: string, includeArchived = false): Promise<TradingBotsResponse> {
    const where = includeArchived
      ? eq(tradingBots.userId, userId)
      : and(eq(tradingBots.userId, userId), isNull(tradingBots.archivedAt));

    const rows = await this.db
      .select({ bot: tradingBots, strategy: botStrategies })
      .from(tradingBots)
      .innerJoin(botStrategies, eq(tradingBots.strategyId, botStrategies.id))
      .where(where)
      .orderBy(desc(tradingBots.createdAt));

    const data = await Promise.all(rows.map((row) => this.toSummary(row.bot, row.strategy)));

    return { data };
  }

  async getBot(userId: string, id: string): Promise<BotDetailResponse> {
    const [row] = await this.db
      .select({ bot: tradingBots, strategy: botStrategies })
      .from(tradingBots)
      .innerJoin(botStrategies, eq(tradingBots.strategyId, botStrategies.id))
      .where(and(eq(tradingBots.id, id), eq(tradingBots.userId, userId)))
      .limit(1);

    if (!row) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Bot not found' });

    const [tokens, positions, summary] = await Promise.all([
      this.loadTokens(id),
      this.loadPositions(id),
      this.toSummary(row.bot, row.strategy),
    ]);

    return {
      bot: summary,
      strategy: toStrategy(row.strategy),
      tokens,
      positions,
    };
  }

  async createBot(
    userId: string,
    input: BotCreateRequest,
    meta: BotMeta,
  ): Promise<BotDetailResponse> {
    const strategy = await this.requireStrategy(userId, input.strategyId);
    const tokenAssetIds = uniqueAssetIds(input.tokenAssetIds);
    await this.assertTokens(userId, tokenAssetIds);
    this.assertBudget(input.budgetUsd);

    const cash = usdString(decimal(input.budgetUsd));
    let id: string;

    try {
      id = await this.db.transaction(async (tx) => {
        const [created] = await tx
          .insert(tradingBots)
          .values({
            userId,
            strategyId: strategy.id,
            name: input.name,
            description: input.description ?? '',
            status: 'draft',
            budgetUsd: cash,
            cashUsd: cash,
            maxPositions: input.maxPositions,
            positionSizePct: pctString(input.positionSizePct),
            feeBps: input.feeBps,
            slippageBps: input.slippageBps,
            maxDailyLossPct: pctString(input.maxDailyLossPct),
            cooldownMinutes: input.cooldownMinutes,
            peakEquityUsd: cash,
            maxDrawdownPct: '0.00',
          })
          .returning({ id: tradingBots.id });

        if (!created) throw new Error('Failed to create bot');

        await tx.insert(botTokens).values(
          tokenAssetIds.map((assetId) => ({
            botId: created.id,
            assetId,
          })),
        );

        await tx.insert(botEvents).values({
          botId: created.id,
          type: 'created',
          message: 'Бот создан',
          payload: { strategyId: strategy.id },
        });

        await this.audit.log(
          {
            userId,
            action: 'bot.created',
            entityType: 'trading_bot',
            entityId: created.id,
            after: {
              name: input.name,
              strategyId: strategy.id,
              budgetUsd: cash,
              tokenAssetIds,
            },
            ip: meta.ip,
            userAgent: meta.userAgent,
          },
          { executor: tx, strict: true },
        );

        return created.id;
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException({
          code: 'CONFLICT',
          message: 'A bot with this name already exists',
        });
      }
      throw error;
    }

    return this.getBot(userId, id);
  }

  async updateBot(
    userId: string,
    id: string,
    input: BotUpdateRequest,
    meta: BotMeta,
  ): Promise<BotDetailResponse> {
    const bot = await this.requireBot(userId, id);
    if (bot.status === 'running') {
      throw new ConflictException({
        code: 'CONFLICT',
        message: 'Stop the bot before changing its settings',
      });
    }

    if (input.strategyId !== undefined) {
      await this.requireStrategy(userId, input.strategyId);
    }
    const tokenAssetIds =
      input.tokenAssetIds !== undefined ? uniqueAssetIds(input.tokenAssetIds) : undefined;
    if (tokenAssetIds !== undefined) {
      await this.assertTokens(userId, tokenAssetIds, id);
      const openPositionRows = await this.db
        .select({ assetId: botPositions.assetId })
        .from(botPositions)
        .where(eq(botPositions.botId, id));
      const nextTokens = new Set(tokenAssetIds);
      const removedWithPosition = openPositionRows
        .map((row) => row.assetId)
        .filter((assetId) => !nextTokens.has(assetId));
      if (removedWithPosition.length > 0) {
        throw new ConflictException({
          code: 'CONFLICT',
          message: 'Close open positions before removing their tokens from the bot',
          details: { assetIds: removedWithPosition },
        });
      }
    }

    try {
      await this.db.transaction(async (tx) => {
        await tx
          .update(tradingBots)
          .set({
            ...(input.name !== undefined ? { name: input.name } : {}),
            ...(input.description !== undefined ? { description: input.description } : {}),
            ...(input.strategyId !== undefined ? { strategyId: input.strategyId } : {}),
            ...(input.maxPositions !== undefined ? { maxPositions: input.maxPositions } : {}),
            ...(input.positionSizePct !== undefined
              ? { positionSizePct: pctString(input.positionSizePct) }
              : {}),
            ...(input.feeBps !== undefined ? { feeBps: input.feeBps } : {}),
            ...(input.slippageBps !== undefined ? { slippageBps: input.slippageBps } : {}),
            ...(input.maxDailyLossPct !== undefined
              ? { maxDailyLossPct: pctString(input.maxDailyLossPct) }
              : {}),
            ...(input.cooldownMinutes !== undefined
              ? { cooldownMinutes: input.cooldownMinutes }
              : {}),
            updatedAt: new Date(),
          })
          .where(eq(tradingBots.id, id));

        if (tokenAssetIds !== undefined) {
          await tx.delete(botTokens).where(eq(botTokens.botId, id));
          await tx
            .insert(botTokens)
            .values(tokenAssetIds.map((assetId) => ({ botId: id, assetId })));
        }

        await this.audit.log(
          {
            userId,
            action: 'bot.updated',
            entityType: 'trading_bot',
            entityId: id,
            before: { name: bot.name, status: bot.status },
            after: input,
            ip: meta.ip,
            userAgent: meta.userAgent,
          },
          { executor: tx, strict: true },
        );
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException({
          code: 'CONFLICT',
          message: 'A bot with this name already exists',
        });
      }
      throw error;
    }

    return this.getBot(userId, id);
  }

  async startBot(userId: string, id: string, meta: BotMeta): Promise<BotDetailResponse> {
    const bot = await this.requireBot(userId, id);
    if (bot.archivedAt) {
      throw new ConflictException({ code: 'CONFLICT', message: 'Bot is archived' });
    }
    if (bot.status === 'running') {
      return this.getBot(userId, id);
    }
    const tokens = await this.loadTokens(id);
    if (tokens.length === 0) {
      throw new BadRequestException({ code: 'VALIDATION_ERROR', message: 'Bot has no tokens' });
    }
    if (decimal(bot.cashUsd).lte(0) && decimal(bot.budgetUsd).lte(0)) {
      throw new BadRequestException({ code: 'VALIDATION_ERROR', message: 'Bot has no budget' });
    }

    const [strategy] = await this.db
      .select()
      .from(botStrategies)
      .where(and(eq(botStrategies.id, bot.strategyId), eq(botStrategies.userId, userId)))
      .limit(1);
    if (!strategy || strategy.archivedAt) {
      throw new ConflictException({
        code: 'CONFLICT',
        message: 'Bot strategy is archived or missing',
      });
    }
    if (!strategyByKey.has(strategy.key)) {
      throw new ConflictException({
        code: 'CONFLICT',
        message: 'Bot strategy is not available in this deployment',
      });
    }

    await this.db.transaction(async (tx) => {
      await tx
        .update(tradingBots)
        .set({
          status: 'running',
          startedAt: bot.startedAt ?? new Date(),
          stoppedAt: null,
          updatedAt: new Date(),
        })
        .where(eq(tradingBots.id, id));
      await tx.insert(botEvents).values({
        botId: id,
        type: 'started',
        message: 'Бот запущен',
        payload: {},
      });
      await this.audit.log(
        {
          userId,
          action: 'bot.started',
          entityType: 'trading_bot',
          entityId: id,
          before: { status: bot.status },
          after: { status: 'running' },
          ip: meta.ip,
          userAgent: meta.userAgent,
        },
        { executor: tx, strict: true },
      );
    });

    return this.getBot(userId, id);
  }

  async stopBot(userId: string, id: string, meta: BotMeta): Promise<BotDetailResponse> {
    const bot = await this.requireBot(userId, id);
    if (bot.status === 'stopped') {
      return this.getBot(userId, id);
    }
    await this.db.transaction(async (tx) => {
      await tx
        .update(tradingBots)
        .set({ status: 'stopped', stoppedAt: new Date(), updatedAt: new Date() })
        .where(eq(tradingBots.id, id));
      await tx.insert(botEvents).values({
        botId: id,
        type: 'stopped',
        message: 'Бот остановлен',
        payload: {},
      });
      await this.audit.log(
        {
          userId,
          action: 'bot.stopped',
          entityType: 'trading_bot',
          entityId: id,
          before: { status: bot.status },
          after: { status: 'stopped' },
          ip: meta.ip,
          userAgent: meta.userAgent,
        },
        { executor: tx, strict: true },
      );
    });
    return this.getBot(userId, id);
  }

  async resetBot(userId: string, id: string, meta: BotMeta): Promise<BotDetailResponse> {
    const bot = await this.requireBot(userId, id);
    await this.db.transaction(async (tx) => {
      await tx.delete(botPositions).where(eq(botPositions.botId, id));
      await tx.delete(botTrades).where(eq(botTrades.botId, id));
      await tx.delete(botEquitySnapshots).where(eq(botEquitySnapshots.botId, id));
      await tx
        .update(tradingBots)
        .set({
          status: 'stopped',
          cashUsd: bot.budgetUsd,
          peakEquityUsd: bot.budgetUsd,
          maxDrawdownPct: '0.00',
          startedAt: null,
          stoppedAt: null,
          lastTickAt: null,
          updatedAt: new Date(),
        })
        .where(eq(tradingBots.id, id));
      await tx.insert(botEvents).values({
        botId: id,
        type: 'reset',
        message: 'Бумажное состояние сброшено',
        payload: { budgetUsd: bot.budgetUsd },
      });
      await this.audit.log(
        {
          userId,
          action: 'bot.reset',
          entityType: 'trading_bot',
          entityId: id,
          before: { cashUsd: bot.cashUsd, status: bot.status },
          after: { cashUsd: bot.budgetUsd, status: 'stopped' },
          ip: meta.ip,
          userAgent: meta.userAgent,
        },
        { executor: tx, strict: true },
      );
    });
    return this.getBot(userId, id);
  }

  async closePositions(userId: string, id: string, meta: BotMeta): Promise<BotDetailResponse> {
    const bot = await this.requireBot(userId, id);
    if (bot.archivedAt) {
      throw new ConflictException({ code: 'CONFLICT', message: 'Bot is archived' });
    }

    const positions = await this.db.select().from(botPositions).where(eq(botPositions.botId, id));
    if (positions.length === 0) return this.getBot(userId, id);

    const assetRows = await this.db
      .select({ id: assets.id, symbol: assets.symbol })
      .from(assets)
      .where(
        inArray(
          assets.id,
          positions.map((position) => position.assetId),
        ),
      );
    const symbolById = new Map(assetRows.map((asset) => [asset.id, asset.symbol]));
    const quoteMap = await this.quotes.getQuotes(positions.map((position) => position.assetId));
    const missing = positions.filter((position) => {
      const quote = quoteMap.get(position.assetId);
      return !quote || decimal(quote.priceUsd).lte(0);
    });
    if (missing.length > 0) {
      throw new ConflictException({
        code: 'CONFLICT',
        message: 'No current quote for one or more positions',
        details: {
          symbols: missing.map((position) => symbolById.get(position.assetId) ?? position.assetId),
        },
      });
    }

    const now = new Date();
    let cash = decimal(bot.cashUsd);
    let realizedTotal = new Decimal(0);

    await this.db.transaction(async (tx) => {
      for (const position of positions) {
        const quote = quoteMap.get(position.assetId);
        if (!quote) continue;
        const amount = decimal(position.amount);
        const rawPrice = decimal(quote.priceUsd);
        const fillPrice = rawPrice.mul(
          new Decimal(1).minus(decimal(String(bot.slippageBps)).div(10_000)),
        );
        const gross = amount.mul(fillPrice);
        const slippage = amount.mul(rawPrice).minus(gross);
        const fee = gross.mul(decimal(String(bot.feeBps))).div(10_000);
        const net = gross.minus(fee);
        const realized = net.minus(decimal(position.costBasisUsd));
        cash = cash.plus(net);
        realizedTotal = realizedTotal.plus(realized);

        await tx.delete(botPositions).where(eq(botPositions.id, position.id));
        await tx.insert(botTrades).values({
          botId: id,
          assetId: position.assetId,
          side: 'sell',
          amount: position.amount,
          priceUsd: fillPrice.toFixed(18),
          usdValue: usdString(gross),
          feeUsd: usdString(fee),
          slippageUsd: usdString(slippage),
          realizedPnlUsd: usdString(realized),
          reason: 'принудительное закрытие',
          signal: { strategy: bot.strategyId, price: quote.priceUsd, forced: true },
          executedAt: now,
        });
        await tx.insert(botEvents).values({
          botId: id,
          type: 'sell',
          message: `${symbolById.get(position.assetId) ?? position.assetId}: принудительное закрытие`,
          payload: {
            assetId: position.assetId,
            amount: position.amount,
            realizedPnlUsd: usdString(realized),
          },
        });
      }

      const peak = Decimal.max(decimal(bot.peakEquityUsd), cash);
      const drawdown = peak.gt(0) ? peak.minus(cash).div(peak).mul(100) : new Decimal(0);
      const maxDrawdown = Decimal.max(decimal(bot.maxDrawdownPct), drawdown);

      await tx
        .update(tradingBots)
        .set({
          cashUsd: usdString(cash),
          status: 'stopped',
          stoppedAt: now,
          lastTickAt: now,
          peakEquityUsd: usdString(peak),
          maxDrawdownPct: maxDrawdown.toFixed(2),
          updatedAt: now,
        })
        .where(eq(tradingBots.id, id));

      await tx.insert(botEvents).values({
        botId: id,
        type: 'closed_all',
        message: `Закрыто позиций: ${positions.length}`,
        payload: { positions: positions.length, realizedPnlUsd: usdString(realizedTotal) },
      });

      await this.audit.log(
        {
          userId,
          action: 'bot.positions_closed',
          entityType: 'trading_bot',
          entityId: id,
          before: { positions: positions.length, cashUsd: bot.cashUsd, status: bot.status },
          after: {
            positions: 0,
            cashUsd: usdString(cash),
            realizedPnlUsd: usdString(realizedTotal),
            status: 'stopped',
          },
          ip: meta.ip,
          userAgent: meta.userAgent,
        },
        { executor: tx, strict: true },
      );
    });

    const tradeStats = await this.loadTradeStats(id);
    await this.db.insert(botEquitySnapshots).values({
      botId: id,
      capturedAt: now,
      cashUsd: usdString(cash),
      positionsValueUsd: '0.00000000',
      equityUsd: usdString(cash),
      realizedPnlUsd: usdString(tradeStats.realizedPnl),
      unrealizedPnlUsd: '0.00000000',
    });

    return this.getBot(userId, id);
  }

  async archiveBot(userId: string, id: string, meta: BotMeta): Promise<void> {
    const bot = await this.requireBot(userId, id);
    const [openPosition] = await this.db
      .select({ id: botPositions.id })
      .from(botPositions)
      .where(eq(botPositions.botId, id))
      .limit(1);
    if (openPosition) {
      throw new ConflictException({
        code: 'CONFLICT',
        message: 'Close all positions before archiving the bot',
      });
    }
    await this.db.transaction(async (tx) => {
      const now = new Date();
      await tx
        .update(tradingBots)
        .set({ status: 'stopped', stoppedAt: now, archivedAt: now, updatedAt: now })
        .where(eq(tradingBots.id, id));
      await tx.insert(botEvents).values({
        botId: id,
        type: 'archived',
        message: 'Бот удалён (архив)',
        payload: {},
      });
      await this.audit.log(
        {
          userId,
          action: 'bot.archived',
          entityType: 'trading_bot',
          entityId: id,
          before: { status: bot.status, archivedAt: bot.archivedAt?.toISOString() ?? null },
          after: { status: 'stopped', archivedAt: new Date().toISOString() },
          ip: meta.ip,
          userAgent: meta.userAgent,
        },
        { executor: tx, strict: true },
      );
    });
  }

  async trades(userId: string, id: string, limit: number): Promise<BotTradesResponse> {
    await this.requireBot(userId, id);
    const rows = await this.db
      .select({ trade: botTrades, asset: assets, chainCode: chains.code })
      .from(botTrades)
      .innerJoin(assets, eq(botTrades.assetId, assets.id))
      .innerJoin(chains, eq(assets.chainId, chains.id))
      .where(eq(botTrades.botId, id))
      .orderBy(desc(botTrades.executedAt))
      .limit(limit);

    return {
      data: rows.map((row) => toTrade(row.trade, assetContract(row.asset, row.chainCode))),
    };
  }

  async events(userId: string, id: string, limit: number): Promise<BotEventsResponse> {
    await this.requireBot(userId, id);
    const rows = await this.db
      .select()
      .from(botEvents)
      .where(eq(botEvents.botId, id))
      .orderBy(desc(botEvents.createdAt))
      .limit(limit);
    return { data: rows.map(toEvent) };
  }

  async equity(userId: string, id: string, limit: number): Promise<BotEquityResponse> {
    await this.requireBot(userId, id);
    const rows = await this.db
      .select()
      .from(botEquitySnapshots)
      .where(eq(botEquitySnapshots.botId, id))
      .orderBy(desc(botEquitySnapshots.capturedAt))
      .limit(limit);
    return { data: rows.reverse().map(toEquityPoint) };
  }

  private async toSummary(bot: TradingBotRecord, strategy: BotStrategyRecord): Promise<BotSummary> {
    const [positions, tradeStats] = await Promise.all([
      this.loadPositions(bot.id),
      this.loadTradeStats(bot.id),
    ]);

    const positionsValue = positions.reduce(
      (total, position) => total.plus(decimal(position.valueUsd ?? position.costBasisUsd)),
      new Decimal(0),
    );
    const unrealized = positions.reduce(
      (total, position) => total.plus(decimal(position.unrealizedPnlUsd ?? '0')),
      new Decimal(0),
    );
    const realized = tradeStats.realizedPnl;
    const wins = tradeStats.wins;
    const losses = tradeStats.losses;
    const grossProfit = tradeStats.grossProfit;
    const grossLoss = tradeStats.grossLoss;
    const equity = decimal(bot.cashUsd).plus(positionsValue);

    return {
      id: bot.id,
      name: bot.name,
      description: bot.description,
      status: bot.status as BotSummary['status'],
      strategy: {
        id: strategy.id,
        key: strategy.key as BotSummary['strategy']['key'],
        name: strategy.name,
        icon: strategyByKey.get(strategy.key)?.icon ?? 'beaker',
      },
      budgetUsd: bot.budgetUsd,
      cashUsd: bot.cashUsd,
      maxPositions: bot.maxPositions,
      positionSizePct: Number(bot.positionSizePct),
      feeBps: bot.feeBps,
      slippageBps: bot.slippageBps,
      maxDailyLossPct: Number(bot.maxDailyLossPct),
      cooldownMinutes: bot.cooldownMinutes,
      startedAt: bot.startedAt?.toISOString() ?? null,
      stoppedAt: bot.stoppedAt?.toISOString() ?? null,
      lastTickAt: bot.lastTickAt?.toISOString() ?? null,
      archivedAt: bot.archivedAt?.toISOString() ?? null,
      createdAt: bot.createdAt.toISOString(),
      updatedAt: bot.updatedAt.toISOString(),
      stats: {
        budgetUsd: bot.budgetUsd,
        cashUsd: bot.cashUsd,
        positionsValueUsd: usdString(positionsValue),
        equityUsd: usdString(equity),
        realizedPnlUsd: usdString(realized),
        unrealizedPnlUsd: usdString(unrealized),
        totalPnlUsd: usdString(equity.minus(decimal(bot.budgetUsd))),
        grossProfitUsd: usdString(grossProfit),
        grossLossUsd: usdString(grossLoss),
        profitFactor: grossLoss.gt(0) ? grossProfit.div(grossLoss).toFixed(2) : null,
        winRate: wins + losses > 0 ? ((wins / (wins + losses)) * 100).toFixed(2) : null,
        tradesCount: tradeStats.tradesCount,
        wins,
        losses,
        openPositions: positions.length,
        maxDrawdownPct: decimal(bot.maxDrawdownPct).toFixed(2),
      },
    };
  }

  private async loadTradeStats(botId: string): Promise<{
    tradesCount: number;
    realizedPnl: Decimal;
    wins: number;
    losses: number;
    grossProfit: Decimal;
    grossLoss: Decimal;
  }> {
    const [row] = await this.db
      .select({
        tradesCount: sql<number>`count(*)::int`,
        realizedPnl: sql<string>`coalesce(sum(${botTrades.realizedPnlUsd}), 0)::text`,
        wins: sql<number>`(count(*) filter (where ${botTrades.side} = 'sell' and ${botTrades.realizedPnlUsd} > 0))::int`,
        losses: sql<number>`(count(*) filter (where ${botTrades.side} = 'sell' and ${botTrades.realizedPnlUsd} < 0))::int`,
        grossProfit: sql<string>`coalesce(sum(case when ${botTrades.side} = 'sell' and ${botTrades.realizedPnlUsd} > 0 then ${botTrades.realizedPnlUsd} else 0 end), 0)::text`,
        grossLoss: sql<string>`coalesce(sum(case when ${botTrades.side} = 'sell' and ${botTrades.realizedPnlUsd} < 0 then -1 * ${botTrades.realizedPnlUsd} else 0 end), 0)::text`,
      })
      .from(botTrades)
      .where(eq(botTrades.botId, botId));

    return {
      tradesCount: Number(row?.tradesCount ?? 0),
      realizedPnl: decimal(row?.realizedPnl ?? '0'),
      wins: Number(row?.wins ?? 0),
      losses: Number(row?.losses ?? 0),
      grossProfit: decimal(row?.grossProfit ?? '0'),
      grossLoss: decimal(row?.grossLoss ?? '0'),
    };
  }

  private async loadTokens(botId: string): Promise<BotToken[]> {
    const rows = await this.db
      .select({ token: botTokens, asset: assets, chainCode: chains.code })
      .from(botTokens)
      .innerJoin(assets, eq(botTokens.assetId, assets.id))
      .innerJoin(chains, eq(assets.chainId, chains.id))
      .where(eq(botTokens.botId, botId))
      .orderBy(asc(assets.symbol));

    return rows.map((row) => ({
      assetId: row.asset.id,
      symbol: row.asset.symbol,
      name: row.asset.name,
      chainCode: row.chainCode,
      logoUrl: row.asset.logoUrl,
      enabled: row.token.enabled,
    }));
  }

  private async loadPositions(botId: string): Promise<BotPosition[]> {
    const rows = await this.db
      .select({ position: botPositions, asset: assets, chainCode: chains.code })
      .from(botPositions)
      .innerJoin(assets, eq(botPositions.assetId, assets.id))
      .innerJoin(chains, eq(assets.chainId, chains.id))
      .where(eq(botPositions.botId, botId))
      .orderBy(asc(assets.symbol));
    const quoteMap = await this.quotes.getQuotes(rows.map((row) => row.asset.id));

    return rows.map((row) => {
      const quote = quoteMap.get(row.asset.id);
      const amount = decimal(row.position.amount);
      const currentPrice = quote ? decimal(quote.priceUsd) : null;
      const value = currentPrice ? amount.mul(currentPrice) : null;
      const unrealized = value ? value.minus(decimal(row.position.costBasisUsd)) : null;
      return {
        asset: assetContract(row.asset, row.chainCode),
        amount: row.position.amount,
        avgCostUsd: row.position.avgCostUsd,
        costBasisUsd: row.position.costBasisUsd,
        currentPriceUsd: quote?.priceUsd ?? null,
        valueUsd: value ? usdString(value) : null,
        unrealizedPnlUsd: unrealized ? usdString(unrealized) : null,
        openedAt: row.position.openedAt.toISOString(),
      };
    });
  }

  private async requireBot(userId: string, id: string): Promise<TradingBotRecord> {
    const [bot] = await this.db
      .select()
      .from(tradingBots)
      .where(and(eq(tradingBots.id, id), eq(tradingBots.userId, userId)))
      .limit(1);
    if (!bot) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Bot not found' });
    return bot;
  }

  private async requireStrategy(userId: string, id: string): Promise<BotStrategyRecord> {
    const [strategy] = await this.db
      .select()
      .from(botStrategies)
      .where(
        and(
          eq(botStrategies.id, id),
          eq(botStrategies.userId, userId),
          isNull(botStrategies.archivedAt),
        ),
      )
      .limit(1);
    if (!strategy) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Strategy not found' });
    }
    if (!strategyByKey.has(strategy.key)) {
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: 'Strategy is not available in this deployment',
      });
    }
    return strategy;
  }

  private async assertTokens(
    userId: string,
    assetIds: string[],
    existingBotId?: string,
  ): Promise<void> {
    const rows = await this.db
      .select({ assetId: watchlist.assetId })
      .from(watchlist)
      .where(
        and(
          eq(watchlist.userId, userId),
          isNull(watchlist.archivedAt),
          inArray(watchlist.assetId, assetIds),
        ),
      );
    const found = new Set(rows.map((row) => row.assetId));

    if (existingBotId) {
      const existing = await this.db
        .select({ assetId: botTokens.assetId })
        .from(botTokens)
        .where(eq(botTokens.botId, existingBotId));
      for (const row of existing) {
        if (assetIds.includes(row.assetId)) found.add(row.assetId);
      }
    }

    const missing = assetIds.filter((id) => !found.has(id));
    if (missing.length > 0) {
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: 'All bot tokens must be active entries in the token base',
        details: { missing },
      });
    }
  }

  private assertBudget(value: string): void {
    const budget = decimal(value);
    if (budget.lt(100)) {
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: 'Budget must be at least 100 USD',
      });
    }
    if (!budget.mod(100).isZero()) {
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: 'Budget must be a multiple of 100 USD',
      });
    }
  }
}

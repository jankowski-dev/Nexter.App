import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, eq, gte, inArray, isNull, lte } from 'drizzle-orm';
import {
  assets,
  botEquitySnapshots,
  botEvents,
  botPositions,
  botQuoteSamples,
  botSignals,
  botTokens,
  botTrades,
  chains,
  tradingBots,
  type Database,
} from '@nexter/db';
import type { BotTelemetryQuery, BotTelemetryResponse } from '@nexter/contracts';
import { DB } from '../../shared/db/db.module';
import { Decimal, decimal, usdString } from '../../shared/money/decimal';
import { strategyByKey } from './strategies';

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_DAYS = 7;
const MAX_DAYS = 180;
const MAX_QUOTE_POINTS_PER_ASSET = 500;
const MAX_EQUITY_POINTS = 1000;

function downsample<T>(rows: T[], limit: number): T[] {
  if (rows.length <= limit) return rows;
  const step = Math.ceil(rows.length / limit);
  const result: T[] = [];
  for (let index = 0; index < rows.length; index += step) result.push(rows[index] as T);
  const last = rows[rows.length - 1];
  if (last && result[result.length - 1] !== last) result.push(last);
  return result;
}

function iso(value: Date | null): string | null {
  return value ? value.toISOString() : null;
}

function parseRange(query: BotTelemetryQuery): { from: Date; to: Date } {
  const to = query.to ? new Date(query.to) : new Date();
  const from = query.from ? new Date(query.from) : new Date(to.getTime() - DEFAULT_DAYS * DAY_MS);

  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
    throw new BadRequestException({
      code: 'VALIDATION_ERROR',
      message: 'Некорректный период телеметрии',
    });
  }
  if (from.getTime() >= to.getTime()) {
    throw new BadRequestException({
      code: 'VALIDATION_ERROR',
      message: 'Начало периода должно быть раньше окончания',
    });
  }
  if (to.getTime() - from.getTime() > MAX_DAYS * DAY_MS) {
    throw new BadRequestException({
      code: 'VALIDATION_ERROR',
      message: `Период телеметрии не может быть больше ${MAX_DAYS} дней`,
    });
  }

  return { from, to };
}

@Injectable()
export class BotTelemetryService {
  constructor(@Inject(DB) private readonly db: Database) {}

  async report(
    userId: string,
    botId: string,
    query: BotTelemetryQuery,
  ): Promise<BotTelemetryResponse> {
    const { from, to } = parseRange(query);

    const [bot] = await this.db
      .select()
      .from(tradingBots)
      .where(
        and(
          eq(tradingBots.id, botId),
          eq(tradingBots.userId, userId),
          isNull(tradingBots.archivedAt),
        ),
      )
      .limit(1);

    if (!bot) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Bot not found' });
    }

    const [tokenRows, positionRows, tradeRows, eventRows, signalRows, equityRows] =
      await Promise.all([
        this.db
          .select({
            assetId: assets.id,
            symbol: assets.symbol,
            name: assets.name,
            chainCode: chains.code,
            enabled: botTokens.enabled,
          })
          .from(botTokens)
          .innerJoin(assets, eq(botTokens.assetId, assets.id))
          .innerJoin(chains, eq(assets.chainId, chains.id))
          .where(eq(botTokens.botId, botId)),
        this.db
          .select({
            assetId: botPositions.assetId,
            symbol: assets.symbol,
            name: assets.name,
            amount: botPositions.amount,
            avgCostUsd: botPositions.avgCostUsd,
            costBasisUsd: botPositions.costBasisUsd,
            openedAt: botPositions.openedAt,
            updatedAt: botPositions.updatedAt,
          })
          .from(botPositions)
          .innerJoin(assets, eq(botPositions.assetId, assets.id))
          .where(eq(botPositions.botId, botId)),
        this.db
          .select({
            id: botTrades.id,
            assetId: botTrades.assetId,
            symbol: assets.symbol,
            side: botTrades.side,
            amount: botTrades.amount,
            priceUsd: botTrades.priceUsd,
            usdValue: botTrades.usdValue,
            feeUsd: botTrades.feeUsd,
            slippageUsd: botTrades.slippageUsd,
            realizedPnlUsd: botTrades.realizedPnlUsd,
            reason: botTrades.reason,
            signal: botTrades.signal,
            executedAt: botTrades.executedAt,
          })
          .from(botTrades)
          .innerJoin(assets, eq(botTrades.assetId, assets.id))
          .where(
            and(
              eq(botTrades.botId, botId),
              gte(botTrades.executedAt, from),
              lte(botTrades.executedAt, to),
            ),
          )
          .orderBy(asc(botTrades.executedAt)),
        this.db
          .select()
          .from(botEvents)
          .where(
            and(
              eq(botEvents.botId, botId),
              gte(botEvents.createdAt, from),
              lte(botEvents.createdAt, to),
            ),
          )
          .orderBy(asc(botEvents.createdAt))
          .limit(2000),
        this.db
          .select({
            assetId: botSignals.assetId,
            symbol: assets.symbol,
            priceUsd: botSignals.priceUsd,
            change24hPct: botSignals.change24hPct,
            action: botSignals.action,
            reason: botSignals.reason,
            hasPosition: botSignals.hasPosition,
            strategyState: botSignals.strategyState,
            updatedAt: botSignals.updatedAt,
          })
          .from(botSignals)
          .innerJoin(assets, eq(botSignals.assetId, assets.id))
          .where(eq(botSignals.botId, botId)),
        this.db
          .select()
          .from(botEquitySnapshots)
          .where(
            and(
              eq(botEquitySnapshots.botId, botId),
              gte(botEquitySnapshots.capturedAt, from),
              lte(botEquitySnapshots.capturedAt, to),
            ),
          )
          .orderBy(asc(botEquitySnapshots.capturedAt)),
      ]);

    const assetIds = tokenRows.map((token) => token.assetId);
    const quoteRows =
      assetIds.length > 0
        ? await this.db
            .select()
            .from(botQuoteSamples)
            .where(
              and(
                inArray(botQuoteSamples.assetId, assetIds),
                gte(botQuoteSamples.capturedAt, from),
                lte(botQuoteSamples.capturedAt, to),
              ),
            )
            .orderBy(asc(botQuoteSamples.capturedAt))
        : [];

    const quotesByAsset = new Map<string, Array<Record<string, unknown>>>();
    for (const quote of quoteRows) {
      const list = quotesByAsset.get(quote.assetId) ?? [];
      list.push({
        capturedAt: quote.capturedAt.toISOString(),
        priceUsd: quote.priceUsd,
        change24hPct: quote.change24hPct,
      });
      quotesByAsset.set(quote.assetId, list);
    }
    const quotes: Record<string, Array<Record<string, unknown>>> = {};
    let quotePoints = 0;
    for (const [assetId, rows] of quotesByAsset) {
      const sampled = downsample(rows, MAX_QUOTE_POINTS_PER_ASSET);
      quotes[assetId] = sampled;
      quotePoints += sampled.length;
    }

    const buys = tradeRows.filter((trade) => trade.side === 'buy');
    const sells = tradeRows.filter((trade) => trade.side === 'sell');
    const reasons = sells.map((trade) => trade.reason.toLowerCase());
    const takeProfits = reasons.filter((reason) => reason.includes('тейк-профит')).length;
    const trailingStops = reasons.filter((reason) => reason.includes('трейлинг')).length;
    const stopLosses = reasons.filter(
      (reason) => reason.includes('стоп-лосс') && !reason.includes('трейлинг'),
    ).length;

    const sum = (rows: typeof tradeRows, field: keyof (typeof tradeRows)[number]) =>
      rows.reduce((total, row) => total.plus(decimal(String(row[field] ?? '0'))), new Decimal(0));

    const equityStart = equityRows[0]?.equityUsd ?? null;
    const equityEnd = equityRows[equityRows.length - 1]?.equityUsd ?? null;
    const definition = strategyByKey.get(bot.strategyKey);

    return {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      range: { from: from.toISOString(), to: to.toISOString() },
      bot: {
        id: bot.id,
        name: bot.name,
        description: bot.description,
        status: bot.status,
        strategyKey: bot.strategyKey,
        strategyParams: bot.strategyParams,
        strategy: definition
          ? {
              key: definition.key,
              name: definition.name,
              version: definition.version,
              guide: definition.guide,
              bestFor: definition.bestFor,
              risks: definition.risks,
              defaultParams: definition.defaultParams,
              paramFields: definition.paramFields,
            }
          : null,
        settings: {
          budgetUsd: bot.budgetUsd,
          cashUsd: bot.cashUsd,
          maxPositions: bot.maxPositions,
          positionSizePct: bot.positionSizePct,
          feeBps: bot.feeBps,
          slippageBps: bot.slippageBps,
          maxDailyLossPct: bot.maxDailyLossPct,
          cooldownMinutes: bot.cooldownMinutes,
          peakEquityUsd: bot.peakEquityUsd,
          maxDrawdownPct: bot.maxDrawdownPct,
        },
        startedAt: iso(bot.startedAt),
        stoppedAt: iso(bot.stoppedAt),
        lastTickAt: iso(bot.lastTickAt),
        createdAt: bot.createdAt.toISOString(),
      },
      tokens: tokenRows.map((token) => ({
        ...token,
        signal: signalRows.find((signal) => signal.assetId === token.assetId) ?? null,
      })),
      positions: positionRows.map((position) => ({
        ...position,
        openedAt: position.openedAt.toISOString(),
        updatedAt: position.updatedAt.toISOString(),
      })),
      summary: {
        trades: tradeRows.length,
        buys: buys.length,
        sells: sells.length,
        takeProfits,
        stopLosses,
        trailingStops,
        otherSells: sells.length - takeProfits - stopLosses - trailingStops,
        realizedPnlUsd: usdString(sum(sells, 'realizedPnlUsd')),
        feesUsd: usdString(sum(tradeRows, 'feeUsd')),
        slippageUsd: usdString(sum(tradeRows, 'slippageUsd')),
        equityStartUsd: equityStart,
        equityEndUsd: equityEnd,
        events: eventRows.length,
        signals: signalRows.length,
        quotePoints,
      },
      trades: tradeRows.map((trade) => ({
        ...trade,
        executedAt: trade.executedAt.toISOString(),
      })),
      signals: signalRows.map((signal) => ({
        ...signal,
        updatedAt: signal.updatedAt.toISOString(),
      })),
      events: eventRows.map((event) => ({
        ...event,
        createdAt: event.createdAt.toISOString(),
      })),
      equity: downsample(equityRows, MAX_EQUITY_POINTS).map((point) => ({
        capturedAt: point.capturedAt.toISOString(),
        cashUsd: point.cashUsd,
        positionsValueUsd: point.positionsValueUsd,
        equityUsd: point.equityUsd,
        realizedPnlUsd: point.realizedPnlUsd,
        unrealizedPnlUsd: point.unrealizedPnlUsd,
      })),
      quotes,
    };
  }
}

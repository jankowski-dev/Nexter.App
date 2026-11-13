import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { and, desc, eq, gte, isNull, lt } from 'drizzle-orm';
import {
  assets,
  botEquitySnapshots,
  botEvents,
  botPositions,
  botQuoteSamples,
  botStrategies,
  botTokens,
  botTrades,
  tradingBots,
  type BotStrategyRecord,
  type Database,
  type TradingBotRecord,
} from '@nexter/db';
import type { Pool, PoolClient } from 'pg';
import { env } from '../../shared/config/env';
import { DB, DB_POOL } from '../../shared/db/db.module';
import { Decimal, amountString, decimal, usdString } from '../../shared/money/decimal';
import { MarketQuoteService, type MarketQuoteValue } from '../market-data/market-quote.service';
import { NotificationsService } from '../notifications/notifications.service';
import { strategyByKey } from './strategies';

const HISTORY_LIMIT = 300;
const RUNNER_LOCK_KEY = 'nexter:bot-runner';

@Injectable()
export class BotRunnerService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(BotRunnerService.name);
  private timer: NodeJS.Timeout | null = null;
  private initialTimer: NodeJS.Timeout | null = null;
  private running = false;
  private sampledThisTick = new Set<string>();

  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(DB_POOL) private readonly pool: Pool,
    private readonly quotes: MarketQuoteService,
    private readonly notifications: NotificationsService,
  ) {}

  onApplicationBootstrap(): void {
    if (!env.BOT_RUNNER_ENABLED || env.NODE_ENV === 'test') return;

    this.initialTimer = setTimeout(() => {
      void this.tick();
    }, 5000);
    this.initialTimer.unref();

    this.timer = setInterval(() => {
      void this.tick();
    }, env.BOT_RUNNER_INTERVAL_SECONDS * 1000);
    this.timer.unref();
  }

  onApplicationShutdown(): void {
    if (this.timer) clearInterval(this.timer);
    if (this.initialTimer) clearTimeout(this.initialTimer);
    this.timer = null;
    this.initialTimer = null;
  }

  /** Runs one tick synchronously. Used by the interval scheduler and integration tests. */
  async runOnce(): Promise<void> {
    await this.tick();
  }

  private async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    this.sampledThisTick.clear();

    let lockClient: PoolClient | null = null;
    let locked = false;

    try {
      lockClient = await this.pool.connect();
      const lock = await lockClient.query<{ locked: boolean }>(
        'select pg_try_advisory_lock(hashtext($1)::bigint) as locked',
        [RUNNER_LOCK_KEY],
      );
      locked = lock.rows[0]?.locked === true;
      if (!locked) return;

      const bots = await this.db
        .select({ bot: tradingBots, strategy: botStrategies })
        .from(tradingBots)
        .innerJoin(botStrategies, eq(tradingBots.strategyId, botStrategies.id))
        .where(
          and(
            eq(tradingBots.status, 'running'),
            isNull(tradingBots.archivedAt),
            isNull(botStrategies.archivedAt),
          ),
        );

      for (const row of bots) {
        try {
          await this.processBot(row.bot, row.strategy);
        } catch (error) {
          this.logger.warn(
            `Bot ${row.bot.id} tick failed: ${error instanceof Error ? error.message : 'unknown error'}`,
          );
          await this.recordError(row.bot.id, error);
        }
      }

      await this.pruneHistory();
    } catch (error) {
      this.logger.warn(
        `Bot runner tick failed: ${error instanceof Error ? error.message : 'unknown error'}`,
      );
    } finally {
      if (lockClient) {
        if (locked) {
          await lockClient
            .query('select pg_advisory_unlock(hashtext($1)::bigint)', [RUNNER_LOCK_KEY])
            .catch(() => undefined);
        }
        lockClient.release();
      }
      this.running = false;
    }
  }

  private async processBot(bot: TradingBotRecord, strategyRow: BotStrategyRecord): Promise<void> {
    const definition = strategyByKey.get(strategyRow.key);
    if (!definition) {
      await this.recordError(
        bot.id,
        new Error(`Strategy ${strategyRow.key} is not available in this deployment`),
      );
      const now = new Date();
      await this.db
        .update(tradingBots)
        .set({ status: 'stopped', stoppedAt: now, updatedAt: now })
        .where(eq(tradingBots.id, bot.id));
      await this.notifications
        .create({
          userId: bot.userId,
          type: 'bot_stopped',
          title: 'Бот остановлен',
          body: `Бот «${bot.name}» остановлен: стратегия недоступна в этой версии.`,
          href: '/testing',
          payload: { botId: bot.id, reason: 'strategy_unavailable' },
        })
        .catch(() => undefined);
      return;
    }

    let params: Record<string, unknown>;
    try {
      params = definition.parseParams(strategyRow.params);
    } catch (error) {
      await this.recordError(
        bot.id,
        new Error(
          `Strategy ${strategyRow.key} has invalid parameters: ${
            error instanceof Error ? error.message : 'unknown error'
          }`,
        ),
      );
      const now = new Date();
      await this.db
        .update(tradingBots)
        .set({ status: 'stopped', stoppedAt: now, updatedAt: now })
        .where(eq(tradingBots.id, bot.id));
      await this.notifications
        .create({
          userId: bot.userId,
          type: 'bot_stopped',
          title: 'Бот остановлен',
          body: `Бот «${bot.name}» остановлен: некорректные параметры стратегии.`,
          href: '/testing',
          payload: { botId: bot.id, reason: 'invalid_params' },
        })
        .catch(() => undefined);
      return;
    }

    const tokenRows = await this.db
      .select({ token: botTokens, asset: assets })
      .from(botTokens)
      .innerJoin(assets, eq(botTokens.assetId, assets.id))
      .where(and(eq(botTokens.botId, bot.id), eq(botTokens.enabled, true)));

    if (tokenRows.length === 0) return;

    const quoteMap = await this.quotes.getQuotes(tokenRows.map((row) => row.asset.id));
    const positionRows = await this.db
      .select()
      .from(botPositions)
      .where(eq(botPositions.botId, bot.id));
    const positionByAsset = new Map(positionRows.map((row) => [row.assetId, row]));
    const now = new Date();
    const startOfDay = new Date(now);
    startOfDay.setHours(0, 0, 0, 0);

    const [dailyTrades, tradeRows] = await Promise.all([
      this.db
        .select({ realizedPnlUsd: botTrades.realizedPnlUsd })
        .from(botTrades)
        .where(and(eq(botTrades.botId, bot.id), gte(botTrades.executedAt, startOfDay))),
      this.db
        .select()
        .from(botTrades)
        .where(eq(botTrades.botId, bot.id))
        .orderBy(desc(botTrades.executedAt))
        .limit(500),
    ]);

    let dailyRealized = dailyTrades.reduce(
      (total, trade) => total.plus(decimal(trade.realizedPnlUsd)),
      new Decimal(0),
    );
    const dailyLimit = decimal(bot.budgetUsd).mul(decimal(bot.maxDailyLossPct)).div(100);
    let dailyLossBlocked = dailyRealized.negated().gte(dailyLimit) && dailyLimit.gt(0);
    let cash = decimal(bot.cashUsd);
    let openPositions = positionRows.length;
    const budget = decimal(bot.budgetUsd);
    let changed = false;

    for (const row of tokenRows) {
      const quote = quoteMap.get(row.asset.id);
      if (!quote || now.getTime() - quote.fetchedAt.getTime() > 5 * 60_000) continue;
      if (decimal(quote.priceUsd).lte(0)) continue;

      await this.sampleQuote(row.asset.id, quote, now);
      const history = await this.loadHistory(row.asset.id);
      const position = positionByAsset.get(row.asset.id) ?? null;
      const buyCount = countBuysSinceLastSell(
        tradeRows.filter((trade) => trade.assetId === row.asset.id),
      );
      const lastBuy = tradeRows.find(
        (trade) => trade.assetId === row.asset.id && trade.side === 'buy',
      );
      const inCooldown =
        lastBuy && now.getTime() - lastBuy.executedAt.getTime() < bot.cooldownMinutes * 60_000;

      let decision;
      try {
        decision = definition.evaluate({
          now,
          params,
          priceUsd: quote.priceUsd,
          change24hPct: quote.change24hPct,
          history,
          position: position
            ? {
                amount: position.amount,
                avgCostUsd: position.avgCostUsd,
                costBasisUsd: position.costBasisUsd,
              }
            : null,
          buyCount,
        });
      } catch (error) {
        await this.recordError(
          bot.id,
          new Error(
            `Strategy ${strategyRow.key} failed: ${
              error instanceof Error ? error.message : 'unknown error'
            }`,
          ),
          row.asset.id,
        );
        continue;
      }

      if (decision.action === 'buy') {
        if (dailyLossBlocked || inCooldown) continue;
        if (!position && openPositions >= bot.maxPositions) continue;

        const target = budget.mul(decimal(bot.positionSizePct)).div(100);
        const usd = Decimal.min(target, cash);
        if (usd.lt(1)) continue;

        const rawPrice = decimal(quote.priceUsd);
        const fillPrice = rawPrice.mul(
          new Decimal(1).plus(decimal(String(bot.slippageBps)).div(10_000)),
        );
        const fee = usd.mul(decimal(String(bot.feeBps))).div(10_000);
        const debit = usd.plus(fee);
        if (debit.gt(cash)) continue;

        const amount = usd.div(fillPrice);
        const slippage = amount.mul(rawPrice).minus(usd);
        const existingCost = position ? decimal(position.costBasisUsd) : new Decimal(0);
        const nextCost = existingCost.plus(debit);
        const nextAmount = (position ? decimal(position.amount) : new Decimal(0)).plus(amount);

        await this.db.transaction(async (tx) => {
          if (position) {
            await tx
              .update(botPositions)
              .set({
                amount: amountString(nextAmount),
                costBasisUsd: usdString(nextCost),
                avgCostUsd: usdString(nextCost.div(nextAmount)),
                updatedAt: now,
              })
              .where(eq(botPositions.id, position.id));
          } else {
            await tx.insert(botPositions).values({
              botId: bot.id,
              assetId: row.asset.id,
              amount: amountString(amount),
              costBasisUsd: usdString(nextCost),
              avgCostUsd: usdString(nextCost.div(amount)),
              openedAt: now,
              updatedAt: now,
            });
            openPositions += 1;
          }

          await tx.insert(botTrades).values({
            botId: bot.id,
            assetId: row.asset.id,
            side: 'buy',
            amount: amountString(amount),
            priceUsd: fillPrice.toFixed(18),
            usdValue: usdString(usd),
            feeUsd: usdString(fee),
            slippageUsd: usdString(slippage),
            realizedPnlUsd: '0.00000000',
            reason: decision.reason,
            signal: { strategy: strategyRow.key, price: quote.priceUsd },
            executedAt: now,
          });

          await tx.insert(botEvents).values({
            botId: bot.id,
            type: 'buy',
            message: `${row.asset.symbol}: ${decision.reason}`,
            payload: { assetId: row.asset.id, amount: amountString(amount), usd: usdString(usd) },
          });

          await tx
            .update(tradingBots)
            .set({
              cashUsd: usdString(cash.minus(debit)),
              lastTickAt: now,
              updatedAt: now,
            })
            .where(eq(tradingBots.id, bot.id));
        });

        cash = cash.minus(debit);
        changed = true;
        await this.snapshot(bot.id, now, true);
      } else if (decision.action === 'sell' && position) {
        const amount = decimal(position.amount);
        const rawPrice = decimal(quote.priceUsd);
        const fillPrice = rawPrice.mul(
          new Decimal(1).minus(decimal(String(bot.slippageBps)).div(10_000)),
        );
        const gross = amount.mul(fillPrice);
        const slippage = amount.mul(rawPrice).minus(gross);
        const fee = gross.mul(decimal(String(bot.feeBps))).div(10_000);
        const net = gross.minus(fee);
        const cost = decimal(position.costBasisUsd);
        const realized = net.minus(cost);

        await this.db.transaction(async (tx) => {
          await tx.delete(botPositions).where(eq(botPositions.id, position.id));
          await tx.insert(botTrades).values({
            botId: bot.id,
            assetId: row.asset.id,
            side: 'sell',
            amount: position.amount,
            priceUsd: fillPrice.toFixed(18),
            usdValue: usdString(gross),
            feeUsd: usdString(fee),
            slippageUsd: usdString(slippage),
            realizedPnlUsd: usdString(realized),
            reason: decision.reason,
            signal: { strategy: strategyRow.key, price: quote.priceUsd },
            executedAt: now,
          });
          await tx.insert(botEvents).values({
            botId: bot.id,
            type: 'sell',
            message: `${row.asset.symbol}: ${decision.reason}`,
            payload: {
              assetId: row.asset.id,
              amount: position.amount,
              realizedPnlUsd: usdString(realized),
            },
          });
          await tx
            .update(tradingBots)
            .set({
              cashUsd: usdString(cash.plus(net)),
              lastTickAt: now,
              updatedAt: now,
            })
            .where(eq(tradingBots.id, bot.id));
        });

        cash = cash.plus(net);
        dailyRealized = dailyRealized.plus(realized);
        dailyLossBlocked = dailyRealized.negated().gte(dailyLimit) && dailyLimit.gt(0);
        openPositions = Math.max(0, openPositions - 1);
        changed = true;
        await this.snapshot(bot.id, now, true);
      }
    }

    if (!changed) {
      await this.db
        .update(tradingBots)
        .set({ lastTickAt: now, updatedAt: now })
        .where(eq(tradingBots.id, bot.id));
      await this.snapshot(bot.id, now, false);
    }
  }

  private async sampleQuote(assetId: string, quote: MarketQuoteValue, now: Date): Promise<void> {
    if (this.sampledThisTick.has(assetId)) return;
    this.sampledThisTick.add(assetId);

    const [latest] = await this.db
      .select({ capturedAt: botQuoteSamples.capturedAt })
      .from(botQuoteSamples)
      .where(eq(botQuoteSamples.assetId, assetId))
      .orderBy(desc(botQuoteSamples.capturedAt))
      .limit(1);

    if (latest && now.getTime() - latest.capturedAt.getTime() < 55_000) return;

    await this.db.insert(botQuoteSamples).values({
      assetId,
      priceUsd: quote.priceUsd,
      change24hPct: quote.change24hPct,
      capturedAt: now,
    });
  }

  private async loadHistory(assetId: string) {
    const rows = await this.db
      .select()
      .from(botQuoteSamples)
      .where(eq(botQuoteSamples.assetId, assetId))
      .orderBy(desc(botQuoteSamples.capturedAt))
      .limit(HISTORY_LIMIT);
    return rows.reverse();
  }

  private async snapshot(botId: string, now: Date, force: boolean): Promise<void> {
    const [latest] = await this.db
      .select({ capturedAt: botEquitySnapshots.capturedAt })
      .from(botEquitySnapshots)
      .where(eq(botEquitySnapshots.botId, botId))
      .orderBy(desc(botEquitySnapshots.capturedAt))
      .limit(1);
    if (!force && latest && now.getTime() - latest.capturedAt.getTime() < 5 * 60_000) return;

    const [bot] = await this.db
      .select()
      .from(tradingBots)
      .where(eq(tradingBots.id, botId))
      .limit(1);
    if (!bot) return;

    const [positions, trades] = await Promise.all([
      this.db.select().from(botPositions).where(eq(botPositions.botId, botId)),
      this.db.select().from(botTrades).where(eq(botTrades.botId, botId)),
    ]);
    const quoteMap = await this.quotes.getQuotes(positions.map((position) => position.assetId));
    const positionsValue = positions.reduce((total, position) => {
      const quote = quoteMap.get(position.assetId);
      return quote
        ? total.plus(decimal(position.amount).mul(decimal(quote.priceUsd)))
        : total.plus(decimal(position.costBasisUsd));
    }, new Decimal(0));
    const costBasis = positions.reduce(
      (total, position) => total.plus(decimal(position.costBasisUsd)),
      new Decimal(0),
    );
    const realized = trades.reduce(
      (total, trade) => total.plus(decimal(trade.realizedPnlUsd)),
      new Decimal(0),
    );
    const equity = decimal(bot.cashUsd).plus(positionsValue);
    const peakEquity = Decimal.max(decimal(bot.peakEquityUsd), equity);
    const drawdown = peakEquity.gt(0)
      ? peakEquity.minus(equity).div(peakEquity).mul(100)
      : new Decimal(0);
    const maxDrawdown = Decimal.max(decimal(bot.maxDrawdownPct), drawdown);

    await this.db.transaction(async (tx) => {
      await tx
        .update(tradingBots)
        .set({
          peakEquityUsd: usdString(peakEquity),
          maxDrawdownPct: maxDrawdown.toFixed(2),
          updatedAt: now,
        })
        .where(eq(tradingBots.id, botId));
      await tx.insert(botEquitySnapshots).values({
        botId,
        capturedAt: now,
        cashUsd: bot.cashUsd,
        positionsValueUsd: usdString(positionsValue),
        equityUsd: usdString(equity),
        realizedPnlUsd: usdString(realized),
        unrealizedPnlUsd: usdString(positionsValue.minus(costBasis)),
      });
    });
  }

  private async recordError(botId: string, error: unknown, assetId?: string): Promise<void> {
    await this.db
      .insert(botEvents)
      .values({
        botId,
        type: 'error',
        message: error instanceof Error ? error.message : 'Unknown bot error',
        payload: assetId ? { assetId } : {},
      })
      .catch(() => undefined);
  }

  private async pruneHistory(): Promise<void> {
    const now = Date.now();
    const sampleCutoff = new Date(now - env.BOT_SAMPLE_RETENTION_DAYS * 86_400_000);
    const eventCutoff = new Date(now - 90 * 86_400_000);
    const equityCutoff = new Date(now - 365 * 86_400_000);

    await Promise.all([
      this.db.delete(botQuoteSamples).where(lt(botQuoteSamples.capturedAt, sampleCutoff)),
      this.db.delete(botEvents).where(lt(botEvents.createdAt, eventCutoff)),
      this.db.delete(botEquitySnapshots).where(lt(botEquitySnapshots.capturedAt, equityCutoff)),
    ]);
  }
}

function countBuysSinceLastSell(rows: Array<{ side: string }>): number {
  let count = 0;
  for (const row of rows) {
    if (row.side === 'sell') break;
    if (row.side === 'buy') count += 1;
  }
  return count;
}

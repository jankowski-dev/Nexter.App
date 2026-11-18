import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { and, eq, inArray, isNotNull, or } from 'drizzle-orm';
import type { Pool, PoolClient } from 'pg';
import { pendingOrders, tradeGroups, type Database } from '@nexter/db';
import Decimal from 'decimal.js';
import { AuditService } from '../../shared/audit/audit.service';
import { env } from '../../shared/config/env';
import { DB, DB_POOL } from '../../shared/db/db.module';
import { MarketQuoteService } from '../market-data/market-quote.service';
import { NotificationsService } from '../notifications/notifications.service';
import { TradeGroupsService } from '../accounting/trade-groups.service';

const RUNNER_LOCK_KEY = 'nexter:order-protection';
const RUNNER_INTERVAL_MS = 60_000;

@Injectable()
export class OrderProtectionRunnerService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(OrderProtectionRunnerService.name);
  private timer: NodeJS.Timeout | null = null;
  private initialTimer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(DB_POOL) private readonly pool: Pool,
    private readonly tradeGroups: TradeGroupsService,
    private readonly quotes: MarketQuoteService,
    private readonly notifications: NotificationsService,
    private readonly audit: AuditService,
  ) {}

  onApplicationBootstrap(): void {
    if (env.NODE_ENV === 'test') return;
    this.initialTimer = setTimeout(() => void this.tick(), 15_000);
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
      client = await this.pool.connect();
      const lock = await client.query<{ locked: boolean }>(
        'select pg_try_advisory_lock(hashtext($1)::bigint) as locked',
        [RUNNER_LOCK_KEY],
      );
      locked = lock.rows[0]?.locked === true;
      if (!locked) return;

      await this.checkPendingOrders();
      await this.checkTradeGroups();
    } catch (error) {
      this.logger.warn(
        `Order protection tick failed: ${error instanceof Error ? error.message : 'unknown'}`,
      );
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

  private async checkPendingOrders(): Promise<void> {
    const rows = await this.db
      .select()
      .from(pendingOrders)
      .where(eq(pendingOrders.status, 'pending'));

    if (rows.length === 0) return;

    const quoteMap = await this.quotes.getQuotes([...new Set(rows.map((row) => row.assetId))]);

    for (const order of rows) {
      const quote = quoteMap.get(order.assetId);
      if (quote && Date.now() - quote.fetchedAt.getTime() > 5 * 60_000) continue;
      const price = quote ? new Decimal(quote.priceUsd) : null;
      if (!price || !price.isFinite() || price.lte(0)) continue;

      if (price.gt(order.triggerPriceUsd)) continue;

      const now = new Date();
      const [updated] = await this.db
        .update(pendingOrders)
        .set({ status: 'proposed', lastNotifiedAt: now, updatedAt: now })
        .where(and(eq(pendingOrders.id, order.id), eq(pendingOrders.status, 'pending')))
        .returning({ id: pendingOrders.id });

      if (!updated) continue;

      await this.notifications
        .create({
          userId: order.userId,
          type: 'pending_buy_triggered',
          title: 'Отложенная покупка сработала',
          body: `Цена ${price.toFixed(8)} достигла ${new Decimal(order.triggerPriceUsd).toFixed(8)}. Сумма ${order.amountUsd} USD.`,
          href: '/portfolio#tokens',
          payload: {
            pendingOrderId: order.id,
            assetId: order.assetId,
            amountUsd: order.amountUsd,
            triggerPriceUsd: order.triggerPriceUsd,
          },
        })
        .catch(() => undefined);

      await this.audit
        .log({
          userId: order.userId,
          action: 'pending_order.triggered',
          entityType: 'pending_order',
          entityId: order.id,
          after: { priceUsd: price.toFixed(18), amountUsd: order.amountUsd },
        })
        .catch(() => undefined);
    }
  }

  private async checkTradeGroups(): Promise<void> {
    const rows = await this.db
      .select()
      .from(tradeGroups)
      .where(
        and(
          inArray(tradeGroups.status, ['open', 'partial']),
          or(isNotNull(tradeGroups.stopLossPct), isNotNull(tradeGroups.takeProfitPct)),
        ),
      );

    if (rows.length === 0) return;

    const quoteMap = await this.quotes.getQuotes([...new Set(rows.map((row) => row.assetId))]);
    const day = new Date().toISOString().slice(0, 10);

    for (const row of rows) {
      const quote = quoteMap.get(row.assetId);
      if (!quote) continue;
      if (Date.now() - quote.fetchedAt.getTime() > 5 * 60_000) continue;

      let detail;
      try {
        detail = await this.tradeGroups.get(row.userId, row.id);
      } catch {
        continue;
      }

      const group = detail.group;
      if (group.status === 'closed') continue;

      const remaining = new Decimal(group.remainingAmount);
      const cost = new Decimal(group.remainingCostBasisUsd);
      if (remaining.lte(0) || cost.lte(0)) continue;

      const avg = cost.div(remaining);
      const pnlPct = new Decimal(quote.priceUsd).div(avg).minus(1).times(100);
      const stopLossPct = row.stopLossPct ? new Decimal(row.stopLossPct) : null;
      const takeProfitPct = row.takeProfitPct ? new Decimal(row.takeProfitPct) : null;

      let eventType: 'stop_loss' | 'take_profit' | null = null;
      if (stopLossPct && pnlPct.lte(stopLossPct.negated())) {
        eventType = 'stop_loss';
      } else if (takeProfitPct && pnlPct.gte(takeProfitPct)) {
        eventType = 'take_profit';
      }
      if (!eventType) continue;

      const eventKey = `${row.id}:${eventType}:${day}`;
      if (row.lastProtectionEventKey === eventKey) continue;

      await this.db
        .update(tradeGroups)
        .set({ lastProtectionEventKey: eventKey, updatedAt: new Date() })
        .where(eq(tradeGroups.id, row.id));

      const label = eventType === 'stop_loss' ? 'Стоп-лосс' : 'Тейк-профит';
      await this.notifications
        .create({
          userId: row.userId,
          type: 'order_protection',
          title: `${label}: ${group.asset.symbol}`,
          body: `${pnlPct.gte(0) ? '+' : ''}${pnlPct.toFixed(2)}% к средней цене. Цена ${new Decimal(quote.priceUsd).toFixed(8)}.`,
          href: `/trades/${row.id}`,
          payload: {
            tradeGroupId: row.id,
            eventType,
            priceUsd: quote.priceUsd,
            pnlPct: pnlPct.toFixed(2),
          },
        })
        .catch(() => undefined);

      await this.audit
        .log({
          userId: row.userId,
          action: 'order_protection.triggered',
          entityType: 'trade_group',
          entityId: row.id,
          after: { eventType, priceUsd: quote.priceUsd, pnlPct: pnlPct.toFixed(2) },
        })
        .catch(() => undefined);
    }
  }
}

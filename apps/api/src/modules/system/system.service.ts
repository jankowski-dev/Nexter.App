import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, gte, inArray, sql } from 'drizzle-orm';
import {
  assets,
  botEvents,
  externalApiCalls,
  indexedTransfers,
  marketQuotes,
  portfolioSnapshots,
  reconciliationItems,
  reconciliationRuns,
  swapOrders,
  tradingBots,
  watchedAddresses,
  type Database,
} from '@nexter/db';
import type { SystemStatus } from '@nexter/contracts';
import { env } from '../../shared/config/env';
import { DB } from '../../shared/db/db.module';

function iso(value: string | Date | null | undefined): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

@Injectable()
export class SystemService {
  constructor(@Inject(DB) private readonly db: Database) {}

  async status(userId: string): Promise<SystemStatus> {
    const started = Date.now();
    await this.db.execute(sql`select 1`);

    const [assetCount] = await this.db.select({ n: sql<number>`count(*)::int` }).from(assets);

    const [quoteStats] = await this.db
      .select({
        quoted: sql<number>`count(*)::int`,
        stale15m: sql<number>`(count(*) filter (where ${marketQuotes.fetchedAt} <= now() - interval '15 minutes'))::int`,
        lastFetchedAt: sql<string | null>`max(${marketQuotes.fetchedAt})::text`,
      })
      .from(marketQuotes);

    const sourceRows = await this.db
      .select({ source: marketQuotes.source, n: sql<number>`count(*)::int` })
      .from(marketQuotes)
      .groupBy(marketQuotes.source);

    const [botStats] = await this.db
      .select({
        running: sql<number>`(count(*) filter (where ${tradingBots.status} = 'running' and ${tradingBots.archivedAt} is null))::int`,
        stale: sql<number>`(count(*) filter (where ${tradingBots.status} = 'running' and ${tradingBots.archivedAt} is null and (${tradingBots.lastTickAt} is null or ${tradingBots.lastTickAt} < now() - interval '10 minutes')))::int`,
        lastTickAt: sql<string | null>`max(${tradingBots.lastTickAt})::text`,
      })
      .from(tradingBots)
      .where(eq(tradingBots.userId, userId));

    const [botErrorStats] = await this.db
      .select({ n: sql<number>`count(*)::int` })
      .from(botEvents)
      .innerJoin(tradingBots, eq(botEvents.botId, tradingBots.id))
      .where(
        and(
          eq(tradingBots.userId, userId),
          eq(botEvents.type, 'error'),
          gte(botEvents.createdAt, new Date(Date.now() - 86_400_000)),
        ),
      );

    const [swapStats] = await this.db
      .select({
        active: sql<number>`(count(*) filter (where ${swapOrders.status} in ('SUBMITTED', 'PENDING')))::int`,
        unaccounted: sql<number>`(count(*) filter (where ${swapOrders.status} = 'CONFIRMED' and ${swapOrders.accountingTransactionId} is null))::int`,
        stuck: sql<number>`(count(*) filter (where (${swapOrders.status} in ('SUBMITTED', 'PENDING') and ${swapOrders.updatedAt} < now() - interval '1 hour') or (${swapOrders.status} = 'AWAITING_SIGNATURE' and ${swapOrders.updatedAt} < now() - interval '2 hours')))::int`,
        failed24h: sql<number>`(count(*) filter (where ${swapOrders.status} = 'FAILED' and ${swapOrders.updatedAt} > now() - interval '24 hours'))::int`,
        lastActivityAt: sql<string | null>`max(${swapOrders.updatedAt})::text`,
      })
      .from(swapOrders)
      .where(eq(swapOrders.userId, userId));

    const [snapshot] = await this.db
      .select({ lastCapturedAt: sql<string | null>`max(${portfolioSnapshots.capturedAt})::text` })
      .from(portfolioSnapshots)
      .where(eq(portfolioSnapshots.userId, userId));

    const [latestReconciliation] = await this.db
      .select({
        id: reconciliationRuns.id,
        status: reconciliationRuns.status,
        startedAt: reconciliationRuns.startedAt,
        error: reconciliationRuns.error,
      })
      .from(reconciliationRuns)
      .where(eq(reconciliationRuns.userId, userId))
      .orderBy(desc(reconciliationRuns.startedAt))
      .limit(1);

    let reconciliationIssues = 0;
    if (latestReconciliation) {
      const [issueRow] = await this.db
        .select({ n: sql<number>`count(*)::int` })
        .from(reconciliationItems)
        .where(
          and(
            eq(reconciliationItems.runId, latestReconciliation.id),
            inArray(reconciliationItems.status, ['MISMATCH', 'MISSING_ONCHAIN', 'MISSING_LEDGER']),
          ),
        );
      reconciliationIssues = issueRow?.n ?? 0;
    }

    const apiRows = await this.db
      .select({
        provider: externalApiCalls.provider,
        calls24h: sql<number>`count(*)::int`,
        errors24h: sql<number>`(count(*) filter (where ${externalApiCalls.status} >= 400))::int`,
        p95LatencyMs: sql<
          number | null
        >`percentile_cont(0.95) within group (order by ${externalApiCalls.latencyMs})`,
        lastCallAt: sql<string | null>`max(${externalApiCalls.createdAt})::text`,
        lastStatus: sql<
          number | null
        >`(array_agg(${externalApiCalls.status} order by ${externalApiCalls.createdAt} desc))[1]::int`,
      })
      .from(externalApiCalls)
      .where(gte(externalApiCalls.createdAt, new Date(Date.now() - 86_400_000)))
      .groupBy(externalApiCalls.provider);

    const indexerRows = await this.db
      .select({
        chain: watchedAddresses.chain,
        addresses: sql<number>`count(*)::int`,
        lastIndexedAt: sql<string | null>`max(${watchedAddresses.updatedAt})::text`,
        lastIndexedBlock: sql<string | null>`max(${watchedAddresses.lastIndexedBlock})::text`,
      })
      .from(watchedAddresses)
      .where(and(eq(watchedAddresses.userId, userId), eq(watchedAddresses.enabled, true)))
      .groupBy(watchedAddresses.chain);

    const transferRows = await this.db
      .select({ chain: indexedTransfers.chain, n: sql<number>`count(*)::int` })
      .from(indexedTransfers)
      .groupBy(indexedTransfers.chain);
    const transfersByChain = new Map(transferRows.map((row) => [row.chain, row.n]));

    const bySource = Object.fromEntries(sourceRows.map((row) => [row.source, row.n]));
    const quoted = quoteStats?.quoted ?? 0;
    const assetsTotal = assetCount?.n ?? 0;
    const missing = Math.max(0, assetsTotal - quoted);
    const externalApis = apiRows.map((row) => ({
      provider: row.provider,
      calls24h: row.calls24h,
      errors24h: row.errors24h,
      errorRatePct:
        row.calls24h > 0 ? Number(((row.errors24h / row.calls24h) * 100).toFixed(1)) : 0,
      p95LatencyMs: row.p95LatencyMs === null ? null : Math.round(Number(row.p95LatencyMs)),
      lastCallAt: iso(row.lastCallAt),
      lastStatus: row.lastStatus,
    }));

    const bots = {
      running: botStats?.running ?? 0,
      stale: botStats?.stale ?? 0,
      errors24h: botErrorStats?.n ?? 0,
      lastTickAt: iso(botStats?.lastTickAt),
    };
    const swaps = {
      active: swapStats?.active ?? 0,
      unaccounted: swapStats?.unaccounted ?? 0,
      stuck: swapStats?.stuck ?? 0,
      failed24h: swapStats?.failed24h ?? 0,
      lastActivityAt: iso(swapStats?.lastActivityAt),
    };

    const warnings: SystemStatus['warnings'] = [];
    if (!env.MARKET_QUOTES_ENABLED) {
      warnings.push({
        code: 'market_quotes_disabled',
        severity: 'warning',
        message: 'Обновление рыночных котировок выключено.',
      });
    }
    if (missing > 0) {
      warnings.push({
        code: 'missing_quotes',
        severity: 'warning',
        message: `Нет котировок для активов: ${missing}.`,
      });
    }
    if ((quoteStats?.stale15m ?? 0) > 0) {
      warnings.push({
        code: 'stale_quotes',
        severity: 'warning',
        message: `Устарели котировки: ${quoteStats?.stale15m}.`,
      });
    }
    if (bots.stale > 0) {
      warnings.push({
        code: 'stale_bots',
        severity: 'warning',
        message: `Запущенные роботы без свежего тика: ${bots.stale}.`,
      });
    }
    if (swaps.unaccounted > 0) {
      warnings.push({
        code: 'unaccounted_swaps',
        severity: 'error',
        message: `Подтверждённые свопы без учётной операции: ${swaps.unaccounted}.`,
      });
    }
    if (swaps.stuck > 0) {
      warnings.push({
        code: 'stuck_swaps',
        severity: 'warning',
        message: `Зависшие свопы: ${swaps.stuck}.`,
      });
    }
    if (latestReconciliation?.status === 'FAILED') {
      warnings.push({
        code: 'reconciliation_failed',
        severity: 'error',
        message: `Последняя сверка завершилась ошибкой: ${latestReconciliation.error ?? 'без текста'}.`,
      });
    }
    if (!env.RECONCILIATION_ENABLED) {
      warnings.push({
        code: 'reconciliation_disabled',
        severity: 'info',
        message: 'Сверка с сетью выключена на сервере.',
      });
    }
    for (const api of externalApis) {
      if (api.errors24h > 0) {
        warnings.push({
          code: `provider_errors_${api.provider}`,
          severity: 'warning',
          message: `${api.provider}: ошибок за 24 часа — ${api.errors24h}.`,
        });
      }
    }

    return {
      generatedAt: new Date().toISOString(),
      version: env.VERSION,
      nodeEnv: env.NODE_ENV,
      uptimeSeconds: process.uptime(),
      database: { ok: true, latencyMs: Date.now() - started },
      flags: {
        marketQuotesEnabled: env.MARKET_QUOTES_ENABLED,
        botRunnerEnabled: env.BOT_RUNNER_ENABLED,
        portfolioSnapshotsEnabled: env.PORTFOLIO_SNAPSHOTS_ENABLED,
        reconciliationEnabled: env.RECONCILIATION_ENABLED,
        swapEnabled: env.SWAP_ENABLED,
        swapExecutionEnabled: env.SWAP_EXECUTION_ENABLED,
        swapKillSwitch: env.SWAP_KILL_SWITCH,
        rpcConfigured: {
          bsc: Boolean(env.BSC_RPC_URL),
          ethereum: Boolean(env.ETHEREUM_RPC_URL),
        },
      },
      intervals: {
        marketQuoteSeconds: env.MARKET_QUOTE_INTERVAL_SECONDS,
        marketQuoteCoinGeckoSeconds: env.MARKET_QUOTE_COINGECKO_INTERVAL_SECONDS,
        botRunnerSeconds: env.BOT_RUNNER_INTERVAL_SECONDS,
        portfolioSnapshotSeconds: env.PORTFOLIO_SNAPSHOT_INTERVAL_SECONDS,
        reconciliationIndexSeconds: env.RECONCILIATION_INDEX_INTERVAL_SECONDS,
        swapTrackSeconds: env.SWAP_TRACK_INTERVAL_SECONDS,
      },
      quotes: {
        assets: assetsTotal,
        quoted,
        missing,
        stale15m: quoteStats?.stale15m ?? 0,
        lastFetchedAt: iso(quoteStats?.lastFetchedAt),
        bySource,
      },
      bots,
      swaps,
      externalApis,
      snapshots: { lastCapturedAt: iso(snapshot?.lastCapturedAt) },
      reconciliation: {
        lastRunAt: latestReconciliation ? latestReconciliation.startedAt.toISOString() : null,
        lastStatus: latestReconciliation?.status ?? null,
        lastError: latestReconciliation?.error ?? null,
        issues: reconciliationIssues,
      },
      indexer: indexerRows.map((row) => ({
        chain: row.chain,
        addresses: row.addresses,
        lastIndexedAt: iso(row.lastIndexedAt),
        lastIndexedBlock: row.lastIndexedBlock,
        transfers: transfersByChain.get(row.chain) ?? 0,
      })),
      warnings,
    };
  }
}

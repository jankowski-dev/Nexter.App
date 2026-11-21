import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { marketCandles, watchlist, type Database, type DbExecutor } from '@nexter/db';
import {
  aiTimeframes,
  type AiCoverage,
  type AiCoverageTimeframe,
  type AiDataRefreshRequest,
  type AiDataRefreshResponse,
  type AiProfileToken,
  type AiTimeframe,
} from '@nexter/contracts';
import { AuditService } from '../../shared/audit/audit.service';
import { DB } from '../../shared/db/db.module';
import { CoinGeckoClient } from '../market-data/coingecko.client';
import { BinanceClient } from '../market-data/binance.client';
import { GeckoTerminalClient } from '../market-data/geckoterminal.client';
import type { RawCandle } from '../market-data/candle.types';
import { AiTradingService } from './ai-trading.service';

interface AiTradingMeta {
  ip?: string;
  userAgent?: string;
}

interface WatchlistContracts {
  bscContractAddress: string | null;
  ethereumContractAddress: string | null;
}

const TIMEFRAME_MS: Record<AiTimeframe, number> = {
  '1d': 86_400_000,
  '4h': 14_400_000,
  '1h': 3_600_000,
  '15m': 900_000,
  '5m': 300_000,
};

const MAX_LOOKBACK_DAYS: Record<AiTimeframe, number> = {
  '1d': 365,
  '4h': 180,
  '1h': 180,
  '15m': 30,
  '5m': 3,
};

const EXPECTED_LOOKBACK_DAYS: Record<AiTimeframe, number> = {
  '1d': 90,
  '4h': 180,
  '1h': 180,
  '15m': 30,
  '5m': 3,
};

const UPSERT_CHUNK = 500;

function toIso(value: string | Date | null | undefined): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function expectedCandles(timeframe: AiTimeframe): number {
  return Math.max(
    1,
    Math.floor((EXPECTED_LOOKBACK_DAYS[timeframe] * 86_400_000) / TIMEFRAME_MS[timeframe]),
  );
}

@Injectable()
export class AiDataService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly aiTrading: AiTradingService,
    private readonly geckoterminal: GeckoTerminalClient,
    private readonly coingecko: CoinGeckoClient,
    private readonly binance: BinanceClient,
    private readonly audit: AuditService,
  ) {}

  async coverage(userId: string): Promise<AiCoverage> {
    const tokens = (await this.aiTrading.listTokens(userId)).filter((token) => token.enabled);
    const generatedAt = new Date().toISOString();
    if (tokens.length === 0) return { generatedAt, tokens: [] };

    const rows = await this.db
      .select({
        assetId: marketCandles.assetId,
        timeframe: marketCandles.timeframe,
        openTime: marketCandles.openTime,
        quality: marketCandles.quality,
      })
      .from(marketCandles)
      .where(
        inArray(
          marketCandles.assetId,
          tokens.map((token) => token.asset.id),
        ),
      )
      .orderBy(
        asc(marketCandles.assetId),
        asc(marketCandles.timeframe),
        asc(marketCandles.openTime),
      );

    const byPair = new Map<
      string,
      {
        candles: number;
        firstOpenTime: Date;
        lastOpenTime: Date;
        syntheticCandles: number;
        maxGapCandles: number;
      }
    >();
    for (const row of rows) {
      const key = `${row.assetId}:${row.timeframe}`;
      const step = TIMEFRAME_MS[row.timeframe as AiTimeframe] ?? 1;
      const current = byPair.get(key);
      if (!current) {
        byPair.set(key, {
          candles: 1,
          firstOpenTime: row.openTime,
          lastOpenTime: row.openTime,
          syntheticCandles: row.quality === 'synthetic' ? 1 : 0,
          maxGapCandles: 0,
        });
        continue;
      }
      const gap = Math.max(
        0,
        Math.round((row.openTime.getTime() - current.lastOpenTime.getTime()) / step) - 1,
      );
      current.candles += 1;
      current.lastOpenTime = row.openTime;
      current.syntheticCandles += row.quality === 'synthetic' ? 1 : 0;
      current.maxGapCandles = Math.max(current.maxGapCandles, gap);
    }

    return {
      generatedAt,
      tokens: tokens.map((token) => ({
        assetId: token.asset.id,
        symbol: token.asset.symbol,
        name: token.asset.name,
        logoUrl: token.asset.logoUrl,
        timeframes: token.timeframes
          .slice()
          .sort((left, right) => aiTimeframes.indexOf(left) - aiTimeframes.indexOf(right))
          .map((timeframe) => toCoverage(timeframe, byPair.get(`${token.asset.id}:${timeframe}`))),
      })),
    };
  }

  async refresh(
    userId: string,
    input: AiDataRefreshRequest,
    meta: AiTradingMeta,
  ): Promise<AiDataRefreshResponse> {
    const tokens = (await this.aiTrading.listTokens(userId)).filter((token) => token.enabled);
    const selected = input.assetId
      ? tokens.filter((token) => token.asset.id === input.assetId)
      : tokens;

    if (input.assetId && selected.length === 0) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'AI token not found' });
    }

    const contracts = await this.loadContracts(userId);
    const collected: Array<{ assetId: string; timeframe: AiTimeframe; candles: RawCandle[] }> = [];
    const failed: AiDataRefreshResponse['failed'] = [];
    let pairs = 0;

    for (const token of selected) {
      const timeframes = [...new Set(input.timeframes ?? token.timeframes)];
      for (const timeframe of timeframes) {
        pairs += 1;
        const days = Math.min(input.days, MAX_LOOKBACK_DAYS[timeframe]);
        const candles = await this.loadCandles(token, timeframe, days, contracts);
        if (candles.length === 0) {
          failed.push({
            assetId: token.asset.id,
            symbol: token.asset.symbol,
            timeframe,
            reason: 'Источник не вернул свечи',
          });
          continue;
        }
        collected.push({ assetId: token.asset.id, timeframe, candles });
      }
    }

    const upserted = await this.db.transaction(async (tx) => {
      let total = 0;
      for (const item of collected) {
        total += await this.upsertCandles(tx, item.assetId, item.timeframe, item.candles);
      }

      await this.audit.log(
        {
          userId,
          action: 'ai_trading.data_refreshed',
          entityType: 'ai_data',
          after: {
            pairs,
            upserted: total,
            failed: failed.length,
            assetId: input.assetId ?? null,
            timeframes: input.timeframes ?? null,
            days: input.days,
          },
          ip: meta.ip,
          userAgent: meta.userAgent,
        },
        { executor: tx, strict: true },
      );

      return total;
    });

    return { pairs, upserted, failed };
  }

  private async loadContracts(userId: string): Promise<Map<string, WatchlistContracts>> {
    const rows = await this.db
      .select({
        assetId: watchlist.assetId,
        bscContractAddress: watchlist.bscContractAddress,
        ethereumContractAddress: watchlist.ethereumContractAddress,
      })
      .from(watchlist)
      .where(and(eq(watchlist.userId, userId), isNull(watchlist.archivedAt)));

    return new Map(rows.map((row) => [row.assetId, row]));
  }

  private async loadCandles(
    token: AiProfileToken,
    timeframe: AiTimeframe,
    days: number,
    contracts: Map<string, WatchlistContracts>,
  ): Promise<RawCandle[]> {
    const limit = Math.min(
      5000,
      Math.max(1, Math.floor((days * 86_400_000) / TIMEFRAME_MS[timeframe])),
    );
    const contract = this.contractFor(token, contracts);
    let best: RawCandle[] = [];

    if (contract && (token.asset.chainCode === 'bsc' || token.asset.chainCode === 'ethereum')) {
      best = await this.geckoterminal.getOhlcvCandles(
        token.asset.chainCode,
        contract,
        timeframe,
        limit,
      );
    }

    if (timeframe === '1d' && token.asset.coingeckoId) {
      const daily = await this.coingecko.getDailyCandles(token.asset.coingeckoId, days);
      const mapped: RawCandle[] = daily.map((candle) => ({
        openTime: new Date(`${candle.date}T00:00:00.000Z`),
        open: candle.openUsd,
        high: candle.highUsd,
        low: candle.lowUsd,
        close: candle.closeUsd,
        volumeUsd: candle.volumeUsd,
        source: 'coingecko',
        quality: 'synthetic',
      }));
      if (mapped.length > best.length) best = mapped;
    }

    if (timeframe === '1h' && token.asset.coingeckoId) {
      const hourly = await this.coingecko.getHourlyCandles(token.asset.coingeckoId, days);
      if (hourly.length > best.length) best = hourly;
    }

    if (best.length < limit) {
      const binance = await this.binance.getCandles(token.asset.symbol, timeframe, days);
      if (binance.length > best.length) best = binance;
    }

    return best.slice(-limit);
  }

  private contractFor(
    token: AiProfileToken,
    contracts: Map<string, WatchlistContracts>,
  ): string | null {
    const known = contracts.get(token.asset.id);
    if (token.asset.chainCode === 'bsc') {
      return known?.bscContractAddress ?? token.asset.contractAddress;
    }
    if (token.asset.chainCode === 'ethereum') {
      return known?.ethereumContractAddress ?? token.asset.contractAddress;
    }
    return null;
  }

  private async upsertCandles(
    executor: DbExecutor,
    assetId: string,
    timeframe: AiTimeframe,
    candles: RawCandle[],
  ): Promise<number> {
    const unique = new Map(candles.map((candle) => [candle.openTime.toISOString(), candle]));
    const rows = [...unique.values()];
    let total = 0;

    for (let index = 0; index < rows.length; index += UPSERT_CHUNK) {
      const chunk = rows.slice(index, index + UPSERT_CHUNK).map((candle) => ({
        assetId,
        timeframe,
        openTime: candle.openTime,
        open: candle.open,
        high: candle.high,
        low: candle.low,
        close: candle.close,
        volumeUsd: candle.volumeUsd,
        source: candle.source,
        quality: candle.quality,
      }));

      await executor
        .insert(marketCandles)
        .values(chunk)
        .onConflictDoUpdate({
          target: [marketCandles.assetId, marketCandles.timeframe, marketCandles.openTime],
          set: {
            open: sql`excluded."open"`,
            high: sql`excluded."high"`,
            low: sql`excluded."low"`,
            close: sql`excluded."close"`,
            volumeUsd: sql`excluded.volume_usd`,
            source: sql`excluded.source`,
            quality: sql`excluded.quality`,
            fetchedAt: sql`now()`,
          },
        });

      total += chunk.length;
    }

    return total;
  }
}

export function toCoverage(
  timeframe: AiTimeframe,
  row:
    | {
        candles: number;
        firstOpenTime: string | Date | null;
        lastOpenTime: string | Date | null;
        syntheticCandles?: number;
        maxGapCandles?: number;
      }
    | undefined,
): AiCoverageTimeframe {
  const candles = Number(row?.candles ?? 0);
  const expected = expectedCandles(timeframe);
  const lastOpenTime = toIso(row?.lastOpenTime);
  const stale = lastOpenTime
    ? Date.now() - new Date(lastOpenTime).getTime() > 2 * TIMEFRAME_MS[timeframe]
    : false;
  const status =
    candles === 0 ? 'missing' : stale ? 'stale' : candles < expected * 0.8 ? 'partial' : 'ok';

  return {
    timeframe,
    candles,
    expected,
    firstOpenTime: toIso(row?.firstOpenTime),
    lastOpenTime,
    stale,
    syntheticCandles: Number(row?.syntheticCandles ?? 0),
    maxGapCandles: Number(row?.maxGapCandles ?? 0),
    status,
  };
}

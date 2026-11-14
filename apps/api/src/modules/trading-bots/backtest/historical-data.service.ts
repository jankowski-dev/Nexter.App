import {
  Inject,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { and, eq, isNull } from 'drizzle-orm';
import { assets, chains, watchlist, type Database } from '@nexter/db';
import type { BotBacktestAsset, BotCandle } from '@nexter/contracts';
import { CoinGeckoClient } from '../../market-data/coingecko.client';
import { GeckoTerminalClient } from '../../market-data/geckoterminal.client';
import { DB } from '../../../shared/db/db.module';
import type { HistoricalCandle, HistoricalSeries } from './historical.types';

const CACHE_TTL_MS = 60 * 60 * 1000;
const CACHE_LIMIT = 50;
const MIN_CANDLES = 30;

export interface HistoricalAsset extends BotBacktestAsset {
  coingeckoId: string | null;
  contractAddress: string | null;
}

export interface HistoricalPreview {
  asset: BotBacktestAsset;
  days: number;
  source: string;
  candles: BotCandle[];
}

@Injectable()
export class HistoricalDataService {
  private readonly cache = new Map<string, { expiresAt: number; series: HistoricalSeries }>();

  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly coingecko: CoinGeckoClient,
    private readonly geckoterminal: GeckoTerminalClient,
  ) {}

  async preview(userId: string, assetId: string, days: number): Promise<HistoricalPreview> {
    const asset = await this.requireAsset(userId, assetId);
    const series = await this.getSeries(asset, days);
    return {
      asset: toPublicAsset(asset),
      days,
      source: series.source,
      candles: series.candles,
    };
  }

  async getSeries(asset: HistoricalAsset, days: number): Promise<HistoricalSeries> {
    const key = `${asset.id}:${days}`;
    const cached = this.cache.get(key);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.series;
    }

    let source = 'coingecko';
    let candles: HistoricalCandle[] = [];
    let geckoCandles: HistoricalCandle[] = [];

    // Prefer true daily OHLCV when the public source covers the requested period.
    // If it covers only part of the period, the longer sampled series wins and is
    // marked synthetic so the engine can use conservative exit fills.
    if (asset.contractAddress && (asset.chainCode === 'bsc' || asset.chainCode === 'ethereum')) {
      geckoCandles = await this.geckoterminal.getDailyCandles(
        asset.chainCode,
        asset.contractAddress,
        days,
      );
      if (geckoCandles.length >= days) {
        candles = geckoCandles;
        source = 'geckoterminal';
      }
    }

    if (candles.length === 0 && geckoCandles.length > 0) {
      candles = geckoCandles;
      source = 'geckoterminal';
    }

    if (candles.length < days && asset.coingeckoId) {
      const coingeckoCandles = await this.coingecko.getDailyCandles(asset.coingeckoId, days);
      if (coingeckoCandles.length > candles.length) {
        candles = coingeckoCandles;
        source = 'coingecko';
      }
    }

    candles = candles
      .map((candle) => ({ ...candle, synthetic: source === 'coingecko' }))
      .filter((candle) => isPositiveCandle(candle))
      .sort((left, right) => left.date.localeCompare(right.date))
      .slice(-days);

    if (candles.length < MIN_CANDLES) {
      throw new UnprocessableEntityException({
        code: 'VALIDATION_ERROR',
        message:
          'Недостаточно исторических данных для этого токена. Нужно минимум 30 дневных свечей.',
      });
    }

    const series: HistoricalSeries = { source, candles };
    this.writeCache(key, series);
    return series;
  }

  async requireAsset(userId: string, assetId: string): Promise<HistoricalAsset> {
    const [row] = await this.db
      .select({
        id: assets.id,
        symbol: assets.symbol,
        name: assets.name,
        chainCode: chains.code,
        logoUrl: assets.logoUrl,
        coingeckoId: assets.coingeckoId,
        contractAddress: assets.contractAddress,
        bscContractAddress: watchlist.bscContractAddress,
        ethereumContractAddress: watchlist.ethereumContractAddress,
      })
      .from(watchlist)
      .innerJoin(assets, eq(watchlist.assetId, assets.id))
      .innerJoin(chains, eq(assets.chainId, chains.id))
      .where(
        and(
          eq(watchlist.userId, userId),
          eq(watchlist.assetId, assetId),
          isNull(watchlist.archivedAt),
        ),
      )
      .limit(1);

    if (!row) {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        message: 'Token not found in the active token base',
      });
    }

    const chainAddress =
      row.chainCode === 'bsc'
        ? row.bscContractAddress
        : row.chainCode === 'ethereum'
          ? row.ethereumContractAddress
          : null;

    return {
      id: row.id,
      symbol: row.symbol,
      name: row.name,
      chainCode: row.chainCode,
      logoUrl: row.logoUrl,
      coingeckoId: row.coingeckoId,
      contractAddress: chainAddress ?? row.contractAddress,
    };
  }

  /** Seeds the cache for deterministic API tests. */
  seedForTests(assetId: string, days: number, source: string, candles: BotCandle[]): void {
    this.writeCache(`${assetId}:${days}`, {
      source,
      candles: candles.map((candle) => ({
        ...candle,
        synthetic: candle.synthetic ?? source === 'coingecko',
      })),
    });
  }

  private writeCache(key: string, series: HistoricalSeries): void {
    if (this.cache.size >= CACHE_LIMIT) {
      const oldest = this.cache.keys().next().value;
      if (oldest) this.cache.delete(oldest);
    }
    this.cache.set(key, { expiresAt: Date.now() + CACHE_TTL_MS, series });
  }
}

export function toPublicAsset(asset: HistoricalAsset): BotBacktestAsset {
  return {
    id: asset.id,
    symbol: asset.symbol,
    name: asset.name,
    chainCode: asset.chainCode,
    logoUrl: asset.logoUrl,
  };
}

function isPositiveCandle(candle: HistoricalCandle): boolean {
  return [candle.openUsd, candle.highUsd, candle.lowUsd, candle.closeUsd].every((value) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0;
  });
}

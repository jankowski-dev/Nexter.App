import { Injectable, Logger } from '@nestjs/common';
import { env } from '../../shared/config/env';
import { decimal, priceString } from '../../shared/money/decimal';
import type { HistoricalCandle } from '../trading-bots/backtest/historical.types';
import type { MarketTimeframe, RawCandle } from './candle.types';

const NETWORK: Record<string, string> = {
  bsc: 'bsc',
  ethereum: 'eth',
};

const GECKO_TIMEFRAMES: Record<
  MarketTimeframe,
  { unit: 'day' | 'hour' | 'minute'; aggregate: number }
> = {
  '1d': { unit: 'day', aggregate: 1 },
  '4h': { unit: 'hour', aggregate: 4 },
  '1h': { unit: 'hour', aggregate: 1 },
  '15m': { unit: 'minute', aggregate: 15 },
  '5m': { unit: 'minute', aggregate: 5 },
};

const POOL_CACHE_TTL_MS = 10 * 60 * 1000;
// The public GeckoTerminal API rate-limits bursts. Serialize calls with a
// small gap so multi-token AI refreshes and backtests do not trip HTTP 429.
const MIN_REQUEST_INTERVAL_MS = 1500;

interface PoolCandidate {
  address: string;
  reserveUsd: number;
  tokenSide: 'base' | 'quote';
}

@Injectable()
export class GeckoTerminalClient {
  private readonly logger = new Logger(GeckoTerminalClient.name);
  private readonly poolCache = new Map<string, { expiresAt: number; pool: PoolCandidate | null }>();
  private nextRequestAt = 0;

  async getOhlcvCandles(
    chainCode: string,
    contractAddress: string,
    timeframe: MarketTimeframe,
    limit: number,
  ): Promise<RawCandle[]> {
    if (env.NODE_ENV === 'test') return [];

    const network = NETWORK[chainCode];
    if (!network) return [];

    const pool = await this.findTopPool(network, contractAddress);
    if (!pool) return [];

    const config = GECKO_TIMEFRAMES[timeframe];
    const body = await this.fetchJson(
      `/networks/${network}/pools/${encodeURIComponent(pool.address)}/ohlcv/${config.unit}?aggregate=${config.aggregate}&limit=${Math.max(1, Math.min(limit, 1000))}&currency=usd&token=${pool.tokenSide}`,
    );
    if (!body || typeof body !== 'object') return [];

    const data = body as { data?: { attributes?: { ohlcv_list?: unknown } } };
    const list = data.data?.attributes?.ohlcv_list;
    if (!Array.isArray(list)) return [];

    const byTime = new Map<number, RawCandle>();
    for (const entry of list) {
      if (!Array.isArray(entry) || entry.length < 6) continue;
      const timestamp = Number(entry[0]);
      const open = Number(entry[1]);
      const high = Number(entry[2]);
      const low = Number(entry[3]);
      const close = Number(entry[4]);
      const volume = Number(entry[5]);
      if (
        !Number.isFinite(timestamp) ||
        !Number.isFinite(open) ||
        !Number.isFinite(high) ||
        !Number.isFinite(low) ||
        !Number.isFinite(close) ||
        open <= 0 ||
        high <= 0 ||
        low <= 0 ||
        close <= 0
      ) {
        continue;
      }

      byTime.set(timestamp, {
        openTime: new Date(timestamp * 1000),
        open: priceString(decimal(String(open))),
        high: priceString(decimal(String(high))),
        low: priceString(decimal(String(low))),
        close: priceString(decimal(String(close))),
        volumeUsd: Number.isFinite(volume) ? decimal(String(volume)).toFixed(2) : null,
        source: 'geckoterminal',
        quality: 'ok',
      });
    }

    return [...byTime.values()].sort(
      (left, right) => left.openTime.getTime() - right.openTime.getTime(),
    );
  }

  async getDailyCandles(
    chainCode: string,
    contractAddress: string,
    days: number,
  ): Promise<HistoricalCandle[]> {
    const candles = await this.getOhlcvCandles(chainCode, contractAddress, '1d', days);
    const byDate = new Map<string, HistoricalCandle>();
    for (const candle of candles) {
      const date = candle.openTime.toISOString().slice(0, 10);
      byDate.set(date, {
        date,
        openUsd: candle.open,
        highUsd: candle.high,
        lowUsd: candle.low,
        closeUsd: candle.close,
        volumeUsd: candle.volumeUsd,
      });
    }

    return [...byDate.values()].sort((left, right) => left.date.localeCompare(right.date));
  }

  private async findTopPool(
    network: string,
    contractAddress: string,
  ): Promise<PoolCandidate | null> {
    const cacheKey = `${network}:${contractAddress.toLowerCase()}`;
    const cached = this.poolCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) return cached.pool;

    const body = await this.fetchJson(
      `/networks/${network}/tokens/${encodeURIComponent(contractAddress.toLowerCase())}/pools?page=1`,
    );
    if (!body || typeof body !== 'object') {
      this.writePoolCache(cacheKey, null);
      return null;
    }

    const data = body as { data?: unknown };
    if (!Array.isArray(data.data)) {
      this.writePoolCache(cacheKey, null);
      return null;
    }

    const wanted = contractAddress.toLowerCase();
    const pools: PoolCandidate[] = [];
    for (const item of data.data) {
      if (!item || typeof item !== 'object') continue;
      const attributes = (item as { attributes?: Record<string, unknown> }).attributes;
      if (!attributes) continue;
      const address = attributes.address;
      if (typeof address !== 'string' || !address) continue;

      const relationships = (item as { relationships?: Record<string, unknown> }).relationships;
      const baseId = tokenIdFromRelationship(relationships?.base_token);
      const quoteId = tokenIdFromRelationship(relationships?.quote_token);
      const tokenSide: 'base' | 'quote' =
        baseId === wanted ? 'base' : quoteId === wanted ? 'quote' : 'base';

      const reserve = Number(attributes.reserve_in_usd);
      pools.push({
        address,
        reserveUsd: Number.isFinite(reserve) ? reserve : 0,
        tokenSide,
      });
    }

    pools.sort((left, right) => right.reserveUsd - left.reserveUsd);
    const pool = pools[0] ?? null;
    this.writePoolCache(cacheKey, pool);
    return pool;
  }

  private writePoolCache(key: string, pool: PoolCandidate | null): void {
    if (this.poolCache.size > 200) {
      const oldest = this.poolCache.keys().next().value;
      if (oldest) this.poolCache.delete(oldest);
    }
    this.poolCache.set(key, { expiresAt: Date.now() + POOL_CACHE_TTL_MS, pool });
  }

  private async throttle(): Promise<void> {
    const now = Date.now();
    const wait = Math.max(0, this.nextRequestAt - now);
    this.nextRequestAt = Math.max(now, this.nextRequestAt) + MIN_REQUEST_INTERVAL_MS;
    if (wait > 0) {
      await new Promise((resolve) => setTimeout(resolve, wait));
    }
  }

  private async fetchJson(path: string): Promise<unknown | null> {
    await this.throttle();
    try {
      const response = await fetch(`${env.GECKOTERMINAL_BASE_URL}${path}`, {
        headers: {
          accept: 'application/json;version=20230302',
        },
        signal: AbortSignal.timeout(env.GECKOTERMINAL_TIMEOUT_MS),
      });
      if (!response.ok) {
        this.logger.warn(`GeckoTerminal request failed: HTTP ${response.status}`);
        return null;
      }
      return await response.json();
    } catch (error) {
      this.logger.warn(
        `GeckoTerminal request failed: ${error instanceof Error ? error.name : 'unknown error'}`,
      );
      return null;
    }
  }
}

function tokenIdFromRelationship(value: unknown): string | null {
  if (!value || typeof value !== 'object') return null;
  const data = (value as { data?: unknown }).data;
  if (!data || typeof data !== 'object') return null;
  const id = (data as { id?: unknown }).id;
  if (typeof id !== 'string') return null;
  const separator = id.indexOf('_');
  return separator >= 0 ? id.slice(separator + 1).toLowerCase() : id.toLowerCase();
}

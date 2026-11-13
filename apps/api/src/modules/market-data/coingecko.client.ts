import { Injectable, Logger } from '@nestjs/common';
import { env } from '../../shared/config/env';
import { decimal, usdString } from '../../shared/money/decimal';
import type { HistoricalCandle } from '../trading-bots/backtest/historical.types';

export interface CoinGeckoToken {
  coingeckoId: string;
  logoUrl: string | null;
  priceUsd: string | null;
  change24hPct: string | null;
  marketCapUsd: string | null;
  volume24hUsd: string | null;
}

export interface CoinGeckoMarket {
  priceUsd: string;
  change24hPct: string | null;
  change7dPct: string | null;
  change30dPct: string | null;
  change1yPct: string | null;
  logoUrl: string | null;
  marketCapUsd: string | null;
  volume24hUsd: string | null;
}

const CACHE_TTL_MS = 5 * 60 * 1000;
const PLATFORM: Record<string, string> = {
  bsc: 'binance-smart-chain',
  ethereum: 'ethereum',
};

function optionalNumber(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return usdString(decimal(String(value)));
}

function optionalPercent(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return decimal(String(value)).toFixed(2);
}

@Injectable()
export class CoinGeckoClient {
  private readonly logger = new Logger(CoinGeckoClient.name);
  private readonly cache = new Map<string, { expiresAt: number; value: unknown }>();

  async getTokenByContract(chain: string, address: string): Promise<CoinGeckoToken | null> {
    if (env.NODE_ENV === 'test') return null;
    const platform = PLATFORM[chain];
    if (!platform) return null;

    const key = `token:${platform}:${address.toLowerCase()}`;
    const cached = this.read<CoinGeckoToken | null>(key);
    if (cached !== undefined) return cached;

    const body = await this.fetchJson(
      `/coins/${platform}/contract/${encodeURIComponent(address.toLowerCase())}`,
    );
    if (!body || typeof body !== 'object') {
      this.write(key, null);
      return null;
    }

    const data = body as {
      id?: unknown;
      image?: { large?: unknown; small?: unknown };
      market_data?: {
        current_price?: { usd?: unknown };
        price_change_percentage_24h?: unknown;
        market_cap?: { usd?: unknown };
        total_volume?: { usd?: unknown };
      };
    };
    if (typeof data.id !== 'string' || !data.id) {
      this.write(key, null);
      return null;
    }

    const market = data.market_data;
    const result: CoinGeckoToken = {
      coingeckoId: data.id,
      logoUrl:
        typeof data.image?.large === 'string'
          ? data.image.large
          : typeof data.image?.small === 'string'
            ? data.image.small
            : null,
      priceUsd: optionalNumber(market?.current_price?.usd),
      change24hPct: optionalPercent(market?.price_change_percentage_24h),
      marketCapUsd: optionalNumber(market?.market_cap?.usd),
      volume24hUsd: optionalNumber(market?.total_volume?.usd),
    };

    this.write(key, result);
    return result;
  }

  async getMarkets(ids: string[]): Promise<Map<string, CoinGeckoMarket>> {
    if (env.NODE_ENV === 'test') return new Map();
    const unique = [...new Set(ids.filter(Boolean))];
    const result = new Map<string, CoinGeckoMarket>();
    const missing: string[] = [];

    for (const id of unique) {
      const cached = this.read<CoinGeckoMarket | null>(`market:${id}`);
      if (cached) result.set(id, cached);
      else if (cached === undefined) missing.push(id);
    }

    if (missing.length === 0) return result;

    const found = new Set<string>();
    const chunks: string[][] = [];
    for (let index = 0; index < missing.length; index += 50) {
      chunks.push(missing.slice(index, index + 50));
    }

    for (const chunk of chunks) {
      const body = await this.fetchJson(
        `/coins/markets?vs_currency=usd&ids=${encodeURIComponent(chunk.join(','))}&price_change_percentage=24h,7d,30d,1y`,
      );

      if (!Array.isArray(body)) continue;

      for (const item of body) {
        if (!item || typeof item !== 'object') continue;
        const row = item as {
          id?: unknown;
          current_price?: unknown;
          price_change_percentage_24h?: unknown;
          price_change_percentage_7d_in_currency?: unknown;
          price_change_percentage_30d_in_currency?: unknown;
          price_change_percentage_1y_in_currency?: unknown;
          price_change_percentage_7d?: unknown;
          price_change_percentage_30d?: unknown;
          price_change_percentage_1y?: unknown;
          image?: unknown;
          market_cap?: unknown;
          total_volume?: unknown;
        };
        if (typeof row.id !== 'string') continue;

        const price = optionalNumber(row.current_price);
        if (!price || decimal(price).lte(0)) continue;

        const market: CoinGeckoMarket = {
          priceUsd: price,
          change24hPct: optionalPercent(row.price_change_percentage_24h),
          change7dPct: optionalPercent(
            row.price_change_percentage_7d_in_currency ?? row.price_change_percentage_7d,
          ),
          change30dPct: optionalPercent(
            row.price_change_percentage_30d_in_currency ?? row.price_change_percentage_30d,
          ),
          change1yPct: optionalPercent(
            row.price_change_percentage_1y_in_currency ?? row.price_change_percentage_1y,
          ),
          logoUrl: typeof row.image === 'string' ? row.image : null,
          marketCapUsd: optionalNumber(row.market_cap),
          volume24hUsd: optionalNumber(row.total_volume),
        };
        result.set(row.id, market);
        this.write(`market:${row.id}`, market);
        found.add(row.id);
      }
    }

    for (const id of missing) {
      if (!found.has(id)) this.write(`market:${id}`, null);
    }

    return result;
  }

  async getDailyCandles(coingeckoId: string, days: number): Promise<HistoricalCandle[]> {
    if (env.NODE_ENV === 'test') return [];

    const body = await this.fetchJson(
      `/coins/${encodeURIComponent(coingeckoId)}/market_chart?vs_currency=usd&days=${days}`,
    );
    if (!body || typeof body !== 'object') return [];

    const data = body as { prices?: unknown; total_volumes?: unknown };
    if (!Array.isArray(data.prices)) return [];

    const volumeByTimestamp = new Map<number, number>();
    if (Array.isArray(data.total_volumes)) {
      for (const point of data.total_volumes) {
        if (!Array.isArray(point) || point.length < 2) continue;
        const timestamp = Number(point[0]);
        const volume = Number(point[1]);
        if (Number.isFinite(timestamp) && Number.isFinite(volume)) {
          volumeByTimestamp.set(timestamp, volume);
        }
      }
    }

    const byDate = new Map<string, { prices: number[]; volumes: number[] }>();
    for (const point of data.prices) {
      if (!Array.isArray(point) || point.length < 2) continue;
      const timestamp = Number(point[0]);
      const price = Number(point[1]);
      if (!Number.isFinite(timestamp) || !Number.isFinite(price) || price <= 0) continue;
      const date = new Date(timestamp).toISOString().slice(0, 10);
      const entry = byDate.get(date) ?? { prices: [], volumes: [] };
      entry.prices.push(price);
      const volume = volumeByTimestamp.get(timestamp);
      if (volume !== undefined) entry.volumes.push(volume);
      byDate.set(date, entry);
    }

    return [...byDate.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([date, entry]) => {
        const open = entry.prices[0] as number;
        const close = entry.prices[entry.prices.length - 1] as number;
        const high = Math.max(...entry.prices);
        const low = Math.min(...entry.prices);
        const volume = entry.volumes.reduce((total, value) => total + value, 0);
        return {
          date,
          openUsd: usdString(decimal(String(open))),
          highUsd: usdString(decimal(String(high))),
          lowUsd: usdString(decimal(String(low))),
          closeUsd: usdString(decimal(String(close))),
          volumeUsd: entry.volumes.length > 0 ? decimal(String(volume)).toFixed(2) : null,
        };
      });
  }

  private read<T>(key: string): T | null | undefined {
    const entry = this.cache.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= Date.now()) {
      this.cache.delete(key);
      return undefined;
    }
    return entry.value as T | null;
  }

  private write(key: string, value: unknown): void {
    if (this.cache.size > 500) {
      const oldest = this.cache.keys().next().value;
      if (oldest) this.cache.delete(oldest);
    }
    this.cache.set(key, { expiresAt: Date.now() + CACHE_TTL_MS, value });
  }

  private async fetchJson(path: string): Promise<unknown | null> {
    try {
      const headers: Record<string, string> = { accept: 'application/json' };
      if (env.COINGECKO_API_KEY) headers['x-cg-demo-api-key'] = env.COINGECKO_API_KEY;

      const response = await fetch(`${env.COINGECKO_BASE_URL}${path}`, {
        headers,
        signal: AbortSignal.timeout(env.COINGECKO_TIMEOUT_MS),
      });

      if (!response.ok) {
        this.logger.warn(`CoinGecko request failed: HTTP ${response.status}`);
        return null;
      }

      return await response.json();
    } catch (error) {
      this.logger.warn(
        `CoinGecko request failed: ${error instanceof Error ? error.name : 'unknown error'}`,
      );
      return null;
    }
  }
}

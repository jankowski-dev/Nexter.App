import { Injectable, Logger } from '@nestjs/common';
import { env } from '../../shared/config/env';
import { decimal, usdString } from '../../shared/money/decimal';
import type { HistoricalCandle } from '../trading-bots/backtest/historical.types';

const NETWORK: Record<string, string> = {
  bsc: 'bsc',
  ethereum: 'eth',
};

interface PoolCandidate {
  address: string;
  reserveUsd: number;
  tokenSide: 'base' | 'quote';
}

@Injectable()
export class GeckoTerminalClient {
  private readonly logger = new Logger(GeckoTerminalClient.name);

  async getDailyCandles(
    chainCode: string,
    contractAddress: string,
    days: number,
  ): Promise<HistoricalCandle[]> {
    if (env.NODE_ENV === 'test') return [];

    const network = NETWORK[chainCode];
    if (!network) return [];

    const pool = await this.findTopPool(network, contractAddress);
    if (!pool) return [];

    const body = await this.fetchJson(
      `/networks/${network}/pools/${encodeURIComponent(pool.address)}/ohlcv/day?aggregate=1&limit=${Math.min(days, 1000)}&currency=usd&token=${pool.tokenSide}`,
    );
    if (!body || typeof body !== 'object') return [];

    const data = body as { data?: { attributes?: { ohlcv_list?: unknown } } };
    const list = data.data?.attributes?.ohlcv_list;
    if (!Array.isArray(list)) return [];

    const byDate = new Map<string, HistoricalCandle>();
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
      const date = new Date(timestamp * 1000).toISOString().slice(0, 10);
      byDate.set(date, {
        date,
        openUsd: usdString(decimal(String(open))),
        highUsd: usdString(decimal(String(high))),
        lowUsd: usdString(decimal(String(low))),
        closeUsd: usdString(decimal(String(close))),
        volumeUsd: Number.isFinite(volume) ? decimal(String(volume)).toFixed(2) : null,
      });
    }

    return [...byDate.values()].sort((left, right) => left.date.localeCompare(right.date));
  }

  private async findTopPool(
    network: string,
    contractAddress: string,
  ): Promise<PoolCandidate | null> {
    const body = await this.fetchJson(
      `/networks/${network}/tokens/${encodeURIComponent(contractAddress.toLowerCase())}/pools?page=1`,
    );
    if (!body || typeof body !== 'object') return null;

    const data = body as { data?: unknown };
    if (!Array.isArray(data.data)) return null;

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
    return pools[0] ?? null;
  }

  private async fetchJson(path: string): Promise<unknown | null> {
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

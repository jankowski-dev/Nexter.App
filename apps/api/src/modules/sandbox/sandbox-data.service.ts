import { Injectable } from '@nestjs/common';
import {
  parseSandboxTokenKey,
  SANDBOX_TIMEFRAME,
  SANDBOX_TIMEFRAME_MS,
  SANDBOX_WARMUP_DAYS,
} from '@nexter/contracts';
import { decimal, priceString } from '../../shared/money/decimal';
import type { RawCandle } from '../market-data/candle.types';
import { BinanceClient } from '../market-data/binance.client';
import { CoinGeckoClient } from '../market-data/coingecko.client';
import { GeckoTerminalClient } from '../market-data/geckoterminal.client';
import {
  SandboxRepository,
  type SandboxCandleInput,
  type SandboxTokenRecord,
} from './sandbox.repository';

/** GeckoTerminal and Binance both cap a 1h series at 5,000 bars. */
const MAX_PROVIDER_CANDLES = 5000;

/** Rows per multi-row insert; keeps statements well under the parameter limit. */
export const SANDBOX_CANDLE_UPSERT_CHUNK = 500;

export interface SandboxRefreshOptions {
  now?: Date;
  days?: number;
}

export interface SandboxRefreshResult {
  /** Closed, normalized candles returned by the provider. */
  fetched: number;
  /** Rows written by the idempotent upsert (one per open time). */
  upserted: number;
  source: string | null;
  synthetic: boolean;
}

/**
 * 1h candle ingestion for the sandbox universe.
 *
 * Reuses the HTTP-only `market-data` provider clients; no AI data service or
 * old candle table is involved. Requests stay serialized inside the clients,
 * which already throttle and bound 429 retries.
 */
@Injectable()
export class SandboxDataService {
  constructor(
    private readonly repository: SandboxRepository,
    private readonly geckoterminal: GeckoTerminalClient,
    private readonly binance: BinanceClient,
    private readonly coingecko: CoinGeckoClient,
  ) {}

  async refreshToken(
    token: SandboxTokenRecord,
    options: SandboxRefreshOptions = {},
  ): Promise<SandboxRefreshResult> {
    const now = options.now ?? new Date();
    const days = options.days ?? SANDBOX_WARMUP_DAYS;
    // Providers include the in-progress hour, which is dropped as unclosed.
    // Request one extra bar so a fresh universe stores the full 180-day window.
    const requestedBars = days * 24 + 1;
    const limit = Math.min(MAX_PROVIDER_CANDLES, Math.max(1, requestedBars));

    const candles = await this.loadCandles(token, days, limit);
    const rows = normalizeCandles(token.tokenKey, candles, now);
    const synthetic = rows.length > 0 && rows.every((row) => row.source === 'coingecko');
    let upserted = 0;
    for (let index = 0; index < rows.length; index += SANDBOX_CANDLE_UPSERT_CHUNK) {
      upserted += await this.repository.upsertCandles(
        rows.slice(index, index + SANDBOX_CANDLE_UPSERT_CHUNK),
        { protectPrimaryRows: synthetic },
      );
    }
    const sources = new Set(rows.map((row) => row.source));

    return {
      fetched: rows.length,
      upserted,
      source: sources.size === 1 ? ([...sources][0] as string) : null,
      synthetic,
    };
  }

  private async loadCandles(
    token: SandboxTokenRecord,
    days: number,
    limit: number,
  ): Promise<RawCandle[]> {
    let candles: RawCandle[] = [];

    if (token.chain === 'bsc' || token.chain === 'ethereum') {
      if (token.contractAddress) {
        candles = await this.geckoterminal.getOhlcvCandles(
          token.chain,
          token.contractAddress,
          SANDBOX_TIMEFRAME,
          limit,
        );
      }
    } else if (token.chain === 'binance') {
      const parsed = parseSandboxTokenKey(token.tokenKey);
      // Binance converts days back into a 1h bar count; pass the bar window.
      candles = await this.binance.getCandles(
        parsed?.baseSymbol ?? token.symbol,
        SANDBOX_TIMEFRAME,
        limit / 24,
      );
    }

    if (candles.length === 0 && token.coingeckoId) {
      candles = await this.coingecko.getHourlyCandles(token.coingeckoId, days);
    }

    return candles;
  }
}

/**
 * Keeps only closed bars, deduplicates by open time (last value wins), sorts
 * ascending and normalizes every price/volume to a decimal string.
 */
export function normalizeCandles(
  tokenKey: string,
  candles: RawCandle[],
  now: Date,
): SandboxCandleInput[] {
  const byOpenTime = new Map<number, RawCandle>();

  for (const candle of candles) {
    if (!(candle.openTime instanceof Date) || Number.isNaN(candle.openTime.getTime())) continue;
    // The current bar is not closed yet; a later refresh will store its final OHLCV.
    if (candle.openTime.getTime() + SANDBOX_TIMEFRAME_MS > now.getTime()) continue;
    byOpenTime.set(candle.openTime.getTime(), candle);
  }

  const rows: SandboxCandleInput[] = [];
  for (const [openTime, candle] of [...byOpenTime.entries()].sort(
    (left, right) => left[0] - right[0],
  )) {
    const normalized = normalizePrices(candle);
    if (!normalized) continue;

    rows.push({
      tokenKey,
      timeframe: SANDBOX_TIMEFRAME,
      openTime: new Date(openTime),
      ...normalized,
      source: candle.source,
      fetchedAt: now,
    });
  }

  return rows;
}

function normalizePrices(
  candle: RawCandle,
): Pick<SandboxCandleInput, 'open' | 'high' | 'low' | 'close' | 'volumeUsd'> | null {
  try {
    const open = decimal(candle.open);
    const high = decimal(candle.high);
    const low = decimal(candle.low);
    const close = decimal(candle.close);

    if (open.lte(0) || high.lte(0) || low.lte(0) || close.lte(0)) return null;
    if (high.lt(low)) return null;

    let volumeUsd = '0.000000000000000000';
    if (candle.volumeUsd !== null) {
      const volume = decimal(candle.volumeUsd);
      volumeUsd = (volume.lt(0) ? decimal('0') : volume).toFixed(18);
    }

    return {
      open: priceString(open),
      high: priceString(high),
      low: priceString(low),
      close: priceString(close),
      volumeUsd,
    };
  } catch {
    return null;
  }
}

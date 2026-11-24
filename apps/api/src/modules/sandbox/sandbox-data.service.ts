import { Injectable } from '@nestjs/common';
import {
  parseSandboxTokenKey,
  SANDBOX_STALE_AFTER_MS,
  SANDBOX_TIMEFRAME,
  SANDBOX_TIMEFRAME_MS,
  SANDBOX_WARMUP_DAYS,
} from '@nexter/contracts';
import { decimal, priceString, type Decimal } from '../../shared/money/decimal';
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

/** The provider fields a sandbox candle fetch needs; run snapshots satisfy it. */
export type SandboxDataSourceToken = Pick<
  SandboxTokenRecord,
  'tokenKey' | 'symbol' | 'chain' | 'contractAddress' | 'coingeckoId'
>;

/**
 * First live quote after a closed bar.
 *
 * `priceUsd` is the newest raw provider candle close (the in-progress hour while
 * it is open), never the historical decision close. `volumeUsd` is the last
 * closed bar's USD volume, the base of the Stage 1C liquidity cap.
 */
export interface SandboxLivePrice {
  tokenId: string;
  priceUsd: string;
  volumeUsd: string;
  /** Open time of the quoted raw bar; the fill freshness guard compares it. */
  barOpenTime: Date;
  asOf: Date;
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
    token: SandboxDataSourceToken,
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

  /**
   * Fetches the first live quote after a closed bar and upserts the newly closed
   * candles in the same provider round-trip.
   *
   * The quote close may belong to the in-progress hour; that is intentional, it
   * is the first current price after the decision bar. A missing or non-positive
   * close/volume returns `null` so the runner keeps the intent pending and never
   * fabricates a fill.
   */
  async latestPrice(
    token: SandboxDataSourceToken,
    options: SandboxRefreshOptions = {},
  ): Promise<SandboxLivePrice | null> {
    const now = options.now ?? new Date();
    const raw = await this.loadCandles(token, 1, 3);
    if (raw.length === 0) return null;

    const sorted = raw
      .filter(
        (candle) => candle.openTime instanceof Date && !Number.isNaN(candle.openTime.getTime()),
      )
      .sort((left, right) => left.openTime.getTime() - right.openTime.getTime());
    if (sorted.length === 0) return null;

    const newest = sorted[sorted.length - 1];
    if (newest === undefined) return null;
    const newestClose = safePositiveDecimal(newest.close);
    if (newestClose === null) return null;
    // A provider that stopped updating must not fill a paper order at a stale
    // price; the runner keeps the intent pending and warns through last-tick
    // health instead.
    if (newest.openTime.getTime() + SANDBOX_TIMEFRAME_MS < now.getTime() - SANDBOX_STALE_AFTER_MS) {
      return null;
    }

    const closed = sorted.filter(
      (candle) => candle.openTime.getTime() + SANDBOX_TIMEFRAME_MS <= now.getTime(),
    );
    const lastClosed = closed[closed.length - 1];
    if (lastClosed === undefined) return null;
    const volume = safePositiveDecimal(lastClosed.volumeUsd);

    const normalized = normalizeCandles(token.tokenKey, closed, now);
    if (normalized.length > 0) {
      const synthetic = normalized.every((row) => row.source === 'coingecko');
      for (let index = 0; index < normalized.length; index += SANDBOX_CANDLE_UPSERT_CHUNK) {
        await this.repository.upsertCandles(
          normalized.slice(index, index + SANDBOX_CANDLE_UPSERT_CHUNK),
          { protectPrimaryRows: synthetic },
        );
      }
    }

    if (volume === null) return null;
    return {
      tokenId: token.tokenKey,
      priceUsd: priceString(newestClose),
      volumeUsd: volume.toFixed(18),
      barOpenTime: newest.openTime,
      asOf: now,
    };
  }

  private async loadCandles(
    token: SandboxDataSourceToken,
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

function safePositiveDecimal(value: string | null): Decimal | null {
  if (value === null) return null;
  try {
    const parsed = decimal(value);
    return parsed.greaterThan(0) ? parsed : null;
  } catch {
    return null;
  }
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

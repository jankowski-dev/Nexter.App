import { Injectable, Logger } from '@nestjs/common';
import { decimal } from '../../shared/money/decimal';
import type { MarketTimeframe, RawCandle } from './candle.types';

const BINANCE_BASE_URL = 'https://api.binance.com';
const BINANCE_SYMBOLS: Record<string, string> = {
  BTC: 'BTCUSDT',
  XRP: 'XRPUSDT',
  LINK: 'LINKUSDT',
  ZEC: 'ZECUSDT',
  ETH: 'ETHUSDT',
  BNB: 'BNBUSDT',
  SOL: 'SOLUSDT',
  ADA: 'ADAUSDT',
  DOGE: 'DOGEUSDT',
  DOT: 'DOTUSDT',
  AVAX: 'AVAXUSDT',
  LTC: 'LTCUSDT',
  TRX: 'TRXUSDT',
  BCH: 'BCHUSDT',
  ATOM: 'ATOMUSDT',
  NEAR: 'NEARUSDT',
  APT: 'APTUSDT',
  ARB: 'ARBUSDT',
  OP: 'OPUSDT',
};

const INTERVALS: Partial<Record<MarketTimeframe, { interval: string; hours: number }>> = {
  '1h': { interval: '1h', hours: 1 },
  '4h': { interval: '4h', hours: 4 },
  '1d': { interval: '1d', hours: 24 },
};

const MIN_REQUEST_INTERVAL_MS = 300;
const MAX_CANDLES = 5000;

@Injectable()
export class BinanceClient {
  private readonly logger = new Logger(BinanceClient.name);
  private nextRequestAt = 0;

  async getCandles(symbol: string, timeframe: MarketTimeframe, days: number): Promise<RawCandle[]> {
    if (process.env.NODE_ENV === 'test') return [];
    const pair = BINANCE_SYMBOLS[symbol.toUpperCase()];
    const config = INTERVALS[timeframe];
    if (!pair || !config) return [];

    const target = Math.min(MAX_CANDLES, Math.max(1, Math.floor((days * 24) / config.hours)));
    const endTime = Date.now();
    const startTime = endTime - target * config.hours * 3_600_000;
    const byTime = new Map<number, RawCandle>();
    let cursor = startTime;
    let rateLimitRetries = 0;

    while (byTime.size < target && cursor < endTime) {
      const wait = Math.max(0, this.nextRequestAt - Date.now());
      this.nextRequestAt = Math.max(Date.now(), this.nextRequestAt) + MIN_REQUEST_INTERVAL_MS;
      if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));

      const url =
        `${BINANCE_BASE_URL}/api/v3/klines?symbol=${encodeURIComponent(pair)}` +
        `&interval=${config.interval}&limit=1000&startTime=${cursor}&endTime=${endTime}`;
      let list: unknown;
      try {
        const response = await fetch(url, { signal: AbortSignal.timeout(15_000) });
        if (response.status === 429) {
          rateLimitRetries += 1;
          if (rateLimitRetries > 3) break;
          await new Promise((resolve) => setTimeout(resolve, 10_000));
          continue;
        }
        if (!response.ok) {
          if (response.status !== 400) {
            this.logger.warn(`Binance request failed: HTTP ${response.status}`);
          }
          break;
        }
        list = await response.json();
      } catch (error) {
        this.logger.warn(
          `Binance request failed: ${error instanceof Error ? error.name : 'unknown error'}`,
        );
        break;
      }
      if (!Array.isArray(list) || list.length === 0) break;

      let newest = cursor;
      for (const entry of list) {
        if (!Array.isArray(entry) || entry.length < 8) continue;
        const timestamp = Number(entry[0]);
        const open = Number(entry[1]);
        const high = Number(entry[2]);
        const low = Number(entry[3]);
        const close = Number(entry[4]);
        const volumeUsd = Number(entry[7]);
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
        if (timestamp > newest) newest = timestamp;
        byTime.set(timestamp, {
          openTime: new Date(timestamp),
          open: decimal(String(open)).toFixed(8),
          high: decimal(String(high)).toFixed(8),
          low: decimal(String(low)).toFixed(8),
          close: decimal(String(close)).toFixed(8),
          volumeUsd: Number.isFinite(volumeUsd) ? decimal(String(volumeUsd)).toFixed(2) : null,
          source: 'binance',
          quality: 'ok',
        });
      }

      if (list.length < 1000 || newest <= cursor) break;
      cursor = newest + config.hours * 3_600_000;
    }

    return [...byTime.values()]
      .sort((left, right) => left.openTime.getTime() - right.openTime.getTime())
      .slice(-target);
  }
}

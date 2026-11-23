import { TIMEFRAME_MS } from '../timeframes';
import type { Candle } from '../types';

export class CandleValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CandleValidationError';
  }
}

const DECIMAL = /^-?\d+(\.\d+)?$/;

function assertDecimal(value: string, field: string): void {
  if (!DECIMAL.test(value)) throw new CandleValidationError(`${field} is not a decimal string`);
}

export function sortAndValidateCandles(candles: readonly Candle[]): Candle[] {
  const sorted = [...candles].sort(
    (left, right) =>
      left.openTime - right.openTime ||
      left.tokenId.localeCompare(right.tokenId) ||
      left.timeframe.localeCompare(right.timeframe),
  );
  const seen = new Set<string>();
  for (const candle of sorted) {
    if (!candle.tokenId) throw new CandleValidationError('tokenId is required');
    if (!candle.timeframe) throw new CandleValidationError('timeframe is required');
    if (TIMEFRAME_MS[candle.timeframe] === undefined) {
      throw new CandleValidationError(`unknown timeframe: ${candle.timeframe}`);
    }
    if (!Number.isSafeInteger(candle.openTime)) {
      throw new CandleValidationError('openTime must be a safe integer timestamp');
    }
    for (const field of ['open', 'high', 'low', 'close', 'volumeUsd'] as const) {
      assertDecimal(candle[field], field);
    }
    const open = Number(candle.open);
    const high = Number(candle.high);
    const low = Number(candle.low);
    const close = Number(candle.close);
    if (![open, high, low, close].every(Number.isFinite)) {
      throw new CandleValidationError('OHLC values must be finite');
    }
    if (high < Math.max(open, close) || low > Math.min(open, close) || high < low) {
      throw new CandleValidationError('OHLC values are inconsistent');
    }
    const key = `${candle.tokenId}|${candle.timeframe}|${candle.openTime}`;
    if (seen.has(key)) throw new CandleValidationError(`duplicate candle: ${key}`);
    seen.add(key);
  }
  return sorted;
}

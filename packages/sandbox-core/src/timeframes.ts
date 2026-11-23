import type { Candle, Timestamp } from './types';

export const TIMEFRAME_MS: Record<string, number> = {
  '5m': 5 * 60_000,
  '15m': 15 * 60_000,
  '1h': 60 * 60_000,
  '4h': 4 * 60 * 60_000,
  '1d': 24 * 60 * 60_000,
};

export function candleCloseTime(candle: Pick<Candle, 'openTime' | 'timeframe'>): Timestamp {
  // `Object.hasOwn` ignores inherited keys such as `constructor`, `toString`
  // and `__proto__`, which would otherwise resolve to functions/objects.
  if (!Object.hasOwn(TIMEFRAME_MS, candle.timeframe)) {
    throw new Error(`Unknown timeframe: ${candle.timeframe}`);
  }
  return candle.openTime + TIMEFRAME_MS[candle.timeframe];
}

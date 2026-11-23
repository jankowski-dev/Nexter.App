import type { Candle, Timestamp } from './types';

export const TIMEFRAME_MS: Record<string, number> = {
  '5m': 5 * 60_000,
  '15m': 15 * 60_000,
  '1h': 60 * 60_000,
  '4h': 4 * 60 * 60_000,
  '1d': 24 * 60 * 60_000,
};

export function candleCloseTime(candle: Pick<Candle, 'openTime' | 'timeframe'>): Timestamp {
  const step = TIMEFRAME_MS[candle.timeframe];
  if (step === undefined) throw new Error(`Unknown timeframe: ${candle.timeframe}`);
  return candle.openTime + step;
}

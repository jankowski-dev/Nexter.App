import { describe, expect, it } from 'vitest';
import { TIMEFRAME_MS, candleCloseTime } from './timeframes';

describe('timeframes', () => {
  it('maps supported timeframes to milliseconds', () => {
    expect(TIMEFRAME_MS['1h']).toBe(3_600_000);
    expect(TIMEFRAME_MS['1d']).toBe(86_400_000);
  });

  it('computes the close time from the open time', () => {
    expect(candleCloseTime({ openTime: 1_000, timeframe: '1h' })).toBe(3_601_000);
  });

  it('rejects an unknown timeframe instead of silently guessing', () => {
    expect(() => candleCloseTime({ openTime: 1_000, timeframe: '2h' })).toThrow(
      /Unknown timeframe/,
    );
  });
});

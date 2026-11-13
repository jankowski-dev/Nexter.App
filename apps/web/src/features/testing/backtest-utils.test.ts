import { describe, expect, it } from 'vitest';
import type { BotCandle } from '@nexter/contracts';
import { countMissingDays } from './backtest-utils';

function candle(date: string): BotCandle {
  return {
    date,
    openUsd: '1.00000000',
    highUsd: '1.00000000',
    lowUsd: '1.00000000',
    closeUsd: '1.00000000',
    volumeUsd: null,
  };
}

describe('countMissingDays', () => {
  it('counts gaps between daily candles', () => {
    expect(
      countMissingDays([
        candle('2026-01-01'),
        candle('2026-01-02'),
        candle('2026-01-05'),
        candle('2026-01-06'),
      ]),
    ).toBe(2);
  });

  it('returns zero for a continuous series', () => {
    expect(countMissingDays([candle('2026-01-01'), candle('2026-01-02')])).toBe(0);
  });
});

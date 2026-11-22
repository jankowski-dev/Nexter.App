import { describe, expect, it } from 'vitest';
import type { BotCandle } from '@nexter/contracts';
import { momentumBreakout } from '../trading-bots/strategies';
import type { SearchFold } from './ai-search.helpers';
import { screenVariant } from './ai-search.screen';

function candles(count: number): BotCandle[] {
  return Array.from({ length: count }, (_, index) => ({
    date: `2026-01-${String((index % 28) + 1).padStart(2, '0')}`,
    openUsd: '100.00000000',
    highUsd: '101.00000000',
    lowUsd: '99.00000000',
    closeUsd: '100.00000000',
    volumeUsd: '1000',
  }));
}

const folds: SearchFold[] = [{ candles: candles(100), warmupCandles: 20 }];

describe('screenVariant', () => {
  it('accepts a feasible variant', () => {
    expect(
      screenVariant(
        { strategyKey: momentumBreakout.key, params: momentumBreakout.defaultParams },
        folds,
      ),
    ).toEqual({
      ok: true,
      reason: null,
    });
  });

  it('rejects an unknown strategy and invalid parameters', () => {
    expect(screenVariant({ strategyKey: 'unknown', params: {} }, folds).reason).toBe(
      'unknown strategy',
    );
    expect(
      screenVariant(
        {
          strategyKey: momentumBreakout.key,
          params: { ...momentumBreakout.defaultParams, stopLossPct: -1 },
        },
        folds,
      ).reason,
    ).toBe('invalid params');
  });

  it('rejects an indicator window longer than the fold', () => {
    expect(
      screenVariant(
        {
          strategyKey: momentumBreakout.key,
          params: { ...momentumBreakout.defaultParams, slowPeriod: 80 },
        },
        [{ candles: candles(50), warmupCandles: 20 }],
      ).reason,
    ).toBe('lookback too long');
  });

  it('keeps a rising market with momentum signals', () => {
    const rising = Array.from({ length: 120 }, (_, index) => ({
      date: `2026-02-${String((index % 28) + 1).padStart(2, '0')}`,
      openUsd: String(100 + index),
      highUsd: String(101 + index),
      lowUsd: String(99 + index),
      closeUsd: String(100 + index),
      volumeUsd: '1000',
    }));
    const result = screenVariant(
      { strategyKey: momentumBreakout.key, params: momentumBreakout.defaultParams },
      [{ candles: rising, warmupCandles: 30 }],
      { timeframe: '1h', minTrades: 1 },
    );
    expect(result.ok).toBe(true);
    expect(result.signalCount).toBeGreaterThan(0);
  });

  it('rejects strategies without enough entry signals', () => {
    expect(
      screenVariant(
        { strategyKey: momentumBreakout.key, params: momentumBreakout.defaultParams },
        folds,
        { timeframe: '1h', minTrades: 1 },
      ).reason,
    ).toBe('too few entry signals');
  });

  it('rejects fast/slow ordering and impossible thresholds', () => {
    expect(
      screenVariant(
        {
          strategyKey: momentumBreakout.key,
          params: { ...momentumBreakout.defaultParams, fastPeriod: 50, slowPeriod: 20 },
        },
        folds,
      ).reason,
    ).toBe('invalid params');
  });
});

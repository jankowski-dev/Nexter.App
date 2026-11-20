import { describe, expect, it } from 'vitest';
import { strategyDefinitions } from '../trading-bots/strategies';
import { aggregateVariant, buildSearchFolds, generateSearchVariants } from './ai-search.helpers';
import type { BotCandle } from '@nexter/contracts';

function hourlyCandles(days: number): BotCandle[] {
  const start = Date.UTC(2026, 0, 1);
  return Array.from({ length: days * 24 }, (_, index) => ({
    date: new Date(start + index * 3_600_000).toISOString(),
    openUsd: '1.00000000',
    highUsd: '1.01000000',
    lowUsd: '0.99000000',
    closeUsd: '1.00000000',
    volumeUsd: '1000',
  }));
}

describe('AI search helpers', () => {
  it('generates deterministic, valid variants and excludes manual strategies', () => {
    const first = generateSearchVariants(strategyDefinitions, 120, 42);
    const second = generateSearchVariants(strategyDefinitions, 120, 42);
    expect(first).toEqual(second);
    expect(first.length).toBeLessThanOrEqual(120);
    expect(first.some((variant) => variant.strategyKey === 'static_limit')).toBe(false);
    for (const variant of first) {
      const definition = strategyDefinitions.find((item) => item.key === variant.strategyKey);
      expect(definition).toBeDefined();
      expect(() => definition?.parseParams(variant.params)).not.toThrow();
    }
  });

  it('builds eight non-overlapping OOS folds and a 30-day holdout', () => {
    const { folds, holdout } = buildSearchFolds(hourlyCandles(180), '1h');
    expect(folds).toHaveLength(8);
    expect(folds[0]?.warmupCandles).toBe(360);
    expect(folds[0]?.candles).toHaveLength(600);
    expect(holdout).toHaveLength(720);
    const lastFold = folds.at(-1);
    expect(lastFold?.candles.at(-1)?.date).not.toBe(holdout[0]?.date);
    expect((lastFold?.candles.at(-1)?.date ?? '') < (holdout[0]?.date ?? '')).toBe(true);
  });

  it('aggregates median, worst, drawdown, trades and stability', () => {
    const metrics = aggregateVariant([
      { totalReturnPct: '5', maxDrawdownPct: '2', tradesCount: 3 },
      { totalReturnPct: '-1', maxDrawdownPct: '4', tradesCount: 2 },
      { totalReturnPct: '2', maxDrawdownPct: '3', tradesCount: 2 },
    ]);
    expect(metrics.oosMedianReturnPct).toBe('2.00');
    expect(metrics.oosWorstReturnPct).toBe('-1.00');
    expect(metrics.maxDrawdownPct).toBe('4.00');
    expect(metrics.trades).toBe(7);
    expect(metrics.positiveFolds).toBe(2);
    expect(metrics.stabilityPct).toBe('66.67');
  });
});

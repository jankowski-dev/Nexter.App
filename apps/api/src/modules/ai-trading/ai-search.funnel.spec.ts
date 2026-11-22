import { describe, expect, it } from 'vitest';
import {
  FULL_MAX_DRAWDOWN_PCT,
  FULL_MIN_WORST_RETURN_PCT,
  estimateRecall,
  overallPercent,
  passesFullCriteria,
  seededSample,
} from './ai-search.funnel';

const passing = {
  trades: 10,
  oosMedianReturnPct: '5.00',
  positiveFolds: 6,
  maxDrawdownPct: String(FULL_MAX_DRAWDOWN_PCT),
  oosWorstReturnPct: String(FULL_MIN_WORST_RETURN_PCT),
};

describe('ai-search funnel', () => {
  it('applies the same OOS gates as the service', () => {
    expect(passesFullCriteria(passing, 8, 5)).toBe(true);
    expect(passesFullCriteria({ ...passing, trades: 7 }, 8, 5)).toBe(false);
    expect(passesFullCriteria({ ...passing, oosMedianReturnPct: '0' }, 8, 5)).toBe(false);
    expect(passesFullCriteria({ ...passing, positiveFolds: 4 }, 8, 5)).toBe(false);
    expect(passesFullCriteria({ ...passing, maxDrawdownPct: '20.01' }, 8, 5)).toBe(false);
    expect(passesFullCriteria({ ...passing, oosWorstReturnPct: '-15.01' }, 8, 5)).toBe(false);
  });

  it('samples deterministically without duplicates', () => {
    const items = Array.from({ length: 100 }, (_, index) => index);
    const first = seededSample(items, 10, 'run-1:probe');
    const second = seededSample(items, 10, 'run-1:probe');
    expect(first).toEqual(second);
    expect(new Set(first).size).toBe(10);
    expect(first.every((item) => items.includes(item))).toBe(true);
  });

  it('returns all items when the sample is larger than the pool', () => {
    expect(seededSample([1, 2, 3], 10, 'seed')).toEqual([1, 2, 3]);
    expect(seededSample([], 10, 'seed')).toEqual([]);
  });

  it('estimates missed passers from control groups', () => {
    const recall = estimateRecall(95, [
      { rejected: 1000, sampled: 50, passed: 0 },
      { rejected: 500, sampled: 50, passed: 5 },
    ]);
    expect(recall.missed).toBe(50);
    expect(Number(recall.recallPct)).toBeCloseTo(65.52, 2);
    expect(estimateRecall(10, [])).toEqual({ missed: 0, recallPct: null });
  });

  it('keeps overall progress monotonic across stages', () => {
    const stages = ['screen', 'probe', 'budget', 'full', 'control', 'holdout'] as const;
    let previous = -1;
    for (const stage of stages) {
      for (const fraction of [0, 0.5, 1]) {
        const percent = overallPercent([...stages], stage, fraction);
        expect(percent).toBeGreaterThanOrEqual(previous);
        previous = percent;
      }
    }
    expect(previous).toBe(100);
  });

  it('normalizes weights when a stage is disabled', () => {
    const stages = ['screen', 'full', 'holdout'] as const;
    const afterScreen = overallPercent([...stages], 'full', 0);
    const afterFull = overallPercent([...stages], 'holdout', 0);
    expect(afterScreen).toBeGreaterThan(0);
    expect(afterScreen).toBeLessThan(afterFull);
    expect(overallPercent([...stages], 'holdout', 1)).toBe(100);
  });
});

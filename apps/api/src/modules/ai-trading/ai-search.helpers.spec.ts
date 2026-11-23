import { describe, expect, it } from 'vitest';
import { strategyDefinitions } from '../trading-bots/strategies';
import {
  aggregateVariant,
  buildSearchFolds,
  generateSearchVariants,
  historyDaysFor,
  holdoutBlockStats,
  holdoutRejection,
  minPositiveFoldsFor,
  minTradesFor,
  selectHoldoutCandidates,
  shuffleVariantsInPlace,
  strategyKeysForMode,
  stabilityPctFor,
} from './ai-search.helpers';
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

  it('derives exclusive strategy keys for the queued and inline paths', () => {
    expect(strategyKeysForMode(strategyDefinitions, 'adaptive')).toEqual(['adaptive_regime']);
    const legacy = strategyKeysForMode(strategyDefinitions, 'legacy');
    expect(legacy).not.toContain('adaptive_regime');
    expect(legacy).toHaveLength(12);
  });

  it('filters the adaptive strategy from legacy mode and includes only it in adaptive mode', () => {
    const legacyKeys = strategyDefinitions
      .filter(
        (definition) => definition.key !== 'adaptive_regime' && definition.aiEligible !== false,
      )
      .map((definition) => definition.key);
    const legacy = generateSearchVariants(strategyDefinitions, 120, 42, legacyKeys);
    expect(legacy.some((variant) => variant.strategyKey === 'adaptive_regime')).toBe(false);
    expect(new Set(legacy.map((variant) => variant.strategyKey)).size).toBe(12);
    const adaptive = generateSearchVariants(strategyDefinitions, 120, 42, ['adaptive_regime']);
    expect(adaptive.length).toBeGreaterThan(0);
    expect(adaptive.every((variant) => variant.strategyKey === 'adaptive_regime')).toBe(true);
  });

  it('shuffles variants deterministically with the same seed', () => {
    const first = generateSearchVariants(strategyDefinitions, 120, 42);
    const second = structuredClone(first);
    shuffleVariantsInPlace(first, 7);
    shuffleVariantsInPlace(second, 7);
    expect(first).toEqual(second);
    expect(first).not.toEqual(generateSearchVariants(strategyDefinitions, 120, 42));
    expect(new Set(first.map((variant) => JSON.stringify(variant))).size).toBe(first.length);
  });

  it('builds seven OOS folds and a warmup-prefixed 45-day holdout', () => {
    const {
      folds,
      holdout,
      settlementRanges,
      settlementDays,
      holdoutCycles,
      holdoutWarmup,
      holdoutWarmupCandles,
    } = buildSearchFolds(hourlyCandles(180), '1h');
    expect(folds).toHaveLength(7);
    expect(folds[0]?.warmupCandles).toBe(1488);
    expect(folds[0]?.candles).toHaveLength(1728);
    expect(holdout).toHaveLength(1080);
    expect(settlementDays).toBe(5);
    expect(holdoutCycles).toBe(3);
    expect(settlementRanges).toEqual([
      { start: 240, end: 360 },
      { start: 600, end: 720 },
      { start: 960, end: 1080 },
    ]);
    expect(holdoutWarmup).toHaveLength(2160);
    expect(holdoutWarmupCandles).toBe(2160);
    expect((holdoutWarmup.at(-1)?.date ?? '') < (holdout[0]?.date ?? '')).toBe(true);
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

function candidate(strategyKey: string, policyScore: number, id: string) {
  return {
    id,
    policyScore: policyScore.toFixed(4),
    oosMedianReturnPct: '1.00',
    variant: { strategyKey, params: { id } },
  };
}

describe('holdout selection', () => {
  it('selects 50 candidates round-robin by strategy and fills the remainder by score', () => {
    const keys = Array.from({ length: 12 }, (_, index) => `s${String(index).padStart(2, '0')}`);
    const candidates = keys.flatMap((key, strategyIndex) =>
      Array.from({ length: 5 }, (_, rank) =>
        candidate(key, 100 - strategyIndex - rank * 10, `${key}-${rank}`),
      ),
    );
    const selected = selectHoldoutCandidates(candidates, 50);
    expect(selected).toHaveLength(50);
    expect(new Set(selected.map((item) => item.id)).size).toBe(50);
    expect(selected.slice(0, 12).map((item) => item.variant.strategyKey)).toEqual(keys);
    expect(selected.slice(12, 24).map((item) => item.variant.strategyKey)).toEqual(keys);
    expect(selected.slice(-2).map((item) => item.id)).toEqual(['s00-4', 's01-4']);
    expect(selectHoldoutCandidates(candidates, 50)).toEqual(selected);
  });

  it('skips exhausted strategies and never duplicates candidates', () => {
    const candidates = [
      candidate('a', 10, 'a-0'),
      candidate('b', 9, 'b-0'),
      candidate('b', 8, 'b-1'),
      candidate('b', 7, 'b-2'),
    ];
    const selected = selectHoldoutCandidates(candidates, 5);
    expect(selected.map((item) => item.id)).toEqual(['a-0', 'b-0', 'b-1', 'b-2']);
  });
});

describe('holdout blocks', () => {
  it('splits the holdout equity curve into three equal blocks', () => {
    const curve = [100, 110, 120, 100, 90, 80, 90, 100, 110].map((equity) => ({
      equityUsd: String(equity),
    }));
    const stats = holdoutBlockStats(curve, 3, {
      exposure: [true, true, true, false, false, false, true, true, true],
    });
    expect(stats).not.toBeNull();
    expect(stats?.returnsPct).toEqual(['20.00', '-33.33', '37.50']);
    expect(stats?.positive).toBe(2);
    expect(stats?.nonNegative).toBe(2);
    expect(stats?.traded).toBe(2);
    expect(stats?.total).toBe(3);
    expect(stats?.lastNegative).toBe(false);
  });

  it('handles a 45-point curve and requires at least two points per block', () => {
    const curve = Array.from({ length: 45 }, (_, index) => ({ equityUsd: String(100 + index) }));
    const exposure = Array.from({ length: 45 }, (_, index) => index < 15 || index >= 30);
    const stats = holdoutBlockStats(curve, 3, { exposure });
    expect(stats?.total).toBe(3);
    expect(stats?.returnsPct).toHaveLength(3);
    expect(stats?.traded).toBe(2);
    expect(
      holdoutBlockStats([{ equityUsd: '100' }, { equityUsd: '110' }, { equityUsd: '120' }], 3),
    ).toBeNull();
  });

  it('flags a negative last block and an unusable curve', () => {
    const lastNegative = holdoutBlockStats(
      [100, 110, 120, 130, 140, 150, 100, 90, 80].map((equity) => ({
        equityUsd: String(equity),
      })),
      3,
      { exposure: [true, true, true, true, true, true, true, true, true] },
    );
    expect(lastNegative?.positive).toBe(2);
    expect(lastNegative?.traded).toBe(3);
    expect(lastNegative?.lastNegative).toBe(true);
    expect(holdoutBlockStats([{ equityUsd: '100' }, { equityUsd: '110' }], 3)).toBeNull();
  });
});

describe('partial history windows', () => {
  it('counts available days and fits fewer folds into a 146-day window', () => {
    const candles = hourlyCandles(146);
    expect(historyDaysFor(candles, '1h')).toBe(146);
    const { folds, holdout, settlementDays, holdoutCycles } = buildSearchFolds(candles, '1h', 146);
    expect(folds).toHaveLength(3);
    expect(holdout).toHaveLength(1080);
    expect(settlementDays).toBe(5);
    expect(holdoutCycles).toBe(3);
    expect(folds.at(-1)?.candles.at(-1)?.date).not.toBe(holdout[0]?.date);
  });

  it('rejects windows below the minimum search history', () => {
    expect(() => buildSearchFolds(hourlyCandles(139), '1h', 139)).toThrow();
  });

  it('scales the multi-fold filters to the available fold count', () => {
    expect(minPositiveFoldsFor(5)).toBe(4);
    expect(minPositiveFoldsFor(8)).toBe(5);
    expect(minTradesFor(5)).toBe(5);
    expect(minTradesFor(8)).toBe(8);
  });
});

const passingBlocks = {
  returnsPct: ['1.00', '2.00', '3.00'],
  positive: 3,
  nonNegative: 3,
  traded: 3,
  total: 3,
  lastNegative: false,
};

describe('holdoutRejection', () => {
  it('accepts a positive holdout below the drawdown limit', () => {
    expect(holdoutRejection(5, 10, 20, passingBlocks)).toBeNull();
  });

  it('labels a non-positive return as a negative holdout', () => {
    expect(holdoutRejection(0, 10, 20, passingBlocks)).toBe('negative holdout');
    expect(holdoutRejection(-1, 10, 20, passingBlocks)).toBe('negative holdout');
  });

  it('labels a positive return with a high drawdown separately', () => {
    expect(holdoutRejection(108.78, 21, 20, passingBlocks)).toBe('holdout drawdown too high');
  });

  it('rejects unstable/active/last blocks and missing blocks', () => {
    expect(holdoutRejection(5, 10, 20, { ...passingBlocks, positive: 1 })).toBe(
      'holdout blocks unstable',
    );
    expect(holdoutRejection(5, 10, 20, { ...passingBlocks, traded: 1 })).toBe(
      'holdout too few active blocks',
    );
    expect(holdoutRejection(5, 10, 20, { ...passingBlocks, positive: 2, lastNegative: true })).toBe(
      'holdout recent block negative',
    );
    expect(holdoutRejection(5, 10, 20, null)).toBe('holdout blocks unavailable');
  });
});

describe('stabilityPctFor', () => {
  it('uses the actual fold count as the denominator', () => {
    expect(stabilityPctFor(5, 8)).toBe('62.50');
    expect(stabilityPctFor(5, 10)).toBe('50.00');
    expect(stabilityPctFor(3, 6)).toBe('50.00');
  });
});

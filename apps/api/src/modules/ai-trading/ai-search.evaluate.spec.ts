import { describe, expect, it } from 'vitest';
import type { BotCandle } from '@nexter/contracts';
import { momentumBreakout } from '../trading-bots/strategies';
import {
  searchWorkerCount,
  splitVariants,
  type SearchFold,
  type SearchVariant,
} from './ai-search.helpers';
import { evaluateVariantFolds } from './ai-search.evaluate';

function candles(count: number, start = 100): BotCandle[] {
  return Array.from({ length: count }, (_, index) => {
    const price = start + Math.sin(index / 5) * 4 + index * 0.2;
    const date = new Date(Date.UTC(2026, 0, 1 + index)).toISOString().slice(0, 10);
    return {
      date,
      openUsd: price.toFixed(8),
      highUsd: (price * 1.01).toFixed(8),
      lowUsd: (price * 0.99).toFixed(8),
      closeUsd: price.toFixed(8),
      volumeUsd: '1000000',
    };
  });
}

const folds: SearchFold[] = [
  { candles: candles(80), warmupCandles: 20 },
  { candles: candles(80, 110), warmupCandles: 20 },
];

const variant: SearchVariant = {
  strategyKey: momentumBreakout.key,
  params: momentumBreakout.defaultParams,
};

describe('evaluateVariantFolds', () => {
  it('returns aggregate metrics for a valid variant', () => {
    const result = evaluateVariantFolds(variant, folds, '1h');
    expect(result.unknownStrategy).toBeFalsy();
    expect(result.aggregate).not.toBeNull();
    expect(Number(result.aggregate?.trades)).toBeGreaterThanOrEqual(0);
  });

  it('marks an unknown strategy', () => {
    const result = evaluateVariantFolds({ strategyKey: 'does-not-exist', params: {} }, folds, '1h');
    expect(result).toMatchObject({ unknownStrategy: true, aggregate: null });
  });

  it('returns a null aggregate when a fold backtest fails', () => {
    const result = evaluateVariantFolds(variant, [{ candles: [], warmupCandles: 0 }], '1h');
    expect(result).toMatchObject({ unknownStrategy: false, aggregate: null });
  });
});

describe('splitVariants', () => {
  it('splits every variant exactly once into balanced chunks', () => {
    const variants = Array.from({ length: 10 }, (_, index) => ({
      strategyKey: 's',
      params: { index },
    }));
    const chunks = splitVariants(variants, 3);
    expect(chunks.map((chunk) => chunk.length)).toEqual([4, 3, 3]);
    expect(chunks.flat()).toEqual(variants);
  });

  it('never returns empty chunks', () => {
    expect(splitVariants([], 4)).toEqual([]);
    expect(splitVariants([{ strategyKey: 's', params: {} }], 8)).toHaveLength(1);
  });
});

describe('searchWorkerCount', () => {
  it('uses four workers by default and respects the CPU cap', () => {
    expect(searchWorkerCount({}, 8)).toBe(4);
    expect(searchWorkerCount({}, 1)).toBe(2);
  });

  it('honours the environment override and clamps it', () => {
    expect(searchWorkerCount({ AI_SEARCH_WORKERS: '0' }, 8)).toBe(1);
    expect(searchWorkerCount({ AI_SEARCH_WORKERS: '2' }, 8)).toBe(2);
    expect(searchWorkerCount({ AI_SEARCH_WORKERS: '100' }, 8)).toBe(7);
    expect(searchWorkerCount({ AI_SEARCH_WORKERS: 'abc' }, 8)).toBe(4);
  });
});

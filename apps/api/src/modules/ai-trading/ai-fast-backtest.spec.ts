import type { BotCandle } from '@nexter/contracts';
import { describe, expect, it } from 'vitest';
import { runBacktest } from '../trading-bots/backtest/backtest.engine';
import { dailyAverage, strategyDefinitions } from '../trading-bots/strategies';
import { createFastRuntime } from './ai-fast-strategies';
import { aggregateVariant, buildSearchFolds, generateSearchVariants } from './ai-search.helpers';
import { evaluateVariantFolds } from './ai-search.evaluate';

function seededCandles(): BotCandle[] {
  let state = 12345;
  const random = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
  let price = 100;
  const start = Date.parse('2026-05-01T00:00:00Z');
  return Array.from({ length: 4320 }, (_, index) => {
    price = Math.max(
      1,
      price *
        (1 + (Math.sin(index / 37) + Math.cos(index / 113)) * 0.002 + (random() - 0.5) * 0.01),
    );
    return {
      date: new Date(start + index * 3_600_000).toISOString(),
      openUsd: price.toFixed(8),
      highUsd: (price * 1.003).toFixed(8),
      lowUsd: (price * 0.997).toFixed(8),
      closeUsd: price.toFixed(8),
      volumeUsd: '1000000',
    };
  });
}

describe('native AI search engine', () => {
  it('matches the Decimal engine for every strategy after the ambiguity fallback', () => {
    const candles = seededCandles();
    const folds = buildSearchFolds(candles, '1h');
    const fold = folds.folds[0];
    if (!fold) throw new Error('fold fixture missing');
    const variants = generateSearchVariants(strategyDefinitions, 2000, 7);

    for (const definition of strategyDefinitions) {
      if (definition.aiEligible === false) continue;
      const sample = variants
        .filter((variant) => variant.strategyKey === definition.key)
        .slice(0, 2);
      expect(sample.length).toBeGreaterThan(0);
      for (const variant of sample) {
        for (const execution of ['same-close', 'next-open'] as const) {
          const fast = evaluateVariantFolds(variant, [fold], '1h', execution);
          expect(fast.unknownStrategy).toBe(false);
          expect(fast.aggregate).not.toBeNull();
          const decimal = runBacktest(definition, variant.params, fold.candles, {
            initialCapitalUsd: '1000',
            feeBps: 25,
            slippageBps: 10,
            changeLookbackCandles: 24,
            warmupCandles: fold.warmupCandles,
            execution,
          });
          expect({
            strategy: definition.key,
            params: variant.params,
            execution,
            ...fast.aggregate,
          }).toEqual({
            strategy: definition.key,
            params: variant.params,
            execution,
            ...aggregateVariant([decimal.stats]),
          });
        }
      }
    }
  }, 180_000);

  it('has no native runtime for daily_average and uses the Decimal fallback', () => {
    const candles = seededCandles().slice(0, 30 * 24);
    const variant = { strategyKey: 'daily_average', params: dailyAverage.defaultParams };
    expect(createFastRuntime(variant, candles)).toBeNull();

    const result = evaluateVariantFolds(
      variant,
      [{ candles, warmupCandles: 10 * 24 }],
      '1h',
      'next-open',
    );
    expect(result.unknownStrategy).toBe(false);
    expect(result.aggregate).not.toBeNull();
    expect(typeof result.aggregate?.trades).toBe('number');
  }, 30_000);
});

import { describe, expect, it } from 'vitest';
import type { BotCandle } from '@nexter/contracts';
import { adaptiveRegime } from './index';
import type { StrategyContext } from './types';

function dailySeries(closes: number[]): BotCandle[] {
  return closes.map((close, index) => {
    const date = new Date(Date.UTC(2026, 0, 1 + index)).toISOString();
    const value = close.toFixed(8);
    return {
      date,
      openUsd: value,
      highUsd: (close * 1.002).toFixed(8),
      lowUsd: (close * 0.998).toFixed(8),
      closeUsd: value,
      volumeUsd: '1000000',
    };
  });
}

function context(
  candles: BotCandle[],
  price: number,
  overrides: Partial<StrategyContext> = {},
): StrategyContext {
  const params = adaptiveRegime.parseParams({
    trendFastDays: 3,
    trendSlowDays: 14,
    trendLongDays: 60,
    pullbackPct: 1,
    atrStopMult: 2.5,
    trailPct: 4,
    crashDrawdownPct: 10,
    maxAdds: 2,
  });
  const now = new Date(candles[candles.length - 1]?.date ?? Date.now());
  now.setUTCDate(now.getUTCDate() + 1);
  return {
    now,
    params,
    priceUsd: price.toFixed(8),
    change24hPct: null,
    history: [],
    candles,
    position: null,
    buyCount: 0,
    state: {},
    ...overrides,
  };
}

describe('adaptiveRegime', () => {
  it('stays dormant in a falling market', () => {
    const candles = dailySeries(Array.from({ length: 30 }, (_, index) => 200 - index * 2));
    const decision = adaptiveRegime.evaluate(context(candles, 140));
    expect(decision.action).toBe('hold');
    expect(decision.reason).toContain('нет тренда');
  });

  it('buys a pullback in an uptrend', () => {
    const closes = Array.from({ length: 90 }, (_, index) => 100 + index * 1.1);
    const candles = dailySeries(closes);
    const decision = adaptiveRegime.evaluate(context(candles, closes[closes.length - 1]! - 4));
    expect(decision.action).toBe('buy');
    expect(decision.reason).toContain('откат');
  });

  it('exits on a trailing stop after a rise and giveback', () => {
    const candles = dailySeries(Array.from({ length: 90 }, (_, index) => 100 + index * 1.1));
    const decision = adaptiveRegime.evaluate(
      context(candles, 210, {
        position: { amount: '5', avgCostUsd: '197', costBasisUsd: '985' },
        state: { hwm: '220', trailStop: '211.2', phase: 'UPTREND' },
      }),
    );
    expect(decision.action).toBe('sell');
    expect(decision.reason).toContain('трейлинг');
  });

  it('cuts a crash and enters cooldown', () => {
    const candles = dailySeries(Array.from({ length: 90 }, (_, index) => 100 + index * 1.1));
    const decision = adaptiveRegime.evaluate(
      context(candles, 195, {
        position: { amount: '5', avgCostUsd: '197', costBasisUsd: '985' },
        state: { hwm: '220', phase: 'UPTREND' },
      }),
    );
    expect(decision.action).toBe('sell');
    expect(decision.reason).toContain('обвал');
    expect(decision.nextState?.cooldownUntil).toBeTypeOf('string');
  });

  it('does not buy during cooldown', () => {
    const candles = dailySeries(Array.from({ length: 90 }, (_, index) => 100 + index * 1.1));
    const decision = adaptiveRegime.evaluate(
      context(candles, 200, {
        state: { phase: 'COOLDOWN', cooldownUntil: '2099-01-01T00:00:00.000Z' },
      }),
    );
    expect(decision.action).toBe('hold');
    expect(decision.reason).toBe('cooldown');
  });
});

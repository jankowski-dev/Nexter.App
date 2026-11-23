import { describe, expect, it } from 'vitest';
import { candleCloseTime } from '../../timeframes';
import type { Candle } from '../../types';
import { DEFAULT_STRATEGY_SETTINGS } from '../defaults';
import { makeSeries } from '../fixtures.test-helpers';
import { Reason } from '../reason-codes';
import type { Regime, StrategyKey } from '../types';
import {
  createStrategySet,
  eligibleStrategyFor,
  rangeReversionStrategy,
  recoveryStrategy,
  trendPullbackStrategy,
} from './index';

const ALL_REGIMES: readonly Regime[] = [
  'TREND_UP',
  'TREND_DOWN',
  'RANGE',
  'CRASH',
  'RECOVERY',
  'ILLIQUID',
  'UNKNOWN',
];

function context(candles: readonly Candle[], regime: Regime) {
  return {
    now: candleCloseTime(candles[candles.length - 1] as Candle),
    tokenId: 'token',
    timeframe: '1h' as const,
    regime,
    candles,
    position: null,
    state: {},
  };
}

describe('eligibleStrategyFor', () => {
  it('maps exactly three regimes and returns null for the rest', () => {
    const expected: Record<Regime, StrategyKey | null> = {
      TREND_UP: 'trend_pullback',
      RANGE: 'range_reversion',
      RECOVERY: 'recovery',
      TREND_DOWN: null,
      CRASH: null,
      ILLIQUID: null,
      UNKNOWN: null,
    };

    for (const regime of ALL_REGIMES) {
      expect(eligibleStrategyFor(regime)).toBe(expected[regime]);
    }
  });
});

describe('createStrategySet', () => {
  it('returns three runtimes with the expected versions and eligible regimes', () => {
    const set = createStrategySet(DEFAULT_STRATEGY_SETTINGS);

    expect(Object.keys(set).sort()).toEqual(['range_reversion', 'recovery', 'trend_pullback']);
    expect(set.trend_pullback.key).toBe('trend_pullback');
    expect(set.trend_pullback.version).toBe(1);
    expect(set.trend_pullback.eligibleRegimes).toEqual(['TREND_UP']);
    expect(set.range_reversion.key).toBe('range_reversion');
    expect(set.range_reversion.version).toBe(1);
    expect(set.range_reversion.eligibleRegimes).toEqual(['RANGE']);
    expect(set.recovery.key).toBe('recovery');
    expect(set.recovery.version).toBe(1);
    expect(set.recovery.eligibleRegimes).toEqual(['RECOVERY']);
  });

  it('exposes the same versions and regimes as the definitions', () => {
    const set = createStrategySet(DEFAULT_STRATEGY_SETTINGS);

    expect(set.trend_pullback.version).toBe(trendPullbackStrategy.version);
    expect(set.range_reversion.version).toBe(rangeReversionStrategy.version);
    expect(set.recovery.version).toBe(recoveryStrategy.version);
    expect(set.trend_pullback.eligibleRegimes).toBe(trendPullbackStrategy.eligibleRegimes);
    expect(set.range_reversion.eligibleRegimes).toBe(rangeReversionStrategy.eligibleRegimes);
    expect(set.recovery.eligibleRegimes).toBe(recoveryStrategy.eligibleRegimes);
  });

  it('returns a signal with a reason code and non-empty text for every runtime', () => {
    const candles = makeSeries({ count: 200, startPrice: 100, stepPct: 0.5 });
    const set = createStrategySet(DEFAULT_STRATEGY_SETTINGS);

    for (const runtime of Object.values(set)) {
      const result = runtime.evaluate(context(candles, runtime.eligibleRegimes[0] as Regime));
      expect(result.reasonCode.length).toBeGreaterThan(0);
      expect(result.reasonText.length).toBeGreaterThan(0);
      expect(Object.values(Reason)).toContain(result.reasonCode);
    }
  });

  it('closes over the supplied params instead of the defaults', () => {
    const candles = makeSeries({ count: 200, startPrice: 100, stepPct: 0.5 });
    const set = createStrategySet({
      ...DEFAULT_STRATEGY_SETTINGS,
      recovery: { fastPeriod: 3, confirmBars: 1, stopPct: 4, riskWeight: 0.25 },
    });

    const result = set.recovery.evaluate(context(candles, 'RECOVERY'));
    expect(result.action).toBe('buy');
    expect(result.stopLossPct).toBe('4.00');
    expect(result.riskWeight).toBe(0.25);
  });
});

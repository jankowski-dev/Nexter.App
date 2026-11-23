import { describe, expect, it } from 'vitest';
import { TIMEFRAME_MS, candleCloseTime } from '../../timeframes';
import type { Candle } from '../../types';
import { makeSeries } from '../fixtures.test-helpers';
import { Reason } from '../reason-codes';
import type { PortfolioPosition, RangeReversionParams, Regime } from '../types';
import type { StrategyContext } from './index';
import { RANGE_REVERSION_ATR_PERIOD, rangeReversionStrategy } from './range-reversion';

const PARAMS: RangeReversionParams = {
  lookback: 6,
  bandAtrMult: 1.5,
  stopAtrMult: 2,
};

const START = Date.UTC(2026, 0, 1);
const HOUR = TIMEFRAME_MS['1h'] as number;

function position(avgCostUsd: string): PortfolioPosition {
  return {
    tokenId: 'token',
    strategyKey: 'range_reversion',
    strategyVersion: 1,
    amount: '1',
    avgCostUsd,
    marketPriceUsd: avgCostUsd,
    marketValueUsd: avgCostUsd,
    openedAt: 1_000,
    stopLossPct: null,
    takeProfitPct: null,
  };
}

function candle(index: number, close: number, highDelta = 0.2, lowDelta = 0.2): Candle {
  return {
    tokenId: 'token',
    timeframe: '1h',
    openTime: START + index * HOUR,
    open: close.toFixed(8),
    high: (close + highDelta).toFixed(8),
    low: (close - lowDelta).toFixed(8),
    close: close.toFixed(8),
    volumeUsd: '100000',
  };
}

function flatThenLast(lastClose: number, options: { highDelta?: number; lowDelta?: number } = {}) {
  const candles = Array.from({ length: 19 }, (_, index) =>
    candle(index, 100, options.highDelta, options.lowDelta),
  );
  candles.push(candle(19, lastClose, options.highDelta, options.lowDelta));
  return candles;
}

function context(
  candles: readonly Candle[],
  overrides: {
    regime?: Regime;
    position?: PortfolioPosition | null;
    state?: Readonly<Record<string, unknown>>;
  } = {},
): StrategyContext {
  const last = candles[candles.length - 1] as Candle;
  return {
    now: candleCloseTime(last),
    tokenId: 'token',
    timeframe: '1h',
    regime: overrides.regime ?? 'RANGE',
    candles,
    position: overrides.position ?? null,
    state: overrides.state ?? {},
  };
}

function evaluate(
  candles: readonly Candle[],
  overrides: Parameters<typeof context>[1] = {},
  params: RangeReversionParams = PARAMS,
) {
  return rangeReversionStrategy.evaluate(context(candles, overrides), params);
}

describe('range reversion strategy', () => {
  it('buys below the lower ATR band around the range midpoint', () => {
    const candles = flatThenLast(95);
    const result = evaluate(candles);

    expect(result.action).toBe('buy');
    expect(result.reasonCode).toBe(Reason.RANGE_REVERSION_ENTRY);
    expect(result.confidence).toBe(0.55);
    expect(result.riskWeight).toBe(1);
    expect(result.stopLossPct).not.toBeNull();
    expect(result.takeProfitPct).toBeNull();
    expect(result.nextState).toEqual({});
    expect(result.reasonText.length).toBeGreaterThan(0);
  });

  it('holds when the close stays inside the band', () => {
    const candles = flatThenLast(100);
    const result = evaluate(candles);

    expect(result.action).toBe('hold');
    expect(result.reasonCode).toBe(Reason.RANGE_REVERSION_HOLD);
    expect(result.nextState).toEqual({});
  });

  it('does not buy outside the RANGE regime and preserves state', () => {
    const state = { hwm: 10 };
    const result = evaluate(flatThenLast(95), { regime: 'TREND_UP', state });

    expect(result.action).toBe('hold');
    expect(result.reasonCode).toBe(Reason.STRATEGY_NOT_ELIGIBLE);
    expect(result.nextState).toEqual(state);
  });

  it('returns NO_DATA and preserves state when the range window is short', () => {
    const state = { hwm: 10 };
    const candles = makeSeries({ count: 5, startPrice: 100, pattern: 'flat' });
    const result = evaluate(candles, { state });

    expect(result.action).toBe('hold');
    expect(result.reasonCode).toBe(Reason.STRATEGY_NO_DATA);
    expect(result.nextState).toEqual(state);
  });

  it('sells at the hard stop first', () => {
    const candles = flatThenLast(90);
    const result = evaluate(candles, { position: position('100') });

    expect(result.action).toBe('sell');
    expect(result.reasonCode).toBe(Reason.RANGE_REVERSION_STOP);
    expect(result.nextState).toEqual({});
  });

  it('sells back at the range midpoint', () => {
    const candles = flatThenLast(100, { highDelta: 1, lowDelta: 1 });
    const result = evaluate(candles, { position: position('97') });

    expect(result.action).toBe('sell');
    expect(result.reasonCode).toBe(Reason.RANGE_REVERSION_MID);
  });

  it('holds inside the range and never buys with a position', () => {
    const result = evaluate(flatThenLast(98, { highDelta: 1, lowDelta: 1 }), {
      position: position('100'),
    });

    expect(result.action).toBe('hold');
    expect(result.reasonCode).toBe(Reason.RANGE_REVERSION_HOLD);
    expect(result.action).not.toBe('buy');
  });

  it('uses the ATR window constant for the stop percentage', () => {
    const candles = flatThenLast(90);
    const result = evaluate(candles, { position: position('101') });

    expect(RANGE_REVERSION_ATR_PERIOD).toBeGreaterThan(0);
    expect(result.reasonCode).toBe(Reason.RANGE_REVERSION_STOP);
  });
});

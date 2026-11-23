import { describe, expect, it } from 'vitest';
import { candleCloseTime } from '../../timeframes';
import type { Candle } from '../../types';
import { makeCandlesFromCloses, makeSeries } from '../fixtures.test-helpers';
import { atrPct, closes, formatPct } from '../indicators';
import { Reason } from '../reason-codes';
import type { PortfolioPosition, Regime, TrendPullbackParams } from '../types';
import type { StrategyContext } from './index';
import { TREND_PULLBACK_ATR_PERIOD, trendPullbackStrategy } from './trend-pullback';

const PARAMS: TrendPullbackParams = {
  fastPeriod: 3,
  slowPeriod: 6,
  pullbackPct: 2,
  atrStopMult: 2.5,
  trailActivationPct: 5,
  trailPct: 5,
};

function position(avgCostUsd: string): PortfolioPosition {
  return {
    tokenId: 'token',
    strategyKey: 'trend_pullback',
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
    regime: overrides.regime ?? 'TREND_UP',
    candles,
    position: overrides.position ?? null,
    state: overrides.state ?? {},
  };
}

function evaluate(
  candles: readonly Candle[],
  overrides: Parameters<typeof context>[1] = {},
  params: TrendPullbackParams = PARAMS,
) {
  return trendPullbackStrategy.evaluate(context(candles, overrides), params);
}

/** Nineteen bars rising 3% per bar, then a 5% pullback on the last close. */
function risingThenPullback(): Candle[] {
  const values: number[] = [];
  let price = 100;
  for (let index = 0; index < 19; index += 1) {
    values.push(price);
    price *= 1.03;
  }
  values.push((values[18] as number) * 0.95);
  return makeCandlesFromCloses(values);
}

function flatThenLast(lastClose: number, count = 20): Candle[] {
  const values = Array.from({ length: count - 1 }, () => 100);
  values.push(lastClose);
  return makeCandlesFromCloses(values);
}

describe('trend pullback strategy', () => {
  it('buys a pullback inside an uptrend and sets the ATR stop', () => {
    const candles = risingThenPullback();
    const result = evaluate(candles);
    const lastClose = closes(candles)[candles.length - 1] as number;
    const expectedStop = formatPct(2.5 * (atrPct(candles, TREND_PULLBACK_ATR_PERIOD) as number));

    expect(result.action).toBe('buy');
    expect(result.reasonCode).toBe(Reason.TREND_PULLBACK_ENTRY);
    expect(result.confidence).toBe(0.6);
    expect(result.riskWeight).toBe(1);
    expect(result.stopLossPct).toBe(expectedStop);
    expect(result.takeProfitPct).toBeNull();
    expect(result.nextState).toEqual({ hwm: lastClose, trailActive: false });
    expect(result.reasonText.length).toBeGreaterThan(0);
  });

  it('does not buy outside the TREND_UP regime', () => {
    const state = { hwm: 50, trailActive: true };
    const result = evaluate(risingThenPullback(), { regime: 'RANGE', state });

    expect(result.action).toBe('hold');
    expect(result.reasonCode).toBe(Reason.STRATEGY_NOT_ELIGIBLE);
    expect(result.nextState).toEqual(state);
  });

  it('returns NO_DATA and preserves state when candles are missing', () => {
    const state = { hwm: 42, trailActive: true };
    const result = evaluate(makeSeries({ count: 4, startPrice: 100 }), { state });

    expect(result.action).toBe('hold');
    expect(result.reasonCode).toBe(Reason.STRATEGY_NO_DATA);
    expect(result.nextState).toEqual(state);
  });

  it('holds without a position and records the current close as HWM', () => {
    const candles = makeSeries({ count: 20, startPrice: 100, pattern: 'flat' });
    const result = evaluate(candles);

    expect(result.action).toBe('hold');
    expect(result.reasonCode).toBe(Reason.TREND_PULLBACK_HOLD);
    expect(result.nextState).toEqual({ hwm: 100, trailActive: false });
  });

  it('sells at the hard stop before checking the trend', () => {
    const candles = flatThenLast(94);
    const result = evaluate(candles, { position: position('100') });

    expect(result.action).toBe('sell');
    expect(result.reasonCode).toBe(Reason.TREND_PULLBACK_STOP);
    expect(result.stopLossPct).toBeNull();
    expect(result.takeProfitPct).toBeNull();
  });

  it('sells on a fast/slow trend break when the stop is not hit', () => {
    const candles = makeSeries({ count: 20, startPrice: 100, stepPct: -0.5 });
    const lastClose = closes(candles)[candles.length - 1] as number;
    const result = evaluate(candles, { position: position(formatPct(lastClose)) });

    expect(result.action).toBe('sell');
    expect(result.reasonCode).toBe(Reason.TREND_PULLBACK_TREND_BREAK);
  });

  it('sells on the trailing stop after the HWM activated it', () => {
    const candles = flatThenLast(104);
    const result = evaluate(candles, {
      position: position('100'),
      state: { hwm: 110, trailActive: true },
    });

    expect(result.action).toBe('sell');
    expect(result.reasonCode).toBe(Reason.TREND_PULLBACK_TRAIL);
    expect(result.nextState).toEqual({ hwm: 110, trailActive: true });
  });

  it('keeps HWM monotonic while holding', () => {
    const first = evaluate(flatThenLast(103), {
      position: position('100'),
      state: { hwm: 105, trailActive: false },
    });
    expect(first.action).toBe('hold');
    expect(first.reasonCode).toBe(Reason.TREND_PULLBACK_HOLD);
    expect(first.nextState).toEqual({ hwm: 105, trailActive: true });

    const second = evaluate(flatThenLast(106), {
      position: position('100'),
      state: first.nextState,
    });
    expect(second.action).toBe('hold');
    expect(second.nextState).toEqual({ hwm: 106, trailActive: true });
  });

  it('never emits buy while a position exists', () => {
    const scenarios = [
      evaluate(flatThenLast(94), { position: position('100') }),
      evaluate(makeSeries({ count: 20, startPrice: 100, stepPct: -0.5 }), {
        position: position('90.91'),
      }),
      evaluate(flatThenLast(104), {
        position: position('100'),
        state: { hwm: 110, trailActive: true },
      }),
      evaluate(flatThenLast(103), {
        position: position('100'),
        state: { hwm: 105, trailActive: false },
      }),
    ];

    for (const scenario of scenarios) {
      expect(scenario.action).not.toBe('buy');
    }
  });
});

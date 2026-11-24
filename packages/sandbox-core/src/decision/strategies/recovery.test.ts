import { describe, expect, it } from 'vitest';
import { candleCloseTime } from '../../timeframes';
import type { Candle } from '../../types';
import { makeCandlesFromCloses, makeSeries } from '../fixtures.test-helpers';
import { Reason } from '../reason-codes';
import type { PortfolioPosition, RecoveryParams, Regime } from '../types';
import type { StrategyContext } from './index';
import { recoveryStrategy } from './recovery';

const PARAMS: RecoveryParams = {
  fastPeriod: 3,
  confirmBars: 3,
  stopPct: 3,
  riskWeight: 0.5,
};

function position(avgCostUsd: string): PortfolioPosition {
  return {
    tokenId: 'token',
    strategyKey: 'recovery',
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
    regime: overrides.regime ?? 'RECOVERY',
    candles,
    position: overrides.position ?? null,
    state: overrides.state ?? {},
  };
}

function evaluate(
  candles: readonly Candle[],
  overrides: Parameters<typeof context>[1] = {},
  params: RecoveryParams = PARAMS,
) {
  return recoveryStrategy.evaluate(context(candles, overrides), params);
}

describe('recovery strategy', () => {
  it('needs three consecutive closes above the fast SMA before buying', () => {
    const first = evaluate(makeCandlesFromCloses([100, 100, 100, 101]));
    expect(first.action).toBe('hold');
    expect(first.reasonCode).toBe(Reason.RECOVERY_CONFIRMING);
    expect(first.nextState).toEqual({ aboveFastBars: 1 });

    const second = evaluate(makeCandlesFromCloses([100, 100, 100, 101, 102]), {
      state: first.nextState,
    });
    expect(second.action).toBe('hold');
    expect(second.reasonCode).toBe(Reason.RECOVERY_CONFIRMING);
    expect(second.nextState).toEqual({ aboveFastBars: 2 });

    const third = evaluate(makeCandlesFromCloses([100, 100, 100, 101, 102, 103]), {
      state: second.nextState,
    });
    expect(third.action).toBe('buy');
    expect(third.reasonCode).toBe(Reason.RECOVERY_ENTRY);
    expect(third.confidence).toBe(0.5);
    expect(third.riskWeight).toBe(0.5);
    expect(third.stopLossPct).toBe('3.00');
    expect(third.takeProfitPct).toBeNull();
    expect(third.reasonText.length).toBeGreaterThan(0);
  });

  it('resets the counter below the fast SMA', () => {
    const result = evaluate(makeCandlesFromCloses([100, 100, 100, 90]), {
      state: { aboveFastBars: 2 },
    });

    expect(result.action).toBe('hold');
    expect(result.reasonCode).toBe(Reason.RECOVERY_CONFIRMING);
    expect(result.nextState).toEqual({ aboveFastBars: 0 });
  });

  it('resets confirmation memory when the regime is not RECOVERY', () => {
    const result = evaluate(makeCandlesFromCloses([100, 100, 100, 101]), {
      regime: 'TREND_UP',
      state: { aboveFastBars: 2 },
    });

    expect(result.action).toBe('hold');
    expect(result.reasonCode).toBe(Reason.STRATEGY_NOT_ELIGIBLE);
    expect(result.nextState).toEqual({ aboveFastBars: 0 });
  });

  it('returns NO_DATA and preserves confirmation memory on a data gap', () => {
    const state = { aboveFastBars: 2 };
    const result = evaluate(makeSeries({ count: 2, startPrice: 100 }), { state });

    expect(result.action).toBe('hold');
    expect(result.reasonCode).toBe(Reason.STRATEGY_NO_DATA);
    expect(result.nextState).toEqual(state);
  });

  it('sells on a close below the fast SMA', () => {
    const result = evaluate(makeCandlesFromCloses([100, 100, 100, 90]), {
      position: position('90'),
    });

    expect(result.action).toBe('sell');
    expect(result.reasonCode).toBe(Reason.RECOVERY_TREND_BREAK);
  });

  it('sells at the hard stop first', () => {
    const result = evaluate(makeCandlesFromCloses([100, 100, 100, 92]), {
      position: position('100'),
    });

    expect(result.action).toBe('sell');
    expect(result.reasonCode).toBe(Reason.RECOVERY_STOP);
  });

  it('holds in position and never buys', () => {
    const result = evaluate(makeCandlesFromCloses([100, 100, 100, 103]), {
      position: position('101'),
    });

    expect(result.action).toBe('hold');
    expect(result.reasonCode).toBe(Reason.RECOVERY_HOLD);
    expect(result.action).not.toBe('buy');
  });
});

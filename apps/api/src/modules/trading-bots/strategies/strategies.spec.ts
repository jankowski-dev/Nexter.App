import { describe, expect, it } from 'vitest';
import { botStrategyKeySchema } from '@nexter/contracts';
import {
  bollingerReversion,
  crashProtectedGrid,
  dcaDip,
  donchianBreakout,
  failedBreakout,
  gridRange,
  meanReversion,
  momentumBreakout,
  squeezeBreakout,
  staticLimit,
  strategyDefinitions,
  strategyTemplates,
  trailingStop,
  trendPullback,
} from './index';
import type { StrategyContext, StrategySample } from './types';

function history(prices: number[]): StrategySample[] {
  return prices.map((price, index) => ({
    priceUsd: price.toFixed(8),
    capturedAt: new Date(Date.UTC(2026, 0, 1, 0, index)),
  }));
}

function context(overrides: Partial<StrategyContext>): StrategyContext {
  return {
    now: new Date(Date.UTC(2026, 0, 1, 12)),
    params: {},
    priceUsd: '1.00000000',
    change24hPct: '0.0000',
    history: history(Array.from({ length: 60 }, () => 1)),
    position: null,
    buyCount: 0,
    ...overrides,
  };
}

function risingHistory(): StrategySample[] {
  return history(Array.from({ length: 40 }, (_, index) => 1 + index * 0.02));
}

describe('trading bot strategy registry', () => {
  it('exposes twelve templates with valid default params', () => {
    expect(strategyDefinitions).toHaveLength(12);
    expect(strategyTemplates().map((template) => template.key)).toEqual([
      'momentum_breakout',
      'mean_reversion',
      'grid_range',
      'trend_pullback',
      'dca_dip',
      'trailing_stop',
      'crash_protected_grid',
      'donchian_breakout',
      'bollinger_reversion',
      'squeeze_breakout',
      'failed_breakout',
      'static_limit',
    ]);

    for (const definition of strategyDefinitions) {
      expect(definition.parseParams(definition.defaultParams)).toEqual(definition.defaultParams);
      expect(definition.guide.length).toBeGreaterThan(0);
      expect(definition.bestFor.length).toBeGreaterThan(0);
      expect(definition.risks.length).toBeGreaterThan(0);
      expect(definition.kind).toBe(definition.key === 'crash_protected_grid' ? 'custom' : 'system');
      expect(definition.paramFields.length).toBeGreaterThan(0);
      for (const field of definition.paramFields) {
        expect(definition.defaultParams).toHaveProperty(field.key);
      }
    }
  });

  it('is accepted by the shared contract', () => {
    expect(botStrategyKeySchema.parse('trailing_stop')).toBe('trailing_stop');
  });

  it('rejects invalid parameters', () => {
    expect(() => momentumBreakout.parseParams({ fastPeriod: 1, slowPeriod: 20 })).toThrow();
    expect(() => momentumBreakout.parseParams({ fastPeriod: 20, slowPeriod: 10 })).toThrow();
    expect(() => dcaDip.parseParams({ maxAdds: 0 })).toThrow();
  });
});

describe('momentum_breakout', () => {
  const params = momentumBreakout.defaultParams;

  it('buys when fast SMA is above slow SMA and 24h change is positive', () => {
    const decision = momentumBreakout.evaluate(
      context({
        params,
        history: risingHistory(),
        priceUsd: '1.78000000',
        change24hPct: '5.0000',
      }),
    );
    expect(decision).toEqual({ action: 'buy', reason: 'импульсный пробой' });
  });

  it('holds without enough history or momentum', () => {
    expect(
      momentumBreakout.evaluate(
        context({ params, history: history([1, 2, 3]), change24hPct: '10.0000' }),
      ).action,
    ).toBe('hold');
    expect(
      momentumBreakout.evaluate(
        context({ params, history: risingHistory(), change24hPct: '0.0000' }),
      ).action,
    ).toBe('hold');
  });

  it('sells on take profit or stop loss', () => {
    const position = { amount: '10', avgCostUsd: '1.00000000', costBasisUsd: '10.00000000' };
    expect(
      momentumBreakout.evaluate(
        context({ params, history: risingHistory(), priceUsd: '1.10000000', position }),
      ).reason,
    ).toBe('тейк-профит');
    expect(
      momentumBreakout.evaluate(
        context({ params, history: risingHistory(), priceUsd: '0.90000000', position }),
      ).reason,
    ).toBe('стоп-лосс');
  });
});

describe('mean_reversion', () => {
  const params = meanReversion.defaultParams;

  it('buys below the mean and sells on reversion', () => {
    const flat = history(Array.from({ length: 40 }, () => 1));
    expect(
      meanReversion.evaluate(context({ params, history: flat, priceUsd: '0.90000000' })).action,
    ).toBe('buy');

    const position = { amount: '10', avgCostUsd: '0.90000000', costBasisUsd: '9.00000000' };
    const decision = meanReversion.evaluate(
      context({ params, history: flat, priceUsd: '1.01000000', position }),
    );
    expect(decision).toEqual({ action: 'sell', reason: 'возврат к среднему' });
  });

  it('holds when price is near the mean', () => {
    const flat = history(Array.from({ length: 40 }, () => 1));
    expect(meanReversion.evaluate(context({ params, history: flat })).action).toBe('hold');
  });
});

describe('grid_range', () => {
  const params = gridRange.defaultParams;

  it('buys the first grid level and further adds inside the grid', () => {
    const flat = history(Array.from({ length: 70 }, () => 1));
    expect(
      gridRange.evaluate(context({ params, history: flat, priceUsd: '0.98000000' })).action,
    ).toBe('buy');

    const position = { amount: '10', avgCostUsd: '1.00000000', costBasisUsd: '10.00000000' };
    const add = gridRange.evaluate(
      context({ params, history: flat, priceUsd: '0.98000000', position, buyCount: 0 }),
    );
    expect(add).toEqual({ action: 'buy', reason: 'следующая ступень сетки' });

    const done = gridRange.evaluate(
      context({
        params: { ...params, maxAdds: 1 },
        history: flat,
        priceUsd: '0.98000000',
        position,
        buyCount: 1,
      }),
    );
    expect(done.action).toBe('hold');
  });

  it('sells one grid step above average cost', () => {
    const flat = history(Array.from({ length: 70 }, () => 1));
    const position = { amount: '10', avgCostUsd: '1.00000000', costBasisUsd: '10.00000000' };
    expect(
      gridRange.evaluate(context({ params, history: flat, priceUsd: '1.02000000', position })),
    ).toEqual({ action: 'sell', reason: 'шаг сетки вверх' });
  });
});

describe('trend_pullback', () => {
  const params = trendPullback.defaultParams;

  it('buys a pullback to the fast SMA inside an uptrend', () => {
    const prices = [
      ...Array.from({ length: 22 }, (_, index) => 1 + index * 0.05),
      ...Array.from({ length: 8 }, (_, index) => 2.1 - index * 0.04),
    ];
    const samples = history(prices);
    const decision = trendPullback.evaluate(
      context({
        params,
        history: samples,
        priceUsd: prices[prices.length - 1]?.toFixed(8) ?? '1',
      }),
    );
    expect(decision).toEqual({ action: 'buy', reason: 'откат к быстрой SMA' });
  });

  it('holds when there is no uptrend', () => {
    const samples = history(Array.from({ length: 50 }, (_, index) => 2 - index * 0.01));
    expect(
      trendPullback.evaluate(
        context({
          params,
          history: samples,
          priceUsd: samples[samples.length - 1]?.priceUsd ?? '1',
        }),
      ).action,
    ).toBe('hold');
  });

  it('still exits on trend break when stop-loss is disabled', () => {
    const samples = history(Array.from({ length: 50 }, (_, index) => 2 - index * 0.01));
    const position = { amount: '10', avgCostUsd: '1.20000000', costBasisUsd: '12.00000000' };
    expect(
      trendPullback.evaluate(
        context({
          params,
          history: samples,
          priceUsd: '1.00000000',
          position,
          stopLossEnabled: false,
        }),
      ),
    ).toEqual({ action: 'sell', reason: 'тренд сломан' });

    expect(
      trendPullback.evaluate(
        context({ params, history: samples, priceUsd: '1.00000000', position }),
      ).reason,
    ).toBe('стоп-лосс');
  });
});

describe('dca_dip', () => {
  const params = dcaDip.defaultParams;

  it('buys a dip from the rolling high and adds on further dips', () => {
    const flat = history(Array.from({ length: 70 }, () => 1));
    expect(dcaDip.evaluate(context({ params, history: flat, priceUsd: '0.90000000' })).action).toBe(
      'buy',
    );

    const position = { amount: '10', avgCostUsd: '0.95000000', costBasisUsd: '9.50000000' };
    expect(
      dcaDip.evaluate(
        context({ params, history: flat, priceUsd: '0.90000000', position, buyCount: 0 }),
      ),
    ).toEqual({ action: 'buy', reason: 'докупка на просадке' });
  });

  it('stops adding after maxAdds and takes profit', () => {
    const flat = history(Array.from({ length: 70 }, () => 1));
    const position = { amount: '10', avgCostUsd: '0.95000000', costBasisUsd: '9.50000000' };
    expect(
      dcaDip.evaluate(
        context({ params, history: flat, priceUsd: '0.90000000', position, buyCount: 3 }),
      ).action,
    ).toBe('hold');
    expect(
      dcaDip.evaluate(
        context({ params, history: flat, priceUsd: '1.06000000', position, buyCount: 0 }),
      ).reason,
    ).toBe('тейк-профит');
  });
});

describe('crash_protected_grid', () => {
  const params = crashProtectedGrid.defaultParams;
  const position = { amount: '1000', avgCostUsd: '0.98000000', costBasisUsd: '980.00000000' };

  it('closes a low-loss grid position when the crash trigger is crossed', () => {
    const first = crashProtectedGrid.evaluate(
      context({ params, priceUsd: '1.00000000', history: history([1]) }),
    );
    expect(first.nextState).toMatchObject({ highWaterMark: '1', mode: 'normal', adds: 0 });

    const entry = crashProtectedGrid.evaluate(
      context({
        params,
        priceUsd: '0.98000000',
        history: history([1, 0.98]),
        state: first.nextState,
      }),
    );
    expect(entry.action).toBe('buy');

    const crash = crashProtectedGrid.evaluate(
      context({
        params,
        priceUsd: '0.90000000',
        history: history([1, 0.98, 0.9]),
        position,
        state: { highWaterMark: '1', mode: 'normal', adds: 1 },
      }),
    );
    expect(crash).toMatchObject({ action: 'sell', reason: 'защитное закрытие на обвале' });
    expect(crash.nextState).toMatchObject({ mode: 'crash', adds: 0 });
  });

  it('keeps a deep loss open and resumes the grid after a 30% drop', () => {
    const crash = crashProtectedGrid.evaluate(
      context({
        params,
        priceUsd: '0.85000000',
        history: history([1, 0.85]),
        position: { amount: '1000', avgCostUsd: '1.00000000', costBasisUsd: '1000.00000000' },
        state: { highWaterMark: '1', mode: 'normal', adds: 1 },
      }),
    );
    expect(crash).toMatchObject({ action: 'hold', reason: 'обвал: покупки приостановлены' });
    expect(crash.nextState).toMatchObject({ mode: 'crash' });

    const resumed = crashProtectedGrid.evaluate(
      context({
        params,
        priceUsd: '0.70000000',
        history: history([1, 0.7]),
        position: { amount: '1000', avgCostUsd: '1.00000000', costBasisUsd: '1000.00000000' },
        state: { highWaterMark: '1', mode: 'crash', adds: 1 },
      }),
    );
    expect(resumed).toMatchObject({ action: 'buy', reason: 'возобновление сетки после обвала' });
    expect(resumed.nextState).toMatchObject({ highWaterMark: '0.7', mode: 'normal', adds: 1 });
  });
});

describe('trailing_stop', () => {
  const params = trailingStop.defaultParams;

  it('buys a breakout above the prior range and resets the peak when flat', () => {
    const prices = Array.from({ length: 25 }, () => 100);
    const breakout = trailingStop.evaluate(
      context({ params, priceUsd: '102.00000000', history: history([...prices, 102]) }),
    );
    expect(breakout).toMatchObject({ action: 'buy', reason: 'пробой диапазона' });
    expect(breakout.nextState).toMatchObject({ peak: '102' });

    const flat = trailingStop.evaluate(
      context({ params, priceUsd: '99.00000000', history: history([...prices, 99]) }),
    );
    expect(flat).toMatchObject({ action: 'hold', reason: 'нет пробоя' });
    expect(flat.nextState).toMatchObject({ peak: '99' });
  });

  it('holds before trailing activation and then sells on the trailing stop', () => {
    const position = { amount: '10', avgCostUsd: '100.00000000', costBasisUsd: '1000.00000000' };

    const beforeActivation = trailingStop.evaluate(
      context({
        params,
        priceUsd: '101.00000000',
        history: history([100, 101]),
        position,
        state: { peak: '101' },
      }),
    );
    expect(beforeActivation).toMatchObject({
      action: 'hold',
      reason: 'ожидание активации трейлинга',
    });

    const afterActivation = trailingStop.evaluate(
      context({
        params,
        priceUsd: '108.50000000',
        history: history([100, 110, 108.5]),
        position,
        state: { peak: '110' },
      }),
    );
    expect(afterActivation).toMatchObject({ action: 'hold', reason: 'трейлинг активен' });

    const trailExit = trailingStop.evaluate(
      context({
        params,
        priceUsd: '108.20000000',
        history: history([100, 110, 108.2]),
        position,
        state: { peak: '110' },
      }),
    );
    expect(trailExit).toMatchObject({ action: 'sell', reason: 'трейлинг-стоп' });
  });

  it('sells on the hard stop before activation', () => {
    const hardStop = trailingStop.evaluate(
      context({
        params,
        priceUsd: '94.90000000',
        history: history([100, 94.9]),
        position: { amount: '10', avgCostUsd: '100.00000000', costBasisUsd: '1000.00000000' },
        state: { peak: '100' },
      }),
    );
    expect(hardStop).toMatchObject({ action: 'sell', reason: 'жёсткий стоп' });
  });
});

describe('donchian_breakout', () => {
  const params = donchianBreakout.defaultParams;

  it('buys a break above the previous channel high', () => {
    const prices = [...Array.from({ length: 20 }, () => 1), 1.01];
    expect(
      donchianBreakout.evaluate(
        context({ params, history: history(prices), priceUsd: '1.01000000' }),
      ),
    ).toEqual({ action: 'buy', reason: 'пробой верхнего канала' });
  });

  it('holds inside the channel and without enough history', () => {
    const inside = [...Array.from({ length: 20 }, () => 1), 1.001];
    expect(
      donchianBreakout.evaluate(
        context({ params, history: history(inside), priceUsd: '1.00100000' }),
      ).action,
    ).toBe('hold');
    expect(
      donchianBreakout.evaluate(
        context({ params, history: history([1, 2, 3]), priceUsd: '3.00000000' }),
      ).action,
    ).toBe('hold');
  });

  it('exits on take-profit, stop-loss and the opposite channel', () => {
    const position = { amount: '10', avgCostUsd: '1.00000000', costBasisUsd: '10.00000000' };
    expect(
      donchianBreakout.evaluate(
        context({ params, history: risingHistory(), priceUsd: '1.11000000', position }),
      ).reason,
    ).toBe('тейк-профит');
    expect(
      donchianBreakout.evaluate(
        context({ params, history: risingHistory(), priceUsd: '0.94000000', position }),
      ).reason,
    ).toBe('стоп-лосс');

    const lower = [
      ...Array.from({ length: 20 }, () => 1.1),
      ...Array.from({ length: 9 }, () => 1.05),
      1,
    ];
    expect(
      donchianBreakout.evaluate(
        context({
          params,
          history: history(lower),
          priceUsd: '1.00000000',
          position: { amount: '10', avgCostUsd: '1.05000000', costBasisUsd: '10.50000000' },
        }),
      ).reason,
    ).toBe('пробой нижнего канала');
  });
});

describe('bollinger_reversion', () => {
  const params = bollingerReversion.defaultParams;

  it('buys below the lower band and exits at the mean', () => {
    const prices = [...Array.from({ length: 39 }, () => 1), 0.9];
    expect(
      bollingerReversion.evaluate(
        context({ params, history: history(prices), priceUsd: '0.90000000' }),
      ).action,
    ).toBe('buy');

    const position = { amount: '10', avgCostUsd: '1.00000000', costBasisUsd: '10.00000000' };
    const exit = bollingerReversion.evaluate(
      context({
        params,
        history: history([...Array.from({ length: 39 }, () => 1), 1.01]),
        priceUsd: '1.01000000',
        position,
      }),
    );
    expect(exit.reason).toBe('возврат к средней');
  });

  it('holds near the mean and with insufficient history', () => {
    expect(
      bollingerReversion.evaluate(
        context({
          params,
          history: history(Array.from({ length: 40 }, () => 1)),
          priceUsd: '1.00000000',
        }),
      ).action,
    ).toBe('hold');
    expect(
      bollingerReversion.evaluate(
        context({ params, history: history([1, 1, 1]), priceUsd: '0.90000000' }),
      ).action,
    ).toBe('hold');
  });

  it('exits on take-profit and stop-loss', () => {
    const position = { amount: '10', avgCostUsd: '1.00000000', costBasisUsd: '10.00000000' };
    expect(
      bollingerReversion.evaluate(
        context({ params, history: risingHistory(), priceUsd: '1.09000000', position }),
      ).reason,
    ).toBe('тейк-профит');
    expect(
      bollingerReversion.evaluate(
        context({ params, history: risingHistory(), priceUsd: '0.94000000', position }),
      ).reason,
    ).toBe('стоп-лосс');
  });

  it('honours disabled protective exits', () => {
    const position = { amount: '10', avgCostUsd: '1.00000000', costBasisUsd: '10.00000000' };
    expect(
      bollingerReversion.evaluate(
        context({
          params,
          history: history(Array.from({ length: 40 }, () => 1)),
          priceUsd: '0.90000000',
          position,
          stopLossEnabled: false,
          takeProfitEnabled: false,
        }),
      ).action,
    ).toBe('hold');
  });
});

describe('squeeze_breakout', () => {
  const params = squeezeBreakout.defaultParams;

  it('buys a breakout after a volatility squeeze', () => {
    const quiet = [...Array.from({ length: 20 }, (_, index) => 1 + (index % 2) * 0.0001), 1.01];
    expect(
      squeezeBreakout.evaluate(
        context({ params, history: history(quiet), priceUsd: '1.01000000' }),
      ),
    ).toEqual({ action: 'buy', reason: 'выход из сжатия' });
  });

  it('holds outside a squeeze and when there is no breakout', () => {
    const wide = [...Array.from({ length: 20 }, (_, index) => (index % 2 === 0 ? 1 : 1.1)), 1.2];
    expect(
      squeezeBreakout.evaluate(context({ params, history: history(wide), priceUsd: '1.20000000' }))
        .action,
    ).toBe('hold');

    const quietNoBreakout = [...Array.from({ length: 20 }, () => 1), 1];
    expect(
      squeezeBreakout.evaluate(
        context({ params, history: history(quietNoBreakout), priceUsd: '1.00000000' }),
      ).action,
    ).toBe('hold');
  });

  it('exits on take-profit and stop-loss', () => {
    const position = { amount: '10', avgCostUsd: '1.00000000', costBasisUsd: '10.00000000' };
    expect(
      squeezeBreakout.evaluate(
        context({ params, history: risingHistory(), priceUsd: '1.13000000', position }),
      ).reason,
    ).toBe('тейк-профит');
    expect(
      squeezeBreakout.evaluate(
        context({ params, history: risingHistory(), priceUsd: '0.94000000', position }),
      ).reason,
    ).toBe('стоп-лосс');
  });
});

describe('failed_breakout', () => {
  const params = failedBreakout.defaultParams;

  it('remembers a breakdown and buys the reclaim', () => {
    const breakdown = [...Array.from({ length: 20 }, () => 1), 0.99];
    const decision = failedBreakout.evaluate(
      context({ params, history: history(breakdown), priceUsd: '0.99000000' }),
    );
    expect(decision).toMatchObject({ action: 'hold', reason: 'пробой поддержки' });
    expect(decision.nextState?.breakdownLevel).toBe('1');

    const reclaim = failedBreakout.evaluate(
      context({
        params,
        history: history([...Array.from({ length: 20 }, () => 1), 1.005]),
        priceUsd: '1.00500000',
        state: { breakdownLevel: '1' },
      }),
    );
    expect(reclaim).toMatchObject({ action: 'buy', reason: 'возврат после ложного пробоя' });
    expect(reclaim.nextState?.breakdownLevel).toBeNull();
  });

  it('holds with insufficient history and without a breakdown', () => {
    expect(
      failedBreakout.evaluate(
        context({ params, history: history([1, 2, 3]), priceUsd: '3.00000000' }),
      ).action,
    ).toBe('hold');
    expect(
      failedBreakout.evaluate(
        context({
          params,
          history: history(Array.from({ length: 30 }, () => 1)),
          priceUsd: '1.00000000',
        }),
      ).action,
    ).toBe('hold');
  });

  it('exits on take-profit/stop-loss and clears the breakdown state', () => {
    const position = { amount: '10', avgCostUsd: '1.00000000', costBasisUsd: '10.00000000' };
    const takeProfit = failedBreakout.evaluate(
      context({
        params,
        history: risingHistory(),
        priceUsd: '1.09000000',
        position,
        state: { breakdownLevel: '1' },
      }),
    );
    expect(takeProfit.reason).toBe('тейк-профит');
    expect(takeProfit.nextState?.breakdownLevel).toBeNull();

    expect(
      failedBreakout.evaluate(
        context({
          params,
          history: risingHistory(),
          priceUsd: '0.95000000',
          position,
          state: { breakdownLevel: '1' },
        }),
      ).reason,
    ).toBe('стоп-лосс');
  });
});

describe('static_limit', () => {
  const params = {
    buyPriceUsd: 1,
    stopPriceUsd: 0.9,
    takeProfitPriceUsd: 1.2,
  };

  it('holds until configured and buys at or below the limit', () => {
    expect(
      staticLimit.evaluate(
        context({
          params: staticLimit.defaultParams,
          history: risingHistory(),
          priceUsd: '1.00000000',
        }),
      ).reason,
    ).toBe('задайте цену покупки, стоп и тейк');
    expect(
      staticLimit.evaluate(context({ params, history: risingHistory(), priceUsd: '1.01000000' }))
        .action,
    ).toBe('hold');
    expect(
      staticLimit.evaluate(context({ params, history: risingHistory(), priceUsd: '0.99000000' })),
    ).toEqual({ action: 'buy', reason: 'лимитная покупка', nextState: { phase: 'armed' } });
  });

  it('exits on stop and take with a waiting phase', () => {
    const position = { amount: '10', avgCostUsd: '1.00000000', costBasisUsd: '10.00000000' };
    expect(
      staticLimit.evaluate(
        context({ params, history: risingHistory(), priceUsd: '0.89000000', position }),
      ),
    ).toEqual({ action: 'sell', reason: 'стоп-лосс', nextState: { phase: 'waiting' } });
    expect(
      staticLimit.evaluate(
        context({ params, history: risingHistory(), priceUsd: '1.21000000', position }),
      ),
    ).toEqual({ action: 'sell', reason: 'тейк-профит', nextState: { phase: 'waiting' } });
  });

  it('waits for recovery above the limit before re-arming', () => {
    expect(
      staticLimit.evaluate(
        context({
          params,
          history: risingHistory(),
          priceUsd: '0.95000000',
          state: { phase: 'waiting' },
        }),
      ),
    ).toEqual({
      action: 'hold',
      reason: 'ожидание восстановления выше лимита',
      nextState: { phase: 'waiting' },
    });
    expect(
      staticLimit.evaluate(
        context({
          params,
          history: risingHistory(),
          priceUsd: '1.01000000',
          state: { phase: 'waiting' },
        }),
      ),
    ).toEqual({
      action: 'hold',
      reason: 'цена вернулась к лимиту',
      nextState: { phase: 'armed' },
    });
  });

  it('re-enters after re-arming and honours disabled protective exits', () => {
    expect(
      staticLimit.evaluate(
        context({
          params,
          history: risingHistory(),
          priceUsd: '1.00000000',
          state: { phase: 'armed' },
        }),
      ).action,
    ).toBe('buy');

    const position = { amount: '10', avgCostUsd: '1.00000000', costBasisUsd: '10.00000000' };
    expect(
      staticLimit.evaluate(
        context({
          params,
          history: risingHistory(),
          priceUsd: '0.89000000',
          position,
          stopLossEnabled: false,
          takeProfitEnabled: false,
        }),
      ).action,
    ).toBe('hold');
  });
});

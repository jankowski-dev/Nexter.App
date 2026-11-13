import { describe, expect, it } from 'vitest';
import type { BotCandle } from '@nexter/contracts';
import { runBacktest } from './backtest.engine';
import { meanReversion } from '../strategies';

function candle(date: string, close: number): BotCandle {
  const value = close.toFixed(8);
  return {
    date,
    openUsd: value,
    highUsd: value,
    lowUsd: value,
    closeUsd: value,
    volumeUsd: '100000.00',
  };
}

function series(prices: number[]): BotCandle[] {
  return prices.map((price, index) =>
    candle(`2026-01-${String(index + 1).padStart(2, '0')}`, price),
  );
}

describe('runBacktest', () => {
  it('runs mean reversion buy and sell cycles on daily candles', () => {
    const params = meanReversion.parseParams({
      lookback: 3,
      entryDropPct: 2,
      exitAbovePct: 0,
      takeProfitPct: 50,
      stopLossPct: 50,
    });
    const result = runBacktest(
      meanReversion,
      params,
      series([100, 100, 100, 97, 100, 100, 96, 100]),
      { feeBps: 0, slippageBps: 0 },
    );

    expect(result.trades.map((trade) => trade.side)).toEqual(['buy', 'sell', 'buy', 'sell']);
    expect(result.stats.tradesCount).toBe(4);
    expect(result.stats.wins).toBe(2);
    expect(result.stats.losses).toBe(0);
    expect(Number(result.stats.totalPnlUsd)).toBeGreaterThan(0);
    expect(result.stats.profitFactor).toBeNull();
    expect(result.equityCurve).toHaveLength(8);
  });

  it('forces the last open position closed and reports drawdown', () => {
    const params = meanReversion.parseParams({
      lookback: 3,
      entryDropPct: 2,
      exitAbovePct: 0,
      takeProfitPct: 50,
      stopLossPct: 50,
    });
    const result = runBacktest(meanReversion, params, series([100, 100, 100, 97, 90]), {
      feeBps: 0,
      slippageBps: 0,
    });

    expect(result.trades.map((trade) => trade.side)).toEqual(['buy', 'sell']);
    expect(result.trades[result.trades.length - 1]?.reason).toBe('закрытие в конце периода');
    expect(Number(result.stats.maxDrawdownPct)).toBeGreaterThan(0);
    expect(result.stats.buyHoldReturnPct).toBe('-10.00');
  });

  it('reports buy-and-hold comparison and keeps money precise', () => {
    const params = meanReversion.parseParams({
      lookback: 3,
      entryDropPct: 50,
      exitAbovePct: 50,
      takeProfitPct: 50,
      stopLossPct: 50,
    });
    const result = runBacktest(meanReversion, params, series([100, 110, 120]), {
      feeBps: 0,
      slippageBps: 0,
    });

    expect(result.trades).toHaveLength(0);
    expect(result.stats.finalEquityUsd).toBe('1000.00000000');
    expect(result.stats.totalReturnPct).toBe('0.00');
    expect(result.stats.buyHoldReturnPct).toBe('20.00');
  });
});

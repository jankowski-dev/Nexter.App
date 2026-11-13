import { describe, expect, it } from 'vitest';
import type { BotCandle } from '@nexter/contracts';
import { runBacktest } from './backtest.engine';
import { crashProtectedGrid, meanReversion } from '../strategies';

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

function bar(date: string, open: number, high: number, low: number, close: number): BotCandle {
  return {
    date,
    openUsd: open.toFixed(8),
    highUsd: high.toFixed(8),
    lowUsd: low.toFixed(8),
    closeUsd: close.toFixed(8),
    volumeUsd: '100000.00',
  };
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

  it('executes an intrabar stop at the configured threshold, not at the daily close', () => {
    const params = meanReversion.parseParams({
      lookback: 3,
      entryDropPct: 2,
      exitAbovePct: 50,
      takeProfitPct: 50,
      stopLossPct: 3,
    });
    const entry = series([100, 100, 100, 97]);
    const stopBar = bar('2026-01-05', 97, 98, 90, 92);
    const result = runBacktest(meanReversion, params, [...entry, stopBar]);

    const stop = result.trades.find((trade) => trade.side === 'sell');
    expect(stop?.reason).toBe('стоп-лосс (внутри дня)');
    expect(Number(stop?.priceUsd)).toBeGreaterThan(92);
    expect(Number(stop?.realizedPnlUsd)).toBeGreaterThan(-45);
    expect(Number(stop?.realizedPnlUsd)).toBeLessThan(-20);
  });

  it('fills a gap-down stop at the open price', () => {
    const params = meanReversion.parseParams({
      lookback: 3,
      entryDropPct: 2,
      exitAbovePct: 50,
      takeProfitPct: 50,
      stopLossPct: 3,
    });
    const entry = series([100, 100, 100, 97]);
    const gapBar = bar('2026-01-05', 90, 91, 88, 89);
    const result = runBacktest(meanReversion, params, [...entry, gapBar]);

    const stop = result.trades.find((trade) => trade.side === 'sell');
    expect(stop?.reason).toBe('стоп-лосс (гэп)');
    expect(Number(stop?.priceUsd)).toBeCloseTo(90 * 0.999, 6);
  });

  it('can disable the stop-loss and take-profit exits', () => {
    const params = meanReversion.parseParams({
      lookback: 3,
      entryDropPct: 2,
      exitAbovePct: 50,
      takeProfitPct: 5,
      stopLossPct: 3,
    });
    const entry = series([100, 100, 100, 97]);
    const stopBar = bar('2026-01-05', 97, 98, 90, 92);
    const noStop = runBacktest(meanReversion, params, [...entry, stopBar], {
      useStopLoss: false,
    });
    expect(noStop.trades.some((trade) => trade.reason.includes('стоп-лосс'))).toBe(false);
    expect(noStop.trades[noStop.trades.length - 1]?.reason).toBe('закрытие в конце периода');

    const profitBar = bar('2026-01-05', 97, 110, 97, 102);
    const noTakeProfit = runBacktest(meanReversion, params, [...entry, profitBar], {
      useTakeProfit: false,
    });
    expect(noTakeProfit.trades.some((trade) => trade.reason.includes('тейк-профит'))).toBe(false);
  });

  it('compounds the next position when reinvestment is enabled', () => {
    const params = meanReversion.parseParams({
      lookback: 3,
      entryDropPct: 2,
      exitAbovePct: 0,
      takeProfitPct: 50,
      stopLossPct: 50,
    });
    const candles = series([100, 100, 100, 97, 100, 100, 97, 100]);
    const withoutReinvest = runBacktest(meanReversion, params, candles, {
      feeBps: 0,
      slippageBps: 0,
      reinvestProfit: false,
    });
    const withReinvest = runBacktest(meanReversion, params, candles, {
      feeBps: 0,
      slippageBps: 0,
      reinvestProfit: true,
    });

    expect(Number(withReinvest.stats.finalEquityUsd)).toBeGreaterThan(
      Number(withoutReinvest.stats.finalEquityUsd),
    );
  });

  it('executes an intrabar take-profit at the configured threshold', () => {
    const params = meanReversion.parseParams({
      lookback: 3,
      entryDropPct: 2,
      exitAbovePct: 50,
      takeProfitPct: 5,
      stopLossPct: 50,
    });
    const entry = series([100, 100, 100, 97]);
    const profitBar = bar('2026-01-05', 97, 110, 97, 102);
    const result = runBacktest(meanReversion, params, [...entry, profitBar]);

    const takeProfit = result.trades.find((trade) => trade.side === 'sell');
    expect(takeProfit?.reason).toBe('тейк-профит (внутри дня)');
    expect(Number(takeProfit?.priceUsd)).toBeGreaterThan(102);
  });
  it('runs a stateful crash-protected grid through pause, resume and take-profit', () => {
    const params = crashProtectedGrid.parseParams({
      gridStepPct: 1.5,
      maxAdds: 4,
      takeProfitPct: 2.5,
      crashTriggerPct: 10,
      resumeDropPct: 30,
      closeLossThresholdPct: 10,
    });
    const candles = [
      candle('2026-01-01', 1),
      candle('2026-01-02', 1),
      candle('2026-01-03', 0.98),
      candle('2026-01-04', 0.9),
      candle('2026-01-05', 0.8),
      candle('2026-01-06', 0.7),
      candle('2026-01-07', 0.72),
    ];
    const result = runBacktest(crashProtectedGrid, params, candles, {
      feeBps: 0,
      slippageBps: 0,
    });

    expect(result.trades.map((trade) => `${trade.side}:${trade.reason}`)).toEqual([
      'buy:первая ступень защитной сетки',
      'sell:защитное закрытие на обвале',
      'buy:возобновление сетки после обвала',
      'sell:тейк-профит (гэп)',
    ]);
  });
});

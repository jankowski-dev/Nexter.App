import { describe, expect, it } from 'vitest';
import { renderChartPages } from './chart-svg';
import type { BarDiagnostic } from './types';

function rows(count: number, flat = false): BarDiagnostic[] {
  return Array.from({ length: count }, (_, index) => {
    const close = flat ? 100 : 100 + Math.sin(index / 8) * 10;
    const time = new Date(Date.UTC(2026, 0, 1, index)).toISOString();
    return {
      barIndex: index,
      tokenId: 'tok',
      timeframe: '1h',
      openTime: new Date(Date.parse(time) - 3_600_000).toISOString(),
      closeTime: time,
      open: String(close + (index % 2 === 0 ? -0.5 : 0.5)),
      high: String(close + 1),
      low: String(close - 1),
      close: String(close),
      volumeUsd: String(100 + index),
      regime: index < 200 ? 'TREND_UP' : 'RANGE',
      regimeReason: null,
      fastSma: String(close),
      slowSma: String(close),
      longSma: String(close),
      atrPct: '1.0',
      recentHigh: String(close + 2),
      recentLow: String(close - 2),
      drawdownPct: '0.0',
      avgVolumeUsd: '1000',
      staleBars: 0,
      strategyKey: 'trend_pullback',
      signalAction: 'hold',
      signalReason: null,
      confidence: '0.5',
      riskWeight: '1',
      riskDecision: null,
      riskReason: null,
      riskChecks: null,
      intentSide: null,
      intentStatus: null,
      intentReason: null,
      fillSide: null,
      fillPrice: null,
      fillStatus: null,
      positionAmount: null,
      equityUsd: '1000.00',
      cashUsd: '1000.00',
      equityDrawdownPct: '0.00',
    };
  });
}

describe('renderChartPages', () => {
  it('splits rows into pages of the requested size', () => {
    expect(renderChartPages({ rows: rows(360), markers: [] })).toHaveLength(1);
    expect(renderChartPages({ rows: rows(361), markers: [] })).toHaveLength(2);
  });

  it('renders candles, regimes, indicators and markers', () => {
    const pages = renderChartPages({
      rows: rows(400),
      markers: [
        { time: rows(400)[10]!.closeTime, side: 'buy', price: '100', label: 'BUY' },
        { time: rows(400)[370]!.closeTime, side: 'sell', price: '100', label: 'SELL' },
      ],
    });

    expect(pages[0]).toContain('<svg');
    expect(pages[0]).toContain('#16a34a');
    expect(pages[0]).toContain('#dc2626');
    expect(pages[0]).toContain('TREND_UP');
    expect(pages[0]).toContain('RSI');
    expect(pages[0]).toContain('BUY');
    expect(pages[1]).toContain('SELL');
  });

  it('does not produce NaN for a flat series', () => {
    const page = renderChartPages({ rows: rows(30, true), markers: [] })[0];
    expect(page).not.toContain('NaN');
  });
});

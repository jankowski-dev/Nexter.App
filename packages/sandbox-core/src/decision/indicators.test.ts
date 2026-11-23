import { describe, expect, it } from 'vitest';
import { sortAndValidateCandles } from '../data/candles';
import type { Candle } from '../types';
import { makeCandlesFromCloses, makeSeries } from './fixtures.test-helpers';
import {
  atrPct,
  averageVolumeUsd,
  closes,
  drawdownPct,
  formatPct,
  formatUsd,
  highestHigh,
  lowestLow,
  numeric,
  sma,
  smaSeries,
} from './indicators';

interface CandleInput {
  open: number;
  high: number;
  low: number;
  close: number;
  volumeUsd?: number;
}

function candle(index: number, input: CandleInput): Candle {
  return {
    tokenId: 'tok',
    timeframe: '1h',
    openTime: Date.UTC(2026, 0, 1) + index * 3_600_000,
    open: String(input.open),
    high: String(input.high),
    low: String(input.low),
    close: String(input.close),
    volumeUsd: String(input.volumeUsd ?? 1_000),
  };
}

describe('closes', () => {
  it('reads close prices as native numbers in order', () => {
    const candles = [1, 2, 3, 4].map((value, index) =>
      candle(index, { open: value, high: value, low: value, close: value }),
    );
    expect(closes(candles)).toEqual([1, 2, 3, 4]);
  });

  it('returns an empty array for no candles', () => {
    expect(closes([])).toEqual([]);
  });
});

describe('sma', () => {
  it('averages the last period values', () => {
    expect(sma([1, 2, 3, 4], 2)).toBe(3.5);
    expect(sma([1, 2, 3, 4], 4)).toBe(2.5);
  });

  it('returns null when history is too short or the period is invalid', () => {
    expect(sma([1, 2], 3)).toBeNull();
    expect(sma([1, 2, 3], 0)).toBeNull();
    expect(sma([1, 2, 3], -1)).toBeNull();
    expect(sma([1, 2, 3], 1.5)).toBeNull();
  });
});

describe('smaSeries', () => {
  it('is index aligned and null before the first full window', () => {
    expect(smaSeries([1, 2, 3, 4], 2)).toEqual([null, 1.5, 2.5, 3.5]);
    expect(smaSeries([1, 2, 3, 4], 4)).toEqual([null, null, null, 2.5]);
  });

  it('returns all nulls for an invalid period', () => {
    expect(smaSeries([1, 2, 3], 0)).toEqual([null, null, null]);
  });
});

describe('atrPct', () => {
  it('averages true range over the last period candles and divides by last close', () => {
    const candles = [
      candle(0, { open: 10, high: 11, low: 9, close: 10 }),
      candle(1, { open: 10, high: 12, low: 10, close: 11 }),
      candle(2, { open: 11, high: 11, low: 9.5, close: 10 }),
    ];
    // TR(2) = max(2, |12-10|, |10-10|) = 2; TR(3) = max(1.5, |11-11|, |9.5-11|) = 1.5
    // ATR = 1.75; last close = 10 -> 17.5%.
    expect(atrPct(candles, 2)).toBeCloseTo(17.5, 10);
  });

  it('returns null when there are fewer than period + 1 candles', () => {
    const candles = [candle(0, { open: 1, high: 1, low: 1, close: 1 })];
    expect(atrPct(candles, 1)).toBeNull();
    expect(atrPct([], 1)).toBeNull();
  });

  it('returns null for a non-positive last close', () => {
    const candles = [
      candle(0, { open: 1, high: 1, low: 1, close: 1 }),
      candle(1, { open: 1, high: 1, low: 1, close: 0 }),
    ];
    expect(atrPct(candles, 1)).toBeNull();
  });
});

describe('highestHigh / lowestLow', () => {
  const candles = [
    candle(0, { open: 10, high: 11, low: 9, close: 10 }),
    candle(1, { open: 10, high: 12, low: 10, close: 11 }),
    candle(2, { open: 11, high: 11, low: 9.5, close: 10 }),
  ];

  it('looks only at the last period candles', () => {
    expect(highestHigh(candles, 2)).toBe(12);
    expect(lowestLow(candles, 2)).toBe(9.5);
    expect(highestHigh(candles, 3)).toBe(12);
    expect(lowestLow(candles, 3)).toBe(9);
  });

  it('returns null for an empty window', () => {
    expect(highestHigh([], 2)).toBeNull();
    expect(lowestLow([], 2)).toBeNull();
    expect(highestHigh(candles, 0)).toBeNull();
  });
});

describe('averageVolumeUsd', () => {
  it('averages the last period volumes', () => {
    const candles = [10, 20, 30].map((volumeUsd, index) =>
      candle(index, { open: 1, high: 1, low: 1, close: 1, volumeUsd }),
    );
    expect(averageVolumeUsd(candles, 2)).toBe(25);
    expect(averageVolumeUsd(candles, 3)).toBe(20);
    expect(averageVolumeUsd(candles, 4)).toBeNull();
  });
});

describe('drawdownPct', () => {
  it('measures the fall from the window high to the last close', () => {
    const candles = [
      candle(0, { open: 80, high: 100, low: 80, close: 80 }),
      candle(1, { open: 80, high: 90, low: 80, close: 80 }),
    ];
    expect(drawdownPct(candles, 2)).toBeCloseTo(20, 10);
  });

  it('is never negative when the last close is the window high', () => {
    const candles = [
      candle(0, { open: 80, high: 100, low: 80, close: 80 }),
      candle(1, { open: 100, high: 100, low: 100, close: 100 }),
    ];
    expect(drawdownPct(candles, 2)).toBe(0);
  });

  it('returns null without candles or with a non-positive high', () => {
    expect(drawdownPct([], 2)).toBeNull();
    expect(drawdownPct([candle(0, { open: 1, high: 1, low: 1, close: 1 })], 0)).toBeNull();
  });
});

describe('formatPct / formatUsd', () => {
  it('formats native numbers as stable two-decimal strings', () => {
    expect(formatPct(12.3)).toBe('12.30');
    expect(formatPct(0)).toBe('0.00');
    expect(formatUsd(1234.5)).toBe('1234.50');
    expect(formatUsd(0.125)).toBe('0.13');
  });
});

describe('numeric', () => {
  it('returns finite numbers and null for everything else', () => {
    expect(numeric(5)).toBe(5);
    expect(numeric(-2.5)).toBe(-2.5);
    expect(numeric(0)).toBe(0);
    expect(numeric('5')).toBeNull();
    expect(numeric(Number.NaN)).toBeNull();
    expect(numeric(Number.POSITIVE_INFINITY)).toBeNull();
    expect(numeric(null)).toBeNull();
    expect(numeric(undefined)).toBeNull();
    expect(numeric({ value: 5 })).toBeNull();
  });
});

describe('deterministic candle fixtures', () => {
  it('builds a linear series with valid, deterministic candles', () => {
    const series = makeSeries({ count: 6, startPrice: 100, stepPct: 1 });
    expect(series).toHaveLength(6);
    expect(series[0]?.openTime).toBe(Date.UTC(2026, 0, 1));
    expect(series[1]?.openTime).toBe(Date.UTC(2026, 0, 1) + 3_600_000);
    expect(series[0]?.open).toBe('100.00000000');
    expect(series[0]?.close).toBe('100.00000000');
    expect(series[1]?.open).toBe(series[0]?.close);
    expect(Number(series[2]?.close)).toBeCloseTo(100 * 1.01 * 1.01, 6);
    expect(series[0]?.volumeUsd).toBe('100000');
    expect(makeSeries({ count: 6, startPrice: 100, stepPct: 1 })).toEqual(series);
    expect(() => sortAndValidateCandles(series)).not.toThrow();
  });

  it('builds flat and wave series', () => {
    const flat = makeSeries({ count: 4, startPrice: 50, pattern: 'flat' });
    expect(new Set(flat.map((item) => item.close))).toEqual(new Set(['50.00000000']));

    const wave = makeSeries({ count: 8, startPrice: 50, stepPct: 2, pattern: 'wave' });
    expect(wave[0]?.close).toBe('50.00000000');
    expect(Number(wave[2]?.close)).not.toBeCloseTo(50, 6);
    expect(() => sortAndValidateCandles(wave)).not.toThrow();
  });

  it('builds a crash-recovery series with a 20% fall from the peak', () => {
    const series = makeSeries({
      count: 20,
      startPrice: 100,
      stepPct: 1,
      pattern: 'crash-recovery',
    });
    const closesValues = series.map((item) => Number(item.close));
    const peak = Math.max(...closesValues.slice(0, 12));
    const trough = Math.min(...closesValues);
    expect((peak - trough) / peak).toBeCloseTo(0.2, 2);
    expect(closesValues[closesValues.length - 1]).toBeGreaterThan(trough);
    expect(() => sortAndValidateCandles(series)).not.toThrow();
  });

  it('builds candles from explicit closes with aligned opens', () => {
    const series = makeCandlesFromCloses([10, 11, 9], { tokenId: 'abc', timeframe: '4h' });
    expect(series).toHaveLength(3);
    expect(series[0]?.open).toBe('10.00000000');
    expect(series[1]?.open).toBe(series[0]?.close);
    expect(series[1]?.openTime - (series[0]?.openTime ?? 0)).toBe(4 * 3_600_000);
    expect(series[0]?.tokenId).toBe('abc');
    expect(() => sortAndValidateCandles(series)).not.toThrow();
  });

  it('rejects an unknown timeframe instead of emitting NaN timestamps', () => {
    expect(() => makeSeries({ count: 1, startPrice: 1, timeframe: '2h' })).toThrow(/timeframe/);
  });
});

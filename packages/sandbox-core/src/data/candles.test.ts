import { describe, expect, it } from 'vitest';
import type { Candle } from '../types';
import { ArrayCandleSource } from './array-candle-source';
import { CandleValidationError, sortAndValidateCandles } from './candles';

function candle(openTime: number, close = '100'): Candle {
  return {
    tokenId: 'btc',
    timeframe: '1h',
    openTime,
    open: close,
    high: close,
    low: close,
    close,
    volumeUsd: '1000',
  };
}

describe('sortAndValidateCandles', () => {
  it('sorts by time and validates OHLC', () => {
    const sorted = sortAndValidateCandles([candle(2_000), candle(1_000)]);
    expect(sorted.map((item) => item.openTime)).toEqual([1_000, 2_000]);
  });

  it('rejects duplicate token/timeframe/openTime', () => {
    expect(() => sortAndValidateCandles([candle(1_000), candle(1_000)])).toThrow(
      CandleValidationError,
    );
  });

  it('rejects invalid OHLC and non-decimal prices', () => {
    expect(() =>
      sortAndValidateCandles([{ ...candle(1_000), high: '99', close: '100' }]),
    ).toThrow(CandleValidationError);
    expect(() => sortAndValidateCandles([{ ...candle(1_000), close: 'abc' }])).toThrow(
      CandleValidationError,
    );
  });

  it('rejects an unknown timeframe', () => {
    expect(() => sortAndValidateCandles([{ ...candle(1_000), timeframe: '2h' }])).toThrow(
      CandleValidationError,
    );
  });
});

describe('ArrayCandleSource', () => {
  it('returns candles in sorted order and then null', () => {
    const source = new ArrayCandleSource([candle(2_000), candle(1_000)]);
    expect(source.next()?.openTime).toBe(1_000);
    expect(source.next()?.openTime).toBe(2_000);
    expect(source.next()).toBeNull();
  });
});

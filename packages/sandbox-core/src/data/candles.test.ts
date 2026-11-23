import { describe, expect, it } from 'vitest';
import type { Candle } from '../types';
import { ArrayCandleSource } from './array-candle-source';
import { CandleValidationError, sortAndValidateCandles } from './candles';
import { snapshotCandles } from './snapshot';

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

function tokenCandle(tokenId: string, openTime = 1_000): Candle {
  return { ...candle(openTime), tokenId };
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

  it.each(['constructor', 'toString', '__proto__'])(
    'rejects the inherited timeframe key %s',
    (timeframe) => {
      expect(() => sortAndValidateCandles([{ ...candle(1_000), timeframe }])).toThrow(
        CandleValidationError,
      );
    },
  );

  it('orders equal-time candles by code unit, not locale, for a stable snapshot id', () => {
    const input = [tokenCandle('token-1'), tokenCandle('token-10'), tokenCandle('Token-1')];
    const sorted = sortAndValidateCandles(input);
    // Code-unit order: 'T' (0x54) sorts before 't' (0x74); the shorter prefix first.
    expect(sorted.map((item) => item.tokenId)).toEqual(['Token-1', 'token-1', 'token-10']);
    expect(snapshotCandles(input).id).toBe(
      '07dee3ba511e34eee60997e4e6dcf812f0be594ebf4efd33f07404a6bf68ccff',
    );
  });

  it('returns frozen candles and a frozen array', () => {
    const sorted = sortAndValidateCandles([candle(1_000)]);
    expect(Object.isFrozen(sorted)).toBe(true);
    expect(Object.isFrozen(sorted[0])).toBe(true);
    expect(() => {
      (sorted[0] as { close: string }).close = '999';
    }).toThrow(TypeError);
    expect(sorted[0]?.close).toBe('100');
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

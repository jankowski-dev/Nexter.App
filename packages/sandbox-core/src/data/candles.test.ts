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

  it.each(['open', 'high', 'low', 'close'] as const)(
    'rejects a non-positive %s price',
    (field) => {
      expect(() => sortAndValidateCandles([{ ...candle(1_000), [field]: '-1' }])).toThrow(
        /positive decimal string/,
      );
      expect(() => sortAndValidateCandles([{ ...candle(1_000), [field]: '0' }])).toThrow(
        /positive decimal string/,
      );
      expect(() => sortAndValidateCandles([{ ...candle(1_000), [field]: '0.0' }])).toThrow(
        /positive decimal string/,
      );
    },
  );

  it('accepts a zero volume but rejects a negative volume', () => {
    expect(sortAndValidateCandles([{ ...candle(1_000), volumeUsd: '0' }])[0]?.volumeUsd).toBe('0');
    expect(() => sortAndValidateCandles([{ ...candle(1_000), volumeUsd: '-0.1' }])).toThrow(
      /volumeUsd must be a non-negative decimal string/,
    );
    expect(() => sortAndValidateCandles([{ ...candle(1_000), volumeUsd: '-1' }])).toThrow(
      CandleValidationError,
    );
  });

  it('rejects zero and negative prices in every OHLC field', () => {
    expect(() =>
      sortAndValidateCandles([
        { ...candle(1_000), open: '0', high: '0', low: '0', close: '0' },
      ]),
    ).toThrow(CandleValidationError);
    expect(() =>
      sortAndValidateCandles([
        { ...candle(1_000), open: '-5', high: '-4', low: '-6', close: '-5' },
      ]),
    ).toThrow(CandleValidationError);
  });

  it('rejects a negative zero price', () => {
    expect(() => sortAndValidateCandles([{ ...candle(1_000), open: '-0.0' }])).toThrow(
      /positive decimal string/,
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

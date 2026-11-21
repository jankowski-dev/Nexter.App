import { describe, expect, it } from 'vitest';
import { expectedCandles, toCoverage } from './ai-data.service';

describe('AI data coverage', () => {
  it('reports missing coverage when a timeframe has no candles', () => {
    const coverage = toCoverage('1d', undefined);
    expect(coverage.candles).toBe(0);
    expect(coverage.status).toBe('missing');
    expect(coverage.firstOpenTime).toBeNull();
    expect(coverage.lastOpenTime).toBeNull();
  });

  it('reports synthetic candles and the largest gap', () => {
    const coverage = toCoverage('1h', {
      candles: 100,
      firstOpenTime: new Date(),
      lastOpenTime: new Date(),
      syntheticCandles: 12,
      maxGapCandles: 3,
    });
    expect(coverage.syntheticCandles).toBe(12);
    expect(coverage.maxGapCandles).toBe(3);
  });

  it('reports partial, stale and healthy coverage', () => {
    const expected = expectedCandles('1d');
    const now = new Date();
    const healthy = toCoverage('1d', {
      candles: expected,
      firstOpenTime: new Date(now.getTime() - expected * 86_400_000),
      lastOpenTime: now,
    });
    expect(healthy.status).toBe('ok');
    expect(healthy.stale).toBe(false);

    const partial = toCoverage('1d', {
      candles: Math.floor(expected / 2),
      firstOpenTime: null,
      lastOpenTime: now,
    });
    expect(partial.status).toBe('partial');

    const stale = toCoverage('1d', {
      candles: expected,
      firstOpenTime: null,
      lastOpenTime: new Date(now.getTime() - 3 * 86_400_000),
    });
    expect(stale.stale).toBe(true);
    expect(stale.status).toBe('stale');
  });
});

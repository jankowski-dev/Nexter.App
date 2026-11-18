import { describe, expect, it } from 'vitest';
import { computeFeatures, detectRegime, type FeatureCandle } from './ai-features';

function series(length: number, start: number, step: number): FeatureCandle[] {
  const now = Date.now();
  return Array.from({ length }, (_, index) => {
    const close = start + step * index;
    return {
      openTime: new Date(now - (length - 1 - index) * 86_400_000),
      open: String(close - step / 2),
      high: String(close + step),
      low: String(close - step),
      close: String(close),
      volumeUsd: '1000',
      quality: 'ok',
    };
  });
}

describe('AI lab features', () => {
  it('computes trend, returns, drawdown and volume', () => {
    const features = computeFeatures(series(120, 100, 1), '1d');
    expect(features.candles).toBe(120);
    expect(Number(features.lastPriceUsd)).toBeCloseTo(219, 2);
    expect(Number(features.change24hPct)).toBeCloseTo((219 / 218 - 1) * 100, 1);
    expect(Number(features.return30Pct)).toBeCloseTo((219 / 189 - 1) * 100, 1);
    expect(features.trend).toBe('up');
    expect(Number(features.maxDrawdownPct)).toBe(0);
    expect(features.volume24hUsd).not.toBeNull();
    expect(features.stale).toBe(false);
  });

  it('detects high volatility before trend', () => {
    const base = computeFeatures(series(120, 100, 1), '1d');
    expect(detectRegime(base, '1d')).toBe('trend_up');
    expect(detectRegime({ ...base, volatilityPct: '10.00' }, '1d')).toBe('high_volatility');
  });
});

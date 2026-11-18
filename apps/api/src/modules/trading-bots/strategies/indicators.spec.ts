import { describe, expect, it } from 'vitest';
import {
  bollingerBands,
  rollingHighBefore,
  rollingLow,
  rollingLowBefore,
  standardDeviation,
} from './indicators';
import type { StrategySample } from './types';

function history(prices: number[]): StrategySample[] {
  return prices.map((price, index) => ({
    priceUsd: price.toFixed(8),
    capturedAt: new Date(Date.UTC(2026, 0, 1, 0, index)),
  }));
}

function number(value: { toString(): string } | null): number | null {
  return value === null ? null : Number(value.toString());
}

describe('strategy indicators', () => {
  it('finds the lowest close over the window', () => {
    expect(number(rollingLow(history([3, 1, 4, 2]), 3))).toBe(1);
    expect(rollingLow(history([1, 2]), 3)).toBeNull();
  });

  it('excludes the current candle from previous-channel calculations', () => {
    const samples = history([1, 2, 3, 4]);
    expect(number(rollingHighBefore(samples, 2))).toBe(3);
    expect(number(rollingLowBefore(samples, 2))).toBe(2);
    expect(rollingHighBefore(history([1]), 2)).toBeNull();
  });

  it('computes population standard deviation', () => {
    expect(number(standardDeviation(history([1, 1, 1, 1]), 4))).toBe(0);
    expect(number(standardDeviation(history([1, 2, 3, 4]), 4))).toBeCloseTo(1.118, 3);
    expect(standardDeviation(history([1, 2]), 3)).toBeNull();
  });

  it('returns Bollinger bands and bandwidth', () => {
    const bands = bollingerBands(history([1, 2, 3, 4]), 4, 2);
    expect(bands).not.toBeNull();
    expect(number(bands?.mean ?? null)).toBeCloseTo(2.5, 4);
    expect(number(bands?.upper ?? null)).toBeCloseTo(4.736, 3);
    expect(number(bands?.lower ?? null)).toBeCloseTo(0.264, 3);
    expect(number(bands?.bandwidthPct ?? null)).toBeCloseTo(178.885, 2);
    expect(bollingerBands(history([1, 2]), 3, 2)).toBeNull();
  });
});

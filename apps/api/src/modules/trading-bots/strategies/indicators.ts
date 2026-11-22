import { Decimal, decimal } from '../../../shared/money/decimal';
import type { StrategySample } from './types';

export function sma(samples: StrategySample[], period: number): Decimal | null {
  if (period <= 0 || samples.length < period) return null;
  const slice = samples.slice(-period);
  return slice
    .reduce((total, sample) => total.plus(decimal(sample.priceUsd)), new Decimal(0))
    .div(period);
}

export function rollingHigh(samples: StrategySample[], period: number): Decimal | null {
  if (period <= 0 || samples.length < period) return null;
  return samples.slice(-period).reduce((high, sample) => {
    const value = decimal(sample.priceUsd);
    return value.gt(high) ? value : high;
  }, new Decimal(0));
}

export function rollingLow(samples: StrategySample[], period: number): Decimal | null {
  if (period <= 0 || samples.length < period) return null;
  const slice = samples.slice(-period);
  return slice.slice(1).reduce(
    (low, sample) => {
      const value = decimal(sample.priceUsd);
      return value.lt(low) ? value : low;
    },
    decimal((slice[0] as StrategySample).priceUsd),
  );
}

export function rollingHighBefore(samples: StrategySample[], period: number): Decimal | null {
  return rollingHigh(samples.slice(0, -1), period);
}

export function rollingLowBefore(samples: StrategySample[], period: number): Decimal | null {
  return rollingLow(samples.slice(0, -1), period);
}

export function standardDeviation(samples: StrategySample[], period: number): Decimal | null {
  if (period <= 0 || samples.length < period) return null;
  const mean = sma(samples, period);
  if (!mean) return null;

  const variance = samples
    .slice(-period)
    .reduce(
      (total, sample) => total.plus(decimal(sample.priceUsd).minus(mean).pow(2)),
      new Decimal(0),
    )
    .div(period);

  return variance.sqrt();
}

export function bollingerBands(
  samples: StrategySample[],
  period: number,
  stdDev: number,
): { mean: Decimal; upper: Decimal; lower: Decimal; bandwidthPct: Decimal } | null {
  if (period <= 0 || samples.length < period) return null;
  const mean = sma(samples, period);
  const deviation = standardDeviation(samples, period);
  if (!mean || !deviation || mean.lte(0)) return null;

  const upper = mean.plus(deviation.mul(stdDev));
  const lower = mean.minus(deviation.mul(stdDev));
  return {
    mean,
    upper,
    lower,
    bandwidthPct: upper.minus(lower).div(mean).mul(100),
  };
}

export function percent(value: Decimal | null): Decimal | null {
  return value === null ? null : value.mul(100);
}

export interface DailyPriceStats {
  /** UTC calendar day in `YYYY-MM-DD` form. */
  day: string;
  low: Decimal;
  high: Decimal;
  mean: Decimal;
  median: Decimal;
}

export interface DailyAverageLevels {
  /** Number of complete days used for the levels. */
  days: number;
  /** Selected entry level: mean or median of the daily lows. */
  low: Decimal;
  /** Selected exit level: mean or median of the daily highs. */
  high: Decimal;
  averageLow: Decimal;
  averageHigh: Decimal;
  medianLow: Decimal;
  medianHigh: Decimal;
}

function utcDayKey(value: Date): string | null {
  if (Number.isNaN(value.getTime())) return null;
  return value.toISOString().slice(0, 10);
}

function median(values: Decimal[]): Decimal {
  const sorted = [...values].sort((left, right) => left.comparedTo(right));
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[middle - 1] as Decimal).plus(sorted[middle] as Decimal).div(2);
  }
  return sorted[middle] as Decimal;
}

function summarizeDay(day: string, prices: Decimal[]): DailyPriceStats {
  let low = prices[0] as Decimal;
  let high = prices[0] as Decimal;
  let sum = new Decimal(0);
  for (const price of prices) {
    if (price.lt(low)) low = price;
    if (price.gt(high)) high = price;
    sum = sum.plus(price);
  }
  return { day, low, high, mean: sum.div(prices.length), median: median(prices) };
}

/**
 * Computes the average or median daily low/high over the most recent complete
 * UTC days. The current UTC day is ignored because it is still forming;
 * future samples are ignored as well. Returns null until at least
 * `lookbackDays` complete days exist.
 */
export function dailyAverageLevels(
  samples: StrategySample[],
  now: Date,
  lookbackDays: number,
  useMedian: boolean,
): DailyAverageLevels | null {
  if (lookbackDays <= 0) return null;
  const today = utcDayKey(now);
  if (!today) return null;

  // Walk backwards and stop once the most recent `lookbackDays` complete days
  // are collected. This keeps per-tick cost independent of older history.
  const buckets = new Map<string, Decimal[]>();
  for (let index = samples.length - 1; index >= 0; index -= 1) {
    const sample = samples[index] as StrategySample;
    const day = utcDayKey(sample.capturedAt);
    if (!day || day >= today) continue;
    let prices = buckets.get(day);
    if (!prices) {
      if (buckets.size >= lookbackDays) break;
      prices = [];
      buckets.set(day, prices);
    }
    prices.push(decimal(sample.priceUsd));
  }
  if (buckets.size < lookbackDays) return null;

  const window = [...buckets.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([day, prices]) => summarizeDay(day, prices));
  const lows = window.map((day) => day.low);
  const highs = window.map((day) => day.high);
  const averageLow = lows
    .reduce((total, value) => total.plus(value), new Decimal(0))
    .div(window.length);
  const averageHigh = highs
    .reduce((total, value) => total.plus(value), new Decimal(0))
    .div(window.length);
  const medianLow = median(lows);
  const medianHigh = median(highs);
  return {
    days: window.length,
    low: useMedian ? medianLow : averageLow,
    high: useMedian ? medianHigh : averageHigh,
    averageLow,
    averageHigh,
    medianLow,
    medianHigh,
  };
}

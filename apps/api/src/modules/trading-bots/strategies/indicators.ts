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

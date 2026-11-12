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

export function percent(value: Decimal | null): Decimal | null {
  return value === null ? null : value.mul(100);
}

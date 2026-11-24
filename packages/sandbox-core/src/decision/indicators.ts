import type { Candle } from '../types';

/**
 * Indicator helpers used by the regime classifier and by strategies.
 *
 * They intentionally work on native numbers: the design allows floats for
 * indicators, ranking scores and regime rules. Money never passes through
 * these functions; order sizes and risk values use `decimal.ts`.
 */

/** Returns the close price of every candle in order. */
export function closes(candles: readonly Candle[]): number[] {
  return candles.map((candle) => Number(candle.close));
}

function windowStart(length: number, period: number): number | null {
  if (!Number.isInteger(period) || period <= 0 || length < period) return null;
  return length - period;
}

/** Arithmetic mean of the last `period` values, or `null` when unavailable. */
export function sma(values: readonly number[], period: number): number | null {
  const start = windowStart(values.length, period);
  if (start === null) return null;
  let sum = 0;
  for (let index = start; index < values.length; index += 1) sum += values[index] as number;
  return sum / period;
}

/** Index-aligned simple moving average; `null` until the first full window. */
export function smaSeries(values: readonly number[], period: number): Array<number | null> {
  const result: Array<number | null> = new Array(values.length).fill(null);
  if (!Number.isInteger(period) || period <= 0) return result;
  let sum = 0;
  for (let index = 0; index < values.length; index += 1) {
    sum += values[index] as number;
    if (index >= period) sum -= values[index - period] as number;
    if (index >= period - 1) result[index] = sum / period;
  }
  return result;
}

/**
 * ATR as a percentage of the last close.
 *
 * Uses the simple average of the last `period` true ranges (not Wilder's
 * smoothing). Needs `period + 1` candles because the first true range compares
 * against the previous close. Returns `null` when history is insufficient or
 * the last close is not positive.
 */
export function atrPct(candles: readonly Candle[], period: number): number | null {
  if (!Number.isInteger(period) || period <= 0 || candles.length < period + 1) return null;
  const lastIndex = candles.length - 1;
  const lastClose = Number((candles[lastIndex] as Candle).close);
  if (!Number.isFinite(lastClose) || lastClose <= 0) return null;

  let sum = 0;
  for (let index = lastIndex - period + 1; index <= lastIndex; index += 1) {
    const current = candles[index] as Candle;
    const previous = candles[index - 1] as Candle;
    const high = Number(current.high);
    const low = Number(current.low);
    const previousClose = Number(previous.close);
    sum += Math.max(high - low, Math.abs(high - previousClose), Math.abs(low - previousClose));
  }
  return (sum / period / lastClose) * 100;
}

/** Highest high over the last `period` candles. */
export function highestHigh(candles: readonly Candle[], period: number): number | null {
  const start = windowStart(candles.length, period);
  if (start === null) return null;
  let highest = Number.NEGATIVE_INFINITY;
  for (let index = start; index < candles.length; index += 1) {
    const high = Number((candles[index] as Candle).high);
    if (high > highest) highest = high;
  }
  return Number.isFinite(highest) ? highest : null;
}

/** Lowest low over the last `period` candles. */
export function lowestLow(candles: readonly Candle[], period: number): number | null {
  const start = windowStart(candles.length, period);
  if (start === null) return null;
  let lowest = Number.POSITIVE_INFINITY;
  for (let index = start; index < candles.length; index += 1) {
    const low = Number((candles[index] as Candle).low);
    if (low < lowest) lowest = low;
  }
  return Number.isFinite(lowest) ? lowest : null;
}

/** Arithmetic mean of `volumeUsd` over the last `period` candles. */
export function averageVolumeUsd(candles: readonly Candle[], period: number): number | null {
  const start = windowStart(candles.length, period);
  if (start === null) return null;
  let sum = 0;
  for (let index = start; index < candles.length; index += 1) {
    const volume = Number((candles[index] as Candle).volumeUsd);
    if (!Number.isFinite(volume)) return null;
    sum += volume;
  }
  return sum / period;
}

/** Fall from the highest high in the window to the last close, never below 0. */
export function drawdownPct(candles: readonly Candle[], period: number): number | null {
  const start = windowStart(candles.length, period);
  if (start === null) return null;
  let highest = Number.NEGATIVE_INFINITY;
  for (let index = start; index < candles.length; index += 1) {
    const high = Number((candles[index] as Candle).high);
    if (high > highest) highest = high;
  }
  const lastClose = Number((candles[candles.length - 1] as Candle).close);
  if (!Number.isFinite(highest) || highest <= 0 || !Number.isFinite(lastClose)) return null;
  return Math.max(0, ((highest - lastClose) / highest) * 100);
}

/** Stable two-decimal percentage string for log payloads. */
export function formatPct(value: number): string {
  return value.toFixed(2);
}

/** Stable two-decimal USD string for log payloads. */
export function formatUsd(value: number): string {
  return value.toFixed(2);
}

/** State reader: returns the value only when it is a finite native number. */
export function numeric(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

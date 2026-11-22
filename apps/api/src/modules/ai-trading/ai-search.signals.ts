import type { AiSearchTimeframe, BotCandle } from '@nexter/contracts';
import { candlesPerDay, type SearchFold, type SearchVariant } from './ai-search.helpers';
import { strategyByKey } from '../trading-bots/strategies';

const SAFE_SIGNAL_STRATEGIES = new Set([
  'momentum_breakout',
  'mean_reversion',
  'trend_pullback',
  'trailing_stop',
  'donchian_breakout',
  'bollinger_reversion',
  'squeeze_breakout',
]);

function closes(candles: BotCandle[]): number[] {
  return candles.map((candle) => Number(candle.closeUsd));
}

export function smaSeries(values: number[], period: number): Array<number | null> {
  if (period <= 0) return values.map(() => null);
  const result = new Array<number | null>(values.length).fill(null);
  let sum = 0;
  for (let index = 0; index < values.length; index += 1) {
    sum += values[index] as number;
    if (index >= period) sum -= values[index - period] as number;
    if (index >= period - 1) result[index] = sum / period;
  }
  return result;
}

export function rollingHighBefore(values: number[], period: number): Array<number | null> {
  const result = new Array<number | null>(values.length).fill(null);
  if (period <= 0) return result;
  const deque: number[] = [];
  for (let index = 0; index < values.length; index += 1) {
    if (index > 0) {
      while (
        deque.length > 0 &&
        (values[deque[deque.length - 1] as number] as number) <= (values[index - 1] as number)
      ) {
        deque.pop();
      }
      deque.push(index - 1);
      while (deque.length > 0 && (deque[0] as number) < index - period) deque.shift();
      result[index] = values[deque[0] as number] as number;
    }
  }
  return result;
}

export function rollingHighAt(values: number[], period: number): Array<number | null> {
  const result = new Array<number | null>(values.length).fill(null);
  if (period <= 0) return result;
  const deque: number[] = [];
  for (let index = 0; index < values.length; index += 1) {
    while (
      deque.length > 0 &&
      (values[deque[deque.length - 1] as number] as number) <= (values[index] as number)
    ) {
      deque.pop();
    }
    deque.push(index);
    while ((deque[0] as number) < index - period + 1) deque.shift();
    if (index >= period - 1) result[index] = values[deque[0] as number] as number;
  }
  return result;
}

export function rollingLowBefore(values: number[], period: number): Array<number | null> {
  const result = new Array<number | null>(values.length).fill(null);
  if (period <= 0) return result;
  const deque: number[] = [];
  for (let index = 0; index < values.length; index += 1) {
    if (index > 0) {
      while (
        deque.length > 0 &&
        (values[deque[deque.length - 1] as number] as number) >= (values[index - 1] as number)
      ) {
        deque.pop();
      }
      deque.push(index - 1);
      while (deque.length > 0 && (deque[0] as number) < index - period) deque.shift();
      if (index >= period) result[index] = values[deque[0] as number] as number;
    }
  }
  return result;
}

export function rollingLowAt(values: number[], period: number): Array<number | null> {
  const result = new Array<number | null>(values.length).fill(null);
  if (period <= 0) return result;
  const deque: number[] = [];
  for (let index = 0; index < values.length; index += 1) {
    while (
      deque.length > 0 &&
      (values[deque[deque.length - 1] as number] as number) >= (values[index] as number)
    ) {
      deque.pop();
    }
    deque.push(index);
    while ((deque[0] as number) < index - period + 1) deque.shift();
    if (index >= period - 1) result[index] = values[deque[0] as number] as number;
  }
  return result;
}

export function bollingerSeries(
  values: number[],
  period: number,
  stdDev: number,
): {
  mean: Array<number | null>;
  lower: Array<number | null>;
  upper: Array<number | null>;
  bandwidth: Array<number | null>;
} {
  const mean = new Array<number | null>(values.length).fill(null);
  const lower = new Array<number | null>(values.length).fill(null);
  const upper = new Array<number | null>(values.length).fill(null);
  const bandwidth = new Array<number | null>(values.length).fill(null);
  if (period <= 0) return { mean, lower, upper, bandwidth };
  let sum = 0;
  let sumSquares = 0;
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index] as number;
    sum += value;
    sumSquares += value * value;
    if (index >= period) {
      const removed = values[index - period] as number;
      sum -= removed;
      sumSquares -= removed * removed;
    }
    if (index < period - 1) continue;
    const average = sum / period;
    const variance = Math.max(0, sumSquares / period - average * average);
    const deviation = Math.sqrt(variance);
    const high = average + deviation * stdDev;
    const low = average - deviation * stdDev;
    mean[index] = average;
    lower[index] = low;
    upper[index] = high;
    bandwidth[index] = average > 0 ? ((high - low) / average) * 100 : 0;
  }
  return { mean, lower, upper, bandwidth };
}

function num(params: Record<string, unknown>, key: string, fallback: number): number {
  const value = params[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

export function isSafeSignalStrategy(strategyKey: string): boolean {
  return SAFE_SIGNAL_STRATEGIES.has(strategyKey);
}

/**
 * Counts potential entry signals without simulating cash, positions, fees or
 * equity. For the supported strategies a real entry requires a signal, so
 * `count < requiredTrades` is a safe rejection. Position-dependent add
 * strategies (grid/DCA/crash) intentionally return null.
 */
export function countEntrySignals(
  variant: SearchVariant,
  fold: SearchFold,
  timeframe: AiSearchTimeframe,
): number | null {
  if (!SAFE_SIGNAL_STRATEGIES.has(variant.strategyKey)) return null;
  const definition = strategyByKey.get(variant.strategyKey);
  if (!definition) return null;
  let params: Record<string, unknown>;
  try {
    params = definition.parseParams(variant.params);
  } catch {
    return 0;
  }

  const values = closes(fold.candles);
  const start = Math.min(values.length, Math.max(0, fold.warmupCandles));
  if (start >= values.length) return 0;
  const lookback = candlesPerDay(timeframe);
  let count = 0;

  switch (variant.strategyKey) {
    case 'momentum_breakout': {
      const fast = smaSeries(values, num(params, 'fastPeriod', 5));
      const slow = smaSeries(values, num(params, 'slowPeriod', 20));
      const minChange = num(params, 'minChange24hPct', 1);
      for (let index = start; index < values.length; index += 1) {
        const previous = values[index - lookback];
        const fastValue = fast[index];
        const slowValue = slow[index];
        if (previous === undefined || fastValue === null || slowValue === null) continue;
        const change = (((values[index] as number) - previous) / previous) * 100;
        if (change >= minChange && fastValue > slowValue) count += 1;
      }
      break;
    }
    case 'mean_reversion': {
      const mean = smaSeries(values, num(params, 'lookback', 20));
      const drop = num(params, 'entryDropPct', 2);
      for (let index = start; index < values.length; index += 1) {
        const average = mean[index];
        if (average !== null && (values[index] as number) <= average * (1 - drop / 100)) count += 1;
      }
      break;
    }
    case 'trend_pullback': {
      const fast = smaSeries(values, num(params, 'fastPeriod', 8));
      const slow = smaSeries(values, num(params, 'slowPeriod', 30));
      const pullback = num(params, 'pullbackPct', 1);
      for (let index = start; index < values.length; index += 1) {
        const f = fast[index];
        const s = slow[index];
        if (
          f !== null &&
          s !== null &&
          f > s &&
          (values[index] as number) <= f * (1 - pullback / 100)
        ) {
          count += 1;
        }
      }
      break;
    }
    case 'trailing_stop': {
      const high = rollingHighBefore(values, num(params, 'entryLookback', 4));
      const buffer = num(params, 'breakoutBufferPct', 1);
      for (let index = start; index < values.length; index += 1) {
        const h = high[index];
        if (h !== null && (values[index] as number) > h * (1 + buffer / 100)) count += 1;
      }
      break;
    }
    case 'donchian_breakout': {
      const high = rollingHighBefore(values, num(params, 'channelPeriod', 20));
      const buffer = num(params, 'breakoutBufferPct', 1);
      for (let index = start; index < values.length; index += 1) {
        const h = high[index];
        if (h !== null && (values[index] as number) > h * (1 + buffer / 100)) count += 1;
      }
      break;
    }
    case 'bollinger_reversion': {
      const bands = bollingerSeries(values, num(params, 'period', 20), num(params, 'stdDev', 2));
      for (let index = start; index < values.length; index += 1) {
        const lower = bands.lower[index];
        if (lower !== null && (values[index] as number) < lower) count += 1;
      }
      break;
    }
    case 'squeeze_breakout': {
      const bands = bollingerSeries(values, num(params, 'period', 20), num(params, 'stdDev', 2));
      const threshold = num(params, 'squeezeThresholdPct', 5);
      const buffer = num(params, 'breakoutBufferPct', 1);
      for (let index = start; index < values.length; index += 1) {
        const bandwidth = index > 0 ? bands.bandwidth[index - 1] : null;
        const upper = index > 0 ? bands.upper[index - 1] : null;
        if (
          bandwidth !== null &&
          upper !== null &&
          bandwidth <= threshold &&
          (values[index] as number) > upper * (1 + buffer / 100)
        ) {
          count += 1;
        }
      }
      break;
    }
  }

  return count;
}

import { TIMEFRAME_MS } from '../timeframes';
import type { Candle } from '../types';

/**
 * Deterministic candle builders for decision-engine tests.
 *
 * This file is excluded from the package build (`*.test-helpers.ts`) and is
 * only imported by co-located tests. No `Math.random`, no `Date.now`, no
 * locale-dependent formatting.
 */

export interface SeriesOptions {
  tokenId?: string;
  timeframe?: string;
  start?: number;
  count: number;
  startPrice: number;
  stepPct?: number;
  pattern?: 'linear' | 'flat' | 'wave' | 'crash-recovery';
  volumeUsd?: number;
}

export interface ClosesOptions {
  tokenId?: string;
  timeframe?: string;
  start?: number;
  volumeUsd?: number;
}

const DEFAULT_START = Date.UTC(2026, 0, 1);
const DEFAULT_TIMEFRAME = '1h';
const DEFAULT_TOKEN_ID = 'token';
const DEFAULT_VOLUME_USD = 100_000;
const CRASH_DROP_FRACTION = 0.2;

function timeframeMs(timeframe: string): number {
  if (!Object.hasOwn(TIMEFRAME_MS, timeframe)) {
    throw new Error(`Unknown timeframe: ${timeframe}`);
  }
  return TIMEFRAME_MS[timeframe] as number;
}

function priceString(value: number): string {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`Candle price must be a positive finite number, received ${String(value)}`);
  }
  // Fixed precision keeps fixtures byte-identical across Node versions.
  return value.toFixed(8);
}

function buildCandle(
  tokenId: string,
  timeframe: string,
  openTime: number,
  open: number,
  close: number,
  volumeUsd: number,
): Candle {
  return {
    tokenId,
    timeframe,
    openTime,
    open: priceString(open),
    high: priceString(Math.max(open, close) * 1.001),
    low: priceString(Math.min(open, close) * 0.999),
    close: priceString(close),
    volumeUsd: String(volumeUsd),
  };
}

function crashRecoveryClose(
  index: number,
  startPrice: number,
  growth: number,
  upBars: number,
  crashBars: number,
): number {
  if (index < upBars) return startPrice * growth ** index;
  const top = startPrice * growth ** (upBars - 1);
  if (index < upBars + crashBars) {
    const step = index - upBars + 1;
    return top * (1 - CRASH_DROP_FRACTION * (step / crashBars));
  }
  const bottom = top * (1 - CRASH_DROP_FRACTION);
  return bottom * growth ** (index - (upBars + crashBars) + 1);
}

export function makeSeries(options: SeriesOptions): Candle[] {
  const tokenId = options.tokenId ?? DEFAULT_TOKEN_ID;
  const timeframe = options.timeframe ?? DEFAULT_TIMEFRAME;
  const start = options.start ?? DEFAULT_START;
  const pattern = options.pattern ?? 'linear';
  // `stepPct` is per-bar compound growth for `linear`/`crash-recovery` and a
  // sine amplitude for `wave`; `flat` ignores it. Fixed rounding below keeps
  // every fixture byte-identical across Node versions.
  const stepPct = options.stepPct ?? 0.1;
  const volumeUsd = options.volumeUsd ?? DEFAULT_VOLUME_USD;
  const step = timeframeMs(timeframe);
  const growth = 1 + stepPct / 100;
  const count = Math.max(0, Math.floor(options.count));
  const upBars = Math.max(1, Math.floor(count * 0.6));
  const crashBars = Math.max(0, Math.floor(count * 0.15));

  const closesByIndex: number[] = [];
  for (let index = 0; index < count; index += 1) {
    let close: number;
    switch (pattern) {
      case 'flat':
        close = options.startPrice;
        break;
      case 'wave':
        close =
          options.startPrice *
          (1 + (stepPct / 100) * Math.sin((2 * Math.PI * index) / Math.max(count, 1)));
        break;
      case 'crash-recovery':
        close = crashRecoveryClose(index, options.startPrice, growth, upBars, crashBars);
        break;
      case 'linear':
      default:
        close = options.startPrice * growth ** index;
        break;
    }
    closesByIndex.push(close);
  }

  const candles: Candle[] = [];
  let previousClose = options.startPrice;
  for (let index = 0; index < closesByIndex.length; index += 1) {
    const close = closesByIndex[index] as number;
    const open = index === 0 ? options.startPrice : previousClose;
    candles.push(buildCandle(tokenId, timeframe, start + index * step, open, close, volumeUsd));
    previousClose = close;
  }
  return candles;
}

export function makeCandlesFromCloses(
  closesValues: readonly number[],
  options: ClosesOptions = {},
): Candle[] {
  const tokenId = options.tokenId ?? DEFAULT_TOKEN_ID;
  const timeframe = options.timeframe ?? DEFAULT_TIMEFRAME;
  const start = options.start ?? DEFAULT_START;
  const volumeUsd = options.volumeUsd ?? DEFAULT_VOLUME_USD;
  const step = timeframeMs(timeframe);

  const candles: Candle[] = [];
  let previousClose: number | null = null;
  closesValues.forEach((close, index) => {
    const open = previousClose ?? close;
    candles.push(buildCandle(tokenId, timeframe, start + index * step, open, close, volumeUsd));
    previousClose = close;
  });
  return candles;
}

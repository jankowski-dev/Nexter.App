import { Reason } from '../decision/reason-codes';
import type { OrderIntent } from '../decision/types';
import { TIMEFRAME_MS } from '../timeframes';
import type { Candle } from '../types';
import { DEFAULT_PAPER_SETTINGS } from './defaults';
import type { PaperRunConfig, PaperRunSettings } from './types';

/**
 * Deterministic fixtures for the paper execution tests.
 *
 * This file is excluded from the package build (`*.test-helpers.ts`) and is only
 * imported by co-located tests. No `Math.random`, no `Date.now` and no
 * locale-dependent formatting: every value is explicit or derived from the
 * arguments, so fixtures are byte-identical across runs and Node versions.
 */

export const FIXTURE_START = Date.UTC(2026, 0, 1);
export const FIXTURE_TOKEN_ID = 'token';
export const FIXTURE_TIMEFRAME = '1h';

export interface CandleOptions {
  readonly tokenId?: string;
  readonly timeframe?: string;
  readonly openTime?: number;
  readonly open?: string;
  readonly high?: string;
  readonly low?: string;
  readonly close?: string;
  readonly volumeUsd?: string;
}

/** Builds one valid candle; every field can be overridden independently. */
export function makeCandle(overrides: CandleOptions = {}): Candle {
  return {
    tokenId: overrides.tokenId ?? FIXTURE_TOKEN_ID,
    timeframe: overrides.timeframe ?? FIXTURE_TIMEFRAME,
    openTime: overrides.openTime ?? FIXTURE_START,
    open: overrides.open ?? '100',
    high: overrides.high ?? '101',
    low: overrides.low ?? '99',
    close: overrides.close ?? '100',
    volumeUsd: overrides.volumeUsd ?? '100000',
  };
}

export interface CandleSeriesOptions {
  readonly tokenId?: string;
  readonly timeframe?: string;
  readonly start?: number;
  readonly volumeUsd?: string;
}

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

/**
 * Builds a candle series where each bar opens at the previous close. Explicit
 * closes keep the next-open fill assertions readable.
 */
export function makeCandles(
  closes: readonly number[],
  options: CandleSeriesOptions = {},
): Candle[] {
  const tokenId = options.tokenId ?? FIXTURE_TOKEN_ID;
  const timeframe = options.timeframe ?? FIXTURE_TIMEFRAME;
  const start = options.start ?? FIXTURE_START;
  const volumeUsd = options.volumeUsd ?? '100000';
  const step = timeframeMs(timeframe);

  let previousClose: number | null = null;
  return closes.map((close, index) => {
    const open = previousClose ?? close;
    previousClose = close;
    return {
      tokenId,
      timeframe,
      openTime: start + index * step,
      open: priceString(open),
      high: priceString(Math.max(open, close) * 1.001),
      low: priceString(Math.min(open, close) * 0.999),
      close: priceString(close),
      volumeUsd,
    };
  });
}

export interface IntentOptions {
  readonly intentId?: string;
  readonly tokenId?: string;
  readonly side?: 'buy' | 'sell';
  readonly strategyKey?: OrderIntent['strategyKey'];
  readonly strategyVersion?: number;
  readonly reasonCode?: OrderIntent['reasonCode'];
  readonly sizeUsd?: string;
  readonly amount?: string | null;
  readonly stopLossPct?: string | null;
  readonly takeProfitPct?: string | null;
  readonly decisionPriceUsd?: string;
  readonly clockTime?: number;
}

/** Builds an `OrderIntent` with buy defaults; override `side`/`amount` for sells. */
export function makeIntent(overrides: IntentOptions = {}): OrderIntent {
  return {
    intentId: overrides.intentId ?? 'intent-1',
    tokenId: overrides.tokenId ?? FIXTURE_TOKEN_ID,
    side: overrides.side ?? 'buy',
    strategyKey: overrides.strategyKey ?? 'trend_pullback',
    strategyVersion: overrides.strategyVersion ?? 1,
    reasonCode: overrides.reasonCode ?? Reason.TREND_PULLBACK_ENTRY,
    sizeUsd: overrides.sizeUsd ?? '200',
    amount: overrides.amount ?? null,
    stopLossPct: overrides.stopLossPct ?? '3',
    takeProfitPct: overrides.takeProfitPct ?? null,
    decisionPriceUsd: overrides.decisionPriceUsd ?? '100.00000000',
    clockTime: overrides.clockTime ?? FIXTURE_START,
  };
}

/** Paper execution settings with the approved Stage 1C defaults. */
export function makeSettings(overrides: Partial<PaperRunSettings> = {}): PaperRunSettings {
  return { ...DEFAULT_PAPER_SETTINGS, ...overrides };
}

/** A complete paper run config for version-hash tests. */
export function makePaperConfig(overrides: Partial<PaperRunConfig> = {}): PaperRunConfig {
  return {
    runId: 'run-1',
    seed: 7,
    timeframe: FIXTURE_TIMEFRAME,
    tokenIds: [FIXTURE_TOKEN_ID],
    initialCapitalUsd: '1000.00',
    ...DEFAULT_PAPER_SETTINGS,
    ...overrides,
  };
}

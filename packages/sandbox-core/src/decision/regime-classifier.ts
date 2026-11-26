import { TIMEFRAME_MS, candleCloseTime } from '../timeframes';
import type { Candle, Timestamp } from '../types';
import { REGIME_RULES_VERSION } from './defaults';
import {
  atrPct as computeAtrPct,
  averageVolumeUsd as computeAverageVolumeUsd,
  closes as candleCloses,
  drawdownPct as computeDrawdownPct,
  formatPct,
  formatUsd,
  highestHigh,
  lowestLow,
  sma,
  smaSeries,
} from './indicators';
import { Reason } from './reason-codes';
import type { ReasonCode } from './reason-codes';
import type { Regime, RegimeFeatures, RegimeSettings, RegimeState } from './types';

/**
 * Deterministic regime classifier.
 *
 * Takes closed candles from the caller, computes native-number indicators and
 * maps them to one of seven regimes. No I/O, no logging, no clock reads: the
 * caller passes `now`, so decisions stay reproducible. Hysteresis keeps a held
 * regime until a pending candidate is confirmed for `regimeDwellBars` bars;
 * CRASH and ILLIQUID always win immediately.
 */

export interface RegimeInput {
  readonly tokenId: string;
  readonly now: Timestamp;
  readonly candles: readonly Candle[];
  readonly previous: RegimeState | null;
  readonly settings: RegimeSettings;
}

export interface RegimeEvaluation {
  readonly state: RegimeState;
  readonly rawRegime: Regime;
  readonly changed: boolean;
  readonly reasonCode: ReasonCode;
  readonly reasonText: string;
}

/** Native-number feature snapshot used by the classification rules. */
interface RawFeatures {
  readonly bars: number;
  readonly lastClose: number | null;
  readonly fastSma: number | null;
  readonly slowSma: number | null;
  readonly longSma: number | null;
  readonly atrPct: number | null;
  readonly recentHigh: number | null;
  readonly recentLow: number | null;
  readonly avgVolumeUsd: number | null;
  readonly drawdownPct: number | null;
  readonly staleBars: number;
  readonly futureCandle: boolean;
}

interface RawClassification {
  readonly rawRegime: Regime;
  readonly rawReason: ReasonCode;
  readonly features: RegimeFeatures;
}

function isPositive(value: number | null): value is number {
  return value !== null && Number.isFinite(value) && value > 0;
}

function finiteOrNull(value: number | null): number | null {
  return value !== null && Number.isFinite(value) ? value : null;
}

function zeroFeatures(): RegimeFeatures {
  return {
    bars: 0,
    lastClose: null,
    fastSma: null,
    slowSma: null,
    longSma: null,
    atrPct: null,
    recentHigh: null,
    recentLow: null,
    avgVolumeUsd: null,
    drawdownPct: null,
    staleBars: 0,
  };
}

interface CandleTiming {
  readonly staleBars: number;
  /** True when the last candle closes after `now` (look-ahead data). */
  readonly futureCandle: boolean;
}

function candleTiming(candles: readonly Candle[], now: Timestamp): CandleTiming {
  const last = candles[candles.length - 1];
  if (last === undefined) return { staleBars: 0, futureCandle: false };
  const timeframeMs = TIMEFRAME_MS[last.timeframe];
  if (timeframeMs === undefined || timeframeMs <= 0) {
    return { staleBars: 0, futureCandle: false };
  }
  const elapsed = now - candleCloseTime(last);
  if (!Number.isFinite(elapsed)) return { staleBars: 0, futureCandle: false };
  if (elapsed < 0) return { staleBars: 0, futureCandle: true };
  return { staleBars: Math.floor(elapsed / timeframeMs), futureCandle: false };
}

/** Drawdown looks at the wider window so a crash outside the range window still counts. */
function drawdownWindowHours(settings: RegimeSettings): number {
  return Math.max(settings.slowHours, settings.rangeWindowHours);
}

function computeRawFeatures(
  candles: readonly Candle[],
  now: Timestamp,
  settings: RegimeSettings,
): RawFeatures {
  const bars = candles.length;
  const closes = candleCloses(candles);
  const lastIndex = bars - 1;
  const lastClose = lastIndex >= 0 ? finiteOrNull(Number(candles[lastIndex]?.close)) : null;
  const timing = candleTiming(candles, now);

  return {
    bars,
    lastClose,
    fastSma: finiteOrNull(sma(closes, settings.fastHours)),
    slowSma: finiteOrNull(sma(closes, settings.slowHours)),
    longSma: finiteOrNull(sma(closes, settings.longHours)),
    atrPct: finiteOrNull(computeAtrPct(candles, settings.atrPeriod)),
    recentHigh: finiteOrNull(highestHigh(candles, settings.rangeWindowHours)),
    recentLow: finiteOrNull(lowestLow(candles, settings.rangeWindowHours)),
    avgVolumeUsd: finiteOrNull(computeAverageVolumeUsd(candles, settings.liquidityWindowHours)),
    drawdownPct: finiteOrNull(computeDrawdownPct(candles, drawdownWindowHours(settings))),
    staleBars: timing.staleBars,
    futureCandle: timing.futureCandle,
  };
}

function usdFeature(value: number | null): string | null {
  return value === null ? null : formatUsd(value);
}

function pctFeature(value: number | null): string | null {
  return value === null ? null : formatPct(value);
}

function toFeatures(raw: RawFeatures): RegimeFeatures {
  return {
    bars: raw.bars,
    lastClose: usdFeature(raw.lastClose),
    fastSma: usdFeature(raw.fastSma),
    slowSma: usdFeature(raw.slowSma),
    longSma: usdFeature(raw.longSma),
    atrPct: pctFeature(raw.atrPct),
    recentHigh: usdFeature(raw.recentHigh),
    recentLow: usdFeature(raw.recentLow),
    avgVolumeUsd: usdFeature(raw.avgVolumeUsd),
    drawdownPct: pctFeature(raw.drawdownPct),
    staleBars: raw.staleBars,
  };
}

function minimumBars(settings: RegimeSettings): number {
  return Math.max(
    settings.atrPeriod + 1,
    settings.slowHours + 1,
    settings.liquidityWindowHours,
    settings.rangeWindowHours,
  );
}

/** True when the fast SMA rose on each of the last `confirmBars` transitions. */
function fastSmaKeepsRising(
  candles: readonly Candle[],
  period: number,
  confirmBars: number,
): boolean {
  if (confirmBars <= 0) return true;
  const series = smaSeries(candleCloses(candles), period);
  const last = series.length - 1;
  if (last - confirmBars < 0) return false;
  for (let index = last - confirmBars + 1; index <= last; index += 1) {
    const current = series[index];
    const before = series[index - 1];
    if (current === null || current === undefined) return false;
    if (before === null || before === undefined) return false;
    if (!(current > before)) return false;
  }
  return true;
}

function evaluateRaw(
  candles: readonly Candle[],
  now: Timestamp,
  settings: RegimeSettings,
  previous: RegimeState | null,
): RawClassification {
  const raw = computeRawFeatures(candles, now, settings);

  if (raw.bars < minimumBars(settings)) {
    return {
      rawRegime: 'ILLIQUID',
      rawReason: Reason.REGIME_INSUFFICIENT_HISTORY,
      features: toFeatures(raw),
    };
  }

  const lastClose = raw.lastClose;
  const fastSma = raw.fastSma;
  const slowSma = raw.slowSma;
  const features = toFeatures(raw);
  if (!isPositive(lastClose) || !isPositive(fastSma) || !isPositive(slowSma)) {
    // A non-positive price makes every ratio meaningless: report a clean
    // UNKNOWN with zeroed features instead of leaking NaN/Infinity, but keep
    // the bar counts so the log does not claim zero candles were supplied.
    return {
      rawRegime: 'UNKNOWN',
      rawReason: Reason.REGIME_UNKNOWN,
      features: { ...zeroFeatures(), bars: features.bars, staleBars: features.staleBars },
    };
  }

  if (raw.staleBars > 0 || raw.futureCandle) {
    return { rawRegime: 'ILLIQUID', rawReason: Reason.REGIME_STALE_DATA, features };
  }

  const avgVolumeUsd = raw.avgVolumeUsd;
  if (avgVolumeUsd === null) {
    return { rawRegime: 'UNKNOWN', rawReason: Reason.REGIME_UNKNOWN, features };
  }
  // Research mode: keep the token eligible and let the per-bar execution cap
  // size/partial-fill orders instead of rejecting the whole token by 24h volume.
  if (settings.liquidityMode !== 'execution') {
    const minLiquidityUsd = Number(settings.minLiquidityUsd);
    if (!Number.isFinite(minLiquidityUsd)) {
      return { rawRegime: 'UNKNOWN', rawReason: Reason.REGIME_UNKNOWN, features };
    }
    if (avgVolumeUsd < minLiquidityUsd) {
      return { rawRegime: 'ILLIQUID', rawReason: Reason.REGIME_LOW_LIQUIDITY, features };
    }
  }

  const atrPct = raw.atrPct;
  const drawdown = raw.drawdownPct;
  if (atrPct === null || drawdown === null) {
    return { rawRegime: 'UNKNOWN', rawReason: Reason.REGIME_UNKNOWN, features };
  }

  if (drawdown >= settings.crashDrawdownPct || atrPct >= settings.crashAtrPct) {
    return { rawRegime: 'CRASH', rawReason: Reason.REGIME_CRASH, features };
  }

  const recoveringFrom = previous?.regime === 'CRASH' || previous?.regime === 'TREND_DOWN';
  if (
    recoveringFrom &&
    lastClose > fastSma &&
    fastSmaKeepsRising(candles, settings.fastHours, settings.recoveryConfirmBars)
  ) {
    return { rawRegime: 'RECOVERY', rawReason: Reason.REGIME_RECOVERY, features };
  }

  const trendSpread = settings.trendSpreadPct / 100;
  if (
    fastSma > slowSma * (1 + trendSpread) &&
    lastClose > slowSma &&
    atrPct <= settings.trendMaxAtrPct
  ) {
    return { rawRegime: 'TREND_UP', rawReason: Reason.REGIME_TREND_UP, features };
  }

  if (fastSma < slowSma * (1 - trendSpread) && lastClose < slowSma) {
    return { rawRegime: 'TREND_DOWN', rawReason: Reason.REGIME_TREND_DOWN, features };
  }

  const spreadPct = (Math.abs(fastSma - slowSma) / slowSma) * 100;
  if (spreadPct <= settings.rangeSpreadPct && atrPct <= settings.rangeMaxAtrPct) {
    return { rawRegime: 'RANGE', rawReason: Reason.REGIME_RANGE, features };
  }

  return { rawRegime: 'UNKNOWN', rawReason: Reason.REGIME_UNKNOWN, features };
}

function adoptedState(
  regime: Regime,
  reasonCode: ReasonCode,
  features: RegimeFeatures,
  since: Timestamp,
): RegimeState {
  return {
    regime,
    reasonCode,
    candidate: null,
    candidateBars: 0,
    since,
    rulesVersion: REGIME_RULES_VERSION,
    features,
  };
}

function heldState(
  previous: RegimeState,
  features: RegimeFeatures,
  candidate: Regime | null,
  candidateBars: number,
): RegimeState {
  return {
    regime: previous.regime,
    reasonCode: previous.reasonCode,
    candidate,
    candidateBars,
    since: previous.since,
    rulesVersion: REGIME_RULES_VERSION,
    features,
  };
}

function adoptionText(regime: Regime, reasonCode: ReasonCode): string {
  return `Regime ${regime} adopted (${reasonCode})`;
}

function holdText(
  regime: Regime,
  candidate: Regime | null,
  candidateBars: number,
  dwellBars: number,
): string {
  if (candidate === null) return `Regime ${regime} held; no pending change`;
  return `Regime ${regime} held; candidate ${candidate} ${candidateBars}/${dwellBars}`;
}

function applyHysteresis(
  classified: RawClassification,
  previous: RegimeState | null,
  now: Timestamp,
  settings: RegimeSettings,
): RegimeEvaluation {
  const { rawRegime, rawReason, features } = classified;

  if (previous === null) {
    return {
      state: adoptedState(rawRegime, rawReason, features, now),
      rawRegime,
      changed: true,
      reasonCode: rawReason,
      reasonText: adoptionText(rawRegime, rawReason),
    };
  }

  if (rawRegime === previous.regime) {
    const state = heldState(previous, features, null, 0);
    return {
      state,
      rawRegime,
      changed: false,
      reasonCode: Reason.REGIME_HELD,
      reasonText: holdText(previous.regime, null, 0, settings.regimeDwellBars),
    };
  }

  if (rawRegime === 'CRASH' || rawRegime === 'ILLIQUID') {
    return {
      state: adoptedState(rawRegime, rawReason, features, now),
      rawRegime,
      changed: true,
      reasonCode: rawReason,
      reasonText: adoptionText(rawRegime, rawReason),
    };
  }

  const candidateBars = rawRegime === previous.candidate ? previous.candidateBars + 1 : 1;
  if (candidateBars >= settings.regimeDwellBars) {
    return {
      state: adoptedState(rawRegime, rawReason, features, now),
      rawRegime,
      changed: true,
      reasonCode: rawReason,
      reasonText: adoptionText(rawRegime, rawReason),
    };
  }

  return {
    state: heldState(previous, features, rawRegime, candidateBars),
    rawRegime,
    changed: false,
    reasonCode: Reason.REGIME_HELD,
    reasonText: holdText(previous.regime, rawRegime, candidateBars, settings.regimeDwellBars),
  };
}

/** Computes the log-facing feature snapshot from closed candles. */
export function computeRegimeFeatures(
  candles: readonly Candle[],
  now: Timestamp,
  settings: RegimeSettings,
): RegimeFeatures {
  return toFeatures(computeRawFeatures(candles, now, settings));
}

/** Classifies one token bar and applies regime hysteresis. */
export function classifyRegime(input: RegimeInput): RegimeEvaluation {
  const classified = evaluateRaw(input.candles, input.now, input.settings, input.previous);
  return applyHysteresis(classified, input.previous, input.now, input.settings);
}

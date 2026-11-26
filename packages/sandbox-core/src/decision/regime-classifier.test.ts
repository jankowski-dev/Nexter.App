import { describe, expect, it } from 'vitest';
import { TIMEFRAME_MS, candleCloseTime } from '../timeframes';
import type { Candle, Timestamp } from '../types';
import { DEFAULT_REGIME_SETTINGS, REGIME_RULES_VERSION } from './defaults';
import { makeCandlesFromCloses, makeSeries } from './fixtures.test-helpers';
import { atrPct, drawdownPct, formatPct, formatUsd, sma } from './indicators';
import { Reason } from './reason-codes';
import type { ReasonCode } from './reason-codes';
import { classifyRegime, computeRegimeFeatures } from './regime-classifier';
import type { Regime, RegimeFeatures, RegimeSettings, RegimeState } from './types';

const HOUR = TIMEFRAME_MS['1h'] as number;

const SETTINGS: RegimeSettings = {
  ...DEFAULT_REGIME_SETTINGS,
  fastHours: 3,
  slowHours: 6,
  longHours: 12,
  atrPeriod: 3,
  rangeWindowHours: 4,
  liquidityWindowHours: 3,
  regimeDwellBars: 3,
  recoveryConfirmBars: 3,
};

const REASON_BY_REGIME: Record<Regime, ReasonCode> = {
  TREND_UP: Reason.REGIME_TREND_UP,
  TREND_DOWN: Reason.REGIME_TREND_DOWN,
  RANGE: Reason.REGIME_RANGE,
  CRASH: Reason.REGIME_CRASH,
  RECOVERY: Reason.REGIME_RECOVERY,
  ILLIQUID: Reason.REGIME_UNKNOWN,
  UNKNOWN: Reason.REGIME_UNKNOWN,
};

function emptyFeatures(): RegimeFeatures {
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

function heldState(
  regime: Regime,
  options: {
    since?: Timestamp;
    candidate?: Regime | null;
    candidateBars?: number;
  } = {},
): RegimeState {
  return {
    regime,
    reasonCode: REASON_BY_REGIME[regime],
    candidate: options.candidate ?? null,
    candidateBars: options.candidateBars ?? 0,
    since: options.since ?? 1_000,
    rulesVersion: REGIME_RULES_VERSION,
    features: emptyFeatures(),
  };
}

function closeTimeOf(candles: readonly Candle[]): Timestamp {
  return candleCloseTime(candles[candles.length - 1] as Candle);
}

function classifyAtEnd(
  candles: readonly Candle[],
  previous: RegimeState | null = null,
  settings: RegimeSettings = SETTINGS,
) {
  return classifyRegime({
    tokenId: 'token',
    now: closeTimeOf(candles),
    candles,
    previous,
    settings,
  });
}

function manualCandle(index: number, price: string): Candle {
  return {
    tokenId: 'token',
    timeframe: '1h',
    openTime: Date.UTC(2026, 0, 1) + index * HOUR,
    open: price,
    high: price,
    low: price,
    close: price,
    volumeUsd: '100000',
  };
}

function ohlcCandle(index: number, open: number, high: number, low: number, close: number): Candle {
  return {
    tokenId: 'token',
    timeframe: '1h',
    openTime: Date.UTC(2026, 0, 1) + index * HOUR,
    open: open.toFixed(8),
    high: high.toFixed(8),
    low: low.toFixed(8),
    close: close.toFixed(8),
    volumeUsd: '100000',
  };
}

/** Closes for a 20% crash, then a steady 2%-per-bar recovery. */
function crashThenRecoveryCloses(): number[] {
  const closes: number[] = [];
  let price = 100;
  for (let index = 0; index < 15; index += 1) {
    closes.push(price);
    price *= 1.01;
  }
  for (let index = 0; index < 6; index += 1) {
    price *= 0.95;
    closes.push(price);
  }
  for (let index = 0; index < 14; index += 1) {
    price *= 1.02;
    closes.push(price);
  }
  return closes;
}

/** Rises 1% for 20 bars, then drops 10% on the last bar. */
function contradictoryCloses(): number[] {
  const closes: number[] = [];
  let price = 100;
  for (let index = 0; index < 20; index += 1) {
    closes.push(price);
    price *= 1.01;
  }
  closes.push(price * 0.9);
  return closes;
}

describe('computeRegimeFeatures', () => {
  it('formats log-facing features and counts closed bars', () => {
    const candles = makeSeries({ count: 30, startPrice: 100, stepPct: 0.8 });
    const features = computeRegimeFeatures(candles, closeTimeOf(candles), SETTINGS);
    const closes = candles.map((candle) => Number(candle.close));

    expect(features.bars).toBe(30);
    expect(features.staleBars).toBe(0);
    expect(features.lastClose).toBe(formatUsd(closes[closes.length - 1] as number));
    expect(features.fastSma).toBe(formatUsd(sma(closes, 3) as number));
    expect(features.slowSma).toBe(formatUsd(sma(closes, 6) as number));
    expect(features.longSma).toBe(formatUsd(sma(closes, 12) as number));
    expect(features.atrPct).toBe(formatPct(atrPct(candles, 3) as number));
    expect(features.drawdownPct).toBe(
      formatPct(
        drawdownPct(candles, Math.max(SETTINGS.slowHours, SETTINGS.rangeWindowHours)) as number,
      ),
    );
    expect(features.avgVolumeUsd).toBe('100000.00');
    expect(Number.isInteger(features.bars)).toBe(true);
    expect(Number.isInteger(features.staleBars)).toBe(true);
  });

  it('computes a hand-checked drawdown over the wider window', () => {
    // Last 6 bars (slowHours=6 > rangeWindowHours=4): highs 120, 125, 110, 105,
    // 100, 80.5 with the last close at 80. Drawdown = (125 - 80) / 125 = 36%.
    // The range window (4 bars) only sees highs 110, 105, 100, 80.5.
    const candles = [
      ohlcCandle(0, 100, 101, 99, 100),
      ohlcCandle(1, 100, 120, 99, 100),
      ohlcCandle(2, 100, 125, 99, 100),
      ohlcCandle(3, 100, 110, 99, 100),
      ohlcCandle(4, 100, 105, 99, 100),
      ohlcCandle(5, 100, 100, 99, 100),
      ohlcCandle(6, 100, 80.5, 79.5, 80),
    ];
    const features = computeRegimeFeatures(candles, closeTimeOf(candles), SETTINGS);

    expect(features.recentHigh).toBe('110.00');
    expect(features.drawdownPct).toBe('36.00');
    expect(features.lastClose).toBe('80.00');
    expect(features.fastSma).toBe('93.33');
  });

  it('leaves longSma null when history is shorter than longHours', () => {
    const candles = makeSeries({ count: 8, startPrice: 100, stepPct: 1 });
    const features = computeRegimeFeatures(candles, closeTimeOf(candles), SETTINGS);
    expect(features.bars).toBe(8);
    expect(features.longSma).toBeNull();
    expect(features.fastSma).not.toBeNull();
    expect(features.slowSma).not.toBeNull();
  });

  it('computes stale bars with floor, clamping and an empty-candle fallback', () => {
    const candles = makeSeries({ count: 20, startPrice: 100, stepPct: 1 });
    const lastClose = closeTimeOf(candles);

    expect(computeRegimeFeatures(candles, lastClose, SETTINGS).staleBars).toBe(0);
    expect(computeRegimeFeatures(candles, lastClose - HOUR, SETTINGS).staleBars).toBe(0);
    expect(computeRegimeFeatures(candles, lastClose + 30 * 60_000, SETTINGS).staleBars).toBe(0);
    expect(computeRegimeFeatures(candles, lastClose + HOUR, SETTINGS).staleBars).toBe(1);
    expect(
      computeRegimeFeatures(candles, lastClose + 3 * HOUR + 30 * 60_000, SETTINGS).staleBars,
    ).toBe(3);

    const empty = computeRegimeFeatures([], lastClose, SETTINGS);
    expect(empty).toEqual(emptyFeatures());
  });
});

describe('classifyRegime raw priority', () => {
  it('reports insufficient history before anything else', () => {
    const candles = makeSeries({ count: 3, startPrice: 100, stepPct: 1 });
    const result = classifyAtEnd(candles);

    expect(result.rawRegime).toBe('ILLIQUID');
    expect(result.state.regime).toBe('ILLIQUID');
    expect(result.state.reasonCode).toBe(Reason.REGIME_INSUFFICIENT_HISTORY);
    expect(result.reasonCode).toBe(Reason.REGIME_INSUFFICIENT_HISTORY);
    expect(result.changed).toBe(true);
    expect(result.state.features.bars).toBe(3);
    expect(result.state.features.longSma).toBeNull();
  });

  it('requires the range window in minimum history', () => {
    const settings: RegimeSettings = { ...SETTINGS, rangeWindowHours: 8 };
    // Seven bars satisfy atrPeriod+1, slowHours+1 and liquidityWindowHours,
    // but not the eight-bar range window.
    const candles = makeSeries({ count: 7, startPrice: 100, stepPct: 1 });
    const result = classifyAtEnd(candles, null, settings);

    expect(result.rawRegime).toBe('ILLIQUID');
    expect(result.state.reasonCode).toBe(Reason.REGIME_INSUFFICIENT_HISTORY);
    expect(result.reasonCode).toBe(Reason.REGIME_INSUFFICIENT_HISTORY);
  });

  it('treats one closed bar without a current candle as stale data', () => {
    const candles = makeSeries({ count: 20, startPrice: 100, stepPct: 1 });
    const result = classifyRegime({
      tokenId: 'token',
      now: closeTimeOf(candles) + HOUR,
      candles,
      previous: heldState('TREND_UP'),
      settings: SETTINGS,
    });

    expect(result.rawRegime).toBe('ILLIQUID');
    expect(result.state.regime).toBe('ILLIQUID');
    expect(result.state.reasonCode).toBe(Reason.REGIME_STALE_DATA);
    expect(result.reasonCode).toBe(Reason.REGIME_STALE_DATA);
    expect(result.state.features.staleBars).toBe(1);
    expect(result.changed).toBe(true);
    expect(result.state.since).toBe(closeTimeOf(candles) + HOUR);
  });

  it('treats a candle that closes after now as stale look-ahead data', () => {
    const candles = makeSeries({ count: 20, startPrice: 100, stepPct: 1 });
    const result = classifyRegime({
      tokenId: 'token',
      now: closeTimeOf(candles) - HOUR,
      candles,
      previous: heldState('TREND_UP'),
      settings: SETTINGS,
    });

    expect(result.rawRegime).toBe('ILLIQUID');
    expect(result.state.regime).toBe('ILLIQUID');
    expect(result.state.reasonCode).toBe(Reason.REGIME_STALE_DATA);
    expect(result.reasonCode).toBe(Reason.REGIME_STALE_DATA);
    expect(result.state.features.staleBars).toBe(0);
    expect(result.state.features.lastClose).not.toBeNull();
    expect(result.changed).toBe(true);
  });

  it('flags illiquid volume and adopts it immediately', () => {
    const candles = makeSeries({
      count: 20,
      startPrice: 100,
      stepPct: 1,
      volumeUsd: 10_000,
    });
    const result = classifyAtEnd(candles, heldState('TREND_UP', { since: 500 }));

    expect(result.rawRegime).toBe('ILLIQUID');
    expect(result.state.regime).toBe('ILLIQUID');
    expect(result.state.reasonCode).toBe(Reason.REGIME_LOW_LIQUIDITY);
    expect(result.reasonCode).toBe(Reason.REGIME_LOW_LIQUIDITY);
    expect(result.changed).toBe(true);
    expect(result.state.since).toBe(closeTimeOf(candles));
    expect(result.state.features.avgVolumeUsd).toBe('10000.00');
  });

  it('can bypass the 24h volume gate in execution-liquidity mode', () => {
    const candles = makeSeries({
      count: 30,
      startPrice: 100,
      stepPct: 1,
      volumeUsd: 10_000,
    });
    const volumeGate = classifyAtEnd(candles);
    const executionGate = classifyAtEnd(candles, null, {
      ...SETTINGS,
      liquidityMode: 'execution',
    });
    const ignoredGate = classifyAtEnd(candles, null, {
      ...SETTINGS,
      liquidityMode: 'ignored',
    });

    expect(volumeGate.rawRegime).toBe('ILLIQUID');
    expect(volumeGate.reasonCode).toBe(Reason.REGIME_LOW_LIQUIDITY);
    expect(executionGate.rawRegime).toBe('TREND_UP');
    expect(executionGate.reasonCode).toBe(Reason.REGIME_TREND_UP);
    expect(ignoredGate.rawRegime).toBe('TREND_UP');
    expect(ignoredGate.reasonCode).toBe(Reason.REGIME_TREND_UP);
  });

  it('classifies a strong uptrend as TREND_UP with normal ATR', () => {
    const candles = makeSeries({ count: 30, startPrice: 100, stepPct: 0.8 });
    const result = classifyAtEnd(candles);

    expect(result.rawRegime).toBe('TREND_UP');
    expect(result.state.regime).toBe('TREND_UP');
    expect(result.state.reasonCode).toBe(Reason.REGIME_TREND_UP);
    expect(result.reasonCode).toBe(Reason.REGIME_TREND_UP);
    expect(result.changed).toBe(true);
    expect(result.state.candidate).toBeNull();
    expect(result.state.candidateBars).toBe(0);
    expect(result.state.since).toBe(closeTimeOf(candles));
    expect(result.state.rulesVersion).toBe(REGIME_RULES_VERSION);
  });

  it('classifies a downtrend as TREND_DOWN', () => {
    const candles = makeSeries({ count: 30, startPrice: 100, stepPct: -0.8 });
    const result = classifyAtEnd(candles);

    expect(result.rawRegime).toBe('TREND_DOWN');
    expect(result.state.regime).toBe('TREND_DOWN');
    expect(result.state.reasonCode).toBe(Reason.REGIME_TREND_DOWN);
  });

  it('classifies a flat wave as RANGE', () => {
    const candles = makeSeries({ count: 24, startPrice: 100, stepPct: 0.4, pattern: 'wave' });
    const result = classifyAtEnd(candles.slice(0, 20));

    expect(result.rawRegime).toBe('RANGE');
    expect(result.state.regime).toBe('RANGE');
    expect(result.state.reasonCode).toBe(Reason.REGIME_RANGE);
  });

  it('returns UNKNOWN when no rule matches', () => {
    const candles = makeCandlesFromCloses(contradictoryCloses());
    const result = classifyAtEnd(candles);

    expect(result.rawRegime).toBe('UNKNOWN');
    expect(result.state.regime).toBe('UNKNOWN');
    expect(result.state.reasonCode).toBe(Reason.REGIME_UNKNOWN);
    expect(result.state.features.fastSma).not.toBeNull();
    expect(result.state.features.atrPct).not.toBeNull();
  });

  it('returns UNKNOWN with guarded features instead of dividing by a non-positive price', () => {
    const candles = Array.from({ length: 8 }, (_, index) => manualCandle(index, '0'));
    const result = classifyAtEnd(candles);

    expect(result.rawRegime).toBe('UNKNOWN');
    expect(result.state.regime).toBe('UNKNOWN');
    expect(result.state.reasonCode).toBe(Reason.REGIME_UNKNOWN);
    // The guard still reports how many bars arrived and how stale they are.
    expect(result.state.features).toEqual({ ...emptyFeatures(), bars: 8 });
  });

  it('keeps bars and staleBars in the guarded feature snapshot', () => {
    const candles = Array.from({ length: 8 }, (_, index) => manualCandle(index, '0'));
    const result = classifyRegime({
      tokenId: 'token',
      now: closeTimeOf(candles) + 2 * HOUR,
      candles,
      previous: null,
      settings: SETTINGS,
    });

    expect(result.rawRegime).toBe('UNKNOWN');
    expect(result.state.features.bars).toBe(8);
    expect(result.state.features.staleBars).toBe(2);
    expect(result.state.features.lastClose).toBeNull();
    expect(result.state.features.fastSma).toBeNull();
    expect(result.state.features.atrPct).toBeNull();
  });

  it('keeps a short longSma from blocking classification', () => {
    const candles = makeSeries({ count: 8, startPrice: 100, stepPct: 1 });
    const result = classifyAtEnd(candles);

    expect(result.state.features.longSma).toBeNull();
    expect(result.rawRegime).toBe('TREND_UP');
  });
});

describe('classifyRegime crash and recovery', () => {
  it('adopts CRASH immediately on the first crash bar despite dwell', () => {
    const candles = makeSeries({
      count: 30,
      startPrice: 100,
      stepPct: 1,
      pattern: 'crash-recovery',
    });

    let crashIndex = -1;
    for (let count = 7; count <= candles.length; count += 1) {
      if (classifyAtEnd(candles.slice(0, count)).rawRegime === 'CRASH') {
        crashIndex = count;
        break;
      }
    }
    expect(crashIndex).toBeGreaterThan(7);
    expect(classifyAtEnd(candles.slice(0, crashIndex - 1)).rawRegime).not.toBe('CRASH');

    const prefix = candles.slice(0, crashIndex);
    const result = classifyAtEnd(prefix, heldState('TREND_UP', { since: 500 }));

    expect(result.rawRegime).toBe('CRASH');
    expect(result.state.regime).toBe('CRASH');
    expect(result.state.reasonCode).toBe(Reason.REGIME_CRASH);
    expect(result.reasonCode).toBe(Reason.REGIME_CRASH);
    expect(result.changed).toBe(true);
    expect(result.state.candidate).toBeNull();
    expect(result.state.candidateBars).toBe(0);
    expect(result.state.since).toBe(closeTimeOf(prefix));
  });

  it('measures crash drawdown over max(slowHours, rangeWindowHours)', () => {
    // SETTINGS has slowHours=6 and rangeWindowHours=4. The 150 spike sits
    // inside the six-bar drawdown window but outside the four-bar range window.
    const candles = makeCandlesFromCloses([100, 100, 150, 100, 100, 100, 100, 100]);
    const features = computeRegimeFeatures(candles, closeTimeOf(candles), SETTINGS);
    expect(features.recentHigh).toBe('100.10');
    expect(features.drawdownPct).toBe('33.40');

    const result = classifyAtEnd(candles);
    expect(result.rawRegime).toBe('CRASH');
    expect(result.state.regime).toBe('CRASH');
    expect(result.state.reasonCode).toBe(Reason.REGIME_CRASH);
    expect(result.state.features.drawdownPct).toBe('33.40');
  });

  it('needs recovery confirmation and dwell before leaving CRASH', () => {
    const candles = makeCandlesFromCloses(crashThenRecoveryCloses());
    const results = new Map<number, ReturnType<typeof classifyAtEnd>>();
    let state = heldState('CRASH', { since: 500 });

    // The fixture is 15 up bars + 6 crash bars, so prefix 21 is the trough.
    // Start at the trough: earlier up bars would legitimately look like a
    // recovery from the pre-supplied CRASH state.
    for (let count = 21; count <= candles.length; count += 1) {
      const result = classifyAtEnd(candles.slice(0, count), state);
      results.set(count, result);
      state = result.state;
    }

    const entries = [...results.entries()];
    const firstRawRecovery = entries.find(([, result]) => result.rawRegime === 'RECOVERY')?.[0];
    expect(firstRawRecovery).toBe(26);
    for (const [count, result] of entries) {
      if (count < 26) expect(result.rawRegime).not.toBe('RECOVERY');
    }

    const stillCrashing = results.get(25);
    expect(stillCrashing?.rawRegime).toBe('TREND_UP');
    expect(stillCrashing?.state.regime).toBe('CRASH');

    const atFirstRecovery = results.get(26);
    expect(atFirstRecovery?.state.regime).toBe('CRASH');
    expect(atFirstRecovery?.state.candidate).toBe('RECOVERY');
    expect(atFirstRecovery?.state.candidateBars).toBe(1);
    expect(atFirstRecovery?.reasonCode).toBe(Reason.REGIME_HELD);
    expect(atFirstRecovery?.changed).toBe(false);

    expect(results.get(27)?.state.candidate).toBe('RECOVERY');
    expect(results.get(27)?.state.candidateBars).toBe(2);
    expect(results.get(27)?.state.regime).toBe('CRASH');

    const adopted = results.get(28);
    expect(adopted?.rawRegime).toBe('RECOVERY');
    expect(adopted?.state.regime).toBe('RECOVERY');
    expect(adopted?.state.reasonCode).toBe(Reason.REGIME_RECOVERY);
    expect(adopted?.reasonCode).toBe(Reason.REGIME_RECOVERY);
    expect(adopted?.changed).toBe(true);
    expect(adopted?.state.candidate).toBeNull();
    expect(adopted?.state.candidateBars).toBe(0);
    expect(adopted?.state.since).toBe(closeTimeOf(candles.slice(0, 28)));
  });

  it('requires a prior CRASH or TREND_DOWN regime for RECOVERY', () => {
    const candles = makeCandlesFromCloses(crashThenRecoveryCloses());
    const prefix = candles.slice(0, 26);

    const afterCrash = classifyAtEnd(prefix, heldState('CRASH', { since: 500 }));
    const afterTrendUp = classifyAtEnd(prefix, heldState('TREND_UP', { since: 500 }));

    expect(afterCrash.rawRegime).toBe('RECOVERY');
    expect(afterTrendUp.rawRegime).toBe('TREND_UP');
  });
});

describe('classifyRegime hysteresis', () => {
  it('holds TREND_UP for two range-like bars and adopts RANGE on the third', () => {
    const series = makeSeries({ count: 24, startPrice: 100, stepPct: 0.4, pattern: 'wave' });
    const previous = heldState('TREND_UP', { since: 500 });

    const first = classifyAtEnd(series.slice(0, 20), previous);
    expect(first.rawRegime).toBe('RANGE');
    expect(first.state.regime).toBe('TREND_UP');
    expect(first.state.reasonCode).toBe(Reason.REGIME_TREND_UP);
    expect(first.state.candidate).toBe('RANGE');
    expect(first.state.candidateBars).toBe(1);
    expect(first.state.since).toBe(500);
    expect(first.changed).toBe(false);
    expect(first.reasonCode).toBe(Reason.REGIME_HELD);
    expect(first.reasonText).toContain('RANGE');
    expect(first.reasonText).toContain('1/3');

    const second = classifyAtEnd(series.slice(0, 21), first.state);
    expect(second.rawRegime).toBe('RANGE');
    expect(second.state.regime).toBe('TREND_UP');
    expect(second.state.candidate).toBe('RANGE');
    expect(second.state.candidateBars).toBe(2);
    expect(second.state.since).toBe(500);
    expect(second.changed).toBe(false);
    expect(second.reasonText).toContain('2/3');

    const third = classifyAtEnd(series.slice(0, 22), second.state);
    expect(third.rawRegime).toBe('RANGE');
    expect(third.state.regime).toBe('RANGE');
    expect(third.state.reasonCode).toBe(Reason.REGIME_RANGE);
    expect(third.state.candidate).toBeNull();
    expect(third.state.candidateBars).toBe(0);
    expect(third.state.since).toBe(closeTimeOf(series.slice(0, 22)));
    expect(third.changed).toBe(true);
    expect(third.reasonCode).toBe(Reason.REGIME_RANGE);
  });

  it('clears a candidate when the raw regime returns to the held regime', () => {
    const candles = makeSeries({ count: 30, startPrice: 100, stepPct: 0.8 });
    const previous = heldState('TREND_UP', {
      since: 500,
      candidate: 'RANGE',
      candidateBars: 2,
    });

    const result = classifyAtEnd(candles, previous);
    expect(result.rawRegime).toBe('TREND_UP');
    expect(result.state.regime).toBe('TREND_UP');
    expect(result.state.candidate).toBeNull();
    expect(result.state.candidateBars).toBe(0);
    expect(result.state.since).toBe(500);
    expect(result.changed).toBe(false);
    expect(result.reasonCode).toBe(Reason.REGIME_HELD);
  });

  it('replaces a different pending candidate with count 1', () => {
    const series = makeSeries({ count: 24, startPrice: 100, stepPct: 0.4, pattern: 'wave' });
    const previous = heldState('TREND_UP', {
      since: 500,
      candidate: 'TREND_DOWN',
      candidateBars: 2,
    });

    const result = classifyAtEnd(series.slice(0, 20), previous);
    expect(result.rawRegime).toBe('RANGE');
    expect(result.state.candidate).toBe('RANGE');
    expect(result.state.candidateBars).toBe(1);
    expect(result.state.regime).toBe('TREND_UP');
  });

  it('adopts a non-crash change immediately when dwell is one bar', () => {
    const series = makeSeries({ count: 24, startPrice: 100, stepPct: 0.4, pattern: 'wave' });
    const settings: RegimeSettings = { ...SETTINGS, regimeDwellBars: 1 };
    const result = classifyAtEnd(
      series.slice(0, 20),
      heldState('TREND_UP', { since: 500 }),
      settings,
    );

    expect(result.rawRegime).toBe('RANGE');
    expect(result.state.regime).toBe('RANGE');
    expect(result.changed).toBe(true);
    expect(result.state.since).toBe(closeTimeOf(series.slice(0, 20)));
  });

  it('is deterministic for identical input', () => {
    const candles = makeSeries({ count: 30, startPrice: 100, stepPct: 0.8 });
    const first = classifyAtEnd(candles);
    const second = classifyAtEnd(candles);
    expect(second).toEqual(first);

    const featuresA = computeRegimeFeatures(candles, closeTimeOf(candles), SETTINGS);
    const featuresB = computeRegimeFeatures(candles, closeTimeOf(candles), SETTINGS);
    expect(featuresB).toEqual(featuresA);
  });

  it('marks the first classification as changed', () => {
    const candles = makeSeries({ count: 30, startPrice: 100, stepPct: 0.8 });
    const result = classifyAtEnd(candles, null);
    expect(result.changed).toBe(true);
    expect(result.reasonText.length).toBeGreaterThan(0);
  });
});

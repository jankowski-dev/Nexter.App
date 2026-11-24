import { describe, expect, it } from 'vitest';
import {
  buildReplayCoverage,
  replayWindow,
  SANDBOX_REPLAY_MIN_PARTIAL_BARS,
  type SandboxReplayCandleStats,
  type SandboxReplayWindowStats,
} from './sandbox-replay.coverage';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const TO = Date.UTC(2026, 0, 10);
const TOKEN_A = 'bsc:0x1111111111111111111111111111111111111111';
const TOKEN_B = 'bsc:0x2222222222222222222222222222222222222222';

function stats(
  available: number,
  firstOpenTime: Date | null = null,
  lastOpenTime: Date | null = null,
  syntheticCandles = 0,
): SandboxReplayCandleStats {
  return { available, firstOpenTime, lastOpenTime, syntheticCandles };
}

function entry(
  tokenKey: string,
  latestClosedOpenTime: Date | null,
  requested: SandboxReplayCandleStats,
  requestedPrefix = stats(0),
  partial?: SandboxReplayCandleStats,
  partialPrefix?: SandboxReplayCandleStats,
): SandboxReplayWindowStats {
  return {
    tokenKey,
    latestClosedOpenTime,
    firstOpenTime: requested.firstOpenTime,
    lastOpenTime: requested.lastOpenTime,
    requested,
    requestedPrefix,
    partial,
    partialPrefix,
  };
}

function windowMap(...entries: SandboxReplayWindowStats[]): Map<string, SandboxReplayWindowStats> {
  return new Map(entries.map((value) => [value.tokenKey, value]));
}

describe('replayWindow', () => {
  it('ends at the earliest latest closed candle across the selected tokens', () => {
    const latestA = new Date(TO - HOUR);
    const latestB = new Date(TO - 2 * HOUR);
    const toTime = new Date(latestB.getTime() + HOUR);
    const requestedFrom = new Date(toTime.getTime() - 30 * DAY);

    const result = replayWindow(
      windowMap(
        entry(
          TOKEN_A,
          latestA,
          stats(720, requestedFrom, new Date(toTime.getTime() - HOUR)),
          stats(100),
        ),
        entry(
          TOKEN_B,
          latestB,
          stats(720, requestedFrom, new Date(toTime.getTime() - HOUR)),
          stats(100),
        ),
      ),
      30,
      false,
      new Date(TO + HOUR),
    );

    expect(result.toTime.getTime()).toBe(toTime.getTime());
    expect(result.fromTime.getTime()).toBe(requestedFrom.getTime());
    expect(result.requestedFromTime.getTime()).toBe(requestedFrom.getTime());
    expect(result.evaluationBars).toBe(720);
    expect(result.status).toBe('ok');
    expect(result.shortened).toBe(false);
    expect(result.coverage).toHaveLength(2);
    expect(result.coverage.every((token) => token.status === 'ok')).toBe(true);
  });

  it('reports the evaluation window bars, gaps and prefix bars', () => {
    const toTime = new Date(TO);
    const requestedFrom = new Date(toTime.getTime() - 30 * DAY);
    const result = replayWindow(
      windowMap(
        entry(
          TOKEN_A,
          new Date(TO - HOUR),
          stats(700, new Date(requestedFrom.getTime() + 20 * HOUR), new Date(TO - HOUR)),
          stats(100),
        ),
      ),
      30,
      false,
      new Date(TO + HOUR),
    );

    expect(result.status).toBe('partial');
    const [coverage] = result.coverage;
    expect(coverage).toMatchObject({
      tokenKey: TOKEN_A,
      fromTime: requestedFrom.toISOString(),
      toTime: toTime.toISOString(),
      available: 700,
      required: 720,
      gaps: 20,
      prefixBars: 100,
      status: 'partial',
    });
  });

  it('moves from_time to the earliest commonly available candle when allowPartial is accepted', () => {
    const toTime = new Date(TO);
    const requestedFrom = new Date(toTime.getTime() - 30 * DAY);
    const movedFrom = new Date(requestedFrom.getTime() + 240 * HOUR);

    const result = replayWindow(
      windowMap(
        entry(
          TOKEN_A,
          new Date(TO - HOUR),
          stats(480, movedFrom, new Date(TO - HOUR)),
          stats(100),
          stats(480, movedFrom, new Date(TO - HOUR)),
          stats(340),
        ),
      ),
      30,
      true,
      new Date(TO + HOUR),
    );

    expect(result.shortened).toBe(true);
    expect(result.fromTime.getTime()).toBe(movedFrom.getTime());
    expect(result.toTime.getTime()).toBe(toTime.getTime());
    expect(result.evaluationBars).toBe(480);
    expect(result.status).toBe('partial');
    expect(result.coverage[0]).toMatchObject({
      fromTime: movedFrom.toISOString(),
      available: 480,
      required: 480,
      gaps: 0,
      prefixBars: 340,
      status: 'ok',
    });
    expect(result.warnings.some((warning) => warning.includes('сокращено'))).toBe(true);
  });

  it('does not move from_time without allowPartial', () => {
    const toTime = new Date(TO);
    const requestedFrom = new Date(toTime.getTime() - 30 * DAY);
    const movedFrom = new Date(requestedFrom.getTime() + 240 * HOUR);

    const result = replayWindow(
      windowMap(
        entry(
          TOKEN_A,
          new Date(TO - HOUR),
          stats(480, movedFrom, new Date(TO - HOUR)),
          stats(100),
          stats(480, movedFrom, new Date(TO - HOUR)),
          stats(340),
        ),
      ),
      30,
      false,
      new Date(TO + HOUR),
    );

    expect(result.shortened).toBe(false);
    expect(result.fromTime.getTime()).toBe(requestedFrom.getTime());
    expect(result.evaluationBars).toBe(720);
    expect(result.status).toBe('partial');
    expect(result.coverage[0]?.gaps).toBe(240);
  });

  it('requires at least 240 evaluation bars for a shortened window', () => {
    const toTime = new Date(TO);
    const requestedFrom = new Date(toTime.getTime() - 30 * DAY);
    const movedFrom = new Date(requestedFrom.getTime() + 600 * HOUR);

    const result = replayWindow(
      windowMap(
        entry(
          TOKEN_A,
          new Date(TO - HOUR),
          stats(120, movedFrom, new Date(TO - HOUR)),
          stats(0),
          stats(120, movedFrom, new Date(TO - HOUR)),
          stats(600),
        ),
      ),
      30,
      true,
      new Date(TO + HOUR),
    );

    expect(result.evaluationBars).toBe(120);
    expect(result.evaluationBars).toBeLessThan(SANDBOX_REPLAY_MIN_PARTIAL_BARS);
    expect(result.warnings.some((warning) => warning.includes('240'))).toBe(true);
  });

  it('blocks a window with no candles', () => {
    const toTime = new Date(TO);
    const requestedFrom = new Date(toTime.getTime() - 30 * DAY);
    const result = replayWindow(
      windowMap(entry(TOKEN_A, new Date(TO - HOUR), stats(0), stats(0))),
      30,
      true,
      new Date(TO + HOUR),
    );

    expect(result.fromTime.getTime()).toBe(requestedFrom.getTime());
    expect(result.status).toBe('missing');
    expect(result.coverage[0]?.status).toBe('missing');
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it('blocks a token without a closed candle', () => {
    const toTime = new Date(TO);
    const requestedFrom = new Date(toTime.getTime() - 30 * DAY);
    const result = replayWindow(
      windowMap(entry(TOKEN_A, null, stats(720, requestedFrom, new Date(TO - HOUR)), stats(100))),
      30,
      false,
      new Date(TO + HOUR),
    );

    expect(result.status).toBe('missing');
    expect(result.warnings.some((warning) => warning.includes(TOKEN_A))).toBe(true);
  });
});

describe('buildReplayCoverage', () => {
  it('marks a complete window ok and flags synthetic and stale data', () => {
    const toTime = new Date(TO);
    const fromTime = new Date(toTime.getTime() - 30 * DAY);
    const coverage = buildReplayCoverage(
      TOKEN_A,
      stats(720, fromTime, new Date(TO - HOUR), 720),
      fromTime,
      toTime,
      stats(100),
      new Date(TO + 2 * HOUR),
    );

    expect(coverage).toMatchObject({
      tokenKey: TOKEN_A,
      available: 720,
      required: 720,
      gaps: 0,
      prefixBars: 100,
      synthetic: true,
      stale: true,
      status: 'ok',
    });
    expect(coverage.warning).toContain('synthetic');
    expect(coverage.warning).toContain('старше');
  });

  it('caps the available count at the required window size', () => {
    const toTime = new Date(TO);
    const fromTime = new Date(toTime.getTime() - 30 * DAY);
    const coverage = buildReplayCoverage(
      TOKEN_A,
      stats(900, fromTime, new Date(TO - HOUR)),
      fromTime,
      toTime,
      stats(0),
      new Date(TO + HOUR),
    );

    expect(coverage.available).toBe(720);
    expect(coverage.gaps).toBe(0);
    expect(coverage.status).toBe('ok');
  });
});

import Decimal from 'decimal.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { snapshotCandles } from '../data/snapshot';
import { DecisionEngine } from '../decision/decision-engine';
import { DEFAULT_SETTINGS } from '../decision/defaults';
import type { DecisionInput, DecisionResult } from '../decision/types';
import { TIMEFRAME_MS } from '../timeframes';
import type { Candle } from '../types';
import { DEFAULT_PAPER_SETTINGS, paperConfigVersion } from './defaults';
import { makeCandles, makeIntent } from './fixtures.test-helpers';
import { runPaperFromCandles } from './run-paper';
import type { PaperRunConfig, RunPaperFromCandlesInput } from './types';

/**
 * Tests for the reusable candle-driven report pipeline.
 *
 * These cover the extraction contract (`PaperRunner` + marks + metrics +
 * counterfactuals + report), the optional `evaluateFrom` historical boundary and
 * the no-look-ahead guarantee. The 180-day golden test still drives the same
 * pipeline through the CLI, so the Stage 1C hashes stay pinned.
 */

const HOUR = TIMEFRAME_MS['1h'] as number;
const T0 = Date.UTC(2026, 0, 1);

function closes(count: number): number[] {
  return Array.from({ length: count }, (_, index) => 1 + index * 0.002);
}

/** 200 rising bars, one 4.5% pullback bar, then a slow slide: trades before bar 240. */
function trendingCloses(count: number): number[] {
  const values: number[] = [];
  let price = 1;
  for (let index = 0; index < Math.min(200, count); index += 1) {
    values.push(price);
    price *= 1.002;
  }
  if (count > 200) {
    price *= 0.955;
    values.push(price);
  }
  while (values.length < count) {
    price *= 0.998;
    values.push(price);
  }
  return values;
}

function helperInput(
  candles: readonly Candle[],
  overrides: Partial<RunPaperFromCandlesInput> = {},
): RunPaperFromCandlesInput {
  const snapshot = snapshotCandles(candles);
  const tokenIds = [...new Set(snapshot.candles.map((candle) => candle.tokenId))].sort(
    (left, right) => (left < right ? -1 : left > right ? 1 : 0),
  );
  const paper = { ...DEFAULT_PAPER_SETTINGS, ...(overrides.paper ?? {}) };
  const config: PaperRunConfig = {
    runId: 'run-paper',
    seed: 7,
    timeframe: '1h',
    tokenIds,
    initialCapitalUsd: '1000.00',
    ...paper,
  };
  return {
    runId: config.runId,
    seed: config.seed,
    configVersion: paperConfigVersion(config),
    dataSnapshotId: snapshot.id,
    tokenIds,
    candles: snapshot.candles,
    settings: DEFAULT_SETTINGS,
    paper,
    initialCapitalUsd: config.initialCapitalUsd,
    ...overrides,
  };
}

describe('runPaperFromCandles', () => {
  it('builds a deterministic, reconciled report with the matching event journal', async () => {
    const input = helperInput(makeCandles(closes(240), { start: T0 }));

    const first = await runPaperFromCandles(input);
    const second = await runPaperFromCandles(input);

    expect(first.report.reportHash).toBe(second.report.reportHash);
    expect(first.report.eventHash).toBe(second.report.eventHash);
    expect(first.report.reconciliationOk).toBe(true);
    expect(first.report.period).toEqual({
      firstBar: T0 + HOUR,
      lastBar: T0 + 240 * HOUR,
      bars: 240,
      tokens: ['token'],
    });
    expect(first.report.dataSnapshotId).toBe(input.dataSnapshotId);
    expect(first.report.configVersion).toBe(input.configVersion);
    expect(first.report.eventCount).toBe(first.events.length);
    expect(first.report.eventHash).toBe(first.events.at(-1)?.hash);
    expect(first.result.eventCount).toBe(first.events.length);
    expect(first.result.eventHash).toBe(first.report.eventHash);
  });

  it('starts the report period at evaluateFrom and keeps the prefix as lookback', async () => {
    const input = helperInput(makeCandles(closes(300), { start: T0 }), {
      evaluateFrom: T0 + 100 * HOUR,
    });

    const { report, result } = await runPaperFromCandles(input);

    expect(report.period.firstBar).toBe(T0 + 101 * HOUR);
    expect(report.period.lastBar).toBe(T0 + 300 * HOUR);
    expect(report.period.bars).toBe(200);
    expect(report.equityCurve).toHaveLength(200);
    expect(result.equityCurve[0]?.clockTime).toBe(T0 + 101 * HOUR);
    // Prefix candles are history for the market view, never a ledger row.
    expect(result.ledger.entries.every((entry) => entry.clockTime >= T0 + 101 * HOUR)).toBe(true);
  });

  it('does not let candles after a bar change the decisions recorded before it', async () => {
    const base = makeCandles(trendingCloses(300), { start: T0 });
    const boundary = T0 + 240 * HOUR;
    const multiplier = new Decimal('1.5');
    const mutated = base.map((candle) =>
      candle.openTime >= boundary
        ? {
            ...candle,
            open: new Decimal(candle.open).times(multiplier).toFixed(8),
            high: new Decimal(candle.high).times(multiplier).toFixed(8),
            low: new Decimal(candle.low).times(multiplier).toFixed(8),
            close: new Decimal(candle.close).times(multiplier).toFixed(8),
          }
        : candle,
    );
    const input = helperInput(base);
    const changedSnapshot = snapshotCandles(mutated);

    const a = await runPaperFromCandles(input);
    const b = await runPaperFromCandles({
      ...input,
      candles: changedSnapshot.candles,
      dataSnapshotId: changedSnapshot.id,
    });

    // The scenario does trade before the mutation, so this is not vacuous.
    expect(a.result.ledger.entries.some((entry) => entry.clockTime < boundary)).toBe(true);

    expect(a.report.equityCurve.filter((point) => point.clockTime <= boundary)).toEqual(
      b.report.equityCurve.filter((point) => point.clockTime <= boundary),
    );
    expect(a.report.intentJournal.filter((intent) => intent.decisionTime < boundary)).toEqual(
      b.report.intentJournal.filter((intent) => intent.decisionTime < boundary),
    );
    expect(b.report.period.firstBar).toBe(a.report.period.firstBar);
    // The mutation did reach the run, otherwise the prefix comparison proves nothing.
    expect(b.report.equityCurve.at(-1)?.equityUsd).not.toBe(a.report.equityCurve.at(-1)?.equityUsd);
  });

  it('rejects an evaluateFrom with no bar at or after it', async () => {
    const input = helperInput(makeCandles(closes(30), { start: T0 }), {
      evaluateFrom: T0 + 10_000 * HOUR,
    });

    await expect(runPaperFromCandles(input)).rejects.toMatchObject({
      name: 'PaperRunError',
      code: 'PAPER_EVALUATE_FROM_OUT_OF_RANGE',
    });
  });
});

describe('runPaperFromCandles final marks', () => {
  afterEach(() => vi.restoreAllMocks());

  it('marks an open position at the last evaluated bar close', async () => {
    vi.spyOn(DecisionEngine.prototype, 'decide').mockImplementation(
      async (input: DecisionInput): Promise<DecisionResult> => ({
        clockTime: input.clockTime,
        intents:
          input.clockTime === T0 + HOUR
            ? [makeIntent({ clockTime: T0 + HOUR, decisionPriceUsd: '1.00000000' })]
            : [],
        tokenViews: [],
        state: { tokens: {} },
        eventCount: 0,
        eventHash: '',
      }),
    );

    const candles = makeCandles([1, 1.1, 1.2, 1.3], { start: T0 });
    const { report } = await runPaperFromCandles(helperInput(candles, { evaluateFrom: T0 }));

    expect(report.period.firstBar).toBe(T0 + HOUR);
    expect(report.positions).toHaveLength(1);
    const position = report.positions[0];
    expect(position?.tokenId).toBe('token');
    // The last evaluated bar closes at 1.3; the mark is that close.
    expect(position?.marketPriceUsd).toBe('1.30000000');
    expect(report.trades).toHaveLength(1);
    expect(report.trades[0]?.status).toBe('open');
    expect(report.reconciliationOk).toBe(true);
    expect(
      new Decimal(report.metrics.finalEquityUsd).equals(
        new Decimal(report.metrics.finalCashUsd).plus(report.metrics.finalPositionsValueUsd),
      ),
    ).toBe(true);
    expect(new Decimal(report.metrics.unrealizedPnlUsd).greaterThan(0)).toBe(true);
  });
});

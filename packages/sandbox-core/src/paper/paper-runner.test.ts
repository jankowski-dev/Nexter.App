import Decimal from 'decimal.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ClockedMarketView } from '../data/market-view';
import { DecisionEngine } from '../decision/decision-engine';
import { DEFAULT_SETTINGS } from '../decision/defaults';
import type { DecisionInput, DecisionResult, OrderIntent } from '../decision/types';
import { MemoryEventLog } from '../events/memory-event-log';
import type { SandboxEvent } from '../events/event-types';
import { TIMEFRAME_MS } from '../timeframes';
import type { Candle, Timestamp } from '../types';
import { DEFAULT_PAPER_SETTINGS } from './defaults';
import { HOUR_MS, PaperRunError, PaperRunner } from './paper-runner';
import type { IntentRecord, PaperRunInput, PaperRunResult, PaperRunSettings } from './types';

const HOUR = TIMEFRAME_MS['1h'] as number;
const START = Date.UTC(2026, 0, 1);
const PULLBACK_CLOSE_INDEX = 200;

interface SeriesOptions {
  readonly tokenId?: string;
  readonly start?: number;
  readonly gapIndex?: number;
  readonly gapPct?: number;
  readonly volumeUsd?: string;
}

/**
 * Builds one candle per close. A gap at `gapIndex` lifts that bar's open above
 * the previous close, so a fill at the next open is distinguishable from the
 * decision close by price as well as by timing.
 */
function buildCandles(closes: readonly number[], options: SeriesOptions = {}): Candle[] {
  const tokenId = options.tokenId ?? 'token';
  const start = options.start ?? START;
  const gapIndex = options.gapIndex ?? -1;
  const gapPct = options.gapPct ?? 0;
  const volumeUsd = options.volumeUsd ?? '100000';
  let previousClose: number | null = null;
  return closes.map((close, index) => {
    let open = previousClose === null ? close : previousClose;
    if (index === gapIndex && previousClose !== null) {
      open = previousClose * (1 + gapPct / 100);
    }
    previousClose = close;
    return {
      tokenId,
      timeframe: '1h',
      openTime: start + index * HOUR,
      open: open.toFixed(8),
      high: (Math.max(open, close) * 1.001).toFixed(8),
      low: (Math.min(open, close) * 0.999).toFixed(8),
      close: close.toFixed(8),
      volumeUsd,
    };
  });
}

/** A steady uptrend, one 4.5% pullback bar, one 1.5% down bar, then a 0.2%/bar drift. */
function trendCloses(driftBars = 34): number[] {
  const closes: number[] = [];
  let price = 1;
  for (let index = 0; index < 200; index += 1) {
    closes.push(price);
    price *= 1.002;
  }
  closes.push(price * 0.955);
  let crash = price * 0.955 * 0.985;
  closes.push(crash);
  for (let index = 0; index < driftBars; index += 1) {
    crash *= 0.998;
    closes.push(crash);
  }
  return closes;
}

/** Uptrend + pullback, then a flat price at the pullback level (day-reset fixture). */
function flatAfterCrashCloses(flatBars = 21): number[] {
  const closes: number[] = [];
  let price = 1;
  for (let index = 0; index < 200; index += 1) {
    closes.push(price);
    price *= 1.002;
  }
  closes.push(price * 0.955);
  const low = price * 0.955 * 0.94;
  closes.push(low);
  for (let index = 0; index < flatBars; index += 1) closes.push(low);
  return closes;
}

/** A steady riser with no pullback; used as a quiet second token. */
function steadyCloses(count: number): number[] {
  return Array.from({ length: count }, (_, index) => 1 + index * 0.002);
}

function trendCandles(): Candle[] {
  return buildCandles(trendCloses(), { gapIndex: 201, gapPct: 0.5 });
}

interface RunOptions {
  readonly tokenIds?: readonly string[];
  readonly candles?: readonly Candle[];
  readonly settings?: Partial<typeof DEFAULT_SETTINGS>;
  readonly paper?: Partial<PaperRunSettings>;
  readonly initialCapitalUsd?: string;
  readonly initialState?: PaperRunInput['initialState'];
}

async function runTrend(options: RunOptions = {}): Promise<{
  readonly log: MemoryEventLog;
  readonly result: PaperRunResult;
  readonly input: PaperRunInput;
  readonly candles: readonly Candle[];
}> {
  const candles = options.candles ?? trendCandles();
  const log = new MemoryEventLog();
  const input: PaperRunInput = {
    runId: 'run-1',
    seed: 7,
    configVersion: 'config-1',
    dataSnapshotId: 'snapshot-1',
    tokenIds: options.tokenIds ?? ['token'],
    candles,
    settings: { ...DEFAULT_SETTINGS, ...options.settings },
    paper: { ...DEFAULT_PAPER_SETTINGS, ...options.paper },
    ...(options.initialCapitalUsd === undefined
      ? {}
      : { initialCapitalUsd: options.initialCapitalUsd }),
    ...(options.initialState === undefined ? {} : { initialState: options.initialState }),
  };
  const result = await new PaperRunner(log).run(input);
  return { log, result, input, candles };
}

function eventsOfType(log: MemoryEventLog, eventType: string): SandboxEvent[] {
  return log.events().filter((event) => event.eventType === eventType);
}

function candleAt(candles: readonly Candle[], openTime: Timestamp): Candle {
  const candle = candles.find((candidate) => candidate.openTime === openTime);
  if (candle === undefined) throw new Error(`no candle opens at ${openTime}`);
  return candle;
}

function firstRecord(result: PaperRunResult, side: 'buy' | 'sell'): IntentRecord {
  const record = result.intents.find((intent) => intent.side === side);
  if (record === undefined) throw new Error(`no ${side} intent record`);
  return record;
}

function iso(timestamp: Timestamp): string {
  return new Date(timestamp).toISOString();
}

describe('PaperRunner next-open fills', () => {
  it('fills a decided buy at the next bar open with slippage, not at the decision close', async () => {
    const { result, candles } = await runTrend();
    const buy = firstRecord(result, 'buy');

    expect(buy.status).toBe('filled');
    expect(buy.strategyReasonCode).toBe('TREND_PULLBACK_ENTRY');
    expect(buy.filledUsd).toBe('200.00');
    expect(buy.feeUsd).toBe('0.50');
    expect(buy.fillTime).toBe(buy.decisionTime);

    const fillCandle = candleAt(candles, buy.fillTime as Timestamp);
    const expectedPrice = new Decimal(fillCandle.open).times(1.001).toFixed(8);
    expect(buy.priceUsd).toBe(expectedPrice);

    // The decision close is the previous bar's close; the gap makes sure the
    // fill price cannot be a rounded version of the decision close.
    const decisionCandle = candleAt(candles, (buy.fillTime as Timestamp) - HOUR);
    const decisionClose = new Decimal(decisionCandle.close);
    expect(new Decimal(buy.priceUsd as string).equals(decisionClose.times(1.001))).toBe(false);

    expect(result.ledger.entries).toHaveLength(4);
    const entry = result.ledger.entries.find((candidate) => candidate.intentId === buy.intentId);
    expect(entry).toMatchObject({
      side: 'buy',
      intentId: buy.intentId,
      clockTime: buy.fillTime,
      priceUsd: buy.priceUsd,
      notionalUsd: '200.00',
      feeUsd: '0.50',
      cashAfterUsd: '799.50',
    });
  });

  it('looks ahead only one bar: the decision bar close is not used as a fill price', async () => {
    const { result, candles } = await runTrend();
    const buy = firstRecord(result, 'buy');
    const fillCandle = candleAt(candles, buy.fillTime as Timestamp);

    expect(fillCandle.openTime).toBe(buy.fillTime);
    expect(fillCandle.close).not.toBe(fillCandle.open);
    expect(buy.priceUsd).not.toBe(new Decimal(fillCandle.close).times(1.001).toFixed(8));
  });

  it('fills before the next decision so the engine sees the new position and cash', async () => {
    const { result, log } = await runTrend();
    const buy = firstRecord(result, 'buy');
    const cycles = eventsOfType(log, 'decision.cycle');
    const decisionBeforeFill = cycles.find((event) => event.clockTime === iso(buy.decisionTime));
    const decisionAfterFill = cycles.find(
      (event) => event.clockTime === iso((buy.fillTime as Timestamp) + HOUR),
    );

    expect(decisionBeforeFill?.inputs).toMatchObject({
      cashUsd: '1000.00',
      openPositions: [],
    });
    expect(decisionAfterFill?.inputs).toMatchObject({
      cashUsd: '799.50',
      openPositions: ['token'],
    });
    const buyEntry = result.ledger.entries.find((entry) => entry.intentId === buy.intentId);
    expect(buyEntry?.positionAmountAfter).toMatch(/^\d+\.\d{8}$/);
    expect(new Decimal(buyEntry?.positionAmountAfter ?? '0').greaterThan(0)).toBe(true);
  });

  it('books a sell fill at the next open, closes the trade and records realised P&L', async () => {
    const { result } = await runTrend();
    const buy = firstRecord(result, 'buy');
    const sell = firstRecord(result, 'sell');

    expect(sell.status).toBe('filled');
    expect(sell.strategyReasonCode).toBe('TREND_PULLBACK_STOP');
    expect(sell.fillTime).toBe(sell.decisionTime);
    expect(sell.filledAmount).toBe(buy.filledAmount);

    const entries = result.ledger.entries;
    expect(entries).toHaveLength(4);
    const sellEntry = entries.find(
      (entry) => entry.side === 'sell' && entry.intentId === sell.intentId,
    );
    expect(sellEntry).toMatchObject({
      side: 'sell',
      intentId: sell.intentId,
      clockTime: sell.fillTime,
      notionalUsd: sell.filledUsd,
      feeUsd: sell.feeUsd,
      positionAmountAfter: '0.00000000',
    });
    const trade = result.ledger.closedTrades.find(
      (candidate) => candidate.entryIntentId === buy.intentId,
    );
    if (trade === undefined) throw new Error('expected the first trade to be closed');
    expect(trade.exitIntentId).toBe(sell.intentId);
    expect(trade.exitReasonCode).toBe('TREND_PULLBACK_STOP');
    expect(new Decimal(trade.realizedPnlUsd).isNegative()).toBe(true);
    expect(result.ledger.positions).toEqual({});
    expect(result.ledger.openTrades).toEqual({});
  });
});

describe('PaperRunner partial fills', () => {
  it('books a liquidity-capped partial buy once and never retries the remainder', async () => {
    const candles = trendCandles().map((candle, index) =>
      index === 201 ? { ...candle, volumeUsd: '15000' } : candle,
    );
    const { result, log } = await runTrend({ candles });
    const buy = firstRecord(result, 'buy');

    expect(buy.status).toBe('partial');
    expect(buy.filledUsd).toBe('150.00');
    expect(buy.feeUsd).toBe('0.38');
    const entries = result.ledger.entries.filter((entry) => entry.intentId === buy.intentId);
    expect(entries).toHaveLength(1);
    expect(entries[0]?.notionalUsd).toBe('150.00');
    expect(entries[0]?.positionAmountAfter).toBe(buy.filledAmount);

    const partial = eventsOfType(log, 'execution.partial');
    expect(partial).toHaveLength(1);
    expect(partial[0]?.inputs).toMatchObject({
      requestedUsd: '200.00',
      filledUsd: '150.00',
      unfilledUsd: '50.00',
      liquidityCapUsd: '150.00',
    });
  });
});

describe('PaperRunner post-stop cooldown', () => {
  it('sets a 24h cooldown after a stop fill, blocks re-entry, then allows a new buy', async () => {
    const { result, log } = await runTrend();
    const sells = result.intents.filter((intent) => intent.side === 'sell');
    const stop = sells[0];
    expect(stop?.status).toBe('filled');

    const cooldowns = eventsOfType(log, 'paper.cooldown_set');
    const firstCooldown = cooldowns[0];
    const deadline = (stop?.fillTime as Timestamp) + 24 * HOUR_MS;
    expect(firstCooldown?.inputs).toMatchObject({
      cooldownUntil: iso(deadline),
      cooldownHours: 24,
      triggerReasonCode: 'TREND_PULLBACK_STOP',
    });
    // The state keeps the latest cooldown; later stop fills extend it.
    const lastCooldown = cooldowns[cooldowns.length - 1];
    expect(result.state.tokens.token?.cooldownUntil).toBe(
      new Date(lastCooldown?.inputs.cooldownUntil as string).getTime(),
    );

    const blockedBuys = result.intents.filter(
      (intent) =>
        intent.side === 'buy' &&
        intent.decisionTime > (stop?.fillTime as Timestamp) &&
        intent.decisionTime < deadline,
    );
    expect(blockedBuys).toEqual([]);

    const dropped = eventsOfType(log, 'opportunity.dropped').filter((event) => {
      const at = new Date(event.clockTime).getTime();
      return (
        event.reasonCode === 'RANK_COOLDOWN' &&
        at >= (stop?.fillTime as Timestamp) &&
        at <= deadline
      );
    });
    expect(dropped.length).toBeGreaterThan(0);

    const reentry = result.intents.find(
      (intent) => intent.side === 'buy' && intent.decisionTime >= deadline,
    );
    expect(reentry?.status).toBe('filled');
    expect(reentry?.fillTime).toBe(deadline);
  });
});

describe('PaperRunner expiry', () => {
  it('expires an intent after maxPendingBars when the next bar has no candle', async () => {
    const trend = trendCloses(0);
    const aCloses = trend.slice(0, PULLBACK_CLOSE_INDEX + 1);
    const aCandles = buildCandles(aCloses, { tokenId: 'aaa' });
    // Resume at index 203, skipping the 201 and 202 bars for `aaa`.
    const resumeCloses = [aCloses[aCloses.length - 1] as number];
    const resume = buildCandles(
      [...resumeCloses, ...resumeCloses, ...resumeCloses, ...resumeCloses],
      { tokenId: 'aaa', start: START + 203 * HOUR },
    );
    const bCandles = buildCandles(steadyCloses(210), { tokenId: 'bbb' });
    const candles = [...aCandles, ...resume, ...bCandles];

    const { result, log } = await runTrend({ tokenIds: ['aaa', 'bbb'], candles });
    const aaaBuy = result.intents.find(
      (intent) => intent.tokenId === 'aaa' && intent.side === 'buy',
    );

    expect(aaaBuy?.status).toBe('expired');
    expect(aaaBuy?.reasonCode).toBe('FILL_EXPIRED');
    expect(aaaBuy?.fillTime).toBe(START + 202 * HOUR);
    expect(aaaBuy?.filledUsd).toBe('0.00');
    expect(aaaBuy?.feeUsd).toBe('0.00');
    expect(result.ledger.entries.some((entry) => entry.intentId === aaaBuy?.intentId)).toBe(false);
    expect(result.ledger.entries.some((entry) => entry.tokenId === 'bbb')).toBe(false);

    const expired = eventsOfType(log, 'execution.expired').filter(
      (event) => event.tokenId === 'aaa',
    );
    expect(expired).toHaveLength(1);
    expect(expired[0]?.inputs).toMatchObject({ barsPending: 2 });
  });
});

describe('PaperRunner expired cooldown cleanup', () => {
  it('clears an expired host cooldown from the final state', async () => {
    const candles = buildCandles(flatAfterCrashCloses(30), { gapIndex: 201, gapPct: 0.5 });
    const { result, log } = await runTrend({ candles });
    const cooldowns = eventsOfType(log, 'paper.cooldown_set');
    expect(cooldowns).toHaveLength(1);
    const deadline = new Date(cooldowns[0]?.inputs.cooldownUntil as string).getTime();
    const lastBar = result.equityCurve.at(-1)?.clockTime ?? 0;

    expect(lastBar).toBeGreaterThan(deadline);
    expect(result.state.tokens.token?.cooldownUntil).toBeNull();
    expect(result.state.tokens.token?.phase).not.toBe('COOLDOWN');
  });
});

describe('PaperRunner portfolio projection', () => {
  it('marks positions, resets dayStart at UTC midnight and keeps the peak drawdown', async () => {
    const candles = buildCandles(flatAfterCrashCloses(), { gapIndex: 201, gapPct: 0.5 });
    const { result, log } = await runTrend({
      candles,
      settings: { dailyLossLimitPct: 0.01 },
      paper: { cooldownHoursAfterStop: 0 },
    });

    const riskEvents = eventsOfType(log, 'risk.checked').filter(
      (event) => event.inputs.kind === 'buy',
    );
    const lateDay = riskEvents.find((event) => event.clockTime === '2026-01-09T23:00:00.000Z');
    const midnight = riskEvents.find((event) => event.clockTime === '2026-01-10T00:00:00.000Z');
    if (lateDay === undefined || midnight === undefined) {
      throw new Error('expected buy risk checks before and after midnight');
    }

    const checksOf = (event: SandboxEvent) =>
      (event.riskChecks ?? []) as Array<{ name: string; value: string; passed: boolean }>;
    const dailyOf = (event: SandboxEvent) =>
      checksOf(event).find((check) => check.name === 'daily_loss_limit');
    const drawdownOf = (event: SandboxEvent) =>
      checksOf(event).find((check) => check.name === 'max_drawdown');

    expect(Number(dailyOf(lateDay)?.value)).toBeGreaterThan(0);
    expect(dailyOf(lateDay)?.passed).toBe(false);
    expect(dailyOf(midnight)?.value).toBe('0.00');
    expect(dailyOf(midnight)?.passed).toBe(true);
    // Peak equity persists across the day boundary even though dayStart resets.
    expect(Number(drawdownOf(midnight)?.value)).toBeGreaterThan(0);
    expect(drawdownOf(midnight)?.passed).toBe(true);

    const midnightPoint = result.equityCurve.find(
      (point) => iso(point.clockTime) === '2026-01-10T00:00:00.000Z',
    );
    expect(Number(midnightPoint?.drawdownPct)).toBeGreaterThan(0);
    expect(result.intents.some((intent) => intent.decisionTime === START + 216 * HOUR)).toBe(true);

    const first = result.equityCurve[0];
    expect(first).toMatchObject({
      equityUsd: '1000.00',
      cashUsd: '1000.00',
      positionsValueUsd: '0.00',
      drawdownPct: '0.00',
    });
    expect(result.equityCurve).toHaveLength(223);
    for (const point of result.equityCurve) {
      expect(new Decimal(point.equityUsd).isNegative()).toBe(false);
      expect(new Decimal(point.drawdownPct).isNegative()).toBe(false);
    }
  });

  it('marks an open position at the bar close and values it on the equity curve', async () => {
    const trend = trendCloses(0).slice(0, PULLBACK_CLOSE_INDEX + 2);
    const candles = buildCandles(trend, { gapIndex: 201, gapPct: 0.5 });
    const { result } = await runTrend({ candles });
    const buy = firstRecord(result, 'buy');
    const point = result.equityCurve.find(
      (entry) => entry.clockTime === (buy.fillTime as Timestamp) + HOUR,
    );
    const position = result.ledger.positions.token;
    if (point === undefined || position === undefined) throw new Error('expected a position');

    const mark = new Decimal(candleAt(candles, point.clockTime - HOUR).close);
    const value = new Decimal(position.amount).times(mark);
    expect(point.positionsValueUsd).toBe(value.toFixed(2));
    expect(point.equityUsd).toBe(new Decimal('799.50').plus(value).toFixed(2));
    expect(point.cashUsd).toBe('799.50');
  });
});

describe('PaperRunner state pass-through', () => {
  it('keeps regime hysteresis and strategy state between bars', async () => {
    const trend = trendCloses(0).slice(0, PULLBACK_CLOSE_INDEX + 2);
    const candles = buildCandles(trend, { gapIndex: 201, gapPct: 0.5 });
    const { result } = await runTrend({ candles });
    const state = result.state.tokens.token;

    expect(state?.regime.regime).toBe('TREND_UP');
    expect(state?.phase).toBe('IN_POSITION');
    expect(state?.regime.since).toBeLessThan(result.equityCurve.at(-1)?.clockTime ?? 0);
    expect(typeof state?.strategyState.hwm).toBe('number');
    expect(state?.strategyState.trailActive).toBe(false);
  });
});

describe('PaperRunner input validation', () => {
  it('rejects an empty token list', async () => {
    await expect(runTrend({ tokenIds: [] })).rejects.toMatchObject({
      name: 'PaperRunError',
      code: 'PAPER_NO_TOKENS',
    });
  });

  it('rejects an empty candle list', async () => {
    await expect(runTrend({ candles: [] })).rejects.toMatchObject({
      name: 'PaperRunError',
      code: 'PAPER_NO_CANDLES',
    });
  });

  it('rejects candles for another timeframe or token', async () => {
    const candles = buildCandles(steadyCloses(5), { tokenId: 'other' });
    await expect(runTrend({ candles })).rejects.toMatchObject({
      name: 'PaperRunError',
      code: 'PAPER_NO_CANDLES',
    });
    const wrongTimeframe = candles.map((candle) => ({ ...candle, timeframe: '4h' }));
    await expect(runTrend({ candles: wrongTimeframe })).rejects.toMatchObject({
      name: 'PaperRunError',
      code: 'PAPER_NO_CANDLES',
    });
    const mixed = buildCandles(steadyCloses(5));
    await expect(
      runTrend({
        candles: [...mixed, ...mixed.map((candle) => ({ ...candle, timeframe: '4h' }))],
      }),
    ).rejects.toMatchObject({
      name: 'PaperRunError',
      code: 'PAPER_MIXED_TIMEFRAMES',
    });
  });

  it('rejects invalid paper settings', async () => {
    await expect(runTrend({ paper: { maxPendingBars: 1.5 } })).rejects.toMatchObject({
      name: 'PaperRunError',
      code: 'PAPER_BAD_SETTINGS',
    });
    await expect(runTrend({ paper: { maxPendingBars: 0 } })).rejects.toMatchObject({
      name: 'PaperRunError',
      code: 'PAPER_BAD_SETTINGS',
    });
    await expect(runTrend({ paper: { feeBps: 10_000 } })).rejects.toMatchObject({
      name: 'PaperRunError',
      code: 'PAPER_BAD_SETTINGS',
    });
    await expect(runTrend({ paper: { counterfactualHorizonHours: 0 } })).rejects.toMatchObject({
      name: 'PaperRunError',
      code: 'PAPER_BAD_SETTINGS',
    });
    await expect(runTrend({ paper: { cooldownHoursAfterStop: -1 } })).rejects.toMatchObject({
      name: 'PaperRunError',
      code: 'PAPER_BAD_SETTINGS',
    });
  });

  it('rejects an invalid cash buffer percentage before the engine sees it', async () => {
    for (const cashBufferPct of [-0.1, 100.5, 101, Number.NaN]) {
      await expect(runTrend({ settings: { cashBufferPct } })).rejects.toMatchObject({
        name: 'PaperRunError',
        code: 'PAPER_BAD_SETTINGS',
      });
    }
  });

  it('accepts a zero cash buffer (no buffer is valid)', async () => {
    const { result } = await runTrend({ settings: { cashBufferPct: 0 } });
    expect(result.ledger.entries.length).toBeGreaterThan(0);
  });

  it('rejects a non-positive or malformed initial capital', async () => {
    for (const initialCapitalUsd of ['0.00', '0', '-5.00', '10.123', '1e3', 'abc']) {
      await expect(runTrend({ initialCapitalUsd })).rejects.toMatchObject({
        name: 'PaperRunError',
        code: 'PAPER_BAD_SETTINGS',
      });
    }
  });

  it('uses the supplied initial capital in the ledger and config', async () => {
    const { result } = await runTrend({ initialCapitalUsd: '2500.00' });
    expect(result.ledger.initialCapitalUsd).toBe('2500.00');
    expect(result.config.initialCapitalUsd).toBe('2500.00');
    expect(result.equityCurve[0]?.equityUsd).toBe('2500.00');
    const firstEntry = result.ledger.entries[0];
    expect(firstEntry?.side).toBe('buy');
    expect(firstEntry?.cashAfterUsd).toBe(
      new Decimal('2500.00')
        .minus(firstEntry?.notionalUsd ?? '0')
        .minus(firstEntry?.feeUsd ?? '0')
        .toFixed(2),
    );
  });
});

describe('PaperRunner missing mark', () => {
  afterEach(() => vi.restoreAllMocks());

  it('throws a typed error when a position has no mark', async () => {
    vi.spyOn(ClockedMarketView.prototype, 'latest').mockReturnValue(null);
    await expect(runTrend()).rejects.toMatchObject({
      name: 'PaperRunError',
      code: 'PAPER_NO_MARK',
    });
  });
});

describe('PaperRunner defensive queue paths', () => {
  afterEach(() => vi.restoreAllMocks());

  function mockDecisions(intentsByCall: readonly (readonly OrderIntent[])[]): void {
    let call = 0;
    vi.spyOn(DecisionEngine.prototype, 'decide').mockImplementation(
      async (input: DecisionInput): Promise<DecisionResult> => {
        const intents = intentsByCall[call] ?? [];
        call += 1;
        return {
          clockTime: input.clockTime,
          intents: [...intents],
          tokenViews: [],
          state: { tokens: {} },
          eventCount: 0,
          eventHash: '',
        };
      },
    );
  }

  function scriptedIntent(intentId: string, overrides: Partial<OrderIntent> = {}): OrderIntent {
    return {
      intentId,
      tokenId: 'token',
      side: 'buy',
      strategyKey: 'trend_pullback',
      strategyVersion: 1,
      reasonCode: 'TREND_PULLBACK_ENTRY',
      sizeUsd: '100',
      amount: null,
      stopLossPct: '3',
      takeProfitPct: null,
      decisionPriceUsd: '100.00000000',
      clockTime: START,
      ...overrides,
    };
  }

  function scriptedSell(intentId: string, amount: string): OrderIntent {
    return {
      ...scriptedIntent(intentId),
      side: 'sell',
      reasonCode: 'TREND_PULLBACK_STOP',
      sizeUsd: '0',
      amount,
    };
  }

  it('keeps a dust position open when the sell would book zero cents', async () => {
    const candles: Candle[] = [
      {
        tokenId: 'token',
        timeframe: '1h',
        openTime: START,
        open: '100',
        high: '100',
        low: '100',
        close: '100',
        volumeUsd: '100000',
      },
      {
        tokenId: 'token',
        timeframe: '1h',
        openTime: START + HOUR,
        open: '100',
        high: '100',
        low: '100',
        close: '100',
        volumeUsd: '100000',
      },
      {
        tokenId: 'token',
        timeframe: '1h',
        openTime: START + 2 * HOUR,
        open: '5',
        high: '5',
        low: '5',
        close: '5',
        volumeUsd: '100000',
      },
    ];
    const tinyBuy = { ...scriptedIntent('intent-buy'), sizeUsd: '0.01' };
    mockDecisions([[tinyBuy], [scriptedSell('intent-sell', '0.00009990')]]);

    const { result, log } = await runTrend({ candles });
    const buy = result.intents.find((intent) => intent.intentId === 'intent-buy');
    const sell = result.intents.find((intent) => intent.intentId === 'intent-sell');

    expect(buy?.status).toBe('filled');
    expect(buy?.filledAmount).toBe('0.00009990');
    expect(sell).toMatchObject({
      status: 'rejected',
      reasonCode: 'FILL_LIQUIDITY',
      strategyReasonCode: 'TREND_PULLBACK_STOP',
      filledUsd: '0.00',
    });
    expect(result.ledger.entries).toHaveLength(1);
    // The dust position stays open and the run keeps going to its natural end.
    expect(result.ledger.positions.token?.amount).toBe('0.00009990');
    expect(eventsOfType(log, 'paper.run_completed')).toHaveLength(1);
    expect(result.equityCurve).toHaveLength(3);
  });

  it('rejects a second pending intent for the same token and side', async () => {
    const candles = buildCandles([100, 100, 100]);
    mockDecisions([[scriptedIntent('intent-a'), scriptedIntent('intent-b')]]);

    const { result, log } = await runTrend({ candles });
    const duplicate = result.intents.find((intent) => intent.intentId === 'intent-b');
    expect(duplicate).toMatchObject({
      status: 'rejected',
      reasonCode: 'FILL_DUPLICATE',
      strategyReasonCode: 'TREND_PULLBACK_ENTRY',
      fillTime: null,
      filledUsd: '0.00',
    });
    expect(result.intents.find((intent) => intent.intentId === 'intent-a')?.status).toBe('filled');
    expect(result.ledger.entries).toHaveLength(1);
    expect(
      eventsOfType(log, 'execution.rejected').some(
        (event) => event.reasonCode === 'FILL_DUPLICATE',
      ),
    ).toBe(true);
  });

  it('rejects a buy intent when the token already has a position', async () => {
    const candles = buildCandles([100, 100, 100]);
    mockDecisions([[scriptedIntent('intent-a')], [scriptedIntent('intent-b')]]);

    const { result } = await runTrend({ candles });
    const noAdd = result.intents.find((intent) => intent.intentId === 'intent-b');
    expect(noAdd).toMatchObject({
      status: 'rejected',
      reasonCode: 'FILL_POSITION_EXISTS',
    });
    expect(result.ledger.entries).toHaveLength(1);
    expect(result.ledger.positions.token?.entryIntentId).toBe('intent-a');
  });

  it('sizes the buy cash floor from the previous-close equity (one-bar convention)', async () => {
    const aaa = buildCandles([100, 100, 100], { tokenId: 'aaa' }).map((candle, index) =>
      index === 2 ? { ...candle, open: '200', high: '200.2', low: '99.9' } : candle,
    );
    const bbb = buildCandles([50, 50, 50], { tokenId: 'bbb' });
    mockDecisions([
      [scriptedIntent('intent-aaa', { tokenId: 'aaa', sizeUsd: '100' })],
      [scriptedIntent('intent-bbb', { tokenId: 'bbb', sizeUsd: '795' })],
    ]);

    const { result } = await runTrend({ tokenIds: ['aaa', 'bbb'], candles: [...aaa, ...bbb] });
    const buy = result.intents.find((intent) => intent.intentId === 'intent-bbb');

    // Equity at the fill open is cash + aaa marked at the previous close (100),
    // not aaa's gapped open (200). Floor = 999.65 * 10% = 99.965, so 795 + fee
    // fits; marking at the open would have raised the floor and rejected it.
    expect(buy?.status).toBe('filled');
    expect(buy?.strategyReasonCode).toBe('TREND_PULLBACK_ENTRY');
    const entry = result.ledger.entries.find((row) => row.intentId === 'intent-bbb');
    expect(entry?.cashAfterUsd).toBe('102.76');
  });
});

describe('PaperRunner event log', () => {
  it('logs paper, execution and ledger events with the base fields and one record per intent', async () => {
    const { result, log } = await runTrend();
    const events = log.events();

    expect(events[0]?.eventType).toBe('paper.run_started');
    expect(events.at(-1)?.eventType).toBe('paper.run_completed');
    expect(result.eventCount).toBe(events.length);
    expect(result.eventHash).toBe(log.hash());

    for (const event of events) {
      expect(event.runId).toBe('run-1');
      expect(event.seed).toBe(7);
      expect(event.configVersion).toBe('config-1');
      expect(event.dataSnapshotId).toBe('snapshot-1');
      if (event.eventType.startsWith('paper.')) expect(event.module).toBe('run');
      if (event.eventType.startsWith('execution.')) expect(event.module).toBe('execution');
      if (event.eventType === 'ledger.entry') expect(event.module).toBe('ledger');
      if (event.decision !== null) {
        expect(event.reasonCode?.length ?? 0).toBeGreaterThan(0);
        expect(event.alternatives.length).toBeGreaterThanOrEqual(1);
      }
    }

    const execution = events.filter((event) => event.eventType.startsWith('execution.'));
    expect(execution).toHaveLength(result.intents.length);
    for (const record of result.intents) {
      const matches = execution.filter((event) => event.inputs.intentId === record.intentId);
      expect(matches, record.intentId).toHaveLength(1);
      if (record.status === 'filled' || record.status === 'partial') {
        expect(matches[0]?.eventType).toBe(
          record.status === 'filled' ? 'execution.filled' : 'execution.partial',
        );
        const ledgerEvents = events.filter(
          (event) =>
            event.eventType === 'ledger.entry' && event.inputs.intentId === record.intentId,
        );
        expect(ledgerEvents, record.intentId).toHaveLength(1);
        expect(ledgerEvents[0]?.inputs.side).toBe(record.side);
      } else {
        expect(matches[0]?.eventType).toBe('execution.rejected');
      }
    }

    const ledgerEntries = events.filter((event) => event.eventType === 'ledger.entry');
    expect(ledgerEntries).toHaveLength(result.ledger.entries.length);
    expect(ledgerEntries.map((event) => event.inputs.entryId)).toEqual(
      result.ledger.entries.map((entry) => entry.entryId),
    );

    const completed = events.at(-1);
    expect(completed?.inputs).toMatchObject({
      finalEquityUsd: result.equityCurve.at(-1)?.equityUsd,
      fills: result.intents.filter((intent) => intent.status === 'filled').length,
      trades: result.ledger.closedTrades.length,
      ledgerEntries: result.ledger.entries.length,
    });
  });

  it('is deterministic across two identical runs', async () => {
    const first = await runTrend();
    const second = await runTrend();

    expect(second.result.intents).toEqual(first.result.intents);
    expect(second.result.ledger).toEqual(first.result.ledger);
    expect(second.result.equityCurve).toEqual(first.result.equityCurve);
    expect(second.result.state).toEqual(first.result.state);
    expect(second.result.config).toEqual(first.result.config);
    expect(second.result.eventCount).toBe(first.result.eventCount);
    expect(second.result.eventHash).toBe(first.result.eventHash);
    expect(second.log.events().map((event) => event.eventType)).toEqual(
      first.log.events().map((event) => event.eventType),
    );
  });

  it('does not mutate the input candles or settings', async () => {
    const { input } = await runTrend();
    const snapshot = JSON.stringify(input);
    const frozenCandles = input.candles.map((candle) => Object.freeze({ ...candle }));
    const frozenInput: PaperRunInput = Object.freeze({
      ...input,
      tokenIds: Object.freeze([...input.tokenIds]),
      candles: Object.freeze(frozenCandles),
      settings: Object.freeze({ ...input.settings }),
      paper: Object.freeze({ ...input.paper }),
    });

    const log = new MemoryEventLog();
    await new PaperRunner(log).run(frozenInput);

    expect(JSON.stringify(input)).toBe(snapshot);
    expect(JSON.stringify(frozenInput)).toBe(snapshot);
  });
});

describe('PaperRunner result shape', () => {
  it('echoes the paper config and reports the whole log hash', async () => {
    const { result, log } = await runTrend();
    expect(result.config).toEqual({
      runId: 'run-1',
      seed: 7,
      timeframe: '1h',
      tokenIds: ['token'],
      initialCapitalUsd: '1000.00',
      ...DEFAULT_PAPER_SETTINGS,
    });
    expect(result.eventHash).toBe(log.hash());
    expect(result.eventCount).toBe(log.events().length);
    expect(result.intents.some((intent) => intent.status === 'filled')).toBe(true);
  });

  it('respects the documented error class', () => {
    const error = new PaperRunError('PAPER_NO_MARK', 'missing mark');
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('PaperRunError');
    expect(error.code).toBe('PAPER_NO_MARK');
  });
});

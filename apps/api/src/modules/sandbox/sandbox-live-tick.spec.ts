import { describe, expect, it } from 'vitest';
import {
  createLedger,
  DEFAULT_PAPER_SETTINGS,
  DEFAULT_SETTINGS,
  MemoryEventLog,
  Reason,
  type Candle,
  type EngineState,
  type OrderIntent,
  type PaperLedgerState,
} from '@nexter/sandbox-core';
import { fillLiveBuy, type SandboxLiveQuote } from './sandbox-live-broker';
import { findNewBarClose, runSandboxLiveTick, SandboxLiveTickError } from './sandbox-live-tick';
import type { SandboxPendingIntent } from './sandbox.repository';
import type { SandboxRunSnapshot, SandboxRunnerConfig } from './sandbox.types';

const TOKEN = 'bsc:0x1111111111111111111111111111111111111111';
const START = Date.UTC(2026, 0, 1);
const HOUR = 3_600_000;

function config(overrides: Partial<SandboxRunnerConfig> = {}): SandboxRunnerConfig {
  return {
    tokenKeys: [TOKEN],
    seed: 1,
    settings: DEFAULT_SETTINGS,
    paper: DEFAULT_PAPER_SETTINGS,
    ...overrides,
  };
}

function candles(options: { count?: number; lastClose?: number; pattern?: 'flat' | 'moon' } = {}) {
  const count = options.count ?? 220;
  const pattern = options.pattern ?? 'flat';
  const list: Candle[] = [];
  for (let index = 0; index < count; index += 1) {
    const close = pattern === 'moon' ? 100 + index * 0.05 : (options.lastClose ?? 100);
    const open = index === 0 ? String(close) : (list[index - 1]?.close ?? String(close));
    list.push({
      tokenId: TOKEN,
      timeframe: '1h',
      openTime: START + index * HOUR,
      open,
      high: open,
      low: open,
      close: String(close),
      volumeUsd: '100000.00000000',
    });
  }
  if (options.lastClose !== undefined && list.length > 0) {
    const index = list.length - 1;
    const last = list[index];
    if (last) {
      list[index] = {
        ...last,
        open: String(options.lastClose),
        high: String(options.lastClose),
        low: String(options.lastClose),
        close: String(options.lastClose),
      };
    }
  }
  return list;
}

function emptyState(): EngineState {
  return { tokens: {} };
}

function tokenStateState(overrides: { cooldownUntil?: number | null } = {}): EngineState {
  return {
    tokens: {
      [TOKEN]: {
        tokenId: TOKEN,
        regime: {
          regime: 'TREND_UP',
          reasonCode: Reason.REGIME_TREND_UP,
          candidate: null,
          candidateBars: 0,
          since: START,
          rulesVersion: 'regime-v1',
          features: {
            bars: 200,
            lastClose: '100.00000000',
            fastSma: '99.00000000',
            slowSma: '95.00000000',
            longSma: '90.00000000',
            atrPct: '1.50',
            recentHigh: '101.00000000',
            recentLow: '80.00000000',
            avgVolumeUsd: '100000.00',
            drawdownPct: '0.00',
            staleBars: 0,
          },
        },
        phase: 'IN_POSITION',
        cooldownUntil: overrides.cooldownUntil ?? null,
        strategyState: {},
      },
    },
  };
}

function runSnapshot(
  options: {
    ledger?: PaperLedgerState;
    engineState?: EngineState;
    lastBarClose?: Date | null;
  } = {},
): SandboxRunSnapshot {
  const ledger = options.ledger ?? createLedger('1000.00');
  return {
    id: '11111111-1111-4111-8111-111111111111',
    userId: '22222222-2222-4222-8222-222222222222',
    name: 'Live tick fixture',
    status: 'running',
    initialCapitalUsd: ledger.initialCapitalUsd,
    cashUsd: ledger.cashUsd,
    equityUsd: ledger.cashUsd,
    peakEquityUsd: ledger.initialCapitalUsd,
    dayStartEquityUsd: ledger.initialCapitalUsd,
    settings: config() as unknown as Record<string, unknown>,
    engineState: options.engineState ?? emptyState(),
    ledgerState: ledger,
    lastBarClose: options.lastBarClose ?? null,
    eventSeq: 0,
    eventHash: '0'.repeat(64),
    lastTickAt: null,
    error: null,
    createdAt: new Date(START),
    updatedAt: new Date(START),
    startedAt: new Date(START),
    pausedAt: null,
    stoppedAt: null,
    archivedAt: null,
    tokens: [
      {
        tokenKey: TOKEN,
        symbol: 'CAKE',
        chain: 'bsc',
        contractAddress: TOKEN.slice('bsc:'.length),
        enabled: true,
      },
    ],
  };
}

function quote(priceUsd = '100.00000000', volumeUsd = '100000.00000000'): SandboxLiveQuote {
  return { tokenId: TOKEN, priceUsd, volumeUsd, asOf: new Date(START) };
}

function pending(overrides: Partial<SandboxPendingIntent> = {}): SandboxPendingIntent {
  return {
    runId: '11111111-1111-4111-8111-111111111111',
    intentId: 'intent-buy',
    tokenId: TOKEN,
    side: 'buy',
    strategyKey: 'trend_pullback',
    strategyVersion: 1,
    requestedUsd: '200.00',
    requestedAmount: null,
    priceUsd: '99.00000000',
    strategyReasonCode: Reason.TREND_PULLBACK_ENTRY,
    reasonText: 'queued',
    decisionTime: new Date(START),
    ...overrides,
  };
}

function clockFor(series: readonly Candle[]): number {
  const last = series[series.length - 1];
  if (!last) throw new Error('fixture has no candles');
  return last.openTime + HOUR;
}

function openedLedger(): PaperLedgerState {
  const intent: OrderIntent = {
    intentId: 'intent-open',
    tokenId: TOKEN,
    side: 'buy',
    strategyKey: 'trend_pullback',
    strategyVersion: 1,
    reasonCode: Reason.TREND_PULLBACK_ENTRY,
    sizeUsd: '200.00',
    amount: null,
    stopLossPct: null,
    takeProfitPct: null,
    decisionPriceUsd: '99.00000000',
    clockTime: START,
  };
  const result = fillLiveBuy({
    intent,
    quote: quote(),
    ledger: createLedger('1000.00'),
    equityUsd: '1000.00',
    cashBufferPct: 0,
    settings: DEFAULT_PAPER_SETTINGS,
    fillTime: START,
  });
  if (!result.filled) throw new Error('fixture open did not fill');
  return result.ledger;
}

describe('findNewBarClose', () => {
  it('returns the newest closed bar close once and not again for the same bar', () => {
    const series = candles({ count: 4 });
    const close = clockFor(series);

    expect(findNewBarClose(series, [TOKEN], null)).toBe(close);
    expect(findNewBarClose(series, [TOKEN], new Date(close))).toBeNull();
    expect(findNewBarClose(series, [TOKEN], new Date(close - HOUR))).toBe(close);
  });

  it('returns null when the universe has no candles', () => {
    expect(findNewBarClose([], [TOKEN], null)).toBeNull();
    expect(findNewBarClose(candles({ count: 2 }), [], null)).toBeNull();
  });
});

describe('runSandboxLiveTick', () => {
  it('fills a pending buy at the live quote and advances the ledger', async () => {
    const series = candles();
    const clockTime = clockFor(series);
    const log = new MemoryEventLog();
    const result = await runSandboxLiveTick({
      run: runSnapshot(),
      config: config(),
      candles: series,
      pending: [pending({ decisionTime: new Date(clockTime - HOUR) })],
      quotes: new Map([[TOKEN, quote()]]),
      clockTime,
      now: new Date(clockTime),
      eventLog: log,
    });

    expect(result.resolvedIntents).toHaveLength(1);
    expect(result.resolvedIntents[0]).toMatchObject({
      intentId: 'intent-buy',
      status: 'filled',
      filledUsd: '200.00',
      reasonCode: Reason.FILL_FILLED,
    });
    expect(result.tick.ledgerState.positions[TOKEN]).toBeDefined();
    expect(result.tick.cashUsd).toBe('799.50');
    expect(result.tick.lastBarClose.getTime()).toBe(clockTime);
    expect(log.events().some((event) => event.eventType === 'execution.filled')).toBe(true);
  });

  it('keeps an intent pending when the token has no live quote', async () => {
    const series = candles();
    const clockTime = clockFor(series);
    const result = await runSandboxLiveTick({
      run: runSnapshot(),
      config: config(),
      candles: series,
      pending: [pending({ decisionTime: new Date(clockTime - HOUR) })],
      quotes: new Map(),
      clockTime,
      now: new Date(clockTime),
      eventLog: new MemoryEventLog(),
    });

    expect(result.resolvedIntents).toHaveLength(0);
    expect(result.tick.ledgerState.positions[TOKEN]).toBeUndefined();
  });

  it('expires an intent that waited beyond maxPendingBars', async () => {
    const series = candles();
    const clockTime = clockFor(series);
    const result = await runSandboxLiveTick({
      run: runSnapshot(),
      config: config(),
      candles: series,
      pending: [pending({ decisionTime: new Date(clockTime - 3 * HOUR) })],
      quotes: new Map([[TOKEN, quote()]]),
      clockTime,
      now: new Date(clockTime),
      eventLog: new MemoryEventLog(),
    });

    expect(result.resolvedIntents[0]).toMatchObject({
      status: 'expired',
      reasonCode: Reason.FILL_EXPIRED,
    });
    expect(result.tick.ledgerState.positions[TOKEN]).toBeUndefined();
  });

  it('fills a manual close at the live quote and closes the position', async () => {
    const ledger = openedLedger();
    const position = ledger.positions[TOKEN];
    if (!position) throw new Error('fixture has no position');
    const series = candles();
    const clockTime = clockFor(series);
    const result = await runSandboxLiveTick({
      run: runSnapshot({ ledger, engineState: tokenStateState() }),
      config: config(),
      candles: series,
      pending: [
        pending({
          intentId: 'manual-close',
          side: 'sell',
          requestedUsd: null,
          requestedAmount: position.amount,
          strategyReasonCode: Reason.MANUAL_CLOSE,
          decisionTime: new Date(clockTime - HOUR),
        }),
      ],
      quotes: new Map([[TOKEN, quote('110.00000000')]]),
      clockTime,
      now: new Date(clockTime),
      eventLog: new MemoryEventLog(),
    });

    expect(result.resolvedIntents[0]).toMatchObject({
      status: 'filled',
      strategyReasonCode: Reason.MANUAL_CLOSE,
    });
    expect(result.tick.ledgerState.positions[TOKEN]).toBeUndefined();
    expect(result.tick.ledgerState.closedTrades).toHaveLength(1);
  });

  it('arms a cooldown after a stop sell fill without mutating the input state', async () => {
    const ledger = openedLedger();
    const position = ledger.positions[TOKEN];
    if (!position) throw new Error('fixture has no position');
    const initial = tokenStateState();
    const series = candles();
    const clockTime = clockFor(series);
    const result = await runSandboxLiveTick({
      run: runSnapshot({ ledger, engineState: initial }),
      config: config(),
      candles: series,
      pending: [
        pending({
          intentId: 'stop-sell',
          side: 'sell',
          requestedUsd: null,
          requestedAmount: position.amount,
          strategyReasonCode: Reason.TREND_PULLBACK_STOP,
          decisionTime: new Date(clockTime - HOUR),
        }),
      ],
      quotes: new Map([[TOKEN, quote('90.00000000')]]),
      clockTime,
      now: new Date(clockTime),
      eventLog: new MemoryEventLog(),
    });

    expect(initial.tokens[TOKEN]?.cooldownUntil).toBeNull();
    expect(result.tick.engineState.tokens[TOKEN]?.cooldownUntil).toBe(
      clockTime + DEFAULT_PAPER_SETTINGS.cooldownHoursAfterStop * HOUR,
    );
    expect(result.pendingIntents.some((intent) => intent.side === 'buy')).toBe(false);
  });

  it('queues the decision sell intent for an open position', async () => {
    const ledger = openedLedger();
    const series = candles({ count: 220, lastClose: 80 });
    const clockTime = clockFor(series);
    const result = await runSandboxLiveTick({
      run: runSnapshot({ ledger, engineState: tokenStateState() }),
      config: config(),
      candles: series,
      pending: [],
      quotes: new Map([[TOKEN, quote('80.00000000')]]),
      clockTime,
      now: new Date(clockTime),
      eventLog: new MemoryEventLog(),
    });

    expect(result.pendingIntents.length).toBeGreaterThan(0);
    expect(result.pendingIntents[0]).toMatchObject({ tokenId: TOKEN, side: 'sell' });
  });

  it('reloads the persisted state and advances to the next bar', async () => {
    const firstSeries = candles({ count: 220 });
    const firstClock = clockFor(firstSeries);
    const first = await runSandboxLiveTick({
      run: runSnapshot(),
      config: config(),
      candles: firstSeries,
      pending: [pending({ decisionTime: new Date(firstClock - HOUR) })],
      quotes: new Map([[TOKEN, quote()]]),
      clockTime: firstClock,
      now: new Date(firstClock),
      eventLog: new MemoryEventLog(),
    });

    const secondSeries = candles({ count: 221 });
    const secondClock = clockFor(secondSeries);
    const second = await runSandboxLiveTick({
      run: runSnapshot({
        ledger: first.tick.ledgerState,
        engineState: first.tick.engineState,
        lastBarClose: first.tick.lastBarClose,
      }),
      config: config(),
      candles: secondSeries,
      pending: first.pendingIntents.map((intent) => ({
        runId: '11111111-1111-4111-8111-111111111111',
        intentId: intent.intentId,
        tokenId: intent.tokenId,
        side: intent.side,
        strategyKey: intent.strategyKey,
        strategyVersion: intent.strategyVersion,
        requestedUsd: intent.side === 'buy' ? intent.sizeUsd : null,
        requestedAmount: intent.side === 'sell' ? intent.amount : null,
        priceUsd: intent.decisionPriceUsd,
        strategyReasonCode: intent.reasonCode,
        reasonText: 'queued',
        decisionTime: new Date(intent.clockTime),
      })),
      quotes: new Map([[TOKEN, quote()]]),
      clockTime: secondClock,
      now: new Date(secondClock),
      eventLog: new MemoryEventLog(),
    });

    expect(second.tick.lastBarClose.getTime()).toBe(secondClock);
    expect(second.tick.ledgerState.initialCapitalUsd).toBe(
      first.tick.ledgerState.initialCapitalUsd,
    );
    expect(second.tick.ledgerState.entries.length).toBeGreaterThanOrEqual(
      first.tick.ledgerState.entries.length,
    );
  });

  it('is deterministic for identical inputs', async () => {
    const series = candles();
    const clockTime = clockFor(series);
    const input = {
      run: runSnapshot(),
      config: config(),
      candles: series,
      pending: [pending()],
      quotes: new Map([[TOKEN, quote()]]),
      clockTime,
      now: new Date(clockTime),
    };

    const first = await runSandboxLiveTick({ ...input, eventLog: new MemoryEventLog() });
    const second = await runSandboxLiveTick({ ...input, eventLog: new MemoryEventLog() });

    expect(second.tick.ledgerState).toEqual(first.tick.ledgerState);
    expect(second.tick.engineState).toEqual(first.tick.engineState);
    expect(second.tick.intents).toEqual(first.tick.intents);
  });

  it('fails the tick when reconciliation detects a tampered ledger', async () => {
    const ledger = { ...openedLedger(), cashUsd: '900.00' };
    const series = candles();
    const clockTime = clockFor(series);

    await expect(
      runSandboxLiveTick({
        run: runSnapshot({ ledger, engineState: tokenStateState() }),
        config: config(),
        candles: series,
        pending: [],
        quotes: new Map([[TOKEN, quote()]]),
        clockTime,
        now: new Date(clockTime),
        eventLog: new MemoryEventLog(),
      }),
    ).rejects.toBeInstanceOf(SandboxLiveTickError);
  });
});

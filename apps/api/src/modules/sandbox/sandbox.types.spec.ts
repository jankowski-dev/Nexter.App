import { describe, expect, it } from 'vitest';
import {
  applyBuyFill,
  createLedger,
  DEFAULT_PAPER_SETTINGS,
  markPortfolio,
  planBuyFill,
  Reason,
  type EngineState,
  type OrderIntent,
  type PaperLedgerState,
  type Regime,
  type TokenPhase,
} from '@nexter/sandbox-core';
import {
  assertSandboxTickConsistency,
  assertSandboxTickInput,
  buildSandboxClosedPositionTokenIds,
  buildSandboxEquityPointRow,
  buildSandboxIntentRows,
  buildSandboxLedgerEntryRows,
  buildSandboxPositionRows,
  buildSandboxTradeRows,
  parseEngineState,
  parseOptionalEngineState,
  parseOptionalLedgerState,
  parsePaperLedgerState,
  SandboxPersistenceError,
  type SandboxTickInput,
} from './sandbox.types';

const AT = Date.UTC(2026, 0, 1, 1);
const TOKEN = 'bsc:0x1111111111111111111111111111111111111111';

function orderIntent(overrides: Partial<OrderIntent> = {}): OrderIntent {
  return {
    intentId: 'intent-1',
    tokenId: TOKEN,
    side: 'buy',
    strategyKey: 'trend_pullback',
    strategyVersion: 1,
    reasonCode: Reason.TREND_PULLBACK_ENTRY,
    sizeUsd: '200.00',
    amount: null,
    stopLossPct: '3.00',
    takeProfitPct: null,
    decisionPriceUsd: '100.00000000',
    clockTime: AT,
    ...overrides,
  };
}

function buyLedger(): PaperLedgerState {
  const intent = orderIntent();
  const plan = planBuyFill({
    intent,
    candle: {
      tokenId: TOKEN,
      timeframe: '1h',
      openTime: AT,
      open: '100.00000000',
      high: '101.00000000',
      low: '99.00000000',
      close: '100.00000000',
      volumeUsd: '100000.00000000',
    },
    cashUsd: '1000.00',
    equityUsd: '1000.00',
    cashBufferPct: 0,
    settings: DEFAULT_PAPER_SETTINGS,
    hasPosition: false,
  });
  if (plan.status !== 'filled') throw new Error(`fixture fill was ${plan.status}`);

  return applyBuyFill(createLedger('1000.00'), plan, intent, AT).state;
}

function engineState(overrides: { regime?: Regime; phase?: TokenPhase } = {}): EngineState {
  return {
    tokens: {
      [TOKEN]: {
        tokenId: TOKEN,
        regime: {
          regime: overrides.regime ?? 'TREND_UP',
          reasonCode: 'REGIME_TREND_UP',
          candidate: null,
          candidateBars: 0,
          since: AT,
          rulesVersion: 'regime-v1',
          features: {
            bars: 120,
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
        phase: overrides.phase ?? 'ARMED',
        cooldownUntil: null,
        strategyState: { armed: true },
      },
    },
  };
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

describe('sandbox state validation', () => {
  it('round-trips a valid engine state through JSON', () => {
    const state = engineState();

    expect(parseEngineState(clone(state))).toEqual(state);
  });

  it('rejects an unknown regime key', () => {
    const raw = clone(engineState()) as {
      tokens: Record<string, { regime: { regime: string } }>;
    };
    raw.tokens[TOKEN]!.regime.regime = 'MOON';

    expect(() => parseEngineState(raw)).toThrow(SandboxPersistenceError);
    expect(() => parseEngineState(raw)).toThrow(/regime/);
  });

  it('rejects an unknown token phase', () => {
    const raw = clone(engineState()) as { tokens: Record<string, { phase: string }> };
    raw.tokens[TOKEN]!.phase = 'DREAMING';

    expect(() => parseEngineState(raw)).toThrow(/phase/);
  });

  it('rejects a token record whose key does not match its id', () => {
    const raw = clone(engineState()) as { tokens: Record<string, { tokenId: string }> };
    raw.tokens[TOKEN]!.tokenId = 'other-token';

    expect(() => parseEngineState(raw)).toThrow(/must match its record key/);
  });

  it('round-trips a valid ledger state through JSON', () => {
    const ledger = buyLedger();

    expect(parsePaperLedgerState(clone(ledger))).toEqual(ledger);
    expect(Object.keys(ledger.positions)).toEqual([TOKEN]);
    expect(ledger.entries).toHaveLength(1);
  });

  it('rejects an unknown strategy key in a persisted position', () => {
    const raw = clone(buyLedger()) as { positions: Record<string, { strategyKey: string }> };
    raw.positions[TOKEN]!.strategyKey = 'yolo_breakout';

    expect(() => parsePaperLedgerState(raw)).toThrow(/strategyKey/);
  });

  it('rejects duplicate ledger sequences', () => {
    const ledger = buyLedger();
    const entry = ledger.entries[0];
    if (!entry) throw new Error('fixture has no ledger entry');
    const raw = clone({ ...ledger, entries: [entry, entry] });

    expect(() => parsePaperLedgerState(raw)).toThrow(/duplicate ledger sequence/);
  });

  it('rejects a non-decimal money value', () => {
    const raw = clone(buyLedger()) as { cashUsd: string };
    raw.cashUsd = '1,000.00';

    expect(() => parsePaperLedgerState(raw)).toThrow(/cashUsd/);
  });

  it('treats the empty JSONB default as uninitialised only for a draft run', () => {
    expect(parseOptionalEngineState({}, 'draft')).toBeNull();
    expect(parseOptionalLedgerState({}, 'draft')).toBeNull();
    expect(() => parseOptionalEngineState({}, 'running')).toThrow(/only allowed for a draft/);
    expect(() => parseOptionalLedgerState({}, 'paused')).toThrow(/only allowed for a draft/);
    expect(() => parseOptionalEngineState({ tokens: 'nope' }, 'draft')).toThrow(
      SandboxPersistenceError,
    );
    expect(() => parseOptionalLedgerState({ cashUsd: '1000.00' }, 'draft')).toThrow(
      SandboxPersistenceError,
    );
  });

  it('fails loudly on unknown top-level state fields (strict schemas)', () => {
    const engine = clone(engineState()) as unknown as Record<string, unknown>;
    engine.extra = true;
    expect(() => parseEngineState(engine)).toThrow(/extra/);

    const ledger = clone(buyLedger()) as unknown as Record<string, unknown>;
    ledger.extra = true;
    expect(() => parsePaperLedgerState(ledger)).toThrow(/extra/);
  });

  it('fails loudly on unknown nested state fields (strict schemas)', () => {
    const engine = clone(engineState()) as unknown as {
      tokens: Record<string, { regime: Record<string, unknown> }>;
    };
    engine.tokens[TOKEN]!.regime.extra = true;
    expect(() => parseEngineState(engine)).toThrow(/extra/);

    const ledger = clone(buyLedger()) as unknown as {
      positions: Record<string, Record<string, unknown>>;
    };
    ledger.positions[TOKEN]!.extra = true;
    expect(() => parsePaperLedgerState(ledger)).toThrow(/extra/);
  });
});

describe('sandbox tick validation', () => {
  function tick(): SandboxTickInput {
    const ledger = buyLedger();
    const marked = markPortfolio(ledger, { [TOKEN]: '105.00000000' });

    return {
      status: 'running',
      cashUsd: ledger.cashUsd,
      equityUsd: marked.equityUsd,
      peakEquityUsd: '2000.00',
      dayStartEquityUsd: '1000.00',
      engineState: engineState(),
      ledgerState: ledger,
      markedPositions: marked.positions,
      marks: { [TOKEN]: '105.00000000' },
      equityPoint: {
        clockTime: AT,
        equityUsd: marked.equityUsd,
        cashUsd: ledger.cashUsd,
        positionsValueUsd: marked.positionsValueUsd,
        drawdownPct: '0.00',
      },
      intents: [],
      lastBarClose: new Date(AT),
      lastTickAt: new Date(AT),
      error: null,
    };
  }

  it('accepts a well-formed tick', () => {
    expect(() => assertSandboxTickInput(tick())).not.toThrow();
  });

  it('rejects an unknown run status', () => {
    const raw = tick() as { status: string };
    raw.status = 'zombie';

    expect(() => assertSandboxTickInput(raw as unknown as SandboxTickInput)).toThrow(/status/);
  });

  it('rejects float money', () => {
    const raw = tick() as { equityUsd: string };
    raw.equityUsd = '1000.5.5';

    expect(() => assertSandboxTickInput(raw as unknown as SandboxTickInput)).toThrow(/equityUsd/);
  });

  it('rejects NaN-like numeric strings Postgres would otherwise accept', () => {
    const raw = tick();
    (raw.equityPoint as { cashUsd: string }).cashUsd = 'NaN';
    expect(() => assertSandboxTickInput(raw)).toThrow(/equityPoint.cashUsd/);

    const mark = tick();
    (mark.markedPositions[0] as { marketValueUsd: string }).marketValueUsd = 'NaN';
    expect(() => assertSandboxTickInput(mark)).toThrow(/marketValueUsd/);
  });

  it('requires an exact mark that rounds to the displayed mark', () => {
    const missing = tick();
    (missing as { marks: Record<string, string> }).marks = {};
    expect(() => assertSandboxTickInput(missing)).toThrow(/missing exact mark/);

    const mismatched = tick();
    (mismatched as { marks: Record<string, string> }).marks = {
      [TOKEN]: '105.000000129',
    };
    expect(() => assertSandboxTickInput(mismatched)).toThrow(/8-decimal display/);
  });

  it('accepts the marked ledger identities and rejects mismatches', () => {
    expect(() => assertSandboxTickConsistency(tick())).not.toThrow();

    const cash = tick() as { cashUsd: string };
    cash.cashUsd = '1.00';
    expect(() => assertSandboxTickConsistency(cash as SandboxTickInput)).toThrow(
      /must equal ledgerState.cashUsd/,
    );

    const equity = tick();
    (equity.equityPoint as { equityUsd: string }).equityUsd = '9999.00';
    expect(() => assertSandboxTickConsistency(equity)).toThrow(/persisted equityUsd/);

    const positions = tick();
    (positions.equityPoint as { positionsValueUsd: string }).positionsValueUsd = '1.00';
    expect(() => assertSandboxTickConsistency(positions)).toThrow(/sum of marked position/);

    const peak = tick();
    (peak as { peakEquityUsd: string }).peakEquityUsd = '1.00';
    expect(() => assertSandboxTickConsistency(peak)).toThrow(/peakEquityUsd/);

    const dayStart = tick();
    (dayStart as { dayStartEquityUsd: string }).dayStartEquityUsd = '0.00';
    expect(() => assertSandboxTickConsistency(dayStart)).toThrow(/dayStartEquityUsd/);
  });
});

describe('sandbox projection builders', () => {
  it('projects the open position with its exact tick mark', () => {
    const ledger = buyLedger();
    const exactMark = '105.000000123456789012';
    const marked = markPortfolio(ledger, { [TOKEN]: exactMark });
    const rows = buildSandboxPositionRows('run-1', ledger, marked.positions, {
      [TOKEN]: exactMark,
    });

    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(row).toMatchObject({
      runId: 'run-1',
      tokenId: TOKEN,
      strategyKey: 'trend_pullback',
      strategyVersion: 1,
      amount: ledger.positions[TOKEN]?.amount,
      costBasisUsd: ledger.positions[TOKEN]?.costBasisUsd,
      // The projection keeps the exact tick mark, not the 8-decimal display.
      marketPriceUsd: exactMark,
      marketValueUsd: marked.positions[0]?.marketValueUsd,
      entryIntentId: 'intent-1',
      feesPaidUsd: ledger.positions[TOKEN]?.feesPaidUsd,
    });
    expect(row.openedAt.getTime()).toBe(AT);
  });

  it('rejects a position without a mark', () => {
    const ledger = buyLedger();

    expect(() => buildSandboxPositionRows('run-1', ledger, [], {})).toThrow(/missing mark/);
  });

  it('computes delete-free tombstones for closed positions', () => {
    expect(
      buildSandboxClosedPositionTokenIds(['token-a', 'token-b', 'token-a'], ['token-b']),
    ).toEqual(['token-a']);
  });

  it('projects the open trade and ledger entries from the ledger', () => {
    const ledger = buyLedger();
    const trades = buildSandboxTradeRows('run-1', ledger);
    const entries = buildSandboxLedgerEntryRows('run-1', ledger);

    expect(trades).toHaveLength(1);
    expect(trades[0]).toMatchObject({
      runId: 'run-1',
      tradeId: 'intent-1:trade',
      tokenId: TOKEN,
      status: 'open',
      entryIntentId: 'intent-1',
      exitAt: null,
      exitPriceUsd: null,
    });

    expect(entries).toHaveLength(ledger.entries.length);
    expect(entries[0]).toMatchObject({
      runId: 'run-1',
      sequence: 1,
      entryId: 'intent-1:ledger',
      tokenId: TOKEN,
      side: 'buy',
      intentId: 'intent-1',
      cashAfterUsd: ledger.cashUsd,
      reasonCode: Reason.LEDGER_BUY,
      realizedPnlUsd: null,
      costBasisReleasedUsd: null,
    });
    expect(entries[0]?.clockTime.getTime()).toBe(AT);
  });

  it('rejects duplicate trade ids before they reach Postgres', () => {
    const ledger = buyLedger();
    const trade = ledger.openTrades[TOKEN];
    if (!trade) throw new Error('fixture has no open trade');
    const duplicated = {
      ...ledger,
      closedTrades: [{ ...trade, status: 'closed' as const }],
    };

    expect(() => buildSandboxTradeRows('run-1', duplicated)).toThrow(
      /duplicate tradeId across closed and open trades/,
    );
  });

  it('rejects duplicate intent ids before they reach Postgres', () => {
    const intent = {
      intentId: 'intent-1',
      tokenId: TOKEN,
      side: 'buy' as const,
      strategyKey: 'trend_pullback' as const,
      strategyVersion: 1,
      status: 'filled' as const,
      requestedUsd: '200.00',
      requestedAmount: null,
      filledUsd: '199.50',
      filledAmount: '1.99500000',
      priceUsd: '100.00000000',
      feeUsd: '0.50',
      reasonCode: Reason.FILL_FILLED,
      strategyReasonCode: Reason.TREND_PULLBACK_ENTRY,
      reasonText: 'filled',
      decisionTime: AT,
      fillTime: AT,
    };

    expect(() => buildSandboxIntentRows('run-1', [intent, intent])).toThrow(
      /duplicate intentId in one tick/,
    );
  });

  it('projects intents and the equity point', () => {
    const intents = buildSandboxIntentRows('run-1', [
      {
        intentId: 'intent-1',
        tokenId: TOKEN,
        side: 'buy',
        strategyKey: 'trend_pullback',
        strategyVersion: 1,
        status: 'filled',
        requestedUsd: '200.00',
        requestedAmount: null,
        filledUsd: '200.00',
        filledAmount: '2.00000000',
        priceUsd: '100.00000000',
        feeUsd: '0.50',
        reasonCode: Reason.FILL_FILLED,
        strategyReasonCode: Reason.TREND_PULLBACK_ENTRY,
        reasonText: 'filled',
        decisionTime: AT,
        fillTime: AT + 3_600_000,
      },
    ]);
    const equity = buildSandboxEquityPointRow('run-1', {
      clockTime: AT,
      equityUsd: '1000.00',
      cashUsd: '800.00',
      positionsValueUsd: '200.00',
      drawdownPct: '0.00',
    });

    expect(intents[0]).toMatchObject({
      runId: 'run-1',
      intentId: 'intent-1',
      status: 'filled',
      strategyReasonCode: Reason.TREND_PULLBACK_ENTRY,
      fillTime: new Date(AT + 3_600_000),
    });
    expect(equity).toEqual({
      runId: 'run-1',
      clockTime: new Date(AT),
      equityUsd: '1000.00',
      cashUsd: '800.00',
      positionsValueUsd: '200.00',
      drawdownPct: '0.00',
    });
  });
});

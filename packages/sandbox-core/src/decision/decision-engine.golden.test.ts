import Decimal from 'decimal.js';
import { describe, expect, it } from 'vitest';
import { SimulationClock } from '../clock';
import { ClockedMarketView } from '../data/market-view';
import { snapshotCandles } from '../data/snapshot';
import { MemoryEventLog } from '../events/memory-event-log';
import type { SandboxEvent } from '../events/event-types';
import { TIMEFRAME_MS, candleCloseTime } from '../timeframes';
import type { Candle, Timestamp } from '../types';
import { DecisionEngine } from './decision-engine';
import { DEFAULT_SETTINGS, EMPTY_ENGINE_STATE } from './defaults';
import { makeCandlesFromCloses } from './fixtures.test-helpers';
import type {
  EngineState,
  OrderIntent,
  PortfolioPosition,
  PortfolioSnapshot,
  StrategyKey,
  TokenRuntimeState,
} from './types';

/**
 * Golden multi-bar replay for the Stage 1B decision engine.
 *
 * This is the end-to-end determinism contract: three tokens, 400 closed 1h bars,
 * a bar-by-bar test host that fills intents at the decision price with no fees
 * (test-only; Stage 1C owns real fills, ledger and equity), and a pinned final
 * event hash. Two independent replays must produce byte-identical intents and
 * the same final hash; the hash, event count and intent list are literals below.
 *
 * The host is intentionally dumb: it marks positions to the current close,
 * applies the intent at `decisionPriceUsd`, and passes the engine state forward.
 * It never computes a strategy signal, never reorders tokens and never reads the
 * wall clock. A golden hash change is a contract change, not a test fix.
 */

const HOUR = TIMEFRAME_MS['1h'] as number;
const START = Date.UTC(2026, 0, 1);
const RUN_ID = 'golden-run-7';
const SEED = 7;
const CONFIG_VERSION = 'golden-config-v1';
const TOKEN_IDS = ['AAA', 'BBB', 'CCC'] as const;
const BAR_COUNT = 400;

/** 24 samples of `sin(2*pi*i/24)` so the range fixture needs no Math.sin. */
const SINE_24 = [
  0, 0.2588190451, 0.5, 0.7071067812, 0.8660254038, 0.9659258263, 1, 0.9659258263, 0.8660254038,
  0.7071067812, 0.5, 0.2588190451, 0, -0.2588190451, -0.5, -0.7071067812, -0.8660254038,
  -0.9659258263, -1, -0.9659258263, -0.8660254038, -0.7071067812, -0.5, -0.2588190451,
] as const;

/** Appends `bars` compound-growth closes and returns the next starting price. */
function appendRise(closes: number[], startPrice: number, bars: number, stepPct = 0.1): number {
  let price = startPrice;
  for (let index = 0; index < bars; index += 1) {
    closes.push(price);
    price *= 1 + stepPct / 100;
  }
  return price;
}

/**
 * AAA: 175 up, 6 down ~4%, 80 up, one -13% crash bar, 138 recovery bars.
 *
 * The pullback sits immediately after the 169-bar regime warmup, before any
 * other token trades, so the first buy lands on an untouched 1000.00 USD
 * portfolio. The single crash bar pushes the 168-bar drawdown past 12%, so
 * CRASH is adopted without dwell and the open trend position is exited by its
 * ATR stop inside the hostile regime.
 */
function aaaCloses(): number[] {
  const closes: number[] = [];
  let price = appendRise(closes, 100, 175);
  for (let index = 0; index < 6; index += 1) {
    price *= 0.9932;
    closes.push(price);
  }
  price = appendRise(closes, price, 80);
  price *= 0.87;
  closes.push(price);
  appendRise(closes, price, 138);
  return closes;
}

/**
 * BBB: a deterministic 24-bar sine around 50 with +/-3% amplitude.
 *
 * A 24-bar period is deliberate. With the 24-bar fast SMA and the 168-bar slow
 * SMA (exactly seven complete cycles), the fast SMA equals the slow SMA, so the
 * classifier sees a stable RANGE while price still trades from the lower band to
 * the midpoint. A 48-bar period would make the fast SMA lead the slow SMA by
 * +/-1.9%, above `rangeSpreadPct` (0.75%), and the raw regime would be TREND_DOWN
 * exactly at the lower band, so the range strategy could never enter.
 */
function bbbCloses(): number[] {
  const closes: number[] = [];
  for (let index = 0; index < BAR_COUNT; index += 1) {
    const sample = SINE_24[index % SINE_24.length] ?? 0;
    closes.push(50 * (1 + 0.03 * sample));
  }
  return closes;
}

/** CCC: 180 up, 40 down ~25%, 180 recovery bars with no full drawdown reset. */
function cccCloses(): number[] {
  const closes: number[] = [];
  let price = appendRise(closes, 100, 180);
  for (let index = 0; index < 40; index += 1) {
    price *= 0.9928;
    closes.push(price);
  }
  appendRise(closes, price, 180);
  return closes;
}

function scenarioCandles(): Candle[] {
  return [
    ...makeCandlesFromCloses(aaaCloses(), { tokenId: 'AAA', start: START, volumeUsd: 100_000 }),
    ...makeCandlesFromCloses(bbbCloses(), { tokenId: 'BBB', start: START, volumeUsd: 100_000 }),
    ...makeCandlesFromCloses(cccCloses(), { tokenId: 'CCC', start: START, volumeUsd: 100_000 }),
  ];
}

/** One bar close time; all three tokens share the same 1h grid. */
function barCloseTime(index: number): Timestamp {
  return START + index * HOUR + HOUR;
}

interface HostPosition {
  readonly tokenId: string;
  readonly strategyKey: StrategyKey;
  readonly strategyVersion: number;
  readonly amount: Decimal;
  readonly avgCostUsd: Decimal;
  readonly openedAt: Timestamp;
  readonly stopLossPct: string | null;
  readonly takeProfitPct: string | null;
}

interface IntentSummary {
  readonly tokenId: string;
  readonly side: 'buy' | 'sell';
  readonly reasonCode: string;
  readonly sizeUsd: string;
  readonly amount: string | null;
}

interface ReplayResult {
  readonly events: readonly SandboxEvent[];
  readonly intents: readonly IntentSummary[];
  readonly finalHash: string;
  readonly finalState: EngineState;
  readonly finalEquityUsd: string;
  readonly finalCashUsd: string;
  readonly positionsAtEnd: readonly string[];
}

function closeDecimals(candles: readonly Candle[]): Map<string, Decimal> {
  const map = new Map<string, Decimal>();
  for (const candle of candles) {
    const closeTime = candleCloseTime(candle);
    const key = `${candle.tokenId}|${closeTime}`;
    map.set(key, new Decimal(candle.close));
  }
  return map;
}

function dayOf(timestamp: Timestamp): string {
  return new Date(timestamp).toISOString().slice(0, 10);
}

function money(value: Decimal): string {
  return value.toFixed(2);
}

function snapshotOf(
  cash: Decimal,
  equity: Decimal,
  dayStart: Decimal,
  peak: Decimal,
  positions: readonly HostPosition[],
  closes: ReadonlyMap<string, Decimal>,
  now: Timestamp,
): PortfolioSnapshot {
  const mapped: PortfolioPosition[] = positions.map((position) => {
    const close = closes.get(`${position.tokenId}|${now}`);
    if (close === undefined) {
      throw new Error(`Missing mark for ${position.tokenId} at ${String(now)}`);
    }
    return {
      tokenId: position.tokenId,
      strategyKey: position.strategyKey,
      strategyVersion: position.strategyVersion,
      amount: position.amount.toFixed(8),
      avgCostUsd: position.avgCostUsd.toFixed(8),
      marketPriceUsd: close.toFixed(8),
      marketValueUsd: money(position.amount.times(close)),
      openedAt: position.openedAt,
      stopLossPct: position.stopLossPct,
      takeProfitPct: position.takeProfitPct,
    };
  });
  return {
    equityUsd: money(equity),
    cashUsd: money(cash),
    dayStartEquityUsd: money(dayStart),
    peakEquityUsd: money(peak),
    positions: mapped,
  };
}

function assertNoLookAhead(
  view: ClockedMarketView,
  candles: readonly Candle[],
  index: number,
  now: Timestamp,
): void {
  for (const tokenId of TOKEN_IDS) {
    const visible = view.candles(tokenId, '1h');
    if (visible.length !== index + 1) {
      throw new Error(
        `Look-ahead: ${tokenId} exposed ${String(visible.length)} candles at bar ${String(index)}, expected ${String(index + 1)}`,
      );
    }
    const last = visible[visible.length - 1];
    const expected = candles.find(
      (candle) => candle.tokenId === tokenId && candleCloseTime(candle) === now,
    );
    if (last === undefined || expected === undefined || last.close !== expected.close) {
      throw new Error(`Look-ahead: ${tokenId} latest candle does not match bar ${String(index)}`);
    }
  }
}

/** Replays the whole 400-bar scenario and returns the observable outcome. */
async function replay(): Promise<ReplayResult> {
  const candles = scenarioCandles();
  const snapshot = snapshotCandles(candles);
  const closes = closeDecimals(snapshot.candles);
  const clock = new SimulationClock(barCloseTime(0));
  const market = new ClockedMarketView(snapshot.candles, clock, snapshot.id);
  const log = new MemoryEventLog();
  const engine = new DecisionEngine(log);

  let cash = new Decimal('1000');
  let equity = new Decimal('1000');
  let dayStart = new Decimal('1000');
  let peak = new Decimal('1000');
  let state: EngineState = EMPTY_ENGINE_STATE;
  let currentDay = dayOf(barCloseTime(0));
  const positions = new Map<string, HostPosition>();
  const intents: IntentSummary[] = [];

  for (let index = 0; index < BAR_COUNT; index += 1) {
    const now = barCloseTime(index);
    clock.advanceTo(now);
    assertNoLookAhead(market, snapshot.candles, index, now);

    // Mark every open position to the current close; equity is cash plus marks.
    let markedValue = new Decimal(0);
    for (const position of positions.values()) {
      const close = closes.get(`${position.tokenId}|${now}`);
      if (close === undefined) throw new Error(`Missing mark for ${position.tokenId}`);
      markedValue = markedValue.plus(position.amount.times(close));
    }
    equity = cash.plus(markedValue);

    const day = dayOf(now);
    if (day !== currentDay) {
      currentDay = day;
      dayStart = equity;
    }
    if (equity.greaterThan(peak)) peak = equity;

    const portfolio = snapshotOf(
      cash,
      equity,
      dayStart,
      peak,
      [...positions.values()],
      closes,
      now,
    );
    const result = await engine.decide({
      runId: RUN_ID,
      seed: SEED,
      configVersion: CONFIG_VERSION,
      dataSnapshotId: snapshot.id,
      clockTime: now,
      tokenIds: TOKEN_IDS,
      market,
      portfolio,
      state,
      settings: DEFAULT_SETTINGS,
    });
    state = result.state;

    const seen = new Set<string>();
    for (const intent of result.intents) {
      if (seen.has(intent.tokenId)) {
        throw new Error(`Duplicate intent for ${intent.tokenId} in one cycle at ${String(now)}`);
      }
      seen.add(intent.tokenId);
      applyIntent(intent, positions, (delta) => {
        cash = cash.plus(delta);
      });
      intents.push({
        tokenId: intent.tokenId,
        side: intent.side,
        reasonCode: intent.reasonCode,
        sizeUsd: intent.sizeUsd,
        amount: intent.amount,
      });
    }
  }

  return {
    events: log.events(),
    intents,
    finalHash: log.hash(),
    finalState: state,
    finalEquityUsd: money(equity),
    finalCashUsd: money(cash),
    positionsAtEnd: [...positions.keys()].sort(),
  };
}

/**
 * Applies one intent at its decision price with no fees. Buys never add to an
 * existing position, and sells always remove the whole position: the host
 * enforces the "no adds" contract independently of the engine.
 */
function applyIntent(
  intent: OrderIntent,
  positions: Map<string, HostPosition>,
  adjustCash: (delta: Decimal) => void,
): void {
  const price = new Decimal(intent.decisionPriceUsd);
  if (intent.side === 'buy') {
    if (positions.has(intent.tokenId)) {
      throw new Error(`Buy intent for ${intent.tokenId} while a position is already open`);
    }
    const size = new Decimal(intent.sizeUsd);
    const amount = size.div(price).toFixed(8);
    adjustCash(size.negated());
    positions.set(intent.tokenId, {
      tokenId: intent.tokenId,
      strategyKey: intent.strategyKey,
      strategyVersion: intent.strategyVersion,
      amount: new Decimal(amount),
      avgCostUsd: price,
      openedAt: intent.clockTime,
      stopLossPct: intent.stopLossPct,
      takeProfitPct: intent.takeProfitPct,
    });
    return;
  }

  const position = positions.get(intent.tokenId);
  if (position === undefined) {
    throw new Error(`Sell intent for ${intent.tokenId} without an open position`);
  }
  if (intent.amount !== position.amount.toFixed(8)) {
    throw new Error(`Sell intent amount does not match the host position for ${intent.tokenId}`);
  }
  adjustCash(position.amount.times(price));
  positions.delete(intent.tokenId);
}

function regimeOf(event: SandboxEvent): string | null {
  const after = event.stateAfter as { regime?: unknown } | null;
  return typeof after?.regime === 'string' ? after.regime : null;
}

function tokenOf(event: SandboxEvent): string {
  return event.tokenId ?? '';
}

describe('DecisionEngine golden multi-bar replay', () => {
  it('produces a deterministic, risk-checked, fully explained intent stream', async () => {
    const first = await replay();
    const second = await replay();

    // --- Determinism and pinned contract values --------------------------------
    expect(second.intents).toEqual(first.intents);
    expect(second.finalHash).toBe(first.finalHash);
    expect(second.events.length).toBe(first.events.length);

    const finalHash = first.finalHash;
    expect(finalHash).toMatch(/^[0-9a-f]{64}$/);
    expect(finalHash).toBe('b260f984250cf2cca57610a3fe47c85d91d5f93c26472818f2e21f564226847a');
    expect(first.events.length).toBe(3936);
    expect(
      first.intents.map(({ tokenId, side, reasonCode, sizeUsd }) => ({
        tokenId,
        side,
        reasonCode,
        sizeUsd,
      })),
    ).toEqual([
      { tokenId: 'AAA', side: 'buy', reasonCode: 'TREND_PULLBACK_ENTRY', sizeUsd: '200.00' },
      { tokenId: 'BBB', side: 'buy', reasonCode: 'RANGE_REVERSION_ENTRY', sizeUsd: '199.76' },
      { tokenId: 'CCC', side: 'buy', reasonCode: 'TREND_PULLBACK_ENTRY', sizeUsd: '199.40' },
      { tokenId: 'BBB', side: 'sell', reasonCode: 'RANGE_REVERSION_STOP', sizeUsd: '196.93' },
      { tokenId: 'BBB', side: 'buy', reasonCode: 'RANGE_REVERSION_ENTRY', sizeUsd: '198.78' },
      { tokenId: 'CCC', side: 'sell', reasonCode: 'TREND_PULLBACK_STOP', sizeUsd: '195.12' },
      { tokenId: 'CCC', side: 'buy', reasonCode: 'TREND_PULLBACK_ENTRY', sizeUsd: '197.47' },
      { tokenId: 'CCC', side: 'sell', reasonCode: 'TREND_PULLBACK_STOP', sizeUsd: '191.84' },
      { tokenId: 'BBB', side: 'sell', reasonCode: 'RANGE_REVERSION_MID', sizeUsd: '206.52' },
      { tokenId: 'BBB', side: 'buy', reasonCode: 'RANGE_REVERSION_ENTRY', sizeUsd: '199.73' },
      { tokenId: 'BBB', side: 'sell', reasonCode: 'RANGE_REVERSION_STOP', sizeUsd: '196.90' },
      { tokenId: 'BBB', side: 'buy', reasonCode: 'RANGE_REVERSION_ENTRY', sizeUsd: '199.33' },
      { tokenId: 'BBB', side: 'sell', reasonCode: 'RANGE_REVERSION_MID', sizeUsd: '207.09' },
      { tokenId: 'BBB', side: 'buy', reasonCode: 'RANGE_REVERSION_ENTRY', sizeUsd: '201.70' },
      { tokenId: 'BBB', side: 'sell', reasonCode: 'RANGE_REVERSION_STOP', sizeUsd: '198.84' },
      { tokenId: 'BBB', side: 'buy', reasonCode: 'RANGE_REVERSION_ENTRY', sizeUsd: '201.30' },
      { tokenId: 'BBB', side: 'sell', reasonCode: 'RANGE_REVERSION_MID', sizeUsd: '209.14' },
      { tokenId: 'BBB', side: 'buy', reasonCode: 'RANGE_REVERSION_ENTRY', sizeUsd: '203.71' },
      { tokenId: 'BBB', side: 'sell', reasonCode: 'RANGE_REVERSION_STOP', sizeUsd: '200.82' },
      { tokenId: 'BBB', side: 'buy', reasonCode: 'RANGE_REVERSION_ENTRY', sizeUsd: '203.30' },
      { tokenId: 'AAA', side: 'sell', reasonCode: 'TREND_PULLBACK_STOP', sizeUsd: '187.20' },
      { tokenId: 'BBB', side: 'sell', reasonCode: 'RANGE_REVERSION_MID', sizeUsd: '211.21' },
      { tokenId: 'BBB', side: 'buy', reasonCode: 'RANGE_REVERSION_ENTRY', sizeUsd: '199.42' },
      { tokenId: 'BBB', side: 'sell', reasonCode: 'RANGE_REVERSION_STOP', sizeUsd: '196.59' },
      { tokenId: 'BBB', side: 'buy', reasonCode: 'RANGE_REVERSION_ENTRY', sizeUsd: '198.86' },
      { tokenId: 'BBB', side: 'sell', reasonCode: 'RANGE_REVERSION_MID', sizeUsd: '206.60' },
      { tokenId: 'AAA', side: 'buy', reasonCode: 'RECOVERY_ENTRY', sizeUsd: '167.00' },
      { tokenId: 'BBB', side: 'buy', reasonCode: 'RANGE_REVERSION_ENTRY', sizeUsd: '200.77' },
      { tokenId: 'BBB', side: 'sell', reasonCode: 'RANGE_REVERSION_STOP', sizeUsd: '197.92' },
      { tokenId: 'BBB', side: 'buy', reasonCode: 'RANGE_REVERSION_ENTRY', sizeUsd: '200.34' },
      { tokenId: 'BBB', side: 'sell', reasonCode: 'RANGE_REVERSION_MID', sizeUsd: '208.14' },
      { tokenId: 'BBB', side: 'buy', reasonCode: 'RANGE_REVERSION_ENTRY', sizeUsd: '202.58' },
      { tokenId: 'BBB', side: 'sell', reasonCode: 'RANGE_REVERSION_STOP', sizeUsd: '199.71' },
      { tokenId: 'BBB', side: 'buy', reasonCode: 'RANGE_REVERSION_ENTRY', sizeUsd: '202.15' },
      { tokenId: 'BBB', side: 'sell', reasonCode: 'RANGE_REVERSION_MID', sizeUsd: '210.02' },
      { tokenId: 'BBB', side: 'buy', reasonCode: 'RANGE_REVERSION_ENTRY', sizeUsd: '204.42' },
      { tokenId: 'BBB', side: 'sell', reasonCode: 'RANGE_REVERSION_STOP', sizeUsd: '201.52' },
      { tokenId: 'BBB', side: 'buy', reasonCode: 'RANGE_REVERSION_ENTRY', sizeUsd: '203.98' },
      { tokenId: 'CCC', side: 'buy', reasonCode: 'RECOVERY_ENTRY', sizeUsd: '170.19' },
      { tokenId: 'BBB', side: 'sell', reasonCode: 'RANGE_REVERSION_MID', sizeUsd: '211.92' },
      { tokenId: 'BBB', side: 'buy', reasonCode: 'RANGE_REVERSION_ENTRY', sizeUsd: '206.91' },
      { tokenId: 'BBB', side: 'sell', reasonCode: 'RANGE_REVERSION_STOP', sizeUsd: '203.97' },
      { tokenId: 'BBB', side: 'buy', reasonCode: 'RANGE_REVERSION_ENTRY', sizeUsd: '206.61' },
      { tokenId: 'BBB', side: 'sell', reasonCode: 'RANGE_REVERSION_MID', sizeUsd: '214.65' },
      { tokenId: 'BBB', side: 'buy', reasonCode: 'RANGE_REVERSION_ENTRY', sizeUsd: '209.65' },
    ]);

    // --- Behavioural coverage --------------------------------------------------
    const buys = first.intents.filter((intent) => intent.side === 'buy');
    const sells = first.intents.filter((intent) => intent.side === 'sell');
    expect(buys.length).toBeGreaterThan(0);
    expect(sells.length).toBeGreaterThan(0);

    const eventTypes = new Set(first.events.map((event) => event.eventType));
    expect(eventTypes.has('strategy.skipped')).toBe(true);
    const blockedTokenViews = first.events.filter(
      (event) =>
        event.eventType === 'token.state_changed' &&
        (event.stateAfter as { phase?: unknown } | null)?.phase === 'BLOCKED',
    );
    expect(blockedTokenViews.length).toBeGreaterThan(0);

    // Every buy was proposed by an eligible strategy, every sell closed an
    // open position with that same original strategy (no add, no orphan sell).
    expect(new Set(buys.map((intent) => intent.tokenId))).toEqual(new Set(['AAA', 'BBB', 'CCC']));
    expect(buys.some((intent) => intent.reasonCode === 'TREND_PULLBACK_ENTRY')).toBe(true);
    expect(buys.some((intent) => intent.reasonCode === 'RANGE_REVERSION_ENTRY')).toBe(true);
    expect(buys.some((intent) => intent.reasonCode === 'RECOVERY_ENTRY')).toBe(true);
    expect(sells.some((intent) => intent.reasonCode === 'TREND_PULLBACK_STOP')).toBe(true);
    expect(sells.some((intent) => intent.reasonCode === 'RANGE_REVERSION_MID')).toBe(true);

    // Deterministic money serialization in every pin.
    for (const intent of first.intents) {
      expect(intent.sizeUsd).toMatch(/^\d+\.\d{2}$/);
      if (intent.amount !== null) expect(intent.amount).toMatch(/^\d+\.\d{8}$/);
    }

    // The AAA trend position is stopped out on the bar where CRASH is adopted:
    // an open position keeps its original strategy in a hostile regime.
    const aaaStop = first.events.find(
      (event) =>
        event.eventType === 'order.intent' &&
        tokenOf(event) === 'AAA' &&
        event.decision?.action === 'sell',
    );
    expect(aaaStop).toBeDefined();
    const aaaStopClock = (aaaStop as SandboxEvent).clockTime;
    const aaaStopRegime = first.events.find(
      (event) =>
        event.eventType === 'regime.evaluated' &&
        tokenOf(event) === 'AAA' &&
        event.clockTime === aaaStopClock,
    );
    expect(regimeOf(aaaStopRegime as SandboxEvent)).toBe('CRASH');

    // Positions still open at the end: the engine emits no force-close in 1B.
    expect(first.positionsAtEnd).toEqual(['AAA', 'BBB', 'CCC']);

    // --- Regime priority, hysteresis and recovery confirmation -----------------
    const regimeEvaluated = first.events.filter((event) => event.eventType === 'regime.evaluated');
    expect(regimeEvaluated.length).toBe(BAR_COUNT * TOKEN_IDS.length);
    for (const tokenId of TOKEN_IDS) {
      const firstRegime = regimeEvaluated.find((event) => tokenOf(event) === tokenId);
      expect(firstRegime).toBeDefined();
      expect(firstRegime?.reasonCode).toBe('REGIME_INSUFFICIENT_HISTORY');
      expect(regimeOf(firstRegime as SandboxEvent)).toBe('ILLIQUID');
    }

    // CRASH bypasses the 3-bar dwell: adopted on the first bar it is raw.
    const crashChanges = first.events.filter(
      (event) => event.eventType === 'regime.changed' && regimeOf(event) === 'CRASH',
    );
    expect(crashChanges.map(tokenOf).sort()).toEqual(['AAA', 'CCC']);
    for (const change of crashChanges) {
      const inputs = change.inputs as { rawRegime?: unknown };
      expect(inputs.rawRegime).toBe('CRASH');
    }

    // Non-crash/non-illiquid changes need `regimeDwellBars` (3) confirmations.
    // On the adopting bar the previous state already counted dwell-1 bars.
    const prematureAdoptions = first.events.filter((event) => {
      if (event.eventType !== 'regime.changed') return false;
      const after = regimeOf(event);
      if (after === 'CRASH' || after === 'ILLIQUID') return false;
      const before = event.stateBefore as { candidate?: unknown; candidateBars?: unknown } | null;
      if (before === null || before.candidate !== after || typeof before.candidateBars !== 'number')
        return true;
      return before.candidateBars + 1 < 3;
    });
    expect(prematureAdoptions).toEqual([]);

    // RECOVERY appears only after a CRASH/TREND_DOWN and only with confirmation.
    const recoveryChanges = first.events.filter(
      (event) => event.eventType === 'regime.changed' && regimeOf(event) === 'RECOVERY',
    );
    expect(recoveryChanges.length).toBeGreaterThan(0);
    for (const change of recoveryChanges) {
      const before = eventRegime(change.stateBefore);
      expect(before === 'CRASH' || before === 'TREND_DOWN').toBe(true);
    }

    // --- Risk audit: every intent has a passing, complete preceding check ------
    const expectedBuyChecks = [
      'max_positions',
      'max_token_exposure',
      'max_strategy_exposure',
      'cash_buffer',
      'daily_loss_limit',
      'max_drawdown',
      'per_trade_risk',
      'liquidity',
      'data_stale',
      'cooldown',
      'token_blocked',
      'size_too_small',
    ];
    const expectedSellChecks = ['data_stale', 'liquidity'];
    const lastRisk = new Map<string, SandboxEvent>();
    let intentChecked = 0;

    for (const event of first.events) {
      if (event.eventType === 'risk.checked') {
        const kind = (event.inputs as { kind?: unknown }).kind;
        if (kind === 'buy' || kind === 'sell') {
          lastRisk.set(`${tokenOf(event)}:${kind}`, event);
        }
        continue;
      }
      if (event.eventType !== 'order.intent') continue;
      const decision = event.decision;
      expect(decision).not.toBeNull();
      const side = decision?.action;
      expect(side === 'buy' || side === 'sell').toBe(true);
      const risk = lastRisk.get(`${tokenOf(event)}:${String(side)}`);
      expect(risk).toBeDefined();
      if (risk === undefined) throw new Error('unreachable');
      expect(risk.decision?.action).toBe(side);
      // Strict audit adjacency: the risk check that authorised this order is the
      // event immediately before it in the same cycle.
      expect(risk.seq).toBe(event.seq - 1);
      expect(risk.clockTime).toBe(event.clockTime);
      const checks = risk.riskChecks ?? [];
      expect(checks.map((check) => check.name)).toEqual(
        side === 'buy' ? expectedBuyChecks : expectedSellChecks,
      );
      expect(checks.every((check) => check.passed)).toBe(true);
      expect(risk.reasonCode).toBe('RISK_PASSED');
      intentChecked += 1;
    }
    expect(intentChecked).toBe(first.intents.length);

    // F1 regression guard: every sized candidate survives the risk veto, so the
    // allocator and the risk manager cannot disagree at a rounding boundary.
    const riskBlocked = first.events.filter(
      (event) => event.eventType === 'risk.checked' && event.decision?.action === 'block',
    );
    expect(riskBlocked).toEqual([]);

    // Sells are structurally exempt from daily-loss and drawdown vetoes.
    const sellRisk = first.events.filter(
      (event) =>
        event.eventType === 'risk.checked' && (event.inputs as { kind?: unknown }).kind === 'sell',
    );
    expect(sellRisk.length).toBe(sells.length);
    for (const event of sellRisk) {
      const names = (event.riskChecks ?? []).map((check) => check.name);
      expect(names).not.toContain('daily_loss_limit');
      expect(names).not.toContain('max_drawdown');
      expect(names).not.toContain('cooldown');
    }

    // --- Audit completeness: every decision has a reason and an alternative ----
    const decisions = first.events.filter((event) => event.decision !== null);
    expect(decisions.length).toBeGreaterThan(0);
    for (const event of decisions) {
      expect(typeof event.decision?.reasonCode).toBe('string');
      expect((event.decision?.reasonCode ?? '').length).toBeGreaterThan(0);
      expect((event.alternatives ?? []).length).toBeGreaterThan(0);
      expect((event.reasonCode ?? '').length).toBeGreaterThan(0);
    }

    // --- Token phase and state continuity -------------------------------------
    const nextTokens = first.finalState.tokens;
    expect(Object.keys(nextTokens).sort()).toEqual(['AAA', 'BBB', 'CCC']);
    for (const tokenId of TOKEN_IDS) {
      const tokenState = nextTokens[tokenId] as TokenRuntimeState;
      expect(tokenState.tokenId).toBe(tokenId);
      expect(typeof tokenState.strategyState).toBe('object');
    }
    // Equity is the host's mark-to-market sum, not an engine output; the literal
    // is pinned so the summary table in the review packet stays true.
    expect(first.finalEquityUsd).toBe('1047.32');
  });
});

function eventRegime(value: SandboxEvent['stateBefore']): string | null {
  if (value === null) return null;
  const regime = value.regime;
  return typeof regime === 'string' ? regime : null;
}

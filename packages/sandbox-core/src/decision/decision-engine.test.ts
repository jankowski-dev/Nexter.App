import { describe, expect, it } from 'vitest';
import { SimulationClock } from '../clock';
import { ClockedMarketView } from '../data/market-view';
import { MemoryEventLog } from '../events/memory-event-log';
import type { SandboxEvent } from '../events/event-types';
import { TIMEFRAME_MS, candleCloseTime } from '../timeframes';
import type { Candle, Timestamp } from '../types';
import { DecisionEngine, DecisionInputError } from './decision-engine';
import { DecisionLogger } from './decision-logger';
import { DEFAULT_SETTINGS, REGIME_RULES_VERSION, settingsVersion } from './defaults';
import { makeCandlesFromCloses, makeSeries } from './fixtures.test-helpers';
import { Reason } from './reason-codes';
import type {
  DecisionInput,
  DecisionResult,
  EngineState,
  PortfolioPosition,
  PortfolioSnapshot,
  Regime,
  RegimeState,
  SandboxDecisionSettings,
  TokenRuntimeState,
} from './types';

const HOUR = TIMEFRAME_MS['1h'] as number;
const START = Date.UTC(2026, 0, 1);
const RUN_ID = 'run-7';
const SEED = 7;
const CONFIG_VERSION = 'config-7';
const SNAPSHOT_ID = 'snapshot-7';

function lastCloseTime(candles: readonly Candle[]): Timestamp {
  let latest = Number.NEGATIVE_INFINITY;
  for (const candle of candles) {
    const closeTime = candleCloseTime(candle);
    if (closeTime > latest) latest = closeTime;
  }
  return latest;
}

function marketOf(
  candles: readonly Candle[],
  now: Timestamp,
  snapshotId = SNAPSHOT_ID,
): ClockedMarketView {
  return new ClockedMarketView(candles, new SimulationClock(now), snapshotId);
}

function portfolio(
  options: {
    equity?: string;
    cash?: string;
    dayStart?: string;
    peak?: string;
    positions?: readonly PortfolioPosition[];
  } = {},
): PortfolioSnapshot {
  const equity = options.equity ?? '10000';
  return {
    equityUsd: equity,
    cashUsd: options.cash ?? equity,
    dayStartEquityUsd: options.dayStart ?? equity,
    peakEquityUsd: options.peak ?? equity,
    positions: options.positions ?? [],
  };
}

function position(tokenId: string, overrides: Partial<PortfolioPosition> = {}): PortfolioPosition {
  return {
    tokenId,
    strategyKey: 'trend_pullback',
    strategyVersion: 1,
    amount: '100',
    avgCostUsd: '1',
    marketPriceUsd: '1',
    marketValueUsd: '100',
    openedAt: START,
    stopLossPct: null,
    takeProfitPct: null,
    ...overrides,
  };
}

function emptyFeatures(): RegimeState['features'] {
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

function regimeState(regime: Regime, overrides: Partial<RegimeState> = {}): RegimeState {
  return {
    regime,
    reasonCode: Reason.REGIME_HELD,
    candidate: null,
    candidateBars: 0,
    since: START,
    rulesVersion: REGIME_RULES_VERSION,
    features: emptyFeatures(),
    ...overrides,
  };
}

function tokenState(
  tokenId: string,
  regime: Regime,
  overrides: Partial<TokenRuntimeState> = {},
): TokenRuntimeState {
  return {
    tokenId,
    regime: regimeState(regime),
    phase: 'SLEEPING',
    cooldownUntil: null,
    strategyState: {},
    ...overrides,
  };
}

function engineState(tokens: readonly TokenRuntimeState[]): EngineState {
  const record: Record<string, TokenRuntimeState> = {};
  for (const token of tokens) record[token.tokenId] = token;
  return { tokens: record };
}

function decisionInput(options: {
  candles?: readonly Candle[];
  now?: Timestamp;
  clockTime?: Timestamp;
  tokenIds?: readonly string[];
  portfolio?: PortfolioSnapshot;
  state?: EngineState;
  settings?: SandboxDecisionSettings;
  snapshotId?: string;
  seed?: number;
}): DecisionInput {
  const candles = options.candles ?? [];
  const now = options.now ?? START + 220 * HOUR;
  return {
    runId: RUN_ID,
    seed: options.seed ?? SEED,
    configVersion: CONFIG_VERSION,
    dataSnapshotId: SNAPSHOT_ID,
    clockTime: options.clockTime ?? now,
    tokenIds: options.tokenIds ?? [],
    market: marketOf(candles, now, options.snapshotId ?? SNAPSHOT_ID),
    portfolio: options.portfolio ?? portfolio(),
    state: options.state ?? { tokens: {} },
    settings: options.settings ?? DEFAULT_SETTINGS,
  };
}

interface DecideOptions {
  readonly candles: readonly Candle[];
  readonly now?: Timestamp;
  readonly clockTime?: Timestamp;
  readonly tokenIds: readonly string[];
  readonly portfolio?: PortfolioSnapshot;
  readonly state?: EngineState;
  readonly settings?: SandboxDecisionSettings;
  readonly snapshotId?: string;
  readonly seed?: number;
}

async function decide(options: DecideOptions): Promise<{
  readonly log: MemoryEventLog;
  readonly result: DecisionResult;
  readonly input: DecisionInput;
}> {
  const log = new MemoryEventLog();
  const engine = new DecisionEngine(log);
  const input = decisionInput(options);
  const result = await engine.decide(input);
  return { log, result, input };
}

/** A steady uptrend followed by one pullback bar that triggers trend-pullback entry. */
function trendPullbackCloses(count: number, dropPct = 4.5, stepPct = 0.2): number[] {
  const closes: number[] = [];
  let price = 1;
  for (let index = 0; index < count - 1; index += 1) {
    closes.push(price);
    price *= 1 + stepPct / 100;
  }
  closes.push(price * (1 - dropPct / 100));
  return closes;
}

function trendPullbackCandles(options: {
  tokenId: string;
  count?: number;
  dropPct?: number;
  stepPct?: number;
  volumeUsd?: number;
}): Candle[] {
  return makeCandlesFromCloses(
    trendPullbackCloses(options.count ?? 216, options.dropPct, options.stepPct),
    {
      tokenId: options.tokenId,
      ...(options.volumeUsd === undefined ? {} : { volumeUsd: options.volumeUsd }),
    },
  );
}

/** A long uptrend followed by four 6%-per-bar crash bars. */
function crashCloses(count = 220): number[] {
  const closes: number[] = [];
  let price = 1;
  const crashBars = 4;
  for (let index = 0; index < count - crashBars; index += 1) {
    closes.push(price);
    price *= 1.002;
  }
  for (let index = 0; index < crashBars; index += 1) {
    price *= 0.94;
    closes.push(price);
  }
  return closes;
}

function eventsOfType(log: MemoryEventLog, eventType: string): SandboxEvent[] {
  return log.events().filter((event) => event.eventType === eventType);
}

function moduleFor(eventType: string): string {
  if (eventType.startsWith('decision.')) return 'run';
  if (eventType.startsWith('regime.')) return 'regime';
  if (eventType.startsWith('strategy.') || eventType.startsWith('opportunity.')) return 'strategy';
  if (eventType.startsWith('portfolio.') || eventType === 'order.intent') return 'portfolio';
  if (eventType === 'token.state_changed') return 'portfolio';
  if (eventType.startsWith('risk.')) return 'risk';
  return 'unknown';
}

describe('DecisionEngine single-token buy', () => {
  it('emits exactly one buy intent with the last close as the decision price', async () => {
    const candles = trendPullbackCandles({ tokenId: 'token' });
    const now = lastCloseTime(candles);
    const { log, result } = await decide({ candles, now, tokenIds: ['token'] });

    expect(result.intents).toHaveLength(1);
    const intent = result.intents[0];
    if (intent === undefined) throw new Error('expected one intent');

    expect(intent).toMatchObject({
      tokenId: 'token',
      side: 'buy',
      strategyKey: 'trend_pullback',
      strategyVersion: 1,
      reasonCode: Reason.TREND_PULLBACK_ENTRY,
      sizeUsd: '1000.00',
      amount: null,
      takeProfitPct: null,
      clockTime: now,
    });
    expect(intent.stopLossPct).toMatch(/^\d+\.\d{2}$/);
    expect(intent.decisionPriceUsd).toBe(candles[candles.length - 1]?.close);
    expect(intent.intentId).toBe(
      `${RUN_ID}:token:buy:${new Date(now).toISOString()}:trend_pullback`,
    );

    expect(result.tokenViews).toEqual([
      { tokenId: 'token', phase: 'ARMED', reasonCode: Reason.TOKEN_ARMED },
    ]);
    expect(result.state.tokens['token']?.phase).toBe('ARMED');
    expect(result.state.tokens['token']?.regime.regime).toBe('TREND_UP');
    expect(result.eventCount).toBe(log.events().length);
    expect(result.eventHash).toMatch(/^[0-9a-f]{64}$/);

    const events = log.events();
    expect(events[0]?.eventType).toBe('decision.cycle');
    expect(events[0]?.inputs).toMatchObject({
      tokenIds: ['token'],
      equityUsd: '10000',
      cashUsd: '10000',
      openPositions: [],
      settingsVersion: settingsVersion(DEFAULT_SETTINGS),
    });
    expect(events[events.length - 1]?.eventType).toBe('decision.completed');
  });
});

describe('DecisionEngine ranking and allocation', () => {
  it('allocates in score order and drops the third candidate on the position limit', async () => {
    const candles = [
      ...trendPullbackCandles({ tokenId: 'aaa', dropPct: 6, volumeUsd: 200_000 }),
      ...trendPullbackCandles({ tokenId: 'bbb', dropPct: 5, volumeUsd: 200_000 }),
      ...trendPullbackCandles({ tokenId: 'ccc', dropPct: 4.5, volumeUsd: 60_000 }),
    ];
    const now = lastCloseTime(candles);
    const settings: SandboxDecisionSettings = { ...DEFAULT_SETTINGS, maxPositions: 2 };
    const { log, result } = await decide({
      candles,
      now,
      tokenIds: ['ccc', 'aaa', 'bbb'],
      settings,
    });

    expect(result.intents.map((intent) => intent.tokenId)).toEqual(['bbb', 'aaa']);

    const ranked = eventsOfType(log, 'opportunity.ranked');
    expect(ranked.map((event) => event.tokenId)).toEqual(['bbb', 'aaa', 'ccc']);
    expect(ranked.map((event) => event.inputs.rank)).toEqual([1, 2, 3]);

    const allocated = eventsOfType(log, 'portfolio.allocated');
    expect(allocated.map((event) => event.tokenId)).toEqual(['bbb', 'aaa']);

    const dropped = eventsOfType(log, 'portfolio.dropped');
    expect(dropped).toHaveLength(1);
    expect(dropped[0]?.tokenId).toBe('ccc');
    expect(dropped[0]?.reasonCode).toBe(Reason.ALLOC_MAX_POSITIONS);
  });
});

describe('DecisionEngine open positions', () => {
  it('keeps the original strategy in CRASH and emits a sell intent', async () => {
    const candles = makeCandlesFromCloses(crashCloses(), {
      tokenId: 'crash',
      volumeUsd: 200_000,
    });
    const now = lastCloseTime(candles);
    const lastClose = candles[candles.length - 1]?.close;
    if (lastClose === undefined) throw new Error('expected candles');
    const held = position('crash', {
      avgCostUsd: '2',
      marketPriceUsd: lastClose,
      marketValueUsd: (100 * Number(lastClose)).toFixed(8),
      stopLossPct: '5',
      takeProfitPct: '20',
    });
    const { log, result } = await decide({
      candles,
      now,
      tokenIds: ['crash'],
      portfolio: portfolio({ positions: [held] }),
    });

    expect(result.intents).toHaveLength(1);
    const intent = result.intents[0];
    if (intent === undefined) throw new Error('expected one intent');

    expect(intent).toMatchObject({
      tokenId: 'crash',
      side: 'sell',
      strategyKey: 'trend_pullback',
      amount: '100',
      sizeUsd: held.marketValueUsd,
      stopLossPct: '5',
      takeProfitPct: '20',
      decisionPriceUsd: lastClose,
    });
    expect(intent.reasonCode).toBe(Reason.TREND_PULLBACK_STOP);

    expect(result.state.tokens['crash']?.regime.regime).toBe('CRASH');
    expect(result.tokenViews).toEqual([
      { tokenId: 'crash', phase: 'IN_POSITION', reasonCode: Reason.TOKEN_IN_POSITION },
    ]);

    const selected = eventsOfType(log, 'strategy.selected');
    expect(selected).toHaveLength(1);
    expect(selected[0]?.reasonCode).toBe(Reason.STRATEGY_ORIGINAL_POSITION);
    expect(eventsOfType(log, 'strategy.skipped')).toHaveLength(0);
  });
});

describe('DecisionEngine non-eligible regimes', () => {
  it('skips the strategy with no intent and sleeps or blocks the token', async () => {
    const down = makeSeries({ tokenId: 'down', count: 220, startPrice: 1, stepPct: -0.05 });
    const thin = makeSeries({
      tokenId: 'thin',
      count: 220,
      startPrice: 1,
      stepPct: 0.1,
      volumeUsd: 1_000,
    });
    const candles = [...down, ...thin];
    const now = lastCloseTime(candles);
    const { log, result } = await decide({ candles, now, tokenIds: ['down', 'thin'] });

    expect(result.intents).toEqual([]);

    const views = new Map(result.tokenViews.map((view) => [view.tokenId, view]));
    expect(views.get('down')).toEqual({
      tokenId: 'down',
      phase: 'SLEEPING',
      reasonCode: Reason.TOKEN_SLEEPING,
    });
    expect(views.get('thin')).toEqual({
      tokenId: 'thin',
      phase: 'BLOCKED',
      reasonCode: Reason.TOKEN_BLOCKED,
    });

    const skipped = eventsOfType(log, 'strategy.skipped');
    expect(skipped.map((event) => event.tokenId)).toEqual(['down', 'thin']);
    expect(skipped.every((event) => event.reasonCode === Reason.STRATEGY_NOT_ELIGIBLE)).toBe(true);
    expect(result.state.tokens['down']?.regime.regime).toBe('TREND_DOWN');
    expect(result.state.tokens['thin']?.regime.regime).toBe('ILLIQUID');
  });
});

describe('DecisionEngine evaluated token set', () => {
  it('evaluates a position token outside the universe', async () => {
    const universe = trendPullbackCandles({ tokenId: 'universe' });
    const outside = trendPullbackCandles({ tokenId: 'outside' });
    const candles = [...universe, ...outside];
    const now = lastCloseTime(candles);
    const { log, result } = await decide({
      candles,
      now,
      tokenIds: ['universe'],
      portfolio: portfolio({ positions: [position('outside')] }),
    });

    expect(result.state.tokens['outside']).toBeDefined();
    expect(result.state.tokens['universe']).toBeDefined();
    expect(log.events()[0]?.inputs.tokenIds).toEqual(['outside', 'universe']);
    expect(log.events()[0]?.inputs.openPositions).toEqual(['outside']);
    expect(
      log
        .events()
        .some((event) => event.eventType === 'regime.evaluated' && event.tokenId === 'outside'),
    ).toBe(true);
  });

  it('evaluates only the position when tokenIds is empty', async () => {
    const candles = trendPullbackCandles({ tokenId: 'outside' });
    const now = lastCloseTime(candles);
    const { result } = await decide({
      candles,
      now,
      tokenIds: [],
      portfolio: portfolio({ positions: [position('outside')] }),
    });

    expect(result.tokenViews.map((view) => view.tokenId)).toEqual(['outside']);
  });

  it('treats an empty universe without positions as a valid no-op', async () => {
    const log = new MemoryEventLog();
    const result = await new DecisionEngine(log).decide(
      decisionInput({ candles: [], now: START, tokenIds: [] }),
    );

    expect(result.intents).toEqual([]);
    expect(result.tokenViews).toEqual([]);
    expect(result.state).toEqual({ tokens: {} });
    expect(result.eventCount).toBe(2);
    expect(log.events().map((event) => event.eventType)).toEqual([
      'decision.cycle',
      'decision.completed',
    ]);
  });
});

describe('DecisionEngine input validation', () => {
  it('rejects duplicate token ids, empty ids and duplicate positions', async () => {
    const candles = trendPullbackCandles({ tokenId: 'token' });
    const now = lastCloseTime(candles);
    const engine = new DecisionEngine(new MemoryEventLog());

    await expect(
      engine.decide(decisionInput({ candles, now, tokenIds: ['token', 'token'] })),
    ).rejects.toBeInstanceOf(DecisionInputError);
    await expect(
      engine.decide(decisionInput({ candles, now, tokenIds: [''] })),
    ).rejects.toBeInstanceOf(DecisionInputError);
    await expect(
      engine.decide(
        decisionInput({
          candles,
          now,
          tokenIds: ['token'],
          portfolio: portfolio({ positions: [position('token'), position('token')] }),
        }),
      ),
    ).rejects.toBeInstanceOf(DecisionInputError);
  });

  it('rejects a market snapshot that does not match dataSnapshotId', async () => {
    const candles = trendPullbackCandles({ tokenId: 'token' });
    const now = lastCloseTime(candles);
    const engine = new DecisionEngine(new MemoryEventLog());

    await expect(
      engine.decide(decisionInput({ candles, now, tokenIds: ['token'], snapshotId: 'other' })),
    ).rejects.toBeInstanceOf(DecisionInputError);
  });

  it('rejects a changed ATR period, non-positive equity and invalid strategy stops', async () => {
    const engine = new DecisionEngine(new MemoryEventLog());

    await expect(
      engine.decide(
        decisionInput({
          candles: [],
          now: START,
          tokenIds: [],
          settings: {
            ...DEFAULT_SETTINGS,
            regime: { ...DEFAULT_SETTINGS.regime, atrPeriod: 7 },
          },
        }),
      ),
    ).rejects.toBeInstanceOf(DecisionInputError);

    await expect(
      engine.decide(
        decisionInput({
          candles: [],
          now: START,
          tokenIds: [],
          portfolio: portfolio({ equity: '0' }),
        }),
      ),
    ).rejects.toBeInstanceOf(DecisionInputError);

    await expect(
      engine.decide(
        decisionInput({
          candles: [],
          now: START,
          tokenIds: [],
          settings: {
            ...DEFAULT_SETTINGS,
            strategies: {
              ...DEFAULT_SETTINGS.strategies,
              recovery: { ...DEFAULT_SETTINGS.strategies.recovery, stopPct: 0 },
            },
          },
        }),
      ),
    ).rejects.toBeInstanceOf(DecisionInputError);
  });
});

describe('DecisionEngine cooldowns and phases', () => {
  it('blocks a cooled-down buy but still allows a sell, and leaves a blocked token alone', async () => {
    const hot = trendPullbackCandles({ tokenId: 'hot' });
    const heldCandles = trendPullbackCandles({ tokenId: 'held' });
    const thin = makeSeries({
      tokenId: 'thin',
      count: 216,
      startPrice: 1,
      stepPct: 0.1,
      volumeUsd: 1_000,
    });
    const candles = [...hot, ...heldCandles, ...thin];
    const now = lastCloseTime(candles);
    const lastClose = heldCandles[heldCandles.length - 1]?.close;
    if (lastClose === undefined) throw new Error('expected candles');
    const held = position('held', {
      avgCostUsd: '2',
      marketPriceUsd: lastClose,
      marketValueUsd: (100 * Number(lastClose)).toFixed(8),
    });
    const state = engineState([
      tokenState('hot', 'TREND_UP', { phase: 'COOLDOWN', cooldownUntil: now + HOUR }),
      tokenState('held', 'TREND_UP', {
        phase: 'IN_POSITION',
        cooldownUntil: now + HOUR,
      }),
      tokenState('thin', 'ILLIQUID', { phase: 'BLOCKED' }),
    ]);

    const { log, result } = await decide({
      candles,
      now,
      tokenIds: ['hot', 'held', 'thin'],
      portfolio: portfolio({ positions: [held] }),
      state,
    });

    expect(result.intents).toHaveLength(1);
    expect(result.intents[0]?.tokenId).toBe('held');
    expect(result.intents[0]?.side).toBe('sell');

    const views = new Map(result.tokenViews.map((view) => [view.tokenId, view]));
    expect(views.get('hot')?.phase).toBe('COOLDOWN');
    expect(views.get('held')?.phase).toBe('IN_POSITION');
    expect(views.get('thin')?.phase).toBe('BLOCKED');
    expect(result.state.tokens['hot']?.cooldownUntil).toBe(now + HOUR);

    const risk = eventsOfType(log, 'risk.checked');
    const hotRisk = risk.find((event) => event.tokenId === 'hot');
    const heldRisk = risk.find((event) => event.tokenId === 'held');
    expect(hotRisk?.reasonCode).toBe(Reason.RISK_COOLDOWN);
    expect(hotRisk?.riskChecks).toHaveLength(12);
    expect(heldRisk?.reasonCode).toBe(Reason.RISK_PASSED);
    expect(heldRisk?.riskChecks).toHaveLength(2);
    expect(heldRisk?.inputs.kind).toBe('sell');
    expect(
      log.events().some((event) => event.eventType === 'order.intent' && event.tokenId === 'hot'),
    ).toBe(false);
  });
});

describe('DecisionEngine audit completeness', () => {
  it('gives every decision a reason code and an alternative inside the right module', async () => {
    const buy = trendPullbackCandles({ tokenId: 'buy', count: 220 });
    const crash = makeCandlesFromCloses(crashCloses(), {
      tokenId: 'crash',
      volumeUsd: 200_000,
    });
    const candles = [...buy, ...crash];
    const now = lastCloseTime(candles);
    const lastClose = crash[crash.length - 1]?.close;
    if (lastClose === undefined) throw new Error('expected candles');
    const { log } = await decide({
      candles,
      now,
      tokenIds: ['buy', 'crash'],
      portfolio: portfolio({
        positions: [
          position('crash', {
            avgCostUsd: '2',
            marketPriceUsd: lastClose,
            marketValueUsd: (100 * Number(lastClose)).toFixed(8),
          }),
        ],
      }),
    });

    const events = log.events();
    const decisions = events.filter((event) => event.decision !== null);
    expect(decisions.length).toBeGreaterThan(0);

    for (const event of decisions) {
      expect(event.reasonCode, event.eventType).toBeTruthy();
      expect(event.reasonCode?.length ?? 0).toBeGreaterThan(0);
      expect(event.alternatives.length, event.eventType).toBeGreaterThanOrEqual(1);
      for (const alternative of event.alternatives) {
        expect(alternative.reasonCode.length).toBeGreaterThan(0);
        expect(alternative.whyNot.length).toBeGreaterThan(0);
      }
    }

    for (const event of events) {
      expect(event.runId).toBe(RUN_ID);
      expect(event.seed).toBe(SEED);
      expect(event.configVersion).toBe(CONFIG_VERSION);
      expect(event.dataSnapshotId).toBe(SNAPSHOT_ID);
      expect(event.clockTime).toBe(new Date(now).toISOString());
      expect(event.module).toBe(moduleFor(event.eventType));
    }
  });

  it('logs a defensive buy-with-position rejection through the logger', async () => {
    const log = new MemoryEventLog();
    const logger = new DecisionLogger(log, {
      runId: RUN_ID,
      seed: SEED,
      configVersion: CONFIG_VERSION,
      dataSnapshotId: SNAPSHOT_ID,
      clockTime: new Date(START).toISOString(),
    });

    await logger.strategyRejected({
      tokenId: 'token',
      strategyKey: 'trend_pullback',
      strategyVersion: 1,
    });

    const event = log.events()[0];
    expect(event?.eventType).toBe('strategy.rejected');
    expect(event?.module).toBe('strategy');
    expect(event?.severity).toBe('warn');
    expect(event?.reasonCode).toBe(Reason.STRATEGY_BUY_WITH_POSITION);
    expect(event?.decision?.action).toBe('block');
    expect(event?.alternatives.length).toBeGreaterThan(0);
  });
});

describe('DecisionEngine risk checks', () => {
  it('logs twelve buy checks and two sell checks before ordering intents', async () => {
    const buy = trendPullbackCandles({ tokenId: 'buy', count: 220 });
    const crash = makeCandlesFromCloses(crashCloses(), {
      tokenId: 'crash',
      volumeUsd: 200_000,
    });
    const candles = [...buy, ...crash];
    const now = lastCloseTime(candles);
    const lastClose = crash[crash.length - 1]?.close;
    if (lastClose === undefined) throw new Error('expected candles');
    const { log, result } = await decide({
      candles,
      now,
      tokenIds: ['buy', 'crash'],
      portfolio: portfolio({
        positions: [
          position('crash', {
            avgCostUsd: '2',
            marketPriceUsd: lastClose,
            marketValueUsd: (100 * Number(lastClose)).toFixed(8),
          }),
        ],
      }),
    });

    const risk = eventsOfType(log, 'risk.checked');
    const buyRisk = risk.find((event) => event.tokenId === 'buy');
    const sellRisk = risk.find((event) => event.tokenId === 'crash');
    expect(buyRisk?.riskChecks).toHaveLength(12);
    expect(buyRisk?.inputs.kind).toBe('buy');
    expect(sellRisk?.riskChecks).toHaveLength(2);
    expect(sellRisk?.inputs.kind).toBe('sell');
    expect(result.intents.map((intent) => intent.side).sort()).toEqual(['buy', 'sell']);

    const events = log.events();
    for (const intent of result.intents) {
      const riskIndex = events.findIndex(
        (event) =>
          event.eventType === 'risk.checked' &&
          event.tokenId === intent.tokenId &&
          event.decision?.action === intent.side,
      );
      const intentIndex = events.findIndex(
        (event) =>
          event.eventType === 'order.intent' &&
          event.tokenId === intent.tokenId &&
          event.decision?.action === intent.side,
      );
      expect(riskIndex).toBeGreaterThanOrEqual(0);
      expect(intentIndex).toBeGreaterThan(riskIndex);
    }
  });
});

describe('DecisionEngine state and hysteresis', () => {
  it('carries state into the next cycle and holds a pending regime change', async () => {
    const flat = makeCandlesFromCloses(new Array<number>(200).fill(1), { tokenId: 'token' });
    const firstNow = lastCloseTime(flat);
    const first = await decide({ candles: flat, now: firstNow, tokenIds: ['token'] });

    expect(first.result.state.tokens['token']?.regime.regime).toBe('RANGE');
    expect(first.result.intents).toEqual([]);
    expect(eventsOfType(first.log, 'regime.changed')).toHaveLength(1);
    const since = first.result.state.tokens['token']?.regime.since;

    const step1 = makeCandlesFromCloses([...new Array<number>(200).fill(1), 1.15], {
      tokenId: 'token',
    });
    const secondNow = lastCloseTime(step1);
    const second = await decide({
      candles: step1,
      now: secondNow,
      tokenIds: ['token'],
      state: first.result.state,
    });

    const secondState = second.result.state.tokens['token'];
    expect(secondState?.regime.regime).toBe('RANGE');
    expect(secondState?.regime.candidate).toBe('TREND_UP');
    expect(secondState?.regime.candidateBars).toBe(1);
    expect(secondState?.regime.since).toBe(since);
    expect(eventsOfType(second.log, 'regime.changed')).toHaveLength(0);

    const step2 = makeCandlesFromCloses([...new Array<number>(200).fill(1), 1.15, 1.16], {
      tokenId: 'token',
    });
    const third = await decide({
      candles: step2,
      now: lastCloseTime(step2),
      tokenIds: ['token'],
      state: second.result.state,
    });
    expect(third.result.state.tokens['token']?.regime.candidateBars).toBe(2);

    const step3 = makeCandlesFromCloses([...new Array<number>(200).fill(1), 1.15, 1.16, 1.17], {
      tokenId: 'token',
    });
    const fourth = await decide({
      candles: step3,
      now: lastCloseTime(step3),
      tokenIds: ['token'],
      state: third.result.state,
    });

    expect(fourth.result.state.tokens['token']?.regime.regime).toBe('TREND_UP');
    expect(fourth.result.state.tokens['token']?.regime.candidate).toBeNull();
    expect(eventsOfType(fourth.log, 'regime.changed')).toHaveLength(1);
  });
});

describe('DecisionEngine determinism', () => {
  async function deterministicRun(tokenIds: readonly string[], seed = SEED) {
    const candles = [
      ...trendPullbackCandles({ tokenId: 'aaa', dropPct: 6, volumeUsd: 200_000 }),
      ...trendPullbackCandles({ tokenId: 'bbb', dropPct: 5, volumeUsd: 200_000 }),
    ];
    const now = lastCloseTime(candles);
    return decide({ candles, now, tokenIds, seed });
  }

  it('produces the same hash and intents twice and when tokenIds are reversed', async () => {
    const first = await deterministicRun(['aaa', 'bbb']);
    const second = await deterministicRun(['aaa', 'bbb']);
    const reversed = await deterministicRun(['bbb', 'aaa']);

    expect(second.result.eventHash).toBe(first.result.eventHash);
    expect(second.result.intents).toEqual(first.result.intents);
    expect(reversed.result.eventHash).toBe(first.result.eventHash);
    expect(reversed.result.intents).toEqual(first.result.intents);
  });

  it('changes the hash but not the intents when the seed changes', async () => {
    const first = await deterministicRun(['aaa', 'bbb']);
    const other = await deterministicRun(['aaa', 'bbb'], SEED + 1);

    expect(other.result.eventHash).not.toBe(first.result.eventHash);
    expect(other.result.intents).toEqual(first.result.intents);
  });

  it('does not mutate the decision input', async () => {
    const candles = trendPullbackCandles({ tokenId: 'token' });
    const now = lastCloseTime(candles);
    const input = decisionInput({ candles, now, tokenIds: ['token'] });
    const before = JSON.stringify(input);

    await new DecisionEngine(new MemoryEventLog()).decide(input);

    expect(JSON.stringify(input)).toBe(before);
  });
});

describe('DecisionEngine look-ahead', () => {
  it('ignores candles that close after clockTime', async () => {
    const visible = trendPullbackCandles({ tokenId: 'token' });
    const future = makeCandlesFromCloses([0.1], {
      tokenId: 'token',
      start: START + 216 * HOUR,
    });
    const now = lastCloseTime(visible);
    const marketNow = START + 218 * HOUR;
    const log = new MemoryEventLog();
    const result = await new DecisionEngine(log).decide({
      ...decisionInput({
        candles: [],
        now: marketNow,
        clockTime: now,
        tokenIds: ['token'],
      }),
      market: marketOf([...visible, ...future], marketNow),
    });

    expect(result.intents).toHaveLength(1);
    expect(result.intents[0]?.decisionPriceUsd).toBe(visible[visible.length - 1]?.close);
    expect(result.state.tokens['token']?.regime.regime).toBe('TREND_UP');

    const evaluated = log
      .events()
      .find((event) => event.eventType === 'regime.evaluated' && event.tokenId === 'token');
    expect(evaluated?.inputs.features).toMatchObject({ bars: 216 });
  });
});

describe('DecisionEngine intent uniqueness', () => {
  it('never returns duplicate (tokenId, side) intents in one cycle', async () => {
    const aaa = trendPullbackCandles({ tokenId: 'aaa', count: 220, dropPct: 6 });
    const bbb = trendPullbackCandles({ tokenId: 'bbb', count: 220, dropPct: 5 });
    const crash = makeCandlesFromCloses(crashCloses(), {
      tokenId: 'crash',
      volumeUsd: 200_000,
    });
    const candles = [...aaa, ...bbb, ...crash];
    const now = lastCloseTime(candles);
    const lastClose = crash[crash.length - 1]?.close;
    if (lastClose === undefined) throw new Error('expected candles');
    const { result } = await decide({
      candles,
      now,
      tokenIds: ['aaa', 'bbb', 'crash'],
      portfolio: portfolio({
        positions: [
          position('crash', {
            avgCostUsd: '2',
            marketPriceUsd: lastClose,
            marketValueUsd: (100 * Number(lastClose)).toFixed(8),
          }),
        ],
      }),
    });

    expect(result.intents.length).toBe(3);
    const keys = result.intents.map((intent) => `${intent.tokenId}:${intent.side}`);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe('DecisionEngine buy risk blocks', () => {
  it('does not order an intent when risk blocks the allocation', async () => {
    const candles = trendPullbackCandles({ tokenId: 'token' });
    const now = lastCloseTime(candles);
    const settings: SandboxDecisionSettings = {
      ...DEFAULT_SETTINGS,
      minOrderUsd: '5000',
    };
    const { log, result } = await decide({
      candles,
      now,
      tokenIds: ['token'],
      settings,
    });

    // The allocator sizes 1000 USD, below the 5000 USD minimum, so the candidate
    // is dropped before a risk check and never becomes an intent.
    expect(result.intents).toEqual([]);
    const reason = eventsOfType(log, 'portfolio.dropped')[0]?.reasonCode;
    expect(reason).toBe(Reason.ALLOC_SIZE_TOO_SMALL);
    expect(eventsOfType(log, 'risk.checked')).toHaveLength(0);
  });

  it('blocks a buy that fails a risk check and logs twelve checks', async () => {
    const candles = trendPullbackCandles({ tokenId: 'token' });
    const now = lastCloseTime(candles);
    const { log, result } = await decide({
      candles,
      now,
      tokenIds: ['token'],
      portfolio: portfolio({ equity: '9700', cash: '9700', dayStart: '10000' }),
    });

    expect(result.intents).toEqual([]);
    const risk = eventsOfType(log, 'risk.checked');
    expect(risk).toHaveLength(1);
    expect(risk[0]?.reasonCode).toBe(Reason.RISK_DAILY_LOSS);
    expect(risk[0]?.riskChecks).toHaveLength(12);
    expect(eventsOfType(log, 'order.intent')).toHaveLength(0);
  });
});

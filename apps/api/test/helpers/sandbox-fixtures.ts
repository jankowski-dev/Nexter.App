import { randomUUID } from 'node:crypto';
import Decimal from 'decimal.js';
import { sandboxRunTokens, sandboxRuns, users, type Database } from '@nexter/db';
import {
  applyBuyFill,
  applySellFill,
  createLedger,
  DEFAULT_PAPER_SETTINGS,
  markPortfolio,
  planBuyFill,
  planSellFill,
  Reason,
  type EngineState,
  type EquityPoint,
  type IntentRecord,
  type OrderIntent,
  type PaperLedgerState,
} from '@nexter/sandbox-core';
import type { SandboxTickInput } from '../../src/modules/sandbox/sandbox.types';

/**
 * Deterministic sandbox persistence fixtures for the DB-gated suites.
 *
 * The ledger is built by the real Stage 1C functions, so projections are tested
 * against the same records the live runner will persist.
 */

export const SANDBOX_TEST_AT = Date.UTC(2026, 0, 1, 1);
export const SANDBOX_TEST_HOUR = 3_600_000;
export const SANDBOX_TEST_TOKEN = 'bsc:0x1111111111111111111111111111111111111111';

export function makeEngineState(): EngineState {
  return {
    tokens: {
      [SANDBOX_TEST_TOKEN]: {
        tokenId: SANDBOX_TEST_TOKEN,
        regime: {
          regime: 'TREND_UP',
          reasonCode: Reason.REGIME_TREND_UP,
          candidate: null,
          candidateBars: 0,
          since: SANDBOX_TEST_AT,
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
        phase: 'ARMED',
        cooldownUntil: null,
        strategyState: { armed: true },
      },
    },
  };
}

function buyIntent(overrides: Partial<OrderIntent> = {}): OrderIntent {
  return {
    intentId: 'intent-1',
    tokenId: SANDBOX_TEST_TOKEN,
    side: 'buy',
    strategyKey: 'trend_pullback',
    strategyVersion: 1,
    reasonCode: Reason.TREND_PULLBACK_ENTRY,
    sizeUsd: '200.00',
    amount: null,
    stopLossPct: '3.00',
    takeProfitPct: null,
    decisionPriceUsd: '100.00000000',
    clockTime: SANDBOX_TEST_AT,
    ...overrides,
  };
}

function candle(openTime: number, open: string, close: string) {
  return {
    tokenId: SANDBOX_TEST_TOKEN,
    timeframe: '1h',
    openTime,
    open,
    high: '111.00000000',
    low: '89.00000000',
    close,
    volumeUsd: '100000.00000000',
  };
}

function buy(initialCapitalUsd = '1000.00'): PaperLedgerState {
  const intent = buyIntent();
  const plan = planBuyFill({
    intent,
    candle: candle(SANDBOX_TEST_AT, '100.00000000', '100.00000000'),
    cashUsd: initialCapitalUsd,
    equityUsd: initialCapitalUsd,
    cashBufferPct: 0,
    settings: DEFAULT_PAPER_SETTINGS,
    hasPosition: false,
  });
  if (plan.status !== 'filled') throw new Error(`fixture buy was ${plan.status}`);

  return applyBuyFill(createLedger(initialCapitalUsd), plan, intent, SANDBOX_TEST_AT).state;
}

/** Ledger with one open position and one open trade. */
export function makeOpenLedger(options: { markPriceUsd?: string } = {}): {
  ledger: PaperLedgerState;
  marked: ReturnType<typeof markPortfolio>;
  intents: IntentRecord[];
} {
  const ledger = buy();
  const marked = markPortfolio(ledger, {
    [SANDBOX_TEST_TOKEN]: options.markPriceUsd ?? '105.00000000',
  });

  return {
    ledger,
    marked,
    intents: [
      {
        intentId: 'intent-1',
        tokenId: SANDBOX_TEST_TOKEN,
        side: 'buy',
        strategyKey: 'trend_pullback',
        strategyVersion: 1,
        status: 'filled',
        requestedUsd: '200.00',
        requestedAmount: null,
        filledUsd: ledger.entries[0]?.notionalUsd ?? '200.00',
        filledAmount: ledger.entries[0]?.amount ?? '0.00000000',
        priceUsd: ledger.entries[0]?.priceUsd ?? '100.00000000',
        feeUsd: ledger.entries[0]?.feeUsd ?? '0.00',
        reasonCode: Reason.FILL_FILLED,
        strategyReasonCode: Reason.TREND_PULLBACK_ENTRY,
        reasonText: 'filled',
        decisionTime: SANDBOX_TEST_AT,
        fillTime: SANDBOX_TEST_AT,
      },
    ],
  };
}

/** Ledger after buying and fully selling at a higher mark: no open position. */
export function makeClosedLedger(): {
  ledger: PaperLedgerState;
  marked: ReturnType<typeof markPortfolio>;
} {
  const opened = buy();
  const position = opened.positions[SANDBOX_TEST_TOKEN];
  if (position === undefined) throw new Error('fixture has no position');

  const sellIntent: OrderIntent = {
    intentId: 'intent-2',
    tokenId: SANDBOX_TEST_TOKEN,
    side: 'sell',
    strategyKey: 'trend_pullback',
    strategyVersion: 1,
    reasonCode: Reason.TREND_PULLBACK_TREND_BREAK,
    sizeUsd: '0.00',
    amount: position.amount,
    stopLossPct: null,
    takeProfitPct: null,
    decisionPriceUsd: '110.00000000',
    clockTime: SANDBOX_TEST_AT + SANDBOX_TEST_HOUR,
  };
  const plan = planSellFill({
    intent: sellIntent,
    candle: candle(SANDBOX_TEST_AT + SANDBOX_TEST_HOUR, '110.00000000', '110.00000000'),
    positionAmount: position.amount,
    settings: DEFAULT_PAPER_SETTINGS,
  });
  if (plan.status !== 'filled') throw new Error(`fixture sell was ${plan.status}`);

  const ledger = applySellFill(opened, plan, sellIntent, SANDBOX_TEST_AT + SANDBOX_TEST_HOUR).state;
  if (Object.keys(ledger.positions).length !== 0) {
    throw new Error('fixture sell did not close the position');
  }

  return { ledger, marked: markPortfolio(ledger, {}) };
}

/** Equity point for the supplied mark at one bar close. */
export function makeEquityPoint(
  marked: ReturnType<typeof markPortfolio>,
  clockTime = SANDBOX_TEST_AT,
  cashUsd = '799.50',
): EquityPoint {
  return {
    clockTime,
    equityUsd: marked.equityUsd,
    cashUsd,
    positionsValueUsd: marked.positionsValueUsd,
    drawdownPct: '0.00',
  };
}

/** Complete tick input for the open-ledger fixture. */
export function makeTick(
  ledger: PaperLedgerState,
  marked: ReturnType<typeof markPortfolio>,
  intents: readonly IntentRecord[] = [],
  overrides: Partial<SandboxTickInput> = {},
): SandboxTickInput {
  const equityUsd = overrides.equityUsd ?? marked.equityUsd;
  const peakEquityUsd = new Decimal(equityUsd).greaterThan(ledger.initialCapitalUsd)
    ? equityUsd
    : ledger.initialCapitalUsd;

  return {
    status: 'running',
    cashUsd: ledger.cashUsd,
    equityUsd,
    peakEquityUsd,
    dayStartEquityUsd: ledger.initialCapitalUsd,
    engineState: makeEngineState(),
    ledgerState: ledger,
    markedPositions: marked.positions,
    equityPoint: makeEquityPoint(marked, SANDBOX_TEST_AT, ledger.cashUsd),
    intents,
    lastBarClose: new Date(SANDBOX_TEST_AT),
    lastTickAt: new Date(SANDBOX_TEST_AT),
    error: null,
    ...overrides,
  };
}

export interface SeedSandboxRunOptions {
  /** Reuse an existing owner (for API e2e) instead of creating a fixture user. */
  userId?: string;
  name?: string;
  status?: string;
  initialCapitalUsd?: string;
  cashUsd?: string;
  equityUsd?: string;
  peakEquityUsd?: string;
  dayStartEquityUsd?: string;
  settings?: Record<string, unknown>;
  engineState?: object;
  ledgerState?: object;
  lastBarClose?: Date | null;
  eventSeq?: number;
  eventHash?: string;
  withToken?: boolean;
}

/** Inserts one owner (unless `userId` is supplied), one run and its token snapshot. */
export async function seedSandboxRun(
  db: Database,
  options: SeedSandboxRunOptions = {},
): Promise<{ userId: string; runId: string }> {
  const userId = options.userId ?? (await insertFixtureUser(db));
  const capital = options.initialCapitalUsd ?? '1000.00';
  const status = options.status ?? 'running';
  const draft = status === 'draft';
  const [run] = await db
    .insert(sandboxRuns)
    .values({
      userId,
      name: options.name ?? 'Sandbox fixture run',
      status,
      initialCapitalUsd: capital,
      cashUsd: options.cashUsd ?? capital,
      equityUsd: options.equityUsd ?? capital,
      peakEquityUsd: options.peakEquityUsd ?? capital,
      dayStartEquityUsd: options.dayStartEquityUsd ?? capital,
      settings: options.settings ?? {},
      // A non-draft run must carry a valid empty engine state and an initial
      // ledger; only a draft may still have the schema-default `{}`.
      engineState: (options.engineState ?? (draft ? {} : { tokens: {} })) as Record<
        string,
        unknown
      >,
      ledgerState: (options.ledgerState ?? (draft ? {} : createLedger(capital))) as Record<
        string,
        unknown
      >,
      lastBarClose: options.lastBarClose ?? null,
      eventSeq: options.eventSeq ?? 0,
      eventHash: options.eventHash ?? '0'.repeat(64),
    })
    .returning({ id: sandboxRuns.id });
  if (!run) throw new Error('sandbox fixture run insert returned no row');

  if (options.withToken !== false) {
    await db.insert(sandboxRunTokens).values({
      runId: run.id,
      tokenKey: SANDBOX_TEST_TOKEN,
      symbol: 'CAKE',
      chain: 'bsc',
      contractAddress: SANDBOX_TEST_TOKEN.slice('bsc:'.length),
      enabled: true,
    });
  }

  return { userId, runId: run.id };
}

async function insertFixtureUser(db: Database): Promise<string> {
  const [user] = await db
    .insert(users)
    .values({
      email: `sandbox-fixture-${randomUUID()}@example.com`,
      passwordHash: 'not-a-real-hash',
    })
    .returning({ id: users.id });
  if (!user) throw new Error('sandbox fixture user insert returned no row');

  return user.id;
}

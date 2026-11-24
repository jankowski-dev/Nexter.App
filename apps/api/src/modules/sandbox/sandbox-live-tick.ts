import Decimal from 'decimal.js';
import {
  applyCooldowns,
  candleCloseTime,
  ClockedMarketView,
  DecisionEngine,
  markPortfolio,
  maxUsd,
  PaperLogger,
  Reason,
  reconcileLedger,
  resolveDayStartEquity,
  sha256Hex,
  SimulationClock,
  stableStringify,
  TIMEFRAME_MS,
  type Candle,
  type EngineState,
  type EventLog,
  type IntentRecord,
  type OrderIntent,
  type PaperLedgerState,
  type Timestamp,
} from '@nexter/sandbox-core';
import {
  duplicateIntentRecord,
  expiredIntentRecord,
  fillLiveBuy,
  fillLiveSell,
  isStopSellReason,
  pendingBars,
  pendingIntentToOrderIntent,
  type SandboxLiveQuote,
} from './sandbox-live-broker';
import type { SandboxPendingIntent } from './sandbox.repository';
import type { SandboxRunSnapshot, SandboxRunnerConfig, SandboxTickInput } from './sandbox.types';

const HOUR_MS = TIMEFRAME_MS['1h'] as number;
const ZERO_USD = '0.00';
const ZERO_UNITS = '0.00000000';

export type SandboxLiveTickErrorCode =
  | 'SANDBOX_LIVE_STATE_MISSING'
  | 'SANDBOX_LIVE_RECONCILIATION_FAILED'
  | 'SANDBOX_LIVE_CLOCK_INVALID';

export class SandboxLiveTickError extends Error {
  constructor(
    readonly code: SandboxLiveTickErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'SandboxLiveTickError';
  }
}

export interface SandboxLiveTickInput {
  readonly run: SandboxRunSnapshot;
  readonly config: SandboxRunnerConfig;
  readonly candles: readonly Candle[];
  readonly pending: readonly SandboxPendingIntent[];
  readonly quotes: ReadonlyMap<string, SandboxLiveQuote>;
  /** Close of the new 1h decision bar (not the wall clock). */
  readonly clockTime: Timestamp;
  readonly now: Date;
  readonly eventLog: EventLog;
}

export interface SandboxLiveTickResult {
  readonly tick: SandboxTickInput;
  /** Intents the engine queued for the next tick. */
  readonly pendingIntents: readonly OrderIntent[];
  /** Terminal records for intents resolved on this tick. */
  readonly resolvedIntents: readonly IntentRecord[];
}

/**
 * Returns the close of the newest closed 1h bar across the run universe, or
 * `null` when the run already processed that bar. This is the single guard
 * against a duplicate tick for the same bar.
 */
export function findNewBarClose(
  candles: readonly Candle[],
  tokenKeys: readonly string[],
  lastBarClose: Date | null,
): Timestamp | null {
  const universe = new Set(tokenKeys);
  let newest: Timestamp | null = null;
  for (const candle of candles) {
    if (!universe.has(candle.tokenId)) continue;
    const close = candleCloseTime(candle);
    if (newest === null || close > newest) newest = close;
  }

  if (newest === null) return null;
  if (lastBarClose !== null && newest <= lastBarClose.getTime()) return null;

  return newest;
}

export function sandboxLiveSnapshotId(runId: string, clockTime: Timestamp): string {
  return `sandbox:${runId}:${new Date(clockTime).toISOString()}`;
}

export function sandboxLiveConfigVersion(config: SandboxRunnerConfig): string {
  return sha256Hex(
    stableStringify({
      tokenKeys: [...config.tokenKeys].sort(),
      seed: config.seed,
      settings: config.settings,
      paper: config.paper,
    }),
  );
}

/**
 * One live-paper tick.
 *
 * Order of operations is binding: resolve the intents queued at the previous
 * decision against the live quote, mark the book at the new close, run the next
 * Stage 1B decision with the persisted engine state, queue its intents, then
 * reconcile. The caller persists the returned tick in the transaction that
 * already appended every event through `eventLog`.
 */
export async function runSandboxLiveTick(
  input: SandboxLiveTickInput,
): Promise<SandboxLiveTickResult> {
  const { run, config, candles, clockTime } = input;
  if (run.engineState === null || run.ledgerState === null) {
    throw new SandboxLiveTickError(
      'SANDBOX_LIVE_STATE_MISSING',
      `Sandbox run ${run.id} cannot tick without an initialized engine and ledger state`,
    );
  }
  if (run.lastBarClose !== null && clockTime <= run.lastBarClose.getTime()) {
    throw new SandboxLiveTickError(
      'SANDBOX_LIVE_CLOCK_INVALID',
      `Sandbox run ${run.id} tick clock ${clockTime} is not after last bar close ${run.lastBarClose.getTime()}`,
    );
  }

  const dataSnapshotId = sandboxLiveSnapshotId(run.id, clockTime);
  const configVersion = sandboxLiveConfigVersion(config);
  const logger = new PaperLogger(input.eventLog, {
    runId: run.id,
    seed: config.seed,
    configVersion,
    dataSnapshotId,
  });
  const marks = lastClosedMarks(candles, config.tokenKeys, clockTime);

  let ledger: PaperLedgerState = run.ledgerState;
  let state: EngineState = run.engineState;
  const resolved: IntentRecord[] = [];
  const stillPending: SandboxPendingIntent[] = [];
  const cooldowns = new Map<string, Timestamp>();

  for (const pending of input.pending) {
    const intent = pendingIntentToOrderIntent(pending);
    const bars = pendingBars(intent.clockTime, clockTime);
    const manualClose = intent.reasonCode === Reason.MANUAL_CLOSE;

    // Strategy IOC intents expire after one bar. A manual close is owner intent,
    // not an IOC quote order, and must survive pause/resume and data gaps until
    // the first tick with a valid, fresh quote.
    if (!manualClose && bars > config.paper.maxPendingBars) {
      const record = expiredIntentRecord(intent, clockTime, bars);
      resolved.push(record);
      await logger.expired({
        clockTime,
        intent,
        queuedAt: intent.clockTime,
        barsPending: bars,
      });
      continue;
    }

    const quote = input.quotes.get(intent.tokenId);
    if (quote === undefined) {
      // No live quote for this token: keep the intent for the next tick. A
      // strategy intent expires on the next bar; a manual close waits.
      stillPending.push(pending);
      continue;
    }

    // The quote bar must be strictly newer than the decision bar (or the bar
    // containing the manual request); the decision bar's own close is already
    // historical and must never price a live fill.
    const requiredBarOpen = manualClose
      ? Math.floor(intent.clockTime / HOUR_MS) * HOUR_MS
      : intent.clockTime;
    if (quote.barOpenTime < requiredBarOpen) {
      stillPending.push(pending);
      continue;
    }

    if (intent.side === 'buy') {
      const equityUsd = markPortfolio(ledger, marks).equityUsd;
      const outcome = fillLiveBuy({
        intent,
        quote,
        ledger,
        equityUsd,
        cashBufferPct: config.settings.cashBufferPct,
        settings: config.paper,
        fillTime: clockTime,
      });
      resolved.push(outcome.record);
      await logFill(logger, {
        intent,
        outcome,
        clockTime,
        cashAfterUsd: outcome.ledger.cashUsd,
        positionAmount: outcome.ledger.positions[intent.tokenId]?.amount ?? ZERO_UNITS,
        planLiquidityCapUsd: outcome.plan.liquidityCapUsd,
      });
      ledger = outcome.ledger;
      continue;
    }

    const outcome = fillLiveSell({
      intent,
      quote,
      ledger,
      settings: config.paper,
      fillTime: clockTime,
    });
    resolved.push(outcome.record);
    await logFill(logger, {
      intent,
      outcome,
      clockTime,
      cashAfterUsd: outcome.ledger.cashUsd,
      positionAmount: outcome.ledger.positions[intent.tokenId]?.amount ?? ZERO_UNITS,
      planLiquidityCapUsd: outcome.plan.liquidityCapUsd,
    });
    ledger = outcome.ledger;

    if (
      outcome.filled &&
      config.paper.cooldownHoursAfterStop > 0 &&
      isStopSellReason(intent.reasonCode)
    ) {
      const cooldownUntil = clockTime + config.paper.cooldownHoursAfterStop * HOUR_MS;
      const existing = cooldowns.get(intent.tokenId);
      if (existing === undefined || cooldownUntil > existing) {
        cooldowns.set(intent.tokenId, cooldownUntil);
      }
      await logger.cooldownSet({
        clockTime,
        tokenId: intent.tokenId,
        cooldownUntil,
        cooldownHours: config.paper.cooldownHoursAfterStop,
        triggerReasonCode: intent.reasonCode,
      });
    }
  }

  const marked = markPortfolio(ledger, marks);
  const dayStartEquityUsd = resolveDayStartEquity({
    lastBarClose: run.lastBarClose === null ? null : run.lastBarClose.getTime(),
    dayStartEquityUsd: run.dayStartEquityUsd,
    equityUsd: marked.equityUsd,
    clockTime,
  });
  const peakEquityUsd = maxUsd(run.peakEquityUsd, marked.equityUsd);
  state = applyCooldowns(state, cooldowns, clockTime);

  const portfolio = {
    equityUsd: marked.equityUsd,
    cashUsd: ledger.cashUsd,
    dayStartEquityUsd,
    peakEquityUsd,
    positions: marked.positions,
  };

  const market = new ClockedMarketView(candles, new SimulationClock(clockTime), dataSnapshotId);
  const decision = await new DecisionEngine(input.eventLog).decide({
    runId: run.id,
    seed: config.seed,
    configVersion,
    dataSnapshotId,
    clockTime,
    tokenIds: [...config.tokenKeys],
    market,
    portfolio,
    state,
    settings: config.settings,
  });
  state = applyCooldowns(decision.state, cooldowns, clockTime);

  const pendingKeys = new Set(stillPending.map((pending) => `${pending.tokenId}:${pending.side}`));
  const queued: OrderIntent[] = [];
  for (const intent of decision.intents) {
    const key = `${intent.tokenId}:${intent.side}`;
    if (pendingKeys.has(key)) {
      const record = duplicateIntentRecord(intent);
      resolved.push(record);
      await logger.rejected({
        clockTime,
        intent,
        reasonCode: record.reasonCode,
        reasonText: record.reasonText,
        requestedUsd: record.requestedUsd,
        requestedAmount: record.requestedAmount,
        priceUsd: intent.decisionPriceUsd,
        liquidityCapUsd: ZERO_USD,
        cashAfterUsd: ledger.cashUsd,
        positionAmountAfter: ledger.positions[intent.tokenId]?.amount ?? ZERO_UNITS,
      });
      continue;
    }
    pendingKeys.add(key);
    queued.push(intent);
  }

  const reconciliation = reconcileLedger(ledger, marks);
  if (!reconciliation.ok) {
    throw new SandboxLiveTickError(
      'SANDBOX_LIVE_RECONCILIATION_FAILED',
      `Sandbox run ${run.id} ledger reconciliation failed: ${reconciliation.discrepancies.join('; ')}`,
    );
  }

  const peakPeak = new Decimal(peakEquityUsd);
  const equity = new Decimal(marked.equityUsd);
  const drawdownPct = peakPeak.greaterThan(0)
    ? Decimal.max(new Decimal(0), peakPeak.minus(equity).div(peakPeak).times(100)).toFixed(2)
    : '0.00';

  return {
    tick: {
      status: 'running',
      cashUsd: ledger.cashUsd,
      equityUsd: marked.equityUsd,
      peakEquityUsd,
      dayStartEquityUsd,
      engineState: state,
      ledgerState: ledger,
      markedPositions: marked.positions,
      marks,
      equityPoint: {
        clockTime,
        equityUsd: marked.equityUsd,
        cashUsd: ledger.cashUsd,
        positionsValueUsd: marked.positionsValueUsd,
        drawdownPct,
      },
      intents: resolved,
      lastBarClose: new Date(clockTime),
      lastTickAt: input.now,
      error: null,
    },
    pendingIntents: queued,
    resolvedIntents: resolved,
  };
}

interface LogFillInput {
  readonly intent: OrderIntent;
  readonly outcome: ReturnType<typeof fillLiveBuy>;
  readonly clockTime: Timestamp;
  readonly cashAfterUsd: string;
  readonly positionAmount: string;
  readonly planLiquidityCapUsd: string;
}

async function logFill(logger: PaperLogger, input: LogFillInput): Promise<void> {
  const { intent, outcome, clockTime } = input;
  if (!outcome.filled) {
    await logger.rejected({
      clockTime,
      intent,
      reasonCode: outcome.record.reasonCode,
      reasonText: outcome.record.reasonText,
      requestedUsd: outcome.record.requestedUsd,
      requestedAmount: outcome.record.requestedAmount,
      priceUsd: outcome.record.priceUsd,
      liquidityCapUsd: input.planLiquidityCapUsd,
      cashAfterUsd: input.cashAfterUsd,
      positionAmountAfter: input.positionAmount,
    });
    return;
  }

  const fillInput = {
    clockTime,
    intent,
    plan: outcome.plan,
    cashAfterUsd: input.cashAfterUsd,
    positionAmountAfter: input.positionAmount,
  };
  if (outcome.record.status === 'filled') {
    await logger.filled(fillInput);
  } else {
    await logger.partial(fillInput);
  }
  if (outcome.entry !== null) {
    await logger.ledgerEntry({ clockTime, entry: outcome.entry });
  }
}

/** Latest closed close per token at `clockTime`, used for marks only. */
function lastClosedMarks(
  candles: readonly Candle[],
  tokenKeys: readonly string[],
  clockTime: Timestamp,
): Record<string, string> {
  const universe = new Set(tokenKeys);
  const marks: Record<string, string> = {};
  for (const candle of candles) {
    if (!universe.has(candle.tokenId)) continue;
    if (candleCloseTime(candle) > clockTime) continue;
    marks[candle.tokenId] = candle.close;
  }
  return marks;
}

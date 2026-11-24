import Decimal from 'decimal.js';
import { SimulationClock } from '../clock';
import { ClockedMarketView } from '../data/market-view';
import { DecisionEngine } from '../decision/decision-engine';
import { Reason } from '../decision/reason-codes';
import type { ReasonCode } from '../decision/reason-codes';
import type {
  EngineState,
  OrderIntent,
  PortfolioSnapshot,
  TokenRuntimeState,
} from '../decision/types';
import type { EventLog } from '../events/event-log';
import { TIMEFRAME_MS } from '../timeframes';
import type { Candle, Timestamp } from '../types';
import { planBuyFill, planSellFill } from './execution';
import { applyBuyFill, applySellFill, createLedger, markPortfolio } from './ledger';
import { buildEquityCurve } from './metrics';
import { PaperLogger } from './paper-logger';
import type {
  BuyFillPlan,
  EquityObservation,
  EquityPoint,
  FillStatus,
  IntentRecord,
  PaperRunConfig,
  PaperRunInput,
  PaperRunResult,
  SellFillPlan,
} from './types';

/**
 * Deterministic host loop for one paper run.
 *
 * The runner groups the supplied candles into bar closes, calls the Stage 1B
 * `DecisionEngine` once per bar, and fills the intents it returns at the next
 * bar open. A decision at close `T` never fills at `T`'s close: the fill uses
 * the candle that opens at `T`, so the price is already known when the bar
 * starts.
 *
 * The host owns the ledger, the `EngineState`, the equity curve and the intent
 * journal. It never mutates its inputs, reads the wall clock, uses randomness
 * or locale-dependent formatting. Money stays in decimal strings with two
 * decimals; prices and token amounts have eight.
 */

export const DEFAULT_INITIAL_CAPITAL_USD = '1000.00';
export const HOUR_MS = 3_600_000;

const ZERO_USD = '0.00';
const ZERO_UNITS = '0.00000000';
const ZERO_PRICE = '0.00000000';

/** Sell reasons that arm the post-stop cooldown policy (design §5.5). */
const STOP_SELL_REASONS: ReadonlySet<ReasonCode> = new Set<ReasonCode>([
  Reason.TREND_PULLBACK_STOP,
  Reason.RANGE_REVERSION_STOP,
  Reason.RECOVERY_STOP,
]);

export type PaperRunErrorCode =
  | 'PAPER_NO_TOKENS'
  | 'PAPER_NO_CANDLES'
  | 'PAPER_NO_MARK'
  | 'PAPER_MIXED_TIMEFRAMES'
  | 'PAPER_BAD_SETTINGS';

/** Typed run-level failure: bad configuration, no data or no mark for a position. */
export class PaperRunError extends Error {
  constructor(
    readonly code: PaperRunErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'PaperRunError';
  }
}

interface PendingIntent {
  readonly intent: OrderIntent;
  /** Decision bar close that queued the intent. */
  readonly queuedAt: Timestamp;
  /** Decision bar index that queued the intent. */
  readonly queuedBarIndex: number;
}

interface RunSettings {
  readonly timeframe: string;
  readonly step: number;
  readonly initialCapitalUsd: string;
}

function compareCodeUnits(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function iso(timestamp: Timestamp): string {
  return new Date(timestamp).toISOString();
}

/** UTC calendar date key; used only to detect a day boundary, never for locale output. */
function utcDateKey(timestamp: Timestamp): string {
  const date = new Date(timestamp);
  const year = String(date.getUTCFullYear()).padStart(4, '0');
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function validateRunSettings(input: PaperRunInput): RunSettings {
  const { paper, settings } = input;
  const step = TIMEFRAME_MS[settings.timeframe];
  if (step === undefined || step <= 0) {
    throw new PaperRunError(
      'PAPER_BAD_SETTINGS',
      `Unknown decision timeframe "${settings.timeframe}"`,
    );
  }
  const bpsFields: readonly [number, string][] = [
    [paper.feeBps, 'feeBps'],
    [paper.slippageBps, 'slippageBps'],
  ];
  for (const [value, name] of bpsFields) {
    if (!Number.isFinite(value) || value < 0 || value >= 10_000) {
      throw new PaperRunError('PAPER_BAD_SETTINGS', `paper.${name} must be in [0, 10000)`);
    }
  }
  if (
    !Number.isFinite(paper.liquidityCapPct) ||
    paper.liquidityCapPct <= 0 ||
    paper.liquidityCapPct > 100
  ) {
    throw new PaperRunError('PAPER_BAD_SETTINGS', 'paper.liquidityCapPct must be in (0, 100]');
  }
  if (!Number.isInteger(paper.maxPendingBars) || paper.maxPendingBars < 1) {
    throw new PaperRunError(
      'PAPER_BAD_SETTINGS',
      'paper.maxPendingBars must be >= 1 (a zero-bar queue would expire every intent before its first attempt)',
    );
  }
  if (!Number.isFinite(paper.cooldownHoursAfterStop) || paper.cooldownHoursAfterStop < 0) {
    throw new PaperRunError(
      'PAPER_BAD_SETTINGS',
      'paper.cooldownHoursAfterStop must be a non-negative number',
    );
  }
  if (!Number.isFinite(paper.counterfactualHorizonHours) || paper.counterfactualHorizonHours <= 0) {
    throw new PaperRunError(
      'PAPER_BAD_SETTINGS',
      'paper.counterfactualHorizonHours must be a positive number (the analyzer rejects a zero horizon)',
    );
  }
  const cashBufferPct = settings.cashBufferPct;
  // `[0, 100]` matches the fill model's `assertCashBufferPct`: 0 means no buffer.
  if (
    typeof cashBufferPct !== 'number' ||
    !Number.isFinite(cashBufferPct) ||
    cashBufferPct < 0 ||
    cashBufferPct > 100
  ) {
    throw new PaperRunError('PAPER_BAD_SETTINGS', 'settings.cashBufferPct must be in [0, 100]');
  }
  const initialCapitalUsd = input.initialCapitalUsd ?? DEFAULT_INITIAL_CAPITAL_USD;
  if (
    typeof initialCapitalUsd !== 'string' ||
    !/^\d+(\.\d{1,2})?$/.test(initialCapitalUsd) ||
    !new Decimal(initialCapitalUsd).greaterThan(0)
  ) {
    throw new PaperRunError(
      'PAPER_BAD_SETTINGS',
      'initialCapitalUsd must be a positive decimal string with at most two decimals',
    );
  }
  return { timeframe: settings.timeframe, step, initialCapitalUsd };
}

/**
 * Returns a new state with the active host cooldowns overlaid and expired
 * deadlines cleared; never mutates the input. A deadline at or before `now` is
 * removed from the token state, so `result.state` never carries a stale
 * cooldown.
 */
function applyCooldowns(
  state: EngineState,
  cooldowns: ReadonlyMap<string, Timestamp>,
  now: Timestamp,
): EngineState {
  const tokens: Record<string, TokenRuntimeState> = { ...state.tokens };
  let changed = false;
  for (const tokenId of Object.keys(tokens)) {
    const token = tokens[tokenId];
    if (token === undefined) continue;
    const until = token.cooldownUntil;
    if (until !== null && until <= now && !cooldowns.has(tokenId)) {
      tokens[tokenId] = { ...token, cooldownUntil: null };
      changed = true;
    }
  }
  for (const [tokenId, until] of cooldowns) {
    if (until <= now) continue;
    const token = tokens[tokenId];
    if (token === undefined) continue;
    if (token.cooldownUntil !== null && token.cooldownUntil >= until) continue;
    tokens[tokenId] = { ...token, cooldownUntil: until };
    changed = true;
  }
  return changed ? { tokens } : state;
}

function maxUsd(left: string, right: string): string {
  return new Decimal(left).greaterThanOrEqualTo(right) ? left : right;
}

function priceOrNull(value: string): string | null {
  return value === ZERO_PRICE ? null : value;
}

function buyRecord(intent: OrderIntent, plan: BuyFillPlan, fillTime: Timestamp): IntentRecord {
  return {
    intentId: intent.intentId,
    tokenId: intent.tokenId,
    side: 'buy',
    strategyKey: intent.strategyKey,
    strategyVersion: intent.strategyVersion,
    status: plan.status,
    requestedUsd: plan.requestedUsd,
    requestedAmount: null,
    filledUsd: plan.filledUsd,
    filledAmount: plan.amount,
    priceUsd: priceOrNull(plan.priceUsd),
    feeUsd: plan.feeUsd,
    reasonCode: plan.reasonCode,
    strategyReasonCode: intent.reasonCode,
    reasonText: plan.reasonText,
    decisionTime: intent.clockTime,
    fillTime,
  };
}

function sellRecord(intent: OrderIntent, plan: SellFillPlan, fillTime: Timestamp): IntentRecord {
  return {
    intentId: intent.intentId,
    tokenId: intent.tokenId,
    side: 'sell',
    strategyKey: intent.strategyKey,
    strategyVersion: intent.strategyVersion,
    status: plan.status,
    requestedUsd: null,
    requestedAmount: plan.requestedAmount,
    filledUsd: plan.notionalUsd,
    filledAmount: plan.filledAmount,
    priceUsd: priceOrNull(plan.priceUsd),
    feeUsd: plan.feeUsd,
    reasonCode: plan.reasonCode,
    strategyReasonCode: intent.reasonCode,
    reasonText: plan.reasonText,
    decisionTime: intent.clockTime,
    fillTime,
  };
}

function unresolvedRecord(
  intent: OrderIntent,
  status: FillStatus,
  reasonCode: ReasonCode,
  reasonText: string,
  fillTime: Timestamp | null,
): IntentRecord {
  return {
    intentId: intent.intentId,
    tokenId: intent.tokenId,
    side: intent.side,
    strategyKey: intent.strategyKey,
    strategyVersion: intent.strategyVersion,
    status,
    requestedUsd: intent.side === 'buy' ? intent.sizeUsd : null,
    requestedAmount: intent.side === 'sell' ? intent.amount : null,
    filledUsd: ZERO_USD,
    filledAmount: ZERO_UNITS,
    priceUsd: null,
    feeUsd: ZERO_USD,
    reasonCode,
    strategyReasonCode: intent.reasonCode,
    reasonText,
    decisionTime: intent.clockTime,
    fillTime,
  };
}

export class PaperRunner {
  constructor(private readonly log: EventLog) {}

  async run(input: PaperRunInput): Promise<PaperRunResult> {
    const { runId, seed, configVersion, dataSnapshotId, settings } = input;
    const runSettings = validateRunSettings(input);
    const { timeframe, step, initialCapitalUsd } = runSettings;
    const paper = input.paper;

    const tokenIds = [...input.tokenIds].sort(compareCodeUnits);
    if (tokenIds.length === 0) {
      throw new PaperRunError('PAPER_NO_TOKENS', 'A paper run needs at least one token id');
    }
    const universe = new Set(tokenIds);
    const suppliedTimeframes = [...new Set(input.candles.map((candle) => candle.timeframe))].sort(
      compareCodeUnits,
    );
    // Mirror the CLI: a mixed-timeframe input is a caller error, not something to
    // silently filter, because the extra frames would change the bar clock.
    if (suppliedTimeframes.length > 1) {
      throw new PaperRunError(
        'PAPER_MIXED_TIMEFRAMES',
        `Mixed timeframes are not supported: ${suppliedTimeframes.join(', ')}`,
      );
    }
    const candles = input.candles
      .filter((candle) => candle.timeframe === timeframe && universe.has(candle.tokenId))
      .slice()
      .sort(
        (left, right) =>
          left.openTime - right.openTime || compareCodeUnits(left.tokenId, right.tokenId),
      );
    if (candles.length === 0) {
      throw new PaperRunError(
        'PAPER_NO_CANDLES',
        `A paper run needs at least one ${timeframe} candle for the supplied tokens`,
      );
    }

    const barCloses = [...new Set(candles.map((candle) => candle.openTime + step))].sort(
      (left, right) => left - right,
    );
    const candleByOpen = new Map<string, Candle>();
    for (const candle of candles) {
      candleByOpen.set(`${candle.tokenId}|${candle.openTime}`, candle);
    }

    const firstClose = barCloses[0] as Timestamp;
    const lastClose = barCloses[barCloses.length - 1] as Timestamp;
    const clock = new SimulationClock(firstClose - step);
    const market = new ClockedMarketView(candles, clock, dataSnapshotId);
    const logger = new PaperLogger(this.log, { runId, seed, configVersion, dataSnapshotId });
    const engine = new DecisionEngine(this.log);

    let ledger = createLedger(initialCapitalUsd);

    let state: EngineState = input.initialState ?? { tokens: {} };
    const cooldowns = new Map<string, Timestamp>();
    const pending: PendingIntent[] = [];
    const intents: IntentRecord[] = [];
    const observations: EquityObservation[] = [];

    let dayStartEquityUsd = ledger.initialCapitalUsd;
    let peakEquityUsd = ledger.initialCapitalUsd;
    let previousDateKey: string | null = null;
    let fills = 0;
    let partials = 0;
    let rejections = 0;
    let expirations = 0;

    const marksFor = (): Readonly<Record<string, string>> => {
      const marks: Record<string, string> = {};
      for (const tokenId of Object.keys(ledger.positions).sort(compareCodeUnits)) {
        const candle = market.latest(tokenId, timeframe);
        if (candle === null) {
          throw new PaperRunError(
            'PAPER_NO_MARK',
            `No mark price is available for ${tokenId} at ${iso(clock.now())}`,
          );
        }
        marks[tokenId] = candle.close;
      }
      return marks;
    };

    await logger.runStarted({
      clockTime: firstClose,
      timeframe,
      bars: barCloses.length,
      tokens: tokenIds,
      initialCapitalUsd: ledger.initialCapitalUsd,
    });

    for (let barIndex = 0; barIndex < barCloses.length; barIndex += 1) {
      const closeTime = barCloses[barIndex] as Timestamp;
      const openTime = closeTime - step;

      // 1. Fill (or expire) intents queued at the previous bar close, before the
      //    next decision so a new position and cash balance are visible to it.
      const attempted = pending.splice(0, pending.length);
      const equityAtOpen =
        attempted.length === 0 ? ledger.cashUsd : markPortfolio(ledger, marksFor()).equityUsd;
      const stillPending: PendingIntent[] = [];
      for (const item of attempted) {
        const barsPending = barIndex - item.queuedBarIndex;
        if (barsPending > paper.maxPendingBars) {
          expirations += 1;
          intents.push(
            unresolvedRecord(
              item.intent,
              'expired',
              Reason.FILL_EXPIRED,
              `Intent ${item.intent.intentId} expired after ${barsPending} bar(s) without a tradable open`,
              openTime,
            ),
          );
          await logger.expired({
            clockTime: openTime,
            intent: item.intent,
            queuedAt: item.queuedAt,
            barsPending,
          });
          continue;
        }

        const candle = candleByOpen.get(`${item.intent.tokenId}|${openTime}`);
        if (candle === undefined) {
          stillPending.push(item);
          continue;
        }

        const position = ledger.positions[item.intent.tokenId];
        if (item.intent.side === 'buy') {
          const plan = planBuyFill({
            intent: item.intent,
            candle,
            cashUsd: ledger.cashUsd,
            equityUsd: equityAtOpen,
            cashBufferPct: settings.cashBufferPct,
            settings: paper,
            hasPosition: position !== undefined,
          });
          intents.push(buyRecord(item.intent, plan, openTime));
          if (plan.status === 'rejected') {
            rejections += 1;
            await logger.rejected({
              clockTime: openTime,
              intent: item.intent,
              reasonCode: plan.reasonCode,
              reasonText: plan.reasonText,
              requestedUsd: plan.requestedUsd,
              requestedAmount: null,
              priceUsd: priceOrNull(plan.priceUsd),
              liquidityCapUsd: plan.liquidityCapUsd,
              cashAfterUsd: ledger.cashUsd,
              positionAmountAfter: position?.amount ?? ZERO_UNITS,
            });
            continue;
          }

          const applied = applyBuyFill(ledger, plan, item.intent, openTime);
          ledger = applied.state;
          const fillInput = {
            clockTime: openTime,
            intent: item.intent,
            plan,
            cashAfterUsd: ledger.cashUsd,
            positionAmountAfter: ledger.positions[item.intent.tokenId]?.amount ?? ZERO_UNITS,
          };
          if (plan.status === 'filled') {
            fills += 1;
            await logger.filled(fillInput);
          } else {
            partials += 1;
            await logger.partial(fillInput);
          }
          await logger.ledgerEntry({ clockTime: openTime, entry: applied.entry });
          continue;
        }

        const plan = planSellFill({
          intent: item.intent,
          candle,
          positionAmount: position?.amount ?? ZERO_UNITS,
          settings: paper,
        });
        intents.push(sellRecord(item.intent, plan, openTime));
        if (plan.status === 'rejected') {
          rejections += 1;
          await logger.rejected({
            clockTime: openTime,
            intent: item.intent,
            reasonCode: plan.reasonCode,
            reasonText: plan.reasonText,
            requestedUsd: null,
            requestedAmount: plan.requestedAmount,
            priceUsd: priceOrNull(plan.priceUsd),
            liquidityCapUsd: plan.liquidityCapUsd,
            cashAfterUsd: ledger.cashUsd,
            positionAmountAfter: position?.amount ?? ZERO_UNITS,
          });
          continue;
        }

        const applied = applySellFill(ledger, plan, item.intent, openTime);
        ledger = applied.state;
        const fillInput = {
          clockTime: openTime,
          intent: item.intent,
          plan,
          cashAfterUsd: ledger.cashUsd,
          positionAmountAfter: ledger.positions[item.intent.tokenId]?.amount ?? ZERO_UNITS,
        };
        if (plan.status === 'filled') {
          fills += 1;
          await logger.filled(fillInput);
        } else {
          partials += 1;
          await logger.partial(fillInput);
        }
        await logger.ledgerEntry({ clockTime: openTime, entry: applied.entry });

        if (paper.cooldownHoursAfterStop > 0 && STOP_SELL_REASONS.has(item.intent.reasonCode)) {
          const cooldownUntil = openTime + paper.cooldownHoursAfterStop * HOUR_MS;
          const existing = cooldowns.get(item.intent.tokenId);
          if (existing === undefined || cooldownUntil > existing) {
            cooldowns.set(item.intent.tokenId, cooldownUntil);
          }
          await logger.cooldownSet({
            clockTime: openTime,
            tokenId: item.intent.tokenId,
            cooldownUntil,
            cooldownHours: paper.cooldownHoursAfterStop,
            triggerReasonCode: item.intent.reasonCode,
          });
        }
      }
      pending.push(...stillPending);

      // 2. Mark the portfolio at the bar close and advance the day/peak state.
      clock.advanceTo(closeTime);
      for (const [tokenId, until] of cooldowns) {
        if (until <= closeTime) cooldowns.delete(tokenId);
      }
      const marked = markPortfolio(ledger, marksFor());
      const dateKey = utcDateKey(closeTime);
      if (previousDateKey !== null && dateKey !== previousDateKey) {
        dayStartEquityUsd = marked.equityUsd;
      }
      previousDateKey = dateKey;
      peakEquityUsd = maxUsd(peakEquityUsd, marked.equityUsd);

      // 3. One decision cycle per bar, with the host cooldowns overlaid.
      const portfolio: PortfolioSnapshot = {
        equityUsd: marked.equityUsd,
        cashUsd: ledger.cashUsd,
        dayStartEquityUsd,
        peakEquityUsd,
        positions: marked.positions,
      };
      const decision = await engine.decide({
        runId,
        seed,
        configVersion,
        dataSnapshotId,
        clockTime: closeTime,
        tokenIds,
        market,
        portfolio,
        state: applyCooldowns(state, cooldowns, closeTime),
        settings,
      });
      state = applyCooldowns(decision.state, cooldowns, closeTime);

      // 4. Queue the next-bar intents; a second pending intent for the same
      //    token and side cannot execute and is rejected as a duplicate.
      for (const intent of decision.intents) {
        const duplicate = pending.some(
          (item) => item.intent.tokenId === intent.tokenId && item.intent.side === intent.side,
        );
        if (duplicate) {
          rejections += 1;
          intents.push(
            unresolvedRecord(
              intent,
              'rejected',
              Reason.FILL_DUPLICATE,
              `Intent ${intent.intentId} duplicates a pending ${intent.side} for ${intent.tokenId}`,
              null,
            ),
          );
          await logger.rejected({
            clockTime: closeTime,
            intent,
            reasonCode: Reason.FILL_DUPLICATE,
            reasonText: `Intent ${intent.intentId} duplicates a pending ${intent.side} for ${intent.tokenId}`,
            requestedUsd: intent.side === 'buy' ? intent.sizeUsd : null,
            requestedAmount: intent.side === 'sell' ? intent.amount : null,
            priceUsd: intent.decisionPriceUsd,
            liquidityCapUsd: ZERO_USD,
            cashAfterUsd: ledger.cashUsd,
            positionAmountAfter: ledger.positions[intent.tokenId]?.amount ?? ZERO_UNITS,
          });
          continue;
        }
        pending.push({ intent, queuedAt: closeTime, queuedBarIndex: barIndex });
      }

      // 5. Record the marked equity observation for this decision bar.
      observations.push({
        clockTime: closeTime,
        equityUsd: marked.equityUsd,
        cashUsd: ledger.cashUsd,
        positionsValueUsd: marked.positionsValueUsd,
      });
    }

    // Intents queued at the last bar can never fill; they expire at the run end.
    for (const item of pending) {
      const barsPending = barCloses.length - 1 - item.queuedBarIndex;
      expirations += 1;
      intents.push(
        unresolvedRecord(
          item.intent,
          'expired',
          Reason.FILL_EXPIRED,
          `Intent ${item.intent.intentId} expired at the end of the run after ${barsPending} bar(s)`,
          lastClose,
        ),
      );
      await logger.expired({
        clockTime: lastClose,
        intent: item.intent,
        queuedAt: item.queuedAt,
        barsPending,
      });
    }
    pending.length = 0;

    const equityCurve: EquityPoint[] = buildEquityCurve({
      initialCapitalUsd: ledger.initialCapitalUsd,
      points: observations,
    });
    const finalEquityUsd = equityCurve[equityCurve.length - 1]?.equityUsd ?? ledger.cashUsd;
    await logger.runCompleted({
      clockTime: lastClose,
      bars: barCloses.length,
      finalEquityUsd,
      intents: intents.length,
      fills,
      partials,
      rejections,
      expirations,
      trades: ledger.closedTrades.length,
      ledgerEntries: ledger.entries.length,
    });

    const config: PaperRunConfig = {
      runId,
      seed,
      timeframe,
      tokenIds,
      initialCapitalUsd: ledger.initialCapitalUsd,
      feeBps: paper.feeBps,
      slippageBps: paper.slippageBps,
      liquidityCapPct: paper.liquidityCapPct,
      maxPendingBars: paper.maxPendingBars,
      cooldownHoursAfterStop: paper.cooldownHoursAfterStop,
      counterfactualHorizonHours: paper.counterfactualHorizonHours,
    };

    return {
      config,
      configVersion,
      dataSnapshotId,
      ledger,
      state,
      intents,
      equityCurve,
      eventCount: this.log.events().length,
      eventHash: this.log.hash(),
    };
  }
}

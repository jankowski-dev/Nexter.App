import Decimal from 'decimal.js';
import { DecimalInputError, minDecimal, money, toDecimal } from '../decision/decimal';
import { Reason } from '../decision/reason-codes';
import type { OrderIntent, PortfolioPosition } from '../decision/types';
import type { Timestamp } from '../types';
import type {
  BuyFillPlan,
  LedgerApplyResult,
  LedgerEntry,
  PaperLedgerState,
  PaperPosition,
  PaperTrade,
  SellFillPlan,
} from './types';

/**
 * Pure, append-only paper ledger.
 *
 * The ledger books exactly what a fill plan emits: no marks, no events and no
 * wall clock. Every function returns a new state and never mutates its inputs,
 * so a run can keep earlier snapshots for the equity curve and the report.
 *
 * Money is a decimal string with two decimals; token amounts and prices have
 * eight. Internal arithmetic uses `Decimal` for every value.
 *
 * Thrown `PaperLedgerError`s are reserved for programmer misuse: a rejected or
 * zero plan handed to the ledger, an intent/plan mismatch, a sell without a
 * position/trade, or a buy the booked cash cannot cover. Fill-domain problems
 * (illiquid bar, insufficient cash, existing/no position) are the fill model's
 * job and surface there as a `rejected` plan.
 */

const ZERO = new Decimal(0);
const ZERO_USD = '0.00';
const ZERO_UNITS = '0.00000000';
const SIGNED_DECIMAL = /^-?\d+(\.\d+)?$/;

export class PaperLedgerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PaperLedgerError';
  }
}

/** Formats a token amount or price with eight decimals. */
function units(value: Decimal): string {
  return value.toFixed(8);
}

/** Parses a non-negative decimal string, rethrowing as a typed ledger error. */
function parse(value: string, label: string): Decimal {
  try {
    return toDecimal(value, label);
  } catch (error) {
    if (error instanceof DecimalInputError) {
      throw new PaperLedgerError(
        `${label} must be a non-negative decimal string, received ${String(value)}`,
      );
    }
    throw error;
  }
}

function parseUsd(value: string, label: string): Decimal {
  return parse(value, label);
}

function parseUnits(value: string, label: string): Decimal {
  return parse(value, label);
}

/** Parses a signed decimal string (realized P&L may be negative). */
function parseSigned(value: string, label: string): Decimal {
  if (typeof value !== 'string' || !SIGNED_DECIMAL.test(value)) {
    throw new PaperLedgerError(`${label} must be a decimal string, received ${String(value)}`);
  }
  return new Decimal(value);
}

function assertFillPlan(
  plan: BuyFillPlan | SellFillPlan,
  intent: OrderIntent,
  side: 'buy' | 'sell',
): void {
  if (plan.status !== 'filled' && plan.status !== 'partial') {
    throw new PaperLedgerError(
      `Cannot book a ${plan.status} ${side} plan for ${plan.tokenId} (${plan.intentId})`,
    );
  }
  if (intent.side !== side) {
    throw new PaperLedgerError(
      `A ${side} plan cannot be booked against a ${intent.side} intent (${intent.intentId})`,
    );
  }
  if (plan.intentId !== intent.intentId) {
    throw new PaperLedgerError(
      `Plan intent ${plan.intentId} does not match the intent ${intent.intentId}`,
    );
  }
  if (plan.tokenId !== intent.tokenId) {
    throw new PaperLedgerError(
      `Plan token ${plan.tokenId} does not match the intent token ${intent.tokenId}`,
    );
  }
}

/** Opens an empty ledger with the given starting cash. */
export function createLedger(initialCapitalUsd: string): PaperLedgerState {
  const initial = parseUsd(initialCapitalUsd, 'initialCapitalUsd');
  if (!initial.times(100).isInteger()) {
    throw new PaperLedgerError(
      `initialCapitalUsd must have at most two decimals, received ${initialCapitalUsd}`,
    );
  }
  return {
    cashUsd: money(initial),
    initialCapitalUsd: money(initial),
    positions: {},
    entries: [],
    realizedPnlUsd: ZERO_USD,
    feesPaidUsd: ZERO_USD,
    closedTrades: [],
    openTrades: {},
  };
}

/**
 * Books one filled/partial buy.
 *
 * Adds are not allowed (the allocator and fill model already reject them), so a
 * token with an existing position is a programmer error. The cost basis is
 * `filledUsd + feeUsd`; the average cost is rounded once, to eight decimals,
 * and the entry opens a trade.
 */
export function applyBuyFill(
  state: PaperLedgerState,
  plan: BuyFillPlan,
  intent: OrderIntent,
  clockTime: Timestamp,
): LedgerApplyResult {
  assertFillPlan(plan, intent, 'buy');

  const filledUsd = parseUsd(plan.filledUsd, 'plan.filledUsd');
  if (!filledUsd.greaterThan(0)) {
    throw new PaperLedgerError(
      `Cannot book a buy with a non-positive filled amount for ${plan.tokenId} (${plan.intentId})`,
    );
  }
  const feeUsd = parseUsd(plan.feeUsd, 'plan.feeUsd');
  const amount = parseUnits(plan.amount, 'plan.amount');
  if (!amount.greaterThan(0)) {
    throw new PaperLedgerError(
      `Cannot book a buy with a non-positive token amount for ${plan.tokenId} (${plan.intentId})`,
    );
  }
  const priceUsd = parseUnits(plan.priceUsd, 'plan.priceUsd');
  if (!priceUsd.greaterThan(0)) {
    throw new PaperLedgerError(
      `Cannot book a buy with a non-positive price for ${plan.tokenId} (${plan.intentId})`,
    );
  }

  if (Object.hasOwn(state.positions, plan.tokenId)) {
    throw new PaperLedgerError(
      `${plan.tokenId} already has an open position; the sandbox does not allow adds`,
    );
  }

  const cash = parseUsd(state.cashUsd, 'state.cashUsd');
  const costUsd = filledUsd.plus(feeUsd);
  const cashAfterUsd = cash.minus(costUsd);
  if (cashAfterUsd.isNegative()) {
    throw new PaperLedgerError(
      `Buy of ${money(costUsd)} USD for ${plan.tokenId} exceeds the ${money(cash)} USD cash balance`,
    );
  }

  const avgCostUsd = costUsd.div(amount);
  const sequence = state.entries.length + 1;

  const entry: LedgerEntry = {
    entryId: `${intent.intentId}:ledger`,
    sequence,
    clockTime,
    tokenId: plan.tokenId,
    side: 'buy',
    intentId: intent.intentId,
    amount: units(amount),
    priceUsd: units(priceUsd),
    notionalUsd: money(filledUsd),
    feeUsd: money(feeUsd),
    cashAfterUsd: money(cashAfterUsd),
    positionAmountAfter: units(amount),
    positionAvgCostAfter: units(avgCostUsd),
    realizedPnlUsd: null,
    reasonCode: Reason.LEDGER_BUY,
  };

  const position: PaperPosition = {
    tokenId: plan.tokenId,
    strategyKey: intent.strategyKey,
    strategyVersion: intent.strategyVersion,
    amount: units(amount),
    avgCostUsd: units(avgCostUsd),
    openedAt: clockTime,
    stopLossPct: intent.stopLossPct,
    takeProfitPct: intent.takeProfitPct,
    entryIntentId: intent.intentId,
    feesPaidUsd: money(feeUsd),
  };

  const trade: PaperTrade = {
    tradeId: `${intent.intentId}:trade`,
    tokenId: plan.tokenId,
    strategyKey: intent.strategyKey,
    strategyVersion: intent.strategyVersion,
    entryAt: clockTime,
    entryPriceUsd: units(priceUsd),
    entryAmount: units(amount),
    entryNotionalUsd: money(filledUsd),
    entryFeeUsd: money(feeUsd),
    entryIntentId: intent.intentId,
    exitAt: null,
    exitPriceUsd: null,
    exitAmount: ZERO_UNITS,
    exitNotionalUsd: ZERO_USD,
    exitFeeUsd: ZERO_USD,
    exitReasonCode: null,
    exitIntentId: null,
    realizedPnlUsd: ZERO_USD,
    status: 'open',
  };

  return {
    state: {
      ...state,
      cashUsd: money(cashAfterUsd),
      positions: { ...state.positions, [plan.tokenId]: position },
      entries: [...state.entries, entry],
      feesPaidUsd: money(parseUsd(state.feesPaidUsd, 'state.feesPaidUsd').plus(feeUsd)),
      openTrades: { ...state.openTrades, [plan.tokenId]: trade },
    },
    entry,
    trade,
  };
}

/**
 * Books one filled/partial sell against the open position and trade.
 *
 * The applied amount is clamped to the stored position (`min`), which absorbs
 * the 1e-8 rounding edge where a fill plan may emit a hair more than the
 * ledger holds. The plan's booked `notionalUsd`, `feeUsd` and `proceedsUsd`
 * are used as-is, so `notional - fee = proceeds` and the cash trail keep their
 * exact cents. A partial sell aggregates into the open trade; the trade closes
 * and moves to `closedTrades` when the position reaches zero. `exitAt`,
 * `exitIntentId` and `exitReasonCode` are last-writer-wins across partial exits;
 * the exit price is the amount-weighted average of the fill prices.
 */
export function applySellFill(
  state: PaperLedgerState,
  plan: SellFillPlan,
  intent: OrderIntent,
  clockTime: Timestamp,
): LedgerApplyResult {
  assertFillPlan(plan, intent, 'sell');

  const planAmount = parseUnits(plan.filledAmount, 'plan.filledAmount');
  if (!planAmount.greaterThan(0)) {
    throw new PaperLedgerError(
      `Cannot book a sell with a non-positive filled amount for ${plan.tokenId} (${plan.intentId})`,
    );
  }
  const notionalUsd = parseUsd(plan.notionalUsd, 'plan.notionalUsd');
  if (!notionalUsd.greaterThan(0)) {
    throw new PaperLedgerError(
      `Cannot book a sell with a non-positive notional for ${plan.tokenId} (${plan.intentId})`,
    );
  }
  const feeUsd = parseUsd(plan.feeUsd, 'plan.feeUsd');
  const proceedsUsd = parseUsd(plan.proceedsUsd, 'plan.proceedsUsd');
  if (!notionalUsd.minus(feeUsd).equals(proceedsUsd)) {
    throw new PaperLedgerError(
      `Sell plan for ${plan.tokenId} (${plan.intentId}) must satisfy notionalUsd - feeUsd = proceedsUsd`,
    );
  }
  const priceUsd = parseUnits(plan.priceUsd, 'plan.priceUsd');
  if (!priceUsd.greaterThan(0)) {
    throw new PaperLedgerError(
      `Cannot book a sell with a non-positive price for ${plan.tokenId} (${plan.intentId})`,
    );
  }

  const position = state.positions[plan.tokenId];
  if (position === undefined) {
    throw new PaperLedgerError(
      `Cannot sell ${plan.tokenId}: no open position exists (${plan.intentId})`,
    );
  }
  const positionAmount = parseUnits(position.amount, `position ${plan.tokenId}.amount`);
  if (!positionAmount.greaterThan(0)) {
    throw new PaperLedgerError(`Cannot sell ${plan.tokenId}: the position amount is not positive`);
  }

  const trade = state.openTrades[plan.tokenId];
  if (trade === undefined || trade.status !== 'open') {
    throw new PaperLedgerError(
      `Cannot sell ${plan.tokenId}: no open trade exists for the position (${plan.intentId})`,
    );
  }

  // Clamp for the 1e-8 edge: the fill plan may emit a hair more than the ledger
  // holds because it compares displayed amounts. Anything larger is a plan or
  // state out of sync, not a display rounding difference.
  const appliedAmount = minDecimal(planAmount, positionAmount);
  const overshoot = planAmount.minus(appliedAmount);
  if (overshoot.greaterThan('0.00000001')) {
    throw new PaperLedgerError(
      `Sell plan for ${plan.tokenId} (${plan.intentId}) fills ${plan.filledAmount}, more than the ${position.amount} position by ${units(overshoot)}; only a 1e-8 display edge may be clamped`,
    );
  }
  const remainingAmount = positionAmount.minus(appliedAmount);
  const avgCostUsd = parseUnits(position.avgCostUsd, `position ${plan.tokenId}.avgCostUsd`);
  const realizedUsd = money(proceedsUsd.minus(appliedAmount.times(avgCostUsd)));

  const cashAfterUsd = parseUsd(state.cashUsd, 'state.cashUsd').plus(proceedsUsd);
  const exitAmount = parseUnits(trade.exitAmount, 'trade.exitAmount').plus(appliedAmount);
  const exitNotionalUsd = parseUsd(trade.exitNotionalUsd, 'trade.exitNotionalUsd').plus(
    notionalUsd,
  );
  const exitFeeUsd = parseUsd(trade.exitFeeUsd, 'trade.exitFeeUsd').plus(feeUsd);
  const previousExitPrice =
    trade.exitPriceUsd === null ? null : parseUnits(trade.exitPriceUsd, 'trade.exitPriceUsd');
  // Use the applied amounts and the fill prices for the weighted average rather
  // than `exitNotional / exitAmount`, which carries the two-decimal notional
  // rounding into the price.
  const exitPriceUsd =
    previousExitPrice === null
      ? priceUsd
      : previousExitPrice
          .times(exitAmount.minus(appliedAmount))
          .plus(priceUsd.times(appliedAmount))
          .div(exitAmount);

  const closed = remainingAmount.isZero();
  const updatedTrade: PaperTrade = {
    ...trade,
    exitAt: clockTime,
    exitPriceUsd: units(exitPriceUsd),
    exitAmount: units(exitAmount),
    exitNotionalUsd: money(exitNotionalUsd),
    exitFeeUsd: money(exitFeeUsd),
    exitReasonCode: intent.reasonCode,
    exitIntentId: intent.intentId,
    realizedPnlUsd: money(
      parseSigned(trade.realizedPnlUsd, 'trade.realizedPnlUsd').plus(realizedUsd),
    ),
    status: closed ? 'closed' : 'open',
  };

  const positions = { ...state.positions };
  const openTrades = { ...state.openTrades };
  if (closed) {
    delete positions[plan.tokenId];
    delete openTrades[plan.tokenId];
  } else {
    positions[plan.tokenId] = { ...position, amount: units(remainingAmount) };
    openTrades[plan.tokenId] = updatedTrade;
  }

  const sequence = state.entries.length + 1;
  const entry: LedgerEntry = {
    entryId: `${intent.intentId}:ledger`,
    sequence,
    clockTime,
    tokenId: plan.tokenId,
    side: 'sell',
    intentId: intent.intentId,
    amount: units(appliedAmount),
    priceUsd: units(priceUsd),
    notionalUsd: money(notionalUsd),
    feeUsd: money(feeUsd),
    cashAfterUsd: money(cashAfterUsd),
    positionAmountAfter: units(remainingAmount),
    positionAvgCostAfter: closed ? null : position.avgCostUsd,
    realizedPnlUsd: realizedUsd,
    reasonCode: Reason.LEDGER_SELL,
  };

  return {
    state: {
      ...state,
      cashUsd: money(cashAfterUsd),
      positions,
      entries: [...state.entries, entry],
      realizedPnlUsd: money(
        parseSigned(state.realizedPnlUsd, 'state.realizedPnlUsd').plus(realizedUsd),
      ),
      feesPaidUsd: money(parseUsd(state.feesPaidUsd, 'state.feesPaidUsd').plus(feeUsd)),
      closedTrades: closed ? [...state.closedTrades, updatedTrade] : state.closedTrades,
      openTrades,
    },
    entry,
    trade: updatedTrade,
  };
}

/**
 * Marks the book at the supplied prices.
 *
 * Every open position must have a mark; a missing or malformed mark is a data
 * error (`PaperLedgerError`), never a silent zero. Positions are returned sorted
 * by token id so the projection is deterministic. Equity, positions value and
 * unrealized P&L are computed from exact decimals and rounded once to cents.
 */
export function markPortfolio(
  state: PaperLedgerState,
  marks: Readonly<Record<string, string>>,
): {
  readonly equityUsd: string;
  readonly positionsValueUsd: string;
  readonly unrealizedPnlUsd: string;
  readonly positions: readonly PortfolioPosition[];
} {
  const cashUsd = parseUsd(state.cashUsd, 'state.cashUsd');
  const tokenIds = Object.keys(state.positions).sort();

  let positionsValue = ZERO;
  let unrealizedPnl = ZERO;
  const positions: PortfolioPosition[] = [];

  for (const tokenId of tokenIds) {
    const position = state.positions[tokenId];
    if (position === undefined) continue;
    if (!Object.hasOwn(marks, tokenId)) {
      throw new PaperLedgerError(`Missing mark price for ${tokenId}`);
    }
    const markUsd = parseUnits(marks[tokenId] as string, `marks.${tokenId}`);
    const amount = parseUnits(position.amount, `position ${tokenId}.amount`);
    const avgCostUsd = parseUnits(position.avgCostUsd, `position ${tokenId}.avgCostUsd`);
    const marketValueUsd = amount.times(markUsd);

    positionsValue = positionsValue.plus(marketValueUsd);
    unrealizedPnl = unrealizedPnl.plus(markUsd.minus(avgCostUsd).times(amount));
    positions.push({
      tokenId,
      strategyKey: position.strategyKey,
      strategyVersion: position.strategyVersion,
      amount: position.amount,
      avgCostUsd: position.avgCostUsd,
      marketPriceUsd: units(markUsd),
      marketValueUsd: money(marketValueUsd),
      openedAt: position.openedAt,
      stopLossPct: position.stopLossPct,
      takeProfitPct: position.takeProfitPct,
    });
  }

  return {
    equityUsd: money(cashUsd.plus(positionsValue)),
    positionsValueUsd: money(positionsValue),
    unrealizedPnlUsd: money(unrealizedPnl),
    positions,
  };
}

/** Reads a decimal string for reconciliation, allowing a negative tampered value. */
function readDecimal(value: unknown, label: string, discrepancies: string[]): Decimal | null {
  if (typeof value !== 'string' || !SIGNED_DECIMAL.test(value)) {
    discrepancies.push(`${label} is not a decimal string: ${String(value)}`);
    return null;
  }
  return new Decimal(value);
}

interface LedgerTotals {
  readonly buyAmount: Decimal;
  readonly buyNotional: Decimal;
  readonly buyFee: Decimal;
  readonly sellAmount: Decimal;
  readonly sellNotional: Decimal;
  readonly sellFee: Decimal;
  readonly sellRealized: Decimal;
  readonly fees: Decimal;
  readonly buyCount: number;
}

/** Sums the append-only entries and validates each row's shape. */
function scanEntries(entries: readonly LedgerEntry[], discrepancies: string[]): LedgerTotals {
  let buyAmount = ZERO;
  let buyNotional = ZERO;
  let buyFee = ZERO;
  let sellAmount = ZERO;
  let sellNotional = ZERO;
  let sellFee = ZERO;
  let sellRealized = ZERO;
  let fees = ZERO;
  let buyCount = 0;
  const entryIds = new Set<string>();

  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    if (entry === undefined) continue;
    const label = `entry[${index}]`;

    if (entryIds.has(entry.entryId)) {
      discrepancies.push(`${label} duplicates the entry id ${entry.entryId}`);
    }
    entryIds.add(entry.entryId);
    if (entry.sequence !== index + 1) {
      discrepancies.push(
        `${label} (${entry.entryId}) has sequence ${entry.sequence}, expected ${index + 1}`,
      );
    }
    if (entry.side !== 'buy' && entry.side !== 'sell') {
      discrepancies.push(`${label} has an unknown side ${String(entry.side)}`);
      continue;
    }

    const amount = readDecimal(entry.amount, `${label}.amount`, discrepancies);
    const notional = readDecimal(entry.notionalUsd, `${label}.notionalUsd`, discrepancies);
    const fee = readDecimal(entry.feeUsd, `${label}.feeUsd`, discrepancies);
    const price = readDecimal(entry.priceUsd, `${label}.priceUsd`, discrepancies);
    if (amount !== null && !amount.greaterThan(0)) {
      discrepancies.push(`${label}.amount must be positive, received ${entry.amount}`);
    }
    if (notional !== null && !notional.greaterThan(0)) {
      discrepancies.push(`${label}.notionalUsd must be positive, received ${entry.notionalUsd}`);
    }
    if (fee !== null && fee.isNegative()) {
      discrepancies.push(`${label}.feeUsd must not be negative, received ${entry.feeUsd}`);
    }
    if (price !== null && !price.greaterThan(0)) {
      discrepancies.push(`${label}.priceUsd must be positive, received ${entry.priceUsd}`);
    }

    if (amount !== null && notional !== null && fee !== null) {
      fees = fees.plus(fee);
      if (entry.side === 'buy') {
        buyCount += 1;
        buyAmount = buyAmount.plus(amount);
        buyNotional = buyNotional.plus(notional);
        buyFee = buyFee.plus(fee);
        if (entry.realizedPnlUsd !== null) {
          discrepancies.push(`${label} is a buy but carries realizedPnlUsd`);
        }
      } else {
        sellAmount = sellAmount.plus(amount);
        sellNotional = sellNotional.plus(notional);
        sellFee = sellFee.plus(fee);
        const realized = readDecimal(
          entry.realizedPnlUsd,
          `${label}.realizedPnlUsd`,
          discrepancies,
        );
        if (realized !== null) sellRealized = sellRealized.plus(realized);
      }
    }
  }

  return {
    buyAmount,
    buyNotional,
    buyFee,
    sellAmount,
    sellNotional,
    sellFee,
    sellRealized,
    fees,
    buyCount,
  };
}

interface TradeTotals {
  entryAmount: Decimal;
  entryNotional: Decimal;
  entryFee: Decimal;
  exitAmount: Decimal;
  exitNotional: Decimal;
  exitFee: Decimal;
  realized: Decimal;
  count: number;
}

function accumulateTrade(
  trade: PaperTrade,
  label: string,
  closed: boolean,
  discrepancies: string[],
  totals: TradeTotals,
): void {
  const entryAmount = readDecimal(trade.entryAmount, `${label}.entryAmount`, discrepancies);
  const entryNotional = readDecimal(
    trade.entryNotionalUsd,
    `${label}.entryNotionalUsd`,
    discrepancies,
  );
  const entryFee = readDecimal(trade.entryFeeUsd, `${label}.entryFeeUsd`, discrepancies);
  const exitAmount = readDecimal(trade.exitAmount, `${label}.exitAmount`, discrepancies);
  const exitNotional = readDecimal(
    trade.exitNotionalUsd,
    `${label}.exitNotionalUsd`,
    discrepancies,
  );
  const exitFee = readDecimal(trade.exitFeeUsd, `${label}.exitFeeUsd`, discrepancies);
  const realized = readDecimal(trade.realizedPnlUsd, `${label}.realizedPnlUsd`, discrepancies);

  if (entryAmount !== null && !entryAmount.greaterThan(0)) {
    discrepancies.push(`${label}.entryAmount must be positive, received ${trade.entryAmount}`);
  }
  if (entryNotional !== null && !entryNotional.greaterThan(0)) {
    discrepancies.push(
      `${label}.entryNotionalUsd must be positive, received ${trade.entryNotionalUsd}`,
    );
  }
  if (exitAmount !== null && exitAmount.isNegative()) {
    discrepancies.push(`${label}.exitAmount must not be negative, received ${trade.exitAmount}`);
  }
  if (entryFee !== null && entryFee.isNegative()) {
    discrepancies.push(`${label}.entryFeeUsd must not be negative, received ${trade.entryFeeUsd}`);
  }
  if (exitNotional !== null && exitNotional.isNegative()) {
    discrepancies.push(
      `${label}.exitNotionalUsd must not be negative, received ${trade.exitNotionalUsd}`,
    );
  }
  if (exitFee !== null && exitFee.isNegative()) {
    discrepancies.push(`${label}.exitFeeUsd must not be negative, received ${trade.exitFeeUsd}`);
  }
  if (exitAmount !== null && exitAmount.greaterThan(0) && trade.exitPriceUsd === null) {
    discrepancies.push(`${label} has exit amounts but no exitPriceUsd`);
  }

  if (!closed) {
    if (trade.status !== 'open') {
      discrepancies.push(`${label} is in openTrades but has status ${String(trade.status)}`);
    }
  } else {
    if (trade.status !== 'closed') {
      discrepancies.push(`${label} is in closedTrades but has status ${String(trade.status)}`);
    }
    if (trade.exitAt === null) discrepancies.push(`${label} is closed but has no exitAt`);
    if (trade.exitIntentId === null)
      discrepancies.push(`${label} is closed but has no exitIntentId`);
    if (trade.exitReasonCode === null) {
      discrepancies.push(`${label} is closed but has no exitReasonCode`);
    }
    if (exitAmount !== null && !exitAmount.greaterThan(0)) {
      discrepancies.push(`${label}.exitAmount must be positive for a closed trade`);
    }
  }

  if (entryAmount !== null) totals.entryAmount = totals.entryAmount.plus(entryAmount);
  if (entryNotional !== null) totals.entryNotional = totals.entryNotional.plus(entryNotional);
  if (entryFee !== null) totals.entryFee = totals.entryFee.plus(entryFee);
  if (exitAmount !== null) totals.exitAmount = totals.exitAmount.plus(exitAmount);
  if (exitNotional !== null) totals.exitNotional = totals.exitNotional.plus(exitNotional);
  if (exitFee !== null) totals.exitFee = totals.exitFee.plus(exitFee);
  if (realized !== null) totals.realized = totals.realized.plus(realized);
  totals.count += 1;
}

/**
 * Verifies the ledger identities from design §6.3.
 *
 * Checks: cash = initial - buys + sell proceeds; per-token position amounts =
 * buys - sells; realized P&L = sum of sell entries; fees = sum of entry fees;
 * trade aggregates match the entries; equity = cash + positions value; and
 * `equity - initial = realized + unrealized` within one cent. Every issue is
 * returned as a message, so a caller can fail the run and print the report.
 * A missing mark is reported here rather than thrown.
 */
export function reconcileLedger(
  state: PaperLedgerState,
  marks: Readonly<Record<string, string>>,
): { readonly ok: boolean; readonly discrepancies: readonly string[] } {
  const discrepancies: string[] = [];
  const initial = readDecimal(state.initialCapitalUsd, 'initialCapitalUsd', discrepancies);
  const cash = readDecimal(state.cashUsd, 'cashUsd', discrepancies);
  const realized = readDecimal(state.realizedPnlUsd, 'realizedPnlUsd', discrepancies);
  const fees = readDecimal(state.feesPaidUsd, 'feesPaidUsd', discrepancies);

  if (cash !== null && cash.isNegative()) {
    discrepancies.push(`cashUsd is negative: ${state.cashUsd}`);
  }
  if (fees !== null && fees.isNegative()) {
    discrepancies.push(`feesPaidUsd is negative: ${state.feesPaidUsd}`);
  }

  const totals = scanEntries(state.entries, discrepancies);

  // Rebuild the token and intent indexes independently of the cash trail, so a
  // malformed initial balance does not hide position-level findings. The same
  // pass re-derives `positionAmountAfter` from the entries and checks that clock
  // time never moves backwards (the ledger is append-only and chronological).
  const positionsByToken = new Map<string, Decimal>();
  const buyEntriesByIntent = new Map<string, LedgerEntry>();
  const runningAmounts = new Map<string, Decimal>();
  let previousClock: Timestamp | null = null;
  for (let index = 0; index < state.entries.length; index += 1) {
    const entry = state.entries[index];
    if (entry === undefined) continue;
    const label = `entry[${index}] (${entry.entryId})`;
    if (previousClock !== null && entry.clockTime < previousClock) {
      discrepancies.push(
        `${label} clockTime ${entry.clockTime} is earlier than the previous entry clockTime ${previousClock}`,
      );
    }
    previousClock = entry.clockTime;

    if (entry.side !== 'buy' && entry.side !== 'sell') continue;
    const amount = readDecimal(entry.amount, `${label}.amount`, discrepancies);
    if (amount === null) continue;
    const amountAfter = (runningAmounts.get(entry.tokenId) ?? ZERO).plus(
      entry.side === 'buy' ? amount : amount.negated(),
    );
    runningAmounts.set(entry.tokenId, amountAfter);
    positionsByToken.set(entry.tokenId, amountAfter);
    if (amountAfter.isNegative()) {
      discrepancies.push(
        `${label} drives the ${entry.tokenId} position negative (${units(amountAfter)})`,
      );
    }
    const recordedAmountAfter = readDecimal(
      entry.positionAmountAfter,
      `${label}.positionAmountAfter`,
      discrepancies,
    );
    if (recordedAmountAfter !== null && !recordedAmountAfter.equals(amountAfter)) {
      discrepancies.push(
        `${label} records positionAmountAfter ${entry.positionAmountAfter} for ${entry.tokenId}, expected ${units(amountAfter)}`,
      );
    }
    if (entry.side === 'buy') buyEntriesByIntent.set(entry.intentId, entry);
  }

  // Cash trail: replay every entry in order and compare its recorded balance.
  if (initial !== null) {
    let runningCash = initial;
    for (let index = 0; index < state.entries.length; index += 1) {
      const entry = state.entries[index];
      if (entry === undefined) continue;
      const label = `entry[${index}] (${entry.entryId})`;
      if (entry.side !== 'buy' && entry.side !== 'sell') continue;
      const notional = readDecimal(entry.notionalUsd, `${label}.notionalUsd`, discrepancies);
      const fee = readDecimal(entry.feeUsd, `${label}.feeUsd`, discrepancies);
      const cashAfter = readDecimal(entry.cashAfterUsd, `${label}.cashAfterUsd`, discrepancies);
      if (notional === null || fee === null) continue;
      runningCash =
        entry.side === 'buy'
          ? runningCash.minus(notional.plus(fee))
          : runningCash.plus(notional.minus(fee));
      if (cashAfter !== null && cashAfter.isNegative()) {
        discrepancies.push(`${label} has a negative cashAfterUsd ${entry.cashAfterUsd}`);
      }
      if (cashAfter !== null && !cashAfter.equals(runningCash)) {
        discrepancies.push(
          `${label} records cashAfterUsd ${entry.cashAfterUsd}, expected ${money(runningCash)}`,
        );
      }
    }
  }

  if (initial !== null && cash !== null) {
    const expectedCash = initial
      .minus(totals.buyNotional.plus(totals.buyFee))
      .plus(totals.sellNotional.minus(totals.sellFee));
    if (!cash.equals(expectedCash)) {
      discrepancies.push(
        `cashUsd ${state.cashUsd} does not equal initial capital minus buy cost plus sell proceeds (expected ${money(expectedCash)})`,
      );
    }
  }

  if (fees !== null && !fees.equals(totals.fees)) {
    discrepancies.push(
      `feesPaidUsd ${state.feesPaidUsd} does not equal the sum of entry fees (${money(totals.fees)})`,
    );
  }

  if (realized !== null && !realized.equals(totals.sellRealized)) {
    discrepancies.push(
      `realizedPnlUsd ${state.realizedPnlUsd} does not equal the sum of sell entries (${money(totals.sellRealized)})`,
    );
  }

  // Per-token position amounts.
  const tokenIds = new Set<string>([...positionsByToken.keys(), ...Object.keys(state.positions)]);
  for (const tokenId of [...tokenIds].sort()) {
    const position = state.positions[tokenId];
    const expected = positionsByToken.get(tokenId) ?? ZERO;
    if (position === undefined) {
      if (!expected.isZero()) {
        discrepancies.push(
          `ledger entries imply ${units(expected)} of ${tokenId}, but no position exists`,
        );
      }
      continue;
    }
    const amount = readDecimal(position.amount, `position ${tokenId}.amount`, discrepancies);
    const avgCost = readDecimal(
      position.avgCostUsd,
      `position ${tokenId}.avgCostUsd`,
      discrepancies,
    );
    const positionFees = readDecimal(
      position.feesPaidUsd,
      `position ${tokenId}.feesPaidUsd`,
      discrepancies,
    );
    if (amount !== null) {
      if (!amount.greaterThan(0)) {
        discrepancies.push(`position ${tokenId} has a non-positive amount ${position.amount}`);
      }
      if (!amount.equals(expected)) {
        discrepancies.push(
          `position ${tokenId} amount ${position.amount} does not match buy minus sell entries (${units(expected)})`,
        );
      }
    }
    if (avgCost !== null && !avgCost.greaterThan(0)) {
      discrepancies.push(
        `position ${tokenId} has a non-positive average cost ${position.avgCostUsd}`,
      );
    }
    if (positionFees !== null && positionFees.isNegative()) {
      discrepancies.push(`position ${tokenId} has negative fees ${position.feesPaidUsd}`);
    }
    const buyEntry = buyEntriesByIntent.get(position.entryIntentId);
    if (buyEntry === undefined) {
      discrepancies.push(
        `position ${tokenId} entry intent ${position.entryIntentId} has no matching buy entry`,
      );
    } else {
      if (buyEntry.tokenId !== tokenId) {
        discrepancies.push(
          `position ${tokenId} entry intent ${position.entryIntentId} belongs to ${buyEntry.tokenId}`,
        );
      }
      const entryFee = readDecimal(
        buyEntry.feeUsd,
        `entry ${buyEntry.entryId}.feeUsd`,
        discrepancies,
      );
      if (positionFees !== null && entryFee !== null && !positionFees.equals(entryFee)) {
        discrepancies.push(
          `position ${tokenId} feesPaidUsd ${position.feesPaidUsd} does not equal its buy fee ${buyEntry.feeUsd}`,
        );
      }
    }
    const trade = state.openTrades[tokenId];
    if (trade === undefined) {
      discrepancies.push(`position ${tokenId} has no open trade`);
    } else if (trade.entryIntentId !== position.entryIntentId) {
      discrepancies.push(
        `position ${tokenId} and its open trade disagree on the entry intent (${position.entryIntentId} vs ${trade.entryIntentId})`,
      );
    }
  }

  for (const tokenId of Object.keys(state.openTrades).sort()) {
    if (!Object.hasOwn(state.positions, tokenId)) {
      discrepancies.push(`openTrades has ${tokenId} without a position`);
    }
  }

  // Trade aggregates across every round trip.
  const tradeTotals: TradeTotals = {
    entryAmount: ZERO,
    entryNotional: ZERO,
    entryFee: ZERO,
    exitAmount: ZERO,
    exitNotional: ZERO,
    exitFee: ZERO,
    realized: ZERO,
    count: 0,
  };

  for (const tokenId of Object.keys(state.openTrades).sort()) {
    const trade = state.openTrades[tokenId];
    if (trade === undefined) continue;
    if (trade.tokenId !== tokenId) {
      discrepancies.push(`openTrades.${tokenId} contains a trade for ${trade.tokenId}`);
    }
    if (!buyEntriesByIntent.has(trade.entryIntentId)) {
      discrepancies.push(
        `open trade ${trade.tradeId} entry intent ${trade.entryIntentId} has no matching buy entry`,
      );
    }
    accumulateTrade(trade, `openTrades.${tokenId}`, false, discrepancies, tradeTotals);
  }

  for (let index = 0; index < state.closedTrades.length; index += 1) {
    const trade = state.closedTrades[index];
    if (trade === undefined) continue;
    if (!buyEntriesByIntent.has(trade.entryIntentId)) {
      discrepancies.push(
        `closed trade[${index}] (${trade.tradeId}) entry intent ${trade.entryIntentId} has no matching buy entry`,
      );
    }
    accumulateTrade(trade, `closedTrades[${index}]`, true, discrepancies, tradeTotals);
  }

  if (!tradeTotals.entryAmount.equals(totals.buyAmount)) {
    discrepancies.push(
      `trade entry amounts ${units(tradeTotals.entryAmount)} do not equal buy entry amounts ${units(totals.buyAmount)}`,
    );
  }
  if (!tradeTotals.entryNotional.equals(totals.buyNotional)) {
    discrepancies.push(
      `trade entry notional ${money(tradeTotals.entryNotional)} does not equal buy entry notional ${money(totals.buyNotional)}`,
    );
  }
  if (!tradeTotals.entryFee.equals(totals.buyFee)) {
    discrepancies.push(
      `trade entry fees ${money(tradeTotals.entryFee)} do not equal buy entry fees ${money(totals.buyFee)}`,
    );
  }
  if (!tradeTotals.exitAmount.equals(totals.sellAmount)) {
    discrepancies.push(
      `trade exit amounts ${units(tradeTotals.exitAmount)} do not equal sell entry amounts ${units(totals.sellAmount)}`,
    );
  }
  if (!tradeTotals.exitNotional.equals(totals.sellNotional)) {
    discrepancies.push(
      `trade exit notional ${money(tradeTotals.exitNotional)} does not equal sell entry notional ${money(totals.sellNotional)}`,
    );
  }
  if (!tradeTotals.exitFee.equals(totals.sellFee)) {
    discrepancies.push(
      `trade exit fees ${money(tradeTotals.exitFee)} do not equal sell entry fees ${money(totals.sellFee)}`,
    );
  }
  if (!tradeTotals.realized.equals(totals.sellRealized)) {
    discrepancies.push(
      `trade realized P&L ${money(tradeTotals.realized)} does not equal sell entry realized P&L ${money(totals.sellRealized)}`,
    );
  }
  if (tradeTotals.count !== totals.buyCount) {
    discrepancies.push(`${tradeTotals.count} trades do not match ${totals.buyCount} buy entries`);
  }

  // Equity identities through the projection.
  let marked: ReturnType<typeof markPortfolio> | null = null;
  try {
    marked = markPortfolio(state, marks);
  } catch (error) {
    if (error instanceof PaperLedgerError) {
      discrepancies.push(error.message);
    } else {
      throw error;
    }
  }

  if (marked !== null) {
    const equity = new Decimal(marked.equityUsd);
    const positionsValue = new Decimal(marked.positionsValueUsd);
    const unrealized = new Decimal(marked.unrealizedPnlUsd);
    if (cash !== null) {
      const cashPlusPositions = cash.plus(positionsValue);
      if (equity.minus(cashPlusPositions).abs().greaterThan('0.01')) {
        discrepancies.push(
          `equityUsd ${marked.equityUsd} does not equal cash plus positions value (${money(cashPlusPositions)})`,
        );
      }
    }
    if (initial !== null && realized !== null) {
      const identity = equity.minus(initial).minus(realized.plus(unrealized));
      if (identity.abs().greaterThan('0.01')) {
        discrepancies.push(
          `equity minus initial capital differs from realized plus unrealized P&L by ${money(identity.abs())} (equity ${marked.equityUsd}, initial ${state.initialCapitalUsd}, realized ${state.realizedPnlUsd}, unrealized ${marked.unrealizedPnlUsd})`,
        );
      }
    }
  }

  return { ok: discrepancies.length === 0, discrepancies };
}

import Decimal from 'decimal.js';
import { DecimalInputError, toDecimal } from '../decision/decimal';
import { TIMEFRAME_MS } from '../timeframes';
import type { Candle, Timestamp } from '../types';
import type {
  CounterfactualInput,
  CounterfactualOutcome,
  CounterfactualRecord,
  RejectedBuy,
} from './types';

/**
 * Post-run hindsight counterfactuals for rejected buys.
 *
 * Every buy the sandbox did not take is replayed as a **normalized $100
 * notional** round trip on the same candles, with the same fee and slippage
 * assumptions as the paper run. The result answers "what would have happened?"
 * and nothing else: this module never calls the decision engine, never books a
 * ledger entry, never emits an event, and every record is stamped
 * `hindsight: true` / `usedForDecisions: false` so no consumer can feed it back.
 *
 * Timing follows the paper fill convention exactly. A decision at bar close `T`
 * fills at the first bar with `openTime >= T` — the next bar open at the decision
 * close — not at `T` itself and not strictly after `T`. The exit is the first
 * bar close (`openTime + timeframe`) at or after `entryOpenTime + horizonHours`,
 * priced at that bar's close.
 *
 * Money is `Decimal` until formatting. Prices are 8-decimal USD strings; the
 * $100 notional, its fee and the sale notional are 2-decimal USD strings; the
 * return is a 2-decimal percentage of the all-in cost. The size and sale are
 * computed from the **exact** slippage-adjusted prices, and the 8-decimal price
 * strings are for display only: a low-priced token has few significant digits at
 * 8 decimals, so feeding the rounded price back into `amount = 100 / entryPrice`
 * would erase slippage, and a price that rounds to `0.00000000` is reported as
 * `insufficient_data` instead of dividing by zero. The sale is rounded once to
 * cents, the fee is `feeBps` of the booked sale, proceeds are
 * `sale - fee`, and the return compares proceeds with `100 + buy fee`. The
 * outcome is classified from that emitted two-decimal return, so a record never
 * shows `0.00` beside a directional verdict.
 *
 * Invalid caller settings (horizon, fee/slippage basis points), malformed
 * rejection rows and candle series with an unusable timestamp or timeframe throw
 * `CounterfactualInputError`: those are programmer/data-contract mistakes. A
 * merely absent or unpriced bar is a data shortfall, which is reported as
 * `insufficient_data` instead of thrown.
 */

const BPS = new Decimal(10_000);
const HUNDRED = new Decimal(100);
const HOUR_MS = 3_600_000;
const NOTIONAL_USD = new Decimal(100);
const ONE = new Decimal(1);
const ZERO_PRICE = '0.00000000';
const ZERO_PCT = '0.00';

/** Typed input error for a malformed counterfactual request. */
export class CounterfactualInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CounterfactualInputError';
  }
}

function assertFinite(value: number, label: string): void {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new CounterfactualInputError(`${label} must be a finite number`);
  }
}

function assertBps(value: number, label: string): void {
  assertFinite(value, label);
  if (value < 0 || value >= 10_000) {
    throw new CounterfactualInputError(`${label} must be in [0, 10000)`);
  }
}

function assertHorizon(value: number): void {
  assertFinite(value, 'horizonHours');
  if (value <= 0) {
    throw new CounterfactualInputError('horizonHours must be a positive number');
  }
}

/** Parses a candle price, returning `null` when it cannot price a trade. */
function parsePrice(value: string, label: string): Decimal | null {
  let parsed: Decimal;
  try {
    parsed = toDecimal(value, label);
  } catch (error) {
    if (error instanceof DecimalInputError) return null;
    throw error;
  }
  return parsed.greaterThan(0) ? parsed : null;
}

/** Bar close time; the timeframe must be one of the package's known values. */
function candleCloseTime(candle: Candle): Timestamp {
  if (!Object.hasOwn(TIMEFRAME_MS, candle.timeframe)) {
    throw new CounterfactualInputError(`Unknown candle timeframe: ${candle.timeframe}`);
  }
  return candle.openTime + (TIMEFRAME_MS[candle.timeframe] as number);
}

/**
 * Groups candles by token, validates their timestamps/timeframes once and sorts
 * each series by `openTime` ascending. Sorting is by numeric timestamp only, so
 * it is locale-independent and stable for duplicate bars.
 *
 * A token must use exactly one timeframe: mixing bars of different lengths makes
 * the exit close (`openTime + timeframe`) ambiguous, so a mixed series is a
 * caller error instead of a silently mispriced round trip.
 */
function indexCandles(candles: readonly Candle[]): Map<string, Candle[]> {
  const byToken = new Map<string, Candle[]>();
  const timeframes = new Map<string, string>();
  for (const candle of candles) {
    if (!Number.isFinite(candle.openTime)) {
      throw new CounterfactualInputError(
        `Candle ${candle.tokenId} has a non-finite openTime: ${String(candle.openTime)}`,
      );
    }
    if (!Object.hasOwn(TIMEFRAME_MS, candle.timeframe)) {
      throw new CounterfactualInputError(`Unknown candle timeframe: ${candle.timeframe}`);
    }
    const knownTimeframe = timeframes.get(candle.tokenId);
    if (knownTimeframe === undefined) {
      timeframes.set(candle.tokenId, candle.timeframe);
    } else if (knownTimeframe !== candle.timeframe) {
      throw new CounterfactualInputError(
        `Candles for ${candle.tokenId} mix timeframes "${knownTimeframe}" and "${candle.timeframe}"`,
      );
    }
    const series = byToken.get(candle.tokenId);
    if (series === undefined) {
      byToken.set(candle.tokenId, [candle]);
    } else {
      series.push(candle);
    }
  }
  for (const series of byToken.values()) {
    series.sort((left, right) => left.openTime - right.openTime);
  }
  return byToken;
}

/** Locale-independent code-unit ordering used by every deterministic sort. */
function compareCodeUnits(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function assertRejection(row: RejectedBuy): void {
  if (typeof row !== 'object' || row === null) {
    throw new CounterfactualInputError('rejected rows must be objects');
  }
  if (typeof row.tokenId !== 'string' || row.tokenId.trim().length === 0) {
    throw new CounterfactualInputError('rejected.tokenId must be a non-empty string');
  }
  if (typeof row.decisionTime !== 'number' || !Number.isFinite(row.decisionTime)) {
    throw new CounterfactualInputError(
      `rejected.decisionTime must be a finite timestamp for ${row.tokenId}`,
    );
  }
  if (typeof row.reasonCode !== 'string' || row.reasonCode.length === 0) {
    throw new CounterfactualInputError(
      `rejected.reasonCode must be a non-empty string for ${row.tokenId}`,
    );
  }
}

/**
 * Drops duplicate `(tokenId, decisionTime, reasonCode)` rows, keeping the first
 * occurrence, then sorts by decision time, token id and reason code.
 *
 * The reason code is the final tiebreak: two rejections can share a token and a
 * decision time but differ in why they were rejected, and the output order must
 * still be total and deterministic.
 */
function prepareRejections(rejected: readonly RejectedBuy[]): RejectedBuy[] {
  const seen = new Set<string>();
  const unique: RejectedBuy[] = [];
  for (const row of rejected) {
    assertRejection(row);
    const key = JSON.stringify([row.tokenId, row.decisionTime, row.reasonCode]);
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(row);
  }
  unique.sort((left, right) => {
    if (left.decisionTime !== right.decisionTime) {
      return left.decisionTime < right.decisionTime ? -1 : 1;
    }
    const byToken = compareCodeUnits(left.tokenId, right.tokenId);
    if (byToken !== 0) return byToken;
    return compareCodeUnits(left.reasonCode, right.reasonCode);
  });
  return unique;
}

/** Entry fill resolved from a bar open: its time and the slippage-adjusted price. */
interface EntryFill {
  readonly at: Timestamp;
  readonly priceUsd: string;
}

interface RecordIdentity {
  readonly tokenId: string;
  readonly decisionTime: Timestamp;
  readonly reasonCode: RejectedBuy['reasonCode'];
}

function insufficientRecord(
  identity: RecordIdentity,
  entry: EntryFill | null,
): CounterfactualRecord {
  return {
    tokenId: identity.tokenId,
    decisionTime: identity.decisionTime,
    reasonCode: identity.reasonCode,
    entryAt: entry === null ? null : entry.at,
    entryPriceUsd: entry === null ? null : entry.priceUsd,
    exitAt: null,
    exitPriceUsd: null,
    returnPct: null,
    outcome: 'insufficient_data',
    hindsight: true,
    usedForDecisions: false,
  };
}

function classify(returnPct: Decimal): CounterfactualOutcome {
  if (returnPct.greaterThan(0)) return 'missed_opportunity';
  if (returnPct.lessThan(0)) return 'bad_save';
  return 'neutral';
}

/**
 * Resolves one rejection into a hindsight record.
 *
 * Entry and exit bars are searched in the token's own sorted series. A bar that
 * exists but whose price is missing or non-positive counts as missing data; the
 * search does not skip past it, because "the next bar open" is a timing rule, not
 * a data-repair rule.
 */
function analyzeOne(
  identity: RecordIdentity,
  candles: readonly Candle[],
  horizonHours: number,
  feeBps: number,
  slippageBps: number,
): CounterfactualRecord {
  let entryIndex = -1;
  for (let index = 0; index < candles.length; index += 1) {
    if (candles[index].openTime >= identity.decisionTime) {
      entryIndex = index;
      break;
    }
  }
  if (entryIndex < 0) return insufficientRecord(identity, null);

  const entryCandle = candles[entryIndex];
  const entryOpen = parsePrice(entryCandle.open, 'candle.open');
  if (entryOpen === null) return insufficientRecord(identity, null);

  const slippage = new Decimal(slippageBps).div(BPS);
  // The exact price drives every money calculation; the 8-decimal string is for
  // display only. Rounding first would erase slippage on low-priced tokens (and
  // a sub-5e-9 price would round to zero, so the guard below rejects it).
  const entryPriceExact = entryOpen.times(ONE.plus(slippage));
  const entryPriceUsd = entryPriceExact.toFixed(8);
  if (!entryPriceExact.greaterThan(0) || entryPriceUsd === ZERO_PRICE) {
    return insufficientRecord(identity, null);
  }
  const entry: EntryFill = {
    at: entryCandle.openTime,
    priceUsd: entryPriceUsd,
  };

  const horizonTarget = new Decimal(entryCandle.openTime)
    .plus(new Decimal(horizonHours).times(HOUR_MS))
    .toNumber();

  let exitCandle: Candle | null = null;
  for (let index = entryIndex; index < candles.length; index += 1) {
    const candidate = candles[index];
    if (candleCloseTime(candidate) >= horizonTarget) {
      exitCandle = candidate;
      break;
    }
  }
  if (exitCandle === null) return insufficientRecord(identity, entry);

  const exitClose = parsePrice(exitCandle.close, 'candle.close');
  if (exitClose === null) return insufficientRecord(identity, entry);

  const exitPriceExact = exitClose.times(ONE.minus(slippage));
  const exitPriceUsd = exitPriceExact.toFixed(8);
  if (!exitPriceExact.greaterThan(0) || exitPriceUsd === ZERO_PRICE) {
    return insufficientRecord(identity, entry);
  }

  // Buy side: $100 notional plus its fee is the all-in cost.
  const buyFeeStr = NOTIONAL_USD.times(feeBps).div(BPS).toFixed(2);
  const cost = NOTIONAL_USD.plus(new Decimal(buyFeeStr));
  // Size and sale use the exact prices, never the rounded display strings: at a
  // 1e-6 entry price, an 8-decimal price is only 2 significant digits, so using
  // it would wipe out the slippage and price move the counterfactual measures.
  const amount = NOTIONAL_USD.div(entryPriceExact);
  // Round the sale once, then charge the fee on the booked sale and derive
  // proceeds from it, mirroring the paper fill model so cents never disagree.
  const saleNotionalStr = amount.times(exitPriceExact).toFixed(2);
  const saleNotional = new Decimal(saleNotionalStr);
  const sellFeeStr = saleNotional.times(feeBps).div(BPS).toFixed(2);
  const proceeds = saleNotional.minus(new Decimal(sellFeeStr));

  const returnPct = proceeds
    .minus(cost)
    .div(cost)
    .times(HUNDRED)
    .toDecimalPlaces(2, Decimal.ROUND_HALF_UP);

  return {
    tokenId: identity.tokenId,
    decisionTime: identity.decisionTime,
    reasonCode: identity.reasonCode,
    entryAt: entry.at,
    entryPriceUsd: entry.priceUsd,
    exitAt: candleCloseTime(exitCandle),
    exitPriceUsd,
    returnPct: returnPct.isZero() ? ZERO_PCT : returnPct.toFixed(2),
    outcome: classify(returnPct),
    hindsight: true,
    usedForDecisions: false,
  };
}

/**
 * Builds hindsight records for every rejected buy, in deterministic order.
 *
 * Pure and side-effect free: it reads no clock, no random source and no state
 * outside its input. The returned array is sorted by decision time, then token
 * id, then reason code, so two runs over the same data are byte-identical.
 */
export function analyzeRejectedBuys(input: CounterfactualInput): readonly CounterfactualRecord[] {
  assertBps(input.feeBps, 'feeBps');
  assertBps(input.slippageBps, 'slippageBps');
  assertHorizon(input.horizonHours);

  const candlesByToken = indexCandles(input.candles);
  const rejections = prepareRejections(input.rejected);
  return rejections.map((rejection) =>
    analyzeOne(
      {
        tokenId: rejection.tokenId,
        decisionTime: rejection.decisionTime,
        reasonCode: rejection.reasonCode,
      },
      candlesByToken.get(rejection.tokenId) ?? [],
      input.horizonHours,
      input.feeBps,
      input.slippageBps,
    ),
  );
}

import Decimal from 'decimal.js';
import { DecimalInputError, money, percent, toDecimal } from '../decision/decimal';
import type { StrategyKey } from '../decision/types';
import type {
  BuildEquityCurveInput,
  EquityPoint,
  MetricsInput,
  RunMetrics,
  StrategyMetric,
  TokenMetric,
} from './types';

/**
 * Pure metrics for one finished paper run.
 *
 * Everything here is derived from values the runner and the ledger already
 * produced: the marked equity curve, the final ledger snapshot, the final
 * `markPortfolio` projection and the closed-trade journal. The module performs
 * no I/O, reads no wall clock and never mutates its input.
 *
 * Money and percentages use `decimal.js` and are formatted once, with two
 * decimals. Counts are integers. Ratios that are undefined (no trades, no
 * losses, no bars) are `null`, never `Infinity` or `NaN`.
 */

const ZERO = new Decimal(0);
const SIGNED_DECIMAL = /^-?\d+(\.\d+)?$/;

/** Typed input error for a malformed money/percentage string. */
export class PaperMetricsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PaperMetricsError';
  }
}

/** Parses a non-negative decimal string, rethrowing as a typed metrics error. */
function parse(value: string, label: string): Decimal {
  try {
    return toDecimal(value, label);
  } catch (error) {
    if (error instanceof DecimalInputError) {
      throw new PaperMetricsError(`${label} must be a non-negative decimal string`);
    }
    throw error;
  }
}

/** Parses a signed decimal string (P&L may be negative). */
function parseSigned(value: string, label: string): Decimal {
  if (typeof value !== 'string' || !SIGNED_DECIMAL.test(value)) {
    throw new PaperMetricsError(`${label} must be a decimal string`);
  }
  return new Decimal(value);
}

/**
 * Formats a signed money or percentage value with two decimals.
 *
 * The value is rounded half-up first, so a tiny loss such as -0.004 formats as
 * `0.00` rather than `-0.00`. A rounded zero and an exact zero are the same.
 */
function formatSigned(value: Decimal): string {
  const rounded = value.toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
  return rounded.isZero() ? '0.00' : rounded.toFixed(2);
}

/** Locale-independent code-unit ordering used by every deterministic sort. */
function compareCodeUnits(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

interface DrawdownSummary {
  /** Highest equity observed: the initial capital, a curve point, or the final equity. */
  readonly peak: Decimal;
  /** Largest peak-to-trough decline in percent, never negative. */
  readonly max: Decimal;
}

/**
 * Replays the equity series in order and returns peak and max drawdown.
 *
 * The final equity is observed even when the curve is empty (or ends earlier),
 * so a run that finishes below its starting balance still reports a drawdown.
 */
function summarizeDrawdown(
  initialCapital: Decimal,
  curve: readonly EquityPoint[],
  finalEquity: Decimal,
): DrawdownSummary {
  let peak = initialCapital;
  let max = ZERO;

  const observe = (equity: Decimal): void => {
    if (equity.greaterThan(peak)) peak = equity;
    if (!peak.greaterThan(0)) return;
    const drawdown = peak.minus(equity).div(peak).times(100);
    if (drawdown.greaterThan(max)) max = drawdown;
  };

  for (let index = 0; index < curve.length; index += 1) {
    const point = curve[index];
    if (point === undefined) continue;
    observe(parse(point.equityUsd, `equityCurve[${index}].equityUsd`));
  }
  observe(finalEquity);

  return { peak, max };
}

interface TradeBucket {
  count: number;
  wins: number;
  losses: number;
  realized: Decimal;
}

function emptyBucket(): TradeBucket {
  return { count: 0, wins: 0, losses: 0, realized: ZERO };
}

function bucketFor<TKey>(map: Map<TKey, TradeBucket>, key: TKey): TradeBucket {
  const existing = map.get(key);
  if (existing !== undefined) return existing;
  const created = emptyBucket();
  map.set(key, created);
  return created;
}

function accumulate(bucket: TradeBucket, realizedPnl: Decimal): void {
  bucket.count += 1;
  bucket.realized = bucket.realized.plus(realizedPnl);
  if (realizedPnl.greaterThan(0)) bucket.wins += 1;
  // `lessThan(0)` rather than `isNegative()`: `-0.00` is signed but is not a loss.
  else if (realizedPnl.lessThan(0)) bucket.losses += 1;
}

function bucketWinRate(bucket: TradeBucket): string | null {
  if (bucket.count === 0) return null;
  return percent(new Decimal(bucket.wins).div(bucket.count).times(100));
}

function toStrategyMetrics(buckets: ReadonlyMap<StrategyKey, TradeBucket>): StrategyMetric[] {
  return [...buckets.entries()]
    .sort(([left], [right]) => compareCodeUnits(left, right))
    .map(([strategyKey, bucket]) => ({
      strategyKey,
      tradeCount: bucket.count,
      wins: bucket.wins,
      losses: bucket.losses,
      realizedPnlUsd: formatSigned(bucket.realized),
      winRatePct: bucketWinRate(bucket),
    }));
}

function toTokenMetrics(buckets: ReadonlyMap<string, TradeBucket>): TokenMetric[] {
  return [...buckets.entries()]
    .sort(([left], [right]) => compareCodeUnits(left, right))
    .map(([tokenId, bucket]) => ({
      tokenId,
      tradeCount: bucket.count,
      wins: bucket.wins,
      losses: bucket.losses,
      realizedPnlUsd: formatSigned(bucket.realized),
      winRatePct: bucketWinRate(bucket),
    }));
}

/**
 * Builds an `EquityPoint` curve from raw marks.
 *
 * The initial capital seeds the peak, so a first bar that is already below the
 * starting balance reports a positive drawdown. Drawdown is
 * `(peak - equity) / peak * 100`, clamped at zero; a run with no points returns
 * an empty curve. Money is normalised to two decimals. The initial capital must
 * be positive, matching `computeMetrics`.
 */
export function buildEquityCurve(input: BuildEquityCurveInput): EquityPoint[] {
  const initialCapital = parse(input.initialCapitalUsd, 'initialCapitalUsd');
  if (!initialCapital.greaterThan(0)) {
    throw new PaperMetricsError('initialCapitalUsd must be positive');
  }
  let peak = initialCapital;
  const curve: EquityPoint[] = [];

  for (let index = 0; index < input.points.length; index += 1) {
    const point = input.points[index];
    if (point === undefined) continue;
    const equity = parse(point.equityUsd, `points[${index}].equityUsd`);
    const cash = parse(point.cashUsd, `points[${index}].cashUsd`);
    const positionsValue = parse(point.positionsValueUsd, `points[${index}].positionsValueUsd`);

    if (equity.greaterThan(peak)) peak = equity;
    const drawdown = peak.greaterThan(0) ? peak.minus(equity).div(peak).times(100) : ZERO;

    curve.push({
      clockTime: point.clockTime,
      equityUsd: money(equity),
      cashUsd: money(cash),
      positionsValueUsd: money(positionsValue),
      drawdownPct: percent(drawdown.isNegative() ? ZERO : drawdown),
    });
  }

  return curve;
}

/**
 * Computes summary metrics for one finished paper run.
 *
 * `initialCapitalUsd` and `finalEquityUsd` drive total return; the equity curve
 * (plus the initial capital and final equity) drives peak and max drawdown;
 * cash, realized P&L and fees come from the ledger; unrealized P&L and the final
 * positions value come from the caller's final `markPortfolio`. Closed trades
 * provide win/loss counts, profit factor, averages and the per-strategy and
 * per-token breakdown. Open positions never appear in trade counts, but they do
 * appear in the final positions value and unrealized P&L.
 */
export function computeMetrics(input: MetricsInput): RunMetrics {
  const initial = parse(input.initialCapitalUsd, 'initialCapitalUsd');
  if (!initial.greaterThan(0)) {
    throw new PaperMetricsError('initialCapitalUsd must be positive');
  }
  const finalEquity = parse(input.finalEquityUsd, 'finalEquityUsd');
  const finalPositions = parse(input.finalPositionsValueUsd, 'finalPositionsValueUsd');
  const unrealized = parseSigned(input.unrealizedPnlUsd, 'unrealizedPnlUsd');

  const cash = parse(input.ledger.cashUsd, 'ledger.cashUsd');
  const realized = parseSigned(input.ledger.realizedPnlUsd, 'ledger.realizedPnlUsd');
  const fees = parse(input.ledger.feesPaidUsd, 'ledger.feesPaidUsd');

  const totalReturn = finalEquity.div(initial).minus(1).times(100);
  const drawdown = summarizeDrawdown(initial, input.equityCurve, finalEquity);

  let tradeCount = 0;
  let wins = 0;
  let losses = 0;
  let grossProfit = ZERO;
  let grossLoss = ZERO;
  const strategyBuckets = new Map<StrategyKey, TradeBucket>();
  const tokenBuckets = new Map<string, TradeBucket>();

  for (let index = 0; index < input.closedTrades.length; index += 1) {
    const trade = input.closedTrades[index];
    if (trade === undefined) continue;
    const realizedPnl = parseSigned(trade.realizedPnlUsd, `closedTrades[${index}].realizedPnlUsd`);
    tradeCount += 1;
    if (realizedPnl.greaterThan(0)) {
      wins += 1;
      grossProfit = grossProfit.plus(realizedPnl);
    } else if (realizedPnl.lessThan(0)) {
      losses += 1;
      grossLoss = grossLoss.plus(realizedPnl.abs());
    }
    accumulate(bucketFor(strategyBuckets, trade.strategyKey), realizedPnl);
    accumulate(bucketFor(tokenBuckets, trade.tokenId), realizedPnl);
  }

  let bars = 0;
  let barsInMarket = 0;
  let exposureSum = ZERO;
  let exposureBars = 0;
  for (let index = 0; index < input.equityCurve.length; index += 1) {
    const point = input.equityCurve[index];
    if (point === undefined) continue;
    const equity = parse(point.equityUsd, `equityCurve[${index}].equityUsd`);
    const positionsValue = parse(
      point.positionsValueUsd,
      `equityCurve[${index}].positionsValueUsd`,
    );
    bars += 1;
    if (positionsValue.greaterThan(0)) barsInMarket += 1;
    if (equity.greaterThan(0)) {
      exposureSum = exposureSum.plus(positionsValue.div(equity).times(100));
      exposureBars += 1;
    }
  }

  const winRatePct =
    tradeCount === 0 ? null : percent(new Decimal(wins).div(tradeCount).times(100));
  const profitFactor = grossLoss.greaterThan(0) ? percent(grossProfit.div(grossLoss)) : null;
  const averageWinUsd = wins > 0 ? formatSigned(grossProfit.div(wins)) : null;
  const averageLossUsd = losses > 0 ? formatSigned(grossLoss.div(losses).negated()) : null;
  const timeInMarketPct =
    bars === 0 ? '0.00' : percent(new Decimal(barsInMarket).div(bars).times(100));
  const averageExposurePct = exposureBars === 0 ? '0.00' : percent(exposureSum.div(exposureBars));

  return {
    initialCapitalUsd: money(initial),
    finalEquityUsd: money(finalEquity),
    totalReturnPct: formatSigned(totalReturn),
    maxDrawdownPct: percent(drawdown.max),
    peakEquityUsd: money(drawdown.peak),
    finalCashUsd: money(cash),
    finalPositionsValueUsd: money(finalPositions),
    realizedPnlUsd: formatSigned(realized),
    unrealizedPnlUsd: formatSigned(unrealized),
    feesPaidUsd: money(fees),
    tradeCount,
    wins,
    losses,
    winRatePct,
    profitFactor,
    averageWinUsd,
    averageLossUsd,
    timeInMarketPct,
    averageExposurePct,
    perStrategy: toStrategyMetrics(strategyBuckets),
    perToken: toTokenMetrics(tokenBuckets),
  };
}

import type {
  BotBacktestEquityPoint,
  BotBacktestStats,
  BotBacktestTrade,
  BotCandle,
} from '@nexter/contracts';
import { Decimal, amountString, decimal, usdString } from '../../../shared/money/decimal';
import type { StrategyDefinition, StrategySample } from '../strategies/types';

function candleTimestamp(date: string, time: string): Date {
  if (date.includes('T')) {
    const parsed = new Date(date);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  return new Date(`${date}T${time}Z`);
}

const DEFAULT_CAPITAL = '1000';
const DEFAULT_FEE_BPS = 25;
const DEFAULT_SLIPPAGE_BPS = 10;

export interface BacktestOptions {
  initialCapitalUsd?: string;
  feeBps?: number;
  slippageBps?: number;
  useStopLoss?: boolean;
  useTakeProfit?: boolean;
  reinvestProfit?: boolean;
  /** Number of candles used for the "24h" change; defaults to the previous candle. */
  changeLookbackCandles?: number;
  /**
   * Execution model for strategy decisions. `same-close` fills at the signal
   * candle close (legacy); `next-open` fills at the next candle open.
   */
  execution?: 'same-close' | 'next-open';
  /** Candles used only to warm up indicators; scoring starts after them. */
  warmupCandles?: number;
  /**
   * Absolute candle ranges where new entries are disabled. Open positions may
   * still exit; each range end force-closes the position.
   */
  settlementRanges?: Array<{ start: number; end: number }>;
}

export interface BacktestResult {
  stats: BotBacktestStats;
  trades: BotBacktestTrade[];
  equityCurve: BotBacktestEquityPoint[];
  exposure: Array<{ date: string; inPosition: boolean }>;
}

interface OpenPosition {
  amount: Decimal;
  costBasisUsd: Decimal;
}

export function runBacktest(
  definition: StrategyDefinition,
  params: Record<string, unknown>,
  candles: BotCandle[],
  options: BacktestOptions = {},
): BacktestResult {
  if (candles.length < 2) {
    throw new Error('At least two candles are required for a backtest');
  }

  const initialCapital = decimal(options.initialCapitalUsd ?? DEFAULT_CAPITAL);
  const feeRate = decimal(String(options.feeBps ?? DEFAULT_FEE_BPS)).div(10_000);
  const slippageRate = decimal(String(options.slippageBps ?? DEFAULT_SLIPPAGE_BPS)).div(10_000);
  const execution = options.execution ?? 'same-close';
  const maxAddsRaw = Number(params.maxAdds);
  const maxAdds = Number.isFinite(maxAddsRaw) && maxAddsRaw >= 1 ? Math.floor(maxAddsRaw) : 1;

  let cash = initialCapital;
  let position: OpenPosition | null = null;
  let buyCount = 0;
  let peakEquity = initialCapital;
  let maxDrawdownPct = new Decimal(0);
  let grossProfit = new Decimal(0);
  let grossLoss = new Decimal(0);
  let wins = 0;
  let losses = 0;

  const trades: BotBacktestTrade[] = [];
  const equityCurve: BotBacktestEquityPoint[] = [];
  const exposure: Array<{ date: string; inPosition: boolean }> = [];
  const samples: StrategySample[] = [];
  let strategyState: Record<string, unknown> = {};
  let pendingOrder: { action: 'buy' | 'sell'; reason: string } | null = null;

  const equityAt = (price: Decimal) => (position ? cash.plus(position.amount.mul(price)) : cash);

  const pushEquity = (date: string, price: Decimal) => {
    const equity = equityAt(price);
    peakEquity = Decimal.max(peakEquity, equity);
    const drawdown = peakEquity.gt(0)
      ? peakEquity.minus(equity).div(peakEquity).mul(100)
      : new Decimal(0);
    maxDrawdownPct = Decimal.max(maxDrawdownPct, drawdown);
    equityCurve.push({ date, equityUsd: usdString(equity) });
    exposure.push({ date, inPosition: position !== null });
  };

  const executeBuy = (date: string, close: Decimal, reason: string) => {
    const spendable = cash.div(new Decimal(1).plus(feeRate));
    const allocationBase = options.reinvestProfit ? equityAt(close) : initialCapital;
    const usd = Decimal.min(allocationBase.div(maxAdds), spendable);
    if (usd.lt(1)) return false;

    const fillPrice = close.mul(new Decimal(1).plus(slippageRate));
    const fee = usd.mul(feeRate);
    const debit = usd.plus(fee);
    if (debit.gt(cash)) return false;

    const amount = usd.div(fillPrice);
    const slippage = usd.minus(amount.mul(close));
    position = position
      ? {
          amount: position.amount.plus(amount),
          costBasisUsd: position.costBasisUsd.plus(debit),
        }
      : { amount, costBasisUsd: debit };
    cash = cash.minus(debit);
    buyCount += 1;

    trades.push({
      index: trades.length,
      side: 'buy',
      date,
      priceUsd: fillPrice.toFixed(18),
      amount: amountString(amount),
      usdValue: usdString(usd),
      feeUsd: usdString(fee),
      slippageUsd: usdString(slippage),
      realizedPnlUsd: '0.00000000',
      reason,
      equityUsd: usdString(equityAt(close)),
    });
    return true;
  };

  const executeSell = (date: string, close: Decimal, reason: string) => {
    if (!position) return false;
    const amount = position.amount;
    const costBasis = position.costBasisUsd;
    const fillPrice = close.mul(new Decimal(1).minus(slippageRate));
    const gross = amount.mul(fillPrice);
    const slippage = amount.mul(close).minus(gross);
    const fee = gross.mul(feeRate);
    const net = gross.minus(fee);
    const realized = net.minus(costBasis);
    cash = cash.plus(net);
    position = null;
    buyCount = 0;

    if (realized.gt(0)) {
      grossProfit = grossProfit.plus(realized);
      wins += 1;
    } else if (realized.lt(0)) {
      grossLoss = grossLoss.plus(realized.abs());
      losses += 1;
    }

    trades.push({
      index: trades.length,
      side: 'sell',
      date,
      priceUsd: fillPrice.toFixed(18),
      amount: amountString(amount),
      usdValue: usdString(gross),
      feeUsd: usdString(fee),
      slippageUsd: usdString(slippage),
      realizedPnlUsd: usdString(realized),
      reason,
      equityUsd: usdString(equityAt(close)),
    });
    return true;
  };

  const settlementRanges = options.settlementRanges ?? [];
  const inSettlement = (index: number) =>
    settlementRanges.some((range) => index >= range.start && index < range.end);
  const isSettlementEnd = (index: number) =>
    settlementRanges.some((range) => index === range.end - 1);

  const warmup = Math.min(candles.length - 1, Math.max(0, Math.floor(options.warmupCandles ?? 0)));
  for (let index = 0; index < warmup; index += 1) {
    const candle = candles[index] as BotCandle;
    const close = decimal(candle.closeUsd);
    const changeLookback = Math.max(1, Math.floor(options.changeLookbackCandles ?? 1));
    const previousIndex = index - changeLookback;
    const previous = previousIndex >= 0 ? candles[previousIndex] : null;
    const previousClose = previous ? decimal(previous.closeUsd) : null;
    const change24hPct = previousClose
      ? close.minus(previousClose).div(previousClose).mul(100).toFixed(4)
      : null;

    samples.push({
      priceUsd: candle.closeUsd,
      capturedAt: candleTimestamp(candle.date, '12:00:00.000'),
    });

    if (definition.stateful === true) {
      const decision = definition.evaluate({
        now: candleTimestamp(candle.date, '23:59:59.999'),
        params,
        priceUsd: candle.closeUsd,
        change24hPct,
        history: samples,
        position: null,
        buyCount: 0,
        stopLossEnabled: options.useStopLoss !== false,
        takeProfitEnabled: options.useTakeProfit !== false,
        state: strategyState,
      });
      strategyState = decision.nextState ?? strategyState;
    }
  }

  for (let index = warmup; index < candles.length; index += 1) {
    const candle = candles[index] as BotCandle;
    const close = decimal(candle.closeUsd);
    const changeLookback = Math.max(1, Math.floor(options.changeLookbackCandles ?? 1));
    const previousIndex = index - changeLookback;
    const previous = previousIndex >= 0 ? candles[previousIndex] : null;
    const previousClose = previous ? decimal(previous.closeUsd) : null;
    const change24hPct = previousClose
      ? close.minus(previousClose).div(previousClose).mul(100).toFixed(4)
      : null;

    samples.push({
      priceUsd: candle.closeUsd,
      capturedAt: candleTimestamp(candle.date, '12:00:00.000'),
    });

    if (execution === 'next-open' && pendingOrder) {
      const order = pendingOrder;
      pendingOrder = null;
      const openPrice = decimal(candle.openUsd);
      if (order.action === 'buy') {
        if (!position || buyCount < maxAdds) {
          executeBuy(candle.date, openPrice, `${order.reason} (следующая свеча)`);
        }
      } else if (position) {
        executeSell(candle.date, openPrice, `${order.reason} (следующая свеча)`);
      }
    }

    const openPosition = position as OpenPosition | null;
    const synthetic = candle.synthetic === true;
    let protectiveExit = false;

    if (openPosition) {
      const avgCost = openPosition.costBasisUsd.div(openPosition.amount);
      const open = decimal(candle.openUsd);
      const high = decimal(candle.highUsd);
      const low = decimal(candle.lowUsd);
      const stopLossPct = positiveNumber(params.stopLossPct);
      const takeProfitPct = positiveNumber(params.takeProfitPct);

      let exitPrice: Decimal | null = null;
      let exitReason = '';

      if (stopLossPct !== null && options.useStopLoss !== false) {
        const stopPrice = avgCost.mul(new Decimal(1).minus(stopLossPct / 100));
        if (synthetic) {
          // A sampled daily point cannot prove an intrabar low. Use the close
          // (the only end-of-day observation) and keep the stop conservative.
          if (close.lte(stopPrice)) {
            exitPrice = close;
            exitReason = 'стоп-лосс (по закрытию, синтетическая свеча)';
          }
        } else if (open.lte(stopPrice)) {
          exitPrice = open;
          exitReason = 'стоп-лосс (гэп)';
        } else if (low.lte(stopPrice)) {
          exitPrice = stopPrice;
          exitReason = 'стоп-лосс (внутри дня)';
        }
      }

      if (exitPrice === null && takeProfitPct !== null && options.useTakeProfit !== false) {
        const takeProfitPrice = avgCost.mul(new Decimal(1).plus(takeProfitPct / 100));
        if (synthetic) {
          // Do not book the sampled high/open as a fill. A limit take-profit
          // can only be assumed to fill at its threshold when OHLC is unknown.
          if (close.gte(takeProfitPrice)) {
            exitPrice = takeProfitPrice;
            exitReason = 'тейк-профит (по порогу, синтетическая свеча)';
          }
        } else if (open.gte(takeProfitPrice)) {
          exitPrice = open;
          exitReason = 'тейк-профит (гэп)';
        } else if (high.gte(takeProfitPrice)) {
          exitPrice = takeProfitPrice;
          exitReason = 'тейк-профит (внутри дня)';
        }
      }

      if (exitPrice !== null) {
        executeSell(candle.date, exitPrice, exitReason);
        protectiveExit = true;
      }
    }

    const postExitPosition = position as OpenPosition | null;
    const decision = definition.evaluate({
      now: candleTimestamp(candle.date, '23:59:59.999'),
      params,
      priceUsd: candle.closeUsd,
      change24hPct,
      history: samples,
      position: postExitPosition
        ? {
            amount: amountString(postExitPosition.amount),
            avgCostUsd: usdString(postExitPosition.costBasisUsd.div(postExitPosition.amount)),
            costBasisUsd: usdString(postExitPosition.costBasisUsd),
          }
        : null,
      buyCount,
      stopLossEnabled: options.useStopLoss !== false,
      takeProfitEnabled: options.useTakeProfit !== false,
      state: strategyState,
    });
    strategyState = decision.nextState ?? strategyState;

    if (execution === 'next-open') {
      const buyBlockedBySettlement = decision.action === 'buy' && inSettlement(index + 1);
      if (
        !protectiveExit &&
        !buyBlockedBySettlement &&
        index < candles.length - 1 &&
        decision.action !== 'hold'
      ) {
        pendingOrder = { action: decision.action, reason: decision.reason };
      }
    } else if (!protectiveExit) {
      if (decision.action === 'buy' && !inSettlement(index) && (!position || buyCount < maxAdds)) {
        executeBuy(candle.date, close, decision.reason);
      } else if (decision.action === 'sell' && position) {
        executeSell(candle.date, close, decision.reason);
      }
    }

    pushEquity(candle.date, close);
    if (isSettlementEnd(index) && position) {
      executeSell(candle.date, close, 'закрытие settlement');
      const lastEquityPoint = equityCurve[equityCurve.length - 1];
      if (lastEquityPoint) lastEquityPoint.equityUsd = usdString(cash);
      const lastExposurePoint = exposure[exposure.length - 1];
      if (lastExposurePoint) lastExposurePoint.inPosition = false;
    }
  }

  const last = candles[candles.length - 1] as BotCandle;
  if (position) {
    executeSell(last.date, decimal(last.closeUsd), 'закрытие в конце периода');
    const lastPoint = equityCurve[equityCurve.length - 1];
    if (lastPoint) lastPoint.equityUsd = usdString(cash);
    const lastExposurePoint = exposure[exposure.length - 1];
    if (lastExposurePoint) lastExposurePoint.inPosition = false;
  }

  peakEquity = new Decimal(0);
  maxDrawdownPct = new Decimal(0);
  for (const point of equityCurve) {
    const equity = decimal(point.equityUsd);
    peakEquity = Decimal.max(peakEquity, equity);
    const drawdown = peakEquity.gt(0)
      ? peakEquity.minus(equity).div(peakEquity).mul(100)
      : new Decimal(0);
    maxDrawdownPct = Decimal.max(maxDrawdownPct, drawdown);
  }

  const finalEquity = cash;
  const totalPnl = finalEquity.minus(initialCapital);
  const firstClose = decimal((candles[warmup] as BotCandle).closeUsd);
  const lastClose = decimal(last.closeUsd);
  const buyHoldReturnPct = lastClose.minus(firstClose).div(firstClose).mul(100);
  const tradeCount = trades.length;
  const decided = wins + losses;

  return {
    exposure,
    stats: {
      initialCapitalUsd: usdString(initialCapital),
      finalEquityUsd: usdString(finalEquity),
      totalPnlUsd: usdString(totalPnl),
      totalReturnPct: totalPnl.div(initialCapital).mul(100).toFixed(2),
      grossProfitUsd: usdString(grossProfit),
      grossLossUsd: usdString(grossLoss),
      profitFactor: grossLoss.gt(0) ? grossProfit.div(grossLoss).toFixed(2) : null,
      winRate: decided > 0 ? ((wins / decided) * 100).toFixed(2) : null,
      tradesCount: tradeCount,
      wins,
      losses,
      maxDrawdownPct: maxDrawdownPct.toFixed(2),
      buyHoldReturnPct: buyHoldReturnPct.toFixed(2),
    },
    trades,
    equityCurve,
  };
}

function positiveNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

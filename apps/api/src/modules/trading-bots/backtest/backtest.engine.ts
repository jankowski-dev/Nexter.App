import type {
  BotBacktestEquityPoint,
  BotBacktestStats,
  BotBacktestTrade,
  BotCandle,
} from '@nexter/contracts';
import { Decimal, amountString, decimal, usdString } from '../../../shared/money/decimal';
import type { StrategyDefinition, StrategySample } from '../strategies/types';

const DEFAULT_CAPITAL = '1000';
const DEFAULT_FEE_BPS = 25;
const DEFAULT_SLIPPAGE_BPS = 10;

export interface BacktestOptions {
  initialCapitalUsd?: string;
  feeBps?: number;
  slippageBps?: number;
}

export interface BacktestResult {
  stats: BotBacktestStats;
  trades: BotBacktestTrade[];
  equityCurve: BotBacktestEquityPoint[];
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
  const maxAddsRaw = Number(params.maxAdds);
  const maxAdds = Number.isFinite(maxAddsRaw) && maxAddsRaw >= 1 ? Math.floor(maxAddsRaw) : 1;
  const allocationPerBuy = initialCapital.div(maxAdds);

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
  const samples: StrategySample[] = [];

  const equityAt = (price: Decimal) => (position ? cash.plus(position.amount.mul(price)) : cash);

  const pushEquity = (date: string, price: Decimal) => {
    const equity = equityAt(price);
    peakEquity = Decimal.max(peakEquity, equity);
    const drawdown = peakEquity.gt(0)
      ? peakEquity.minus(equity).div(peakEquity).mul(100)
      : new Decimal(0);
    maxDrawdownPct = Decimal.max(maxDrawdownPct, drawdown);
    equityCurve.push({ date, equityUsd: usdString(equity) });
  };

  const executeBuy = (date: string, close: Decimal, reason: string) => {
    const usd = Decimal.min(allocationPerBuy, cash);
    if (usd.lt(1)) return false;

    const fillPrice = close.mul(new Decimal(1).plus(slippageRate));
    const fee = usd.mul(feeRate);
    const debit = usd.plus(fee);
    if (debit.gt(cash)) return false;

    const amount = usd.div(fillPrice);
    const slippage = amount.mul(close).minus(usd);
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

  for (let index = 0; index < candles.length; index += 1) {
    const candle = candles[index] as BotCandle;
    const close = decimal(candle.closeUsd);
    const previous = index > 0 ? candles[index - 1] : null;
    const previousClose = previous ? decimal(previous.closeUsd) : null;
    const change24hPct = previousClose
      ? close.minus(previousClose).div(previousClose).mul(100).toFixed(4)
      : null;

    samples.push({
      priceUsd: candle.closeUsd,
      capturedAt: new Date(`${candle.date}T12:00:00.000Z`),
    });

    const openPosition = position as OpenPosition | null;
    const decision = definition.evaluate({
      now: new Date(`${candle.date}T23:59:59.999Z`),
      params,
      priceUsd: candle.closeUsd,
      change24hPct,
      history: samples,
      position: openPosition
        ? {
            amount: amountString(openPosition.amount),
            avgCostUsd: usdString(openPosition.costBasisUsd.div(openPosition.amount)),
            costBasisUsd: usdString(openPosition.costBasisUsd),
          }
        : null,
      buyCount,
    });

    if (decision.action === 'buy' && (!position || buyCount < maxAdds)) {
      executeBuy(candle.date, close, decision.reason);
    } else if (decision.action === 'sell' && position) {
      executeSell(candle.date, close, decision.reason);
    }

    pushEquity(candle.date, close);
  }

  const last = candles[candles.length - 1] as BotCandle;
  if (position) {
    executeSell(last.date, decimal(last.closeUsd), 'закрытие в конце периода');
    const lastPoint = equityCurve[equityCurve.length - 1];
    if (lastPoint) lastPoint.equityUsd = usdString(cash);
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
  const firstClose = decimal((candles[0] as BotCandle).closeUsd);
  const lastClose = decimal(last.closeUsd);
  const buyHoldReturnPct = lastClose.minus(firstClose).div(firstClose).mul(100);
  const tradeCount = trades.length;
  const decided = wins + losses;

  return {
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

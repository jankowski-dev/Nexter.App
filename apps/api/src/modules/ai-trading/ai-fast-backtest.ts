import type { BotCandle } from '@nexter/contracts';
import { Decimal } from '../../shared/money/decimal';

/**
 * Native-number backtest used only by the mass AI search. Indicators and entry
 * decisions are native for speed; cash, position and fills stay in Decimal so
 * affordability and trade accounting match the reference engine exactly.
 * Boundary decisions are flagged and re-run on the full Decimal engine.
 */

export interface FastPosition {
  avgCostUsd: number;
}

export interface FastDecision {
  action: 'buy' | 'sell' | 'hold';
  reason: string;
}

export interface FastStrategyRuntime {
  stateful: boolean;
  maxAdds: number;
  stopLossPct: number | null;
  takeProfitPct: number | null;
  isAmbiguous: () => boolean;
  debugState?: () => unknown;
  warmup(index: number, priceUsd: number): void;
  evaluate(
    index: number,
    priceUsd: number,
    change24hPct: number | null,
    position: FastPosition | null,
    buyCount: number,
    useStopLoss: boolean,
    useTakeProfit: boolean,
  ): FastDecision;
}

export interface FastBacktestOptions {
  initialCapitalUsd?: number;
  feeBps?: number;
  slippageBps?: number;
  warmupCandles?: number;
  changeLookbackCandles?: number;
  useStopLoss?: boolean;
  useTakeProfit?: boolean;
  execution?: 'same-close' | 'next-open';
  collectTrades?: boolean;
  collectEquity?: boolean;
  onCandle?: (info: {
    index: number;
    price: number;
    cash: number;
    amount: number;
    buyCount: number;
    decision: FastDecision;
    protectiveExit: boolean;
    state?: unknown;
  }) => void;
}

export interface FastTrade {
  index: number;
  side: 'buy' | 'sell';
  priceUsd: number;
  reason: string;
}

export interface FastBacktestStats {
  totalReturnPct: string;
  maxDrawdownPct: string;
  tradesCount: number;
  ambiguous?: boolean;
  trades?: FastTrade[];
  equityCurve?: Array<{ index: number; equity: number }>;
}

const DEFAULT_CAPITAL = 1000;
const DEFAULT_FEE_BPS = 25;
const DEFAULT_SLIPPAGE_BPS = 10;

function positive(value: number | null): number | null {
  return value !== null && Number.isFinite(value) && value > 0 ? value : null;
}

export function runFastBacktest(
  runtime: FastStrategyRuntime,
  candles: BotCandle[],
  options: FastBacktestOptions = {},
): FastBacktestStats {
  if (candles.length < 2) {
    throw new Error('At least two candles are required for a backtest');
  }

  const length = candles.length;
  const open = new Array<number>(length);
  const high = new Array<number>(length);
  const low = new Array<number>(length);
  const close = new Array<number>(length);
  const synthetic = new Array<boolean>(length);
  for (let index = 0; index < length; index += 1) {
    const candle = candles[index] as BotCandle;
    open[index] = Number(candle.openUsd);
    high[index] = Number(candle.highUsd);
    low[index] = Number(candle.lowUsd);
    close[index] = Number(candle.closeUsd);
    synthetic[index] = candle.synthetic === true;
  }

  const initial = options.initialCapitalUsd ?? DEFAULT_CAPITAL;
  const initialCapital = new Decimal(initial);
  const feeRate = new Decimal(options.feeBps ?? DEFAULT_FEE_BPS).div(10_000);
  const slippageRate = new Decimal(options.slippageBps ?? DEFAULT_SLIPPAGE_BPS).div(10_000);
  const one = new Decimal(1);
  const changeLookback = Math.max(1, Math.floor(options.changeLookbackCandles ?? 1));
  const useStopLoss = options.useStopLoss !== false;
  const useTakeProfit = options.useTakeProfit !== false;
  const execution = options.execution ?? 'same-close';
  const maxAdds = Math.max(1, Math.floor(runtime.maxAdds));
  const stopLossPct = useStopLoss ? positive(runtime.stopLossPct) : null;
  const takeProfitPct = useTakeProfit ? positive(runtime.takeProfitPct) : null;

  const change24h = new Array<number | null>(length).fill(null);
  for (let index = 0; index < length; index += 1) {
    const previousIndex = index - changeLookback;
    if (previousIndex < 0) continue;
    const previous = close[previousIndex] as number;
    if (previous <= 0) continue;
    change24h[index] = Number(
      ((((close[index] as number) - previous) / previous) * 100).toFixed(4),
    );
  }

  const warmup = Math.min(length - 1, Math.max(0, Math.floor(options.warmupCandles ?? 0)));
  for (let index = 0; index < warmup; index += 1) {
    if (runtime.stateful) {
      runtime.warmup(index, close[index] as number);
    }
  }

  let cash = initialCapital;
  let amount = new Decimal(0);
  let costBasis = new Decimal(0);
  let buyCount = 0;
  // The reference engine recomputes drawdown from the equity curve starting at
  // zero, so the initial capital is not a peak by itself.
  let peakEquity = 0;
  let maxDrawdownPct = 0;
  let tradesCount = 0;
  let ambiguous = false;
  let pending: FastDecision | null = null;
  const trades: FastTrade[] = [];
  const equityCurve: Array<{ index: number; equity: number }> = [];
  const near = (left: number, right: number) => {
    if (ambiguous) return;
    const scale = Math.max(1, Math.abs(left), Math.abs(right));
    if (Math.abs(left - right) <= 1e-11 * scale) ambiguous = true;
  };

  const equityAt = (price: number): number => Number(cash) + Number(amount) * price;

  const pushEquity = (equity: number, index: number) => {
    if (equity > peakEquity) peakEquity = equity;
    if (peakEquity > 0) {
      const drawdown = ((peakEquity - equity) / peakEquity) * 100;
      if (drawdown > maxDrawdownPct) maxDrawdownPct = drawdown;
    }
    if (options.collectEquity === true) {
      equityCurve.push({ index, equity });
    }
  };

  const executeBuy = (closePrice: Decimal, index: number, reason: string) => {
    const spendable = cash.div(feeRate.plus(one));
    const allocation = initialCapital.div(maxAdds);
    const usd = Decimal.min(allocation, spendable);
    if (usd.lt(1)) return false;
    const fillPrice = closePrice.mul(slippageRate.plus(one));
    const fee = usd.mul(feeRate);
    const debit = usd.plus(fee);
    if (debit.gt(cash)) {
      return false;
    }
    amount = amount.plus(usd.div(fillPrice));
    costBasis = costBasis.plus(debit);
    cash = cash.minus(debit);
    buyCount += 1;
    tradesCount += 1;
    if (options.collectTrades === true) {
      trades.push({ index, side: 'buy', priceUsd: Number(fillPrice.toString()), reason });
    }
    return true;
  };

  const executeSell = (price: Decimal, index: number, reason: string) => {
    if (amount.lte(0)) return false;
    const fillPrice = price.mul(one.minus(slippageRate));
    const gross = amount.mul(fillPrice);
    const fee = gross.mul(feeRate);
    cash = cash.plus(gross.minus(fee));
    amount = new Decimal(0);
    costBasis = new Decimal(0);
    buyCount = 0;
    tradesCount += 1;
    if (options.collectTrades === true) {
      trades.push({ index, side: 'sell', priceUsd: Number(fillPrice.toString()), reason });
    }
    return true;
  };

  const closeDecimal = new Array<Decimal>(length);
  const closeDecimalAt = (index: number): Decimal => {
    const cached = closeDecimal[index];
    if (cached) return cached;
    const value = new Decimal((candles[index] as BotCandle).closeUsd);
    closeDecimal[index] = value;
    return value;
  };

  for (let index = warmup; index < length; index += 1) {
    const price = close[index] as number;
    if (execution === 'next-open' && pending) {
      const order = pending;
      pending = null;
      const openPrice = new Decimal((candles[index] as BotCandle).openUsd);
      if (order.action === 'buy') {
        if (amount.lte(0) || buyCount < maxAdds) {
          executeBuy(openPrice, index, order.reason);
        }
      } else if (order.action === 'sell' && amount.gt(0)) {
        executeSell(openPrice, index, order.reason);
      }
    }
    let protectiveExit = false;

    if (amount.gt(0)) {
      const avgCost = costBasis.div(amount);
      let exitPrice: Decimal | null = null;

      if (stopLossPct !== null) {
        const stopPrice = avgCost.mul(one.minus(new Decimal(stopLossPct / 100)));
        const stopNumber = Number(stopPrice.toString());
        if (synthetic[index] === true) {
          near(price, stopNumber);
          if (price <= stopNumber) {
            exitPrice = closeDecimalAt(index);
          }
        } else {
          near(open[index] as number, stopNumber);
          near(low[index] as number, stopNumber);
          if ((open[index] as number) <= stopNumber) {
            exitPrice = new Decimal((candles[index] as BotCandle).openUsd);
          } else if ((low[index] as number) <= stopNumber) {
            exitPrice = stopPrice;
          }
        }
      }

      if (exitPrice === null && takeProfitPct !== null) {
        const takeProfitPrice = avgCost.mul(one.plus(new Decimal(takeProfitPct / 100)));
        const takeProfitNumber = Number(takeProfitPrice.toString());
        if (synthetic[index] === true) {
          near(price, takeProfitNumber);
          if (price >= takeProfitNumber) {
            exitPrice = takeProfitPrice;
          }
        } else {
          near(open[index] as number, takeProfitNumber);
          near(high[index] as number, takeProfitNumber);
          if ((open[index] as number) >= takeProfitNumber) {
            exitPrice = new Decimal((candles[index] as BotCandle).openUsd);
          } else if ((high[index] as number) >= takeProfitNumber) {
            exitPrice = takeProfitPrice;
          }
        }
      }

      if (exitPrice !== null) {
        executeSell(exitPrice, index, 'protective exit');
        protectiveExit = true;
      }
    }

    const position = amount.gt(0) ? { avgCostUsd: Number(costBasis.div(amount).toFixed(8)) } : null;
    const decision = runtime.evaluate(
      index,
      price,
      change24h[index] ?? null,
      position,
      buyCount,
      useStopLoss,
      useTakeProfit,
    );

    if (execution === 'next-open') {
      if (!protectiveExit && index < length - 1 && decision.action !== 'hold') {
        pending = decision;
      }
    } else if (!protectiveExit) {
      if (decision.action === 'buy' && (amount.lte(0) || buyCount < maxAdds)) {
        executeBuy(closeDecimalAt(index), index, decision.reason);
      } else if (decision.action === 'sell' && amount.gt(0)) {
        executeSell(closeDecimalAt(index), index, decision.reason);
      }
    }

    options.onCandle?.({
      index,
      price,
      cash: Number(cash.toString()),
      amount: Number(amount.toString()),
      buyCount,
      decision,
      protectiveExit,
      state: runtime.debugState?.(),
    });
    // The reference engine replaces the last equity point with the final cash
    // after a force-close, so the pre-sale equity must not become a peak.
    if (!(index === length - 1 && amount.gt(0))) {
      pushEquity(equityAt(price), index);
    }
  }

  if (amount.gt(0)) {
    executeSell(closeDecimalAt(length - 1), length - 1, 'final close');
    pushEquity(Number(cash.toString()), length - 1);
  }

  return {
    totalReturnPct: cash.minus(initialCapital).div(initialCapital).mul(100).toFixed(2),
    maxDrawdownPct: maxDrawdownPct.toFixed(2),
    tradesCount,
    ambiguous: ambiguous || runtime.isAmbiguous(),
    ...(options.collectTrades === true ? { trades } : {}),
    ...(options.collectEquity === true ? { equityCurve } : {}),
  };
}

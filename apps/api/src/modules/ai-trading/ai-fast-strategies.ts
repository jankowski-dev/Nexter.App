import type { BotCandle } from '@nexter/contracts';
import { strategyByKey } from '../trading-bots/strategies';
import type { SearchVariant } from './ai-search.helpers';
import {
  bollingerSeries,
  rollingHighAt,
  rollingHighBefore,
  rollingLowAt,
  rollingLowBefore,
  smaSeries,
} from './ai-search.signals';
import type { FastDecision, FastPosition, FastStrategyRuntime } from './ai-fast-backtest';
import { createComparisons } from './ai-fast-compare';

const HOLD: FastDecision = { action: 'hold', reason: 'hold' };

function num(params: Record<string, unknown>, key: string, fallback: number): number {
  const value = params[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function closes(candles: BotCandle[]): number[] {
  return candles.map((candle) => Number(candle.closeUsd));
}

type RuntimeValues = Omit<
  FastStrategyRuntime,
  'maxAdds' | 'stopLossPct' | 'takeProfitPct' | 'isAmbiguous'
> & {
  maxAdds?: number;
  stopLossPct?: number | null;
  takeProfitPct?: number | null;
};

function runtime(values: RuntimeValues & { isAmbiguous: () => boolean }): FastStrategyRuntime {
  return {
    stateful: values.stateful,
    maxAdds: values.maxAdds ?? 1,
    stopLossPct: values.stopLossPct ?? null,
    takeProfitPct: values.takeProfitPct ?? null,
    isAmbiguous: values.isAmbiguous,
    debugState: values.debugState,
    warmup: values.warmup,
    evaluate: values.evaluate,
  };
}

export function createFastRuntime(
  variant: SearchVariant,
  candles: BotCandle[],
): FastStrategyRuntime | null {
  const definition = strategyByKey.get(variant.strategyKey);
  if (!definition) return null;
  let params: Record<string, unknown>;
  try {
    params = definition.parseParams(variant.params);
  } catch {
    return null;
  }
  const price = closes(candles);
  const cmp = createComparisons();
  const build = (values: RuntimeValues) => runtime({ ...values, isAmbiguous: () => cmp.ambiguous });

  switch (variant.strategyKey) {
    case 'momentum_breakout': {
      const fast = smaSeries(price, num(params, 'fastPeriod', 5));
      const slow = smaSeries(price, num(params, 'slowPeriod', 20));
      const minChange = num(params, 'minChange24hPct', 1);
      const takeProfit = num(params, 'takeProfitPct', 5);
      const stopLoss = num(params, 'stopLossPct', 4);
      return build({
        stateful: false,
        stopLossPct: stopLoss,
        takeProfitPct: takeProfit,
        warmup: () => undefined,
        evaluate: (index, current, change24h, position, _buyCount, useStopLoss, useTakeProfit) => {
          if (position) {
            const avg = position.avgCostUsd;
            if (useTakeProfit && cmp.gte(current, avg * (1 + takeProfit / 100))) {
              return { action: 'sell', reason: 'take profit' };
            }
            if (useStopLoss && cmp.lte(current, avg * (1 - stopLoss / 100))) {
              return { action: 'sell', reason: 'stop loss' };
            }
            const fastValue = fast[index];
            const slowValue = slow[index];
            if (fastValue != null && slowValue != null && cmp.lt(fastValue, slowValue)) {
              return { action: 'sell', reason: 'fast below slow' };
            }
            return HOLD;
          }
          const fastValue = fast[index];
          const slowValue = slow[index];
          if (fastValue == null || slowValue == null) return HOLD;
          if (change24h == null || cmp.lt(change24h, minChange)) return HOLD;
          if (cmp.lte(fastValue, slowValue)) return HOLD;
          return { action: 'buy', reason: 'momentum breakout' };
        },
      });
    }
    case 'mean_reversion': {
      const mean = smaSeries(price, num(params, 'lookback', 20));
      const entryDrop = num(params, 'entryDropPct', 3);
      const exitAbove = num(params, 'exitAbovePct', 0.5);
      const takeProfit = num(params, 'takeProfitPct', 5);
      const stopLoss = num(params, 'stopLossPct', 5);
      return build({
        stateful: false,
        stopLossPct: stopLoss,
        takeProfitPct: takeProfit,
        warmup: () => undefined,
        evaluate: (index, current, _change24h, position, _buyCount, useStopLoss, useTakeProfit) => {
          const average = mean[index];
          if (average == null) return HOLD;
          if (position) {
            const avg = position.avgCostUsd;
            if (cmp.gte(current, average * (1 + exitAbove / 100))) {
              return { action: 'sell', reason: 'return to mean' };
            }
            if (useTakeProfit && cmp.gte(current, avg * (1 + takeProfit / 100))) {
              return { action: 'sell', reason: 'take profit' };
            }
            if (useStopLoss && cmp.lte(current, avg * (1 - stopLoss / 100))) {
              return { action: 'sell', reason: 'stop loss' };
            }
            return HOLD;
          }
          if (cmp.lte(current, average * (1 - entryDrop / 100))) {
            return { action: 'buy', reason: 'below mean' };
          }
          return HOLD;
        },
      });
    }
    case 'trend_pullback': {
      const fast = smaSeries(price, num(params, 'fastPeriod', 8));
      const slow = smaSeries(price, num(params, 'slowPeriod', 30));
      const pullback = num(params, 'pullbackPct', 1);
      const takeProfit = num(params, 'takeProfitPct', 5);
      const stopLoss = num(params, 'stopLossPct', 3);
      return build({
        stateful: false,
        stopLossPct: stopLoss,
        takeProfitPct: takeProfit,
        warmup: () => undefined,
        evaluate: (index, current, _change24h, position, _buyCount, useStopLoss, useTakeProfit) => {
          const fastValue = fast[index];
          const slowValue = slow[index];
          if (position) {
            const avg = position.avgCostUsd;
            if (useTakeProfit && cmp.gte(current, avg * (1 + takeProfit / 100))) {
              return { action: 'sell', reason: 'take profit' };
            }
            if (useStopLoss && cmp.lte(current, avg * (1 - stopLoss / 100))) {
              return { action: 'sell', reason: 'stop loss' };
            }
            if (fastValue != null && slowValue != null && cmp.lt(fastValue, slowValue)) {
              return { action: 'sell', reason: 'trend broken' };
            }
            return HOLD;
          }
          if (fastValue == null || slowValue == null) return HOLD;
          if (cmp.lte(fastValue, slowValue)) return HOLD;
          if (cmp.lte(current, fastValue * (1 - pullback / 100))) {
            return { action: 'buy', reason: 'pullback' };
          }
          return HOLD;
        },
      });
    }
    case 'trailing_stop': {
      const entryLookback = num(params, 'entryLookback', 20);
      const breakoutBuffer = num(params, 'breakoutBufferPct', 0.2);
      const activation = num(params, 'activationPct', 2);
      const trail = num(params, 'trailPct', 1.5);
      const hardStop = num(params, 'hardStopPct', 5);
      const priorHigh = rollingHighBefore(price, entryLookback);
      let peak = 0;
      return build({
        stateful: true,
        stopLossPct: null,
        takeProfitPct: null,
        warmup: (_index, current) => {
          peak = current;
        },
        evaluate: (index, current, _change24h, position, _buyCount, useStopLoss) => {
          if (position) {
            const avg = position.avgCostUsd;
            peak = Math.max(peak, current, avg);
            if (useStopLoss && cmp.lte(current, avg * (1 - hardStop / 100))) {
              peak = current;
              return { action: 'sell', reason: 'hard stop' };
            }
            const activationPrice = avg * (1 + activation / 100);
            if (cmp.gte(peak, activationPrice)) {
              const trailPrice = peak * (1 - trail / 100);
              if (cmp.lte(current, trailPrice)) {
                peak = current;
                return { action: 'sell', reason: 'trailing stop' };
              }
              return HOLD;
            }
            return HOLD;
          }
          const high = index >= entryLookback ? priorHigh[index] : null;
          peak = current;
          if (high == null) return HOLD;
          if (cmp.gt(current, high * (1 + breakoutBuffer / 100))) {
            return { action: 'buy', reason: 'breakout' };
          }
          return HOLD;
        },
      });
    }
    case 'donchian_breakout': {
      const channelPeriod = num(params, 'channelPeriod', 20);
      const exitPeriod = num(params, 'exitPeriod', 10);
      const breakoutBuffer = num(params, 'breakoutBufferPct', 0.2);
      const takeProfit = num(params, 'takeProfitPct', 10);
      const stopLoss = num(params, 'stopLossPct', 5);
      const highBefore = rollingHighBefore(price, channelPeriod);
      const lowAt = rollingLowAt(price, exitPeriod);
      return build({
        stateful: false,
        stopLossPct: stopLoss,
        takeProfitPct: takeProfit,
        warmup: () => undefined,
        evaluate: (index, current, _change24h, position, _buyCount, useStopLoss, useTakeProfit) => {
          if (position) {
            const avg = position.avgCostUsd;
            if (useTakeProfit && cmp.gte(current, avg * (1 + takeProfit / 100))) {
              return { action: 'sell', reason: 'take profit' };
            }
            if (useStopLoss && cmp.lte(current, avg * (1 - stopLoss / 100))) {
              return { action: 'sell', reason: 'stop loss' };
            }
            const low = lowAt[index];
            if (low != null && cmp.lte(current, low)) {
              return { action: 'sell', reason: 'lower channel' };
            }
            return HOLD;
          }
          const high = index >= channelPeriod ? highBefore[index] : null;
          if (high != null && cmp.gt(current, high * (1 + breakoutBuffer / 100))) {
            return { action: 'buy', reason: 'upper channel' };
          }
          return HOLD;
        },
      });
    }
    case 'bollinger_reversion': {
      const period = num(params, 'period', 20);
      const stdDev = num(params, 'stdDev', 2);
      const exitAbove = num(params, 'exitAboveMeanPct', 0.5);
      const takeProfit = num(params, 'takeProfitPct', 8);
      const stopLoss = num(params, 'stopLossPct', 5);
      const bands = bollingerSeries(price, period, stdDev);
      return build({
        stateful: false,
        stopLossPct: stopLoss,
        takeProfitPct: takeProfit,
        warmup: () => undefined,
        evaluate: (index, current, _change24h, position, _buyCount, useStopLoss, useTakeProfit) => {
          if (position) {
            const avg = position.avgCostUsd;
            if (useTakeProfit && cmp.gte(current, avg * (1 + takeProfit / 100))) {
              return { action: 'sell', reason: 'take profit' };
            }
            if (useStopLoss && cmp.lte(current, avg * (1 - stopLoss / 100))) {
              return { action: 'sell', reason: 'stop loss' };
            }
            const average = bands.mean[index];
            if (average != null && cmp.gte(current, average * (1 + exitAbove / 100))) {
              return { action: 'sell', reason: 'return to mean' };
            }
            return HOLD;
          }
          const lower = bands.lower[index];
          if (lower != null && cmp.lt(current, lower)) {
            return { action: 'buy', reason: 'below lower band' };
          }
          return HOLD;
        },
      });
    }
    case 'squeeze_breakout': {
      const period = num(params, 'period', 20);
      const stdDev = num(params, 'stdDev', 2);
      const squeezeThreshold = num(params, 'squeezeThresholdPct', 2);
      const breakoutBuffer = num(params, 'breakoutBufferPct', 0.2);
      const takeProfit = num(params, 'takeProfitPct', 12);
      const stopLoss = num(params, 'stopLossPct', 5);
      const bands = bollingerSeries(price, period, stdDev);
      return build({
        stateful: false,
        stopLossPct: stopLoss,
        takeProfitPct: takeProfit,
        warmup: () => undefined,
        evaluate: (index, current, _change24h, position, _buyCount, useStopLoss, useTakeProfit) => {
          const previous = index - 1;
          if (previous < 0) return HOLD;
          if (position) {
            const avg = position.avgCostUsd;
            if (useTakeProfit && cmp.gte(current, avg * (1 + takeProfit / 100))) {
              return { action: 'sell', reason: 'take profit' };
            }
            if (useStopLoss && cmp.lte(current, avg * (1 - stopLoss / 100))) {
              return { action: 'sell', reason: 'stop loss' };
            }
            const average = bands.mean[previous];
            if (average != null && cmp.lt(current, average)) {
              return { action: 'sell', reason: 'return below mean' };
            }
            return HOLD;
          }
          const bandwidth = bands.bandwidth[previous];
          const upper = bands.upper[previous];
          if (bandwidth == null || upper == null) return HOLD;
          if (cmp.gt(bandwidth, squeezeThreshold)) return HOLD;
          if (cmp.gt(current, upper * (1 + breakoutBuffer / 100))) {
            return { action: 'buy', reason: 'squeeze breakout' };
          }
          return HOLD;
        },
      });
    }
    case 'grid_range': {
      const anchorLookback = num(params, 'anchorLookback', 20);
      const gridStep = num(params, 'gridStepPct', 1.5);
      const maxAdds = num(params, 'maxAdds', 4);
      const takeProfit = num(params, 'takeProfitPct', 1.5);
      const stopLoss = num(params, 'stopLossPct', 6);
      const high = rollingHighAt(price, anchorLookback);
      return build({
        stateful: false,
        maxAdds,
        stopLossPct: stopLoss,
        takeProfitPct: takeProfit,
        warmup: () => undefined,
        evaluate: (index, current, _change24h, position, buyCount, useStopLoss, useTakeProfit) => {
          const anchor = high[index];
          if (anchor == null) return HOLD;
          if (position) {
            const avg = position.avgCostUsd;
            if (useTakeProfit && cmp.gte(current, avg * (1 + takeProfit / 100))) {
              return { action: 'sell', reason: 'grid step up' };
            }
            if (useStopLoss && cmp.lte(current, avg * (1 - stopLoss / 100))) {
              return { action: 'sell', reason: 'stop loss' };
            }
            if (buyCount < maxAdds && cmp.lte(current, avg * (1 - gridStep / 100))) {
              return { action: 'buy', reason: 'next grid step' };
            }
            return HOLD;
          }
          if (cmp.lte(current, anchor * (1 - gridStep / 100))) {
            return { action: 'buy', reason: 'first grid step' };
          }
          return HOLD;
        },
      });
    }
    case 'dca_dip': {
      const anchorLookback = num(params, 'anchorLookback', 20);
      const dip = num(params, 'dipPct', 3);
      const maxAdds = num(params, 'maxAdds', 3);
      const takeProfit = num(params, 'takeProfitPct', 5);
      const stopLoss = num(params, 'stopLossPct', 8);
      const high = rollingHighAt(price, anchorLookback);
      return build({
        stateful: false,
        maxAdds,
        stopLossPct: stopLoss,
        takeProfitPct: takeProfit,
        warmup: () => undefined,
        evaluate: (index, current, _change24h, position, buyCount, useStopLoss, useTakeProfit) => {
          const anchor = high[index];
          if (anchor == null) return HOLD;
          if (position) {
            const avg = position.avgCostUsd;
            if (useTakeProfit && cmp.gte(current, avg * (1 + takeProfit / 100))) {
              return { action: 'sell', reason: 'take profit' };
            }
            if (useStopLoss && cmp.lte(current, avg * (1 - stopLoss / 100))) {
              return { action: 'sell', reason: 'stop loss' };
            }
            if (buyCount < maxAdds && cmp.lte(current, avg * (1 - dip / 100))) {
              return { action: 'buy', reason: 'dip add' };
            }
            return HOLD;
          }
          if (cmp.lte(current, anchor * (1 - dip / 100))) {
            return { action: 'buy', reason: 'first dip' };
          }
          return HOLD;
        },
      });
    }
    case 'crash_protected_grid': {
      const gridStep = num(params, 'gridStepPct', 1.5);
      const maxAdds = num(params, 'maxAdds', 4);
      const takeProfit = num(params, 'takeProfitPct', 2.5);
      const crashTrigger = num(params, 'crashTriggerPct', 10);
      const resumeDrop = num(params, 'resumeDropPct', 30);
      const closeLossThreshold = num(params, 'closeLossThresholdPct', 10);
      let hwm = 0;
      let mode: 'normal' | 'crash' = 'normal';
      let adds = 0;
      const step = (
        current: number,
        position: FastPosition | null,
        _buyCount: number,
        useTakeProfit: boolean,
      ): FastDecision => {
        if (hwm <= 0) hwm = current;
        const avg = position?.avgCostUsd ?? null;
        const pnlPct = position && avg ? ((current - avg) / avg) * 100 : null;
        const canClose =
          position !== null && pnlPct !== null && cmp.gte(pnlPct, -closeLossThreshold);
        let nextHwm = current > hwm ? current : hwm;
        if (cmp.gte(current, hwm)) {
          nextHwm = current;
          mode = 'normal';
        }
        const drop = nextHwm > 0 ? ((nextHwm - current) / nextHwm) * 100 : 0;
        if (cmp.gte(drop, resumeDrop)) {
          if (canClose) {
            hwm = current;
            mode = 'normal';
            adds = 0;
            return { action: 'sell', reason: 'crash close' };
          }
          hwm = current;
          mode = 'normal';
          adds = 1;
          return { action: 'buy', reason: 'crash resume' };
        }
        if (mode === 'crash' || cmp.gte(drop, crashTrigger)) {
          if (canClose) {
            hwm = nextHwm;
            mode = 'crash';
            adds = 0;
            return { action: 'sell', reason: 'crash close' };
          }
          hwm = nextHwm;
          mode = 'crash';
          return HOLD;
        }
        if (position && avg) {
          if (useTakeProfit && cmp.gte(current, avg * (1 + takeProfit / 100))) {
            hwm = nextHwm;
            mode = 'normal';
            adds = 0;
            return { action: 'sell', reason: 'take profit' };
          }
          if (adds < maxAdds && cmp.lte(current, avg * (1 - gridStep / 100))) {
            hwm = nextHwm;
            mode = 'normal';
            adds += 1;
            return { action: 'buy', reason: 'grid add' };
          }
          hwm = nextHwm;
          mode = 'normal';
          return HOLD;
        }
        if (cmp.lte(current, nextHwm * (1 - gridStep / 100))) {
          hwm = nextHwm;
          mode = 'normal';
          adds = 1;
          return { action: 'buy', reason: 'first grid step' };
        }
        hwm = nextHwm;
        mode = 'normal';
        adds = 0;
        return HOLD;
      };
      return build({
        stateful: true,
        maxAdds,
        stopLossPct: null,
        takeProfitPct: takeProfit,
        debugState: () => ({ hwm, mode, adds }),
        warmup: (_index, current) => {
          step(current, null, 0, true);
        },
        evaluate: (_index, current, _change24h, position, buyCount, _useStopLoss, useTakeProfit) =>
          step(current, position, buyCount, useTakeProfit),
      });
    }
    case 'failed_breakout': {
      const lookback = num(params, 'lookback', 20);
      const breakdownBuffer = num(params, 'breakdownBufferPct', 0.5);
      const takeProfit = num(params, 'takeProfitPct', 8);
      const stopLoss = num(params, 'stopLossPct', 4);
      const support = rollingLowBefore(price, lookback);
      let breakdown: number | null = null;
      const step = (
        index: number,
        current: number,
        position: FastPosition | null,
        useStopLoss: boolean,
        useTakeProfit: boolean,
      ): FastDecision => {
        if (position) {
          const avg = position.avgCostUsd;
          if (useTakeProfit && cmp.gte(current, avg * (1 + takeProfit / 100))) {
            breakdown = null;
            return { action: 'sell', reason: 'take profit' };
          }
          if (useStopLoss && cmp.lte(current, avg * (1 - stopLoss / 100))) {
            breakdown = null;
            return { action: 'sell', reason: 'stop loss' };
          }
          return HOLD;
        }
        if (breakdown != null && cmp.gte(current, breakdown)) {
          breakdown = null;
          return { action: 'buy', reason: 'return after false breakdown' };
        }
        const level = index >= lookback ? support[index] : null;
        if (level == null) return HOLD;
        if (cmp.lt(current, level * (1 - breakdownBuffer / 100))) {
          breakdown = level;
        }
        return HOLD;
      };
      return build({
        stateful: true,
        stopLossPct: stopLoss,
        takeProfitPct: takeProfit,
        warmup: (index, current) => {
          step(index, current, null, true, true);
        },
        evaluate: (index, current, _change24h, position, _buyCount, useStopLoss, useTakeProfit) =>
          step(index, current, position, useStopLoss, useTakeProfit),
      });
    }
    default:
      return null;
  }
}

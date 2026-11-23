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

function utcDayKey(value: string): string {
  return new Date(value).toISOString().slice(0, 10);
}

function numericMedian(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? (sorted[middle] as number)
    : ((sorted[middle - 1] as number) + (sorted[middle] as number)) / 2;
}

function numericAverage(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
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
    case 'daily_average': {
      const lookbackDays = Math.max(1, Math.floor(num(params, 'lookbackDays', 20)));
      const entryBuffer = num(params, 'entryBufferPct', 0.5);
      const exitBuffer = num(params, 'exitBufferPct', 0.5);
      const takeProfit = num(params, 'takeProfitPct', 5);
      const stopLoss = num(params, 'stopLossPct', 8);
      const useMedian = params.useMedian === true;
      const dayStats = new Map<string, { low: number; high: number }>();
      const keyByIndex: string[] = [];
      for (const candle of candles) {
        const key = utcDayKey(candle.date);
        keyByIndex.push(key);
        const value = Number(candle.closeUsd);
        const stat = dayStats.get(key);
        if (!stat) {
          dayStats.set(key, { low: value, high: value });
        } else {
          if (value < stat.low) stat.low = value;
          if (value > stat.high) stat.high = value;
        }
      }
      const sortedKeys = [...dayStats.keys()].sort((left, right) => left.localeCompare(right));
      const dayIndex = new Map(sortedKeys.map((key, index) => [key, index]));
      const levelsByDay = new Map<string, { low: number; high: number } | null>();
      for (const key of sortedKeys) {
        const complete = dayIndex.get(key) ?? 0;
        if (complete < lookbackDays) {
          levelsByDay.set(key, null);
          continue;
        }
        const windowKeys = sortedKeys.slice(complete - lookbackDays, complete);
        const lows = windowKeys.map((item) => (dayStats.get(item) as { low: number }).low);
        const highs = windowKeys.map((item) => (dayStats.get(item) as { high: number }).high);
        levelsByDay.set(key, {
          low: useMedian ? numericMedian(lows) : numericAverage(lows),
          high: useMedian ? numericMedian(highs) : numericAverage(highs),
        });
      }
      return build({
        stateful: false,
        stopLossPct: stopLoss,
        takeProfitPct: takeProfit,
        warmup: () => undefined,
        evaluate: (index, current, _change24h, position, _buyCount, useStopLoss, useTakeProfit) => {
          const levels = levelsByDay.get(keyByIndex[index] as string) ?? null;
          if (position) {
            const avg = position.avgCostUsd;
            if (useTakeProfit && cmp.gte(current, avg * (1 + takeProfit / 100))) {
              return { action: 'sell', reason: 'take profit' };
            }
            if (useStopLoss && cmp.lte(current, avg * (1 - stopLoss / 100))) {
              return { action: 'sell', reason: 'stop loss' };
            }
            if (!levels) return HOLD;
            if (cmp.gte(current, levels.high * (1 + exitBuffer / 100))) {
              return { action: 'sell', reason: 'daily high' };
            }
            return HOLD;
          }
          if (!levels) return HOLD;
          if (cmp.lte(current, levels.low * (1 - entryBuffer / 100))) {
            return { action: 'buy', reason: 'daily low' };
          }
          return HOLD;
        },
      });
    }
    case 'adaptive_regime': {
      const fastDays = Math.max(1, Math.floor(num(params, 'trendFastDays', 7)));
      const slowDays = Math.max(fastDays + 1, Math.floor(num(params, 'trendSlowDays', 30)));
      const longDays = Math.max(slowDays, Math.floor(num(params, 'trendLongDays', 90)));
      const pullback = num(params, 'pullbackPct', 3);
      const atrMult = num(params, 'atrStopMult', 2.5);
      const trailPct = num(params, 'trailPct', 4);
      const crashDrawdown = num(params, 'crashDrawdownPct', 10);
      const maxAdds = Math.max(1, Math.floor(num(params, 'maxAdds', 2)));
      const dayKeys = candles.map((candle) => utcDayKey(candle.date));
      const uniqueDays = [...new Set(dayKeys)].sort((left, right) => left.localeCompare(right));
      const dayIndex = new Map(uniqueDays.map((day, index) => [day, index]));
      const dailyCloses: number[] = [];
      const dailyHighs: number[] = [];
      const dailyLows: number[] = [];
      for (const day of uniqueDays) {
        let high = -Infinity;
        let low = Infinity;
        let close = 0;
        for (let index = 0; index < candles.length; index += 1) {
          if (dayKeys[index] !== day) continue;
          const candle = candles[index] as BotCandle;
          close = Number(candle.closeUsd);
          const synthetic = candle.synthetic === true;
          high = Math.max(high, synthetic ? close : Number(candle.highUsd));
          low = Math.min(low, synthetic ? close : Number(candle.lowUsd));
        }
        dailyCloses.push(close);
        dailyHighs.push(Number.isFinite(high) ? high : close);
        dailyLows.push(Number.isFinite(low) ? low : close);
      }
      const smaBefore = (period: number): Array<number | null> => {
        const result: Array<number | null> = [];
        let sum = 0;
        for (let index = 0; index < dailyCloses.length; index += 1) {
          const value = dailyCloses[index - 1];
          if (index > 0) sum += value as number;
          if (index > period) sum -= dailyCloses[index - period - 1] as number;
          result.push(index >= period ? sum / period : null);
        }
        return result;
      };
      const fastBefore = smaBefore(fastDays);
      const slowBefore = smaBefore(slowDays);
      const longBefore: Array<number | null> = [];
      const atrBefore: number[] = [];
      const trueRanges: number[] = [0];
      for (let index = 1; index < dailyCloses.length; index += 1) {
        const high = dailyHighs[index] as number;
        const low = dailyLows[index] as number;
        const previous = dailyCloses[index - 1] as number;
        trueRanges.push(Math.max(high - low, Math.abs(high - previous), Math.abs(low - previous)));
      }
      for (let day = 0; day < dailyCloses.length; day += 1) {
        if (day < longDays) {
          longBefore.push(null);
        } else {
          const slice = dailyCloses.slice(0, day).slice(-longDays);
          longBefore.push(slice.reduce((sum, value) => sum + value, 0) / slice.length);
        }
        if (day < 2) {
          atrBefore.push(0.5);
        } else {
          const slice = trueRanges.slice(1, day).slice(-14);
          const atr = slice.reduce((sum, value) => sum + value, 0) / slice.length;
          const close = dailyCloses[day - 1] as number;
          atrBefore.push(close > 0 ? Math.max((atr / close) * 100, 0.5) : 0.5);
        }
      }
      const candleTimes = candles.map((candle) => new Date(candle.date).getTime());
      let hwm = 0;
      let trail: number | null = null;
      let cooldownUntil = 0;
      const reset = () => {
        hwm = 0;
        trail = null;
        cooldownUntil = 0;
      };
      return build({
        stateful: true,
        maxAdds,
        stopLossPct: null,
        takeProfitPct: null,
        warmup: () => reset(),
        evaluate: (index, current, _change24h, position, buyCount) => {
          const day = dayIndex.get(dayKeys[index] as string) ?? 0;
          const fast = fastBefore[day] ?? null;
          const slow = slowBefore[day] ?? null;
          const long = longBefore[day] ?? null;
          const atr = atrBefore[day] ?? 0.5;
          const trendUp =
            fast !== null &&
            slow !== null &&
            cmp.gt(fast, slow) &&
            (long === null || cmp.gt(slow, long)) &&
            cmp.gt(current, slow);
          const inCooldown = cooldownUntil > (candleTimes[index] as number);
          const cooldownNow = () => {
            cooldownUntil = (candleTimes[index] as number) + 24 * 3_600_000;
            hwm = current;
            trail = null;
          };
          if (position) {
            const avg = position.avgCostUsd;
            hwm = hwm > 0 ? Math.max(hwm, current) : current;
            if (cmp.lte(current, avg * (1 - (atrMult * atr) / 100))) {
              cooldownNow();
              return { action: 'sell', reason: 'atr stop' };
            }
            if (hwm > 0 && cmp.gte(((hwm - current) / hwm) * 100, crashDrawdown)) {
              cooldownNow();
              return { action: 'sell', reason: 'crash' };
            }
            if (fast !== null && slow !== null && cmp.lt(fast, slow)) {
              cooldownUntil = 0;
              hwm = current;
              trail = null;
              return { action: 'sell', reason: 'trend break' };
            }
            const trailActive = cmp.gte(current, avg * 1.08) || trail !== null;
            if (trailActive) {
              const candidate = hwm * (1 - trailPct / 100);
              trail = trail === null ? candidate : Math.max(trail, candidate);
              if (cmp.lte(current, trail)) {
                cooldownNow();
                return { action: 'sell', reason: 'trailing stop' };
              }
              if (
                trendUp &&
                buyCount < maxAdds &&
                fast !== null &&
                cmp.lte(current, fast * (1 - pullback / 100))
              ) {
                return { action: 'buy', reason: 'pullback add' };
              }
              return HOLD;
            }
            if (
              trendUp &&
              buyCount < maxAdds &&
              fast !== null &&
              cmp.lte(current, fast * (1 - pullback / 100))
            ) {
              return { action: 'buy', reason: 'pullback add' };
            }
            return HOLD;
          }
          if (inCooldown) return HOLD;
          if (!trendUp) {
            hwm = current;
            trail = null;
            return HOLD;
          }
          if (fast !== null && cmp.lte(current, fast * (1 - pullback / 100))) {
            hwm = current;
            trail = null;
            cooldownUntil = 0;
            return { action: 'buy', reason: 'pullback in trend' };
          }
          hwm = current;
          trail = null;
          return HOLD;
        },
      });
    }
    default:
      // Unknown or intentionally unsupported strategies use the Decimal
      // engine; the search falls back per variant.
      return null;
  }
}

import { strategyByKey } from '../trading-bots/strategies';
import type { AiSearchTimeframe } from '@nexter/contracts';
import type { SearchFold, SearchVariant } from './ai-search.helpers';
import { countEntrySignals, isSafeSignalStrategy } from './ai-search.signals';

const LOOKBACK_KEYS = [
  'slowPeriod',
  'lookback',
  'anchorLookback',
  'exitPeriod',
  'channelPeriod',
  'entryLookback',
];

export interface ScreenResult {
  ok: boolean;
  reason: string | null;
  signalCount?: number;
}

export interface ScreenOptions {
  timeframe?: AiSearchTimeframe;
  minTrades?: number;
}

function numberParam(params: Record<string, unknown>, key: string): number | null {
  const value = params[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/**
 * Cheap, safe parameter/data screen. It never runs a backtest and never uses
 * the holdout. It only rejects variants that cannot produce a valid signal.
 */
export function screenVariant(
  variant: SearchVariant,
  folds: SearchFold[],
  options: ScreenOptions = {},
): ScreenResult {
  const definition = strategyByKey.get(variant.strategyKey);
  if (!definition) return { ok: false, reason: 'unknown strategy' };

  let params: Record<string, unknown>;
  try {
    params = definition.parseParams(variant.params);
  } catch {
    return { ok: false, reason: 'invalid params' };
  }

  const maxCandles = Math.max(0, ...folds.map((fold) => fold.candles.length));
  for (const key of LOOKBACK_KEYS) {
    const value = numberParam(params, key);
    if (value !== null && value > maxCandles) {
      return { ok: false, reason: 'lookback too long' };
    }
  }

  const fast = numberParam(params, 'fastPeriod');
  const slow = numberParam(params, 'slowPeriod');
  if (fast !== null && slow !== null && fast >= slow) {
    return { ok: false, reason: 'invalid fast/slow' };
  }

  const stop = numberParam(params, 'stopLossPct');
  const take = numberParam(params, 'takeProfitPct');
  if ((stop !== null && stop <= 0) || (take !== null && take <= 0)) {
    return { ok: false, reason: 'invalid thresholds' };
  }

  if (
    options.timeframe &&
    options.minTrades &&
    options.minTrades > 0 &&
    isSafeSignalStrategy(variant.strategyKey)
  ) {
    let signalCount = 0;
    for (const fold of folds) {
      signalCount += countEntrySignals(variant, fold, options.timeframe) ?? 0;
    }
    if (signalCount < options.minTrades) {
      return { ok: false, reason: 'too few entry signals', signalCount };
    }
    return { ok: true, reason: null, signalCount };
  }

  return { ok: true, reason: null };
}

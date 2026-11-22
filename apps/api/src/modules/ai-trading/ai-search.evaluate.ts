import type { AiSearchTimeframe } from '@nexter/contracts';
import { runBacktest } from '../trading-bots/backtest/backtest.engine';
import { strategyByKey } from '../trading-bots/strategies';
import { TIMEFRAME_MS } from './ai-features';
import { createFastRuntime } from './ai-fast-strategies';
import { runFastBacktest } from './ai-fast-backtest';
import {
  aggregateVariant,
  type SearchFold,
  type SearchVariant,
  type VariantMetrics,
} from './ai-search.helpers';

const FEE_BPS = 25;
const SLIPPAGE_BPS = 10;

function candlesPerDay(timeframe: AiSearchTimeframe): number {
  return Math.max(1, Math.round(86_400_000 / TIMEFRAME_MS[timeframe]));
}

export interface VariantFoldEvaluation {
  unknownStrategy: boolean;
  aggregate: VariantMetrics | null;
}

interface FoldResult {
  totalReturnPct: string;
  maxDrawdownPct: string;
  tradesCount: number;
}

function fastEngineEnabled(): boolean {
  return process.env.AI_SEARCH_FAST_ENGINE !== '0';
}

function evaluateDecimalFold(
  variant: SearchVariant,
  fold: SearchFold,
  timeframe: AiSearchTimeframe,
): FoldResult | null {
  const definition = strategyByKey.get(variant.strategyKey);
  if (!definition) return null;
  try {
    const result = runBacktest(definition, variant.params, fold.candles, {
      initialCapitalUsd: '1000',
      feeBps: FEE_BPS,
      slippageBps: SLIPPAGE_BPS,
      changeLookbackCandles: candlesPerDay(timeframe),
      warmupCandles: fold.warmupCandles,
    });
    return result.stats;
  } catch {
    return null;
  }
}

function evaluateDecimal(
  variant: SearchVariant,
  folds: SearchFold[],
  timeframe: AiSearchTimeframe,
): FoldResult[] | null {
  const results: FoldResult[] = [];
  for (const fold of folds) {
    const result = evaluateDecimalFold(variant, fold, timeframe);
    if (!result) return null;
    results.push(result);
  }
  return results;
}

function evaluateFast(
  variant: SearchVariant,
  folds: SearchFold[],
  timeframe: AiSearchTimeframe,
): FoldResult[] | null {
  const results: FoldResult[] = [];
  for (const fold of folds) {
    try {
      const runtime = createFastRuntime(variant, fold.candles);
      if (!runtime) return null;
      const result = runFastBacktest(runtime, fold.candles, {
        initialCapitalUsd: 1000,
        feeBps: FEE_BPS,
        slippageBps: SLIPPAGE_BPS,
        changeLookbackCandles: candlesPerDay(timeframe),
        warmupCandles: fold.warmupCandles,
      });
      if (result.ambiguous === true) {
        // Re-run only the boundary fold on the Decimal engine. Folds are
        // independent, so the aggregate stays exact.
        const exact = evaluateDecimalFold(variant, fold, timeframe);
        if (!exact) return null;
        results.push(exact);
      } else {
        results.push(result);
      }
    } catch {
      return null;
    }
  }
  return results;
}

/** Runs the expensive walk-forward folds for one variant. Pure; safe in a worker. */
export function evaluateVariantFolds(
  variant: SearchVariant,
  folds: SearchFold[],
  timeframe: AiSearchTimeframe,
): VariantFoldEvaluation {
  const definition = strategyByKey.get(variant.strategyKey);
  if (!definition) return { unknownStrategy: true, aggregate: null };

  let results: FoldResult[] | null = null;
  if (fastEngineEnabled()) {
    results = evaluateFast(variant, folds, timeframe);
  }
  if (results === null) {
    results = evaluateDecimal(variant, folds, timeframe);
  }
  if (results === null || results.length === 0) {
    return { unknownStrategy: false, aggregate: null };
  }
  return { unknownStrategy: false, aggregate: aggregateVariant(results) };
}

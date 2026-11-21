import type { AiSearchTimeframe } from '@nexter/contracts';
import { runBacktest } from '../trading-bots/backtest/backtest.engine';
import { strategyByKey } from '../trading-bots/strategies';
import { TIMEFRAME_MS } from './ai-features';
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

/** Runs the expensive walk-forward folds for one variant. Pure; safe in a worker. */
export function evaluateVariantFolds(
  variant: SearchVariant,
  folds: SearchFold[],
  timeframe: AiSearchTimeframe,
): VariantFoldEvaluation {
  const definition = strategyByKey.get(variant.strategyKey);
  if (!definition) return { unknownStrategy: true, aggregate: null };

  const foldResults: Array<{
    totalReturnPct: string;
    maxDrawdownPct: string;
    tradesCount: number;
  }> = [];
  for (const fold of folds) {
    try {
      const result = runBacktest(definition, variant.params, fold.candles, {
        initialCapitalUsd: '1000',
        feeBps: FEE_BPS,
        slippageBps: SLIPPAGE_BPS,
        changeLookbackCandles: candlesPerDay(timeframe),
        warmupCandles: fold.warmupCandles,
      });
      foldResults.push(result.stats);
    } catch {
      return { unknownStrategy: false, aggregate: null };
    }
  }
  if (foldResults.length === 0) return { unknownStrategy: false, aggregate: null };

  return { unknownStrategy: false, aggregate: aggregateVariant(foldResults) };
}

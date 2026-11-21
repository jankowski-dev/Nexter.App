import type { BotCandle } from '@nexter/contracts';
import { availableParallelism } from 'node:os';
import type { StrategyDefinition } from '../trading-bots/strategies/types';
import { TIMEFRAME_MS } from './ai-features';
import type { AiSearchTimeframe } from '@nexter/contracts';

export interface SearchVariant {
  strategyKey: string;
  params: Record<string, unknown>;
}

export interface SearchFold {
  candles: BotCandle[];
  warmupCandles: number;
}

export interface SearchFoldSet {
  folds: SearchFold[];
  holdout: BotCandle[];
  holdoutWarmup: BotCandle[];
  holdoutWarmupCandles: number;
}

export interface VariantMetrics {
  oosMedianReturnPct: string;
  oosMeanReturnPct: string;
  oosWorstReturnPct: string;
  maxDrawdownPct: string;
  trades: number;
  positiveFolds: number;
  stabilityPct: string;
  policyScore: string;
}

export function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function randomFieldValue(
  definition: StrategyDefinition,
  fieldKey: string,
  rng: () => number,
): number {
  const field = definition.paramFields.find((item) => item.key === fieldKey);
  const fallback = Number(definition.defaultParams[fieldKey] ?? 0);
  if (!field) return fallback;
  const min = field.min ?? fallback;
  const max = field.max ?? fallback;
  if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min) return fallback;
  const step = field.step ?? (field.integer ? 1 : (max - min) / 20);
  if (!Number.isFinite(step) || step <= 0) return fallback;
  const steps = Math.max(0, Math.floor((max - min) / step));
  const index = Math.floor(rng() * (steps + 1));
  const value = min + index * step;
  return field.integer ? Math.round(value) : Number(value.toFixed(8));
}

export function generateSearchVariants(
  definitions: StrategyDefinition[],
  total: number,
  seed = 7,
): SearchVariant[] {
  const capped = Math.max(1, Math.min(100000, Math.floor(total)));
  const eligible = definitions.filter((definition) => definition.aiEligible !== false);
  if (eligible.length === 0) return [];
  const perStrategy = Math.floor(capped / eligible.length);
  const remainder = capped % eligible.length;
  const variants: SearchVariant[] = [];
  const rng = mulberry32(seed);

  for (let index = 0; index < eligible.length; index += 1) {
    const definition = eligible[index] as StrategyDefinition;
    const target = perStrategy + (index < remainder ? 1 : 0);
    const seen = new Set<string>();
    const add = (params: Record<string, unknown>) => {
      if (variants.length >= capped) return;
      const key = JSON.stringify(params);
      if (seen.has(key)) return;
      seen.add(key);
      variants.push({ strategyKey: definition.key, params });
    };

    try {
      add(definition.parseParams(definition.defaultParams));
    } catch {
      // A broken default must not stop the search; skip this strategy.
      continue;
    }

    let attempts = 0;
    while (seen.size < target && attempts < target * 30) {
      attempts += 1;
      const raw: Record<string, unknown> = {};
      for (const field of definition.paramFields) {
        raw[field.key] = randomFieldValue(definition, field.key, rng);
      }
      try {
        add(definition.parseParams(raw));
      } catch {
        // Invalid combinations are expected; try another.
      }
    }
  }

  return variants.slice(0, capped);
}

export const MIN_SEARCH_DAYS = 140;
export const HOLD_OUT_DAYS = 30;

export function candlesPerDay(timeframe: AiSearchTimeframe): number {
  return Math.max(1, Math.round(86_400_000 / TIMEFRAME_MS[timeframe]));
}

export function historyDaysFor(candles: BotCandle[], timeframe: AiSearchTimeframe): number {
  return Math.floor(candles.length / candlesPerDay(timeframe));
}

export function minPositiveFoldsFor(foldCount: number): number {
  return Math.max(2, Math.ceil(foldCount * 0.625));
}

export function minTradesFor(foldCount: number): number {
  return Math.max(5, Math.floor(foldCount));
}

export function stabilityPctFor(positiveFolds: number, foldCount: number): string {
  return ((positiveFolds / Math.max(1, foldCount)) * 100).toFixed(2);
}

export function buildSearchFolds(
  candles: BotCandle[],
  timeframe: AiSearchTimeframe,
  lookbackDays = 180,
): SearchFoldSet {
  const perDay = candlesPerDay(timeframe);
  const totalDays = Math.max(
    MIN_SEARCH_DAYS,
    Math.min(180, Math.floor(Number.isFinite(lookbackDays) ? lookbackDays : 180)),
  );
  const total = totalDays * perDay;
  const searchEnd = (totalDays - HOLD_OUT_DAYS) * perDay;
  if (candles.length < total) {
    throw new Error(`Need at least ${total} candles, got ${candles.length}`);
  }
  const use = candles.slice(-total);
  const folds: SearchFold[] = [];
  for (let index = 0; index < 8; index += 1) {
    const trainStart = index * 10 * perDay;
    const trainEnd = trainStart + 60 * perDay;
    const oosStart = trainEnd + 2 * perDay;
    const oosEnd = oosStart + 10 * perDay;
    if (oosEnd > searchEnd) break;
    const warmupCandles = Math.max(15 * perDay, 240);
    const warmupStart = Math.max(trainStart, oosStart - warmupCandles);
    folds.push({
      candles: use.slice(warmupStart, oosEnd),
      warmupCandles: oosStart - warmupStart,
    });
  }
  const holdoutWarmupCandles = Math.min(searchEnd, Math.max(15 * perDay, 240));
  return {
    folds,
    holdout: use.slice(searchEnd, total),
    holdoutWarmup: use.slice(searchEnd - holdoutWarmupCandles, searchEnd),
    holdoutWarmupCandles,
  };
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? ((sorted[middle - 1] as number) + (sorted[middle] as number)) / 2
    : (sorted[middle] as number);
}

export function aggregateVariant(
  results: Array<{ totalReturnPct: string; maxDrawdownPct: string; tradesCount: number }>,
): VariantMetrics {
  const returns = results.map((result) => Number(result.totalReturnPct));
  const drawdowns = results.map((result) => Number(result.maxDrawdownPct));
  const trades = results.reduce((sum, result) => sum + result.tradesCount, 0);
  const positiveFolds = returns.filter((value) => value > 0).length;
  const oosMedian = median(returns);
  const maxDrawdown = drawdowns.length > 0 ? Math.max(...drawdowns) : 0;
  const policyScore = oosMedian - 0.5 * maxDrawdown;

  return {
    oosMedianReturnPct: oosMedian.toFixed(2),
    oosMeanReturnPct: (returns.length > 0
      ? returns.reduce((sum, value) => sum + value, 0) / returns.length
      : 0
    ).toFixed(2),
    oosWorstReturnPct: (returns.length > 0 ? Math.min(...returns) : 0).toFixed(2),
    maxDrawdownPct: maxDrawdown.toFixed(2),
    trades,
    positiveFolds,
    stabilityPct: stabilityPctFor(positiveFolds, returns.length),
    policyScore: policyScore.toFixed(4),
  };
}

export function splitVariants(variants: SearchVariant[], parts: number): SearchVariant[][] {
  if (variants.length === 0) return [];
  const count = Math.max(1, Math.min(variants.length, Math.floor(parts)));
  const base = Math.floor(variants.length / count);
  const extra = variants.length % count;
  const chunks: SearchVariant[][] = [];
  let offset = 0;
  for (let index = 0; index < count; index += 1) {
    const size = base + (index < extra ? 1 : 0);
    chunks.push(variants.slice(offset, offset + size));
    offset += size;
  }
  return chunks;
}

export function searchWorkerCount(
  env: Record<string, string | undefined> = process.env,
  cpus = availableParallelism(),
): number {
  const maxWorkers = Math.max(1, Math.min(8, cpus - 1 || 1));
  const fallback = Math.max(1, Math.min(4, maxWorkers));
  const raw = env.AI_SEARCH_WORKERS;
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value)) return fallback;
  if (value <= 0) return 1;
  return Math.max(1, Math.min(maxWorkers, Math.floor(value)));
}

export type HoldoutRejection = 'negative holdout' | 'holdout drawdown too high' | null;

export function holdoutRejection(
  returnPct: number,
  drawdownPct: number,
  maxDrawdownPct = 20,
): HoldoutRejection {
  if (!Number.isFinite(returnPct) || returnPct <= 0) return 'negative holdout';
  if (Number.isFinite(drawdownPct) && drawdownPct > maxDrawdownPct) {
    return 'holdout drawdown too high';
  }
  return null;
}

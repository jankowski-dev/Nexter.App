import { mulberry32, type VariantMetrics } from './ai-search.helpers';

export const FULL_MAX_DRAWDOWN_PCT = 20;
export const FULL_MIN_WORST_RETURN_PCT = -15;

export type FunnelStageKey = 'screen' | 'probe' | 'budget' | 'full' | 'control' | 'holdout';

export interface FunnelStageReport {
  key: FunnelStageKey;
  input: number;
  output: number;
  rejected: number;
  durationMs: number;
  controlSampled: number;
  controlPassed: number;
}

export interface FunnelControlHit {
  stage: FunnelStageKey;
  strategyKey: string;
  params: Record<string, unknown>;
  oosMedianReturnPct: string;
  maxDrawdownPct: string;
  trades: number;
  positiveFolds: number;
}

export interface FunnelReport {
  stages: FunnelStageReport[];
  controlHits: FunnelControlHit[];
  estimatedMissed: number;
  estimatedRecallPct: string | null;
}

export interface ControlEstimateInput {
  rejected: number;
  sampled: number;
  passed: number;
}

export const FUNNEL_STAGE_LABELS: Record<FunnelStageKey, string> = {
  screen: 'Сигналы',
  probe: 'Проба',
  budget: 'Бюджет',
  full: 'OOS',
  control: 'Контроль',
  holdout: 'Holdout',
};

const STAGE_WEIGHTS: Record<FunnelStageKey, number> = {
  screen: 0.06,
  probe: 0.2,
  budget: 0.02,
  full: 0.66,
  control: 0.03,
  holdout: 0.03,
};

function hashSeed(seed: string): number {
  let hash = 2166136261;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/** Deterministic partial Fisher-Yates sample; the same seed returns the same items. */
export function seededSample<T>(items: T[], count: number, seed: string): T[] {
  if (count <= 0 || items.length === 0) return [];
  if (count >= items.length) return [...items];
  const indices = items.map((_, index) => index);
  const rng = mulberry32(hashSeed(seed));
  const take = Math.min(count, indices.length);
  for (let index = 0; index < take; index += 1) {
    const swap = index + Math.floor(rng() * (indices.length - index));
    const current = indices[index] as number;
    indices[index] = indices[swap] as number;
    indices[swap] = current;
  }
  return indices.slice(0, take).map((index) => items[index] as T);
}

/** Mirrors the production OOS gates; the holdout policy is deliberately not included. */
export function passesFullCriteria(
  aggregate: Pick<
    VariantMetrics,
    'trades' | 'oosMedianReturnPct' | 'positiveFolds' | 'maxDrawdownPct' | 'oosWorstReturnPct'
  >,
  minTrades: number,
  minPositiveFolds: number,
): boolean {
  return (
    aggregate.trades >= minTrades &&
    Number(aggregate.oosMedianReturnPct) > 0 &&
    aggregate.positiveFolds >= minPositiveFolds &&
    Number(aggregate.maxDrawdownPct) <= FULL_MAX_DRAWDOWN_PCT &&
    Number(aggregate.oosWorstReturnPct) >= FULL_MIN_WORST_RETURN_PCT
  );
}

/**
 * Estimates how many OOS passers the funnel may have discarded. Each control group
 * is a random sample of a rejected stage; `passed` counts sample members that meet
 * the full OOS gates. No control variant is promoted to a recommendation.
 */
export function estimateRecall(
  observedPassers: number,
  controls: ControlEstimateInput[],
): { missed: number; recallPct: string | null } {
  let missed = 0;
  let hasSample = false;
  for (const control of controls) {
    if (control.sampled <= 0) continue;
    hasSample = true;
    missed += control.rejected * (control.passed / control.sampled);
  }
  if (!hasSample) return { missed: 0, recallPct: null };
  const estimatedTotal = observedPassers + missed;
  return {
    missed: Math.round(missed),
    recallPct:
      estimatedTotal > 0 ? ((observedPassers / estimatedTotal) * 100).toFixed(2) : '100.00',
  };
}

/** Overall weighted completion for the active stages, in whole percent. */
export function overallPercent(
  activeStages: FunnelStageKey[],
  currentStage: FunnelStageKey,
  stageFraction: number,
): number {
  const active = activeStages.filter((stage) => STAGE_WEIGHTS[stage] > 0);
  const totalWeight = active.reduce((sum, stage) => sum + STAGE_WEIGHTS[stage], 0);
  if (totalWeight <= 0) return 0;
  let completed = 0;
  for (const stage of active) {
    if (stage === currentStage) {
      completed += STAGE_WEIGHTS[stage] * Math.max(0, Math.min(1, stageFraction));
      break;
    }
    completed += STAGE_WEIGHTS[stage];
  }
  return Math.max(0, Math.min(100, Math.round((completed / totalWeight) * 100)));
}

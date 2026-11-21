import { z } from 'zod';
import {
  aiCycleStepKeys,
  aiCycleStepSchema,
  aiCycleStepStatuses,
  aiSearchNearMissSchema,
  type AiCycleStatus,
  type AiCycleStep,
} from '@nexter/contracts';
import { sanitizeStoredError } from './ai-error.helpers';

export interface CycleRunLike {
  id: string;
  status: string;
  createdAt: Date;
  finishedAt: Date | null;
}

export interface NormalizedCycle {
  cycleId: string;
  status: AiCycleStatus['status'];
  assetId: string | null;
  timeframe: string | null;
  steps: AiCycleStep[];
  searchRunId: string | null;
  recommended: number;
  draftsCreated: number;
  rejectionReasons: Record<string, number>;
  nearMisses: AiCycleStatus['nearMisses'];
  error: string | null;
  createdAt: string;
  finishedAt: string | null;
}

const cycleStatuses = ['queued', 'running', 'succeeded', 'failed', 'cancelled'] as const;
const uuid = z.uuid();

export const SEARCH_IDLE_TIMEOUT_MS = 10 * 60_000;
export const SEARCH_HARD_TIMEOUT_MS = 90 * 60_000;

export function searchPollTimeout(
  now: number,
  lastProgressAt: number,
  deadline: number,
): 'idle' | 'hard' | null {
  if (now >= deadline) return 'hard';
  if (now - lastProgressAt >= SEARCH_IDLE_TIMEOUT_MS) return 'idle';
  return null;
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function nonNegativeInt(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}

function normalizeStatus(value: unknown): AiCycleStatus['status'] {
  return cycleStatuses.includes(value as (typeof cycleStatuses)[number])
    ? (value as AiCycleStatus['status'])
    : 'failed';
}

function normalizeStep(value: unknown): AiCycleStep | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  if (!aiCycleStepKeys.includes(raw.key as (typeof aiCycleStepKeys)[number])) return null;
  const progress = raw.progressPct;
  const parsed = aiCycleStepSchema.safeParse({
    key: raw.key,
    status: aiCycleStepStatuses.includes(raw.status as (typeof aiCycleStepStatuses)[number])
      ? raw.status
      : 'queued',
    message: text(raw.message),
    error: sanitizeStoredError(text(raw.error)),
    progressPct:
      typeof progress === 'number' && Number.isFinite(progress)
        ? Math.min(100, Math.max(0, Math.floor(progress)))
        : null,
    startedAt: text(raw.startedAt),
    finishedAt: text(raw.finishedAt),
  });
  return parsed.success ? parsed.data : null;
}

function normalizeSteps(value: unknown): AiCycleStep[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((step) => {
    const normalized = normalizeStep(step);
    return normalized ? [normalized] : [];
  });
}

function normalizeReasons(value: unknown): Record<string, number> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value).flatMap(([reason, count]) =>
      typeof count === 'number' && Number.isFinite(count)
        ? [[reason, Math.max(0, Math.floor(count))]]
        : [],
    ),
  );
}

function normalizeNearMisses(value: unknown): AiCycleStatus['nearMisses'] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const parsed = aiSearchNearMissSchema.safeParse(item);
    return parsed.success ? [parsed.data] : [];
  });
}

export function normalizeCycle(run: CycleRunLike, summaryValue: unknown): NormalizedCycle {
  const summary =
    summaryValue && typeof summaryValue === 'object'
      ? (summaryValue as Record<string, unknown>)
      : {};
  const assetId = uuid.safeParse(summary.assetId);
  const searchRunId = uuid.safeParse(summary.searchRunId);

  return {
    cycleId: run.id,
    status: normalizeStatus(run.status),
    assetId: assetId.success ? assetId.data : null,
    timeframe: text(summary.timeframe),
    steps: normalizeSteps(summary.steps),
    searchRunId: searchRunId.success ? searchRunId.data : null,
    recommended: nonNegativeInt(summary.recommended),
    draftsCreated: nonNegativeInt(summary.draftsCreated),
    rejectionReasons: normalizeReasons(summary.rejectionReasons),
    nearMisses: normalizeNearMisses(summary.nearMisses),
    error: sanitizeStoredError(text(summary.error)),
    createdAt: run.createdAt.toISOString(),
    finishedAt: run.finishedAt?.toISOString() ?? null,
  };
}

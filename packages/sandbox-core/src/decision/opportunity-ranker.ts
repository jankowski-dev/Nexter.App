import { Reason } from './reason-codes';
import type { ReasonCode } from './reason-codes';
import type { StrategySignal } from './strategies';
import type { SandboxDecisionSettings, StrategyKey } from './types';

/**
 * Deterministic opportunity ranking.
 *
 * Scores are native numbers by design (indicators and ranking are not money).
 * The comparison never uses `localeCompare`, `Date.now` or `Math.random`, and
 * the result does not depend on the caller's candidate order. Drops are ordered
 * by token id and strategy key so logs stay stable too.
 */

export interface OpportunityCandidate {
  readonly tokenId: string;
  readonly strategyKey: StrategyKey;
  readonly signal: StrategySignal;
  readonly atrPct: string | null;
  readonly avgVolumeUsd: string | null;
}

export interface RankedOpportunity extends OpportunityCandidate {
  readonly score: string;
  readonly rank: number;
}

export interface RankingDrop {
  readonly candidate: OpportunityCandidate;
  readonly reasonCode: ReasonCode;
  readonly reasonText: string;
}

export interface RankingResult {
  readonly ranked: readonly RankedOpportunity[];
  readonly dropped: readonly RankingDrop[];
}

const DECIMAL = /^\d+(\.\d+)?$/;

/** Parses a non-negative plain decimal string, rejecting signs and exponents. */
function readNumber(value: string | null): number | null {
  if (value === null || !DECIMAL.test(value)) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function validConfidence(confidence: number): boolean {
  return Number.isFinite(confidence) && confidence >= 0 && confidence <= 1;
}

/**
 * 1 at or above twice the minimum, 0.5 at the minimum, linear between.
 * Returns `null` below the minimum (the caller drops the candidate).
 */
function liquidityFactor(volume: number, minimum: number): number | null {
  if (!(minimum > 0)) return 1;
  if (volume < minimum) return null;
  if (volume >= 2 * minimum) return 1;
  return 0.5 + 0.5 * ((volume - minimum) / minimum);
}

/** Native code-unit comparison; never `localeCompare`. */
function compareText(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

interface ScoredCandidate {
  readonly candidate: OpportunityCandidate;
  readonly score: number;
}

function compareScored(left: ScoredCandidate, right: ScoredCandidate): number {
  if (left.score !== right.score) return right.score - left.score;
  if (left.candidate.signal.confidence !== right.candidate.signal.confidence) {
    return right.candidate.signal.confidence - left.candidate.signal.confidence;
  }
  const byToken = compareText(left.candidate.tokenId, right.candidate.tokenId);
  if (byToken !== 0) return byToken;
  return compareText(left.candidate.strategyKey, right.candidate.strategyKey);
}

function compareDrops(left: RankingDrop, right: RankingDrop): number {
  const byToken = compareText(left.candidate.tokenId, right.candidate.tokenId);
  if (byToken !== 0) return byToken;
  return compareText(left.candidate.strategyKey, right.candidate.strategyKey);
}

/**
 * Ranks buy opportunities by
 * `confidence * (1 / (atrPct + 1)) * liquidityFactor`.
 *
 * Candidates with missing/invalid ATR or volume, a confidence outside 0..1 or
 * volume below `minLiquidityUsd` are dropped with a stable reason code.
 */
export function rankOpportunities(
  candidates: readonly OpportunityCandidate[],
  settings: SandboxDecisionSettings,
): RankingResult {
  const minimumLiquidity = Number(settings.regime.minLiquidityUsd);
  const minimum = Number.isFinite(minimumLiquidity) ? minimumLiquidity : 0;
  const scored: ScoredCandidate[] = [];
  const dropped: RankingDrop[] = [];

  for (const candidate of candidates) {
    const atr = readNumber(candidate.atrPct);
    const volume = readNumber(candidate.avgVolumeUsd);
    const confidence = candidate.signal.confidence;

    if (atr === null || volume === null || !validConfidence(confidence)) {
      dropped.push({
        candidate,
        reasonCode: Reason.RANK_NO_DATA,
        reasonText: `Missing or invalid ranking data (ATR, volume or confidence) for ${candidate.tokenId}`,
      });
      continue;
    }

    const factor = liquidityFactor(volume, minimum);
    if (factor === null) {
      dropped.push({
        candidate,
        reasonCode: Reason.RANK_ILLIQUID,
        reasonText: `Average volume ${volume.toFixed(2)} USD is below the ${minimum.toFixed(2)} USD minimum for ${candidate.tokenId}`,
      });
      continue;
    }

    const score = confidence * (1 / (atr + 1)) * factor;
    scored.push({ candidate, score });
  }

  scored.sort(compareScored);
  dropped.sort(compareDrops);

  const ranked: RankedOpportunity[] = scored.map((entry, index) => ({
    ...entry.candidate,
    score: entry.score.toFixed(6),
    rank: index + 1,
  }));

  return { ranked, dropped };
}

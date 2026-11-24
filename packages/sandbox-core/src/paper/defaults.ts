import { configVersion } from '../config';
import type { PaperRunConfig, PaperRunSettings } from './types';

/** Persisted paper-run contract version; bump only for a breaking change. */
export const PAPER_VERSION = 'paper-run-v1';

/** Approved Stage 1C execution defaults (design §3). */
export const DEFAULT_PAPER_SETTINGS: PaperRunSettings = {
  feeBps: 25,
  slippageBps: 10,
  liquidityCapPct: 1,
  maxPendingBars: 1,
  cooldownHoursAfterStop: 24,
  counterfactualHorizonHours: 24,
};

/**
 * Computes the Stage 1A `configVersion` over the full paper config.
 *
 * `PaperRunConfig.tokenIds` is readonly while `RunConfig.tokenIds` is mutable,
 * so this copies the array (never mutating the caller's config) and delegates
 * to the shared hasher, which ignores `runId` and sorts keys deterministically.
 */
export function paperConfigVersion(config: PaperRunConfig): string {
  return configVersion({ ...config, tokenIds: [...config.tokenIds] });
}

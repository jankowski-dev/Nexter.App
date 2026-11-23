import { sha256Hex, stableStringify } from './util/hash';
import type { RunConfig } from './types';

export function configVersion(config: RunConfig): string {
  const { runId: _runId, ...settings } = config;
  return sha256Hex(stableStringify(settings));
}

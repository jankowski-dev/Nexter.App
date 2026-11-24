import { GENESIS_HASH } from '@nexter/sandbox-core';

/** Injection token for the `SANDBOX_ENABLED` feature flag. */
export const SANDBOX_ENABLED = 'SANDBOX_ENABLED';

/** Contract version exposed by the sandbox status endpoint. */
export const SANDBOX_VERSION = 'sandbox-stage-2';

/** Initial `sandbox_runs.event_hash` value; matches the Stage 1A genesis hash. */
export const SANDBOX_EVENT_GENESIS_HASH = GENESIS_HASH;

/** Owner-facing sandbox availability. */
export interface SandboxStatus {
  enabled: boolean;
  version: string;
}

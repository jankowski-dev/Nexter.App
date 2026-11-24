/** Injection token for the `SANDBOX_ENABLED` feature flag. */
export const SANDBOX_ENABLED = 'SANDBOX_ENABLED';

/** Contract version exposed by the sandbox status endpoint. */
export const SANDBOX_VERSION = 'sandbox-stage-2';

/** Owner-facing sandbox availability. */
export interface SandboxStatus {
  enabled: boolean;
  version: string;
}

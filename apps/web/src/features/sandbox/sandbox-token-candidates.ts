import type { SandboxTokenCandidate, SandboxTokenCreateRequest } from '@nexter/contracts';

/** Selectable favorites candidates, preserving the server order. */
export function eligibleSandboxCandidates(
  candidates: readonly SandboxTokenCandidate[],
): SandboxTokenCandidate[] {
  return candidates.filter((candidate) => candidate.eligible);
}

/**
 * New sandbox tokens are derived from a favorites candidate; the server
 * re-resolves the same key and ignores client symbol/name. The payload is only
 * a convenience so the API gets an exact, schema-valid request.
 */
export function sandboxTokenCandidatePayload(
  candidate: SandboxTokenCandidate,
): SandboxTokenCreateRequest {
  if (!candidate.eligible) {
    throw new Error(candidate.reason ?? 'Sandbox token candidate is not eligible');
  }

  return {
    tokenKey: candidate.tokenKey,
    symbol: candidate.symbol,
    name: candidate.name,
    ...(candidate.contractAddress ? { contractAddress: candidate.contractAddress } : {}),
  };
}

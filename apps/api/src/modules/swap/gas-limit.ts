const GAS_BUFFER_BPS = 2_000;
const MIN_GAS_LIMIT = 150_000n;
const MAX_GAS_LIMIT = 10_000_000n;
const DECIMAL = /^\d+$/;

/**
 * Turns provider gas estimates into an actionable transaction gas limit.
 *
 * Kyber's `gas` can be slightly below the RPC estimate, and the nested
 * MetaAggregationRouter call can fail under the EIP-150 63/64 gas-forwarding
 * rule even when the outer transaction does not look out of gas. Take the
 * largest valid estimate, add a 20% buffer and keep the result inside sane
 * bounds. Missing/invalid estimates are ignored.
 */
export function bufferedGasLimit(
  estimates: ReadonlyArray<string | null | undefined>,
): string | null {
  let maximum = 0n;
  for (const estimate of estimates) {
    if (typeof estimate !== 'string' || !DECIMAL.test(estimate)) continue;
    const parsed = BigInt(estimate);
    if (parsed > maximum) maximum = parsed;
  }
  if (maximum === 0n) return null;

  const buffer = (maximum * BigInt(GAS_BUFFER_BPS) + 9_999n) / 10_000n;
  const withBuffer = maximum + buffer;
  const bounded = withBuffer < MIN_GAS_LIMIT ? MIN_GAS_LIMIT : withBuffer;
  return (bounded > MAX_GAS_LIMIT ? MAX_GAS_LIMIT : bounded).toString();
}

/**
 * Keep one idempotency key while the submitted payload is unchanged so a lost
 * response can be retried safely. Rotate it as soon as the payload changes so an
 * edited operation is never silently treated as a retry of the previous one.
 */
export function idempotencyForPayload(
  currentKey: string,
  previousSignature: string | null,
  signature: string,
  createKey: () => string = () => crypto.randomUUID(),
): { key: string; signature: string } {
  if (previousSignature === null || previousSignature === signature) {
    return { key: currentKey, signature };
  }

  return { key: createKey(), signature };
}

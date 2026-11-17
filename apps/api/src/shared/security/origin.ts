export type OriginCheck = 'ok' | 'missing' | 'mismatch';

export function checkSameOrigin(input: {
  origin: string | undefined;
  referer: string | undefined;
  expected: string;
  requireOrigin: boolean;
}): OriginCheck {
  let actual: string | undefined;

  if (typeof input.origin === 'string' && input.origin.length > 0) {
    actual = input.origin;
  } else if (typeof input.referer === 'string' && input.referer.length > 0) {
    try {
      actual = new URL(input.referer).origin;
    } catch {
      actual = undefined;
    }
  }

  if (!actual) return input.requireOrigin ? 'missing' : 'ok';
  return actual === input.expected ? 'ok' : 'mismatch';
}

import { describe, expect, it } from 'vitest';
import { checkSameOrigin } from './origin';

const expected = 'https://nexter.example.com';

describe('checkSameOrigin', () => {
  it('accepts the expected origin or referer', () => {
    expect(
      checkSameOrigin({ origin: expected, referer: undefined, expected, requireOrigin: true }),
    ).toBe('ok');
    expect(
      checkSameOrigin({
        origin: undefined,
        referer: `${expected}/portfolio`,
        expected,
        requireOrigin: true,
      }),
    ).toBe('ok');
  });

  it('rejects a mismatched origin', () => {
    expect(
      checkSameOrigin({
        origin: 'https://evil.example.com',
        referer: undefined,
        expected,
        requireOrigin: true,
      }),
    ).toBe('mismatch');
  });

  it('rejects a missing origin only when required', () => {
    expect(
      checkSameOrigin({ origin: undefined, referer: undefined, expected, requireOrigin: true }),
    ).toBe('missing');
    expect(
      checkSameOrigin({ origin: undefined, referer: undefined, expected, requireOrigin: false }),
    ).toBe('ok');
  });
});

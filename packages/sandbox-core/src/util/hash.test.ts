import { describe, expect, it } from 'vitest';
import { sha256Hex, stableStringify } from './hash';

describe('stableStringify', () => {
  it('sorts object keys deterministically', () => {
    expect(stableStringify({ b: 2, a: 1 })).toBe(stableStringify({ a: 1, b: 2 }));
  });

  it('preserves array order', () => {
    expect(stableStringify([2, 1])).not.toBe(stableStringify([1, 2]));
  });

  it('normalizes undefined to null', () => {
    expect(stableStringify({ a: undefined })).toBe('{"a":null}');
  });

  it('produces a 64-character sha256 hex hash', () => {
    expect(sha256Hex('abc')).toMatch(/^[a-f0-9]{64}$/);
  });

  it('matches the published SHA-256 vector for "abc"', () => {
    expect(sha256Hex('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });
});

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
});

import { describe, expect, it } from 'vitest';
import { Reason } from './reason-codes';

describe('Reason', () => {
  it('has a unique value for every code', () => {
    const values = Object.values(Reason);
    expect(values.length).toBeGreaterThan(0);
    expect(new Set(values).size).toBe(values.length);
  });

  it('maps every key to itself', () => {
    for (const [key, value] of Object.entries(Reason)) {
      expect(value).toBe(key);
    }
  });

  it('is frozen', () => {
    expect(Object.isFrozen(Reason)).toBe(true);
  });
});

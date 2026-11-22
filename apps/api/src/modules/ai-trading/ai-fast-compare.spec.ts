import { describe, expect, it } from 'vitest';
import { createComparisons } from './ai-fast-compare';

describe('native comparison ambiguity', () => {
  it('flags exact and near-equal operands', () => {
    const cmp = createComparisons();
    expect(cmp.gt(1, 1)).toBe(false);
    expect(cmp.ambiguous).toBe(true);
  });

  it('flags a relative difference inside the epsilon', () => {
    const cmp = createComparisons();
    expect(cmp.gte(100, 100 * (1 - 1e-12))).toBe(true);
    expect(cmp.ambiguous).toBe(true);
  });

  it('does not flag a clear comparison', () => {
    const cmp = createComparisons();
    expect(cmp.lt(1, 2)).toBe(true);
    expect(cmp.gt(2, 1)).toBe(true);
    expect(cmp.ambiguous).toBe(false);
  });

  it('keeps the comparison result while flagging ambiguity', () => {
    const cmp = createComparisons();
    expect(cmp.lte(5, 5)).toBe(true);
    expect(cmp.lt(5, 5)).toBe(false);
    expect(cmp.ambiguous).toBe(true);
  });
});

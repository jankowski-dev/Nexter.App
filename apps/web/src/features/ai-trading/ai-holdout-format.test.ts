import { describe, expect, it } from 'vitest';
import {
  holdoutActiveLabel,
  holdoutBlockSummary,
  holdoutConsistencyLabel,
} from './ai-holdout-format';

describe('holdout formatting', () => {
  it('formats block consistency and returns', () => {
    expect(holdoutConsistencyLabel(3, 3)).toBe('3/3');
    expect(holdoutConsistencyLabel(2, 3)).toBe('2/3');
    expect(holdoutConsistencyLabel(0, 0)).toBe('—');
    expect(holdoutActiveLabel(2, 3)).toBe('2/3');
    expect(holdoutActiveLabel(0, 0)).toBe('—');
    expect(holdoutBlockSummary(['1.20', '-0.50', '0.00'])).toBe('+1.20% / -0.50% / 0.00%');
    expect(holdoutBlockSummary([])).toBe('—');
  });
});

import { describe, expect, it } from 'vitest';
import { formatPrice } from './format';

describe('formatPrice', () => {
  it('keeps small token prices visible', () => {
    expect(formatPrice('0.000083')).toBe('0,000083');
    expect(formatPrice('0.000000123')).toBe('0,000000123');
  });

  it('rounds normal prices to a readable precision', () => {
    expect(formatPrice('0.6788')).toBe('0,679');
    expect(formatPrice('1.234')).toBe('1,23');
  });

  it('handles empty and invalid values', () => {
    expect(formatPrice(null)).toBe('—');
    expect(formatPrice('')).toBe('—');
    expect(formatPrice('not-a-number')).toBe('—');
  });
});

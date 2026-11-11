import { describe, expect, it } from 'vitest';
import { formatPrice, formatRelativeTime } from './format';

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

describe('formatRelativeTime', () => {
  it('describes recent and older timestamps', () => {
    const now = new Date();
    expect(formatRelativeTime(new Date(now.getTime() - 5_000).toISOString())).toBe('только что');
    expect(formatRelativeTime(new Date(now.getTime() - 20_000).toISOString())).toBe('20 с назад');
    expect(formatRelativeTime(new Date(now.getTime() - 3 * 60_000).toISOString())).toBe(
      '3 мин назад',
    );
    expect(formatRelativeTime(new Date(now.getTime() - 2 * 3_600_000).toISOString())).toBe(
      '2 ч назад',
    );
  });

  it('handles empty and invalid values', () => {
    expect(formatRelativeTime(null)).toBe('—');
    expect(formatRelativeTime('not-a-date')).toBe('—');
  });
});

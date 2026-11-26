import { describe, expect, it } from 'vitest';
import { dateKey, monthMatrix, parseDateKey } from './date-picker';

describe('date picker helpers', () => {
  it('builds a Monday-first month matrix', () => {
    const weeks = monthMatrix(2026, 1); // February 2026 starts on Sunday
    expect(weeks[0]?.slice(0, 6)).toEqual([null, null, null, null, null, null]);
    expect(weeks[0]?.[6]).toBe(1);
    expect(weeks.at(-1)?.some((day) => day === 28)).toBe(true);
    expect(weeks.flat().filter(Boolean)).toHaveLength(28);
  });

  it('round-trips date keys without UTC drift', () => {
    const date = parseDateKey('2026-11-27');
    expect(date).not.toBeNull();
    expect(dateKey(date!.getFullYear(), date!.getMonth(), date!.getDate())).toBe('2026-11-27');
    expect(parseDateKey('bad')).toBeNull();
  });
});

import { describe, expect, it } from 'vitest';
import { emaSeries, rsiSeries } from './series';

describe('emaSeries', () => {
  it('matches a simple average on a constant series', () => {
    expect(emaSeries([100, 100, 100, 100, 100], 3)).toEqual([null, null, 100, 100, 100]);
  });

  it('returns nulls when the window is not filled', () => {
    expect(emaSeries([100, 101], 5)).toEqual([null, null]);
    expect(emaSeries([], 5)).toEqual([]);
  });
});

describe('rsiSeries', () => {
  it('is 100 on a strictly rising series', () => {
    const values = rsiSeries([1, 2, 3, 4, 5, 6], 3);
    expect(values.slice(0, 3)).toEqual([null, null, null]);
    expect(values[3]).toBe(100);
    expect(values[5]).toBe(100);
  });

  it('is 0 on a strictly falling series', () => {
    const values = rsiSeries([6, 5, 4, 3, 2, 1], 3);
    expect(values[3]).toBe(0);
    expect(values[5]).toBe(0);
  });

  it('returns nulls for short input', () => {
    expect(rsiSeries([1, 2], 14)).toEqual([null, null]);
  });
});

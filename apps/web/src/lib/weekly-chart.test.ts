import { describe, expect, it } from 'vitest';
import { sampleWeeklyPoints } from './weekly-chart';

function points(count: number): Array<{ date: string; priceUsd: string }> {
  return Array.from({ length: count }, (_, index) => ({
    date: `2026-${String(Math.floor(index / 28) + 1).padStart(2, '0')}-${String(
      (index % 28) + 1,
    ).padStart(2, '0')}`,
    priceUsd: String(index + 1),
  }));
}

describe('sampleWeeklyPoints', () => {
  it('samples twelve weekly points and keeps the first and last point', () => {
    const source = points(90);
    const sampled = sampleWeeklyPoints(source);

    expect(sampled).toHaveLength(12);
    expect(sampled[0]).toEqual(source[0]);
    expect(sampled.at(-1)).toEqual(source.at(-1));
  });

  it('keeps all points when there are fewer than the requested count', () => {
    const source = points(5);
    expect(sampleWeeklyPoints(source)).toHaveLength(5);
  });

  it('sorts by date before sampling', () => {
    const source = points(30).reverse();
    const sampled = sampleWeeklyPoints(source);

    expect(sampled[0]?.date).toBe(source.at(-1)?.date);
    expect(sampled.at(-1)?.date).toBe(source[0]?.date);
  });
});

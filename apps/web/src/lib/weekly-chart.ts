export interface DatedPoint {
  date: string;
}

/**
 * The chart API returns daily points. The trading main list only needs a
 * compact three-month view, so sample twelve evenly spaced weekly points
 * while always keeping the first and last point.
 */
export function sampleWeeklyPoints<T extends DatedPoint>(points: readonly T[], count = 12): T[] {
  if (count <= 0 || points.length === 0) return [];

  const sorted = [...points].sort((left, right) => left.date.localeCompare(right.date));

  if (sorted.length <= count) return sorted;

  const result: T[] = [];
  const last = sorted.length - 1;

  for (let index = 0; index < count; index += 1) {
    const point = sorted[Math.round((index * last) / (count - 1))];
    if (point) result.push(point);
  }

  return result;
}

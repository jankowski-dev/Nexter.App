import { describe, expect, it } from 'vitest';
import type { EquityCurvePoint } from '@nexter/contracts';
import { shouldNotifyClosedGroups } from './ledger.service';
import { groupMonthlyEquityPoints, hourlyEquityNote } from './reporting.service';

function point(date: string, equityUsd: string): EquityCurvePoint {
  return {
    date,
    cashUsd: '0',
    positionsValueUsd: equityUsd,
    equityUsd,
  };
}

describe('groupMonthlyEquityPoints', () => {
  it('keeps the last snapshot of each month in chronological order', () => {
    const points = groupMonthlyEquityPoints([
      point('2026-10-02T12:00:00.000Z', '100'),
      point('2026-10-28T12:00:00.000Z', '120'),
      point('2026-11-05T12:00:00.000Z', '130'),
      point('2026-11-20T12:00:00.000Z', '150'),
    ]);

    expect(points.map((item) => item.equityUsd)).toEqual(['120', '150']);
    expect(points[0]?.date).toBe('2026-10-28T12:00:00.000Z');
    expect(points[1]?.date).toBe('2026-11-20T12:00:00.000Z');
  });

  it('returns an empty array for no points', () => {
    expect(groupMonthlyEquityPoints([])).toEqual([]);
  });

  it('describes the first collected hour without claiming a rolling window start', () => {
    const note = hourlyEquityNote(new Date('2026-11-25T08:00:00.000Z'));
    expect(note).toContain('Почасовые точки собираются с 2026-11-25T08:00:00.000Z');
    expect(note).toContain('показаны последние 24 часа');
    expect(hourlyEquityNote(null)).toContain('ещё не собраны');
  });
});

describe('shouldNotifyClosedGroups', () => {
  it('skips notifications for an idempotent replay and for empty groups', () => {
    expect(shouldNotifyClosedGroups(false, ['group-1'])).toBe(true);
    expect(shouldNotifyClosedGroups(true, ['group-1'])).toBe(false);
    expect(shouldNotifyClosedGroups(false, [])).toBe(false);
  });
});

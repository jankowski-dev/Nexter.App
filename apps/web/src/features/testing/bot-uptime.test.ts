import { describe, expect, it } from 'vitest';
import { formatUptime } from './bot-uptime';

const start = new Date('2026-01-01T00:00:00.000Z');

describe('formatUptime', () => {
  it('uses explicit Russian units', () => {
    expect(formatUptime(start.toISOString(), start.getTime() + 7_000)).toBe('7 с');
    expect(formatUptime(start.toISOString(), start.getTime() + 5 * 60_000 + 7_000)).toBe(
      '5 мин 7 с',
    );
    expect(formatUptime(start.toISOString(), start.getTime() + 3_600_000 + 11 * 60_000)).toBe(
      '1 ч 11 мин',
    );
    expect(
      formatUptime(start.toISOString(), start.getTime() + 2 * 86_400_000 + 3_600_000 + 11 * 60_000),
    ).toBe('2 д 1 ч 11 мин');
  });

  it('handles a missing start', () => {
    expect(formatUptime(null, Date.now())).toBe('—');
  });
});

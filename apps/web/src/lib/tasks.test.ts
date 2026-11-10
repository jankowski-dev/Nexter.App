import { describe, expect, it } from 'vitest';
import { isTaskOverdue, localDateKey } from './tasks';

describe('task overdue rules', () => {
  const today = new Date(2026, 10, 10, 23, 59);
  const todayNoon = new Date(2026, 10, 10, 12, 0).toISOString();
  const yesterdayNoon = new Date(2026, 10, 9, 12, 0).toISOString();

  it('does not mark a task due today as overdue in the evening', () => {
    expect(isTaskOverdue({ status: 'open', dueAt: todayNoon }, today)).toBe(false);
  });

  it('marks an open task from a previous local date as overdue', () => {
    expect(isTaskOverdue({ status: 'open', dueAt: yesterdayNoon }, today)).toBe(true);
  });

  it('does not mark completed, cancelled, or unscheduled tasks as overdue', () => {
    expect(isTaskOverdue({ status: 'done', dueAt: yesterdayNoon }, today)).toBe(false);
    expect(isTaskOverdue({ status: 'cancelled', dueAt: yesterdayNoon }, today)).toBe(false);
    expect(isTaskOverdue({ status: 'open', dueAt: null }, today)).toBe(false);
  });

  it('uses local calendar dates', () => {
    expect(localDateKey(today)).toBe('2026-11-10');
    expect(localDateKey(todayNoon)).toBe('2026-11-10');
  });
});

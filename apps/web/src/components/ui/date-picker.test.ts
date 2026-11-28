import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  DatePicker,
  MonthPicker,
  dateKey,
  monthKey,
  monthMatrix,
  parseDateKey,
  parseMonthKey,
} from './date-picker';

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

describe('month picker helpers', () => {
  it('formats a month key with a padded month number', () => {
    expect(monthKey(2026, 0)).toBe('2026-01');
    expect(monthKey(2026, 11)).toBe('2026-12');
  });

  it('parses valid month keys and rejects invalid ones', () => {
    expect(parseMonthKey('2026-11')?.getFullYear()).toBe(2026);
    expect(parseMonthKey('2026-11')?.getMonth()).toBe(10);
    expect(parseMonthKey('2026-13')).toBeNull();
    expect(parseMonthKey('2026-1')).toBeNull();
    expect(parseMonthKey('')).toBeNull();
  });

  it('exposes the selected value in the trigger accessible name', () => {
    const month = renderToStaticMarkup(
      createElement(MonthPicker, {
        value: '2026-11',
        onChange: () => undefined,
        label: 'Месяц периода',
        clearable: false,
      }),
    );
    const date = renderToStaticMarkup(
      createElement(DatePicker, {
        value: '2026-11-27',
        onChange: () => undefined,
        label: 'Дата',
      }),
    );

    expect(month).toContain('aria-label="Месяц периода: Ноябрь 2026');
    expect(month).not.toContain('Очистить');
    expect(date).toContain('aria-label="Дата: 27.11.2026');
  });
});

import { describe, expect, it } from 'vitest';
import type { FinanceCategoryTotal, FinanceMonthTotal } from '@nexter/contracts';
import { buildCategorySections, formatShare, summarizeMonths } from './finance-view-model';

function category(
  overrides: Partial<FinanceCategoryTotal> &
    Pick<FinanceCategoryTotal, 'name' | 'kind' | 'amountBase'>,
): FinanceCategoryTotal {
  return {
    categoryId: null,
    count: 1,
    ...overrides,
  };
}

function month(monthKey: string, incomeBase: string, expenseBase: string): FinanceMonthTotal {
  return {
    month: monthKey,
    incomeBase,
    expenseBase,
    netBase: String(Number(incomeBase) - Number(expenseBase)),
    incomeCount: 0,
    expenseCount: 0,
  };
}

describe('buildCategorySections', () => {
  it('splits income and expenses and computes shares inside each section', () => {
    const sections = buildCategorySections([
      category({ name: 'Продукты', kind: 'expense', amountBase: '60.00' }),
      category({ name: 'Транспорт', kind: 'expense', amountBase: '40.00' }),
      category({ name: 'Зарплата', kind: 'income', amountBase: '250.00' }),
    ]);

    expect(sections.map((section) => section.label)).toEqual(['Расходы', 'Доходы']);
    expect(sections[0]?.totalBase).toBe('100.00');
    expect(sections[0]?.slices.map((slice) => slice.name)).toEqual(['Продукты', 'Транспорт']);
    expect(sections[0]?.slices[0]?.percent).toBeCloseTo(60);
    expect(sections[0]?.slices[1]?.percent).toBeCloseTo(40);
    expect(sections[0]?.slices.reduce((sum, slice) => sum + slice.percent, 0)).toBeCloseTo(100);
    expect(sections[1]?.slices[0]?.percent).toBeCloseTo(100);
  });

  it('treats transfer categories as expenses to match the summary table', () => {
    const sections = buildCategorySections([
      category({ name: 'Перевод', kind: 'transfer', amountBase: '15.00' }),
    ]);

    expect(sections).toHaveLength(1);
    expect(sections[0]?.kind).toBe('expense');
    expect(sections[0]?.slices[0]?.name).toBe('Перевод');
  });

  it('returns an empty list when the period has no categories', () => {
    expect(buildCategorySections([])).toEqual([]);
  });
});

describe('summarizeMonths', () => {
  it('sums income and expenses and derives the net flow', () => {
    const totals = summarizeMonths([
      month('2026-10', '100.00', '40.00'),
      month('2026-11', '50.00', '60.00'),
    ]);

    expect(totals).toEqual({
      incomeBase: '150.00',
      expenseBase: '100.00',
      netBase: '50.00',
    });
  });

  it('returns zero totals for an empty range', () => {
    expect(summarizeMonths([])).toEqual({
      incomeBase: '0.00',
      expenseBase: '0.00',
      netBase: '0.00',
    });
  });
});

describe('formatShare', () => {
  it('keeps one decimal for small shares and rounds larger ones', () => {
    expect(formatShare(4.26)).toBe('4.3%');
    expect(formatShare(42.6)).toBe('43%');
    expect(formatShare(0)).toBe('0%');
  });
});

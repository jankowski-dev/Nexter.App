import { describe, expect, it } from 'vitest';
import type { FinanceCategory } from '@nexter/contracts';
import { filterFinanceCategories } from './finance-category-picker';

function category(id: string, name: string): FinanceCategory {
  return {
    id,
    name,
    kind: 'expense',
    color: null,
    icon: null,
    sortOrder: 0,
    archivedAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

const categories = [
  category('1', 'Продукты'),
  category('2', 'Транспорт'),
  category('3', 'Кафе и рестораны'),
];

describe('filterFinanceCategories', () => {
  it('filters by each typed character and ignores case', () => {
    expect(filterFinanceCategories(categories, 'прод').map((row) => row.name)).toEqual([
      'Продукты',
    ]);
    expect(filterFinanceCategories(categories, 'ПРО').map((row) => row.name)).toEqual(['Продукты']);
  });

  it('matches multiple words and compares ё with е', () => {
    expect(filterFinanceCategories(categories, 'кафе рест').map((row) => row.name)).toEqual([
      'Кафе и рестораны',
    ]);
    expect(filterFinanceCategories(categories, 'кафе').map((row) => row.name)).toEqual([
      'Кафе и рестораны',
    ]);
    expect(filterFinanceCategories([category('4', 'Ёлки')], 'елки').map((row) => row.name)).toEqual(
      ['Ёлки'],
    );
  });

  it('returns everything for an empty query', () => {
    expect(filterFinanceCategories(categories, '')).toHaveLength(3);
  });
});

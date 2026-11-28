import type {
  FinanceAccountKind,
  FinanceCategoryTotal,
  FinanceCurrency,
  FinanceMonthTotal,
  FinanceTransferKind,
} from '@nexter/contracts';
import { Decimal } from 'decimal.js';

export const accountKindLabels: Record<FinanceAccountKind, string> = {
  cash: 'Наличные',
  card: 'Карта',
  bank: 'Банк',
  savings: 'Накопления',
  investment: 'Инвестиции',
  credit: 'Кредит',
};

export const transferKindLabels: Record<FinanceTransferKind, string> = {
  exchange: 'Обмен валют',
  card_topup: 'Пополнение карты',
  credit: 'Кредит / погашение',
  other: 'Другое',
};

export function financeMoney(
  value: string | number | null | undefined,
  currency: FinanceCurrency | 'BYN',
): string {
  if (value === null || value === undefined || value === '') return '—';
  const number = Number(value);
  if (!Number.isFinite(number)) return '—';
  return new Intl.NumberFormat('ru-RU', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(number);
}

export function monthLabel(month: string): string {
  const value = new Intl.DateTimeFormat('ru-RU', { month: 'long', year: 'numeric' }).format(
    new Date(`${month}-01T12:00:00`),
  );
  return value.charAt(0).toUpperCase() + value.slice(1);
}

export function monthShortLabel(month: string): string {
  return new Intl.DateTimeFormat('ru-RU', { month: 'short' })
    .format(new Date(`${month}-01T12:00:00`))
    .replace(/\.$/, '');
}

export type FinanceCategorySectionKind = 'expense' | 'income';

export interface FinanceCategorySlice {
  key: string;
  categoryId: string | null;
  name: string;
  kind: FinanceCategorySectionKind;
  amountBase: string;
  count: number;
  percent: number;
}

export interface FinanceCategorySection {
  kind: FinanceCategorySectionKind;
  label: string;
  totalBase: string;
  slices: FinanceCategorySlice[];
}

/**
 * The summary API mixes income and expense categories in one amount-sorted
 * list. Split them into sections and compute the share inside each section so
 * the donut and the legend show meaningful parts of the same total.
 */
export function buildCategorySections(
  categories: readonly FinanceCategoryTotal[],
): FinanceCategorySection[] {
  const grouped: Record<FinanceCategorySectionKind, FinanceCategoryTotal[]> = {
    expense: [],
    income: [],
  };

  for (const category of categories) {
    const kind: FinanceCategorySectionKind = category.kind === 'income' ? 'income' : 'expense';
    grouped[kind].push(category);
  }

  const sections: FinanceCategorySection[] = [];

  for (const kind of ['expense', 'income'] as const) {
    const rows = grouped[kind];
    if (rows.length === 0) continue;

    const total = rows.reduce((sum, row) => sum.plus(row.amountBase), new Decimal(0));
    const slices = [...rows]
      .sort((left, right) => new Decimal(right.amountBase).comparedTo(left.amountBase))
      .map((row) => ({
        key: `${kind}:${row.categoryId ?? row.name}`,
        categoryId: row.categoryId,
        name: row.name,
        kind,
        amountBase: row.amountBase,
        count: row.count,
        percent: total.isZero() ? 0 : new Decimal(row.amountBase).div(total).mul(100).toNumber(),
      }));

    sections.push({
      kind,
      label: kind === 'expense' ? 'Расходы' : 'Доходы',
      totalBase: total.toFixed(2),
      slices,
    });
  }

  return sections;
}

export interface FinanceMonthlySummary {
  incomeBase: string;
  expenseBase: string;
  netBase: string;
}

/** Trim database-padded zeros without changing the stored rate value. */
export function rateInputValue(value: string | null | undefined): string {
  if (!value) return '';
  return value.includes('.') ? value.replace(/0+$/, '').replace(/\.$/, '') : value;
}

export function usdEquivalent(
  valueBase: string | null | undefined,
  usdRate: string | null | undefined,
): string | null {
  if (valueBase === null || valueBase === undefined || valueBase === '') return null;
  if (usdRate === null || usdRate === undefined || usdRate === '') return null;
  const rate = new Decimal(usdRate);
  if (rate.lte(0)) return null;
  return new Decimal(valueBase).div(rate).toFixed(2);
}

export function summarizeMonths(months: readonly FinanceMonthTotal[]): FinanceMonthlySummary {
  let income = new Decimal(0);
  let expense = new Decimal(0);

  for (const month of months) {
    income = income.plus(month.incomeBase);
    expense = expense.plus(month.expenseBase);
  }

  return {
    incomeBase: income.toFixed(2),
    expenseBase: expense.toFixed(2),
    netBase: income.minus(expense).toFixed(2),
  };
}

export function formatShare(percent: number): string {
  if (!Number.isFinite(percent) || percent <= 0) return '0%';
  return percent >= 10 ? `${percent.toFixed(0)}%` : `${percent.toFixed(1)}%`;
}

export function hasMonthlyMovement(months: readonly FinanceMonthTotal[]): boolean {
  return months.some(
    (month) => new Decimal(month.incomeBase).gt(0) || new Decimal(month.expenseBase).gt(0),
  );
}

import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type {
  FinanceAccountWithBalance,
  FinanceCategoryTotal,
  FinanceMonthTotal,
} from '@nexter/contracts';
import {
  FinanceAccountsBlock,
  FinanceCategoriesBlock,
  FinanceMonthsBlock,
} from './finance-visuals';

const account: FinanceAccountWithBalance = {
  id: 'account-1',
  name: 'Основная карта',
  kind: 'card',
  currency: 'BYN',
  openingBalance: '0.00',
  openingDate: '2026-01-01',
  fxRate: '1',
  creditLimit: null,
  sortOrder: 0,
  archivedAt: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  balance: '100.00',
  balanceBase: '100.00',
};

const categories: FinanceCategoryTotal[] = [
  {
    categoryId: 'category-1',
    name: 'Продукты',
    kind: 'expense',
    amountBase: '60.00',
    count: 3,
  },
  {
    categoryId: 'category-2',
    name: 'Транспорт',
    kind: 'expense',
    amountBase: '40.00',
    count: 2,
  },
];

const month: FinanceMonthTotal = {
  month: '2026-11',
  incomeBase: '100.00',
  expenseBase: '40.00',
  netBase: '60.00',
  incomeCount: 1,
  expenseCount: 1,
};

describe('finance overview visuals', () => {
  it('renders account cards with balances and a total', () => {
    const html = renderToStaticMarkup(
      <FinanceAccountsBlock
        accounts={[account]}
        assetsBase="100.00"
        liabilitiesBase="0.00"
        netWorthBase="100.00"
        onManage={() => undefined}
      />,
    );

    expect(html).toContain('Основная карта');
    expect(html).toContain('Карта · BYN');
    expect(html).toContain('Итого по счетам');
    expect(html).not.toContain('Чистый капитал');
  });

  it('shows only the top ten expense categories', () => {
    const many = Array.from({ length: 12 }, (_, index) => ({
      categoryId: `category-${index + 1}`,
      name: `Категория ${index + 1}`,
      kind: 'expense' as const,
      amountBase: String(120 - index * 10),
      count: 1,
    }));
    const html = renderToStaticMarkup(
      <FinanceCategoriesBlock
        categories={many}
        colorById={new Map()}
        periodLabel="Ноябрь 2026"
        onAddExpense={() => undefined}
      />,
    );

    expect(html).toContain('Категория 10');
    expect(html).not.toContain('Категория 11');
    expect(html).not.toContain('Категория 12');
    expect(html).toContain('10 из 12');
  });

  it('renders category shares and the empty state', () => {
    const html = renderToStaticMarkup(
      <FinanceCategoriesBlock
        categories={categories}
        colorById={new Map()}
        periodLabel="Ноябрь 2026"
        onAddExpense={() => undefined}
      />,
    );
    const emptyHtml = renderToStaticMarkup(
      <FinanceCategoriesBlock
        categories={[]}
        colorById={new Map()}
        periodLabel="Ноябрь 2026"
        onAddExpense={() => undefined}
      />,
    );

    expect(html).toContain('Продукты');
    expect(html).toContain('60%');
    expect(html).toContain('Расходы');
    expect(emptyHtml).toContain('За период нет расходов');
  });

  it('does not claim there are no categories when only income exists', () => {
    const html = renderToStaticMarkup(
      <FinanceCategoriesBlock
        categories={[
          {
            categoryId: 'income-1',
            name: 'Зарплата',
            kind: 'income',
            amountBase: '100.00',
            count: 1,
          },
        ]}
        colorById={new Map()}
        periodLabel="Ноябрь 2026"
        onAddExpense={() => undefined}
      />,
    );

    expect(html).toContain('За период нет расходов');
    expect(html).not.toContain('Зарплата');
    expect(html).not.toContain('За период пока нет категорий');
  });

  it('renders the monthly chart, totals, USD equivalents and the month table', () => {
    const html = renderToStaticMarkup(<FinanceMonthsBlock months={[month]} usdRate="2.00" />);

    expect(html).toContain('Последние 12 месяцев');
    expect(html).toContain('Доходы');
    expect(html).toContain('Сальдо');
    expect(html).toContain('ноя');
    expect(html).toContain('<table');
    expect(html).toContain('Месяц');
    expect(html).not.toMatch(/<th[^>]*>Сальдо/);
    expect(html).toContain('≈');
    expect(html).toContain('50,00');
    expect(html).toContain('30,00');
  });

  it('shows the last six months on the chart while keeping the 12-month table', () => {
    const months = Array.from({ length: 12 }, (_, index) => {
      const month = String(index + 1).padStart(2, '0');
      return {
        month: `2026-${month}`,
        incomeBase: '100.00',
        expenseBase: '40.00',
        netBase: '60.00',
        incomeCount: 1,
        expenseCount: 1,
      } satisfies FinanceMonthTotal;
    });
    const html = renderToStaticMarkup(<FinanceMonthsBlock months={months} />);
    const chartLabels = html.match(/aria-label="[^"]*: доходы/g) ?? [];

    expect(chartLabels).toHaveLength(6);
    expect(html.match(/<tr/g)?.length).toBe(13);
  });
});

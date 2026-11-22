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
    expect(html).toContain('Чистый капитал');
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
    expect(emptyHtml).toContain('За период пока нет категорий');
  });

  it('renders the monthly chart and its totals', () => {
    const html = renderToStaticMarkup(<FinanceMonthsBlock months={[month]} />);

    expect(html).toContain('Последние 12 месяцев');
    expect(html).toContain('Доходы');
    expect(html).toContain('Сальдо');
    expect(html).toContain('ноя');
  });
});

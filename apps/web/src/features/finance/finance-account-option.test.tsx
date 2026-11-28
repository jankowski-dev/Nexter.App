import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { FinanceAccountOption } from './finance-account-option';

describe('FinanceAccountOption', () => {
  it('uses a green badge for a positive balance', () => {
    const html = renderToStaticMarkup(
      <FinanceAccountOption account={{ name: 'Карта', currency: 'BYN', balance: '17.00' }} />,
    );

    expect(html).toContain('Карта');
    expect(html).toContain('17,00');
    expect(html).toContain('bg-emerald-50');
    expect(html).toContain('text-emerald-700');
  });

  it('uses a grey badge for a zero balance', () => {
    const html = renderToStaticMarkup(
      <FinanceAccountOption account={{ name: 'Евро', currency: 'EUR', balance: '0.00' }} />,
    );

    expect(html).toContain('bg-zinc-100');
    expect(html).toContain('text-zinc-600');
  });

  it('uses a red badge for a negative balance', () => {
    const html = renderToStaticMarkup(
      <FinanceAccountOption
        account={{ name: 'Кредитный', currency: 'BYN', balance: '-1117.67' }}
      />,
    );

    expect(html).toContain('bg-rose-50');
    expect(html).toContain('text-rose-700');
  });
});

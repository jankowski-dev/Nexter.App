import { describe, expect, it } from 'vitest';
import { accountOptionLabel, resolveOperationTitle } from './finance-operation';

describe('accountOptionLabel', () => {
  it('shows the account name with its current balance', () => {
    const label = accountOptionLabel({ name: 'Карта', currency: 'BYN', balance: '17.00' });

    expect(label).toContain('Карта ·');
    expect(label).toContain('17,00');
    expect(label).toContain('BYN');
  });
});

describe('resolveOperationTitle', () => {
  it('prefers a non-empty title', () => {
    expect(resolveOperationTitle(' Метро ', 'Транспорт', 'expense')).toBe('Метро');
  });

  it('falls back to the category and then to the kind label', () => {
    expect(resolveOperationTitle('', 'Продукты', 'expense')).toBe('Продукты');
    expect(resolveOperationTitle('   ', '', 'expense')).toBe('Расход');
    expect(resolveOperationTitle('', '', 'income')).toBe('Доход');
  });
});

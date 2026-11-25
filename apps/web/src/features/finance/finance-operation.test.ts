import { describe, expect, it } from 'vitest';
import { resolveOperationTitle } from './finance-operation';

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

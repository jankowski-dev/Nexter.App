import type { BotStrategyParamField } from '@nexter/contracts';
import { describe, expect, it } from 'vitest';
import { formatStrategyParamValue, formToParams, paramsToForm } from './strategy-params';

const fields: BotStrategyParamField[] = [
  { key: 'lookbackDays', label: 'Полных дней', min: 5, max: 60, integer: true },
  { key: 'useMedian', label: 'Медиана вместо среднего', type: 'boolean' },
];

describe('strategy params form helpers', () => {
  it('round-trips numeric and boolean fields', () => {
    const form = paramsToForm({ lookbackDays: 20, useMedian: false });
    expect(form).toEqual({ lookbackDays: '20', useMedian: 'false' });
    expect(formToParams(fields, form)).toEqual({ lookbackDays: 20, useMedian: false });
    expect(formToParams(fields, { ...form, useMedian: 'true' })).toEqual({
      lookbackDays: 20,
      useMedian: true,
    });
  });

  it('rejects invalid numbers and boolean values', () => {
    expect(() => formToParams(fields, { lookbackDays: '4', useMedian: 'false' })).toThrow(
      'не может быть меньше 5',
    );
    expect(() => formToParams(fields, { useMedian: 'maybe' })).toThrow('«Да» или «Нет»');
  });

  it('formats boolean values in Russian', () => {
    expect(formatStrategyParamValue(fields[1] as BotStrategyParamField, true)).toBe('Да');
    expect(formatStrategyParamValue(fields[1] as BotStrategyParamField, false)).toBe('Нет');
    expect(formatStrategyParamValue(fields[0] as BotStrategyParamField, 20)).toBe('20');
  });
});

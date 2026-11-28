import { describe, expect, it } from 'vitest';
import {
  financeAccountCreateRequestSchema,
  financeCurrencySchema,
  financeFxRateUpdateRequestSchema,
  financeFxRatesResponseSchema,
} from './finance';

describe('finance FX rates contracts', () => {
  it('accepts CNY as a finance currency', () => {
    expect(financeCurrencySchema.parse('CNY')).toBe('CNY');
    expect(
      financeAccountCreateRequestSchema.parse({
        name: 'Юани',
        kind: 'cash',
        currency: 'CNY',
        openingDate: '2026-11-28',
        fxRate: '0.41',
      }).currency,
    ).toBe('CNY');
  });

  it('validates a manual rate and a rates response', () => {
    expect(() => financeFxRateUpdateRequestSchema.parse({ rate: '0' })).toThrow();
    expect(financeFxRateUpdateRequestSchema.parse({ rate: '2.965' }).rate).toBe('2.965');
    expect(
      financeFxRatesResponseSchema.parse({
        stale: false,
        rates: [
          {
            currency: 'USD',
            rate: '2.96500000',
            source: 'nbrb',
            rateDate: '2026-11-28',
            fetchedAt: '2026-11-28T08:00:00.000Z',
            updatedAt: '2026-11-28T08:00:00.000Z',
          },
        ],
      }).rates[0]?.source,
    ).toBe('nbrb');
  });
});

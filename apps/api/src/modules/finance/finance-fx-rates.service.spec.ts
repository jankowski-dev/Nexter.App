import { describe, expect, it } from 'vitest';
import { parseNbrbRates } from './finance-fx-rates.service';

const payload = [
  {
    Cur_Abbreviation: 'USD',
    Cur_Scale: 1,
    Cur_OfficialRate: 2.965,
    Date: '2026-11-28T00:00:00',
  },
  {
    Cur_Abbreviation: 'EUR',
    Cur_Scale: 1,
    Cur_OfficialRate: 3.42,
    Date: '2026-11-28T00:00:00',
  },
  {
    Cur_Abbreviation: 'CNY',
    Cur_Scale: 10,
    Cur_OfficialRate: 4.1,
    Date: '2026-11-28T00:00:00',
  },
  {
    Cur_Abbreviation: 'RUB',
    Cur_Scale: 100,
    Cur_OfficialRate: 3.5,
    Date: '2026-11-28T00:00:00',
  },
];

describe('parseNbrbRates', () => {
  it('returns BYN per unit in USD, EUR, CNY order', () => {
    expect(parseNbrbRates(payload)).toEqual([
      { currency: 'USD', rate: '2.96500000', rateDate: '2026-11-28' },
      { currency: 'EUR', rate: '3.42000000', rateDate: '2026-11-28' },
      { currency: 'CNY', rate: '0.41000000', rateDate: '2026-11-28' },
    ]);
  });

  it('rejects a response missing a required currency', () => {
    expect(() => parseNbrbRates(payload.filter((row) => row.Cur_Abbreviation !== 'CNY'))).toThrow(
      /CNY/,
    );
  });

  it('rejects a non-array or non-positive rate', () => {
    expect(() => parseNbrbRates({})).toThrow(/unexpected/);
    expect(() =>
      parseNbrbRates([
        ...payload.filter((row) => row.Cur_Abbreviation !== 'USD'),
        {
          Cur_Abbreviation: 'USD',
          Cur_Scale: 1,
          Cur_OfficialRate: 0,
          Date: '2026-11-28T00:00:00',
        },
      ]),
    ).toThrow(/USD/);
  });
});

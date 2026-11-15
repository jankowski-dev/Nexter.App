import { describe, expect, it } from 'vitest';
import { ApiError } from './api';
import { ClientValidationError, toRussianError } from './error-messages';

describe('toRussianError', () => {
  it('keeps a client validation message', () => {
    expect(
      toRussianError(
        new ClientValidationError('Нельзя продать больше остатка: 100 BASED.'),
        'Не удалось сохранить сделку',
      ),
    ).toBe('Нельзя продать больше остатка: 100 BASED.');
  });

  it('maps an API trade code to the Russian message', () => {
    expect(
      toRussianError(
        new ApiError('TRADE_AMOUNT_EXCEEDS_REMAINING', 'Sell amount exceeds remaining'),
        'Не удалось сохранить сделку',
      ),
    ).toBe('Сумма больше остатка по ордеру.');
  });

  it('falls back for an unknown error', () => {
    expect(toRussianError(new Error('boom'), 'Не удалось сохранить сделку')).toBe(
      'Не удалось сохранить сделку',
    );
  });
});

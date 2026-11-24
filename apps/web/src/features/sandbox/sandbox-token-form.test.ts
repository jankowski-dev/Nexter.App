import { describe, expect, it } from 'vitest';
import {
  sandboxTokenCreatePayload,
  sandboxTokenFormDefaults,
  sandboxTokenKeyFromForm,
  validateSandboxTokenForm,
} from './sandbox-token-form';

function validForm() {
  return {
    ...sandboxTokenFormDefaults(),
    tokenKey: 'BSC:0xAbCdEf1111111111111111111111111111111111',
    symbol: 'AAA',
    name: 'Alpha',
  };
}

describe('sandbox token form', () => {
  it('normalizes a direct provider key', () => {
    expect(sandboxTokenKeyFromForm(validForm())).toBe(
      'bsc:0xabcdef1111111111111111111111111111111111',
    );
    expect(sandboxTokenKeyFromForm({ ...validForm(), tokenKey: 'binance:btcusdt' })).toBe(
      'binance:BTCUSDT',
    );
  });

  it('builds the key from chain and address/pair', () => {
    expect(
      sandboxTokenKeyFromForm({
        ...validForm(),
        mode: 'chain',
        chain: 'ethereum',
        identifier: '0x1111111111111111111111111111111111111111',
      }),
    ).toBe('ethereum:0x1111111111111111111111111111111111111111');
    expect(
      sandboxTokenKeyFromForm({
        ...validForm(),
        mode: 'chain',
        chain: 'binance',
        identifier: 'ethusdt',
      }),
    ).toBe('binance:ETHUSDT');
  });

  it('rejects an unsupported key or empty identifier', () => {
    expect(validateSandboxTokenForm({ ...validForm(), tokenKey: 'solana:0x1234' })).toContain(
      'Укажите ключ вида bsc:0x…, ethereum:0x… или binance:BTCUSDT, либо выберите сеть и адрес/пару.',
    );
    expect(
      sandboxTokenKeyFromForm({ ...validForm(), mode: 'chain', identifier: '   ' }),
    ).toBeNull();
  });

  it('requires symbol and name and validates the optional CoinGecko id', () => {
    expect(validateSandboxTokenForm({ ...validForm(), symbol: '', name: '' })).toEqual([
      'Укажите символ токена.',
      'Укажите название токена.',
    ]);
    expect(validateSandboxTokenForm({ ...validForm(), coingeckoId: 'Bad Id' })).toContain(
      'CoinGecko id: строчные латинские буквы, цифры и дефис.',
    );
    expect(validateSandboxTokenForm({ ...validForm(), coingeckoId: 'alpha-token' })).toEqual([]);
  });

  it('builds the create payload with the canonical key', () => {
    expect(sandboxTokenCreatePayload({ ...validForm(), coingeckoId: '', enabled: true })).toEqual({
      tokenKey: 'bsc:0xabcdef1111111111111111111111111111111111',
      symbol: 'AAA',
      name: 'Alpha',
      enabled: true,
    });
    expect(
      sandboxTokenCreatePayload({
        ...validForm(),
        coingeckoId: 'alpha-token',
        enabled: false,
      }),
    ).toMatchObject({ coingeckoId: 'alpha-token', enabled: false });
  });
});

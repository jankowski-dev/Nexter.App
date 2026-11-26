import { describe, expect, it } from 'vitest';
import { tickerLabel } from './header-ticker';

describe('tickerLabel', () => {
  it('formats positive and negative changes', () => {
    expect(
      tickerLabel({
        id: 'bitcoin',
        symbol: 'BTC',
        name: 'Bitcoin',
        priceUsd: '65568.00',
        change24hPct: '4.60',
      }),
    ).toBe('BTC 65\u00A0568 [+4,60%]');

    expect(
      tickerLabel({
        id: 'ethereum',
        symbol: 'ETH',
        name: 'Ethereum',
        priceUsd: '1678.00',
        change24hPct: '-5.90',
      }),
    ).toBe('ETH 1\u00A0678 [-5,90%]');
  });

  it('handles a missing change', () => {
    expect(
      tickerLabel({
        id: 'x',
        symbol: 'X',
        name: 'X',
        priceUsd: '1',
        change24hPct: null,
      }),
    ).toBe('X 1 [—]');
  });
});

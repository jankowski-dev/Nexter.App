import { describe, expect, it } from 'vitest';
import { mapTopMarketsResponse } from './coingecko.client';

describe('mapTopMarketsResponse', () => {
  it('maps and caps valid top markets', () => {
    const rows = mapTopMarketsResponse(
      [
        {
          id: 'bitcoin',
          symbol: 'btc',
          name: 'Bitcoin',
          current_price: 65568,
          price_change_percentage_24h: 4.6,
        },
        {
          id: 'ethereum',
          symbol: 'eth',
          name: 'Ethereum',
          current_price: 1678,
          price_change_percentage_24h: 5.9,
        },
      ],
      1,
    );

    expect(rows).toEqual([
      {
        id: 'bitcoin',
        symbol: 'BTC',
        name: 'Bitcoin',
        priceUsd: '65568.00000000',
        change24hPct: '4.60',
      },
    ]);
  });

  it('skips invalid rows and non-arrays', () => {
    expect(mapTopMarketsResponse(null)).toEqual([]);
    expect(
      mapTopMarketsResponse([
        { id: 'bad', symbol: 'bad', current_price: 0 },
        { id: 'ok', symbol: 'ok', name: '', current_price: 1 },
      ]),
    ).toEqual([{ id: 'ok', symbol: 'OK', name: 'OK', priceUsd: '1.00000000', change24hPct: null }]);
  });
});

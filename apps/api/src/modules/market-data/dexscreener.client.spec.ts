import { afterEach, describe, expect, it, vi } from 'vitest';
import { Decimal } from '../../shared/money/decimal';
import { DexScreenerClient } from './dexscreener.client';

const address = '0x1111111111111111111111111111111111111111';

function pair(overrides: Record<string, unknown> = {}) {
  return {
    chainId: 'bsc',
    baseToken: { address, symbol: 'TEST' },
    priceUsd: '0.005',
    priceChange: { h24: -1.5 },
    liquidity: { usd: 50_000 },
    ...overrides,
  };
}

describe('DexScreenerClient', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('selects the deepest matching pair and normalizes precision', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => [
          pair({ priceUsd: '0.004', liquidity: { usd: 1000 } }),
          pair({ priceUsd: '0.005025', liquidity: { usd: 500_000 } }),
          pair({ chainId: 'ethereum', liquidity: { usd: 9_000_000 } }),
        ],
      })),
    );

    const quote = await new DexScreenerClient().getBestQuote('bsc', address, new Decimal(25_000));

    expect(quote).toMatchObject({
      priceUsd: '0.005025000000000000',
      change24hPct: '-1.5000',
      liquidityUsd: '500000.00',
    });
  });

  it('returns null when the token has no sufficiently liquid matching pair', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => [pair({ liquidity: { usd: 100 } })],
      })),
    );

    const quote = await new DexScreenerClient().getBestQuote('bsc', address, new Decimal(25_000));

    expect(quote).toBeNull();
  });
});

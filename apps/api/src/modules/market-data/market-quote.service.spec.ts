import { describe, expect, it, vi } from 'vitest';
import type { CoinGeckoMarket } from './coingecko.client';
import { MarketQuoteService } from './market-quote.service';

interface AssetRow {
  id: string;
  symbol: string;
  contractAddress: string | null;
  coingeckoId: string | null;
  isCashEquivalent: boolean;
  chainCode: string;
}

interface ExistingRow {
  assetId: string;
  priceUsd: string;
  change24hPct: string | null;
  change7dPct: string | null;
  change30dPct: string | null;
  change1yPct: string | null;
  marketCapUsd: string | null;
  source: string;
  liquidityUsd: string | null;
  fetchedAt: Date;
  changedAt: Date;
  updatedAt: Date;
}

function createHarness(assets: AssetRow[], existing: ExistingRow[]) {
  const upserts: Record<string, unknown>[] = [];
  const db = {
    select: vi
      .fn()
      .mockReturnValueOnce({ from: () => ({ innerJoin: async () => assets }) })
      .mockReturnValueOnce({ from: async () => existing }),
    insert: () => ({
      values: (values: Record<string, unknown>) => ({
        onConflictDoUpdate: async () => {
          upserts.push(values);
        },
      }),
    }),
  };
  const coingecko = { getMarkets: vi.fn().mockResolvedValue(new Map()) };
  const dexscreener = { getBestQuote: vi.fn().mockResolvedValue(null) };
  const service = new MarketQuoteService(db as never, coingecko as never, dexscreener as never);

  return { service, upserts, coingecko, dexscreener };
}

function asset(overrides: Partial<AssetRow> = {}): AssetRow {
  return {
    id: 'asset-1',
    symbol: 'NEW',
    contractAddress: null,
    coingeckoId: 'newcoin',
    isCashEquivalent: false,
    chainCode: 'bsc',
    ...overrides,
  };
}

function existingQuote(overrides: Partial<ExistingRow> = {}): ExistingRow {
  return {
    assetId: 'asset-1',
    priceUsd: '1',
    change24hPct: '0.0000',
    change7dPct: '5.0000',
    change30dPct: '6.0000',
    change1yPct: '7.0000',
    marketCapUsd: '100.00',
    source: 'dexscreener',
    liquidityUsd: '50000.00',
    fetchedAt: new Date('2026-11-11T00:00:00Z'),
    changedAt: new Date('2026-11-11T00:00:00Z'),
    updatedAt: new Date('2026-11-11T00:00:00Z'),
    ...overrides,
  };
}

function market(overrides: Partial<CoinGeckoMarket> = {}): CoinGeckoMarket {
  return {
    priceUsd: '2.5',
    change24hPct: '3.00',
    change7dPct: '1.00',
    change30dPct: '2.00',
    change1yPct: '4.00',
    logoUrl: null,
    marketCapUsd: '1000000',
    volume24hUsd: null,
    ...overrides,
  };
}

describe('MarketQuoteService.refreshAll', () => {
  it('fetches CoinGecko for a new asset even between scheduled ticks', async () => {
    const { service, upserts, coingecko } = createHarness([asset()], []);
    // Simulate a tick that happened less than the CoinGecko interval ago.
    (service as unknown as { lastCoinGeckoAt: number }).lastCoinGeckoAt = Date.now();
    coingecko.getMarkets.mockResolvedValue(new Map([['newcoin', market()]]));

    await service.refreshAll();

    expect(coingecko.getMarkets).toHaveBeenCalledWith(['newcoin']);
    expect(upserts).toHaveLength(1);
    expect(upserts[0]).toMatchObject({
      assetId: 'asset-1',
      priceUsd: '2.5',
      change7dPct: '1.0000',
      change30dPct: '2.0000',
      change1yPct: '4.0000',
      marketCapUsd: '1000000.00',
    });
  });

  it('does not trigger CoinGecko for an unquotable asset without a CoinGecko id', async () => {
    const { service, upserts, coingecko } = createHarness([asset({ coingeckoId: null })], []);
    (service as unknown as { lastCoinGeckoAt: number }).lastCoinGeckoAt = Date.now();

    await service.refreshAll();

    expect(coingecko.getMarkets).not.toHaveBeenCalled();
    expect(upserts).toHaveLength(0);
  });

  it('preserves multi-period values on a DEX tick without a CoinGecko refresh', async () => {
    const { service, upserts, coingecko, dexscreener } = createHarness(
      [asset({ contractAddress: '0x0000000000000000000000000000000000000001' })],
      [existingQuote()],
    );
    (service as unknown as { lastCoinGeckoAt: number }).lastCoinGeckoAt = Date.now();
    dexscreener.getBestQuote.mockResolvedValue({
      priceUsd: '1.2',
      change24hPct: '2.0000',
      liquidityUsd: '50000',
    });

    await service.refreshAll();

    expect(coingecko.getMarkets).not.toHaveBeenCalled();
    expect(upserts).toHaveLength(1);
    expect(upserts[0]).toMatchObject({
      assetId: 'asset-1',
      priceUsd: '1.2',
      change24hPct: '2.0000',
      change7dPct: '5.0000',
      change30dPct: '6.0000',
      change1yPct: '7.0000',
      marketCapUsd: '100.00',
    });
  });

  it('clears stale periods when CoinGecko explicitly returns null', async () => {
    const { service, upserts, coingecko, dexscreener } = createHarness(
      [asset({ contractAddress: '0x0000000000000000000000000000000000000001' })],
      [existingQuote()],
    );
    dexscreener.getBestQuote.mockResolvedValue({
      priceUsd: '1.2',
      change24hPct: '2.0000',
      liquidityUsd: '50000',
    });
    coingecko.getMarkets.mockResolvedValue(
      new Map([
        [
          'newcoin',
          market({
            change7dPct: null,
            marketCapUsd: null,
          }),
        ],
      ]),
    );

    await service.refreshAll();

    expect(upserts[0]).toMatchObject({
      change7dPct: null,
      marketCapUsd: null,
    });
  });
});

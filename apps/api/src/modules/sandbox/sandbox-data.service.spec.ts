import { describe, expect, it, vi } from 'vitest';
import type { RawCandle } from '../market-data/candle.types';
import { SandboxDataService } from './sandbox-data.service';
import type { SandboxCandleInput, SandboxTokenRecord } from './sandbox.repository';

const now = new Date('2026-11-24T12:30:00.000Z');
const key = 'bsc:0x1111111111111111111111111111111111111111';

function token(overrides: Partial<SandboxTokenRecord> = {}): SandboxTokenRecord {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    userId: '22222222-2222-4222-8222-222222222222',
    tokenKey: key,
    symbol: 'CAKE',
    name: 'PancakeSwap',
    chain: 'bsc',
    contractAddress: '0x1111111111111111111111111111111111111111',
    coingeckoId: null,
    enabled: true,
    createdAt: new Date('2026-11-01T00:00:00.000Z'),
    updatedAt: new Date('2026-11-01T00:00:00.000Z'),
    ...overrides,
  };
}

function candle(overrides: Partial<RawCandle> = {}): RawCandle {
  return {
    openTime: new Date('2026-11-24T10:00:00.000Z'),
    open: '1.500000000000000000',
    high: '2',
    low: '1.25',
    close: '1.75',
    volumeUsd: '123456.78',
    source: 'geckoterminal',
    quality: 'ok',
    ...overrides,
  };
}

function harness(candles: RawCandle[], options: { days?: number } = {}) {
  const byKey = new Map<string, SandboxCandleInput>();
  const batches: SandboxCandleInput[][] = [];
  const repo = {
    upsertCandles: vi.fn(async (rows: SandboxCandleInput[]) => {
      batches.push(rows);
      for (const row of rows) {
        byKey.set(`${row.tokenKey}:${row.timeframe}:${row.openTime.toISOString()}`, row);
      }
      return rows.length;
    }),
  };
  const geckoterminal = { getOhlcvCandles: vi.fn().mockResolvedValue(candles) };
  const binance = { getCandles: vi.fn().mockResolvedValue(candles) };
  const coingecko = { getHourlyCandles: vi.fn().mockResolvedValue(candles) };
  const service = new SandboxDataService(
    repo as never,
    geckoterminal as never,
    binance as never,
    coingecko as never,
  );

  return { service, repo, geckoterminal, binance, coingecko, byKey, batches, ...options };
}

describe('SandboxDataService', () => {
  it('fetches 1h GeckoTerminal candles for an EVM token to the 180-day limit', async () => {
    const first = candle({ openTime: new Date('2026-11-24T10:00:00.000Z') });
    const second = candle({
      openTime: new Date('2026-11-24T11:00:00.000Z'),
      open: '1.75',
      close: '2.5',
      volumeUsd: null,
    });
    const { service, geckoterminal, binance, coingecko, byKey } = harness([first, second]);

    const result = await service.refreshToken(token(), { now });

    expect(geckoterminal.getOhlcvCandles).toHaveBeenCalledWith('bsc', key.slice(4), '1h', 4320);
    expect(binance.getCandles).not.toHaveBeenCalled();
    expect(coingecko.getHourlyCandles).not.toHaveBeenCalled();
    expect(result).toEqual({ fetched: 2, upserted: 2, source: 'geckoterminal', synthetic: false });

    const stored = byKey.get(`${key}:1h:2026-11-24T11:00:00.000Z`);
    expect(stored).toMatchObject({
      tokenKey: key,
      timeframe: '1h',
      open: '1.750000000000000000',
      close: '2.500000000000000000',
      volumeUsd: '0.000000000000000000',
      source: 'geckoterminal',
      fetchedAt: now,
    });
    expect(typeof stored?.open).toBe('string');
  });

  it('scales the request limit with the requested window', async () => {
    const { service, geckoterminal } = harness([candle()]);

    await service.refreshToken(token(), { now, days: 90 });

    expect(geckoterminal.getOhlcvCandles).toHaveBeenCalledWith('bsc', key.slice(4), '1h', 2160);
  });

  it('falls back to CoinGecko 1h and marks the data synthetic', async () => {
    const hourly = candle({
      openTime: new Date('2026-11-24T10:00:00.000Z'),
      source: 'coingecko',
      quality: 'synthetic',
    });
    const { service, geckoterminal, coingecko, byKey } = harness([]);
    geckoterminal.getOhlcvCandles.mockResolvedValue([]);
    coingecko.getHourlyCandles.mockResolvedValue([hourly]);

    const result = await service.refreshToken(token({ coingeckoId: 'pancakeswap-token' }), { now });

    expect(geckoterminal.getOhlcvCandles).toHaveBeenCalledOnce();
    expect(coingecko.getHourlyCandles).toHaveBeenCalledWith('pancakeswap-token', 180);
    expect(result).toEqual({ fetched: 1, upserted: 1, source: 'coingecko', synthetic: true });
    expect(byKey.get(`${key}:1h:2026-11-24T10:00:00.000Z`)?.source).toBe('coingecko');
  });

  it('uses the curated Binance pair for a Binance token and falls back to CoinGecko', async () => {
    const binanceCandle = candle({ source: 'binance', quality: 'ok' });
    const fallback = candle({ source: 'coingecko', quality: 'synthetic' });

    const binanceHarness = harness([]);
    binanceHarness.geckoterminal.getOhlcvCandles.mockResolvedValue([]);
    binanceHarness.binance.getCandles.mockResolvedValue([binanceCandle]);
    const binanceToken = token({
      tokenKey: 'binance:BTCUSDT',
      symbol: 'BTC',
      chain: 'binance',
      contractAddress: null,
    });

    const binanceResult = await binanceHarness.service.refreshToken(binanceToken, { now });
    expect(binanceHarness.binance.getCandles).toHaveBeenCalledWith('BTC', '1h', 180);
    expect(binanceHarness.geckoterminal.getOhlcvCandles).not.toHaveBeenCalled();
    expect(binanceResult).toEqual({ fetched: 1, upserted: 1, source: 'binance', synthetic: false });

    const fallbackHarness = harness([]);
    fallbackHarness.geckoterminal.getOhlcvCandles.mockResolvedValue([]);
    fallbackHarness.binance.getCandles.mockResolvedValue([]);
    fallbackHarness.coingecko.getHourlyCandles.mockResolvedValue([fallback]);
    const fallbackResult = await fallbackHarness.service.refreshToken(
      { ...binanceToken, coingeckoId: 'bitcoin' },
      { now },
    );

    expect(fallbackHarness.coingecko.getHourlyCandles).toHaveBeenCalledWith('bitcoin', 180);
    expect(fallbackResult).toEqual({
      fetched: 1,
      upserted: 1,
      source: 'coingecko',
      synthetic: true,
    });
  });

  it('drops unclosed and invalid bars, deduplicates open times and sorts ascending', async () => {
    const candles = [
      candle({ openTime: new Date('2026-11-24T11:00:00.000Z'), close: '2' }),
      candle({ openTime: new Date('2026-11-24T12:00:00.000Z') }),
      candle({ openTime: new Date('2026-11-24T09:00:00.000Z'), open: '0' }),
      candle({ openTime: new Date('2026-11-24T10:00:00.000Z'), close: '1.9' }),
      candle({ openTime: new Date('2026-11-24T10:00:00.000Z'), close: '2.1' }),
    ];
    const { service, batches } = harness(candles);

    const result = await service.refreshToken(token(), { now });

    expect(result.fetched).toBe(2);
    expect(result.upserted).toBe(2);
    expect(batches[0]?.map((row) => row.openTime.toISOString())).toEqual([
      '2026-11-24T10:00:00.000Z',
      '2026-11-24T11:00:00.000Z',
    ]);
    expect(batches[0]?.[0]?.close).toBe('2.100000000000000000');
  });

  it('upserts in chunks of at most 500 rows', async () => {
    const candles = Array.from({ length: 1200 }, (_, index) =>
      candle({ openTime: new Date(now.getTime() - (index + 2) * 3_600_000) }),
    );
    const { service, batches } = harness(candles);

    const result = await service.refreshToken(token(), { now });

    expect(batches.map((rows) => rows.length)).toEqual([500, 500, 200]);
    expect(result.upserted).toBe(1200);
  });

  it('is idempotent across repeated refreshes', async () => {
    const candles = [
      candle({ openTime: new Date('2026-11-24T10:00:00.000Z'), close: '1.6' }),
      candle({ openTime: new Date('2026-11-24T11:00:00.000Z'), close: '1.7' }),
    ];
    const { service, byKey } = harness(candles);

    await service.refreshToken(token(), { now });
    await service.refreshToken(token(), { now });

    expect(byKey.size).toBe(2);
  });

  it('returns an empty result without upserting when no provider has data', async () => {
    const { service, repo, geckoterminal, binance, coingecko } = harness([]);
    geckoterminal.getOhlcvCandles.mockResolvedValue([]);
    binance.getCandles.mockResolvedValue([]);
    coingecko.getHourlyCandles.mockResolvedValue([]);

    const result = await service.refreshToken(token({ coingeckoId: 'pancakeswap-token' }), { now });

    expect(result).toEqual({ fetched: 0, upserted: 0, source: null, synthetic: false });
    expect(repo.upsertCandles).not.toHaveBeenCalled();
  });
});

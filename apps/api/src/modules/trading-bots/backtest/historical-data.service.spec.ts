import type { Database } from '@nexter/db';
import { describe, expect, it, vi } from 'vitest';
import type { CoinGeckoClient } from '../../market-data/coingecko.client';
import type { GeckoTerminalClient } from '../../market-data/geckoterminal.client';
import { HistoricalDataService, type HistoricalAsset } from './historical-data.service';
import type { HistoricalCandle } from './historical.types';

function candles(count: number, start = '2025-01-01'): HistoricalCandle[] {
  const startDate = new Date(`${start}T00:00:00.000Z`);
  return Array.from({ length: count }, (_, index) => {
    const date = new Date(startDate.getTime() + index * 86_400_000).toISOString().slice(0, 10);
    const value = (1 + index / 1000).toFixed(8);
    return {
      date,
      openUsd: value,
      highUsd: value,
      lowUsd: value,
      closeUsd: value,
      volumeUsd: '1000.00',
    };
  });
}

function asset(overrides: Partial<HistoricalAsset> = {}): HistoricalAsset {
  return {
    id: 'asset-1',
    symbol: 'CYC',
    name: 'CYCLE',
    chainCode: 'bsc',
    logoUrl: null,
    coingeckoId: 'cycle',
    contractAddress: '0x0000000000000000000000000000000000000001',
    ...overrides,
  };
}

function service(geckoCandles: HistoricalCandle[], coingeckoCandles: HistoricalCandle[]) {
  const coingecko = { getDailyCandles: vi.fn().mockResolvedValue(coingeckoCandles) };
  const geckoterminal = { getDailyCandles: vi.fn().mockResolvedValue(geckoCandles) };
  const historical = new HistoricalDataService(
    {} as Database,
    coingecko as unknown as CoinGeckoClient,
    geckoterminal as unknown as GeckoTerminalClient,
  );
  return { historical, coingecko, geckoterminal };
}

describe('HistoricalDataService source selection', () => {
  it('prefers true GeckoTerminal OHLC when it covers the requested period', async () => {
    const { historical, coingecko, geckoterminal } = service(candles(90), candles(90));
    const series = await historical.getSeries(asset({ id: 'asset-1' }), 90);

    expect(series.source).toBe('geckoterminal');
    expect(series.candles).toHaveLength(90);
    expect(series.candles.every((candle) => candle.synthetic === false)).toBe(true);
    expect(geckoterminal.getDailyCandles).toHaveBeenCalledOnce();
    expect(coingecko.getDailyCandles).not.toHaveBeenCalled();
  });

  it('uses the longer CoinGecko series and marks it synthetic when OHLC covers only part of the period', async () => {
    const { historical, coingecko, geckoterminal } = service(candles(184), candles(300));
    const series = await historical.getSeries(asset({ id: 'asset-2' }), 365);

    expect(series.source).toBe('coingecko');
    expect(series.candles).toHaveLength(300);
    expect(series.candles.every((candle) => candle.synthetic === true)).toBe(true);
    expect(geckoterminal.getDailyCandles).toHaveBeenCalledOnce();
    expect(coingecko.getDailyCandles).toHaveBeenCalledOnce();
  });

  it('keeps GeckoTerminal when CoinGecko has less history', async () => {
    const { historical, coingecko } = service(candles(150), candles(100));
    const series = await historical.getSeries(asset({ id: 'asset-3' }), 365);

    expect(series.source).toBe('geckoterminal');
    expect(series.candles).toHaveLength(150);
    expect(series.candles.every((candle) => candle.synthetic === false)).toBe(true);
    expect(coingecko.getDailyCandles).toHaveBeenCalledOnce();
  });

  it('falls back to CoinGecko when the token has no contract address', async () => {
    const { historical, geckoterminal } = service(candles(0), candles(90));
    const series = await historical.getSeries(asset({ id: 'asset-4', contractAddress: null }), 90);

    expect(series.source).toBe('coingecko');
    expect(series.candles.every((candle) => candle.synthetic === true)).toBe(true);
    expect(geckoterminal.getDailyCandles).not.toHaveBeenCalled();
  });
});

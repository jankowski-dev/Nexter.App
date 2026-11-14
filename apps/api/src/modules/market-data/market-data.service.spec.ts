import { afterEach, describe, expect, it, vi } from 'vitest';
import { MarketDataService } from './market-data.service';

function createService(): MarketDataService {
  return new MarketDataService({} as never, {} as never, {} as never, {} as never, {} as never);
}

function imageResponse(body = 'icon'): Response {
  return {
    ok: true,
    headers: {
      get: (name: string) => (name.toLowerCase() === 'content-type' ? 'image/png' : null),
    },
    arrayBuffer: async () => Buffer.from(body),
  } as unknown as Response;
}

const ICON_URL = 'https://assets.coingecko.com/coins/images/1/large/bitcoin.png';

describe('MarketDataService.fetchIcon', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('serves repeated requests from the in-memory cache', async () => {
    const fetchMock = vi.fn().mockResolvedValue(imageResponse());
    vi.stubGlobal('fetch', fetchMock);
    const service = createService();

    const first = await service.fetchIcon(ICON_URL);
    const second = await service.fetchIcon(ICON_URL);

    expect(first.body.toString()).toBe('icon');
    expect(second.body.toString()).toBe('icon');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('coalesces concurrent requests for the same icon', async () => {
    let release: (response: Response) => void = () => undefined;
    const pending = new Promise<Response>((resolve) => {
      release = resolve;
    });
    const fetchMock = vi.fn().mockReturnValue(pending);
    vi.stubGlobal('fetch', fetchMock);
    const service = createService();

    const first = service.fetchIcon(ICON_URL);
    const second = service.fetchIcon(ICON_URL);
    release(imageResponse());

    const [a, b] = await Promise.all([first, second]);
    expect(a.body.toString()).toBe('icon');
    expect(b.body.toString()).toBe('icon');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('refetches after the 24-hour TTL', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-11T00:00:00Z'));
    const fetchMock = vi.fn().mockResolvedValue(imageResponse());
    vi.stubGlobal('fetch', fetchMock);
    const service = createService();

    await service.fetchIcon(ICON_URL);
    vi.setSystemTime(new Date('2026-11-12T00:00:01Z'));
    await service.fetchIcon(ICON_URL);

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('rejects hosts outside the icon allowlist', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const service = createService();

    await expect(service.fetchIcon('https://example.com/icon.png')).rejects.toMatchObject({
      response: { code: 'VALIDATION_ERROR' },
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects non-image responses', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        headers: { get: () => 'text/html' },
        arrayBuffer: async () => Buffer.from('<html>'),
      }),
    );
    const service = createService();

    await expect(service.fetchIcon(ICON_URL)).rejects.toMatchObject({
      response: { code: 'VALIDATION_ERROR' },
    });
  });
});

describe('MarketDataService.getPriceHistory', () => {
  function candle(date: string, close: string) {
    return {
      date,
      openUsd: close,
      highUsd: close,
      lowUsd: close,
      closeUsd: close,
      volumeUsd: null,
    };
  }

  it('prefers GeckoTerminal candles and falls back to CoinGecko when they are shorter', async () => {
    const gecko = { getDailyCandles: vi.fn().mockResolvedValue([candle('2026-11-13', '1.5')]) };
    const coingecko = {
      getDailyCandles: vi
        .fn()
        .mockResolvedValue([candle('2026-11-12', '1.2'), candle('2026-11-13', '1.5')]),
    };
    const service = new MarketDataService(
      {} as never,
      {} as never,
      coingecko as never,
      gecko as never,
      {} as never,
    );

    const history = await service.getPriceHistory('bsc', '0xabc', 'token', 30);

    expect(gecko.getDailyCandles).toHaveBeenCalledWith('bsc', '0xabc', 30);
    expect(coingecko.getDailyCandles).toHaveBeenCalledWith('token', 30);
    expect(history.source).toBe('coingecko');
    expect(history.points).toEqual([
      { date: '2026-11-12', priceUsd: '1.2' },
      { date: '2026-11-13', priceUsd: '1.5' },
    ]);
  });

  it('returns an empty series when no source has data', async () => {
    const service = new MarketDataService(
      {} as never,
      {} as never,
      { getDailyCandles: vi.fn().mockResolvedValue([]) } as never,
      { getDailyCandles: vi.fn().mockResolvedValue([]) } as never,
      {} as never,
    );

    await expect(service.getPriceHistory('bsc', null, null, 90)).resolves.toEqual({
      source: 'none',
      points: [],
    });
  });
});

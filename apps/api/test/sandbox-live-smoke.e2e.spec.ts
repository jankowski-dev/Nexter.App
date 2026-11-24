import { describe, expect, it } from 'vitest';
import {
  SANDBOX_REQUIRED_CANDLES,
  SANDBOX_TIMEFRAME,
  SANDBOX_TIMEFRAME_MS,
} from '@nexter/contracts';
import type {
  SandboxCandleInput,
  SandboxCandleStats,
} from '../src/modules/sandbox/sandbox.repository';
import { SandboxDataService } from '../src/modules/sandbox/sandbox-data.service';
import { buildSandboxCoverage } from '../src/modules/sandbox/sandbox-tokens.service';
import { BinanceClient } from '../src/modules/market-data/binance.client';
import { CoinGeckoClient } from '../src/modules/market-data/coingecko.client';
import { GeckoTerminalClient } from '../src/modules/market-data/geckoterminal.client';

/**
 * Opt-in live-provider smoke. Never runs in CI and never touches Postgres.
 *
 *   cd apps/api
 *   NODE_ENV=development SANDBOX_LIVE_SMOKE=1 npx vitest run test/sandbox-live-smoke.e2e.spec.ts
 *
 * The market-data clients deliberately return no candles under `NODE_ENV=test`,
 * so this suite must run with a non-test environment. Without
 * `SANDBOX_LIVE_SMOKE=1` every test is skipped and no network call is made.
 */
const liveEnabled = process.env.SANDBOX_LIVE_SMOKE === '1' && process.env.NODE_ENV !== 'test';

const BTC_KEY = 'binance:BTCUSDT';
const CAKE_KEY = 'bsc:0x0e09fabb73bd3ade0a17ecc321fd13a19e81ce82';

interface FakeToken {
  tokenKey: string;
  symbol: string;
  chain: 'bsc' | 'ethereum' | 'binance';
  contractAddress: string | null;
  coingeckoId: string | null;
}

const BTC: FakeToken = {
  tokenKey: BTC_KEY,
  symbol: 'BTC',
  chain: 'binance',
  contractAddress: null,
  coingeckoId: null,
};

const CAKE: FakeToken = {
  tokenKey: CAKE_KEY,
  symbol: 'CAKE',
  chain: 'bsc',
  contractAddress: CAKE_KEY.slice('bsc:'.length),
  coingeckoId: null,
};

/** Minimal in-memory stand-in for the candle part of `SandboxRepository`. */
class FakeCandleRepository {
  private readonly rows = new Map<string, Map<number, SandboxCandleInput>>();

  async upsertCandles(candles: SandboxCandleInput[]): Promise<number> {
    for (const candle of candles) {
      const byOpenTime = this.rows.get(candle.tokenKey) ?? new Map();
      byOpenTime.set(candle.openTime.getTime(), candle);
      this.rows.set(candle.tokenKey, byOpenTime);
    }
    return candles.length;
  }

  candles(tokenKey: string): SandboxCandleInput[] {
    return [...(this.rows.get(tokenKey)?.values() ?? [])].sort(
      (left, right) => left.openTime.getTime() - right.openTime.getTime(),
    );
  }

  stats(tokenKey: string): SandboxCandleStats {
    const rows = this.candles(tokenKey);
    return {
      available: rows.length,
      firstOpenTime: rows[0]?.openTime ?? null,
      lastOpenTime: rows.at(-1)?.openTime ?? null,
      syntheticCandles: rows.filter((row) => row.source === 'coingecko').length,
    };
  }
}

describe.runIf(liveEnabled)('sandbox live provider smoke', () => {
  it('fetches and normalizes 180 days of real 1h data and reports truthful coverage', async () => {
    const repository = new FakeCandleRepository();
    const data = new SandboxDataService(
      repository as never,
      new GeckoTerminalClient(),
      new BinanceClient(),
      new CoinGeckoClient(),
    );
    const now = new Date();

    // Binance majors: the curated real-OHLCV fallback path.
    const btc = await data.refreshToken(BTC, { days: 180 });
    expect(btc.synthetic).toBe(false);
    expect(btc.source).toBe('binance');
    expect(btc.fetched).toBeGreaterThanOrEqual(4_300);

    const btcRows = repository.candles(BTC_KEY);
    expect(btcRows.length).toBe(btc.fetched);
    expect(btcRows.length).toBeGreaterThanOrEqual(4_300);
    expect(btcRows.every((row) => row.timeframe === SANDBOX_TIMEFRAME)).toBe(true);
    expect(btcRows.every((row) => /^\d+\.\d{18}$/.test(row.close))).toBe(true);
    expect(btcRows.every((row) => /^\d+\.\d{18}$/.test(row.volumeUsd))).toBe(true);
    expect(
      btcRows.every(
        (row, index) =>
          index === 0 ||
          row.openTime.getTime() - (btcRows[index - 1]?.openTime.getTime() ?? 0) ===
            SANDBOX_TIMEFRAME_MS,
      ),
    ).toBe(true);

    const btcStats = repository.stats(BTC_KEY);
    const btcCoverage = buildSandboxCoverage(BTC_KEY, btcStats, now);
    expect(btcCoverage.required).toBe(SANDBOX_REQUIRED_CANDLES);
    expect(btcCoverage.available).toBe(btcStats.available);
    expect(btcCoverage.gaps).toBe(0);
    expect(btcCoverage.synthetic).toBe(false);
    const btcLastClose = (btcStats.lastOpenTime?.getTime() ?? 0) + SANDBOX_TIMEFRAME_MS;
    expect(btcCoverage.stale).toBe(now.getTime() - btcLastClose > SANDBOX_TIMEFRAME_MS);
    const btcComplete = btcCoverage.available >= SANDBOX_REQUIRED_CANDLES && btcCoverage.gaps === 0;
    expect(btcCoverage.status).toBe(
      btcCoverage.available === 0
        ? 'missing'
        : btcComplete && !btcCoverage.stale
          ? 'ok'
          : 'partial',
    );
    expect(btcCoverage.firstOpenTime).not.toBeNull();
    expect(btcCoverage.lastOpenTime).not.toBeNull();

    // The live quote is the newest raw bar, never the historical decision close.
    const quote = await data.latestPrice(BTC, { now });
    expect(quote).not.toBeNull();
    expect(Number(quote?.priceUsd)).toBeGreaterThan(0);
    expect(Number(quote?.volumeUsd)).toBeGreaterThan(0);
    expect(quote?.barOpenTime.getTime()).toBeGreaterThanOrEqual(
      (btcStats.lastOpenTime?.getTime() ?? 0) - SANDBOX_TIMEFRAME_MS,
    );

    // GeckoTerminal DEX path (known BSC CAKE/WBNB pool). Public API may 429;
    // the client retries and the assertion stays on observed rows only.
    const cake = await data.refreshToken(CAKE, { days: 180 });
    expect(cake.synthetic).toBe(false);
    expect(cake.source).toBe('geckoterminal');
    expect(cake.fetched).toBeGreaterThanOrEqual(4_000);

    const cakeStats = repository.stats(CAKE_KEY);
    const cakeCoverage = buildSandboxCoverage(CAKE_KEY, cakeStats, now);
    expect(cakeCoverage.required).toBe(SANDBOX_REQUIRED_CANDLES);
    expect(cakeCoverage.available).toBe(cakeStats.available);
    expect(cakeCoverage.gaps).toBe(0);
    expect(cakeCoverage.synthetic).toBe(false);
    const cakeLastClose = (cakeStats.lastOpenTime?.getTime() ?? 0) + SANDBOX_TIMEFRAME_MS;
    expect(cakeCoverage.stale).toBe(now.getTime() - cakeLastClose > SANDBOX_TIMEFRAME_MS);

    // Observed evidence for the Stage 2 report (also asserted above).
    console.info(
      `[sandbox-live-smoke] binance ${btc.fetched} rows -> ${btcCoverage.status} ` +
        `(${btcCoverage.available}/${btcCoverage.required}, gaps ${btcCoverage.gaps}, ` +
        `stale ${btcCoverage.stale}, synthetic ${btcCoverage.synthetic}); ` +
        `gecko ${cake.fetched} rows -> ${cakeCoverage.status} ` +
        `(${cakeCoverage.available}/${cakeCoverage.required}, gaps ${cakeCoverage.gaps}, ` +
        `stale ${cakeCoverage.stale}, synthetic ${cakeCoverage.synthetic})`,
    );
  }, 180_000);
});

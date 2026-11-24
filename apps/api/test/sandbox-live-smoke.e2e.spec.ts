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
 * Opt-in live-provider smoke. Normal CI and PR runs skip it; the manual
 * workflow and the temporary one-off Stage 2 CI step run it explicitly.
 *
 *   cd apps/api
 *   NODE_ENV=development SANDBOX_LIVE_SMOKE=1 npx vitest run test/sandbox-live-smoke.e2e.spec.ts
 *
 * The market-data clients deliberately return no candles under `NODE_ENV=test`,
 * so this suite must run with a non-test environment. Without
 * `SANDBOX_LIVE_SMOKE=1` every test is skipped and no network call is made.
 *
 * CAKE/GeckoTerminal is the CI-proof leg and stays strict. Binance is
 * geo-restricted on some CI runners; a zero-row Binance response is recorded as
 * unavailable and only the BTC assertions are skipped (never a partial or
 * synthetic BTC series).
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

    // CAKE/GeckoTerminal first: this is the CI-proof leg and stays strict. A
    // partial series or an unexpected source fails the smoke.
    const cake = await data.refreshToken(CAKE, { days: 180 });
    expect(cake.synthetic).toBe(false);
    expect(cake.source).toBe('geckoterminal');
    expect(cake.fetched).toBe(SANDBOX_REQUIRED_CANDLES);

    const cakeRows = repository.candles(CAKE_KEY);
    expect(cakeRows.length).toBe(SANDBOX_REQUIRED_CANDLES);
    expect(cakeRows.every((row) => row.timeframe === SANDBOX_TIMEFRAME)).toBe(true);
    expect(cakeRows.every((row) => /^\d+\.\d{18}$/.test(row.close))).toBe(true);
    expect(cakeRows.every((row) => /^\d+\.\d{18}$/.test(row.volumeUsd))).toBe(true);
    expect(
      cakeRows.every(
        (row, index) =>
          index === 0 ||
          row.openTime.getTime() - (cakeRows[index - 1]?.openTime.getTime() ?? 0) ===
            SANDBOX_TIMEFRAME_MS,
      ),
    ).toBe(true);

    const cakeStats = repository.stats(CAKE_KEY);
    const cakeCoverage = buildSandboxCoverage(CAKE_KEY, cakeStats, now);
    expect(cakeCoverage.required).toBe(SANDBOX_REQUIRED_CANDLES);
    expect(cakeCoverage.available).toBe(SANDBOX_REQUIRED_CANDLES);
    expect(cakeCoverage.gaps).toBe(0);
    expect(cakeCoverage.synthetic).toBe(false);
    expect(cakeCoverage.stale).toBe(false);
    expect(cakeCoverage.status).toBe('ok');
    expect(cakeCoverage.firstOpenTime).not.toBeNull();
    expect(cakeCoverage.lastOpenTime).not.toBeNull();

    // Binance is geo-restricted on some CI runners. A zero-row (or mixed-source)
    // response is recorded as unavailable and only the BTC assertions are
    // skipped; a partial/synthetic BTC series is never silently accepted.
    const btc = await data.refreshToken(BTC, { days: 180 });
    const btcUnavailable = btc.fetched === 0 || btc.source === null;
    let btcEvidence = 'binance unavailable (geo-restricted/0 rows)';

    if (btcUnavailable) {
      console.warn(
        `[sandbox-live-smoke] Binance unavailable from this network ` +
          `(fetched ${btc.fetched}, source ${String(btc.source)}); skipping BTC assertions`,
      );
    } else {
      expect(btc.synthetic).toBe(false);
      expect(btc.source).toBe('binance');
      expect(btc.fetched).toBe(SANDBOX_REQUIRED_CANDLES);

      const btcRows = repository.candles(BTC_KEY);
      expect(btcRows.length).toBe(SANDBOX_REQUIRED_CANDLES);
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
      expect(btcCoverage.available).toBe(SANDBOX_REQUIRED_CANDLES);
      expect(btcCoverage.gaps).toBe(0);
      expect(btcCoverage.synthetic).toBe(false);
      expect(btcCoverage.stale).toBe(false);
      expect(btcCoverage.status).toBe('ok');
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

      btcEvidence =
        `binance ${btc.fetched} rows -> ${btcCoverage.status} ` +
        `(${btcCoverage.available}/${btcCoverage.required}, gaps ${btcCoverage.gaps}, ` +
        `stale ${btcCoverage.stale}, synthetic ${btcCoverage.synthetic})`;
    }

    // Observed evidence for the Stage 2 report (CAKE is always strict).
    console.info(
      `[sandbox-live-smoke] gecko ${cake.fetched} rows -> ${cakeCoverage.status} ` +
        `(${cakeCoverage.available}/${cakeCoverage.required}, gaps ${cakeCoverage.gaps}, ` +
        `stale ${cakeCoverage.stale}, synthetic ${cakeCoverage.synthetic}); ` +
        btcEvidence,
    );
  }, 180_000);
});

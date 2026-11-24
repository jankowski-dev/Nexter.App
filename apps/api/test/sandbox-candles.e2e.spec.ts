import { sql } from 'drizzle-orm';
import { createDb, sandboxCandles, type Database } from '@nexter/db';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { RawCandle } from '../src/modules/market-data/candle.types';
import { SandboxDataService } from '../src/modules/sandbox/sandbox-data.service';
import {
  SandboxRepository,
  type SandboxCandleInput,
  type SandboxTokenRecord,
} from '../src/modules/sandbox/sandbox.repository';
import { assertDisposableTestDatabase } from './helpers/test-database';

const canRun = Boolean(process.env.NEXTER_TEST_DB === '1' && process.env.DATABASE_URL);

if (canRun) {
  assertDisposableTestDatabase(process.env.DATABASE_URL);
}

const now = new Date('2026-11-24T12:30:00.000Z');
const key = 'bsc:0x1111111111111111111111111111111111111111';
const firstOpen = new Date('2026-11-24T10:00:00.000Z');
const secondOpen = new Date('2026-11-24T11:00:00.000Z');

function token(): SandboxTokenRecord {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    userId: '22222222-2222-4222-8222-222222222222',
    tokenKey: key,
    symbol: 'CAKE',
    name: 'PancakeSwap',
    chain: 'bsc',
    contractAddress: key.slice('bsc:'.length),
    coingeckoId: 'pancakeswap-token',
    enabled: true,
    createdAt: new Date('2026-11-01T00:00:00.000Z'),
    updatedAt: new Date('2026-11-01T00:00:00.000Z'),
  };
}

function candleRow(overrides: Partial<SandboxCandleInput> = {}): SandboxCandleInput {
  const open = overrides.open ?? '1';
  const close = overrides.close ?? '1.5';
  return {
    tokenKey: key,
    timeframe: '1h',
    openTime: firstOpen,
    open,
    // Keep the fixture OHLC self-consistent so a stored row can never fail the
    // market-view validation in a later suite that shares the candle table.
    high: String(Math.max(Number(open), Number(close), 2)),
    low: String(Math.min(Number(open), Number(close), 0.5)),
    close,
    volumeUsd: '100',
    source: 'geckoterminal',
    fetchedAt: now,
    ...overrides,
  };
}

function providerCandle(overrides: Partial<RawCandle> = {}): RawCandle {
  const open = overrides.open ?? '1';
  const close = overrides.close ?? '1.05';
  return {
    openTime: secondOpen,
    open,
    high: String(Math.max(Number(open), Number(close), 1.1)),
    low: String(Math.min(Number(open), Number(close), 0.9)),
    close,
    volumeUsd: '50',
    source: 'coingecko',
    quality: 'synthetic',
    ...overrides,
  };
}

function fakeClients(options: { primary?: RawCandle[]; synthetic?: RawCandle[] }): {
  geckoterminal: unknown;
  binance: unknown;
  coingecko: unknown;
} {
  return {
    geckoterminal: { getOhlcvCandles: async () => options.primary ?? [] },
    binance: { getCandles: async () => [] },
    coingecko: { getHourlyCandles: async () => options.synthetic ?? [] },
  };
}

describe.runIf(canRun)('sandbox candle storage (db)', () => {
  let db: Database;
  let pool: ReturnType<typeof createDb>['pool'];
  let repository: SandboxRepository;

  beforeAll(() => {
    const created = createDb(process.env.DATABASE_URL ?? '');
    db = created.db;
    pool = created.pool;
    repository = new SandboxRepository(db);
  });

  beforeEach(async () => {
    await db.execute(sql`truncate table sandbox_candles`);
  });

  afterAll(async () => {
    // Candle rows are shared market data with no owner FK; never leak fixtures
    // into later suites (the live runner loads every row for a token key).
    await db.execute(sql`truncate table sandbox_candles`);
    await pool.end();
  });

  it('upserts idempotently and aggregates available and synthetic counts', async () => {
    await repository.upsertCandles([
      candleRow(),
      candleRow({ openTime: secondOpen, close: '2.5' }),
    ]);
    await repository.upsertCandles([
      candleRow({ close: '3.5' }),
      candleRow({ openTime: secondOpen, close: '4.5' }),
    ]);

    const rows = await db.select().from(sandboxCandles).orderBy(sandboxCandles.openTime);
    expect(rows).toHaveLength(2);
    expect(rows[0]?.openTime.toISOString()).toBe(firstOpen.toISOString());
    expect(rows[0]?.close).toBe('3.500000000000000000');
    expect(rows[1]?.close).toBe('4.500000000000000000');

    const stats = await repository.candleStatsMany([key]);
    expect(stats.get(key)).toMatchObject({
      available: 2,
      firstOpenTime: firstOpen,
      lastOpenTime: secondOpen,
      syntheticCandles: 0,
    });

    await repository.upsertCandles([
      candleRow({ openTime: secondOpen, source: 'coingecko', close: '9' }),
    ]);
    const withSynthetic = await repository.candleStatsMany([key]);
    expect(withSynthetic.get(key)).toMatchObject({ available: 2, syntheticCandles: 1 });
  });

  it('keeps a real bar when the synthetic fallback refreshes the same open time', async () => {
    await repository.upsertCandles([candleRow({ close: '1.10' })]);

    const fallback = fakeClients({
      primary: [],
      synthetic: [
        providerCandle({ openTime: firstOpen, close: '9.99' }),
        providerCandle({ openTime: secondOpen, close: '9.98' }),
      ],
    });
    const data = new SandboxDataService(
      repository,
      fallback.geckoterminal as never,
      fallback.binance as never,
      fallback.coingecko as never,
    );

    const result = await data.refreshToken(token(), { now });
    expect(result.synthetic).toBe(true);
    expect(result.fetched).toBe(2);

    const rows = await db.select().from(sandboxCandles).orderBy(sandboxCandles.openTime);
    expect(rows).toHaveLength(2);
    expect(rows[0]?.source).toBe('geckoterminal');
    expect(Number(rows[0]?.close)).toBe(1.1);
    expect(rows[1]?.source).toBe('coingecko');
    expect(Number(rows[1]?.close)).toBe(9.98);
  });

  it('lets a later primary refresh update an existing real bar', async () => {
    await repository.upsertCandles([candleRow({ close: '1.10' })]);

    const primary = fakeClients({
      primary: [
        providerCandle({
          openTime: firstOpen,
          source: 'geckoterminal',
          quality: 'ok',
          close: '1.20',
        }),
      ],
      synthetic: [],
    });
    const data = new SandboxDataService(
      repository,
      primary.geckoterminal as never,
      primary.binance as never,
      primary.coingecko as never,
    );

    const result = await data.refreshToken(token(), { now });
    expect(result.synthetic).toBe(false);

    const [row] = await db.select().from(sandboxCandles);
    expect(row?.source).toBe('geckoterminal');
    expect(Number(row?.close)).toBe(1.2);
  });
});

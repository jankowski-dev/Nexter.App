import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { createDb, sandboxRuns, sandboxRunTokens, users, type Database } from '@nexter/db';
import {
  SANDBOX_REQUIRED_CANDLES,
  SANDBOX_TIMEFRAME,
  SANDBOX_TIMEFRAME_MS,
} from '@nexter/contracts';
import {
  applyBuyFill,
  candleCloseTime,
  createLedger,
  DEFAULT_PAPER_SETTINGS,
  DEFAULT_SETTINGS,
  GENESIS_HASH,
  planBuyFill,
  Reason,
  type OrderIntent,
  type PaperLedgerState,
} from '@nexter/sandbox-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AuditService } from '../src/shared/audit/audit.service';
import { BinanceClient } from '../src/modules/market-data/binance.client';
import { CoinGeckoClient } from '../src/modules/market-data/coingecko.client';
import { GeckoTerminalClient } from '../src/modules/market-data/geckoterminal.client';
import { SandboxDataService } from '../src/modules/sandbox/sandbox-data.service';
import { SandboxEventLog } from '../src/modules/sandbox/sandbox-event-log';
import { SandboxReportService } from '../src/modules/sandbox/sandbox-report.service';
import { SandboxRepository } from '../src/modules/sandbox/sandbox.repository';
import { SandboxRunService } from '../src/modules/sandbox/sandbox-run.service';
import { SandboxRunnerService } from '../src/modules/sandbox/sandbox-runner.service';
import { SandboxTokensService } from '../src/modules/sandbox/sandbox-tokens.service';
import { buildSandboxCoverage } from '../src/modules/sandbox/sandbox-tokens.service';
import { assertDisposableTestDatabase } from './helpers/test-database';

/**
 * Opt-in live tick smoke: real providers + real Postgres, manual only.
 *
 *   NODE_ENV=development NEXTER_TEST_DB=1 SANDBOX_LIVE_SMOKE=1 \
 *     npx vitest run test/sandbox-live-tick-smoke.e2e.spec.ts
 *
 * It is skipped in normal CI. The GitHub workflow
 * `.github/workflows/sandbox-live-smoke.yml` runs it manually with Postgres 17.
 *
 * The run trades one real CAKE position seeded at an above-market cost so the
 * deterministic Stage 1B strategy produces a stop sell on the real closed bar.
 * Tick 1 (second-to-last closed provider bar) decides; tick 2 (last closed bar)
 * fills at the first real quote after that decision. If the provider quote is
 * stale/missing the sell stays explicitly pending and the test records why; it
 * never fabricates a price or a candle.
 */
const liveEnabled =
  process.env.NEXTER_TEST_DB === '1' &&
  process.env.SANDBOX_LIVE_SMOKE === '1' &&
  process.env.NODE_ENV !== 'test';

if (liveEnabled) {
  assertDisposableTestDatabase(process.env.DATABASE_URL);
}

const CAKE_KEY = 'bsc:0x0e09fabb73bd3ade0a17ecc321fd13a19e81ce82';
const HOUR = 3_600_000;

interface LiveToken {
  tokenKey: string;
  symbol: string;
  chain: 'bsc' | 'binance';
  contractAddress: string | null;
  coingeckoId: string | null;
}

const CAKE: LiveToken = {
  tokenKey: CAKE_KEY,
  symbol: 'CAKE',
  chain: 'bsc',
  contractAddress: CAKE_KEY.slice('bsc:'.length),
  coingeckoId: null,
};

/** A CAKE position bought at 100 USD, far above the real market close. */
function seededLedger(): PaperLedgerState {
  const clockTime = Date.now() - 2 * HOUR;
  const intent: OrderIntent = {
    intentId: 'live-smoke-entry',
    tokenId: CAKE_KEY,
    side: 'buy',
    strategyKey: 'trend_pullback',
    strategyVersion: 1,
    reasonCode: Reason.TREND_PULLBACK_ENTRY,
    sizeUsd: '200.00',
    amount: null,
    stopLossPct: null,
    takeProfitPct: null,
    decisionPriceUsd: '100.00000000',
    clockTime,
  };
  const plan = planBuyFill({
    intent,
    candle: {
      tokenId: CAKE_KEY,
      timeframe: '1h',
      openTime: clockTime,
      open: '100.00000000',
      high: '100.00000000',
      low: '100.00000000',
      close: '100.00000000',
      volumeUsd: '1000000.00000000',
    },
    cashUsd: '1000.00',
    equityUsd: '1000.00',
    cashBufferPct: 0,
    settings: DEFAULT_PAPER_SETTINGS,
    hasPosition: false,
  });
  if (plan.status !== 'filled') throw new Error(`seeded entry was ${plan.status}`);

  return applyBuyFill(createLedger('1000.00'), plan, intent, clockTime).state;
}

/** A repository whose candle read stops at `cutoff` (the decision bar). */
function repositoryThroughBar(repository: SandboxRepository, cutoff: number): SandboxRepository {
  return new Proxy(repository, {
    get(target, property) {
      if (property === 'loadCandles') {
        return async (...args: Parameters<SandboxRepository['loadCandles']>) => {
          const candles = await target.loadCandles(...args);
          return candles.filter((candle) => candleCloseTime(candle) <= cutoff);
        };
      }
      const value = Reflect.get(target, property, target) as unknown;
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

describe.runIf(liveEnabled)('sandbox live tick smoke', () => {
  let created: ReturnType<typeof createDb> | null = null;
  let db: Database;
  let pool: ReturnType<typeof createDb>['pool'];

  beforeAll(() => {
    created = createDb(process.env.DATABASE_URL ?? '');
    db = created.db;
    pool = created.pool;
  });

  afterAll(async () => {
    if (created !== null) {
      await db.execute(sql`truncate table sandbox_candles`);
      await db.execute(sql`truncate table users restart identity cascade`);
      await pool.end();
    }
  });

  it('runs two real closed bars, persists a tick/fill/report and stops', async () => {
    await db.execute(sql`truncate table sandbox_candles`);
    await db.execute(sql`truncate table users restart identity cascade`);

    const repository = new SandboxRepository(db);
    const audit = new AuditService(db);
    const data = new SandboxDataService(
      repository,
      new GeckoTerminalClient(),
      new BinanceClient(),
      new CoinGeckoClient(),
    );

    // Real 180-day CAKE series (the only token this run trades). Binance is
    // geo-restricted on some CI runners and is not required here.
    const cakeRefresh = await data.refreshToken(CAKE, { days: 180 });
    expect(cakeRefresh.synthetic).toBe(false);
    expect(cakeRefresh.source).toBe('geckoterminal');
    expect(cakeRefresh.fetched).toBe(SANDBOX_REQUIRED_CANDLES);

    const now = new Date();
    const cakeStat = (await repository.candleStatsMany([CAKE_KEY])).get(CAKE_KEY);
    if (cakeStat === undefined) throw new Error('no candle stats for CAKE');
    const cakeCoverage = buildSandboxCoverage(CAKE_KEY, cakeStat, now);
    expect(cakeCoverage.available).toBe(SANDBOX_REQUIRED_CANDLES);
    expect(cakeCoverage.required).toBe(SANDBOX_REQUIRED_CANDLES);
    expect(cakeCoverage.gaps).toBe(0);
    expect(cakeCoverage.synthetic).toBe(false);
    expect(cakeCoverage.stale).toBe(false);
    expect(cakeCoverage.status).toBe('ok');

    const candles = await repository.loadCandles([CAKE_KEY], SANDBOX_TIMEFRAME, 3);
    const decisionBar = candles.at(-2);
    const fillBar = candles.at(-1);
    if (decisionBar === undefined || fillBar === undefined) {
      throw new Error('provider returned fewer than two closed CAKE bars');
    }
    const decisionClose = candleCloseTime(decisionBar);
    const fillClose = candleCloseTime(fillBar);
    expect(fillClose - decisionClose).toBe(SANDBOX_TIMEFRAME_MS);

    // Fixture owner + running run with one above-market CAKE position.
    const [owner] = await db
      .insert(users)
      .values({
        email: `sandbox-live-tick-${randomUUID()}@example.com`,
        passwordHash: 'not-a-real-hash',
      })
      .returning({ id: users.id });
    if (!owner) throw new Error('owner insert returned no row');
    const ledger = seededLedger();
    const settings = {
      tokenKeys: [CAKE_KEY],
      seed: 1,
      settings: DEFAULT_SETTINGS,
      paper: DEFAULT_PAPER_SETTINGS,
    };
    const [run] = await db
      .insert(sandboxRuns)
      .values({
        userId: owner.id,
        name: 'Live tick smoke',
        status: 'running',
        initialCapitalUsd: '1000.00',
        cashUsd: ledger.cashUsd,
        equityUsd: ledger.cashUsd,
        peakEquityUsd: '1000.00',
        dayStartEquityUsd: '1000.00',
        settings: settings as unknown as Record<string, unknown>,
        engineState: { tokens: {} },
        ledgerState: ledger as unknown as Record<string, unknown>,
        lastBarClose: null,
        eventSeq: 0,
        eventHash: GENESIS_HASH,
        startedAt: now,
      })
      .returning({ id: sandboxRuns.id });
    if (!run) throw new Error('run insert returned no row');
    await db.insert(sandboxRunTokens).values({
      runId: run.id,
      tokenKey: CAKE_KEY,
      symbol: 'CAKE',
      chain: 'bsc',
      contractAddress: CAKE.contractAddress,
      enabled: true,
    });

    // Tick 1: the real second-to-last closed bar is the decision bar. No
    // provider quote is needed because there is no pending intent yet.
    const noQuoteData = {
      refreshToken: data.refreshToken.bind(data),
      latestPrice: async () => null,
    } as unknown as SandboxDataService;
    const runner1 = new SandboxRunnerService(
      pool,
      true,
      repositoryThroughBar(repository, decisionClose),
      noQuoteData,
      audit,
    );
    await runner1.runOnce(new Date(decisionClose));

    const afterDecision = await repository.loadRun(run.id);
    expect(afterDecision?.lastBarClose?.getTime()).toBe(decisionClose);
    expect(afterDecision?.eventSeq).toBeGreaterThan(0);
    const chain1 = await SandboxEventLog.verifyRun(db, run.id);
    expect(chain1).toMatchObject({ ok: true, count: afterDecision?.eventSeq });
    const pendingAfterDecision = await repository.listPendingIntents(run.id);
    const cakeSell = pendingAfterDecision.find(
      (intent) => intent.tokenId === CAKE_KEY && intent.side === 'sell',
    );
    expect(cakeSell).toBeDefined();

    // Tick 2: the real last closed bar fills the pending stop at the first
    // real quote after the decision. The provider may be stale/missing; in
    // that case the intent stays pending and the test records it.
    const runner2 = new SandboxRunnerService(pool, true, repository, data, audit);
    await runner2.runOnce(new Date(fillClose));

    const afterFill = await repository.loadRun(run.id);
    expect(afterFill?.lastBarClose?.getTime()).toBe(fillClose);
    expect(afterFill!.eventSeq).toBeGreaterThan(afterDecision!.eventSeq);
    const equity = await repository.listEquityPoints(run.id, { limit: 10 });
    expect(equity).toHaveLength(2);
    expect(equity.at(-1)?.clockTime.getTime()).toBe(fillClose);

    const intents = await repository.listIntents(run.id, { limit: 50 });
    const resolvedSell = intents.find(
      (intent) => intent.tokenId === CAKE_KEY && intent.side === 'sell',
    );
    if (resolvedSell?.status === 'filled' || resolvedSell?.status === 'partial') {
      expect(resolvedSell.filledAmount).not.toBe('0.00000000');
      expect(await repository.countOpenPositions(run.id)).toBe(0);
    } else {
      // No fresh quote after the decision bar: the live rules deliberately
      // keep the sell pending rather than fill at a stale price.
      expect(resolvedSell?.status).toBe('pending');
      console.info(
        '[sandbox-live-tick-smoke] sell stayed pending: no fresh provider quote after the decision bar',
      );
    }

    const reports = new SandboxReportService(repository);
    const report = await reports.getReport(owner.id, run.id);
    expect(report.executionMode).toBe('live-paper');
    expect(report.report.runId).toBe(run.id);
    expect(report.report.eventCount).toBe(afterFill?.eventSeq);
    expect(report.report.eventHash).toBe(afterFill?.eventHash);
    expect(report.report.metrics.finalEquityUsd).toBe(afterFill?.equityUsd);
    expect(report.report.reconciliationOk).toBe(true);

    const tokens = new SandboxTokensService(repository, audit, data);
    const runs = new SandboxRunService(repository, tokens, data, audit);
    const stopped = await runs.stop(owner.id, run.id, {});
    expect(stopped.status).toBe('stopped');
    expect(await repository.listPendingIntents(run.id)).toHaveLength(0);

    console.info(
      `[sandbox-live-tick-smoke] bars ${new Date(decisionClose).toISOString()} -> ` +
        `${new Date(fillClose).toISOString()}; events ${afterFill?.eventSeq}; ` +
        `sell ${resolvedSell?.status}; report ${report.report.reportHash}`,
    );
  }, 300_000);
});

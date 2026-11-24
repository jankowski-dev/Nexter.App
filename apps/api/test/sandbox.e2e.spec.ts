import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import cookie from '@fastify/cookie';
import { and, eq, sql } from 'drizzle-orm';
import { generateSync } from 'otplib';
import request from 'supertest';
import {
  auditLog,
  createDb,
  sandboxEquityPoints,
  sandboxEvents,
  sandboxIntents,
  sandboxRuns,
  users,
  type Database,
} from '@nexter/db';
import {
  SANDBOX_TIMEFRAME,
  sandboxEquityResponseSchema,
  sandboxEventsResponseSchema,
  sandboxIntentsResponseSchema,
  sandboxOverviewSchema,
  sandboxPositionsResponseSchema,
  sandboxReportResponseSchema,
  sandboxRunDetailSchema,
  sandboxRunsResponseSchema,
  sandboxTradesResponseSchema,
} from '@nexter/contracts';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { SandboxEventLog } from '../src/modules/sandbox/sandbox-event-log';
import type { SandboxCandleInput } from '../src/modules/sandbox/sandbox.repository';
import { SandboxRepository } from '../src/modules/sandbox/sandbox.repository';
import { SandboxRunnerService } from '../src/modules/sandbox/sandbox-runner.service';
import { SandboxDataService } from '../src/modules/sandbox/sandbox-data.service';
import { AllExceptionsFilter } from '../src/shared/errors/all-exceptions.filter';
import { assertDisposableTestDatabase } from './helpers/test-database';
import { seedSandboxRun } from './helpers/sandbox-fixtures';

/**
 * Fake-clock end-to-end suite for the Stage 2 live-paper loop.
 *
 * The real Nest module, controller, lifecycle service, live tick, event log,
 * projections, read API and report service run against Postgres, but every
 * provider call and the clock are deterministic: candles are seeded by the
 * test and the runner is advanced with an explicit `now`. No wall clock and no
 * network are involved in the assertions.
 *
 * DB-gated (`NEXTER_TEST_DB=1` + a disposable `DATABASE_URL`); skipped locally.
 */
const canRun = Boolean(
  process.env.NEXTER_TEST_DB === '1' &&
  process.env.DATABASE_URL &&
  process.env.SETUP_TOKEN &&
  process.env.AUTH_ENCRYPTION_KEY,
);

if (canRun) {
  assertDisposableTestDatabase(process.env.DATABASE_URL);
}

const password = 'correct horse battery staple';
const TOKEN = 'bsc:0x1111111111111111111111111111111111111111';
const START = Date.UTC(2026, 0, 1);
const HOUR = 3_600_000;
const BAR_CLOSE_MS = START + 300 * HOUR;

interface FakeQuote {
  priceUsd: string;
  volumeUsd: string;
  barOpenTime: Date;
}

/** Deterministic stand-in for the provider-backed sandbox data service. */
class FakeSandboxData {
  quote: FakeQuote | null = null;
  refreshCalls = 0;
  quoteCalls = 0;

  async refreshToken(): Promise<{
    fetched: number;
    upserted: number;
    source: string;
    synthetic: boolean;
  }> {
    this.refreshCalls += 1;
    return { fetched: 0, upserted: 0, source: 'fake', synthetic: false };
  }

  async latestPrice(token: { tokenKey: string }): Promise<{
    tokenId: string;
    priceUsd: string;
    volumeUsd: string;
    barOpenTime: Date;
    asOf: Date;
  } | null> {
    this.quoteCalls += 1;
    if (this.quote === null) return null;
    return {
      tokenId: token.tokenKey,
      priceUsd: this.quote.priceUsd,
      volumeUsd: this.quote.volumeUsd,
      barOpenTime: this.quote.barOpenTime,
      asOf: this.quote.barOpenTime,
    };
  }
}

function baseCandle(index: number, close: string): SandboxCandleInput {
  return {
    tokenKey: TOKEN,
    timeframe: SANDBOX_TIMEFRAME,
    openTime: new Date(START + index * HOUR),
    // open = previous close is supplied by the caller-facing helpers below.
    open: close,
    high: close,
    low: close,
    close,
    volumeUsd: '100000.000000000000000000',
    source: 'geckoterminal',
    fetchedAt: new Date(START),
  };
}

/** 299 rising bars plus a 2.9% pullback bar that triggers trend_pullback. */
function warmupCandles(): SandboxCandleInput[] {
  const rows: SandboxCandleInput[] = [];
  for (let index = 0; index < 300; index += 1) {
    const close = index === 299 ? '111.00' : (100 + index * 0.05).toFixed(2);
    const open = index === 0 ? close : (rows[index - 1]?.close as string);
    const row = baseCandle(index, close);
    rows.push({
      ...row,
      open,
      high: String(Math.max(Number(open), Number(close))),
      low: String(Math.min(Number(open), Number(close))),
    });
  }
  return rows;
}

function appendCandle(index: number, previousClose: string, close: string): SandboxCandleInput {
  const row = baseCandle(index, close);
  return {
    ...row,
    open: previousClose,
    high: String(Math.max(Number(previousClose), Number(close))),
    low: String(Math.min(Number(previousClose), Number(close))),
  };
}

interface TestCookies {
  values: Map<string, string>;
}

function absorb(response: request.Response, cookies: TestCookies): void {
  const setCookie = response.headers['set-cookie'];
  const list = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : [];
  for (const raw of list) {
    const pair = raw.split(';')[0] ?? '';
    const separator = pair.indexOf('=');
    if (separator <= 0) continue;
    cookies.values.set(pair.slice(0, separator), pair.slice(separator + 1));
  }
}

function cookieHeader(cookies: TestCookies): string {
  return [...cookies.values.entries()].map(([name, value]) => `${name}=${value}`).join('; ');
}

/** One HTTP call bound to the captured session, so it survives an app restart. */
function api(
  app: NestFastifyApplication,
  cookies: TestCookies,
  method: 'get' | 'post' | 'patch',
  path: string,
): request.Test {
  return request(app.getHttpServer())
    [method](path)
    .set('Cookie', cookieHeader(cookies))
    .set('x-csrf-token', cookies.values.get('nexter_csrf') ?? '');
}

async function setupOwner(app: NestFastifyApplication): Promise<TestCookies> {
  const cookies: TestCookies = { values: new Map() };

  const setup = await request(app.getHttpServer())
    .post('/api/v1/auth/setup')
    .send({
      setupToken: process.env.SETUP_TOKEN,
      email: `sandbox-e2e-${Date.now()}@example.com`,
      password,
    })
    .expect(201);
  absorb(setup, cookies);

  const totpSetup = await api(app, cookies, 'post', '/api/v1/auth/2fa/setup').expect(200);
  absorb(totpSetup, cookies);
  const secret = totpSetup.body.secret as string;

  const enabled = await api(app, cookies, 'post', '/api/v1/auth/2fa/enable')
    .send({ code: generateSync({ secret }) })
    .expect(200);
  absorb(enabled, cookies);

  return cookies;
}

async function bootApp(fakeData?: FakeSandboxData): Promise<NestFastifyApplication> {
  let builder = Test.createTestingModule({ imports: [AppModule] });
  if (fakeData !== undefined) {
    builder = builder.overrideProvider(SandboxDataService).useValue(fakeData);
  }
  const moduleRef = await builder.compile();

  const app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
  await app.register(cookie as any);
  app.setGlobalPrefix('api/v1', { exclude: ['health', 'ready'] });
  app.useGlobalFilters(new AllExceptionsFilter());
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  return app;
}

describe('Sandbox live-paper fake-clock e2e', () => {
  let app: NestFastifyApplication;
  let db: Database | null = null;
  let pool: ReturnType<typeof createDb>['pool'] | null = null;

  async function restoreSingleton(): Promise<void> {
    if (!db) return;
    await db.execute(sql`truncate table users restart identity cascade`);
    await db.execute(
      sql`create unique index if not exists users_singleton_unique on users ((true))`,
    );
  }

  async function ownerId(): Promise<string> {
    if (!db) throw new Error('test database is not configured');
    const [row] = await db.select({ id: users.id }).from(users).limit(1);
    if (!row) throw new Error('owner was not created');
    return row.id;
  }

  beforeAll(async () => {
    app = await bootApp();

    if (canRun) {
      const created = createDb(process.env.DATABASE_URL ?? '');
      db = created.db;
      pool = created.pool;
    }
  }, 30_000);

  beforeEach(async () => {
    if (!db) return;
    // Candle rows are shared market data (no owner FK); isolate this suite from
    // fixtures left by other sandbox specs.
    await db.execute(sql`truncate table sandbox_candles`);
    await db.execute(sql`truncate table users restart identity cascade`);
  });

  afterAll(async () => {
    try {
      await restoreSingleton();
    } finally {
      await app.close();
      await pool?.end();
    }
  });

  it('requires authentication for every sandbox data, read and control route', async () => {
    const server = app.getHttpServer();
    const runId = '33333333-3333-4333-8333-333333333333';
    const tokenId = '44444444-4444-4444-8444-444444444444';
    const routes: Array<['get' | 'post' | 'patch', string]> = [
      ['get', '/api/v1/sandbox/status'],
      ['get', '/api/v1/sandbox/tokens'],
      ['post', '/api/v1/sandbox/tokens'],
      ['patch', `/api/v1/sandbox/tokens/${tokenId}`],
      ['post', `/api/v1/sandbox/tokens/${tokenId}/refresh`],
      ['get', '/api/v1/sandbox/coverage'],
      ['get', '/api/v1/sandbox/overview'],
      ['get', '/api/v1/sandbox/runs'],
      ['post', '/api/v1/sandbox/runs'],
      ['get', `/api/v1/sandbox/runs/${runId}`],
      ['patch', `/api/v1/sandbox/runs/${runId}`],
      ['post', `/api/v1/sandbox/runs/${runId}/start`],
      ['post', `/api/v1/sandbox/runs/${runId}/pause`],
      ['post', `/api/v1/sandbox/runs/${runId}/resume`],
      ['post', `/api/v1/sandbox/runs/${runId}/stop`],
      ['post', `/api/v1/sandbox/runs/${runId}/archive`],
      ['post', `/api/v1/sandbox/runs/${runId}/close/${encodeURIComponent(TOKEN)}`],
      ['get', `/api/v1/sandbox/runs/${runId}/positions`],
      ['get', `/api/v1/sandbox/runs/${runId}/trades`],
      ['get', `/api/v1/sandbox/runs/${runId}/intents`],
      ['get', `/api/v1/sandbox/runs/${runId}/events`],
      ['get', `/api/v1/sandbox/runs/${runId}/equity`],
      ['get', `/api/v1/sandbox/runs/${runId}/report.json`],
      ['get', `/api/v1/sandbox/runs/${runId}/report.md`],
    ];

    for (const [method, path] of routes) {
      const response = await request(server)[method](path).expect(401);
      expect(response.body, `${method.toUpperCase()} ${path}`).toMatchObject({
        error: { code: 'AUTH_REQUIRED' },
      });
    }

    // Unknown manual buy/add routes must not exist.
    await request(server).post(`/api/v1/sandbox/runs/${runId}/buy`).expect(404);
    await request(server).post(`/api/v1/sandbox/runs/${runId}/add`).expect(404);
  });

  it.runIf(canRun)(
    'runs a deterministic live-paper pipeline across a restart, controls and reports',
    async () => {
      if (!db) throw new Error('test database is not configured');
      const repository = new SandboxRepository(db);
      const fake = new FakeSandboxData();
      let liveApp = await bootApp(fake);
      let runner = liveApp.get(SandboxRunnerService);
      const cookies = await setupOwner(liveApp);

      try {
        const status = await api(liveApp, cookies, 'get', '/api/v1/sandbox/status').expect(200);
        expect(status.body).toEqual({ enabled: true, version: 'sandbox-stage-2' });

        // CSRF: an authenticated mutation without the header must be rejected.
        await request(liveApp.getHttpServer())
          .post('/api/v1/sandbox/runs')
          .set('Cookie', cookieHeader(cookies))
          .send({ name: 'No CSRF', initialCapitalUsd: '1000', tokenKeys: [TOKEN] })
          .expect(403);

        // --- Token universe (create / update / refresh audit) -----------------
        const token = await api(liveApp, cookies, 'post', '/api/v1/sandbox/tokens')
          .send({ tokenKey: TOKEN, symbol: 'CAKE', name: 'PancakeSwap' })
          .expect(201);
        const tokenId = token.body.id as string;
        await api(liveApp, cookies, 'patch', `/api/v1/sandbox/tokens/${tokenId}`)
          .send({ symbol: 'CAKE', name: 'PancakeSwap v2' })
          .expect(200);
        await api(liveApp, cookies, 'post', `/api/v1/sandbox/tokens/${tokenId}/refresh`).expect(
          200,
        );
        expect(fake.refreshCalls).toBe(1);

        // --- Warmup data (299 rising bars + pullback) -------------------------
        await repository.upsertCandles(warmupCandles());

        // --- Draft + edit + start ---------------------------------------------
        const draft = await api(liveApp, cookies, 'post', '/api/v1/sandbox/runs')
          .send({ name: 'Fake clock run', initialCapitalUsd: '1000', tokenKeys: [TOKEN] })
          .expect(201);
        expect(draft.body).toMatchObject({ status: 'draft' });
        const runId = draft.body.id as string;

        await api(liveApp, cookies, 'patch', `/api/v1/sandbox/runs/${runId}`)
          .send({ name: 'Fake clock run (edited)' })
          .expect(200);

        // 300 bars are a partial warmup; the owner explicitly accepts it.
        const started = await api(liveApp, cookies, 'post', `/api/v1/sandbox/runs/${runId}/start`)
          .send({ allowPartial: true })
          .expect(200);
        expect(started.body).toMatchObject({ status: 'running', lastBarClose: null });

        // --- Tick 1: decision at the pullback bar queues a buy ----------------
        await runner.runOnce(new Date(BAR_CLOSE_MS));

        const afterTick1 = await api(
          liveApp,
          cookies,
          'get',
          `/api/v1/sandbox/runs/${runId}`,
        ).expect(200);
        const detail1 = sandboxRunDetailSchema.parse(afterTick1.body);
        expect(detail1.status).toBe('running');
        expect(detail1.lastBarClose).toBe(new Date(BAR_CLOSE_MS).toISOString());
        expect(detail1.eventCount).toBeGreaterThan(0);
        expect(detail1.pendingIntents).toBe(1);
        expect(detail1.openPositions).toBe(0);
        expect(detail1.equityPoints).toBe(1);

        const intents1 = sandboxIntentsResponseSchema.parse(
          (await api(liveApp, cookies, 'get', `/api/v1/sandbox/runs/${runId}/intents`).expect(200))
            .body,
        );
        expect(intents1.intents).toHaveLength(1);
        expect(intents1.intents[0]).toMatchObject({ status: 'pending', side: 'buy' });

        const events1 = sandboxEventsResponseSchema.parse(
          (await api(liveApp, cookies, 'get', `/api/v1/sandbox/runs/${runId}/events`).expect(200))
            .body,
        );
        expect(events1.events[0]?.seq).toBe(0);
        expect(events1.events.length).toBe(detail1.eventCount);
        expect(events1.events.at(-1)?.hash).toBe(detail1.eventHash);

        // --- Tick 2: the pending buy fills at the next quote ------------------
        await repository.upsertCandles([appendCandle(300, '111.00', '111.50')]);
        fake.quote = {
          priceUsd: '111.20',
          volumeUsd: '100000.000000000000000000',
          barOpenTime: new Date(START + 300 * HOUR),
        };
        await runner.runOnce(new Date(START + 301 * HOUR));

        const positions = sandboxPositionsResponseSchema.parse(
          (
            await api(liveApp, cookies, 'get', `/api/v1/sandbox/runs/${runId}/positions`).expect(
              200,
            )
          ).body,
        );
        expect(positions.positions).toHaveLength(1);
        expect(positions.positions[0]?.tokenId).toBe(TOKEN);
        expect(positions.positions[0]?.amount).toMatch(/^\d+\.\d{8}$/);
        expect(Number(positions.positions[0]?.amount)).toBeGreaterThan(0);

        const trades = sandboxTradesResponseSchema.parse(
          (await api(liveApp, cookies, 'get', `/api/v1/sandbox/runs/${runId}/trades`).expect(200))
            .body,
        );
        expect(trades.total).toBe(1);
        expect(trades.trades[0]?.status).toBe('open');

        const intents2 = sandboxIntentsResponseSchema.parse(
          (await api(liveApp, cookies, 'get', `/api/v1/sandbox/runs/${runId}/intents`).expect(200))
            .body,
        );
        expect(intents2.intents).toHaveLength(1);
        expect(intents2.intents[0]?.status).toBe('filled');

        const detail2 = sandboxRunDetailSchema.parse(
          (await api(liveApp, cookies, 'get', `/api/v1/sandbox/runs/${runId}`).expect(200)).body,
        );
        expect(detail2).toMatchObject({
          openPositions: 1,
          openTrades: 1,
          pendingIntents: 0,
          equityPoints: 2,
          ledgerEntries: 1,
        });
        // The live fill uses the quote (111.20 + 10 bps), never the bar close.
        expect(intents2.intents[0]?.priceUsd).toBe('111.31120000');

        const equity2 = sandboxEquityResponseSchema.parse(
          (await api(liveApp, cookies, 'get', `/api/v1/sandbox/runs/${runId}/equity`).expect(200))
            .body,
        );
        expect(equity2.points).toHaveLength(2);
        expect(equity2.points.at(-1)?.equityUsd).toBe(detail2.equityUsd);

        const chain2 = await SandboxEventLog.verifyRun(db, runId);
        expect(chain2).toMatchObject({ ok: true, count: detail2.eventCount });
        expect(chain2.headHash).toBe(detail2.eventHash);

        // A duplicate tick for the same bar must not add events or points.
        await runner.runOnce(new Date(START + 301 * HOUR));
        const afterDuplicate = sandboxRunDetailSchema.parse(
          (await api(liveApp, cookies, 'get', `/api/v1/sandbox/runs/${runId}`).expect(200)).body,
        );
        expect(afterDuplicate.eventCount).toBe(detail2.eventCount);
        expect(afterDuplicate.equityPoints).toBe(2);

        // --- Restart: a new app/module instance continues from persisted state -
        await liveApp.close();
        liveApp = await bootApp(fake);
        runner = liveApp.get(SandboxRunnerService);

        const afterRestart = sandboxRunDetailSchema.parse(
          (await api(liveApp, cookies, 'get', `/api/v1/sandbox/runs/${runId}`).expect(200)).body,
        );
        expect(afterRestart.eventCount).toBe(detail2.eventCount);
        expect(afterRestart.eventHash).toBe(detail2.eventHash);
        expect(afterRestart.lastBarClose).toBe(new Date(START + 301 * HOUR).toISOString());
        expect(afterRestart.openPositions).toBe(1);

        // --- Manual close: queued by HTTP, filled by the next tick ------------
        const closeAt = START + 301 * HOUR;
        const realDateNow = Date.now;
        let closeResponse: request.Response | null = null;
        Date.now = () => closeAt;
        try {
          closeResponse = await api(
            liveApp,
            cookies,
            'post',
            `/api/v1/sandbox/runs/${runId}/close/${encodeURIComponent(TOKEN)}`,
          ).expect(200);
        } finally {
          Date.now = realDateNow;
        }
        expect(closeResponse?.body).toMatchObject({ status: 'running' });

        await repository.upsertCandles([appendCandle(301, '111.50', '112.00')]);
        fake.quote = {
          priceUsd: '112.00',
          volumeUsd: '100000.000000000000000000',
          barOpenTime: new Date(START + 301 * HOUR),
        };
        await runner.runOnce(new Date(START + 302 * HOUR));

        const positionsClosed = sandboxPositionsResponseSchema.parse(
          (
            await api(liveApp, cookies, 'get', `/api/v1/sandbox/runs/${runId}/positions`).expect(
              200,
            )
          ).body,
        );
        expect(positionsClosed.positions).toHaveLength(0);

        const tradesClosed = sandboxTradesResponseSchema.parse(
          (await api(liveApp, cookies, 'get', `/api/v1/sandbox/runs/${runId}/trades`).expect(200))
            .body,
        );
        expect(tradesClosed.total).toBe(1);
        expect(tradesClosed.trades[0]).toMatchObject({
          status: 'closed',
          exitReasonCode: 'MANUAL_CLOSE',
        });

        const manualIntent = await db
          .select()
          .from(sandboxIntents)
          .where(and(eq(sandboxIntents.runId, runId), eq(sandboxIntents.side, 'sell')));
        expect(manualIntent).toHaveLength(1);
        expect(manualIntent[0]).toMatchObject({
          status: 'filled',
          strategyReasonCode: 'MANUAL_CLOSE',
        });

        const afterClose = sandboxRunDetailSchema.parse(
          (await api(liveApp, cookies, 'get', `/api/v1/sandbox/runs/${runId}`).expect(200)).body,
        );
        expect(afterClose).toMatchObject({
          openPositions: 0,
          openTrades: 0,
          closedTrades: 1,
          ledgerEntries: 2,
        });

        // --- Invalid transitions / no manual buy ------------------------------
        await api(
          liveApp,
          cookies,
          'post',
          `/api/v1/sandbox/runs/${runId}/close/${encodeURIComponent(TOKEN)}`,
        ).expect(409);
        await api(liveApp, cookies, 'post', `/api/v1/sandbox/runs/${runId}/resume`).expect(409);
        await api(liveApp, cookies, 'post', `/api/v1/sandbox/runs/${runId}/archive`).expect(409);
        await api(liveApp, cookies, 'post', `/api/v1/sandbox/runs/${runId}/start`)
          .send({ allowPartial: true })
          .expect(409);
        await api(liveApp, cookies, 'patch', `/api/v1/sandbox/runs/${runId}`)
          .send({ name: 'Nope' })
          .expect(409);
        await api(liveApp, cookies, 'post', `/api/v1/sandbox/runs/${runId}/buy`)
          .send({ sizeUsd: '10.00' })
          .expect(404);
        await api(liveApp, cookies, 'post', `/api/v1/sandbox/runs/${runId}/add`)
          .send({ sizeUsd: '10.00' })
          .expect(404);

        // --- Pause: no tick, no gap fill; resume advances once ----------------
        const paused = await api(
          liveApp,
          cookies,
          'post',
          `/api/v1/sandbox/runs/${runId}/pause`,
        ).expect(200);
        expect(paused.body.status).toBe('paused');
        const pausedDetail = sandboxRunDetailSchema.parse(
          (await api(liveApp, cookies, 'get', `/api/v1/sandbox/runs/${runId}`).expect(200)).body,
        );

        await repository.upsertCandles([
          appendCandle(302, '112.00', '112.10'),
          appendCandle(303, '112.10', '112.20'),
          appendCandle(304, '112.20', '112.30'),
          appendCandle(305, '112.30', '112.40'),
        ]);
        fake.quote = null;
        await runner.runOnce(new Date(START + 306 * HOUR));

        const stillPaused = sandboxRunDetailSchema.parse(
          (await api(liveApp, cookies, 'get', `/api/v1/sandbox/runs/${runId}`).expect(200)).body,
        );
        expect(stillPaused.eventCount).toBe(pausedDetail.eventCount);
        expect(stillPaused.equityPoints).toBe(pausedDetail.equityPoints);
        expect(stillPaused.lastBarClose).toBe(pausedDetail.lastBarClose);

        const resumed = await api(
          liveApp,
          cookies,
          'post',
          `/api/v1/sandbox/runs/${runId}/resume`,
        ).expect(200);
        expect(resumed.body.status).toBe('running');
        await runner.runOnce(new Date(START + 306 * HOUR));

        const afterResume = sandboxRunDetailSchema.parse(
          (await api(liveApp, cookies, 'get', `/api/v1/sandbox/runs/${runId}`).expect(200)).body,
        );
        // Exactly one tick at the newest bar: no retroactive gap fills.
        expect(afterResume.equityPoints).toBe(pausedDetail.equityPoints + 1);
        expect(afterResume.lastBarClose).toBe(new Date(START + 306 * HOUR).toISOString());
        expect(afterResume.closedTrades).toBe(1);
        const equityAfterResume = sandboxEquityResponseSchema.parse(
          (await api(liveApp, cookies, 'get', `/api/v1/sandbox/runs/${runId}/equity`).expect(200))
            .body,
        );
        expect(equityAfterResume.points.at(-1)?.clockTime).toBe(
          new Date(START + 306 * HOUR).toISOString(),
        );

        // --- Stop: pending intents resolved, report stable --------------------
        const stopped = await api(
          liveApp,
          cookies,
          'post',
          `/api/v1/sandbox/runs/${runId}/stop`,
        ).expect(200);
        expect(stopped.body.status).toBe('stopped');

        const pendingRows = await db
          .select({ intentId: sandboxIntents.intentId })
          .from(sandboxIntents)
          .where(and(eq(sandboxIntents.runId, runId), eq(sandboxIntents.status, 'pending')));
        expect(pendingRows).toHaveLength(0);

        const stoppedDetail = sandboxRunDetailSchema.parse(
          (await api(liveApp, cookies, 'get', `/api/v1/sandbox/runs/${runId}`).expect(200)).body,
        );
        const report1 = sandboxReportResponseSchema.parse(
          (
            await api(liveApp, cookies, 'get', `/api/v1/sandbox/runs/${runId}/report.json`).expect(
              200,
            )
          ).body,
        );
        const report2 = sandboxReportResponseSchema.parse(
          (
            await api(liveApp, cookies, 'get', `/api/v1/sandbox/runs/${runId}/report.json`).expect(
              200,
            )
          ).body,
        );
        expect(report1.executionMode).toBe('live-paper');
        expect(report1.report.reportHash).toBe(report2.report.reportHash);
        expect(report1.report.eventCount).toBe(stoppedDetail.eventCount);
        expect(report1.report.eventHash).toBe(stoppedDetail.eventHash);
        expect(report1.report.metrics.finalEquityUsd).toBe(stoppedDetail.equityUsd);
        const lastEquity = sandboxEquityResponseSchema
          .parse(
            (await api(liveApp, cookies, 'get', `/api/v1/sandbox/runs/${runId}/equity`).expect(200))
              .body,
          )
          .points.at(-1);
        expect(report1.report.metrics.finalEquityUsd).toBe(lastEquity?.equityUsd);
        expect(report1.report.reconciliationOk).toBe(true);
        expect(report1.report.counterfactuals).toEqual([]);
        expect(report1.report.configVersion.length).toBeGreaterThan(0);

        const markdown = await api(
          liveApp,
          cookies,
          'get',
          `/api/v1/sandbox/runs/${runId}/report.md`,
        ).expect(200);
        expect(markdown.headers['content-type']).toContain('text/markdown');
        expect(markdown.text).toContain('Live paper run report');
        expect(markdown.text).toContain('live-paper');

        // --- Archive: soft hide, reads stay available -------------------------
        const archived = await api(
          liveApp,
          cookies,
          'post',
          `/api/v1/sandbox/runs/${runId}/archive`,
        ).expect(200);
        expect(archived.body.archivedAt).not.toBeNull();

        const defaultList = sandboxRunsResponseSchema.parse(
          (await api(liveApp, cookies, 'get', '/api/v1/sandbox/runs').expect(200)).body,
        );
        expect(defaultList.total).toBe(0);
        const archivedList = sandboxRunsResponseSchema.parse(
          (
            await api(liveApp, cookies, 'get', '/api/v1/sandbox/runs?includeArchived=true').expect(
              200,
            )
          ).body,
        );
        expect(archivedList.total).toBe(1);
        expect(archivedList.runs[0]?.archivedAt).not.toBeNull();
        const archivedDetail = sandboxRunDetailSchema.parse(
          (await api(liveApp, cookies, 'get', `/api/v1/sandbox/runs/${runId}`).expect(200)).body,
        );
        expect(archivedDetail.archivedAt).not.toBeNull();

        const overview = sandboxOverviewSchema.parse(
          (await api(liveApp, cookies, 'get', '/api/v1/sandbox/overview').expect(200)).body,
        );
        expect(overview.executionMode).toBe('live-paper');
        expect(overview.runs.total).toBe(0);
        expect(overview.runs.archived).toBe(1);

        // --- Audit + event chain final verification ---------------------------
        const runAudits = await db
          .select({ action: auditLog.action })
          .from(auditLog)
          .where(and(eq(auditLog.entityType, 'sandbox_run'), eq(auditLog.entityId, runId)));
        expect(new Set(runAudits.map((row) => row.action))).toEqual(
          new Set([
            'sandbox.run_created',
            'sandbox.run_updated',
            'sandbox.run_started',
            'sandbox.run_paused',
            'sandbox.run_resumed',
            'sandbox.run_stopped',
            'sandbox.run_archived',
            'sandbox.trade_close_requested',
          ]),
        );

        const tokenAudits = await db
          .select({ action: auditLog.action })
          .from(auditLog)
          .where(eq(auditLog.entityType, 'sandbox_token'));
        expect(new Set(tokenAudits.map((row) => row.action))).toEqual(
          new Set(['sandbox.token_created', 'sandbox.token_updated', 'sandbox.token_refreshed']),
        );

        const [finalRun] = await db
          .select({
            eventSeq: sandboxRuns.eventSeq,
            eventHash: sandboxRuns.eventHash,
            status: sandboxRuns.status,
          })
          .from(sandboxRuns)
          .where(eq(sandboxRuns.id, runId));
        expect(finalRun?.status).toBe('stopped');
        const chain = await SandboxEventLog.verifyRun(db, runId);
        expect(chain).toMatchObject({ ok: true, count: finalRun?.eventSeq });
        expect(chain.headHash).toBe(finalRun?.eventHash);
        expect(chain.errors).toEqual([]);

        const [eventCountRow] = await db
          .select({ count: sql<number>`count(*)::int` })
          .from(sandboxEvents)
          .where(eq(sandboxEvents.runId, runId));
        const [pointCountRow] = await db
          .select({ count: sql<number>`count(*)::int` })
          .from(sandboxEquityPoints)
          .where(eq(sandboxEquityPoints.runId, runId));
        expect(eventCountRow?.count).toBe(finalRun?.eventSeq);
        expect(pointCountRow?.count).toBe(4);
      } finally {
        await liveApp.close().catch(() => undefined);
      }
    },
    120_000,
  );

  it.runIf(canRun)('hides another owner run behind 404', async () => {
    if (!db) throw new Error('test database is not configured');
    const cookies = await setupOwner(app);
    await ownerId();

    // The app is single-owner; drop the singleton guard for this check only.
    await db.execute(sql`drop index if exists users_singleton_unique`);
    const [secondOwner] = await db
      .insert(users)
      .values({
        email: `sandbox-e2e-second-${Date.now()}@example.com`,
        passwordHash: 'not-a-real-hash',
      })
      .returning({ id: users.id });
    if (!secondOwner) throw new Error('second owner insert returned no row');

    const { runId } = await seedSandboxRun(db, {
      userId: secondOwner.id,
      status: 'running',
    });

    try {
      await api(app, cookies, 'get', `/api/v1/sandbox/runs/${runId}`).expect(404);
      await api(app, cookies, 'get', `/api/v1/sandbox/runs/${runId}/positions`).expect(404);
      await api(app, cookies, 'get', `/api/v1/sandbox/runs/${runId}/report.json`).expect(404);
      await api(app, cookies, 'post', `/api/v1/sandbox/runs/${runId}/pause`).expect(404);
    } finally {
      await restoreSingleton();
    }
  });
});

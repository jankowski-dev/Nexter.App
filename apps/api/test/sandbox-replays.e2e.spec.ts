import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import cookie from '@fastify/cookie';
import { and, eq, sql } from 'drizzle-orm';
import { generateSync } from 'otplib';
import request from 'supertest';
import { auditLog, createDb, sandboxReplays, users, type Database } from '@nexter/db';
import {
  SANDBOX_TIMEFRAME,
  sandboxReplayDetailSchema,
  sandboxReplayListResponseSchema,
  sandboxReplayPreflightResponseSchema,
  sandboxReplayReportResponseSchema,
  sandboxRunReportSchema,
  type SandboxReplayDetail,
  type SandboxRunReport,
} from '@nexter/contracts';
import {
  DEFAULT_PAPER_SETTINGS,
  DEFAULT_SETTINGS,
  paperConfigVersion,
  reportHash,
  runPaperFromCandles,
  type PaperRunConfig,
  type RunReport,
} from '@nexter/sandbox-core';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import {
  decodeReplaySnapshot,
  InlineReplayExecutor,
  snapshotReplayCandles,
  toCoreDecisionSettings,
  toCorePaperSettings,
} from '../src/modules/sandbox/sandbox-replay.executor';
import { SandboxReplayRepository } from '../src/modules/sandbox/sandbox-replay.repository';
import { SandboxReplayWorkerService } from '../src/modules/sandbox/sandbox-replay-worker.service';
import {
  SandboxRepository,
  type SandboxCandleInput,
} from '../src/modules/sandbox/sandbox.repository';
import { AllExceptionsFilter } from '../src/shared/errors/all-exceptions.filter';
import { assertDisposableTestDatabase } from './helpers/test-database';

/**
 * Historical replay end-to-end suite (Stage 2.1).
 *
 * The real Nest module, controller, owner auth/TOTP/CSRF, replay service,
 * worker (`runOnce` with the inline executor), repository, report service and
 * DB-gated persistence run against Postgres; the provider network is never
 * used because `sandbox_candles` is seeded by the test.
 *
 * The fixture is a full 60-day 1h store per token (30-day evaluation window +
 * 30-day lookback prefix, both 720 bars) with two tokens whose identical price
 * series triggers a trend-pullback entry; `maxPositions: 1` leaves the second
 * candidate as a `portfolio.dropped` buy, which the hindsight counterfactual
 * analyzer records. Nothing here depends on the wall clock except the stable
 * window end (the last closed 1h bar at module load).
 *
 * DB-gated (`NEXTER_TEST_DB=1` + a disposable `DATABASE_URL`); CI is the first
 * execution because there is no local Postgres in the development sandbox.
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
const HOUR = 3_600_000;
const TOKEN_A = 'bsc:0x1111111111111111111111111111111111111111';
const TOKEN_B = 'bsc:0x2222222222222222222222222222222222222222';
const TOKENS = [TOKEN_A, TOKEN_B];
const PERIOD_DAYS = 30;
const PREFIX_BARS = 720;
const EVAL_BARS = 720;
const DAY = 24 * HOUR;

/**
 * Stable window: the last fully closed 1h bar at module load. Seeds never move,
 * so the replay's `to_time` stays `END_OPEN_TIME + 1h` even if the suite
 * crosses an hour boundary (only the advisory `stale` warning could appear).
 */
const END_OPEN_TIME = Math.floor(Date.now() / HOUR) * HOUR - HOUR;
const TO_TIME = END_OPEN_TIME + HOUR;
const FROM_TIME = TO_TIME - EVAL_BARS * HOUR;
const START_OPEN_TIME = FROM_TIME - PREFIX_BARS * HOUR;

/** Default Stage 1B settings with a single position slot for the counterfactual. */
const REPLAY_SETTINGS = { ...DEFAULT_SETTINGS, maxPositions: 1 };

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
      email: `sandbox-replays-e2e-${Date.now()}@example.com`,
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

async function bootApp(): Promise<NestFastifyApplication> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();

  const app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
  await app.register(cookie as any);
  app.setGlobalPrefix('api/v1', { exclude: ['health', 'ready'] });
  app.useGlobalFilters(new AllExceptionsFilter());
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  return app;
}

/**
 * 720 rising prefix bars, then 720 evaluation bars: 10 rising, a 4-bar ~5%
 * pullback (trend-pullback entry), a long rise and a 40-bar 1%/bar fall that
 * exits through the trend break and produces closed trades.
 */
function scenarioCloses(): string[] {
  const closes: string[] = [];
  let price = 100;
  const push = (): void => {
    closes.push(price.toFixed(8));
  };
  const rise = (bars: number): void => {
    for (let index = 0; index < bars; index += 1) {
      price *= 1.001;
      push();
    }
  };

  rise(PREFIX_BARS);
  rise(10);
  for (let index = 0; index < 4; index += 1) {
    price *= 0.985;
    push();
  }
  rise(EVAL_BARS - 40 - 14);
  for (let index = EVAL_BARS - 40; index < EVAL_BARS; index += 1) {
    price *= 0.99;
    push();
  }

  return closes;
}

function candlesFor(tokenKey: string, closes: readonly string[]): SandboxCandleInput[] {
  return closes.map((close, index) => {
    const open = index === 0 ? close : (closes[index - 1] as string);
    return {
      tokenKey,
      timeframe: SANDBOX_TIMEFRAME,
      openTime: new Date(START_OPEN_TIME + index * HOUR),
      open,
      high: (Math.max(Number(open), Number(close)) * 1.0005).toFixed(8),
      low: (Math.min(Number(open), Number(close)) * 0.9995).toFixed(8),
      close,
      volumeUsd: '100000.000000000000000000',
      source: 'geckoterminal',
      fetchedAt: new Date(TO_TIME),
    };
  });
}

function replayBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    name: 'Historical replay',
    tokenKeys: [...TOKENS],
    periodDays: PERIOD_DAYS,
    initialCapitalUsd: '1000.00',
    seed: 7,
    settings: REPLAY_SETTINGS,
    paper: DEFAULT_PAPER_SETTINGS,
    ...overrides,
  };
}

/**
 * Canonical report identity: run-id-derived fields are replaced/normalized so
 * two independent replays over the same window/candles/settings can be compared
 * by one report hash. Everything else (period, metrics, equity, trades minus
 * generated ids, intents minus generated ids/text, counterfactuals) stays.
 */
function canonicalReportHash(report: SandboxRunReport): string {
  const clone = structuredClone(report) as unknown as Record<string, unknown>;
  delete clone.reportHash;
  clone.runId = 'canonical-run';
  clone.eventHash = '0'.repeat(64);
  (clone.config as Record<string, unknown>).runId = 'canonical-run';

  const strip = (rows: unknown, fields: readonly string[]): void => {
    for (const row of rows as Array<Record<string, unknown>>) {
      for (const field of fields) delete row[field];
    }
  };
  strip(clone.trades, ['tradeId', 'entryIntentId', 'exitIntentId']);
  strip(clone.positions, ['entryIntentId']);
  strip(clone.intentJournal, ['intentId', 'reasonText']);

  return reportHash(clone as unknown as RunReport);
}

/** Trades without the run-id-derived identifiers, for a cross-replay compare. */
function tradeOutcomes(report: SandboxRunReport): unknown[] {
  return report.trades.map((trade) => ({
    tokenId: trade.tokenId,
    strategyKey: trade.strategyKey,
    strategyVersion: trade.strategyVersion,
    entryAt: trade.entryAt,
    entryPriceUsd: trade.entryPriceUsd,
    entryAmount: trade.entryAmount,
    entryNotionalUsd: trade.entryNotionalUsd,
    entryFeeUsd: trade.entryFeeUsd,
    entryCostBasisUsd: trade.entryCostBasisUsd,
    exitAt: trade.exitAt,
    exitPriceUsd: trade.exitPriceUsd,
    exitAmount: trade.exitAmount,
    exitNotionalUsd: trade.exitNotionalUsd,
    exitFeeUsd: trade.exitFeeUsd,
    exitReasonCode: trade.exitReasonCode,
    realizedPnlUsd: trade.realizedPnlUsd,
    status: trade.status,
  }));
}

describe('Sandbox historical replay (e2e)', () => {
  let app: NestFastifyApplication;
  let db: Database | null = null;
  let pool: ReturnType<typeof createDb>['pool'] | null = null;
  let candles: SandboxRepository | null = null;
  let replays: SandboxReplayRepository | null = null;
  let worker: SandboxReplayWorkerService | null = null;

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

  function requireRepositories(): {
    candles: SandboxRepository;
    replays: SandboxReplayRepository;
  } {
    if (!candles || !replays) throw new Error('test database is not configured');
    return { candles, replays };
  }

  async function createUniverse(
    cookies: TestCookies,
  ): Promise<{ tokenAId: string; tokenBId: string }> {
    const tokenA = await api(app, cookies, 'post', '/api/v1/sandbox/tokens')
      .send({ tokenKey: TOKEN_A, symbol: 'AAA', name: 'Alpha' })
      .expect(201);
    const tokenB = await api(app, cookies, 'post', '/api/v1/sandbox/tokens')
      .send({ tokenKey: TOKEN_B, symbol: 'BBB', name: 'Beta' })
      .expect(201);
    expect(tokenA.body.tokenKey).toBe(TOKEN_A);
    expect(tokenB.body.tokenKey).toBe(TOKEN_B);
    return { tokenAId: tokenA.body.id as string, tokenBId: tokenB.body.id as string };
  }

  /** Seeds the full 60-day 1h store for both tokens (prefix + evaluation). */
  async function seedCandles(): Promise<void> {
    const { candles: repository } = requireRepositories();
    const closes = scenarioCloses();
    expect(closes).toHaveLength(PREFIX_BARS + EVAL_BARS);
    for (const tokenKey of TOKENS) {
      await repository.upsertCandles(candlesFor(tokenKey, closes));
    }
  }

  async function createReplay(
    cookies: TestCookies,
    overrides: Record<string, unknown> = {},
  ): Promise<SandboxReplayDetail> {
    const response = await api(app, cookies, 'post', '/api/v1/sandbox/replays')
      .send(replayBody(overrides))
      .expect(202);
    return sandboxReplayDetailSchema.parse(response.body);
  }

  async function getReplay(cookies: TestCookies, id: string): Promise<SandboxReplayDetail> {
    const response = await api(app, cookies, 'get', `/api/v1/sandbox/replays/${id}`).expect(200);
    return sandboxReplayDetailSchema.parse(response.body);
  }

  async function getReport(cookies: TestCookies, id: string): Promise<SandboxRunReport> {
    const response = await api(
      app,
      cookies,
      'get',
      `/api/v1/sandbox/replays/${id}/report.json`,
    ).expect(200);
    return sandboxReplayReportResponseSchema.parse(response.body).report;
  }

  async function replayAuditActions(id: string): Promise<string[]> {
    if (!db) throw new Error('test database is not configured');
    const rows = await db
      .select({ action: auditLog.action })
      .from(auditLog)
      .where(and(eq(auditLog.entityType, 'sandbox_replay'), eq(auditLog.entityId, id)));
    return rows.map((row) => row.action).sort();
  }

  /** One worker pass with the deterministic in-process executor (no thread). */
  async function runReplayWorker(): Promise<void> {
    if (!worker) throw new Error('replay worker is not available');
    await worker.runOnce(new Date(), new InlineReplayExecutor());
  }

  async function completeReplay(cookies: TestCookies): Promise<SandboxReplayDetail> {
    const created = await createReplay(cookies);
    await runReplayWorker();
    const detail = await getReplay(cookies, created.id);
    expect(detail.status).toBe('completed');
    return detail;
  }

  beforeAll(async () => {
    app = await bootApp();
    worker = app.get(SandboxReplayWorkerService);

    if (canRun) {
      const created = createDb(process.env.DATABASE_URL ?? '');
      db = created.db;
      pool = created.pool;
      candles = new SandboxRepository(db);
      replays = new SandboxReplayRepository(db);
    }
  }, 30_000);

  beforeEach(async () => {
    if (!db) return;
    // Candle rows are shared market data (no owner FK); isolate this suite from
    // fixtures left by other sandbox specs. Truncating users cascades to the
    // owner-scoped sandbox tables.
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

  it('requires authentication for every historical replay route', async () => {
    const server = app.getHttpServer();
    const replayId = '33333333-3333-4333-8333-333333333333';
    const routes: Array<['get' | 'post', string]> = [
      ['post', '/api/v1/sandbox/replays/preflight'],
      ['post', '/api/v1/sandbox/replays'],
      ['get', '/api/v1/sandbox/replays'],
      ['get', `/api/v1/sandbox/replays/${replayId}`],
      ['get', `/api/v1/sandbox/replays/${replayId}/report.json`],
      ['get', `/api/v1/sandbox/replays/${replayId}/report.md`],
      ['post', `/api/v1/sandbox/replays/${replayId}/cancel`],
      ['post', `/api/v1/sandbox/replays/${replayId}/archive`],
    ];

    for (const [method, path] of routes) {
      const response = await request(server)[method](path).expect(401);
      expect(response.body, `${method.toUpperCase()} ${path}`).toMatchObject({
        error: { code: 'AUTH_REQUIRED' },
      });
    }

    // A replay never exposes a manual buy/add route.
    await request(server).post(`/api/v1/sandbox/replays/${replayId}/buy`).expect(404);
    await request(server).post(`/api/v1/sandbox/replays/${replayId}/add`).expect(404);
  });

  it.runIf(canRun)(
    'runs a queued replay end to end and serves the deterministic report',
    async () => {
      const cookies = await setupOwner(app);
      await createUniverse(cookies);
      await seedCandles();

      // --- Preflight: full evaluation window plus lookback prefix ----------
      const preflight = await api(app, cookies, 'post', '/api/v1/sandbox/replays/preflight')
        .send({ tokenKeys: TOKENS, periodDays: PERIOD_DAYS })
        .expect(200);
      const prepared = sandboxReplayPreflightResponseSchema.parse(preflight.body);
      expect(prepared.status).toBe('ok');
      expect(prepared.fromTime).toBe(new Date(FROM_TIME).toISOString());
      expect(prepared.toTime).toBe(new Date(TO_TIME).toISOString());
      expect(prepared.coverage).toHaveLength(TOKENS.length);
      for (const coverage of prepared.coverage) {
        expect(coverage).toMatchObject({
          available: EVAL_BARS,
          required: EVAL_BARS,
          gaps: 0,
          prefixBars: PREFIX_BARS,
          synthetic: false,
          status: 'ok',
        });
      }

      // The store is 60 days: a 180-day request is partial and must be blocked
      // unless the owner explicitly accepts a shorter window.
      const longPreflight = await api(app, cookies, 'post', '/api/v1/sandbox/replays/preflight')
        .send({ tokenKeys: TOKENS, periodDays: 180 })
        .expect(200);
      expect(sandboxReplayPreflightResponseSchema.parse(longPreflight.body).status).toBe('partial');
      const blocked = await api(app, cookies, 'post', '/api/v1/sandbox/replays')
        .send(replayBody({ periodDays: 180 }))
        .expect(409);
      expect(blocked.body).toMatchObject({
        error: { code: 'SANDBOX_REPLAY_WINDOW_TOO_SHORT' },
      });

      // --- Create queued ----------------------------------------------------
      const created = await createReplay(cookies);
      expect(created).toMatchObject({
        status: 'queued',
        periodDays: PERIOD_DAYS,
        initialCapitalUsd: '1000.00',
        seed: 7,
        fromTime: new Date(FROM_TIME).toISOString(),
        toTime: new Date(TO_TIME).toISOString(),
        eventCount: null,
        eventHash: null,
        dataSnapshotId: null,
        candleSnapshotHash: null,
        reportHash: null,
        startedAt: null,
        finishedAt: null,
        archivedAt: null,
      });
      expect(created.settings.maxPositions).toBe(1);
      expect(created.paper).toEqual(DEFAULT_PAPER_SETTINGS);

      const queuedList = sandboxReplayListResponseSchema.parse(
        (await api(app, cookies, 'get', '/api/v1/sandbox/replays').expect(200)).body,
      );
      expect(queuedList.total).toBe(1);
      expect(queuedList.replays[0]).toMatchObject({ id: created.id, status: 'queued' });

      const queuedDetail = await getReplay(cookies, created.id);
      expect(queuedDetail.status).toBe('queued');

      const notReady = await api(
        app,
        cookies,
        'get',
        `/api/v1/sandbox/replays/${created.id}/report.json`,
      ).expect(409);
      expect(notReady.body).toMatchObject({ error: { code: 'SANDBOX_REPLAY_NOT_COMPLETED' } });

      // A failed Markdown read must still use the JSON error type, not markdown.
      const notReadyMarkdown = await api(
        app,
        cookies,
        'get',
        `/api/v1/sandbox/replays/${created.id}/report.md`,
      ).expect(409);
      expect(notReadyMarkdown.headers['content-type']).toContain('application/json');
      expect(notReadyMarkdown.body).toMatchObject({
        error: { code: 'SANDBOX_REPLAY_NOT_COMPLETED' },
      });

      // --- One worker pass completes it ------------------------------------
      await runReplayWorker();

      const completed = await getReplay(cookies, created.id);
      expect(completed.status).toBe('completed');
      expect(completed.startedAt).not.toBeNull();
      expect(completed.finishedAt).not.toBeNull();
      expect(completed.reportHash).toMatch(/^[0-9a-f]{64}$/);
      expect(completed.eventHash).toMatch(/^[0-9a-f]{64}$/);
      expect(completed.eventCount).toBeGreaterThan(0);
      expect(completed.dataSnapshotId).toMatch(/^[0-9a-f]{64}$/);
      expect(completed.dataSnapshotId).toBe(completed.candleSnapshotHash);
      expect(completed.finalEquityUsd).not.toBeNull();
      expect(completed.returnPct).not.toBeNull();
      expect(completed.maxDrawdownPct).not.toBeNull();

      const reportResponse = await api(
        app,
        cookies,
        'get',
        `/api/v1/sandbox/replays/${created.id}/report.json`,
      ).expect(200);
      expect(reportResponse.headers['cache-control']).toBe('no-store');
      const wrapper = sandboxReplayReportResponseSchema.parse(reportResponse.body);
      expect(wrapper.executionMode).toBe('historical-paper');
      expect(wrapper.notes).toHaveLength(6);
      const report = wrapper.report;

      expect(report.runId).toBe(created.id);
      expect(report.config.runId).toBe(created.id);
      expect(report.config.seed).toBe(7);
      expect(report.config.initialCapitalUsd).toBe('1000.00');
      expect(report.config.timeframe).toBe('1h');
      expect(report.config.tokenIds).toEqual([...TOKENS].sort());
      expect(report.dataSnapshotId).toBe(completed.dataSnapshotId);
      expect(report.reportHash).toBe(completed.reportHash);
      expect(report.eventCount).toBe(completed.eventCount);
      expect(report.eventHash).toBe(completed.eventHash);
      expect(report.metrics.finalEquityUsd).toBe(completed.finalEquityUsd);
      expect(report.metrics.totalReturnPct).toBe(completed.returnPct);
      expect(report.metrics.maxDrawdownPct).toBe(completed.maxDrawdownPct);

      // The report period is exactly the 30-day evaluation window; the 30-day
      // prefix is lookback only and is not evaluated.
      expect(report.period.bars).toBe(EVAL_BARS);
      expect(report.period.firstBar).toBe(FROM_TIME + HOUR);
      expect(report.period.lastBar).toBe(TO_TIME);
      expect(report.period.tokens).toEqual([...TOKENS].sort());
      expect(report.equityCurve).toHaveLength(EVAL_BARS);
      expect(report.equityCurve[0]?.clockTime).toBe(report.period.firstBar);
      expect(report.equityCurve.at(-1)?.clockTime).toBe(report.period.lastBar);

      expect(report.trades.length).toBeGreaterThan(0);
      expect(report.trades.every((trade) => trade.status === 'closed')).toBe(true);
      expect(report.intentJournal.length).toBeGreaterThan(0);
      expect(report.intentJournal.some((intent) => intent.status === 'filled')).toBe(true);
      expect(report.positions).toHaveLength(0);
      expect(report.counterfactuals.length).toBeGreaterThan(0);
      const dropped = report.counterfactuals.find(
        (record) => record.reasonCode === 'ALLOC_MAX_POSITIONS',
      );
      expect(dropped).toBeDefined();
      expect(dropped).toMatchObject({ hindsight: true, usedForDecisions: false });
      expect(report.reconciliationOk).toBe(true);
      expect(report.reconciliationChecks.length).toBeGreaterThan(0);

      const markdown = await api(
        app,
        cookies,
        'get',
        `/api/v1/sandbox/replays/${created.id}/report.md`,
      ).expect(200);
      expect(markdown.headers['content-type']).toContain('text/markdown');
      expect(markdown.text.startsWith('# Historical paper replay report')).toBe(true);
      expect(markdown.text).toContain('historical-paper');
      expect(markdown.text).toContain(report.reportHash);
      expect(markdown.text).toContain(completed.candleSnapshotHash as string);

      // A stored report is never recomputed on a GET: two reads are identical.
      const secondRead = await getReport(cookies, created.id);
      expect(secondRead.reportHash).toBe(report.reportHash);
      expect(secondRead.trades).toEqual(report.trades);

      // --- Audit: exact rows, no duplicates --------------------------------
      expect(await replayAuditActions(created.id)).toEqual(
        ['sandbox.replay_created', 'sandbox.replay_started', 'sandbox.replay_completed'].sort(),
      );

      // --- A second worker pass is a no-op ---------------------------------
      await runReplayWorker();
      const afterEmptyPass = await getReplay(cookies, created.id);
      expect(afterEmptyPass.reportHash).toBe(completed.reportHash);
      expect(await replayAuditActions(created.id)).toEqual(
        ['sandbox.replay_created', 'sandbox.replay_started', 'sandbox.replay_completed'].sort(),
      );

      // --- Archive: soft hide, terminal only, reads stay available ---------
      const archived = sandboxReplayDetailSchema.parse(
        (
          await api(app, cookies, 'post', `/api/v1/sandbox/replays/${created.id}/archive`).expect(
            200,
          )
        ).body,
      );
      expect(archived.archivedAt).not.toBeNull();

      expect(
        sandboxReplayListResponseSchema.parse(
          (await api(app, cookies, 'get', '/api/v1/sandbox/replays').expect(200)).body,
        ).total,
      ).toBe(0);
      const archivedList = sandboxReplayListResponseSchema.parse(
        (await api(app, cookies, 'get', '/api/v1/sandbox/replays?includeArchived=true').expect(200))
          .body,
      );
      expect(archivedList.total).toBe(1);
      expect(archivedList.replays[0]?.archivedAt).not.toBeNull();
      expect((await getReplay(cookies, created.id)).archivedAt).not.toBeNull();
      expect((await getReport(cookies, created.id)).reportHash).toBe(completed.reportHash);

      // Terminal-only transitions cannot repeat.
      await api(app, cookies, 'post', `/api/v1/sandbox/replays/${created.id}/archive`).expect(409);
      await api(app, cookies, 'post', `/api/v1/sandbox/replays/${created.id}/cancel`).expect(409);

      expect(await replayAuditActions(created.id)).toEqual(
        [
          'sandbox.replay_created',
          'sandbox.replay_started',
          'sandbox.replay_completed',
          'sandbox.replay_archived',
        ].sort(),
      );

      // No manual buy/add route exists for a replay.
      await api(app, cookies, 'post', `/api/v1/sandbox/replays/${created.id}/buy`).expect(404);
      await api(app, cookies, 'post', `/api/v1/sandbox/replays/${created.id}/add`).expect(404);
    },
    180_000,
  );

  it.runIf(canRun)(
    're-derives the stored report from the persisted gzip candle snapshot',
    async () => {
      const cookies = await setupOwner(app);
      await createUniverse(cookies);
      await seedCandles();
      const completed = await completeReplay(cookies);

      if (!db) throw new Error('test database is not configured');
      const [stored] = await db
        .select({
          candleSnapshot: sandboxReplays.candleSnapshot,
          candleSnapshotHash: sandboxReplays.candleSnapshotHash,
          dataSnapshotId: sandboxReplays.dataSnapshotId,
          report: sandboxReplays.report,
          reportHash: sandboxReplays.reportHash,
          eventCount: sandboxReplays.eventCount,
          eventHash: sandboxReplays.eventHash,
          seed: sandboxReplays.seed,
          settings: sandboxReplays.settings,
          paper: sandboxReplays.paper,
          initialCapitalUsd: sandboxReplays.initialCapitalUsd,
          fromTime: sandboxReplays.fromTime,
          toTime: sandboxReplays.toTime,
        })
        .from(sandboxReplays)
        .where(eq(sandboxReplays.id, completed.id));
      if (!stored?.candleSnapshot || !stored.candleSnapshotHash || !stored.report) {
        throw new Error('completed replay is missing its snapshot or report');
      }

      const snapshot = decodeReplaySnapshot(
        stored.candleSnapshot,
        stored.candleSnapshotHash,
        stored.dataSnapshotId,
      );
      expect(snapshot.hash).toBe(stored.candleSnapshotHash);
      expect(snapshot.dataSnapshotId).toBe(stored.dataSnapshotId);
      // The persisted snapshot is exactly prefix + evaluation, never more.
      expect(snapshot.candles).toHaveLength(TOKENS.length * (PREFIX_BARS + EVAL_BARS));
      const openTimes = snapshot.candles.map((candle) => candle.openTime);
      expect(Math.min(...openTimes)).toBe(START_OPEN_TIME);
      expect(Math.max(...openTimes)).toBe(TO_TIME - HOUR);
      expect(openTimes.every((openTime) => openTime < TO_TIME)).toBe(true);

      const storedReport = sandboxRunReportSchema.parse(stored.report);
      const tokenIds = [...TOKENS].sort();
      const config: PaperRunConfig = {
        runId: completed.id,
        seed: stored.seed,
        timeframe: '1h',
        tokenIds,
        initialCapitalUsd: stored.initialCapitalUsd,
        ...toCorePaperSettings(stored.paper),
      };
      const redriven = await runPaperFromCandles({
        runId: completed.id,
        seed: stored.seed,
        configVersion: storedReport.configVersion,
        dataSnapshotId: snapshot.dataSnapshotId,
        tokenIds,
        candles: snapshot.candles,
        settings: toCoreDecisionSettings(stored.settings),
        paper: toCorePaperSettings(stored.paper),
        initialCapitalUsd: stored.initialCapitalUsd,
        evaluateFrom: stored.fromTime.getTime(),
      });

      // The same snapshot/config/seed/evaluateFrom reproduce the exact report.
      expect(paperConfigVersion(config)).toBe(storedReport.configVersion);
      expect(redriven.report.configVersion).toBe(storedReport.configVersion);
      expect(redriven.report.period.bars).toBe(EVAL_BARS);
      expect(redriven.report.reportHash).toBe(stored.reportHash);
      expect(redriven.report.eventCount).toBe(stored.eventCount);
      expect(redriven.report.eventHash).toBe(stored.eventHash);
      expect(redriven.report.metrics).toEqual(storedReport.metrics);
      expect(redriven.report.trades).toEqual(storedReport.trades);
      expect(redriven.report.equityCurve).toEqual(storedReport.equityCurve);
      expect(redriven.report.counterfactuals).toEqual(storedReport.counterfactuals);
      expect(redriven.report.intentJournal).toEqual(storedReport.intentJournal);
      expect(redriven.report.dataSnapshotId).toBe(stored.dataSnapshotId);
    },
    180_000,
  );

  it.runIf(canRun)(
    'does not look ahead: candles after to_time cannot change an earlier replay',
    async () => {
      const cookies = await setupOwner(app);
      await createUniverse(cookies);
      await seedCandles();
      const first = await completeReplay(cookies);
      const firstReport = await getReport(cookies, first.id);

      if (!db) throw new Error('test database is not configured');
      const { candles: candleRepository, replays: replayRepository } = requireRepositories();

      // Add 48 bars *after* `to_time` with hostile prices (a 5x spike then a
      // 50% crash). A look-ahead bug would make the replay see them.
      const futureCloses: string[] = [];
      let price = 300;
      for (let index = 0; index < 48; index += 1) {
        price *= index < 24 ? 1.07 : 0.97;
        futureCloses.push(price.toFixed(8));
      }
      const future: SandboxCandleInput[] = [];
      for (const tokenKey of TOKENS) {
        for (let index = 0; index < futureCloses.length; index += 1) {
          const openTime = TO_TIME + index * HOUR;
          const close = futureCloses[index] as string;
          const open =
            index === 0 ? (futureCloses[0] as string) : (futureCloses[index - 1] as string);
          future.push({
            tokenKey,
            timeframe: SANDBOX_TIMEFRAME,
            openTime: new Date(openTime),
            open,
            high: (Math.max(Number(open), Number(close)) * 1.01).toFixed(8),
            low: (Math.min(Number(open), Number(close)) * 0.99).toFixed(8),
            close,
            volumeUsd: '100000.000000000000000000',
            source: 'geckoterminal',
            fetchedAt: new Date(openTime),
          });
        }
      }
      await candleRepository.upsertCandles(future);

      // The completed row is untouched by the new candles.
      const [afterInsert] = await db
        .select({
          status: sandboxReplays.status,
          report: sandboxReplays.report,
          reportHash: sandboxReplays.reportHash,
          dataSnapshotId: sandboxReplays.dataSnapshotId,
          candleSnapshotHash: sandboxReplays.candleSnapshotHash,
        })
        .from(sandboxReplays)
        .where(eq(sandboxReplays.id, first.id));
      expect(afterInsert?.status).toBe('completed');
      expect(afterInsert?.reportHash).toBe(first.reportHash);
      expect(afterInsert?.dataSnapshotId).toBe(first.dataSnapshotId);
      expect(afterInsert?.candleSnapshotHash).toBe(first.candleSnapshotHash);
      expect(sandboxRunReportSchema.parse(afterInsert?.report)).toEqual(firstReport);

      // The loader window is half-open `[..., to_time)`: future candles are
      // never part of the replay input, so the snapshot identity is unchanged.
      const reloaded = await replayRepository.loadReplayCandles(
        TOKENS,
        new Date(TO_TIME - 180 * DAY),
        new Date(TO_TIME),
      );
      expect(reloaded.every((candle) => candle.openTime < TO_TIME)).toBe(true);
      expect(snapshotReplayCandles(reloaded).dataSnapshotId).toBe(first.dataSnapshotId);

      // A second replay over the *same* explicit window, with the future
      // candles present, must produce the same report identity modulo run id.
      const second = await replayRepository.createReplay({
        userId: await ownerId(),
        name: 'Historical replay (after future candles)',
        tokenKeys: TOKENS,
        periodDays: PERIOD_DAYS,
        fromTime: new Date(FROM_TIME),
        toTime: new Date(TO_TIME),
        initialCapitalUsd: '1000.00',
        seed: 7,
        settings: REPLAY_SETTINGS as unknown as Record<string, unknown>,
        paper: DEFAULT_PAPER_SETTINGS as unknown as Record<string, unknown>,
        queuedAt: new Date(),
      });
      await runReplayWorker();

      const secondCompleted = await getReplay(cookies, second.id);
      expect(secondCompleted.status).toBe('completed');
      expect(secondCompleted.id).not.toBe(first.id);
      expect(secondCompleted.dataSnapshotId).toBe(first.dataSnapshotId);
      expect(secondCompleted.eventCount).toBe(first.eventCount);

      const secondReport = await getReport(cookies, second.id);
      expect(secondReport.reportHash).not.toBe(firstReport.reportHash);
      expect(canonicalReportHash(secondReport)).toBe(canonicalReportHash(firstReport));
      expect(tradeOutcomes(secondReport)).toEqual(tradeOutcomes(firstReport));
      expect(secondReport.period).toEqual(firstReport.period);
      expect(secondReport.metrics).toEqual(firstReport.metrics);
      expect(secondReport.equityCurve).toEqual(firstReport.equityCurve);
      expect(secondReport.counterfactuals).toEqual(firstReport.counterfactuals);
      expect(secondReport.reconciliationOk).toBe(true);
    },
    180_000,
  );

  it.runIf(canRun)(
    'cancels only queued replays and archives only terminal replays',
    async () => {
      const cookies = await setupOwner(app);
      await createUniverse(cookies);
      await seedCandles();

      const queued = await createReplay(cookies);
      const notReady = await api(
        app,
        cookies,
        'get',
        `/api/v1/sandbox/replays/${queued.id}/report.json`,
      ).expect(409);
      expect(notReady.body).toMatchObject({ error: { code: 'SANDBOX_REPLAY_NOT_COMPLETED' } });

      const cancelled = sandboxReplayDetailSchema.parse(
        (await api(app, cookies, 'post', `/api/v1/sandbox/replays/${queued.id}/cancel`).expect(200))
          .body,
      );
      expect(cancelled.status).toBe('cancelled');
      expect(cancelled.finishedAt).not.toBeNull();
      expect(cancelled.reportHash).toBeNull();
      expect(await replayAuditActions(queued.id)).toEqual(
        ['sandbox.replay_created', 'sandbox.replay_cancelled'].sort(),
      );

      // The worker has nothing to claim and never resurrects a cancelled row.
      await runReplayWorker();
      const stillCancelled = await getReplay(cookies, queued.id);
      expect(stillCancelled.status).toBe('cancelled');
      expect(await replayAuditActions(queued.id)).toEqual(
        ['sandbox.replay_created', 'sandbox.replay_cancelled'].sort(),
      );

      // Cancel is queued-only.
      const secondCancel = await api(
        app,
        cookies,
        'post',
        `/api/v1/sandbox/replays/${queued.id}/cancel`,
      ).expect(409);
      expect(secondCancel.body).toMatchObject({
        error: { code: 'SANDBOX_REPLAY_INVALID_STATUS' },
      });

      // A queued replay cannot be archived.
      const second = await createReplay(cookies);
      await api(app, cookies, 'post', `/api/v1/sandbox/replays/${second.id}/archive`).expect(409);

      // A running replay cannot be cancelled (bounded, not cancellable in v1).
      if (!db) throw new Error('test database is not configured');
      await db
        .update(sandboxReplays)
        .set({ status: 'running', startedAt: new Date(), updatedAt: new Date() })
        .where(eq(sandboxReplays.id, second.id));
      const runningCancel = await api(
        app,
        cookies,
        'post',
        `/api/v1/sandbox/replays/${second.id}/cancel`,
      ).expect(409);
      expect(runningCancel.body).toMatchObject({
        error: { code: 'SANDBOX_REPLAY_INVALID_STATUS' },
      });

      // Cancel then archive a queued replay; archive hides it by default.
      const third = await createReplay(cookies);
      await api(app, cookies, 'post', `/api/v1/sandbox/replays/${third.id}/cancel`).expect(200);
      const archived = sandboxReplayDetailSchema.parse(
        (await api(app, cookies, 'post', `/api/v1/sandbox/replays/${third.id}/archive`).expect(200))
          .body,
      );
      expect(archived.status).toBe('cancelled');
      expect(archived.archivedAt).not.toBeNull();

      // The queued->cancelled row and the running row stay visible; the
      // archived one is hidden from the default list.
      expect(
        sandboxReplayListResponseSchema.parse(
          (await api(app, cookies, 'get', '/api/v1/sandbox/replays').expect(200)).body,
        ).total,
      ).toBe(2);
      const archivedList = sandboxReplayListResponseSchema.parse(
        (await api(app, cookies, 'get', '/api/v1/sandbox/replays?includeArchived=true').expect(200))
          .body,
      );
      expect(archivedList.total).toBe(3);
      expect(archivedList.replays.map((replay) => replay.id).sort()).toEqual(
        [queued.id, second.id, third.id].sort(),
      );

      await api(app, cookies, 'post', `/api/v1/sandbox/replays/${third.id}/archive`).expect(409);
      expect(await replayAuditActions(third.id)).toEqual(
        ['sandbox.replay_created', 'sandbox.replay_cancelled', 'sandbox.replay_archived'].sort(),
      );
    },
    180_000,
  );

  it.runIf(canRun)(
    'requeues and completes a running replay only after the worker lock is free',
    async () => {
      const cookies = await setupOwner(app);
      await createUniverse(cookies);
      await seedCandles();

      if (!db || !pool) throw new Error('test database is not configured');

      const created = await createReplay(cookies);
      const { replays: replayRepository } = requireRepositories();
      // Simulate a crash after claim/start but before the report was stored.
      expect(await replayRepository.markReplayRunning(created.id, new Date())).toBe(true);
      expect((await getReplay(cookies, created.id)).status).toBe('running');

      const lockKey = 'nexter:sandbox-replay-worker';
      const lockClient = await pool.connect();
      try {
        const held = await lockClient.query<{ locked: boolean }>(
          'select pg_try_advisory_lock(hashtext($1)::bigint) as locked',
          [lockKey],
        );
        expect(held.rows[0]?.locked).toBe(true);

        // Another instance holds the worker lock: no sweep, no claim.
        await runReplayWorker();
        expect((await getReplay(cookies, created.id)).status).toBe('running');
        expect(await replayAuditActions(created.id)).toEqual(['sandbox.replay_created']);
      } finally {
        await lockClient.query('select pg_advisory_unlock(hashtext($1)::bigint)', [lockKey]);
        lockClient.release();
      }

      // Lock free: the stale `running` row is requeued and completed once.
      await runReplayWorker();
      const completed = await getReplay(cookies, created.id);
      expect(completed.status).toBe('completed');
      expect(completed.reportHash).toMatch(/^[0-9a-f]{64}$/);
      expect(completed.startedAt).not.toBeNull();
      expect(completed.finishedAt).not.toBeNull();
      expect(await replayAuditActions(created.id)).toEqual(
        [
          'sandbox.replay_created',
          'sandbox.replay_requeued',
          'sandbox.replay_started',
          'sandbox.replay_completed',
        ].sort(),
      );

      const report = await getReport(cookies, created.id);
      expect(report.reportHash).toBe(completed.reportHash);

      // A further pass is idempotent: one row, one report, no new audit rows.
      await runReplayWorker();
      const after = await getReplay(cookies, created.id);
      expect(after.reportHash).toBe(completed.reportHash);
      expect(await replayAuditActions(created.id)).toEqual(
        [
          'sandbox.replay_created',
          'sandbox.replay_requeued',
          'sandbox.replay_started',
          'sandbox.replay_completed',
        ].sort(),
      );
      const rows = await db
        .select({ id: sandboxReplays.id })
        .from(sandboxReplays)
        .where(eq(sandboxReplays.id, created.id));
      expect(rows).toHaveLength(1);
      expect((await getReport(cookies, created.id)).reportHash).toBe(report.reportHash);
    },
    180_000,
  );

  it.runIf(canRun)('hides another owner replay and report behind 404', async () => {
    const cookies = await setupOwner(app);
    if (!db) throw new Error('test database is not configured');
    const { replays: replayRepository } = requireRepositories();

    // The app is single-owner; drop the singleton guard for this check only.
    await db.execute(sql`drop index if exists users_singleton_unique`);
    const [secondOwner] = await db
      .insert(users)
      .values({
        email: `sandbox-replays-e2e-second-${Date.now()}@example.com`,
        passwordHash: 'not-a-real-hash',
      })
      .returning({ id: users.id });
    if (!secondOwner) throw new Error('second owner insert returned no row');

    try {
      const foreign = await replayRepository.createReplay({
        userId: secondOwner.id,
        name: 'Foreign replay',
        tokenKeys: [TOKEN_A],
        periodDays: PERIOD_DAYS,
        fromTime: new Date(FROM_TIME),
        toTime: new Date(TO_TIME),
        initialCapitalUsd: '1000.00',
        seed: 7,
        settings: REPLAY_SETTINGS as unknown as Record<string, unknown>,
        paper: DEFAULT_PAPER_SETTINGS as unknown as Record<string, unknown>,
        queuedAt: new Date(),
      });

      await api(app, cookies, 'get', `/api/v1/sandbox/replays/${foreign.id}`).expect(404);
      await api(app, cookies, 'get', `/api/v1/sandbox/replays/${foreign.id}/report.json`).expect(
        404,
      );
      const foreignMarkdown = await api(
        app,
        cookies,
        'get',
        `/api/v1/sandbox/replays/${foreign.id}/report.md`,
      ).expect(404);
      expect(foreignMarkdown.headers['content-type']).toContain('application/json');
      expect(foreignMarkdown.body).toMatchObject({
        error: { code: 'SANDBOX_REPLAY_NOT_FOUND' },
      });
      await api(app, cookies, 'post', `/api/v1/sandbox/replays/${foreign.id}/cancel`).expect(404);
      await api(app, cookies, 'post', `/api/v1/sandbox/replays/${foreign.id}/archive`).expect(404);

      expect(
        sandboxReplayListResponseSchema.parse(
          (
            await api(app, cookies, 'get', '/api/v1/sandbox/replays?includeArchived=true').expect(
              200,
            )
          ).body,
        ).total,
      ).toBe(0);
    } finally {
      await restoreSingleton();
    }
  });
});

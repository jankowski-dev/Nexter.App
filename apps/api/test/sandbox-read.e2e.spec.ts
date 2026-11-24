import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import cookie from '@fastify/cookie';
import { createDb, users, type Database } from '@nexter/db';
import type { SandboxEventInput } from '@nexter/sandbox-core';
import {
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
import { sql } from 'drizzle-orm';
import { generateSync } from 'otplib';
import request, { type SuperAgentTest } from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { SandboxRepository } from '../src/modules/sandbox/sandbox.repository';
import { AllExceptionsFilter } from '../src/shared/errors/all-exceptions.filter';
import { assertDisposableTestDatabase } from './helpers/test-database';
import { makeOpenLedger, makeTick, seedSandboxRun } from './helpers/sandbox-fixtures';

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

function csrfFrom(response: request.Response): string {
  const setCookie = response.headers['set-cookie'];
  const cookies = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : [];
  const raw = cookies.find((value) => value.startsWith('nexter_csrf='));

  return raw?.split(';')[0]?.split('=')[1] ?? '';
}

function eventInput(runId: string, eventType: string): SandboxEventInput {
  return {
    runId,
    clockTime: '2026-11-24T00:00:00.000Z',
    module: 'run',
    eventType,
    severity: 'info',
    dataSnapshotId: 'snapshot-1',
    configVersion: 'config-1',
    seed: 1,
  };
}

describe('Sandbox read API (e2e)', () => {
  let app: NestFastifyApplication;
  let db: Database | null = null;
  let pool: ReturnType<typeof createDb>['pool'] | null = null;
  let repository: SandboxRepository | null = null;

  async function restoreSingleton(): Promise<void> {
    if (!db) return;
    await db.execute(sql`truncate table users restart identity cascade`);
    await db.execute(
      sql`create unique index if not exists users_singleton_unique on users ((true))`,
    );
  }

  async function setupOwner(agent: SuperAgentTest): Promise<string> {
    const setup = await agent
      .post('/api/v1/auth/setup')
      .send({
        setupToken: process.env.SETUP_TOKEN,
        email: `sandbox-read-e2e-${Date.now()}@example.com`,
        password,
      })
      .expect(201);
    const csrf = csrfFrom(setup);

    const totpSetup = await agent
      .post('/api/v1/auth/2fa/setup')
      .set('x-csrf-token', csrf)
      .expect(200);
    const secret = totpSetup.body.secret as string;

    await agent
      .post('/api/v1/auth/2fa/enable')
      .set('x-csrf-token', csrf)
      .send({ code: generateSync({ secret }) })
      .expect(200);

    return csrf;
  }

  async function ownerId(): Promise<string> {
    if (!db) throw new Error('test database is not configured');
    const [row] = await db.select({ id: users.id }).from(users).limit(1);
    if (!row) throw new Error('owner was not created');
    return row.id;
  }

  async function seedTickedRun(userId: string): Promise<string> {
    if (!db || !repository) throw new Error('test database is not configured');
    const { runId } = await seedSandboxRun(db, { userId, status: 'draft' });
    const open = makeOpenLedger();
    const tick = makeTick(open.ledger, open.marked, open.intents);

    await repository.commitTick(runId, async ({ eventLog }) => {
      await eventLog.append(eventInput(runId, 'run.started'));
      await eventLog.append(eventInput(runId, 'run.ticked'));
      return tick;
    });

    return runId;
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();

    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    await app.register(cookie as any);
    app.setGlobalPrefix('api/v1', { exclude: ['health', 'ready'] });
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
    await app.getHttpAdapter().getInstance().ready();

    if (canRun) {
      const created = createDb(process.env.DATABASE_URL ?? '');
      db = created.db;
      pool = created.pool;
      repository = new SandboxRepository(db);
    }
  }, 30_000);

  beforeEach(async () => {
    if (db) await db.execute(sql`truncate table users restart identity cascade`);
  });

  afterAll(async () => {
    try {
      await restoreSingleton();
    } finally {
      await app.close();
      await pool?.end();
    }
  });

  it('requires authentication for the sandbox reads', async () => {
    const overview = await request(app.getHttpServer()).get('/api/v1/sandbox/overview').expect(401);
    expect(overview.body).toMatchObject({ error: { code: 'AUTH_REQUIRED' } });

    const runs = await request(app.getHttpServer()).get('/api/v1/sandbox/runs').expect(401);
    expect(runs.body).toMatchObject({ error: { code: 'AUTH_REQUIRED' } });
  });

  it.runIf(canRun)('serves overview, run detail and the projection endpoints', async () => {
    const agent = request.agent(app.getHttpServer());
    await setupOwner(agent);
    const userId = await ownerId();
    const runId = await seedTickedRun(userId);

    const overview = await agent.get('/api/v1/sandbox/overview').expect(200);
    const parsedOverview = sandboxOverviewSchema.parse(overview.body);
    expect(parsedOverview.executionMode).toBe('live-paper');
    expect(parsedOverview.runs.running).toBe(1);
    expect(parsedOverview.activeRuns).toHaveLength(1);

    const runs = await agent.get('/api/v1/sandbox/runs').expect(200);
    const parsedRuns = sandboxRunsResponseSchema.parse(runs.body);
    expect(parsedRuns.total).toBe(1);
    expect(parsedRuns.runs[0]?.id).toBe(runId);

    const detail = await agent.get(`/api/v1/sandbox/runs/${runId}`).expect(200);
    const parsedDetail = sandboxRunDetailSchema.parse(detail.body);
    expect(parsedDetail.executionMode).toBe('live-paper');
    expect(parsedDetail.eventCount).toBe(2);
    expect(parsedDetail.openPositions).toBe(1);
    expect(parsedDetail.openTrades).toBe(1);

    const positions = await agent.get(`/api/v1/sandbox/runs/${runId}/positions`).expect(200);
    const parsedPositions = sandboxPositionsResponseSchema.parse(positions.body);
    expect(parsedPositions.positions).toHaveLength(1);
    expect(parsedPositions.positions[0]?.amount).toBe('1.99500000');
    expect(parsedPositions.positions[0]?.marketPriceUsd).toBe('105.00000000');

    const trades = await agent.get(`/api/v1/sandbox/runs/${runId}/trades`).expect(200);
    const parsedTrades = sandboxTradesResponseSchema.parse(trades.body);
    expect(parsedTrades.total).toBe(1);
    expect(parsedTrades.trades[0]?.status).toBe('open');

    const intents = await agent.get(`/api/v1/sandbox/runs/${runId}/intents`).expect(200);
    const parsedIntents = sandboxIntentsResponseSchema.parse(intents.body);
    expect(parsedIntents.total).toBe(1);
    expect(parsedIntents.intents[0]?.status).toBe('filled');

    const equity = await agent.get(`/api/v1/sandbox/runs/${runId}/equity`).expect(200);
    const parsedEquity = sandboxEquityResponseSchema.parse(equity.body);
    expect(parsedEquity.total).toBe(1);
    expect(parsedEquity.points[0]?.cashUsd).toMatch(/^\d+\.\d{2}$/);
    expect(parsedEquity.points[0]?.equityUsd).toBe(parsedDetail.equityUsd);
  });

  it.runIf(canRun)('paginates events deterministically by seq', async () => {
    const agent = request.agent(app.getHttpServer());
    await setupOwner(agent);
    const runId = await seedTickedRun(await ownerId());

    const first = await agent
      .get(`/api/v1/sandbox/runs/${runId}/events`)
      .query({ limit: 1 })
      .expect(200);
    const firstPage = sandboxEventsResponseSchema.parse(first.body);
    expect(firstPage.events.map((event) => event.seq)).toEqual([0]);
    expect(firstPage.hasMore).toBe(true);
    expect(firstPage.nextAfterSeq).toBe(0);

    const second = await agent
      .get(`/api/v1/sandbox/runs/${runId}/events`)
      .query({ afterSeq: 0, limit: 10 })
      .expect(200);
    const secondPage = sandboxEventsResponseSchema.parse(second.body);
    expect(secondPage.events.map((event) => event.seq)).toEqual([1]);
    expect(secondPage.hasMore).toBe(false);
    expect(secondPage.nextAfterSeq).toBe(1);

    const empty = await agent
      .get(`/api/v1/sandbox/runs/${runId}/events`)
      .query({ afterSeq: 1 })
      .expect(200);
    expect(sandboxEventsResponseSchema.parse(empty.body).events).toEqual([]);
  });

  it.runIf(canRun)('generates a stable live-paper JSON and Markdown report', async () => {
    const agent = request.agent(app.getHttpServer());
    await setupOwner(agent);
    const runId = await seedTickedRun(await ownerId());

    const first = await agent.get(`/api/v1/sandbox/runs/${runId}/report.json`).expect(200);
    const firstReport = sandboxReportResponseSchema.parse(first.body);
    expect(firstReport.executionMode).toBe('live-paper');
    expect(firstReport.report.runId).toBe(runId);
    expect(firstReport.report.eventCount).toBe(2);
    expect(firstReport.report.positions).toHaveLength(1);
    expect(firstReport.report.counterfactuals).toEqual([]);

    const second = await agent.get(`/api/v1/sandbox/runs/${runId}/report.json`).expect(200);
    const secondReport = sandboxReportResponseSchema.parse(second.body);
    expect(secondReport.report.reportHash).toBe(firstReport.report.reportHash);

    const markdown = await agent.get(`/api/v1/sandbox/runs/${runId}/report.md`).expect(200);
    expect(markdown.headers['content-type']).toContain('text/markdown');
    expect(markdown.text.startsWith('# Live paper run report')).toBe(true);
    expect(markdown.text).toContain('> Execution mode: `live-paper`');
    expect(markdown.text).toContain(firstReport.report.reportHash);
  });

  it.runIf(canRun)('returns 409 for a run without a report and 404 for unknown runs', async () => {
    const agent = request.agent(app.getHttpServer());
    await setupOwner(agent);
    const userId = await ownerId();
    if (!db) throw new Error('test database is not configured');
    const { runId: draftId } = await seedSandboxRun(db, { userId, status: 'draft' });

    const notReady = await agent.get(`/api/v1/sandbox/runs/${draftId}/report.json`).expect(409);
    expect(notReady.body).toMatchObject({ error: { code: 'SANDBOX_REPORT_NOT_READY' } });

    const missing = await agent
      .get('/api/v1/sandbox/runs/33333333-3333-4333-8333-333333333333')
      .expect(404);
    expect(missing.body).toMatchObject({ error: { code: 'SANDBOX_RUN_NOT_FOUND' } });
  });

  it.runIf(canRun)('hides another owner run behind 404', async () => {
    const agent = request.agent(app.getHttpServer());
    await setupOwner(agent);
    if (!db) throw new Error('test database is not configured');
    // The app is single-owner; drop the singleton guard for this isolation check.
    await db.execute(sql`drop index if exists users_singleton_unique`);
    const { runId: foreignRunId } = await seedSandboxRun(db, { status: 'draft' });

    const response = await agent.get(`/api/v1/sandbox/runs/${foreignRunId}`).expect(404);
    expect(response.body).toMatchObject({ error: { code: 'SANDBOX_RUN_NOT_FOUND' } });

    const report = await agent.get(`/api/v1/sandbox/runs/${foreignRunId}/report.json`).expect(404);
    expect(report.body).toMatchObject({ error: { code: 'SANDBOX_RUN_NOT_FOUND' } });
  });
});

import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import cookie from '@fastify/cookie';
import { generateSync } from 'otplib';
import request from 'supertest';
import { sql } from 'drizzle-orm';
import { createDb, tradeGroups, type Database } from '@nexter/db';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { AllExceptionsFilter } from '../src/shared/errors/all-exceptions.filter';

const canRun = Boolean(
  process.env.NEXTER_TEST_DB === '1' &&
  process.env.DATABASE_URL &&
  process.env.SETUP_TOKEN &&
  process.env.AUTH_ENCRYPTION_KEY,
);

const password = 'correct horse battery staple';

function csrfFrom(response: request.Response): string {
  const setCookie = response.headers['set-cookie'];
  const cookies = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : [];
  const raw = cookies.find((value) => value.startsWith('nexter_csrf='));
  return raw?.split(';')[0]?.split('=')[1] ?? '';
}

describe.runIf(canRun)('System status e2e', () => {
  let app: NestFastifyApplication;
  let db: Database;
  let pool: ReturnType<typeof createDb>['pool'];
  let emailCounter = 0;

  async function setupOwner(agent: ReturnType<typeof request.agent>) {
    const email = `system-e2e-${Date.now()}-${emailCounter++}@example.com`;
    const setup = await agent
      .post('/api/v1/auth/setup')
      .send({ setupToken: process.env.SETUP_TOKEN, email, password })
      .expect(201);
    const totpSetup = await agent
      .post('/api/v1/auth/2fa/setup')
      .set('x-csrf-token', csrfFrom(setup))
      .expect(200);
    const enabled = await agent
      .post('/api/v1/auth/2fa/enable')
      .set('x-csrf-token', csrfFrom(setup))
      .send({ code: generateSync({ secret: totpSetup.body.secret }) })
      .expect(200);
    return { userId: setup.body.user.id as string, csrf: csrfFrom(enabled) };
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    await app.register(cookie as any);
    app.setGlobalPrefix('api/v1', { exclude: ['health', 'ready'] });
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    const created = createDb(process.env.DATABASE_URL ?? '');
    db = created.db;
    pool = created.pool;
  }, 30_000);

  beforeEach(async () => {
    await db.execute(sql`truncate table users restart identity cascade`);
  });

  afterAll(async () => {
    await app.close();
    await pool.end();
  });

  it('returns an owner-only, secret-free status snapshot', async () => {
    const agent = request.agent(app.getHttpServer());
    await agent.get('/api/v1/settings/system-status').expect(401);

    await setupOwner(agent);
    const response = await agent.get('/api/v1/settings/system-status').expect(200);
    expect(response.body).toMatchObject({
      database: { ok: true },
      flags: {
        marketQuotesEnabled: expect.any(Boolean),
        botRunnerEnabled: expect.any(Boolean),
        portfolioSnapshotsEnabled: expect.any(Boolean),
        reconciliationEnabled: expect.any(Boolean),
        swapEnabled: expect.any(Boolean),
        swapExecutionEnabled: expect.any(Boolean),
        swapKillSwitch: expect.any(Boolean),
        rpcConfigured: { bsc: expect.any(Boolean), ethereum: expect.any(Boolean) },
      },
      quotes: {
        assets: expect.any(Number),
        quoted: expect.any(Number),
        missing: expect.any(Number),
        stale15m: expect.any(Number),
        bySource: expect.any(Object),
      },
      bots: {
        running: expect.any(Number),
        stale: expect.any(Number),
        errors24h: expect.any(Number),
      },
      swaps: {
        active: expect.any(Number),
        unaccounted: expect.any(Number),
        stuck: expect.any(Number),
        failed24h: expect.any(Number),
      },
      externalApis: expect.any(Array),
      indexer: expect.any(Array),
      warnings: expect.any(Array),
    });
    expect(response.body.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(JSON.stringify(response.body)).not.toContain('postgres://');
    expect(JSON.stringify(response.body)).not.toContain('DATABASE_URL');
    expect(JSON.stringify(response.body)).not.toContain('KYBERSWAP_API_KEY');
  }, 60_000);

  it('reports an order without lots', async () => {
    const agent = request.agent(app.getHttpServer());
    await agent.get('/api/v1/settings/data-quality').expect(401);
    const owner = await setupOwner(agent);

    const assets = await agent.get('/api/v1/assets').expect(200);
    const asset = (assets.body.assets as Array<{ id: string; symbol: string }>)[0];
    expect(asset).toBeDefined();

    await db.insert(tradeGroups).values({
      userId: owner.userId,
      assetId: asset.id,
      status: 'open',
      openedAt: new Date(),
    });

    const response = await agent.get('/api/v1/settings/data-quality').expect(200);
    expect(response.body.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(response.body.summary.errors).toBeGreaterThanOrEqual(1);
    const fifo = (
      response.body.sections as Array<{
        key: string;
        checks: Array<{
          code: string;
          count: number;
          samples: Array<{ href: string | null }>;
        }>;
      }>
    ).find((section) => section.key === 'fifo');
    const check = fifo?.checks.find((item) => item.code === 'group_without_lots');
    expect(check?.count).toBe(1);
    expect(check?.samples[0]?.href).toMatch(/^\/trades\//);
  }, 60_000);
});

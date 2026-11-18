import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import cookie from '@fastify/cookie';
import { sql } from 'drizzle-orm';
import { generateSync } from 'otplib';
import request, { type SuperAgentTest } from 'supertest';
import { createDb, type Database } from '@nexter/db';
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

describe.runIf(canRun)('AI trading control center API', () => {
  let app: NestFastifyApplication;
  let db: Database;
  let pool: ReturnType<typeof createDb>['pool'];

  async function setupOwner(agent: SuperAgentTest) {
    const email = `ai-trading-e2e-${Date.now()}@example.com`;
    const setup = await agent
      .post('/api/v1/auth/setup')
      .send({ setupToken: process.env.SETUP_TOKEN, email, password })
      .expect(201);
    const totp = await agent
      .post('/api/v1/auth/2fa/setup')
      .set('x-csrf-token', csrfFrom(setup))
      .expect(200);
    const secret = totp.body.secret as string;
    const enabled = await agent
      .post('/api/v1/auth/2fa/enable')
      .set('x-csrf-token', csrfFrom(setup))
      .send({ code: generateSync({ secret }) })
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
    await db.execute(sql`truncate table prices, market_quotes, users restart identity cascade`);
  });

  afterAll(async () => {
    await app.close();
    await pool.end();
  });

  it('creates a profile, manages the AI universe and service configs', async () => {
    const agent = request.agent(app.getHttpServer());
    const owner = await setupOwner(agent);

    const profile = await agent.get('/api/v1/ai-trading/profile').expect(200);
    expect(Number(profile.body.budgetUsd)).toBe(10000);
    expect(profile.body.workerMaxTokens).toBe(5);
    expect(profile.body.autoApproveWorkerCreate).toBe(true);

    const updated = await agent
      .put('/api/v1/ai-trading/profile')
      .set('x-csrf-token', owner.csrf)
      .send({ budgetUsd: '25000', maxWorkers: 8, autoApproveWorkerCreate: false })
      .expect(200);
    expect(Number(updated.body.budgetUsd)).toBe(25000);
    expect(updated.body.maxWorkers).toBe(8);
    expect(updated.body.autoApproveWorkerCreate).toBe(false);

    const assets = await agent.get('/api/v1/assets').expect(200);
    const based = (assets.body.assets as Array<{ id: string; symbol: string }>).find(
      (asset) => asset.symbol === 'BASED',
    );
    expect(based).toBeDefined();

    const token = await agent
      .post('/api/v1/ai-trading/profile/tokens')
      .set('x-csrf-token', owner.csrf)
      .send({ assetId: based?.id, timeframes: ['1h', '1d'], priority: 5 })
      .expect(201);
    expect(token.body.asset.symbol).toBe('BASED');
    expect(token.body.timeframes).toEqual(['1h', '1d']);

    const tokens = await agent.get('/api/v1/ai-trading/profile/tokens').expect(200);
    expect(tokens.body.data).toHaveLength(1);

    const patched = await agent
      .patch(`/api/v1/ai-trading/profile/tokens/${token.body.id}`)
      .set('x-csrf-token', owner.csrf)
      .send({ enabled: false, timeframes: ['1d'] })
      .expect(200);
    expect(patched.body.enabled).toBe(false);
    expect(patched.body.timeframes).toEqual(['1d']);

    await agent
      .patch(`/api/v1/ai-trading/profile/tokens/${token.body.id}`)
      .set('x-csrf-token', owner.csrf)
      .send({ enabled: true })
      .expect(200);

    const coverage = await agent.get('/api/v1/ai-trading/coverage').expect(200);
    expect(coverage.body.tokens).toHaveLength(1);
    expect(coverage.body.tokens[0].timeframes).toHaveLength(1);
    expect(coverage.body.tokens[0].timeframes[0]).toMatchObject({
      timeframe: '1d',
      candles: 0,
      status: 'missing',
    });

    const refreshed = await agent
      .post('/api/v1/ai-trading/data/refresh')
      .set('x-csrf-token', owner.csrf)
      .send({ days: 30 })
      .expect(201);
    expect(refreshed.body.pairs).toBe(1);
    expect(refreshed.body.upserted).toBe(0);
    expect(refreshed.body.failed).toHaveLength(1);

    await agent
      .delete(`/api/v1/ai-trading/profile/tokens/${token.body.id}`)
      .set('x-csrf-token', owner.csrf)
      .expect(200);

    const services = await agent.get('/api/v1/ai-trading/services').expect(200);
    expect(services.body.data).toHaveLength(5);

    const serviceAudit = await db.execute(
      sql`select count(*)::int as n from audit_log where action = 'ai_trading.service_created'`,
    );
    expect((serviceAudit.rows[0] as { n: number } | undefined)?.n).toBe(5);

    const service = await agent
      .put('/api/v1/ai-trading/services/data')
      .set('x-csrf-token', owner.csrf)
      .send({ concurrency: 3, config: { historyDays: 500 } })
      .expect(200);
    expect(service.body.concurrency).toBe(3);
    expect(service.body.config.historyDays).toBe(500);

    const dashboard = await agent.get('/api/v1/ai-trading/dashboard').expect(200);
    expect(dashboard.body.tokensCount).toBe(1);
    expect(dashboard.body.workersCount).toBe(0);
    expect(dashboard.body.activeWorkers).toBe(0);
  }, 60_000);
});

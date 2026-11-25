import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import cookie from '@fastify/cookie';
import { sql } from 'drizzle-orm';
import { generateSync } from 'otplib';
import request from 'supertest';
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

describe.runIf(canRun)('Equity series API', () => {
  let app: NestFastifyApplication;
  let db: Database;
  let pool: ReturnType<typeof createDb>['pool'];

  async function setupOwner(agent: ReturnType<typeof request.agent>) {
    const email = `equity-e2e-${Date.now()}-${Math.random().toString(16).slice(2)}@example.com`;
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
      .send({ code: generateSync({ secret: totpSetup.body.secret as string }) })
      .expect(200);
    return { csrf: csrfFrom(enabled) };
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

  it('returns hourly, daily and monthly points without fabricating history', async () => {
    const agent = request.agent(app.getHttpServer());
    const owner = await setupOwner(agent);

    const assetsResponse = await agent.get('/api/v1/assets').expect(200);
    const assets = assetsResponse.body.assets as Array<{
      id: string;
      chainCode: string;
      symbol: string;
    }>;
    const usdc = assets.find((asset) => asset.chainCode === 'bsc' && asset.symbol === 'USDC');
    const accountsResponse = await agent.get('/api/v1/accounts').expect(200);
    const wallet = (accountsResponse.body.accounts as Array<{ id: string; name: string }>).find(
      (account) => account.name === 'Tangem BSC',
    );
    if (!usdc || !wallet) throw new Error('Seeded accounting data is missing');

    await agent
      .post('/api/v1/transactions')
      .set('x-csrf-token', owner.csrf)
      .send({
        type: 'deposit',
        accountId: wallet.id,
        assetId: usdc.id,
        amount: '1000',
        usdValue: '1000',
      })
      .expect(201);

    await agent.post('/api/v1/dashboard/snapshot').set('x-csrf-token', owner.csrf).expect(201);

    const day = await agent.get('/api/v1/dashboard/equity-series?range=day').expect(200);
    expect(day.body).toMatchObject({
      range: 'day',
      granularity: 'day',
      valuation: 'daily-snapshots',
    });
    expect(day.body.points).toHaveLength(1);

    const hour = await agent.get('/api/v1/dashboard/equity-series?range=hour').expect(200);
    expect(hour.body).toMatchObject({ range: 'hour', granularity: 'hour' });
    expect(hour.body.valuation).toBe('hourly-points');
    expect(hour.body.points).toHaveLength(1);
    expect(hour.body.note).toContain('Почасовые точки собираются с');
    expect(hour.body.note).toContain('последние 24 часа');
    const bucket = new Date(hour.body.points[0].date);
    expect(bucket.getUTCMinutes()).toBe(0);

    const month = await agent.get('/api/v1/dashboard/equity-series?range=month').expect(200);
    expect(month.body).toMatchObject({
      range: 'month',
      granularity: 'month',
      valuation: 'daily-snapshots',
    });
    expect(month.body.points).toHaveLength(1);

    const invalid = await agent.get('/api/v1/dashboard/equity-series?range=week').expect(400);
    expect(invalid.body.error.code).toBe('VALIDATION_ERROR');
  });
});

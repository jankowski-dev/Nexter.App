import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import cookie from '@fastify/cookie';
import { eq, sql } from 'drizzle-orm';
import { generateSync } from 'otplib';
import request from 'supertest';
import { auditLog, createDb, sandboxTokens, users, type Database } from '@nexter/db';
import { sandboxCoverageResponseSchema, sandboxTokenSchema } from '@nexter/contracts';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { AllExceptionsFilter } from '../src/shared/errors/all-exceptions.filter';
import { assertDisposableTestDatabase } from './helpers/test-database';

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
const bscKey = 'bsc:0x1111111111111111111111111111111111111111';

function csrfFrom(response: request.Response): string {
  const setCookie = response.headers['set-cookie'];
  const cookies = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : [];
  const raw = cookies.find((value) => value.startsWith('nexter_csrf='));

  return raw?.split(';')[0]?.split('=')[1] ?? '';
}

describe('Sandbox tokens and coverage (e2e)', () => {
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

  async function setupOwner(agent: ReturnType<typeof request.agent>): Promise<string> {
    const setup = await agent
      .post('/api/v1/auth/setup')
      .send({
        setupToken: process.env.SETUP_TOKEN,
        email: `sandbox-tokens-e2e-${Date.now()}@example.com`,
        password,
      })
      .expect(201);
    const setupCsrf = csrfFrom(setup);

    const totpSetup = await agent
      .post('/api/v1/auth/2fa/setup')
      .set('x-csrf-token', setupCsrf)
      .expect(200);
    const secret = totpSetup.body.secret as string;

    const enabled = await agent
      .post('/api/v1/auth/2fa/enable')
      .set('x-csrf-token', setupCsrf)
      .send({ code: generateSync({ secret }) })
      .expect(200);

    // Enabling 2FA rotates the session CSRF token; later mutations must use it.
    return csrfFrom(enabled);
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
    }
  }, 30_000);

  beforeEach(async () => {
    if (db) {
      await db.execute(sql`truncate table sandbox_candles`);
      await db.execute(sql`truncate table users restart identity cascade`);
    }
  });

  afterAll(async () => {
    try {
      await restoreSingleton();
    } finally {
      await app.close();
      await pool?.end();
    }
  });

  it('requires authentication for the token universe', async () => {
    const response = await request(app.getHttpServer()).get('/api/v1/sandbox/tokens').expect(401);

    expect(response.body).toMatchObject({ error: { code: 'AUTH_REQUIRED' } });
    expect(response.headers['cache-control']).toBe('no-store');
  });

  it.runIf(canRun)('creates, lists, toggles and audits a sandbox token', async () => {
    const agent = request.agent(app.getHttpServer());
    const csrf = await setupOwner(agent);

    const created = await agent
      .post('/api/v1/sandbox/tokens')
      .set('x-csrf-token', csrf)
      .send({
        tokenKey: bscKey,
        symbol: 'CAKE',
        name: 'PancakeSwap',
        coingeckoId: 'pancakeswap-token',
      })
      .expect(201);

    const token = sandboxTokenSchema.parse(created.body);
    expect(token).toMatchObject({
      tokenKey: bscKey,
      symbol: 'CAKE',
      name: 'PancakeSwap',
      chain: 'bsc',
      contractAddress: bscKey.slice(4),
      coingeckoId: 'pancakeswap-token',
      enabled: true,
    });

    const listed = await agent.get('/api/v1/sandbox/tokens').expect(200);
    expect(sandboxTokenSchema.array().parse(listed.body.tokens)).toHaveLength(1);

    const patched = await agent
      .patch(`/api/v1/sandbox/tokens/${token.id}`)
      .set('x-csrf-token', csrf)
      .send({ enabled: false })
      .expect(200);
    expect(patched.body.enabled).toBe(false);

    const duplicate = await agent
      .post('/api/v1/sandbox/tokens')
      .set('x-csrf-token', csrf)
      .send({ tokenKey: bscKey, symbol: 'CAKE', name: 'PancakeSwap' })
      .expect(409);
    expect(duplicate.body).toMatchObject({ error: { code: 'SANDBOX_TOKEN_EXISTS' } });

    const invalid = await agent
      .post('/api/v1/sandbox/tokens')
      .set('x-csrf-token', csrf)
      .send({ tokenKey: 'solana:abc', symbol: 'X', name: 'X' })
      .expect(400);
    expect(invalid.body).toMatchObject({ error: { code: 'VALIDATION_ERROR' } });

    const audits = db
      ? await db
          .select({ action: auditLog.action })
          .from(auditLog)
          .where(sql`${auditLog.action} in ('sandbox.token_created', 'sandbox.token_updated')`)
      : [];
    expect(audits.map((row) => row.action).sort()).toEqual([
      'sandbox.token_created',
      'sandbox.token_updated',
    ]);
  });

  it.runIf(canRun)('reports missing coverage and refreshes without network in tests', async () => {
    const agent = request.agent(app.getHttpServer());
    const csrf = await setupOwner(agent);

    const created = await agent
      .post('/api/v1/sandbox/tokens')
      .set('x-csrf-token', csrf)
      .send({ tokenKey: bscKey, symbol: 'CAKE', name: 'PancakeSwap' })
      .expect(201);

    const coverage = await agent.get('/api/v1/sandbox/coverage').expect(200);
    const empty = sandboxCoverageResponseSchema.parse(coverage.body);
    expect(empty.tokens).toHaveLength(1);
    expect(empty.tokens[0]).toMatchObject({
      tokenKey: bscKey,
      timeframe: '1h',
      available: 0,
      required: 4320,
      gaps: 0,
      synthetic: false,
      stale: true,
      status: 'missing',
    });

    const refreshed = await agent
      .post(`/api/v1/sandbox/tokens/${created.body.id}/refresh`)
      .set('x-csrf-token', csrf)
      .expect(200);
    expect(refreshed.body.fetched).toBe(0);
    expect(refreshed.body.coverage.status).toBe('missing');

    const filtered = await agent
      .get('/api/v1/sandbox/coverage')
      .query({ tokenKey: bscKey })
      .expect(200);
    expect(filtered.body.tokens).toHaveLength(1);

    const foreign = await agent
      .get('/api/v1/sandbox/coverage')
      .query({ tokenKey: 'ethereum:0x2222222222222222222222222222222222222222' })
      .expect(404);
    expect(foreign.body).toMatchObject({ error: { code: 'SANDBOX_TOKEN_NOT_FOUND' } });

    const refreshAudits = db
      ? await db
          .select({ action: auditLog.action })
          .from(auditLog)
          .where(sql`${auditLog.action} = 'sandbox.token_refreshed'`)
      : [];
    expect(refreshAudits).toHaveLength(1);
  });

  it.runIf(canRun)('rejects an unknown token patch', async () => {
    const agent = request.agent(app.getHttpServer());
    const csrf = await setupOwner(agent);

    const response = await agent
      .patch('/api/v1/sandbox/tokens/33333333-3333-4333-8333-333333333333')
      .set('x-csrf-token', csrf)
      .send({ enabled: false })
      .expect(404);
    expect(response.body).toMatchObject({ error: { code: 'SANDBOX_TOKEN_NOT_FOUND' } });
  });

  it.runIf(canRun)('isolates list, patch and coverage between owners', async () => {
    if (!db) return;
    const agent = request.agent(app.getHttpServer());
    const csrf = await setupOwner(agent);
    const secondKey = 'ethereum:0x2222222222222222222222222222222222222222';

    await agent
      .post('/api/v1/sandbox/tokens')
      .set('x-csrf-token', csrf)
      .send({ tokenKey: bscKey, symbol: 'CAKE', name: 'PancakeSwap' })
      .expect(201);

    try {
      // The users table is a singleton; drop its guard for this test only so a
      // genuine second owner and token can be seeded outside the API.
      await db.execute(sql`drop index if exists users_singleton_unique`);
      const [secondOwner] = await db
        .insert(users)
        .values({
          email: `sandbox-second-${Date.now()}@example.com`,
          passwordHash: 'not-a-real-hash',
        })
        .returning({ id: users.id });
      expect(secondOwner?.id).toBeTruthy();

      const [foreignToken] = await db
        .insert(sandboxTokens)
        .values({
          userId: secondOwner?.id as string,
          tokenKey: secondKey,
          symbol: 'ETH',
          name: 'Ether',
          chain: 'ethereum',
          contractAddress: secondKey.slice('ethereum:'.length),
          coingeckoId: null,
          enabled: true,
        })
        .returning({ id: sandboxTokens.id });
      expect(foreignToken?.id).toBeTruthy();

      const listed = await agent.get('/api/v1/sandbox/tokens').expect(200);
      expect(listed.body.tokens.map((token: { tokenKey: string }) => token.tokenKey)).toEqual([
        bscKey,
      ]);

      const patch = await agent
        .patch(`/api/v1/sandbox/tokens/${foreignToken?.id}`)
        .set('x-csrf-token', csrf)
        .send({ enabled: false })
        .expect(404);
      expect(patch.body).toMatchObject({ error: { code: 'SANDBOX_TOKEN_NOT_FOUND' } });

      const coverage = await agent
        .get('/api/v1/sandbox/coverage')
        .query({ tokenKey: secondKey })
        .expect(404);
      expect(coverage.body).toMatchObject({ error: { code: 'SANDBOX_TOKEN_NOT_FOUND' } });

      const [unchanged] = await db
        .select({ enabled: sandboxTokens.enabled })
        .from(sandboxTokens)
        .where(eq(sandboxTokens.id, foreignToken?.id as string));
      expect(unchanged?.enabled).toBe(true);
    } finally {
      await restoreSingleton();
    }
  });
});

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

function csrfFrom(response: request.Response): string {
  const setCookie = response.headers['set-cookie'];
  const cookies = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : [];
  const raw = cookies.find((value) => value.startsWith('nexter_csrf='));

  return raw?.split(';')[0]?.split('=')[1] ?? '';
}

describe('Sandbox status (e2e)', () => {
  let app: NestFastifyApplication;
  let db: Database | null = null;
  let pool: ReturnType<typeof createDb>['pool'] | null = null;

  async function setupOwner(agent: SuperAgentTest): Promise<void> {
    const setup = await agent
      .post('/api/v1/auth/setup')
      .send({
        setupToken: process.env.SETUP_TOKEN,
        email: `sandbox-status-e2e-${Date.now()}@example.com`,
        password,
      })
      .expect(201);

    const totpSetup = await agent
      .post('/api/v1/auth/2fa/setup')
      .set('x-csrf-token', csrfFrom(setup))
      .expect(200);
    const secret = totpSetup.body.secret as string;

    await agent
      .post('/api/v1/auth/2fa/enable')
      .set('x-csrf-token', csrfFrom(setup))
      .send({ code: generateSync({ secret }) })
      .expect(200);
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
      await db.execute(sql`truncate table users restart identity cascade`);
    }
  });

  afterAll(async () => {
    await app.close();
    await pool?.end();
  });

  it('requires authentication', async () => {
    const response = await request(app.getHttpServer()).get('/api/v1/sandbox/status').expect(401);

    expect(response.body).toMatchObject({ error: { code: 'AUTH_REQUIRED' } });
    expect(response.headers['cache-control']).toBe('no-store');
  });

  it.runIf(canRun)('returns the sandbox stage and feature flag to the owner', async () => {
    const agent = request.agent(app.getHttpServer());
    await setupOwner(agent);

    const response = await agent.get('/api/v1/sandbox/status').expect(200);

    expect(response.body).toEqual({ enabled: true, version: 'sandbox-stage-2' });
  });
});

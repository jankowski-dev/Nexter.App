import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import cookie from '@fastify/cookie';
import { sql } from 'drizzle-orm';
import { generateSync } from 'otplib';
import request from 'supertest';
import { createDb, type Database } from '@nexter/db';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AllExceptionsFilter } from '../src/shared/errors/all-exceptions.filter';
import { assertDisposableTestDatabase } from './helpers/test-database';

/**
 * DB-gated feature-flag e2e.
 *
 * `env` is parsed at module load, so `SANDBOX_ENABLED=false` must be set before
 * `AppModule` is imported; the module is therefore loaded dynamically. The
 * runner/test config keeps every other suite unaffected (one worker per file).
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

const previousSandboxFlag = process.env.SANDBOX_ENABLED;
process.env.SANDBOX_ENABLED = 'false';

const password = 'correct horse battery staple';

function csrfFrom(response: request.Response): string {
  const setCookie = response.headers['set-cookie'];
  const cookies = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : [];
  const raw = cookies.find((value) => value.startsWith('nexter_csrf='));

  return raw?.split(';')[0]?.split('=')[1] ?? '';
}

describe.runIf(canRun)('Sandbox feature flag off (e2e)', () => {
  let app: NestFastifyApplication;
  let db: Database;
  let pool: ReturnType<typeof createDb>['pool'];

  async function restoreSingleton(): Promise<void> {
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
        email: `sandbox-disabled-e2e-${Date.now()}@example.com`,
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

    return csrfFrom(enabled);
  }

  beforeAll(async () => {
    const { AppModule } = await import('../src/app.module');
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
    try {
      await restoreSingleton();
    } finally {
      await app.close();
      await pool.end();
      if (previousSandboxFlag === undefined) {
        delete process.env.SANDBOX_ENABLED;
      } else {
        process.env.SANDBOX_ENABLED = previousSandboxFlag;
      }
    }
  });

  it('keeps status readable and hides the data API as 404', async () => {
    const agent = request.agent(app.getHttpServer());
    const csrf = await setupOwner(agent);
    expect(csrf).not.toBe('');

    const status = await agent.get('/api/v1/sandbox/status').expect(200);
    expect(status.body).toEqual({ enabled: false, version: 'sandbox-stage-2' });
    expect(status.headers['cache-control']).toBe('no-store');

    const tokens = await agent.get('/api/v1/sandbox/tokens').expect(404);
    expect(tokens.body).toMatchObject({ error: { code: 'SANDBOX_DISABLED' } });

    const overview = await agent.get('/api/v1/sandbox/overview').expect(404);
    expect(overview.body).toMatchObject({ error: { code: 'SANDBOX_DISABLED' } });
  });
});

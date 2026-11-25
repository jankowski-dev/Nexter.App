import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import cookie from '@fastify/cookie';
import { sql } from 'drizzle-orm';
import { generateSync } from 'otplib';
import request from 'supertest';
import { createDb, type Database } from '@nexter/db';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { env } from '../src/shared/config/env';
import { AllExceptionsFilter } from '../src/shared/errors/all-exceptions.filter';

const canRun = Boolean(
  process.env.NEXTER_TEST_DB === '1' &&
  process.env.DATABASE_URL &&
  process.env.SETUP_TOKEN &&
  process.env.AUTH_ENCRYPTION_KEY,
);

const password = 'correct horse battery staple';
const botToken = 'test-bot-token-0123456789abcdef';

function csrfFrom(response: request.Response): string {
  const setCookie = response.headers['set-cookie'];
  const cookies = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : [];
  const raw = cookies.find((value) => value.startsWith('nexter_csrf='));
  return raw?.split(';')[0]?.split('=')[1] ?? '';
}

describe.runIf(canRun)('Viber notifications API', () => {
  let app: NestFastifyApplication;
  let db: Database;
  let pool: ReturnType<typeof createDb>['pool'];
  let previousToken: string | undefined;

  async function setupOwner(agent: ReturnType<typeof request.agent>) {
    const email = `viber-e2e-${Date.now()}-${Math.random().toString(16).slice(2)}@example.com`;
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
    previousToken = env.BOT_API_TOKEN;
    env.BOT_API_TOKEN = botToken;

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
    env.BOT_API_TOKEN = previousToken;
    await app.close();
    await pool.end();
  });

  it('queues a test message, serves it to the bot and acknowledges it', async () => {
    const agent = request.agent(app.getHttpServer());
    const owner = await setupOwner(agent);

    const test = await agent
      .post('/api/v1/notifications/viber/test')
      .set('x-csrf-token', owner.csrf)
      .expect(201);
    expect(test.body.id).toMatch(/^[0-9a-f-]{36}$/);

    const unauthorized = await request(app.getHttpServer())
      .get('/api/v1/bot/notifications/pending')
      .expect(401);
    expect(unauthorized.body.error.code).toBe('BOT_UNAUTHORIZED');

    const pending = await request(app.getHttpServer())
      .get('/api/v1/bot/notifications/pending')
      .set('Authorization', `Bearer ${botToken}`)
      .expect(200);
    expect(pending.body.frequency).toBe('instant');
    expect(pending.body.items).toHaveLength(1);
    expect(pending.body.items[0].type).toBe('viber_test');
    expect(pending.body.items[0].status).toBe('pending');

    const ack = await request(app.getHttpServer())
      .post(`/api/v1/bot/notifications/${test.body.id}/ack`)
      .set('Authorization', `Bearer ${botToken}`)
      .send({ status: 'sent' })
      .expect(201);
    expect(ack.body.status).toBe('sent');

    const after = await request(app.getHttpServer())
      .get('/api/v1/bot/notifications/pending')
      .set('Authorization', `Bearer ${botToken}`)
      .expect(200);
    expect(after.body.items).toHaveLength(0);

    const status = await agent.get('/api/v1/notifications/viber/status').expect(200);
    expect(status.body.pending).toBe(0);
    expect(status.body.sent24h).toBe(1);
    expect(status.body.failed24h).toBe(0);
    expect(status.body.configured).toBe(true);
  });

  it('marks failed deliveries and keeps attempts bounded', async () => {
    const agent = request.agent(app.getHttpServer());
    const owner = await setupOwner(agent);
    const test = await agent
      .post('/api/v1/notifications/viber/test')
      .set('x-csrf-token', owner.csrf)
      .expect(201);

    for (let attempt = 0; attempt < 3; attempt += 1) {
      await request(app.getHttpServer())
        .post(`/api/v1/bot/notifications/${test.body.id}/ack`)
        .set('Authorization', `Bearer ${botToken}`)
        .send({ status: 'failed', error: 'Viber HTTP 500' })
        .expect(201);
    }

    const status = await agent.get('/api/v1/notifications/viber/status').expect(200);
    expect(status.body.pending).toBe(0);
    expect(status.body.failed24h).toBe(1);
    expect(status.body.lastError).toBe('Viber HTTP 500');

    const list = await agent.get('/api/v1/notifications/viber?limit=10').expect(200);
    expect(list.body.data[0]).toMatchObject({
      id: test.body.id,
      status: 'failed',
      attempts: 3,
      error: 'Viber HTTP 500',
    });
  });
});

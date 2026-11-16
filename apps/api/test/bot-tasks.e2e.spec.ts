import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import cookie from '@fastify/cookie';
import { sql } from 'drizzle-orm';
import { generateSync } from 'otplib';
import request, { type SuperAgentTest } from 'supertest';
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

describe.runIf(canRun)('Bot task reminders API', () => {
  let app: NestFastifyApplication;
  let db: Database;
  let pool: ReturnType<typeof createDb>['pool'];
  let previousToken: string | undefined;

  async function setupOwner(agent: SuperAgentTest) {
    const email = `bot-e2e-${Date.now()}-${Math.random().toString(16).slice(2)}@example.com`;
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

  it('returns only owner tasks due in the requested window and requires the bot token', async () => {
    const agent = request.agent(app.getHttpServer());
    const owner = await setupOwner(agent);

    const soon = new Date(Date.now() + 3 * 60_000).toISOString();
    const later = new Date(Date.now() + 30 * 60_000).toISOString();
    const soonTask = await agent
      .post('/api/v1/tasks')
      .set('x-csrf-token', owner.csrf)
      .send({ title: 'Скоро важная задача', dueAt: soon, priority: 2, tags: ['bot'] })
      .expect(201);
    await agent
      .post('/api/v1/tasks')
      .set('x-csrf-token', owner.csrf)
      .send({ title: 'Позже', dueAt: later })
      .expect(201);

    await request(app.getHttpServer()).get('/api/v1/bot/tasks/upcoming').expect(401);

    await request(app.getHttpServer())
      .get('/api/v1/bot/tasks/upcoming')
      .set('Authorization', 'Bearer wrong-token-0123456789')
      .expect(401);

    const five = await request(app.getHttpServer())
      .get('/api/v1/bot/tasks/upcoming?minutes=5')
      .set('Authorization', `Bearer ${botToken}`)
      .expect(200);
    expect(five.body.data).toHaveLength(1);
    expect(five.body.data[0]).toMatchObject({
      id: soonTask.body.id,
      title: 'Скоро важная задача',
      priority: 2,
      tags: ['bot'],
    });

    const sixty = await request(app.getHttpServer())
      .get('/api/v1/bot/tasks/upcoming?minutes=60')
      .set('Authorization', `Bearer ${botToken}`)
      .expect(200);
    expect(sixty.body.data).toHaveLength(2);

    env.BOT_API_TOKEN = undefined;
    // The controller reads env dynamically; restore immediately for later requests.
    await request(app.getHttpServer())
      .get('/api/v1/bot/tasks/upcoming')
      .set('Authorization', `Bearer ${botToken}`)
      .expect(503);
    env.BOT_API_TOKEN = botToken;
  }, 60_000);
});

import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import cookie from '@fastify/cookie';
import { eq } from 'drizzle-orm';
import { generateSync } from 'otplib';
import request, { type SuperAgentTest } from 'supertest';
import { createDb, users } from '@nexter/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { AllExceptionsFilter } from '../src/shared/errors/all-exceptions.filter';

const canRun = Boolean(
  process.env.DATABASE_URL && process.env.SETUP_TOKEN && process.env.AUTH_ENCRYPTION_KEY,
);

const email = `auth-e2e-${Date.now()}@example.com`;
const password = 'correct horse battery staple';
const newPassword = 'correct horse battery staple 2';

function csrfFrom(response: request.Response): string {
  const setCookie = response.headers['set-cookie'];
  const cookies = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : [];
  const raw = cookies.find((value) => value.startsWith('nexter_csrf='));

  return raw?.split(';')[0]?.split('=')[1] ?? '';
}

describe.runIf(canRun)('Auth e2e', () => {
  let app: NestFastifyApplication;
  let agent: SuperAgentTest;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    await app.register(cookie as any);
    app.setGlobalPrefix('api/v1', { exclude: ['health', 'ready'] });
    app.useGlobalFilters(new AllExceptionsFilter());

    await app.init();
    await app.getHttpAdapter().getInstance().ready();

    agent = request.agent(app.getHttpServer());
  }, 30_000);

  afterAll(async () => {
    await app.close();

    if (process.env.DATABASE_URL) {
      const { db, pool } = createDb(process.env.DATABASE_URL);

      try {
        await db.delete(users).where(eq(users.email, email));
      } finally {
        await pool.end();
      }
    }
  });

  it('runs setup, TOTP, login, sessions, and password change', async () => {
    const setupToken = process.env.SETUP_TOKEN ?? '';
    let csrf = '';

    const setup = await agent
      .post('/api/v1/auth/setup')
      .send({ setupToken, email, password })
      .expect(201);

    expect(setup.body.recoveryCodes).toHaveLength(10);
    expect(setup.body.user.email).toBe(email);
    csrf = csrfFrom(setup);

    const mePending = await agent.get('/api/v1/auth/me').expect(200);
    expect(mePending.body.requires2faSetup).toBe(true);

    const pendingSessions = await agent.get('/api/v1/auth/sessions').expect(403);
    expect(pendingSessions.body.error.code).toBe('TWO_FACTOR_REQUIRED');

    const totpSetup = await agent
      .post('/api/v1/auth/2fa/setup')
      .set('x-csrf-token', csrf)
      .expect(200);

    const secret = totpSetup.body.secret as string;
    expect(secret).toBeTruthy();

    const enableCode = generateSync({ secret });
    const enabled = await agent
      .post('/api/v1/auth/2fa/enable')
      .set('x-csrf-token', csrf)
      .send({ code: enableCode })
      .expect(200);

    expect(enabled.body.user.totpEnabled).toBe(true);
    csrf = csrfFrom(enabled);

    const meReady = await agent.get('/api/v1/auth/me').expect(200);
    expect(meReady.body.requires2fa).toBe(false);

    await agent.post('/api/v1/auth/logout').set('x-csrf-token', csrf).expect(204);

    const login = await agent.post('/api/v1/auth/login').send({ email, password }).expect(200);

    expect(login.body.requires2fa).toBe(true);
    csrf = csrfFrom(login);

    const pendingLoginSessions = await agent.get('/api/v1/auth/sessions').expect(403);
    expect(pendingLoginSessions.body.error.code).toBe('TWO_FACTOR_REQUIRED');

    const verifyCode = generateSync({ secret });
    const verified = await agent
      .post('/api/v1/auth/2fa/verify')
      .set('x-csrf-token', csrf)
      .send({ code: verifyCode })
      .expect(200);

    expect(verified.body.user.totpEnabled).toBe(true);
    csrf = csrfFrom(verified);

    const sessions = await agent.get('/api/v1/auth/sessions').expect(200);
    expect(sessions.body.sessions).toHaveLength(1);
    expect(sessions.body.sessions[0].current).toBe(true);

    const csrfMissing = await agent
      .post('/api/v1/auth/password')
      .send({ currentPassword: password, newPassword })
      .expect(403);
    expect(csrfMissing.body.error.code).toBe('CSRF_INVALID');

    await agent
      .post('/api/v1/auth/password')
      .set('x-csrf-token', csrf)
      .send({ currentPassword: password, newPassword })
      .expect(204);

    const loginWithNewPassword = await agent
      .post('/api/v1/auth/login')
      .send({ email, password: newPassword })
      .expect(200);

    expect(loginWithNewPassword.body.requires2fa).toBe(true);
  }, 30_000);
});

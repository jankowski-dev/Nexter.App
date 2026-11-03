import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import cookie from '@fastify/cookie';
import { sql } from 'drizzle-orm';
import { generateSync } from 'otplib';
import request, { type SuperAgentTest } from 'supertest';
import { auditLog, createDb, rateLimits, users, type Database } from '@nexter/db';
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
const newPassword = 'correct horse battery staple 2';

function csrfFrom(response: request.Response): string {
  const setCookie = response.headers['set-cookie'];
  const cookies = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : [];
  const raw = cookies.find((value) => value.startsWith('nexter_csrf='));

  return raw?.split(';')[0]?.split('=')[1] ?? '';
}

function cookieHeaderFrom(response: request.Response, name: string): string {
  const setCookie = response.headers['set-cookie'];
  const cookies = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : [];
  const raw = cookies.find((value) => value.startsWith(`${name}=`));

  return raw?.split(';')[0] ?? '';
}

describe.runIf(canRun)('Auth e2e', () => {
  let app: NestFastifyApplication;
  let db: Database;
  let pool: ReturnType<typeof createDb>['pool'];
  let emailCounter = 0;

  async function setupOwner(agent: SuperAgentTest) {
    const email = `auth-e2e-${Date.now()}-${emailCounter++}@example.com`;
    const setup = await agent
      .post('/api/v1/auth/setup')
      .send({ setupToken: process.env.SETUP_TOKEN, email, password })
      .expect(201);

    return {
      email,
      csrf: csrfFrom(setup),
      recoveryCodes: setup.body.recoveryCodes as string[],
    };
  }

  async function enableTotp(agent: SuperAgentTest, csrf: string) {
    const totpSetup = await agent
      .post('/api/v1/auth/2fa/setup')
      .set('x-csrf-token', csrf)
      .expect(200);

    const secret = totpSetup.body.secret as string;
    const enabled = await agent
      .post('/api/v1/auth/2fa/enable')
      .set('x-csrf-token', csrf)
      .send({ code: generateSync({ secret }) })
      .expect(200);

    return {
      secret,
      csrf: csrfFrom(enabled),
      sessionCookie: cookieHeaderFrom(enabled, 'nexter_session'),
    };
  }

  async function loginWithTotp(agent: SuperAgentTest, ownerEmail: string, secret: string) {
    const login = await agent
      .post('/api/v1/auth/login')
      .send({ email: ownerEmail, password })
      .expect(200);

    const csrf = csrfFrom(login);
    const verified = await agent
      .post('/api/v1/auth/2fa/verify')
      .set('x-csrf-token', csrf)
      .send({ code: generateSync({ secret }) })
      .expect(200);

    return csrfFrom(verified);
  }

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

    const created = createDb(process.env.DATABASE_URL ?? '');
    db = created.db;
    pool = created.pool;
  }, 30_000);

  beforeEach(async () => {
    await db.execute(
      sql`truncate table audit_log, sessions, settings, rate_limits, users restart identity cascade`,
    );
  });

  afterAll(async () => {
    await app.close();
    await pool.end();
  });

  it('creates exactly one owner and rejects invalid setup tokens', async () => {
    const agent = request.agent(app.getHttpServer());

    await agent
      .post('/api/v1/auth/setup')
      .send({ setupToken: 'wrong-token', email: 'one@example.com', password })
      .expect(401);

    await agent
      .post('/api/v1/auth/setup')
      .set('origin', 'https://evil.example')
      .send({ setupToken: process.env.SETUP_TOKEN, email: 'one@example.com', password })
      .expect(403);

    const setup = await agent
      .post('/api/v1/auth/setup')
      .send({ setupToken: process.env.SETUP_TOKEN, email: 'one@example.com', password })
      .expect(201);

    expect(setup.body.recoveryCodes).toHaveLength(10);

    await agent
      .post('/api/v1/auth/setup')
      .send({ setupToken: process.env.SETUP_TOKEN, email: 'two@example.com', password })
      .expect(409);

    const [row] = await db.select({ count: sql<number>`count(*)::int` }).from(users);
    expect(row?.count).toBe(1);
  });

  it('serializes concurrent setup attempts to a single owner', async () => {
    const server = app.getHttpServer();
    const [first, second] = await Promise.all([
      request(server)
        .post('/api/v1/auth/setup')
        .send({ setupToken: process.env.SETUP_TOKEN, email: 'race-a@example.com', password }),
      request(server)
        .post('/api/v1/auth/setup')
        .send({ setupToken: process.env.SETUP_TOKEN, email: 'race-b@example.com', password }),
    ]);

    expect([first.status, second.status].sort()).toEqual([201, 409]);

    const [row] = await db.select({ count: sql<number>`count(*)::int` }).from(users);
    expect(row?.count).toBe(1);
  });

  it('runs setup, TOTP, login, sessions, CSRF and audit checks', async () => {
    const agent = request.agent(app.getHttpServer());
    const owner = await setupOwner(agent);

    const mePending = await agent.get('/api/v1/auth/me').expect(200);
    expect(mePending.body.requires2faSetup).toBe(true);

    const pendingSessions = await agent.get('/api/v1/auth/sessions').expect(403);
    expect(pendingSessions.body.error.code).toBe('TOTP_REQUIRED');

    const noSession = await request(app.getHttpServer()).get('/api/v1/auth/sessions').expect(401);
    expect(noSession.headers['cache-control']).toBe('no-store');

    const { secret, csrf } = await enableTotp(agent, owner.csrf);

    const meReady = await agent.get('/api/v1/auth/me').expect(200);
    expect(meReady.body.requires2fa).toBe(false);
    expect(meReady.headers['cache-control']).toBe('no-store');

    await agent.post('/api/v1/auth/logout').set('x-csrf-token', csrf).expect(204);

    const login = await agent
      .post('/api/v1/auth/login')
      .set('user-agent', 'auth-e2e/1.0')
      .send({ email: owner.email, password });
    expect(login.status).toBe(200);
    expect(login.body.requires2fa).toBe(true);
    const loginCsrf = csrfFrom(login);
    const csrfResponse = await agent.get('/api/v1/auth/csrf').expect(200);
    expect(csrfResponse.body.csrfToken).toBe(loginCsrf);
    const sessionSetCookie = login.headers['set-cookie'];
    const cookieText = Array.isArray(sessionSetCookie)
      ? sessionSetCookie.join(';')
      : (sessionSetCookie ?? '');
    expect(cookieText).toContain('nexter_session=');
    expect(cookieText).toContain('HttpOnly');
    expect(cookieText).toContain('SameSite=Lax');
    expect(cookieText).toContain('Path=/');

    const pendingLoginSessions = await agent.get('/api/v1/auth/sessions').expect(403);
    expect(pendingLoginSessions.body.error.code).toBe('TOTP_REQUIRED');

    const verified = await agent
      .post('/api/v1/auth/2fa/verify')
      .set('x-csrf-token', loginCsrf)
      .set('user-agent', 'auth-e2e/1.0')
      .send({ code: generateSync({ secret }) })
      .expect(200);

    expect(verified.body.user.totpEnabled).toBe(true);
    const verifiedCsrf = csrfFrom(verified);
    const verifiedSessionCookie = cookieHeaderFrom(verified, 'nexter_session');

    const sessionsResponse = await agent.get('/api/v1/auth/sessions').expect(200);
    expect(sessionsResponse.body.sessions).toHaveLength(1);
    expect(sessionsResponse.body.sessions[0].current).toBe(true);
    expect(sessionsResponse.body.sessions[0].ip).toBeTruthy();
    expect(sessionsResponse.body.sessions[0].userAgent).toBeTruthy();
    expect(sessionsResponse.body.sessions[0].lastSeenAt).toBeTruthy();
    expect(sessionsResponse.body.sessions[0].expiresAt).toBeTruthy();

    const csrfMissing = await agent
      .post('/api/v1/auth/password')
      .send({ currentPassword: password, newPassword })
      .expect(403);
    expect(csrfMissing.body.error.code).toBe('FORBIDDEN');
    expect(csrfMissing.body.error.details.reason).toBe('CSRF_MISSING');

    const csrfMismatch = await agent
      .post('/api/v1/auth/password')
      .set('x-csrf-token', `${verifiedCsrf}-wrong`)
      .send({ currentPassword: password, newPassword })
      .expect(403);
    expect(csrfMismatch.body.error.code).toBe('FORBIDDEN');

    const originMismatch = await agent
      .post('/api/v1/auth/password')
      .set('x-csrf-token', verifiedCsrf)
      .set('origin', 'https://evil.example')
      .send({ currentPassword: password, newPassword })
      .expect(403);
    expect(originMismatch.body.error.details.reason).toBe('ORIGIN_MISMATCH');

    const randomCsrf = 'a'.repeat(64);
    const csrfSessionMismatch = await request(app.getHttpServer())
      .post('/api/v1/auth/password')
      .set('cookie', `${verifiedSessionCookie}; nexter_csrf=${randomCsrf}`)
      .set('x-csrf-token', randomCsrf)
      .send({ currentPassword: password, newPassword })
      .expect(403);
    expect(csrfSessionMismatch.body.error.details.reason).toBe('CSRF_SESSION_MISMATCH');

    const auditRows = await db.select().from(auditLog);
    expect(auditRows.some((row) => row.action === 'auth.setup_completed')).toBe(true);
    expect(auditRows.some((row) => row.action === 'auth.login_password_ok')).toBe(true);
    expect(auditRows.some((row) => row.action === 'auth.totp_enabled')).toBe(true);
    expect(auditRows.some((row) => row.action === 'auth.totp_verified')).toBe(true);
  }, 30_000);

  it('blocks TOTP brute force and rejects a valid code while blocked', async () => {
    const agent = request.agent(app.getHttpServer());
    const owner = await setupOwner(agent);
    const { secret, csrf } = await enableTotp(agent, owner.csrf);
    await agent.post('/api/v1/auth/logout').set('x-csrf-token', csrf).expect(204);

    const login = await agent
      .post('/api/v1/auth/login')
      .send({ email: owner.email, password })
      .expect(200);
    const loginCsrf = csrfFrom(login);
    const validCode = generateSync({ secret });
    const wrongCode = validCode === '000000' ? '000001' : '000000';

    for (let attempt = 0; attempt < 4; attempt += 1) {
      await agent
        .post('/api/v1/auth/2fa/verify')
        .set('x-csrf-token', loginCsrf)
        .send({ code: wrongCode })
        .expect(401);
    }

    const blockedAttempt = await agent
      .post('/api/v1/auth/2fa/verify')
      .set('x-csrf-token', loginCsrf)
      .send({ code: wrongCode })
      .expect(429);
    expect(blockedAttempt.body.error.code).toBe('RATE_LIMITED');

    const validWhileBlocked = await agent
      .post('/api/v1/auth/2fa/verify')
      .set('x-csrf-token', loginCsrf)
      .send({ code: validCode })
      .expect(429);
    expect(validWhileBlocked.body.error.code).toBe('RATE_LIMITED');

    await agent.post('/api/v1/auth/logout').set('x-csrf-token', loginCsrf).expect(204);

    const secondLogin = await agent
      .post('/api/v1/auth/login')
      .send({ email: owner.email, password })
      .expect(200);
    const secondLoginCsrf = csrfFrom(secondLogin);

    const blockedAcrossLogin = await agent
      .post('/api/v1/auth/2fa/verify')
      .set('x-csrf-token', secondLoginCsrf)
      .send({ code: generateSync({ secret }) })
      .expect(429);
    expect(blockedAcrossLogin.body.error.code).toBe('RATE_LIMITED');

    const auditRows = await db.select().from(auditLog);
    expect(auditRows.some((row) => row.action === 'auth.rate_limited')).toBe(true);

    await db.delete(rateLimits);

    await agent
      .post('/api/v1/auth/2fa/verify')
      .set('x-csrf-token', secondLoginCsrf)
      .send({ code: generateSync({ secret }) })
      .expect(200);
  }, 30_000);

  it('consumes recovery codes once and resets the password', async () => {
    const agent = request.agent(app.getHttpServer());
    const owner = await setupOwner(agent);
    const { secret, csrf } = await enableTotp(agent, owner.csrf);
    await agent.post('/api/v1/auth/logout').set('x-csrf-token', csrf).expect(204);

    const login = await agent
      .post('/api/v1/auth/login')
      .send({ email: owner.email, password })
      .expect(200);
    const loginCsrf = csrfFrom(login);

    const recovered = await agent
      .post('/api/v1/auth/recovery/verify')
      .set('x-csrf-token', loginCsrf)
      .send({ code: owner.recoveryCodes[0] })
      .expect(200);

    const recoveredCsrf = csrfFrom(recovered);

    await agent.post('/api/v1/auth/logout').set('x-csrf-token', recoveredCsrf).expect(204);

    const secondLogin = await agent
      .post('/api/v1/auth/login')
      .send({ email: owner.email, password })
      .expect(200);
    const secondCsrf = csrfFrom(secondLogin);

    await agent
      .post('/api/v1/auth/recovery/verify')
      .set('x-csrf-token', secondCsrf)
      .send({ code: owner.recoveryCodes[0] })
      .expect(401);

    const reset = await request(app.getHttpServer())
      .post('/api/v1/auth/password/reset')
      .send({
        email: owner.email,
        recoveryCode: owner.recoveryCodes[1],
        newPassword,
      })
      .expect(200);

    expect(reset.body.recoveryCodes).toHaveLength(10);

    await agent.get('/api/v1/auth/me').expect(401);

    await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: owner.email, password })
      .expect(401);

    const newAgent = request.agent(app.getHttpServer());
    const newLogin = await newAgent
      .post('/api/v1/auth/login')
      .send({ email: owner.email, password: newPassword })
      .expect(200);
    expect(newLogin.body.requires2fa).toBe(true);

    const newCsrf = csrfFrom(newLogin);
    await newAgent
      .post('/api/v1/auth/2fa/verify')
      .set('x-csrf-token', newCsrf)
      .send({ code: generateSync({ secret }) })
      .expect(200);

    const reusedOldCode = await request(app.getHttpServer())
      .post('/api/v1/auth/password/reset')
      .send({
        email: owner.email,
        recoveryCode: owner.recoveryCodes[2],
        newPassword: 'another password value',
      })
      .expect(401);
    expect(reusedOldCode.body.error.code).toBe('INVALID_CREDENTIALS');
    expect(reusedOldCode.body.error.details.reason).toBe('RECOVERY_CODE_INVALID');
  }, 30_000);

  it('clears the 2FA lockout after a password reset', async () => {
    const agent = request.agent(app.getHttpServer());
    const owner = await setupOwner(agent);
    const { secret, csrf } = await enableTotp(agent, owner.csrf);
    await agent.post('/api/v1/auth/logout').set('x-csrf-token', csrf).expect(204);

    const login = await agent
      .post('/api/v1/auth/login')
      .send({ email: owner.email, password })
      .expect(200);
    const loginCsrf = csrfFrom(login);
    const validCode = generateSync({ secret });
    const wrongCode = validCode === '000000' ? '000001' : '000000';

    for (let attempt = 0; attempt < 4; attempt += 1) {
      await agent
        .post('/api/v1/auth/2fa/verify')
        .set('x-csrf-token', loginCsrf)
        .send({ code: wrongCode })
        .expect(401);
    }

    await agent
      .post('/api/v1/auth/2fa/verify')
      .set('x-csrf-token', loginCsrf)
      .send({ code: wrongCode })
      .expect(429);

    await request(app.getHttpServer())
      .post('/api/v1/auth/password/reset')
      .send({
        email: owner.email,
        recoveryCode: owner.recoveryCodes[0],
        newPassword,
      })
      .expect(200);

    const newAgent = request.agent(app.getHttpServer());
    const newLogin = await newAgent
      .post('/api/v1/auth/login')
      .send({ email: owner.email, password: newPassword })
      .expect(200);
    const newCsrf = csrfFrom(newLogin);

    await newAgent
      .post('/api/v1/auth/2fa/verify')
      .set('x-csrf-token', newCsrf)
      .send({ code: generateSync({ secret }) })
      .expect(200);
  }, 30_000);

  it('consumes a recovery code atomically under concurrency', async () => {
    const agent = request.agent(app.getHttpServer());
    const owner = await setupOwner(agent);
    const { csrf } = await enableTotp(agent, owner.csrf);
    await agent.post('/api/v1/auth/logout').set('x-csrf-token', csrf).expect(204);

    const attempts = [agent];

    for (let index = 0; index < 4; index += 1) {
      attempts.push(request.agent(app.getHttpServer()));
    }

    const pending = [];

    for (const attemptAgent of attempts) {
      const login = await attemptAgent
        .post('/api/v1/auth/login')
        .send({ email: owner.email, password })
        .expect(200);
      pending.push({ agent: attemptAgent, csrf: csrfFrom(login) });
    }

    const responses = await Promise.all(
      pending.map(({ agent: attemptAgent, csrf: attemptCsrf }) =>
        attemptAgent
          .post('/api/v1/auth/recovery/verify')
          .set('x-csrf-token', attemptCsrf)
          .send({ code: owner.recoveryCodes[0] }),
      ),
    );

    const statuses = responses.map((response) => response.status);
    expect(statuses.filter((status) => status === 200)).toHaveLength(1);
    expect(statuses.every((status) => [200, 401, 429].includes(status))).toBe(true);

    await db.delete(rateLimits);

    const reuseAgent = request.agent(app.getHttpServer());
    const reuseLogin = await reuseAgent
      .post('/api/v1/auth/login')
      .send({ email: owner.email, password })
      .expect(200);
    const reuseCsrf = csrfFrom(reuseLogin);

    const reused = await reuseAgent
      .post('/api/v1/auth/recovery/verify')
      .set('x-csrf-token', reuseCsrf)
      .send({ code: owner.recoveryCodes[0] })
      .expect(401);
    expect(reused.body.error.code).toBe('INVALID_CREDENTIALS');
  }, 30_000);

  it('revokes sessions and rotates the current session on password change', async () => {
    const agent = request.agent(app.getHttpServer());
    const owner = await setupOwner(agent);
    const { secret, csrf, sessionCookie: oldSessionCookie } = await enableTotp(agent, owner.csrf);

    const secondAgent = request.agent(app.getHttpServer());
    await loginWithTotp(secondAgent, owner.email, secret);

    const before = await agent.get('/api/v1/auth/sessions').expect(200);
    expect(before.body.sessions).toHaveLength(2);
    const secondSession = before.body.sessions.find(
      (session: { current: boolean }) => !session.current,
    );
    expect(secondSession).toBeDefined();
    const secondSessionId = secondSession?.id as string;

    await agent
      .delete(`/api/v1/auth/sessions/${secondSessionId}`)
      .set('x-csrf-token', csrf)
      .expect(204);
    await secondAgent.get('/api/v1/auth/me').expect(401);

    await agent
      .delete('/api/v1/auth/sessions/00000000-0000-4000-8000-000000000000')
      .set('x-csrf-token', csrf)
      .expect(404);

    const thirdAgent = request.agent(app.getHttpServer());
    await loginWithTotp(thirdAgent, owner.email, secret);

    const changed = await agent
      .post('/api/v1/auth/password')
      .set('x-csrf-token', csrf)
      .send({ currentPassword: password, newPassword })
      .expect(204);

    expect(changed.headers['set-cookie']).toBeDefined();
    await thirdAgent.get('/api/v1/auth/me').expect(401);

    const after = await agent.get('/api/v1/auth/sessions').expect(200);
    expect(after.body.sessions).toHaveLength(1);
    expect(after.body.sessions[0].current).toBe(true);

    const auditRows = await db.select().from(auditLog);
    expect(auditRows.some((row) => row.action === 'auth.session_revoked')).toBe(true);
    expect(auditRows.some((row) => row.action === 'auth.password_changed')).toBe(true);

    expect(oldSessionCookie).toContain('nexter_session=');
    await request(app.getHttpServer())
      .get('/api/v1/auth/me')
      .set('cookie', oldSessionCookie)
      .expect(401);

    await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: owner.email, password })
      .expect(401);

    const newLogin = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: owner.email, password: newPassword })
      .expect(200);
    expect(newLogin.body.requires2fa).toBe(true);
  }, 30_000);
});

import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import cookie from '@fastify/cookie';
import { eq, sql } from 'drizzle-orm';
import { generateSync } from 'otplib';
import request, { type SuperAgentTest } from 'supertest';
import { audioNotes, createDb, noteAudio, type Database } from '@nexter/db';
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
const audioDataUrl = 'data:audio/mpeg;base64,SUQzBAAAAAAAI1RTU0UAAAAPAAADTGF2ZjU4';

function csrfFrom(response: request.Response): string {
  const setCookie = response.headers['set-cookie'];
  const cookies = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : [];
  const raw = cookies.find((value) => value.startsWith('nexter_csrf='));
  return raw?.split(';')[0]?.split('=')[1] ?? '';
}

describe.runIf(canRun)('AI and audio notes API', () => {
  let app: NestFastifyApplication;
  let db: Database;
  let pool: ReturnType<typeof createDb>['pool'];
  let previousToken: string | undefined;

  async function setupOwner(agent: SuperAgentTest) {
    const email = `audio-e2e-${Date.now()}-${Math.random().toString(16).slice(2)}@example.com`;
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
    return { csrf: csrfFrom(enabled), userId: setup.body.user.id as string };
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

  it('saves AI settings without exposing the key', async () => {
    const agent = request.agent(app.getHttpServer());
    const owner = await setupOwner(agent);

    const defaults = await agent.get('/api/v1/settings/ai').expect(200);
    expect(defaults.body).toMatchObject({
      enabled: false,
      provider: 'deepseek',
      hasApiKey: false,
      fallbackToRaw: true,
    });

    const saved = await agent
      .put('/api/v1/settings/ai')
      .set('x-csrf-token', owner.csrf)
      .send({
        enabled: true,
        model: 'deepseek-flash',
        reasoning: 'fast',
        temperature: 0.2,
        maxTokens: 1200,
        fallbackToRaw: true,
        apiKey: 'sk-test-key',
      })
      .expect(200);
    expect(saved.body).toMatchObject({
      enabled: true,
      model: 'deepseek-flash',
      hasApiKey: true,
      maxTokens: 1200,
    });
    expect(JSON.stringify(saved.body)).not.toContain('sk-test-key');

    const cleared = await agent
      .delete('/api/v1/settings/ai/key')
      .set('x-csrf-token', owner.csrf)
      .expect(200);
    expect(cleared.body.hasApiKey).toBe(false);
  }, 60_000);

  it('creates an idempotent note from a bot audio payload and attaches the audio', async () => {
    const agent = request.agent(app.getHttpServer());
    await setupOwner(agent);

    await request(app.getHttpServer())
      .post('/api/v1/bot/audio-notes')
      .send({
        viberMessageId: 'viber-msg-1',
        transcript: 'Проверить отчёт и позвонить клиенту завтра.',
        audioMime: 'audio/mpeg',
        audioName: 'note.mp3',
        audioSize: 24,
        durationSeconds: 12,
        audioDataUrl,
      })
      .expect(401);

    const created = await request(app.getHttpServer())
      .post('/api/v1/bot/audio-notes')
      .set('Authorization', `Bearer ${botToken}`)
      .send({
        viberMessageId: 'viber-msg-1',
        transcript: 'Проверить отчёт и позвонить клиенту завтра.',
        audioMime: 'audio/mpeg',
        audioName: 'note.mp3',
        audioSize: 24,
        durationSeconds: 12,
        audioDataUrl,
      })
      .expect(201);
    expect(created.body.status).toBe('done');
    expect(created.body.noteId).toBeTruthy();
    expect(created.body.title).toContain('Аудиозаметка');

    const repeated = await request(app.getHttpServer())
      .post('/api/v1/bot/audio-notes')
      .set('Authorization', `Bearer ${botToken}`)
      .send({
        viberMessageId: 'viber-msg-1',
        transcript: 'Другой текст',
        audioMime: 'audio/mpeg',
        audioName: 'note.mp3',
        audioSize: 24,
        durationSeconds: 12,
        audioDataUrl,
      })
      .expect(201);
    expect(repeated.body.id).toBe(created.body.id);
    expect(repeated.body.noteId).toBe(created.body.noteId);

    const note = await agent.get(`/api/v1/notes/${created.body.noteId}`).expect(200);
    expect(note.body.audio).toHaveLength(1);
    expect(note.body.audio[0]).toMatchObject({
      name: 'note.mp3',
      mimeType: 'audio/mpeg',
      dataUrl: audioDataUrl,
    });
    expect(note.body.body).toContain('Проверить отчёт');

    const [job] = await db
      .select()
      .from(audioNotes)
      .where(eq(audioNotes.id, created.body.id))
      .limit(1);
    expect(job?.status).toBe('done');
    const [attachment] = await db
      .select()
      .from(noteAudio)
      .where(eq(noteAudio.noteId, created.body.noteId))
      .limit(1);
    expect(attachment?.name).toBe('note.mp3');

    const status = await request(app.getHttpServer())
      .get(`/api/v1/bot/audio-notes/${created.body.id}`)
      .set('Authorization', `Bearer ${botToken}`)
      .expect(200);
    expect(status.body.noteId).toBe(created.body.noteId);
  }, 60_000);
});

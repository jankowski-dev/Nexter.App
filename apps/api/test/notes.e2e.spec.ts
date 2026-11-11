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

describe.runIf(canRun)('Notes API', () => {
  let app: NestFastifyApplication;
  let db: Database;
  let pool: ReturnType<typeof createDb>['pool'];
  let counter = 0;

  async function setupOwner(agent: SuperAgentTest) {
    const email = `notes-e2e-${Date.now()}-${counter++}@example.com`;
    const setup = await agent
      .post('/api/v1/auth/setup')
      .send({ setupToken: process.env.SETUP_TOKEN, email, password })
      .expect(201);
    const totp = await agent
      .post('/api/v1/auth/2fa/setup')
      .set('x-csrf-token', csrfFrom(setup))
      .expect(200);
    const enabled = await agent
      .post('/api/v1/auth/2fa/enable')
      .set('x-csrf-token', csrfFrom(setup))
      .send({ code: generateSync({ secret: totp.body.secret as string }) })
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
    await db.execute(sql`truncate table users restart identity cascade`);
  });

  afterAll(async () => {
    await app.close();
    await pool.end();
  });

  it('paginates notes and supports images', async () => {
    const agent = request.agent(app.getHttpServer());
    const owner = await setupOwner(agent);
    const post = (url: string, body: Record<string, unknown>) =>
      agent.post(url).set('x-csrf-token', owner.csrf).send(body);

    const notes = [];
    for (let index = 1; index <= 3; index += 1) {
      const created = await post('/api/v1/notes', {
        title: `Заметка ${index}`,
        body: `Текст ${index}`,
      }).expect(201);
      notes.push(created.body);
    }

    const first = await agent.get('/api/v1/notes?limit=2&offset=0').expect(200);
    expect(first.body.data).toHaveLength(2);
    expect(first.body.hasMore).toBe(true);

    const second = await agent.get('/api/v1/notes?limit=2&offset=2').expect(200);
    expect(second.body.data).toHaveLength(1);
    expect(second.body.hasMore).toBe(false);

    const dataUrl =
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAEUlEQVR4nGP4z8DwH4QZYAwAR8oH+WdZbrcAAAAASUVORK5CYII=';
    const image = await post(`/api/v1/notes/${notes[0].id}/images`, {
      name: 'note.png',
      mimeType: 'image/png',
      dataUrl,
    }).expect(201);

    const withImage = await agent.get('/api/v1/notes?limit=10').expect(200);
    const firstNote = (withImage.body.data as Array<{ id: string; attachmentCount: number }>).find(
      (note) => note.id === notes[0].id,
    );
    expect(firstNote?.attachmentCount).toBe(1);
    const noteDetail = await agent.get(`/api/v1/notes/${notes[0].id}`).expect(200);
    expect(noteDetail.body.images).toHaveLength(1);

    await agent
      .delete(`/api/v1/notes/${notes[0].id}/images/${image.body.id}`)
      .set('x-csrf-token', owner.csrf)
      .expect(200);

    await agent
      .patch(`/api/v1/notes/${notes[0].id}`)
      .set('x-csrf-token', owner.csrf)
      .send({ archived: true })
      .expect(200);

    const active = await agent.get('/api/v1/notes?limit=10').expect(200);
    expect(active.body.data).toHaveLength(2);
    const archived = await agent.get('/api/v1/notes?limit=10&includeArchived=true').expect(200);
    expect(archived.body.data).toHaveLength(3);
    const archivedOnly = await agent.get('/api/v1/notes?limit=10&archivedOnly=true').expect(200);
    expect(archivedOnly.body.data).toHaveLength(1);
    expect(archivedOnly.body.data[0].id).toBe(notes[0].id);

    const audit = await agent.get('/api/v1/audit-log?limit=100').expect(200);
    const actions = (audit.body.data as Array<{ action: string }>).map((entry) => entry.action);
    expect(actions).toEqual(
      expect.arrayContaining(['note.created', 'note.image_added', 'note.image_removed']),
    );
  }, 60_000);
});

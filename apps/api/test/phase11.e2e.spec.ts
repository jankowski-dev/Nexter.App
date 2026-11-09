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

describe.runIf(canRun)('Phase 11 e2e', () => {
  let app: NestFastifyApplication;
  let db: Database;
  let pool: ReturnType<typeof createDb>['pool'];
  let emailCounter = 0;

  async function setupOwner(agent: SuperAgentTest) {
    const email = `phase11-e2e-${Date.now()}-${emailCounter++}@example.com`;
    const setup = await agent
      .post('/api/v1/auth/setup')
      .send({ setupToken: process.env.SETUP_TOKEN, email, password })
      .expect(201);

    const totpSetup = await agent
      .post('/api/v1/auth/2fa/setup')
      .set('x-csrf-token', csrfFrom(setup))
      .expect(200);
    const secret = totpSetup.body.secret as string;
    const enabled = await agent
      .post('/api/v1/auth/2fa/enable')
      .set('x-csrf-token', csrfFrom(setup))
      .send({ code: generateSync({ secret }) })
      .expect(200);

    return {
      email,
      userId: setup.body.user.id as string,
      csrf: csrfFrom(enabled),
    };
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
    await db.execute(sql`truncate table prices, users restart identity cascade`);
  });

  afterAll(async () => {
    await app.close();
    await pool.end();
  });

  it('stores encrypted vault items, tasks and notes with audit', async () => {
    const agent = request.agent(app.getHttpServer());
    const owner = await setupOwner(agent);

    const emptyVault = await agent.get('/api/v1/vault').expect(200);
    expect(emptyVault.body).toEqual({ config: null, items: [] });

    const initialized = await agent
      .post('/api/v1/vault/initialize')
      .set('x-csrf-token', owner.csrf)
      .send({
        salt: 'AAAAAAAAAAAAAAAAAAAAAA==',
        iterations: 600_000,
        wrappedKey: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
        wrappedKeyIv: 'AAAAAAAAAAAAAAAA',
      })
      .expect(201);
    expect(initialized.body).toMatchObject({
      salt: 'AAAAAAAAAAAAAAAAAAAAAA==',
      iterations: 600_000,
      wrappedKey: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
      wrappedKeyIv: 'AAAAAAAAAAAAAAAA',
    });

    await agent
      .post('/api/v1/vault/initialize')
      .set('x-csrf-token', owner.csrf)
      .send({
        salt: 'AAAAAAAAAAAAAAAAAAAAAA==',
        iterations: 600_000,
        wrappedKey: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
        wrappedKeyIv: 'AAAAAAAAAAAAAAAA',
      })
      .expect(409);

    const vaultItem = await agent
      .post('/api/v1/vault/items')
      .set('x-csrf-token', owner.csrf)
      .send({
        ciphertext: 'AAAAAAAAAAAAAAAAAAAAAAAA',
        iv: 'AAAAAAAAAAAAAAAA',
      })
      .expect(201);
    expect(vaultItem.body).toMatchObject({
      ciphertext: 'AAAAAAAAAAAAAAAAAAAAAAAA',
      iv: 'AAAAAAAAAAAAAAAA',
      archivedAt: null,
    });

    await agent
      .patch(`/api/v1/vault/items/${vaultItem.body.id}`)
      .set('x-csrf-token', owner.csrf)
      .send({ ciphertext: 'AAAAAAAAAAAAAAAAAAAAAAAA' })
      .expect(400);

    const archivedItem = await agent
      .patch(`/api/v1/vault/items/${vaultItem.body.id}`)
      .set('x-csrf-token', owner.csrf)
      .send({ archived: true })
      .expect(200);
    expect(archivedItem.body.archivedAt).not.toBeNull();

    const afterArchive = await agent.get('/api/v1/vault').expect(200);
    expect(afterArchive.body.items).toEqual([]);
    const archivedView = await agent.get('/api/v1/vault?includeArchived=true').expect(200);
    expect(archivedView.body.items).toHaveLength(1);

    await agent
      .patch(`/api/v1/vault/items/${vaultItem.body.id}`)
      .set('x-csrf-token', owner.csrf)
      .send({ archived: false })
      .expect(200);
    const restoredView = await agent.get('/api/v1/vault').expect(200);
    expect(restoredView.body.items).toHaveLength(1);

    await agent
      .post('/api/v1/vault/initialize')
      .set('x-csrf-token', owner.csrf)
      .send({
        salt: 'AAAA',
        iterations: 600_000,
        wrappedKey: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
        wrappedKeyIv: 'AAAAAAAAAAAAAAAA',
      })
      .expect(400);
    await agent
      .post('/api/v1/vault/items')
      .set('x-csrf-token', owner.csrf)
      .send({ ciphertext: 'AAAAAAAAAAAAAAAAAAAAAAAA', iv: 'AAAA' })
      .expect(400);

    const task = await agent
      .post('/api/v1/tasks')
      .set('x-csrf-token', owner.csrf)
      .send({
        title: 'Проверить BASED',
        description: 'Пересмотреть тезис',
        priority: 2,
        tags: ['риск', 'портфель'],
        dueAt: '2026-12-01T12:00:00.000Z',
      })
      .expect(201);
    expect(task.body).toMatchObject({
      title: 'Проверить BASED',
      status: 'open',
      priority: 2,
      tags: ['риск', 'портфель'],
      images: [],
      completedAt: null,
    });

    const dataUrl =
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Z0ZkAAAAASUVORK5CYII=';
    const image = await agent
      .post(`/api/v1/tasks/${task.body.id}/images`)
      .set('x-csrf-token', owner.csrf)
      .send({ name: 'chart.png', mimeType: 'image/png', dataUrl })
      .expect(201);
    expect(image.body).toMatchObject({ name: 'chart.png', mimeType: 'image/png' });
    expect(image.body.sizeBytes).toBeGreaterThan(0);

    await agent
      .post(`/api/v1/tasks/${task.body.id}/images`)
      .set('x-csrf-token', owner.csrf)
      .send({ name: 'bad.png', mimeType: 'image/jpeg', dataUrl })
      .expect(400);

    const withImage = (await agent.get('/api/v1/tasks').expect(200)).body.data as Array<{
      id: string;
      images: Array<{ id: string }>;
    }>;
    expect(withImage.find((item) => item.id === task.body.id)?.images).toHaveLength(1);

    await agent
      .delete(`/api/v1/tasks/${task.body.id}/images/${image.body.id}`)
      .set('x-csrf-token', owner.csrf)
      .expect(200);

    const completed = await agent
      .patch(`/api/v1/tasks/${task.body.id}`)
      .set('x-csrf-token', owner.csrf)
      .send({ status: 'done' })
      .expect(200);
    expect(completed.body.completedAt).not.toBeNull();

    const reopened = await agent
      .patch(`/api/v1/tasks/${task.body.id}`)
      .set('x-csrf-token', owner.csrf)
      .send({ status: 'open' })
      .expect(200);
    expect(reopened.body.completedAt).toBeNull();

    await agent
      .post('/api/v1/tasks')
      .set('x-csrf-token', owner.csrf)
      .send({ title: 'Bad asset', relatedAssetId: '11111111-1111-4111-8111-111111111111' })
      .expect(400);

    await agent
      .patch(`/api/v1/tasks/${task.body.id}`)
      .set('x-csrf-token', owner.csrf)
      .send({ archived: true })
      .expect(200);
    const tasks = await agent.get('/api/v1/tasks').expect(200);
    expect(tasks.body.data).toEqual([]);
    const allTasks = await agent.get('/api/v1/tasks?includeArchived=true').expect(200);
    expect(allTasks.body.data).toHaveLength(1);

    const note = await agent
      .post('/api/v1/notes')
      .set('x-csrf-token', owner.csrf)
      .send({
        title: 'Идея по портфелю',
        body: 'Проверить корреляцию BASED и LINK',
        tags: ['идея', 'риск'],
        pinned: true,
      })
      .expect(201);
    expect(note.body).toMatchObject({
      title: 'Идея по портфелю',
      pinned: true,
      tags: ['идея', 'риск'],
    });

    const found = await agent.get('/api/v1/notes?search=корреляцию').expect(200);
    expect(found.body.data).toHaveLength(1);
    expect(found.body.data[0].id).toBe(note.body.id);

    const updatedNote = await agent
      .patch(`/api/v1/notes/${note.body.id}`)
      .set('x-csrf-token', owner.csrf)
      .send({ body: 'Обновлённый текст', pinned: false })
      .expect(200);
    expect(updatedNote.body).toMatchObject({ body: 'Обновлённый текст', pinned: false });

    await agent
      .post('/api/v1/notes')
      .set('x-csrf-token', owner.csrf)
      .send({
        title: 'Bad group',
        relatedTradeGroupId: '11111111-1111-4111-8111-111111111111',
      })
      .expect(400);

    await agent
      .patch(`/api/v1/notes/${note.body.id}`)
      .set('x-csrf-token', owner.csrf)
      .send({ archived: true })
      .expect(200);
    const notes = await agent.get('/api/v1/notes').expect(200);
    expect(notes.body.data).toEqual([]);
    const allNotes = await agent.get('/api/v1/notes?includeArchived=true').expect(200);
    expect(allNotes.body.data).toHaveLength(1);

    const audit = await agent.get('/api/v1/audit-log?limit=100').expect(200);
    const actions = (audit.body.data as Array<{ action: string; after: unknown }>).map(
      (entry) => entry.action,
    );
    expect(actions).toEqual(
      expect.arrayContaining([
        'vault.initialized',
        'vault.item_created',
        'vault.item_updated',
        'task.created',
        'task.updated',
        'note.created',
        'note.updated',
      ]),
    );

    const vaultAudits = (audit.body.data as Array<{ action: string; after: unknown }>).filter(
      (entry) => entry.action.startsWith('vault.'),
    );
    expect(JSON.stringify(vaultAudits)).not.toContain('AAAAAAAAAAAAAAAAAAAAAAAA');
  }, 60_000);

  it('generates recurring task occurrences and supports due-date ranges', async () => {
    const agent = request.agent(app.getHttpServer());
    const owner = await setupOwner(agent);

    const invalid = await agent
      .post('/api/v1/tasks')
      .set('x-csrf-token', owner.csrf)
      .send({ title: 'No due date', recurrence: 'daily' })
      .expect(400);
    expect(invalid.body.error.code).toBe('VALIDATION_ERROR');

    const created = await agent
      .post('/api/v1/tasks')
      .set('x-csrf-token', owner.csrf)
      .send({
        title: 'Daily check',
        dueAt: '2026-12-01T12:00:00.000Z',
        recurrence: 'daily',
        recurrenceEndsAt: '2026-12-05T12:00:00.000Z',
      })
      .expect(201);
    expect(created.body).toMatchObject({
      title: 'Daily check',
      recurrence: 'daily',
      occurrenceIndex: 0,
    });
    expect(created.body.seriesId).toBeTruthy();

    const all = await agent.get('/api/v1/tasks?limit=50').expect(200);
    const daily = (all.body.data as Array<{ seriesId: string; dueAt: string }>).filter(
      (task) => task.seriesId === created.body.seriesId,
    );
    expect(daily).toHaveLength(5);
    expect(daily.map((task) => task.dueAt)).toEqual([
      '2026-12-01T12:00:00.000Z',
      '2026-12-02T12:00:00.000Z',
      '2026-12-03T12:00:00.000Z',
      '2026-12-04T12:00:00.000Z',
      '2026-12-05T12:00:00.000Z',
    ]);

    const range = await agent
      .get('/api/v1/tasks?from=2026-12-02T00:00:00.000Z&to=2026-12-03T23:59:59.999Z')
      .expect(200);
    expect(range.body.data).toHaveLength(2);

    const moved = await agent
      .patch(
        `/api/v1/tasks/${daily[1]?.seriesId === undefined ? created.body.id : created.body.id}`,
      )
      .set('x-csrf-token', owner.csrf)
      .send({ dueAt: '2026-12-10T12:00:00.000Z' })
      .expect(200);
    expect(moved.body.dueAt).toBe('2026-12-10T12:00:00.000Z');

    const afterMove = await agent.get('/api/v1/tasks?limit=50').expect(200);
    const movedSeries = (afterMove.body.data as Array<{ seriesId: string; dueAt: string }>).filter(
      (task) => task.seriesId === created.body.seriesId,
    );
    expect(movedSeries.some((task) => task.dueAt === '2026-12-10T12:00:00.000Z')).toBe(true);

    const monthly = await agent
      .post('/api/v1/tasks')
      .set('x-csrf-token', owner.csrf)
      .send({
        title: 'Monthly check',
        dueAt: '2026-01-31T12:00:00.000Z',
        recurrence: 'monthly',
        recurrenceEndsAt: '2026-03-31T12:00:00.000Z',
      })
      .expect(201);
    const monthlyRows = (await agent.get('/api/v1/tasks?limit=50').expect(200)).body.data as Array<{
      seriesId: string;
      dueAt: string;
    }>;
    expect(
      monthlyRows
        .filter((task) => task.seriesId === monthly.body.seriesId)
        .map((task) => task.dueAt),
    ).toEqual(['2026-01-31T12:00:00.000Z', '2026-02-28T12:00:00.000Z', '2026-03-31T12:00:00.000Z']);

    await agent
      .patch(`/api/v1/tasks/${monthly.body.id}`)
      .set('x-csrf-token', owner.csrf)
      .send({ archived: true })
      .expect(200);
    const remaining = (await agent.get('/api/v1/tasks?limit=50').expect(200)).body.data as Array<{
      seriesId: string;
    }>;
    expect(remaining.filter((task) => task.seriesId === monthly.body.seriesId)).toHaveLength(2);
  }, 60_000);
});

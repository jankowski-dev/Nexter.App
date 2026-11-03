import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import cookie from '@fastify/cookie';
import { and, eq, sql } from 'drizzle-orm';
import { generateSync } from 'otplib';
import request, { type SuperAgentTest } from 'supertest';
import {
  auditLog,
  createDb,
  importRows,
  imports,
  lotConsumptions,
  lots,
  prices,
  tradeGroups,
  transactions,
  users,
  type Database,
} from '@nexter/db';
import { Decimal } from 'decimal.js';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { registerNotionImportBodyParser } from '../src/modules/imports/import-body-parser';
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

const page = (id: string) => `https://app.notion.com/p/${id.padEnd(32, '0').slice(0, 32)}`;

function sourceRow(id: string, symbol: string, price: number) {
  return {
    url: page(id),
    Название: symbol,
    'Символ [P]': symbol.toLowerCase(),
    'Курс [1]': price,
  };
}

function orderRow(input: {
  id: string;
  pageId: string;
  status: string;
  openedAt: string;
  closedAt?: string;
  source: string;
  destination: string;
  sourceAmount: number;
  destinationAmount: number;
  saleRate?: number;
}) {
  return {
    url: page(input.pageId),
    'userDefined:ID': input.id,
    Статус: input.status,
    'date:Открытие:start': input.openedAt,
    'date:Закрытие:start': input.closedAt ?? null,
    'Счет источника': [input.source],
    'Счет назначения': [input.destination],
    'Сумма-источника [1]': input.sourceAmount,
    'Сумма-назначения': input.destinationAmount,
    'Фактический курс [2]': input.saleRate ?? null,
  };
}

function transactionRow(input: {
  id: string;
  pageId: string;
  type: string;
  occurredAt: string;
  deposit?: number;
  withdrawal?: number;
  account: string;
}) {
  return {
    url: page(input.pageId),
    'userDefined:ID': input.id,
    'Тип транзакции': input.type,
    'date:Дата операции:start': input.occurredAt,
    'Сумма пополнения': input.deposit ?? null,
    'Сумма вывода': input.withdrawal ?? null,
    Счет: [input.account],
    Комментарий: null,
  };
}

function buildExport(
  options: {
    includeNewOrder?: boolean;
    closeOrder102?: boolean;
    status102?: 'Активна' | 'В продажу' | 'Резерв';
  } = {},
) {
  const usdt = sourceRow('1', 'USDT', 0.99873);
  const tokenA = sourceRow('2', 'TOKENA', 0.12);
  const tokenB = sourceRow('3', 'TOKENB', 0.15);
  const closed102 = options.closeOrder102 ?? false;

  const orders = [
    orderRow({
      id: '101',
      pageId: '4',
      status: 'Закрыта',
      openedAt: '2026-01-01T00:00:00.000Z',
      closedAt: '2026-01-02T00:00:00.000Z',
      source: usdt.url,
      destination: tokenA.url,
      sourceAmount: 100,
      destinationAmount: 1000,
      saleRate: 0.12,
    }),
    orderRow({
      id: '102',
      pageId: '5',
      status: closed102 ? 'Закрыта' : (options.status102 ?? 'Активна'),
      openedAt: '2026-01-03T00:00:00.000Z',
      closedAt: closed102 ? '2026-01-07T00:00:00.000Z' : undefined,
      source: usdt.url,
      destination: tokenA.url,
      sourceAmount: 50,
      destinationAmount: 500,
      saleRate: closed102 ? 0.13 : undefined,
    }),
    orderRow({
      id: '103',
      pageId: '6',
      status: 'Закрыта',
      openedAt: '2026-01-04T00:00:00.000Z',
      closedAt: '2026-01-05T00:00:00.000Z',
      source: usdt.url,
      destination: tokenB.url,
      sourceAmount: 200,
      destinationAmount: 1000,
      saleRate: 0.15,
    }),
  ];

  if (options.includeNewOrder) {
    orders.push(
      orderRow({
        id: '104',
        pageId: '9',
        status: 'Активна',
        openedAt: '2026-01-06T00:00:00.000Z',
        source: usdt.url,
        destination: tokenB.url,
        sourceAmount: 100,
        destinationAmount: 1000,
      }),
    );
  }

  return {
    fileName: 'test-export.json',
    source: [usdt, tokenA, tokenB],
    orders,
    transactions: [
      transactionRow({
        id: 'd1',
        pageId: '7',
        type: 'Ввод',
        occurredAt: '2025-12-01T00:00:00.000Z',
        deposit: 500,
        account: usdt.url,
      }),
      transactionRow({
        id: 'e1',
        pageId: '8',
        type: 'Вывод',
        occurredAt: '2026-02-01T00:00:00.000Z',
        withdrawal: 50,
        account: usdt.url,
      }),
    ],
  };
}

describe.runIf(canRun)('Notion import e2e', () => {
  let app: NestFastifyApplication;
  let db: Database;
  let pool: ReturnType<typeof createDb>['pool'];
  let emailCounter = 0;

  async function setupOwner(agent: SuperAgentTest) {
    const email = `imports-e2e-${Date.now()}-${emailCounter++}@example.com`;
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

  function previewRequest(
    agent: SuperAgentTest,
    csrf: string,
    payload: ReturnType<typeof buildExport>,
  ) {
    return agent
      .post('/api/v1/imports/notion/preview')
      .set('Content-Type', 'application/x-notion-import+json')
      .set('x-csrf-token', csrf)
      .send(JSON.stringify(payload));
  }

  async function preview(
    agent: SuperAgentTest,
    csrf: string,
    payload: ReturnType<typeof buildExport>,
  ) {
    return previewRequest(agent, csrf, payload).expect(200);
  }

  async function commit(agent: SuperAgentTest, csrf: string, importId: string) {
    return agent.post(`/api/v1/imports/${importId}/commit`).set('x-csrf-token', csrf).expect(200);
  }

  async function rollback(agent: SuperAgentTest, csrf: string, importId: string) {
    return agent.post(`/api/v1/imports/${importId}/rollback`).set('x-csrf-token', csrf).expect(200);
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    await app.register(cookie as any);
    app.setGlobalPrefix('api/v1', { exclude: ['health', 'ready'] });
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
    registerNotionImportBodyParser(app.getHttpAdapter().getInstance());
    await app.getHttpAdapter().getInstance().ready();

    const created = createDb(process.env.DATABASE_URL ?? '');
    db = created.db;
    pool = created.pool;
  }, 30_000);

  beforeEach(async () => {
    await db.execute(sql`truncate table prices, users restart identity cascade`);
    await db.execute(
      sql`delete from assets where chain_id = (select id from chains where code = 'bsc') and symbol not in ('USDC', 'XNY', 'BASED', 'APR', 'POP', 'LINK', 'BNB', 'USDT')`,
    );
  });

  afterAll(async () => {
    await app.close();
    await pool.end();
  });

  it('imports, reconciles, updates, and rolls back without losing control', async () => {
    const agent = request.agent(app.getHttpServer());
    const owner = await setupOwner(agent);

    const firstPayload = buildExport();
    const firstPreview = await preview(agent, owner.csrf, firstPayload);
    const firstImportId = firstPreview.body.import.id as string;

    expect(firstPreview.body.import.status).toBe('preview');
    expect(firstPreview.body.import.summary.counts).toMatchObject({
      sourceAssets: 3,
      orders: 3,
      closedOrders: 2,
      activeOrders: 1,
      transactions: 2,
      newOrders: 3,
      updatedOrders: 0,
      skippedOrders: 0,
      newTransactions: 2,
      skippedTransactions: 0,
      newAssets: 2,
      reusedAssets: 1,
    });
    expect(firstPreview.body.import.summary.control.applicable).toBe(false);
    expect(firstPreview.body.import.summary.errors).toEqual([]);
    expect(firstPreview.body.import.summary.totals).toMatchObject({
      buyUsd: '350',
      sellUsd: '270',
      depositsUsd: '500',
      withdrawalsUsd: '50',
      realizedPnlUsd: '-30',
      cashUsd: '370',
    });

    await commit(agent, owner.csrf, firstImportId);

    const importedRows = await db
      .select()
      .from(importRows)
      .where(eq(importRows.importId, firstImportId));
    expect(importedRows).toHaveLength(8);
    expect(importedRows.every((row) => row.status === 'imported')).toBe(true);

    const firstTransactions = await db
      .select()
      .from(transactions)
      .where(eq(transactions.userId, owner.userId));
    expect(firstTransactions).toHaveLength(7);

    const firstLots = await db.select().from(lots).where(eq(lots.userId, owner.userId));
    expect(firstLots).toHaveLength(3);
    expect(firstLots.filter((lot) => lot.remainingAmount === '0.000000000000000000')).toHaveLength(
      2,
    );

    const firstConsumptions = await db.select().from(lotConsumptions);
    expect(firstConsumptions).toHaveLength(2);
    const realized = firstConsumptions.reduce(
      (total, row) => total.plus(row.realizedPnlUsd),
      new Decimal(0),
    );
    expect(realized.toFixed(8)).toBe('-30.00000000');

    const firstGroups = await db
      .select()
      .from(tradeGroups)
      .where(eq(tradeGroups.userId, owner.userId));
    expect(firstGroups.map((group) => group.status).sort()).toEqual(['closed', 'closed', 'open']);

    const importedPrices = await db.select().from(prices).where(eq(prices.importId, firstImportId));
    expect(importedPrices).toHaveLength(2);

    const firstDashboard = await agent.get('/api/v1/dashboard/summary').expect(200);
    expect(firstDashboard.body).toMatchObject({
      cashUsd: '370.00000000',
      positionsValueUsd: '60.00000000',
      equityUsd: '430.00000000',
      netDepositsUsd: '450.00000000',
      realizedPnlUsd: '-30.00000000',
      unrealizedPnlUsd: '10.00000000',
      totalPnlUsd: '-20.00000000',
      missingPrices: [],
    });

    await previewRequest(agent, owner.csrf, firstPayload).expect(409);
    await previewRequest(agent, owner.csrf, {
      ...firstPayload,
      fileName: 'different-name.json',
    }).expect(409);

    const commitAudit = await db
      .select()
      .from(auditLog)
      .where(
        and(eq(auditLog.userId, owner.userId), eq(auditLog.action, 'import.notion_committed')),
      );
    expect(commitAudit).toHaveLength(1);

    const secondPayload = buildExport({ includeNewOrder: true });
    const secondPreview = await preview(agent, owner.csrf, secondPayload);
    const secondImportId = secondPreview.body.import.id as string;

    expect(secondPreview.body.import.summary.counts).toMatchObject({
      orders: 4,
      newOrders: 1,
      updatedOrders: 0,
      skippedOrders: 3,
      newTransactions: 0,
      skippedTransactions: 2,
      newAssets: 0,
      reusedAssets: 3,
    });

    await commit(agent, owner.csrf, secondImportId);
    expect(
      await db.select().from(transactions).where(eq(transactions.userId, owner.userId)),
    ).toHaveLength(8);

    const closePayload = buildExport({ includeNewOrder: true, closeOrder102: true });
    const closePreview = await preview(agent, owner.csrf, closePayload);
    const closeImportId = closePreview.body.import.id as string;

    expect(closePreview.body.import.summary.counts).toMatchObject({
      orders: 4,
      closedOrders: 3,
      activeOrders: 1,
      newOrders: 0,
      updatedOrders: 1,
      skippedOrders: 3,
      newTransactions: 0,
      skippedTransactions: 2,
    });

    await commit(agent, owner.csrf, closeImportId);
    expect(
      await db.select().from(transactions).where(eq(transactions.userId, owner.userId)),
    ).toHaveLength(9);

    const closedLot = (await db.select().from(lots).where(eq(lots.userId, owner.userId))).find(
      (lot) => lot.amount === '500.000000000000000000',
    );
    expect(closedLot?.remainingAmount).toBe('0.000000000000000000');

    const closeDashboard = await agent.get('/api/v1/dashboard/summary').expect(200);
    expect(closeDashboard.body).toMatchObject({
      cashUsd: '335.00000000',
      positionsValueUsd: '150.00000000',
      equityUsd: '485.00000000',
      netDepositsUsd: '450.00000000',
      realizedPnlUsd: '-15.00000000',
      unrealizedPnlUsd: '50.00000000',
      totalPnlUsd: '35.00000000',
    });

    await rollback(agent, owner.csrf, closeImportId);
    expect(
      await db.select().from(transactions).where(eq(transactions.userId, owner.userId)),
    ).toHaveLength(8);

    const restoredLot = (await db.select().from(lots).where(eq(lots.userId, owner.userId))).find(
      (lot) => lot.amount === '500.000000000000000000',
    );
    expect(restoredLot?.remainingAmount).toBe('500.000000000000000000');
    expect(
      (await db.select().from(tradeGroups).where(eq(tradeGroups.userId, owner.userId))).filter(
        (group) => group.id === restoredLot?.tradeGroupId,
      )[0]?.status,
    ).toBe('open');

    const restoredDashboard = await agent.get('/api/v1/dashboard/summary').expect(200);
    expect(restoredDashboard.body).toMatchObject({
      cashUsd: '270.00000000',
      positionsValueUsd: '210.00000000',
      equityUsd: '480.00000000',
      realizedPnlUsd: '-30.00000000',
      unrealizedPnlUsd: '60.00000000',
      totalPnlUsd: '30.00000000',
    });

    await rollback(agent, owner.csrf, secondImportId);
    expect(
      await db.select().from(transactions).where(eq(transactions.userId, owner.userId)),
    ).toHaveLength(7);

    const afterSecondRollback = await agent.get('/api/v1/dashboard/summary').expect(200);
    expect(afterSecondRollback.body).toMatchObject({
      cashUsd: '370.00000000',
      positionsValueUsd: '60.00000000',
      equityUsd: '430.00000000',
      realizedPnlUsd: '-30.00000000',
      unrealizedPnlUsd: '10.00000000',
      totalPnlUsd: '-20.00000000',
    });

    await rollback(agent, owner.csrf, firstImportId);
    expect(
      await db.select().from(transactions).where(eq(transactions.userId, owner.userId)),
    ).toHaveLength(0);

    const rollbackAudit = await db
      .select()
      .from(auditLog)
      .where(
        and(eq(auditLog.userId, owner.userId), eq(auditLog.action, 'import.notion_rolled_back')),
      );
    expect(rollbackAudit.length).toBeGreaterThanOrEqual(1);
    expect(await db.select().from(lots).where(eq(lots.userId, owner.userId))).toHaveLength(0);
    expect(await db.select().from(lotConsumptions)).toHaveLength(0);
    expect(
      await db.select().from(tradeGroups).where(eq(tradeGroups.userId, owner.userId)),
    ).toHaveLength(0);
    expect(await db.select().from(prices).where(eq(prices.importId, firstImportId))).toHaveLength(
      0,
    );

    const emptyDashboard = await agent.get('/api/v1/dashboard/summary').expect(200);
    expect(emptyDashboard.body).toMatchObject({
      cashUsd: '0.00000000',
      positionsValueUsd: '0.00000000',
      equityUsd: '0.00000000',
      netDepositsUsd: '0.00000000',
      realizedPnlUsd: '0.00000000',
      unrealizedPnlUsd: '0.00000000',
      totalPnlUsd: '0.00000000',
    });

    const rePreview = await preview(agent, owner.csrf, firstPayload);
    expect(rePreview.body.import.id).toBe(firstImportId);
    expect(rePreview.body.import.status).toBe('preview');
    expect(rePreview.body.import.summary.counts).toMatchObject({
      newOrders: 3,
      newTransactions: 2,
      newAssets: 0,
      reusedAssets: 3,
    });

    await commit(agent, owner.csrf, firstImportId);
    expect(
      await db.select().from(transactions).where(eq(transactions.userId, owner.userId)),
    ).toHaveLength(7);

    const [importRecord] = await db.select().from(imports).where(eq(imports.id, firstImportId));
    expect(importRecord?.status).toBe('committed');

    const accountsResponse = await agent.get('/api/v1/accounts').expect(200);
    const assetsResponse = await agent.get('/api/v1/assets').expect(200);
    const wallet = (accountsResponse.body.accounts as Array<{ id: string; name: string }>).find(
      (account) => account.name === 'Tangem BSC',
    );
    const usdt = (
      assetsResponse.body.assets as Array<{
        id: string;
        chainCode: string;
        symbol: string;
      }>
    ).find((asset) => asset.chainCode === 'bsc' && asset.symbol === 'USDT');

    await agent
      .post('/api/v1/transactions')
      .set('x-csrf-token', owner.csrf)
      .send({
        type: 'deposit',
        accountId: wallet?.id,
        assetId: usdt?.id,
        amount: '1',
        usdValue: '1',
      })
      .expect(201);

    const blockedRollback = await agent
      .post(`/api/v1/imports/${firstImportId}/rollback`)
      .set('x-csrf-token', owner.csrf)
      .expect(409);
    expect(blockedRollback.body.error.code).toBe('CONFLICT');

    const [user] = await db.select().from(users).where(eq(users.id, owner.userId));
    expect(user?.email).toBe(owner.email);
  }, 120_000);

  it('requires authentication and CSRF for import preview', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/imports/notion/preview')
      .send(buildExport())
      .expect(401);

    const agent = request.agent(app.getHttpServer());
    await setupOwner(agent);

    await agent.post('/api/v1/imports/notion/preview').send(buildExport()).expect(403);
  }, 60_000);

  it('requires the lossless import content type and rejects it elsewhere', async () => {
    const agent = request.agent(app.getHttpServer());
    const owner = await setupOwner(agent);

    await agent
      .post('/api/v1/imports/notion/preview')
      .set('x-csrf-token', owner.csrf)
      .send(buildExport())
      .expect(415);

    await agent
      .post('/api/v1/auth/login')
      .set('Content-Type', 'application/x-notion-import+json')
      .send('{}')
      .expect(415);

    await agent
      .post('/api/v1/imports/notion/preview')
      .set('Content-Type', 'Application/X-Notion-Import+Json')
      .set('x-csrf-token', owner.csrf)
      .send(JSON.stringify(buildExport()))
      .expect(200);

    await agent
      .post('/api/v1/auth/login')
      .set('Content-Type', 'Application/X-Notion-Import+Json')
      .send('{}')
      .expect(415);
  }, 60_000);

  it('restores a status-only update on rollback', async () => {
    const agent = request.agent(app.getHttpServer());
    const owner = await setupOwner(agent);

    const firstPayload = buildExport();
    const firstPreview = await preview(agent, owner.csrf, firstPayload);
    await commit(agent, owner.csrf, firstPreview.body.import.id as string);

    const forSalePreview = await preview(
      agent,
      owner.csrf,
      buildExport({ status102: 'В продажу' }),
    );
    expect(forSalePreview.body.import.summary.counts).toMatchObject({
      updatedOrders: 1,
      skippedOrders: 2,
    });
    await commit(agent, owner.csrf, forSalePreview.body.import.id as string);

    const [forSaleGroup] = await db
      .select()
      .from(tradeGroups)
      .where(and(eq(tradeGroups.userId, owner.userId), eq(tradeGroups.status, 'for_sale')));
    expect(forSaleGroup).toBeDefined();

    await rollback(agent, owner.csrf, forSalePreview.body.import.id as string);

    const [restoredGroup] = await db
      .select()
      .from(tradeGroups)
      .where(eq(tradeGroups.id, forSaleGroup?.id ?? ''));
    expect(restoredGroup?.status).toBe('open');
  }, 120_000);

  it('recreates skipped rows when a preview is committed after rolling back its source import', async () => {
    const agent = request.agent(app.getHttpServer());
    const owner = await setupOwner(agent);

    const firstPayload = buildExport();
    const firstPreview = await preview(agent, owner.csrf, firstPayload);
    await commit(agent, owner.csrf, firstPreview.body.import.id as string);

    const secondPayload = buildExport({ includeNewOrder: true });
    const secondPreview = await preview(agent, owner.csrf, secondPayload);
    const secondImportId = secondPreview.body.import.id as string;

    expect(secondPreview.body.import.summary.counts).toMatchObject({
      newOrders: 1,
      skippedOrders: 3,
    });

    await rollback(agent, owner.csrf, firstPreview.body.import.id as string);
    await commit(agent, owner.csrf, secondImportId);

    expect(
      await db.select().from(transactions).where(eq(transactions.userId, owner.userId)),
    ).toHaveLength(8);

    const secondRows = await db
      .select()
      .from(importRows)
      .where(eq(importRows.importId, secondImportId));
    expect(secondRows).toHaveLength(9);
    expect(secondRows.every((row) => row.status === 'imported')).toBe(true);

    const dashboard = await agent.get('/api/v1/dashboard/summary').expect(200);
    expect(dashboard.body).toMatchObject({
      cashUsd: '270.00000000',
      positionsValueUsd: '210.00000000',
      equityUsd: '480.00000000',
      netDepositsUsd: '450.00000000',
      realizedPnlUsd: '-30.00000000',
      unrealizedPnlUsd: '60.00000000',
      totalPnlUsd: '30.00000000',
    });
  }, 120_000);

  it('rejects a stale close preview after manual FIFO consumes the imported lot', async () => {
    const agent = request.agent(app.getHttpServer());
    const owner = await setupOwner(agent);

    const firstPayload = buildExport();
    const firstPreview = await preview(agent, owner.csrf, firstPayload);
    await commit(agent, owner.csrf, firstPreview.body.import.id as string);

    const closePreview = await preview(agent, owner.csrf, buildExport({ closeOrder102: true }));
    const closeImportId = closePreview.body.import.id as string;
    expect(closePreview.body.import.summary.errors).toEqual([]);

    const accountsResponse = await agent.get('/api/v1/accounts').expect(200);
    const assetsResponse = await agent.get('/api/v1/assets').expect(200);
    const wallet = (accountsResponse.body.accounts as Array<{ id: string; name: string }>).find(
      (account) => account.name === 'Tangem BSC',
    );
    const tokenA = (
      assetsResponse.body.assets as Array<{
        id: string;
        chainCode: string;
        symbol: string;
      }>
    ).find((asset) => asset.chainCode === 'bsc' && asset.symbol === 'TOKENA');
    const usdt = (
      assetsResponse.body.assets as Array<{
        id: string;
        chainCode: string;
        symbol: string;
      }>
    ).find((asset) => asset.chainCode === 'bsc' && asset.symbol === 'USDT');
    const [openGroup] = await db
      .select()
      .from(tradeGroups)
      .where(
        and(
          eq(tradeGroups.userId, owner.userId),
          eq(tradeGroups.assetId, tokenA?.id ?? ''),
          eq(tradeGroups.status, 'open'),
        ),
      );

    await agent
      .post('/api/v1/transactions')
      .set('x-csrf-token', owner.csrf)
      .send({
        type: 'sell',
        accountId: wallet?.id,
        assetId: tokenA?.id,
        amount: '100',
        proceedsAssetId: usdt?.id,
        proceedsAmount: '12',
        usdValue: '12',
      })
      .expect(201);

    const consumedLot = (await db.select().from(lots).where(eq(lots.userId, owner.userId))).find(
      (lot) => lot.amount === '500.000000000000000000',
    );
    expect(consumedLot?.remainingAmount).toBe('400.000000000000000000');
    const [partialGroup] = await db
      .select()
      .from(tradeGroups)
      .where(eq(tradeGroups.id, openGroup?.id ?? ''));
    expect(partialGroup?.status).toBe('partial');

    const conflict = await agent
      .post(`/api/v1/imports/${closeImportId}/commit`)
      .set('x-csrf-token', owner.csrf)
      .expect(409);
    expect(conflict.body.error.code).toBe('IMPORT_CONFLICT');
    expect(conflict.body.error.details).toEqual(
      expect.arrayContaining([expect.stringContaining('not fully open')]),
    );

    const refreshedPreview = await preview(agent, owner.csrf, buildExport({ closeOrder102: true }));
    expect(refreshedPreview.body.import.summary.errors.length).toBeGreaterThan(0);

    const refreshedConflict = await agent
      .post(`/api/v1/imports/${refreshedPreview.body.import.id}/commit`)
      .set('x-csrf-token', owner.csrf)
      .expect(409);
    expect(refreshedConflict.body.error.code).toBe('IMPORT_CONFLICT');

    expect(
      await db.select().from(transactions).where(eq(transactions.userId, owner.userId)),
    ).toHaveLength(8);

    const dashboard = await agent.get('/api/v1/dashboard/summary').expect(200);
    expect(dashboard.body).toMatchObject({
      cashUsd: '382.00000000',
      positionsValueUsd: '48.00000000',
      equityUsd: '430.00000000',
      netDepositsUsd: '450.00000000',
      realizedPnlUsd: '-28.00000000',
      unrealizedPnlUsd: '8.00000000',
      totalPnlUsd: '-20.00000000',
    });
  }, 120_000);
});

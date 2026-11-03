import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import cookie from '@fastify/cookie';
import { eq, sql } from 'drizzle-orm';
import { generateSync } from 'otplib';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import request, { type SuperAgentTest } from 'supertest';
import {
  createDb,
  importRows,
  lotConsumptions,
  lots,
  prices,
  tradeGroups,
  transactions,
  type Database,
} from '@nexter/db';
import { Decimal } from 'decimal.js';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { registerNotionImportBodyParser } from '../src/modules/imports/import-body-parser';
import { AllExceptionsFilter } from '../src/shared/errors/all-exceptions.filter';

const exportDir = process.env.NOTION_EXPORT_DIR;
const canRun = Boolean(
  process.env.NEXTER_TEST_DB === '1' &&
  process.env.DATABASE_URL &&
  process.env.SETUP_TOKEN &&
  process.env.AUTH_ENCRYPTION_KEY &&
  exportDir,
);

const password = 'correct horse battery staple';

function csrfFrom(response: request.Response): string {
  const setCookie = response.headers['set-cookie'];
  const cookies = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : [];
  const raw = cookies.find((value) => value.startsWith('nexter_csrf='));

  return raw?.split(';')[0]?.split('=')[1] ?? '';
}

function readExportText(name: string): string {
  return readFileSync(join(exportDir ?? '', name), 'utf8');
}

describe.runIf(canRun)('Notion 431-row import', () => {
  let app: NestFastifyApplication;
  let db: Database;
  let pool: ReturnType<typeof createDb>['pool'];

  async function setupOwner(agent: SuperAgentTest) {
    const setup = await agent
      .post('/api/v1/auth/setup')
      .send({
        setupToken: process.env.SETUP_TOKEN,
        email: `notion-431-${Date.now()}@example.com`,
        password,
      })
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

  it('matches the 429-order control snapshot and imports all 431 rows', async () => {
    const agent = request.agent(app.getHttpServer());
    const owner = await setupOwner(agent);
    const rawBody = `{"fileName":"notion-431.json","source":${readExportText('source.json')},"orders":${readExportText('orders.json')},"transactions":${readExportText('transactions.json')}}`;

    const preview = await agent
      .post('/api/v1/imports/notion/preview')
      .set('Content-Type', 'application/x-notion-import+json')
      .set('x-csrf-token', owner.csrf)
      .send(rawBody)
      .expect(200);

    const summary = preview.body.import.summary;
    const importId = preview.body.import.id as string;

    const reconciliation = await agent
      .get(`/api/v1/imports/${importId}/reconciliation`)
      .expect(200);
    expect(reconciliation.body.control.matches).toBe(true);
    expect(reconciliation.body.valuation.activeValueUsd).toBe('1829.88804762');

    expect(summary.errors).toEqual([]);
    expect(summary.control.applicable).toBe(true);
    expect(summary.control.matches).toBe(true);
    expect(summary.control.baseline).toMatchObject({
      orders: 429,
      closedOrders: 410,
      activeOrders: 19,
    });
    expect(new Decimal(summary.control.baseline.buyUsd).toFixed(2)).toBe('54955.30');
    expect(new Decimal(summary.control.baseline.sellUsd).toFixed(10)).toBe('52508.0139345416');
    expect(new Decimal(summary.control.baseline.realizedPnlUsd).toFixed(10)).toBe('69.8139345416');
    expect(new Decimal(summary.control.baseline.activeCostUsd).toFixed(2)).toBe('2517.10');
    expect(new Decimal(summary.control.deltas.activeCostUsd).abs().lte(0.01)).toBe(true);
    expect(summary.counts).toMatchObject({
      sourceAssets: 36,
      orders: 431,
      closedOrders: 412,
      activeOrders: 19,
      transactions: 9,
      newOrders: 431,
      updatedOrders: 0,
      skippedOrders: 0,
      newTransactions: 9,
      skippedTransactions: 0,
      newAssets: 30,
      reusedAssets: 6,
    });
    expect(new Decimal(summary.totals.buyUsd).toFixed(2)).toBe('55293.10');
    expect(new Decimal(summary.totals.sellUsd).toFixed(10)).toBe('52846.0362995416');
    expect(new Decimal(summary.totals.realizedPnlUsd).toFixed(10)).toBe('55.6362995416');
    expect(new Decimal(summary.totals.cashUsd).toFixed(10)).toBe('15.7362995416');
    expect(new Decimal(summary.totals.activeCostUsd).toFixed(2)).toBe('2502.70');
    expect(new Decimal(summary.valuation.activeValueUsd).toFixed(8)).toBe('1829.88804762');
    expect(new Decimal(summary.valuation.unrealizedPnlUsd).toFixed(8)).toBe('-672.81195238');
    expect(new Decimal(summary.valuation.equityUsd).toFixed(8)).toBe('1845.62434716');
    expect(new Decimal(summary.valuation.totalPnlUsd).toFixed(8)).toBe('-617.17565284');
    expect(summary.valuation.missingPrices).toEqual([]);
    expect(summary.valuation.controlSnapshot.activeValueUsd).toBe('2060.42365438');
    expect(summary.currentDeltas).toMatchObject({
      orders: 2,
      closedOrders: 2,
      activeOrders: 0,
    });
    expect(new Decimal(summary.currentDeltas.buyUsd).toFixed(2)).toBe('337.80');
    expect(new Decimal(summary.currentDeltas.sellUsd).toFixed(6)).toBe('338.022365');
    expect(new Decimal(summary.currentDeltas.realizedPnlUsd).toFixed(6)).toBe('-14.177635');
    expect(new Decimal(summary.currentDeltas.cashUsd).toFixed(6)).toBe('0.222365');

    await agent
      .post(`/api/v1/imports/${importId}/commit`)
      .set('x-csrf-token', owner.csrf)
      .expect(200);

    const txRows = await db
      .select()
      .from(transactions)
      .where(eq(transactions.userId, owner.userId));
    expect(txRows).toHaveLength(852);

    const lotRows = await db.select().from(lots).where(eq(lots.userId, owner.userId));
    expect(lotRows).toHaveLength(431);
    expect(lotRows.filter((lot) => lot.remainingAmount === '0.000000000000000000')).toHaveLength(
      412,
    );

    const consumptionRows = await db.select().from(lotConsumptions);
    expect(consumptionRows).toHaveLength(412);
    const realized = consumptionRows.reduce(
      (total, row) => total.plus(row.realizedPnlUsd),
      new Decimal(0),
    );
    expect(realized.toFixed(8)).toBe('55.63629954');

    const groupRows = await db
      .select()
      .from(tradeGroups)
      .where(eq(tradeGroups.userId, owner.userId));
    expect(groupRows).toHaveLength(431);
    expect(groupRows.filter((group) => group.status === 'closed')).toHaveLength(412);
    expect(groupRows.filter((group) => group.status === 'open')).toHaveLength(19);

    const priceRows = await db.select().from(prices).where(eq(prices.importId, importId));
    expect(priceRows).toHaveLength(35);

    const importedRows = await db
      .select()
      .from(importRows)
      .where(eq(importRows.importId, importId));
    expect(importedRows).toHaveLength(36 + 431 + 9);
    expect(importedRows.every((row) => row.status === 'imported')).toBe(true);

    const dashboard = await agent.get('/api/v1/dashboard/summary').expect(200);
    expect(dashboard.body).toMatchObject({
      cashUsd: '15.73629954',
      positionsValueUsd: '1829.88804762',
      equityUsd: '1845.62434716',
      netDepositsUsd: '2462.80000000',
      realizedPnlUsd: '55.63629954',
      unrealizedPnlUsd: '-672.81195238',
      totalPnlUsd: '-617.17565284',
      missingPrices: [],
    });

    expect(dashboard.body.positionsValueUsd).toBe(summary.valuation.activeValueUsd);
    expect(dashboard.body.realizedPnlUsd).toBe(summary.valuation.realizedPnlUsd);
    expect(dashboard.body.unrealizedPnlUsd).toBe(summary.valuation.unrealizedPnlUsd);
    expect(dashboard.body.totalPnlUsd).toBe(summary.valuation.totalPnlUsd);
    expect(dashboard.body.equityUsd).toBe(summary.valuation.equityUsd);
    expect(new Decimal(dashboard.body.cashUsd).toFixed(8)).toBe(
      new Decimal(summary.valuation.cashUsd).toFixed(8),
    );

    expect(
      new Decimal(dashboard.body.equityUsd).minus(dashboard.body.netDepositsUsd).toFixed(8),
    ).toBe(new Decimal(dashboard.body.totalPnlUsd).toFixed(8));

    const assetResponse = await agent.get('/api/v1/assets').expect(200);
    const popAsset = (assetResponse.body.assets as Array<{ id: string; symbol: string }>).find(
      (asset) => asset.symbol === 'POP',
    );
    expect(popAsset).toBeDefined();

    const allocation = await agent.get('/api/v1/dashboard/allocation').expect(200);
    expect(allocation.body.totalUsd).toBe('1845.62434716');
    expect(allocation.body.slices).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: 'cash', valueUsd: '15.73629954' }),
        expect.objectContaining({ key: popAsset?.id }),
      ]),
    );

    const pnlMonths = await agent.get('/api/v1/dashboard/pnl').expect(200);
    expect(pnlMonths.body.months.length).toBeGreaterThan(0);
    const pnlTotal = pnlMonths.body.months.reduce(
      (total: Decimal, month: { realizedUsd: string }) => total.plus(month.realizedUsd),
      new Decimal(0),
    );
    expect(pnlTotal.toFixed(8)).toBe('55.63629954');

    const activePositions = await agent.get('/api/v1/dashboard/active-positions').expect(200);
    expect(activePositions.body.positions).toHaveLength(4);

    const recentTrades = await agent.get('/api/v1/dashboard/recent-trades').expect(200);
    expect(recentTrades.body.data).toHaveLength(5);
    expect(recentTrades.body.data[0].source).toBe('notion');

    const groups = await agent.get('/api/v1/trade-groups?limit=5').expect(200);
    expect(groups.body.data).toHaveLength(5);
    expect(groups.body.page.hasMore).toBe(true);
    const closedGroup = groups.body.data.find(
      (group: { status: string }) => group.status === 'closed',
    );
    if (!closedGroup) throw new Error('Expected a closed group in the first page');
    const groupDetail = await agent.get(`/api/v1/trade-groups/${closedGroup.id}`).expect(200);
    expect(groupDetail.body.group.source).toBe('notion');
    expect(groupDetail.body.legs.length).toBeGreaterThan(0);
    expect(groupDetail.body.lots).toHaveLength(1);
    expect(groupDetail.body.audit.length).toBeGreaterThan(0);
    const sellLeg = groupDetail.body.legs.find(
      (leg: { subtype: string }) => leg.subtype === 'sell',
    );
    expect(sellLeg).toBeDefined();
    expect(groupDetail.body.consumptions[0].disposalOccurredAt).toBe(sellLeg.occurredAt);

    const xnyAsset = (assetResponse.body.assets as Array<{ id: string; symbol: string }>).find(
      (asset) => asset.symbol === 'XNY',
    );
    const usdtAsset = (assetResponse.body.assets as Array<{ id: string; symbol: string }>).find(
      (asset) => asset.symbol === 'USDT',
    );
    const portfolioAsset = await agent.get(`/api/v1/portfolio/assets/${popAsset?.id}`).expect(200);
    expect(portfolioAsset.body.asset.symbol).toBe('POP');
    expect(portfolioAsset.body.position).not.toBeNull();
    expect(portfolioAsset.body.lots.length).toBeGreaterThan(0);
    const xnyDetail = await agent.get(`/api/v1/portfolio/assets/${xnyAsset?.id}`).expect(200);
    expect(xnyDetail.body.tradeGroups.length).toBeGreaterThan(50);
    const cashDetail = await agent.get(`/api/v1/portfolio/assets/${usdtAsset?.id}`).expect(200);
    expect(cashDetail.body.position).toMatchObject({
      isCashEquivalent: true,
      priceUsd: '1.00000000',
    });

    const watchlist = await agent.get('/api/v1/watchlist').expect(200);
    expect(watchlist.body.data).toHaveLength(36);
    expect(watchlist.body.data.some((entry: { thesis: string | null }) => entry.thesis)).toBe(true);
    const basedWatchlist = watchlist.body.data.find(
      (entry: { asset: { symbol: string } }) => entry.asset.symbol === 'BASED',
    );
    expect(basedWatchlist.tags).toContain('Дашбоард');

    const dataQuality = await agent.get('/api/v1/dashboard/data-quality').expect(200);
    expect(dataQuality.body.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'unverified_assets' }),
        expect.objectContaining({ code: 'missing_gas' }),
        expect.objectContaining({ code: 'unreconciled' }),
      ]),
    );
    expect(dataQuality.body.negativeBalances).toEqual([]);

    const audit = await agent.get('/api/v1/audit-log?action=import.notion_committed').expect(200);
    expect(audit.body.data).toHaveLength(1);

    const exportTransactions = await agent.get('/api/v1/export/transactions.json').expect(200);
    expect(exportTransactions.body).toHaveLength(852);
    const exportGroups = await agent.get('/api/v1/export/trade-groups.csv').expect(200);
    expect(exportGroups.text).toContain('POP');

    const equityCurve = await agent.get('/api/v1/dashboard/equity-curve').expect(200);
    expect(equityCurve.body.valuation).toBe('current-prices');
    expect(equityCurve.body.points.length).toBeGreaterThan(0);
    expect(equityCurve.body.points.at(-1).equityUsd).toBe('1845.62434716');

    const settings = await agent.get('/api/v1/settings').expect(200);
    expect(settings.body).toMatchObject({
      baseCurrency: 'USD',
      taxMethod: 'FIFO',
    });

    await agent
      .post(`/api/v1/imports/${importId}/rollback`)
      .set('x-csrf-token', owner.csrf)
      .expect(200);

    expect(
      await db.select().from(transactions).where(eq(transactions.userId, owner.userId)),
    ).toHaveLength(0);
    expect(await db.select().from(lots).where(eq(lots.userId, owner.userId))).toHaveLength(0);
    expect(await db.select().from(lotConsumptions)).toHaveLength(0);
    expect(
      await db.select().from(tradeGroups).where(eq(tradeGroups.userId, owner.userId)),
    ).toHaveLength(0);
    expect(await db.select().from(prices).where(eq(prices.importId, importId))).toHaveLength(0);

    const empty = await agent.get('/api/v1/dashboard/summary').expect(200);
    expect(empty.body).toMatchObject({
      cashUsd: '0.00000000',
      positionsValueUsd: '0.00000000',
      equityUsd: '0.00000000',
      netDepositsUsd: '0.00000000',
      realizedPnlUsd: '0.00000000',
      unrealizedPnlUsd: '0.00000000',
      totalPnlUsd: '0.00000000',
    });
  }, 180_000);
});

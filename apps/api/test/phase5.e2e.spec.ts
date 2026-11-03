import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import cookie from '@fastify/cookie';
import { eq, sql } from 'drizzle-orm';
import { generateSync } from 'otplib';
import request, { type SuperAgentTest } from 'supertest';
import { accounts, assets, createDb, type Database } from '@nexter/db';
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

describe.runIf(canRun)('Phase 5 MVP-1 UI API', () => {
  let app: NestFastifyApplication;
  let db: Database;
  let pool: ReturnType<typeof createDb>['pool'];

  async function setupOwner(agent: SuperAgentTest) {
    const email = `phase5-e2e-${Date.now()}@example.com`;
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
      userId: setup.body.user.id as string,
      csrf: csrfFrom(enabled),
    };
  }

  async function createTransaction(
    agent: SuperAgentTest,
    csrf: string,
    body: Record<string, unknown>,
  ) {
    return agent.post('/api/v1/transactions').set('x-csrf-token', csrf).send(body).expect(201);
  }

  async function getAssets(agent: SuperAgentTest) {
    const response = await agent.get('/api/v1/assets').expect(200);
    return response.body.assets as Array<{
      id: string;
      chainId: string;
      chainCode: string;
      symbol: string;
    }>;
  }

  async function getAccounts(agent: SuperAgentTest) {
    const response = await agent.get('/api/v1/accounts').expect(200);
    return response.body.accounts as Array<{
      id: string;
      name: string;
      type: string;
      chainId: string | null;
    }>;
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
    await db.execute(
      sql`delete from assets where chain_id = (select id from chains where code = 'bsc') and symbol not in ('USDC', 'XNY', 'BASED', 'APR', 'POP', 'LINK', 'BNB', 'USDT')`,
    );
  });

  afterAll(async () => {
    await app.close();
    await pool.end();
  });

  it('serves dashboard, portfolio, trades, watchlist, settings, audit and export', async () => {
    const agent = request.agent(app.getHttpServer());
    const owner = await setupOwner(agent);
    const allAssets = await getAssets(agent);
    const asset = (symbol: string) => {
      const found = allAssets.find((item) => item.symbol === symbol);
      expect(found).toBeDefined();
      return found as { id: string; chainId: string; chainCode: string; symbol: string };
    };
    const based = asset('BASED');
    const usdt = asset('USDT');
    const wallet = (await getAccounts(agent)).find((account) => account.name === 'Tangem BSC');
    expect(wallet).toBeDefined();

    await agent
      .post(`/api/v1/prices/${based.id}`)
      .set('x-csrf-token', owner.csrf)
      .send({ priceUsd: '2.00' })
      .expect(201);

    await createTransaction(agent, owner.csrf, {
      type: 'deposit',
      accountId: wallet?.id,
      assetId: usdt.id,
      amount: '1000',
      usdValue: '1000',
      notes: '=cmd',
    });
    await createTransaction(agent, owner.csrf, {
      type: 'buy',
      accountId: wallet?.id,
      assetId: based.id,
      amount: '100',
      quoteAssetId: usdt.id,
      quoteAmount: '100',
    });
    await createTransaction(agent, owner.csrf, {
      type: 'sell',
      accountId: wallet?.id,
      assetId: based.id,
      amount: '40',
      proceedsAssetId: usdt.id,
      proceedsAmount: '100',
      usdValue: '100',
    });
    await createTransaction(agent, owner.csrf, {
      type: 'income',
      accountId: wallet?.id,
      assetId: usdt.id,
      amount: '10',
      usdValue: '10',
    });
    await createTransaction(agent, owner.csrf, {
      type: 'adjustment',
      accountId: wallet?.id,
      assetId: usdt.id,
      amount: '5',
      usdValue: '5',
      reason: 'Test adjustment',
    });

    const summary = await agent.get('/api/v1/dashboard/summary').expect(200);
    expect(summary.headers['cache-control']).toBe('no-store');
    expect(summary.body).toMatchObject({
      cashUsd: '1015.00000000',
      positionsValueUsd: '120.00000000',
      equityUsd: '1135.00000000',
      netDepositsUsd: '1000.00000000',
      incomeUsd: '10.00000000',
      adjustmentsUsd: '5.00000000',
      realizedPnlUsd: '60.00000000',
      unrealizedPnlUsd: '60.00000000',
      totalPnlUsd: '135.00000000',
      roiPct: '13.50',
      activePositionsCount: 1,
      missingPrices: [],
    });

    const allocation = await agent.get('/api/v1/dashboard/allocation').expect(200);
    expect(allocation.body.totalUsd).toBe('1135.00000000');
    expect(allocation.body.slices).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: 'cash', valueUsd: '1015.00000000' }),
        expect.objectContaining({ key: based.id, valueUsd: '120.00000000' }),
      ]),
    );

    const pnl = await agent.get('/api/v1/dashboard/pnl').expect(200);
    expect(pnl.body.months.length).toBeGreaterThan(0);
    const currentMonth = pnl.body.months.at(-1);
    expect(currentMonth).toMatchObject({
      realizedUsd: '60.00000000',
      incomeUsd: '10.00000000',
      adjustmentsUsd: '5.00000000',
      feesUsd: '0.00000000',
      totalUsd: '75.00000000',
    });

    const active = await agent.get('/api/v1/dashboard/active-positions').expect(200);
    expect(active.body.positions).toHaveLength(1);
    expect(active.body.positions[0]).toMatchObject({
      amount: '60.000000000000000000',
      valueUsd: '120.00000000',
      unrealizedPnlUsd: '60.00000000',
    });

    const recent = await agent.get('/api/v1/dashboard/recent-trades').expect(200);
    expect(recent.body.data).toHaveLength(1);
    const groupId = recent.body.data[0].id as string;
    expect(recent.body.data[0]).toMatchObject({
      status: 'partial',
      buyUsd: '100.00000000',
      sellUsd: '100.00000000',
      realizedPnlUsd: '60.00000000',
      remainingAmount: '60.000000000000000000',
      remainingCostBasisUsd: '60.00000000',
      unrealizedPnlUsd: '60.00000000',
      totalPnlUsd: '120.00000000',
      returnPct: '120.00',
    });

    const groups = await agent.get('/api/v1/trade-groups').expect(200);
    expect(groups.body.data).toHaveLength(1);
    expect(groups.body.page).toMatchObject({ nextCursor: null, hasMore: false });

    const detail = await agent.get(`/api/v1/trade-groups/${groupId}`).expect(200);
    expect(detail.body.group.id).toBe(groupId);
    expect(detail.body.legs).toHaveLength(2);
    expect(detail.body.lots).toHaveLength(1);
    expect(detail.body.consumptions).toHaveLength(1);
    expect(detail.body.audit.length).toBeGreaterThan(0);

    const notes = await agent
      .patch(`/api/v1/trade-groups/${groupId}`)
      .set('x-csrf-token', owner.csrf)
      .send({ notes: 'Test trade note' })
      .expect(200);
    expect(notes.body.group.notes).toBe('Test trade note');

    const groupSellBody = {
      accountId: wallet?.id,
      amount: '10',
      proceedsAssetId: usdt.id,
      proceedsAmount: '25',
      usdValue: '25',
    };
    const groupSell = await agent
      .post(`/api/v1/trade-groups/${groupId}/sells`)
      .set('x-csrf-token', owner.csrf)
      .set('Idempotency-Key', 'phase5-sell-replay')
      .send(groupSellBody)
      .expect(201);
    expect(groupSell.body.group).toMatchObject({
      status: 'partial',
      remainingAmount: '50.000000000000000000',
      realizedPnlUsd: '75.00000000',
      unrealizedPnlUsd: '50.00000000',
      totalPnlUsd: '125.00000000',
      returnPct: '125.00',
    });

    const replay = await agent
      .post(`/api/v1/trade-groups/${groupId}/sells`)
      .set('x-csrf-token', owner.csrf)
      .set('Idempotency-Key', 'phase5-sell-replay')
      .send(groupSellBody)
      .expect(201);
    expect(replay.body.group.remainingAmount).toBe('50.000000000000000000');
    expect(replay.body.consumptions).toHaveLength(2);

    const cashAsset = await agent.get(`/api/v1/portfolio/assets/${usdt.id}`).expect(200);
    expect(cashAsset.body.position).toMatchObject({
      isCashEquivalent: true,
      amount: '1040.000000000000000000',
      priceUsd: '1.00000000',
    });

    const portfolio = await agent.get(`/api/v1/portfolio/assets/${based.id}`).expect(200);
    expect(portfolio.body.asset.symbol).toBe('BASED');
    expect(portfolio.body.position.amount).toBe('50.000000000000000000');
    expect(portfolio.body.lots).toHaveLength(1);
    expect(portfolio.body.tradeGroups).toHaveLength(1);
    expect(portfolio.body.transactions).toHaveLength(3);
    expect(portfolio.body.prices).toHaveLength(1);

    const firstPage = await agent
      .get('/api/v1/transactions?limit=2&assetId=' + based.id)
      .expect(200);
    expect(firstPage.body.transactions).toHaveLength(2);
    expect(firstPage.body.page.hasMore).toBe(true);
    expect(firstPage.body.page.nextCursor).toBeTruthy();
    const secondPage = await agent
      .get(
        `/api/v1/transactions?limit=2&assetId=${based.id}&cursor=${encodeURIComponent(
          firstPage.body.page.nextCursor,
        )}`,
      )
      .expect(200);
    expect(secondPage.body.transactions).toHaveLength(1);

    const watchlistEmpty = await agent.get('/api/v1/watchlist').expect(200);
    expect(watchlistEmpty.body.data).toEqual([]);

    const watchlistCreated = await agent
      .post('/api/v1/watchlist')
      .set('x-csrf-token', owner.csrf)
      .send({
        assetId: based.id,
        thesis: 'Test thesis',
        tags: ['test', 'bsc'],
        priority: 10,
      })
      .expect(201);
    expect(watchlistCreated.body).toMatchObject({
      thesis: 'Test thesis',
      tags: ['test', 'bsc'],
      priority: 10,
      priceUsd: '2.00000000',
      change24hPct: null,
    });

    const link = asset('LINK');
    await agent
      .post(`/api/v1/prices/${link.id}`)
      .set('x-csrf-token', owner.csrf)
      .send({
        priceUsd: '1.00',
        observedAt: new Date(Date.now() - 4 * 86_400_000).toISOString(),
      })
      .expect(201);
    await agent
      .post(`/api/v1/prices/${link.id}`)
      .set('x-csrf-token', owner.csrf)
      .send({
        priceUsd: '2.00',
        observedAt: new Date(Date.now() - 3 * 86_400_000).toISOString(),
      })
      .expect(201);
    const staleEntry = await agent
      .post('/api/v1/watchlist')
      .set('x-csrf-token', owner.csrf)
      .send({ assetId: link.id, thesis: 'Stale price test' })
      .expect(201);
    expect(staleEntry.body).toMatchObject({
      priceUsd: '2.00000000',
      change24hPct: null,
    });

    await agent
      .post(`/api/v1/prices/${link.id}`)
      .set('x-csrf-token', owner.csrf)
      .send({ priceUsd: '3.00' })
      .expect(201);
    const freshWatchlist = await agent.get('/api/v1/watchlist').expect(200);
    expect(
      freshWatchlist.body.data.find((entry: { id: string }) => entry.id === staleEntry.body.id),
    ).toMatchObject({ priceUsd: '3.00000000', change24hPct: '50.00' });

    const watchlist = await agent.get('/api/v1/watchlist').expect(200);
    expect(watchlist.body.data).toHaveLength(2);

    const watchlistUpdated = await agent
      .patch(`/api/v1/watchlist/${watchlistCreated.body.id}`)
      .set('x-csrf-token', owner.csrf)
      .send({ thesis: 'Updated thesis', priority: 20 })
      .expect(200);
    expect(watchlistUpdated.body).toMatchObject({
      thesis: 'Updated thesis',
      priority: 20,
    });

    await agent
      .delete(`/api/v1/watchlist/${watchlistCreated.body.id}`)
      .set('x-csrf-token', owner.csrf)
      .expect(204);
    const watchlistArchived = await agent.get('/api/v1/watchlist?includeArchived=true').expect(200);
    expect(watchlistArchived.body.data).toHaveLength(2);
    const archivedBased = watchlistArchived.body.data.find(
      (entry: { id: string }) => entry.id === watchlistCreated.body.id,
    );
    expect(archivedBased.archivedAt).toBeTruthy();

    const restored = await agent
      .patch(`/api/v1/watchlist/${watchlistCreated.body.id}`)
      .set('x-csrf-token', owner.csrf)
      .send({ archived: false })
      .expect(200);
    expect(restored.body.archivedAt).toBeNull();

    const settings = await agent.get('/api/v1/settings').expect(200);
    expect(settings.body).toMatchObject({
      baseCurrency: 'USD',
      displayCurrency: 'USD',
      taxMethod: 'FIFO',
      includeGasInCostBasis: true,
      timezone: 'Europe/Minsk',
    });

    const updatedSettings = await agent
      .patch('/api/v1/settings')
      .set('x-csrf-token', owner.csrf)
      .send({ timezone: 'Europe/Moscow', includeGasInCostBasis: false })
      .expect(200);
    expect(updatedSettings.body).toMatchObject({
      timezone: 'Europe/Moscow',
      includeGasInCostBasis: false,
    });

    await agent
      .patch('/api/v1/settings')
      .set('x-csrf-token', owner.csrf)
      .send({ timezone: 'Invalid/Timezone' })
      .expect(400);

    const audit = await agent.get('/api/v1/audit-log?action=watchlist.created').expect(200);
    expect(audit.body.data.length).toBeGreaterThan(0);
    expect(audit.body.data[0].action).toBe('watchlist.created');

    const exportCsv = await agent.get('/api/v1/export/transactions.csv').expect(200);
    expect(exportCsv.headers['content-type']).toContain('text/csv');
    expect(exportCsv.text).toContain('occurredAt');
    expect(exportCsv.text).toContain('deposit');
    expect(exportCsv.text).toContain("'=cmd");

    const exportJson = await agent.get('/api/v1/export/positions.json').expect(200);
    expect(exportJson.body.positions).toEqual(
      expect.arrayContaining([expect.objectContaining({ amount: '50.000000000000000000' })]),
    );

    const exportGroups = await agent.get('/api/v1/export/trade-groups.csv').expect(200);
    expect(exportGroups.text).toContain('BASED');
    expect(exportGroups.text).toContain('Test trade note');

    const dataQuality = await agent.get('/api/v1/dashboard/data-quality').expect(200);
    expect(dataQuality.body.issues).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'unverified_assets' })]),
    );
    expect(dataQuality.body.negativeBalances).toEqual([]);

    const curve = await agent.get('/api/v1/dashboard/equity-curve').expect(200);
    expect(curve.body.valuation).toBe('current-prices');
    expect(curve.body.points.length).toBeGreaterThan(0);
    expect(curve.body.points.at(-1)).toMatchObject({ equityUsd: '1140.00000000' });

    const [dbAccount] = await db
      .select()
      .from(accounts)
      .where(eq(accounts.id, wallet?.id ?? ''));
    expect(dbAccount?.name).toBe('Tangem BSC');
    const [dbAsset] = await db.select().from(assets).where(eq(assets.id, based.id));
    expect(dbAsset?.symbol).toBe('BASED');
  }, 120_000);
});

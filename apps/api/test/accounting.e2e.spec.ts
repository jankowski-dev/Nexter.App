import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import cookie from '@fastify/cookie';
import { sql } from 'drizzle-orm';
import { generateSync } from 'otplib';
import request, { type SuperAgentTest } from 'supertest';
import { accounts, auditLog, createDb, users, type Database } from '@nexter/db';
import { Decimal } from 'decimal.js';
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

function sumByAsset(postings: Array<{ assetId: string; amount: string }>) {
  const totals = new Map<string, Decimal>();

  for (const posting of postings) {
    totals.set(
      posting.assetId,
      (totals.get(posting.assetId) ?? new Decimal(0)).plus(posting.amount),
    );
  }

  return totals;
}

describe.runIf(canRun)('Accounting e2e', () => {
  let app: NestFastifyApplication;
  let db: Database;
  let pool: ReturnType<typeof createDb>['pool'];
  let emailCounter = 0;

  async function setupOwner(agent: SuperAgentTest) {
    const email = `accounting-e2e-${Date.now()}-${emailCounter++}@example.com`;
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

  async function create(agent: SuperAgentTest, csrf: string, body: Record<string, unknown>) {
    return agent.post('/api/v1/transactions').set('x-csrf-token', csrf).send(body).expect(201);
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

  it('records buy, sell, swap, transfer and income with balanced postings', async () => {
    const agent = request.agent(app.getHttpServer());
    const owner = await setupOwner(agent);

    const assetsResponse = await agent.get('/api/v1/assets').expect(200);
    const allAssets = assetsResponse.body.assets as Array<{
      id: string;
      chainId: string;
      chainCode: string;
      symbol: string;
    }>;
    const asset = (chainCode: string, symbol: string) => {
      const found = allAssets.find(
        (item) => item.chainCode === chainCode && item.symbol === symbol,
      );
      expect(found).toBeDefined();
      return found as { id: string; chainId: string };
    };

    const usdc = asset('bsc', 'USDC');
    const bnb = asset('bsc', 'BNB');
    const link = asset('bsc', 'LINK');
    const based = asset('bsc', 'BASED');

    const accountsResponse = await agent.get('/api/v1/accounts').expect(200);
    const bscWallet = (
      accountsResponse.body.accounts as Array<{
        id: string;
        name: string;
        type: string;
      }>
    ).find((item) => item.name === 'Tangem BSC');
    expect(bscWallet).toBeDefined();

    const [secondWallet] = await db
      .insert(accounts)
      .values({
        userId: owner.userId,
        name: 'Test BSC 2',
        type: 'wallet',
        chainId: link.chainId,
        isSystem: false,
      })
      .returning();

    expect(secondWallet).toBeDefined();

    const depositUsdc = await create(agent, owner.csrf, {
      type: 'deposit',
      accountId: bscWallet?.id,
      assetId: usdc.id,
      amount: '1000',
      usdValue: '1000',
    });
    expect(sumByAsset(depositUsdc.body.transaction.postings).size).toBe(1);

    await create(agent, owner.csrf, {
      type: 'deposit',
      accountId: bscWallet?.id,
      assetId: bnb.id,
      amount: '1',
      usdValue: '600',
    });

    const buy = await create(agent, owner.csrf, {
      type: 'buy',
      accountId: bscWallet?.id,
      assetId: link.id,
      amount: '10',
      quoteAssetId: usdc.id,
      quoteAmount: '150',
      feeAssetId: bnb.id,
      feeAmount: '0.001',
      feeUsdValue: '0.6',
    });

    const buyBalances = sumByAsset(buy.body.transaction.postings);
    expect([...buyBalances.values()].every((value) => value.isZero())).toBe(true);

    await agent
      .post(`/api/v1/prices/${link.id}`)
      .set('x-csrf-token', owner.csrf)
      .send({ priceUsd: '20' })
      .expect(201);
    await agent
      .post(`/api/v1/prices/${based.id}`)
      .set('x-csrf-token', owner.csrf)
      .send({ priceUsd: '2' })
      .expect(201);
    await agent
      .post(`/api/v1/prices/${bnb.id}`)
      .set('x-csrf-token', owner.csrf)
      .send({ priceUsd: '600' })
      .expect(201);

    const afterBuy = await agent.get('/api/v1/positions').expect(200);
    const linkPosition = (
      afterBuy.body.positions as Array<{
        asset: { id: string };
        amount: string;
        costBasisUsd: string;
      }>
    ).find((position) => position.asset.id === link.id);
    expect(linkPosition?.amount).toBe('10.000000000000000000');
    expect(linkPosition?.costBasisUsd).toBe('150.60000000');

    const sell = await create(agent, owner.csrf, {
      type: 'sell',
      accountId: bscWallet?.id,
      assetId: link.id,
      amount: '4',
      proceedsAssetId: usdc.id,
      proceedsAmount: '80',
      feeAssetId: bnb.id,
      feeAmount: '0.001',
      feeUsdValue: '0.6',
    });
    const sellBalances = sumByAsset(sell.body.transaction.postings);
    expect([...sellBalances.values()].every((value) => value.isZero())).toBe(true);

    const dashboardAfterSell = await agent.get('/api/v1/dashboard/summary').expect(200);
    expect(dashboardAfterSell.body.realizedPnlUsd).toBe('19.16000000');

    const swap = await create(agent, owner.csrf, {
      type: 'swap',
      accountId: bscWallet?.id,
      assetInId: link.id,
      amountIn: '2',
      assetOutId: based.id,
      amountOut: '20',
      usdValueIn: '40',
      usdValueOut: '40',
      feeAssetId: bnb.id,
      feeAmount: '0.001',
      feeUsdValue: '0.6',
    });
    const swapBalances = sumByAsset(swap.body.transaction.postings);
    expect([...swapBalances.values()].every((value) => value.isZero())).toBe(true);

    const transfer = await create(agent, owner.csrf, {
      type: 'transfer',
      fromAccountId: bscWallet?.id,
      toAccountId: secondWallet?.id,
      assetId: link.id,
      amount: '1',
      usdValue: '20',
    });
    const transferBalances = sumByAsset(transfer.body.transaction.postings);
    expect([...transferBalances.values()].every((value) => value.isZero())).toBe(true);

    const income = await create(agent, owner.csrf, {
      type: 'income',
      accountId: bscWallet?.id,
      assetId: bnb.id,
      amount: '0.5',
      usdValue: '300',
    });
    const incomeBalances = sumByAsset(income.body.transaction.postings);
    expect([...incomeBalances.values()].every((value) => value.isZero())).toBe(true);

    const positions = await agent.get('/api/v1/positions').expect(200);
    const finalLink = (
      positions.body.positions as Array<{
        asset: { id: string };
        amount: string;
        costBasisUsd: string;
      }>
    ).find((position) => position.asset.id === link.id);
    expect(finalLink?.amount).toBe('4.000000000000000000');
    expect(finalLink?.costBasisUsd).toBe('60.24000000');

    const summary = await agent.get('/api/v1/dashboard/summary').expect(200);
    expect(summary.body.realizedPnlUsd).toBe('29.04000000');
    expect(summary.body.incomeUsd).toBe('300.00000000');
    expect(summary.body.unrealizedPnlUsd).toBe('19.16000000');
    expect(summary.body.totalPnlUsd).toBe('348.20000000');
    expect(summary.body.cashUsd).toBe('930.00000000');
    expect(summary.body.missingPrices).toEqual([]);
    expect(new Decimal(summary.body.equityUsd).minus(summary.body.netDepositsUsd).toFixed(8)).toBe(
      summary.body.totalPnlUsd,
    );

    const transactions = await agent.get('/api/v1/transactions').expect(200);
    expect(transactions.body.transactions).toHaveLength(7);

    const audits = await db.select().from(auditLog);
    expect(audits.filter((row) => row.action === 'accounting.transaction_created')).toHaveLength(7);
    expect(audits.some((row) => row.action === 'accounting.price_set')).toBe(true);
  }, 60_000);

  it('rejects a transaction that would make a wallet balance negative', async () => {
    const agent = request.agent(app.getHttpServer());
    const owner = await setupOwner(agent);

    const assetsResponse = await agent.get('/api/v1/assets').expect(200);
    const assets = assetsResponse.body.assets as Array<{
      id: string;
      chainCode: string;
      symbol: string;
    }>;
    const usdc = assets.find((asset) => asset.chainCode === 'bsc' && asset.symbol === 'USDC');
    const link = assets.find((asset) => asset.chainCode === 'bsc' && asset.symbol === 'LINK');
    const accountsResponse = await agent.get('/api/v1/accounts').expect(200);
    const wallet = (accountsResponse.body.accounts as Array<{ id: string; name: string }>).find(
      (account) => account.name === 'Tangem BSC',
    );

    await create(agent, owner.csrf, {
      type: 'deposit',
      accountId: wallet?.id,
      assetId: usdc?.id,
      amount: '10',
      usdValue: '10',
    });

    const response = await agent
      .post('/api/v1/transactions')
      .set('x-csrf-token', owner.csrf)
      .send({
        type: 'buy',
        accountId: wallet?.id,
        assetId: link?.id,
        amount: '1',
        quoteAssetId: usdc?.id,
        quoteAmount: '100',
      })
      .expect(400);

    expect(response.body.error.code).toBe('NEGATIVE_BALANCE');

    const [count] = await db.select({ count: sql<number>`count(*)::int` }).from(users);
    expect(count?.count).toBe(1);
  }, 30_000);
});

import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import cookie from '@fastify/cookie';
import { and, eq, sql } from 'drizzle-orm';
import { generateSync } from 'otplib';
import request, { type SuperAgentTest } from 'supertest';
import {
  accounts,
  auditLog,
  createDb,
  lots,
  postings,
  tradeGroups,
  transactions,
  users,
  type Database,
} from '@nexter/db';
import { Decimal } from 'decimal.js';
import fc from 'fast-check';
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

  async function setPrice(agent: SuperAgentTest, csrf: string, assetId: string, priceUsd: string) {
    return agent
      .post(`/api/v1/prices/${assetId}`)
      .set('x-csrf-token', csrf)
      .send({ priceUsd })
      .expect(201);
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

    const unbalanced = await db.execute(
      sql`select count(*)::int as n from (
        select transaction_id, asset_id
        from postings
        group by transaction_id, asset_id
        having sum(amount) <> 0
      ) q`,
    );
    expect((unbalanced.rows[0] as { n: number } | undefined)?.n).toBe(0);
  }, 60_000);

  it('rejects a transaction that would make a wallet balance negative', async () => {
    const agent = request.agent(app.getHttpServer());
    const owner = await setupOwner(agent);

    const assets = await getAssets(agent);
    const usdc = assets.find((asset) => asset.chainCode === 'bsc' && asset.symbol === 'USDC');
    const link = assets.find((asset) => asset.chainCode === 'bsc' && asset.symbol === 'LINK');
    const wallet = (await getAccounts(agent)).find((account) => account.name === 'Tangem BSC');

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

    const [userCount] = await db.select({ count: sql<number>`count(*)::int` }).from(users);
    const [transactionCount] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(transactions);
    expect(userCount?.count).toBe(1);
    expect(transactionCount?.count).toBe(1);
  }, 30_000);

  it('serializes concurrent cash spends so cash cannot go negative', async () => {
    const agent = request.agent(app.getHttpServer());
    const owner = await setupOwner(agent);

    const assets = await getAssets(agent);
    const usdc = assets.find((asset) => asset.chainCode === 'bsc' && asset.symbol === 'USDC');
    const link = assets.find((asset) => asset.chainCode === 'bsc' && asset.symbol === 'LINK');
    const wallet = (await getAccounts(agent)).find((account) => account.name === 'Tangem BSC');

    await create(agent, owner.csrf, {
      type: 'deposit',
      accountId: wallet?.id,
      assetId: usdc?.id,
      amount: '100',
      usdValue: '100',
    });

    const body = {
      type: 'buy',
      accountId: wallet?.id,
      assetId: link?.id,
      amount: '8',
      quoteAssetId: usdc?.id,
      quoteAmount: '80',
    };

    const [first, second] = await Promise.all([
      agent.post('/api/v1/transactions').set('x-csrf-token', owner.csrf).send(body),
      agent.post('/api/v1/transactions').set('x-csrf-token', owner.csrf).send(body),
    ]);

    const statuses = [first.status, second.status].sort();
    expect(statuses).toEqual([201, 400]);

    const failed = first.status === 400 ? first : second;
    expect(failed.body.error.code).toBe('NEGATIVE_BALANCE');

    const summary = await agent.get('/api/v1/dashboard/summary').expect(200);
    expect(summary.body.cashUsd).toBe('20.00000000');

    const [transactionCount] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(transactions);
    expect(transactionCount?.count).toBe(2);
  }, 60_000);

  it('reconciles withdrawals, adjustments and non-capitalized fees', async () => {
    const agent = request.agent(app.getHttpServer());
    const owner = await setupOwner(agent);

    const assets = await getAssets(agent);
    const usdc = assets.find((asset) => asset.chainCode === 'bsc' && asset.symbol === 'USDC');
    const bnb = assets.find((asset) => asset.chainCode === 'bsc' && asset.symbol === 'BNB');
    const link = assets.find((asset) => asset.chainCode === 'bsc' && asset.symbol === 'LINK');
    const accountRows = await getAccounts(agent);
    const wallet = accountRows.find((account) => account.name === 'Tangem BSC');
    expect(wallet).toBeDefined();

    const [secondWallet] = await db
      .insert(accounts)
      .values({
        userId: owner.userId,
        name: 'Test BSC 2',
        type: 'wallet',
        chainId: link?.chainId,
        isSystem: false,
      })
      .returning();
    expect(secondWallet).toBeDefined();

    await create(agent, owner.csrf, {
      type: 'deposit',
      accountId: wallet?.id,
      assetId: usdc?.id,
      amount: '100',
      usdValue: '100',
    });
    await create(agent, owner.csrf, {
      type: 'deposit',
      accountId: wallet?.id,
      assetId: bnb?.id,
      amount: '1',
      usdValue: '600',
    });

    await setPrice(agent, owner.csrf, link?.id, '10');
    await setPrice(agent, owner.csrf, bnb?.id, '600');

    await create(agent, owner.csrf, {
      type: 'buy',
      accountId: wallet?.id,
      assetId: link?.id,
      amount: '10',
      quoteAssetId: usdc?.id,
      quoteAmount: '50',
    });

    await create(agent, owner.csrf, {
      type: 'withdrawal',
      accountId: wallet?.id,
      assetId: link?.id,
      amount: '5',
      usdValue: '50',
    });

    const adjustment = await create(agent, owner.csrf, {
      type: 'adjustment',
      accountId: wallet?.id,
      assetId: link?.id,
      amount: '1',
      usdValue: '10',
      reason: 'test adjustment reason',
    });
    expect(adjustment.body.transaction.notes).toBe('test adjustment reason');

    await create(agent, owner.csrf, {
      type: 'transfer',
      fromAccountId: wallet?.id,
      toAccountId: secondWallet?.id,
      assetId: link?.id,
      amount: '1',
      usdValue: '10',
      feeAssetId: bnb?.id,
      feeAmount: '0.001',
      feeUsdValue: '0.6',
    });

    await create(agent, owner.csrf, {
      type: 'swap',
      accountId: wallet?.id,
      assetInId: link?.id,
      amountIn: '1',
      assetOutId: usdc?.id,
      amountOut: '10',
      usdValueIn: '10',
      usdValueOut: '10',
      feeAssetId: bnb?.id,
      feeAmount: '0.001',
      feeUsdValue: '0.6',
    });

    const summary = await agent.get('/api/v1/dashboard/summary').expect(200);
    const equity = new Decimal(summary.body.equityUsd);
    const netDeposits = new Decimal(summary.body.netDepositsUsd);
    const totalPnl = new Decimal(summary.body.totalPnlUsd);

    expect(summary.body.adjustmentsUsd).toBe('10.00000000');
    expect(summary.body.feesUsd).toBe('1.20000000');
    expect(equity.minus(netDeposits).toFixed(8)).toBe(totalPnl.toFixed(8));

    const groups = await db
      .select()
      .from(tradeGroups)
      .where(eq(tradeGroups.assetId, link?.id ?? ''));
    expect(groups.some((group) => group.status === 'partial')).toBe(true);

    const audits = await db.select().from(auditLog);
    expect(
      audits.some(
        (row) =>
          row.action === 'accounting.transaction_created' &&
          row.entityId === adjustment.body.transaction.id &&
          (row.after as { reason?: string } | null)?.reason === 'test adjustment reason',
      ),
    ).toBe(true);
  }, 60_000);

  it('validates asset decimals, chain consistency and idempotency', async () => {
    const agent = request.agent(app.getHttpServer());
    const owner = await setupOwner(agent);

    const assets = await getAssets(agent);
    const ethUsdc = assets.find(
      (asset) => asset.chainCode === 'ethereum' && asset.symbol === 'USDC',
    );
    const bscLink = assets.find((asset) => asset.chainCode === 'bsc' && asset.symbol === 'LINK');
    const bscUsdc = assets.find((asset) => asset.chainCode === 'bsc' && asset.symbol === 'USDC');
    const bscBnb = assets.find((asset) => asset.chainCode === 'bsc' && asset.symbol === 'BNB');
    const accounts = await getAccounts(agent);
    const bscWallet = accounts.find((account) => account.name === 'Tangem BSC');
    const ethWallet = accounts.find((account) => account.name === 'Tangem Ethereum');

    const decimalError = await agent
      .post('/api/v1/transactions')
      .set('x-csrf-token', owner.csrf)
      .send({
        type: 'deposit',
        accountId: ethWallet?.id,
        assetId: ethUsdc?.id,
        amount: '1.123456789',
        usdValue: '1.13',
      })
      .expect(400);
    expect(decimalError.body.error.code).toBe('VALIDATION_ERROR');

    const chainError = await agent
      .post('/api/v1/transactions')
      .set('x-csrf-token', owner.csrf)
      .send({
        type: 'transfer',
        fromAccountId: bscWallet?.id,
        toAccountId: ethWallet?.id,
        assetId: bscLink?.id,
        amount: '1',
        usdValue: '10',
      })
      .expect(400);
    expect(chainError.body.error.code).toBe('VALIDATION_ERROR');

    const zeroUsdError = await agent
      .post('/api/v1/transactions')
      .set('x-csrf-token', owner.csrf)
      .send({
        type: 'income',
        accountId: bscWallet?.id,
        assetId: bscLink?.id,
        amount: '1',
        usdValue: '0',
      })
      .expect(400);
    expect(zeroUsdError.body.error.code).toBe('VALIDATION_ERROR');

    const cashMismatch = await agent
      .post('/api/v1/transactions')
      .set('x-csrf-token', owner.csrf)
      .send({
        type: 'deposit',
        accountId: bscWallet?.id,
        assetId: bscUsdc?.id,
        amount: '100',
        usdValue: '90',
      })
      .expect(400);
    expect(cashMismatch.body.error.code).toBe('VALIDATION_ERROR');

    const zeroFee = await agent
      .post('/api/v1/transactions')
      .set('x-csrf-token', owner.csrf)
      .send({
        type: 'buy',
        accountId: bscWallet?.id,
        assetId: bscLink?.id,
        amount: '1',
        quoteAssetId: bscUsdc?.id,
        quoteAmount: '10',
        feeAssetId: bscBnb?.id,
        feeAmount: '0.001',
        feeUsdValue: '0',
      })
      .expect(400);
    expect(zeroFee.body.error.code).toBe('VALIDATION_ERROR');

    const cashFeeMismatch = await agent
      .post('/api/v1/transactions')
      .set('x-csrf-token', owner.csrf)
      .send({
        type: 'buy',
        accountId: bscWallet?.id,
        assetId: bscLink?.id,
        amount: '1',
        quoteAssetId: bscUsdc?.id,
        quoteAmount: '10',
        feeAssetId: bscUsdc?.id,
        feeAmount: '1',
        feeUsdValue: '0.5',
      })
      .expect(400);
    expect(cashFeeMismatch.body.error.code).toBe('VALIDATION_ERROR');

    const sameTransfer = await agent
      .post('/api/v1/transactions')
      .set('x-csrf-token', owner.csrf)
      .send({
        type: 'transfer',
        fromAccountId: bscWallet?.id,
        toAccountId: bscWallet?.id,
        assetId: bscLink?.id,
        amount: '1',
        usdValue: '10',
      })
      .expect(400);
    expect(sameTransfer.body.error.code).toBe('VALIDATION_ERROR');

    const sameSwap = await agent
      .post('/api/v1/transactions')
      .set('x-csrf-token', owner.csrf)
      .send({
        type: 'swap',
        accountId: bscWallet?.id,
        assetInId: bscLink?.id,
        amountIn: '1',
        assetOutId: bscLink?.id,
        amountOut: '1',
        usdValueIn: '10',
        usdValueOut: '10',
      })
      .expect(400);
    expect(sameSwap.body.error.code).toBe('VALIDATION_ERROR');

    const priceTooLarge = await agent
      .post(`/api/v1/prices/${bscLink?.id}`)
      .set('x-csrf-token', owner.csrf)
      .send({ priceUsd: '10000000000000000' })
      .expect(400);
    expect(priceTooLarge.body.error.code).toBe('VALIDATION_ERROR');

    await create(agent, owner.csrf, {
      type: 'deposit',
      accountId: bscWallet?.id,
      assetId: bscUsdc?.id,
      amount: '100',
      usdValue: '100',
    });

    const highPrecision = await agent
      .post('/api/v1/transactions')
      .set('x-csrf-token', owner.csrf)
      .send({
        type: 'buy',
        accountId: bscWallet?.id,
        assetId: bscLink?.id,
        amount: '1',
        quoteAssetId: bscUsdc?.id,
        quoteAmount: '40.123456789012345678',
      })
      .expect(201);
    expect(highPrecision.body.transaction.postings.length).toBeGreaterThan(0);

    const idempotencyKey = `accounting-e2e-${Date.now()}`;
    const purchaseBody = {
      type: 'buy',
      accountId: bscWallet?.id,
      assetId: bscLink?.id,
      amount: '1',
      quoteAssetId: bscUsdc?.id,
      quoteAmount: '10',
    };

    const first = await agent
      .post('/api/v1/transactions')
      .set('x-csrf-token', owner.csrf)
      .set('idempotency-key', idempotencyKey)
      .send(purchaseBody)
      .expect(201);
    const second = await agent
      .post('/api/v1/transactions')
      .set('x-csrf-token', owner.csrf)
      .set('idempotency-key', idempotencyKey)
      .send(purchaseBody)
      .expect(201);

    expect(second.body.transaction.id).toBe(first.body.transaction.id);

    const [transactionCount] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(transactions);
    expect(transactionCount?.count).toBe(3);
  }, 60_000);

  it('keeps lots equal to balances across generated buy/sell sequences', async () => {
    const agent = request.agent(app.getHttpServer());
    const owner = await setupOwner(agent);

    const assets = await getAssets(agent);
    const usdc = assets.find((asset) => asset.chainCode === 'bsc' && asset.symbol === 'USDC');
    const link = assets.find((asset) => asset.chainCode === 'bsc' && asset.symbol === 'LINK');
    const wallet = (await getAccounts(agent)).find((account) => account.name === 'Tangem BSC');

    await create(agent, owner.csrf, {
      type: 'deposit',
      accountId: wallet?.id,
      assetId: usdc?.id,
      amount: '1000',
      usdValue: '1000',
    });
    await setPrice(agent, owner.csrf, link?.id, '10');

    const sequences = fc.sample(
      fc.array(fc.integer({ min: 1, max: 5 }), { minLength: 1, maxLength: 3 }),
      { numRuns: 3 },
    );

    for (const sequence of sequences) {
      for (const amount of sequence) {
        await create(agent, owner.csrf, {
          type: 'buy',
          accountId: wallet?.id,
          assetId: link?.id,
          amount: String(amount * 2),
          quoteAssetId: usdc?.id,
          quoteAmount: String(amount * 20),
        });
        await create(agent, owner.csrf, {
          type: 'sell',
          accountId: wallet?.id,
          assetId: link?.id,
          amount: String(amount),
          proceedsAssetId: usdc?.id,
          proceedsAmount: String(amount * 10),
        });
      }
    }

    const [lotTotal] = await db
      .select({ total: sql<string>`coalesce(sum(${lots.remainingAmount}), 0)::text` })
      .from(lots)
      .where(and(eq(lots.userId, owner.userId), eq(lots.assetId, link?.id ?? '')));
    const [balanceTotal] = await db
      .select({ total: sql<string>`coalesce(sum(${postings.amount}), 0)::text` })
      .from(postings)
      .innerJoin(accounts, eq(postings.accountId, accounts.id))
      .where(
        and(
          eq(accounts.userId, owner.userId),
          eq(accounts.type, 'wallet'),
          eq(postings.assetId, link?.id ?? ''),
        ),
      );

    expect(new Decimal(lotTotal?.total ?? '0').toFixed(18)).toBe(
      new Decimal(balanceTotal?.total ?? '0').toFixed(18),
    );

    const summary = await agent.get('/api/v1/dashboard/summary').expect(200);
    const equity = new Decimal(summary.body.equityUsd);
    const netDeposits = new Decimal(summary.body.netDepositsUsd);
    const totalPnl = new Decimal(summary.body.totalPnlUsd);
    expect(equity.minus(netDeposits).toFixed(8)).toBe(totalPnl.toFixed(8));
  }, 60_000);
});

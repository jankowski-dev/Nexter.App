import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import cookie from '@fastify/cookie';
import { eq, sql } from 'drizzle-orm';
import { generateSync } from 'otplib';
import request, { type SuperAgentTest } from 'supertest';
import { createDb, swapOrders, type Database } from '@nexter/db';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { BscRpcService } from '../src/modules/swap/bsc-rpc.service';
import { KyberSwapClient } from '../src/modules/swap/kyber-swap.client';
import { env } from '../src/shared/config/env';
import { AllExceptionsFilter } from '../src/shared/errors/all-exceptions.filter';

const canRun = Boolean(
  process.env.NEXTER_TEST_DB === '1' &&
  process.env.DATABASE_URL &&
  process.env.SETUP_TOKEN &&
  process.env.AUTH_ENCRYPTION_KEY,
);

const password = 'correct horse battery staple';
const wallet = '0x1111111111111111111111111111111111111111';
const router = '0x6131B5fae19EA4f9D964eAc0408E4408b66337b5';
const selector = '0x12345678';
const tokenIn = '0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d';
const tokenOut = '0x1d28d989f9e3ccb8b15d0cec601734514f958e4d';

function csrfFrom(response: request.Response): string {
  const setCookie = response.headers['set-cookie'];
  const cookies = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : [];
  const raw = cookies.find((value) => value.startsWith('nexter_csrf='));

  return raw?.split(';')[0]?.split('=')[1] ?? '';
}

describe.runIf(canRun)('Phase 7 swap foundation API', () => {
  let app: NestFastifyApplication;
  let db: Database;
  let pool: ReturnType<typeof createDb>['pool'];
  let simulationSuccess = true;
  let buildData = `${selector}${'0'.repeat(120)}`;
  let quotePriceImpact = '0.10';

  const kyber = {
    configured: true,
    getRoutes: async (input: { tokenIn: string; tokenOut: string; amountInBase: string }) => ({
      routeSummary: {
        tokenIn: input.tokenIn,
        tokenOut: input.tokenOut,
        amountIn: input.amountInBase,
        amountOut: '2000000000000000000',
        amountInUsd: '1.00',
        amountOutUsd: '1.99',
        gas: '120000',
        gasUsd: '0.05',
        priceImpact: quotePriceImpact,
        routeID: 'route-test-1',
      },
      routerAddress: router,
      amountIn: input.amountInBase,
      amountOut: '2000000000000000000',
      amountInUsd: '1.00',
      amountOutUsd: '1.99',
      gas: '120000',
      gasUsd: '0.05',
      priceImpact: quotePriceImpact,
    }),
    buildRoute: async (input: { sender: string; recipient: string; slippageBps: number }) => ({
      data: buildData,
      routerAddress: router,
      amountIn: '1000000000000000000',
      amountOut: '2000000000000000000',
      transactionValue: '0',
      gas: '120000',
      gasUsd: '0.05',
      sender: input.sender,
      recipient: input.recipient,
      slippageBps: input.slippageBps,
    }),
  };

  const rpc = {
    configured: true,
    simulate: async () => ({
      success: simulationSuccess,
      revertReason: simulationSuccess ? null : 'execution reverted: test',
      gasEstimate: simulationSuccess ? '120000' : null,
      chainId: 56,
    }),
  };

  async function setupOwner(agent: SuperAgentTest) {
    const email = `swap-e2e-${Date.now()}@example.com`;
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
      .send({ code: generateSync({ secret: totpSetup.body.secret }) })
      .expect(200);

    return { userId: setup.body.user.id as string, csrf: csrfFrom(enabled) };
  }

  beforeAll(async () => {
    env.SWAP_ENABLED = true;
    env.SWAP_KILL_SWITCH = false;
    env.SWAP_WALLET_ALLOWLIST = wallet;
    env.SWAP_ROUTER_ALLOWLIST = router;
    env.SWAP_SELECTOR_ALLOWLIST = selector;
    env.SWAP_QUOTE_TTL_SECONDS = 15;
    env.SWAP_MAX_PRICE_IMPACT_BPS = 200;

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(KyberSwapClient)
      .useValue(kyber)
      .overrideProvider(BscRpcService)
      .useValue(rpc)
      .compile();

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
    simulationSuccess = true;
    buildData = `${selector}${'0'.repeat(120)}`;
    quotePriceImpact = '0.10';
    env.SWAP_KILL_SWITCH = false;
    await db.execute(sql`truncate table users restart identity cascade`);
    await db.execute(sql`truncate table external_api_calls restart identity cascade`);
  });

  afterAll(async () => {
    await app.close();
    await pool.end();
  });

  it('quotes, builds, validates, lists, expires and cancels BSC swap orders', async () => {
    const agent = request.agent(app.getHttpServer());
    const owner = await setupOwner(agent);

    const config = await agent.get('/api/v1/swap/config').expect(200);
    expect(config.body).toMatchObject({
      enabled: true,
      killSwitch: false,
      walletAllowlistConfigured: true,
      rpcConfigured: true,
    });
    expect(config.body.chains).toHaveLength(1);
    expect(config.body.chains[0].tokens).toHaveLength(7);

    const quoted = await agent
      .post('/api/v1/swap/quote')
      .set('x-csrf-token', owner.csrf)
      .send({
        chain: 'bsc',
        tokenIn,
        tokenOut,
        amountIn: '1',
        slippageBps: 50,
        walletAddress: wallet,
      })
      .expect(201);

    expect(quoted.body).toMatchObject({
      status: 'QUOTED',
      amountIn: '1.000000000000000000',
      amountOut: '2.000000000000000000',
      minOut: '1.990000000000000000',
      slippageBps: 50,
      priceImpactBps: 10,
      routeId: 'route-test-1',
    });
    expect(quoted.body.tokenIn.symbol).toBe('USDC');
    expect(quoted.body.tokenOut.symbol).toBe('BASED');

    const orderId = quoted.body.id as string;
    const list = await agent.get('/api/v1/swap/orders?limit=10').expect(200);
    expect(list.body.data).toHaveLength(1);
    expect(list.body.page.hasMore).toBe(false);

    const built = await agent
      .post('/api/v1/swap/build')
      .set('x-csrf-token', owner.csrf)
      .send({ orderId, walletAddress: wallet })
      .expect(201);

    expect(built.body).toMatchObject({
      status: 'BUILT',
      routerAddress: router.toLowerCase(),
      transactionValue: '0',
      simulation: { success: true },
    });
    expect(built.body.calldata).toBe(buildData);
    expect(built.body.validation).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ check: 'router', passed: true }),
        expect.objectContaining({ check: 'simulation', passed: true }),
      ]),
    );
    expect(built.body.events.some((event: { type: string }) => event.type === 'built')).toBe(true);

    const detail = await agent.get(`/api/v1/swap/orders/${orderId}`).expect(200);
    expect(detail.body.status).toBe('BUILT');

    const cancelled = await agent
      .post(`/api/v1/swap/orders/${orderId}/cancel`)
      .set('x-csrf-token', owner.csrf)
      .expect(200);
    expect(cancelled.body.status).toBe('CANCELLED');
  }, 60_000);

  it('rejects disallowed tokens, wallets, stale quotes, selectors and simulations', async () => {
    const agent = request.agent(app.getHttpServer());
    const owner = await setupOwner(agent);

    await agent
      .post('/api/v1/swap/quote')
      .set('x-csrf-token', owner.csrf)
      .send({
        chain: 'bsc',
        tokenIn,
        tokenOut: '0x2222222222222222222222222222222222222222',
        amountIn: '1',
      })
      .expect(400);

    await agent
      .post('/api/v1/swap/quote')
      .set('x-csrf-token', owner.csrf)
      .send({
        chain: 'bsc',
        tokenIn,
        tokenOut,
        amountIn: '1',
        walletAddress: '0x3333333333333333333333333333333333333333',
      })
      .expect(403);

    const quoted = await agent
      .post('/api/v1/swap/quote')
      .set('x-csrf-token', owner.csrf)
      .send({ chain: 'bsc', tokenIn, tokenOut, amountIn: '1', walletAddress: wallet })
      .expect(201);
    const orderId = quoted.body.id as string;

    await agent
      .post('/api/v1/swap/build')
      .set('x-csrf-token', owner.csrf)
      .send({ orderId, walletAddress: '0x3333333333333333333333333333333333333333' })
      .expect(403);

    buildData = `0xdeadbeef${'0'.repeat(120)}`;
    await agent
      .post('/api/v1/swap/build')
      .set('x-csrf-token', owner.csrf)
      .send({ orderId, walletAddress: wallet })
      .expect(400);

    buildData = `${selector}${'0'.repeat(120)}`;
    simulationSuccess = false;
    await agent
      .post('/api/v1/swap/build')
      .set('x-csrf-token', owner.csrf)
      .send({ orderId, walletAddress: wallet })
      .expect(400);

    simulationSuccess = true;
    await db
      .update(swapOrders)
      .set({ quoteExpiresAt: new Date(Date.now() - 1000) })
      .where(eq(swapOrders.id, orderId));
    await agent
      .post('/api/v1/swap/build')
      .set('x-csrf-token', owner.csrf)
      .send({ orderId, walletAddress: wallet })
      .expect(409);

    env.SWAP_KILL_SWITCH = true;
    const disabled = await agent.get('/api/v1/swap/config').expect(200);
    expect(disabled.body.enabled).toBe(false);
    await agent
      .post('/api/v1/swap/quote')
      .set('x-csrf-token', owner.csrf)
      .send({ chain: 'bsc', tokenIn, tokenOut, amountIn: '1', walletAddress: wallet })
      .expect(503);
  }, 60_000);

  it('rejects quotes above the configured price impact limit', async () => {
    const agent = request.agent(app.getHttpServer());
    const owner = await setupOwner(agent);
    quotePriceImpact = '3.00';

    await agent
      .post('/api/v1/swap/quote')
      .set('x-csrf-token', owner.csrf)
      .send({ chain: 'bsc', tokenIn, tokenOut, amountIn: '1', walletAddress: wallet })
      .expect(400);
  }, 60_000);
});

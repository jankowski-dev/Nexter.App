import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import cookie from '@fastify/cookie';
import { and, eq, sql } from 'drizzle-orm';
import { generateSync } from 'otplib';
import request, { type SuperAgentTest } from 'supertest';
import { encodeAbiParameters, encodeFunctionData, toEventSelector } from 'viem';
import {
  createDb,
  lots,
  postings,
  swapEvents,
  swapOrders,
  transactions,
  type Database,
} from '@nexter/db';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { AccountsService } from '../src/modules/accounting/accounts.service';
import { AssetsService } from '../src/modules/accounting/assets.service';
import { LedgerService } from '../src/modules/accounting/ledger.service';
import {
  BscRpcService,
  type RpcReceipt,
  type RpcTransaction,
} from '../src/modules/swap/bsc-rpc.service';
import { KYBER_ROUTER_ABI } from '../src/modules/swap/kyber-calldata';
import { KyberSwapClient } from '../src/modules/swap/kyber-swap.client';
import { SwapTrackingService } from '../src/modules/swap/swap-tracking.service';
import { getSwapToken } from '../src/modules/swap/token-registry';
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
const selector = '0xe21fd0e9';
const selectorAllowlist = `${selector},0x59e50fed`;
const executor = '0x8F10B468b06c6FD214B65F87778827F7D113f996';
const tokenIn = '0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d';
const tokenOut = '0x1d28d989f9e3ccb8b15d0cec601734514f958e4d';

function makeBuildData(
  overrides: {
    recipient?: string;
    srcToken?: string;
    dstToken?: string;
    amount?: bigint;
    minOut?: bigint;
    callTarget?: string;
    feeReceivers?: string[];
    feeAmounts?: bigint[];
    flags?: bigint;
  } = {},
  functionName: 'swap' | 'swapGeneric' = 'swap',
): string {
  const inputAmount = overrides.amount ?? 1_000_000_000_000_000_000n;
  const minOut = overrides.minOut ?? 1_990_000_000_000_000_000n;
  const callTarget = overrides.callTarget ?? executor;

  return encodeFunctionData({
    abi: KYBER_ROUTER_ABI,
    functionName,
    args: [
      {
        callTarget,
        approveTarget: '0x0000000000000000000000000000000000000000',
        targetData: '0x1234',
        desc: {
          srcToken: overrides.srcToken ?? tokenIn,
          dstToken: overrides.dstToken ?? tokenOut,
          srcReceivers: [callTarget],
          srcAmounts: [inputAmount],
          feeReceivers: overrides.feeReceivers ?? [],
          feeAmounts: overrides.feeAmounts ?? [],
          dstReceiver: overrides.recipient ?? wallet,
          amount: inputAmount,
          minReturnAmount: minOut,
          flags: overrides.flags ?? 0x200n,
          permit: '0x',
        },
        clientData: '0x',
      },
    ],
  });
}

function swappedLog(spentAmount: bigint, returnAmount: bigint) {
  return {
    address: router,
    topics: [toEventSelector('Swapped(address,address,address,address,uint256,uint256)')],
    data: encodeAbiParameters(
      [
        { type: 'address' },
        { type: 'address' },
        { type: 'address' },
        { type: 'address' },
        { type: 'uint256' },
        { type: 'uint256' },
      ],
      [wallet, tokenIn, tokenOut, wallet, spentAmount, returnAmount],
    ),
  };
}

function csrfFrom(response: request.Response): string {
  const setCookie = response.headers['set-cookie'];
  const cookies = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : [];
  const raw = cookies.find((value) => value.startsWith('nexter_csrf='));

  return raw?.split(';')[0]?.split('=')[1] ?? '';
}

describe.runIf(canRun)('Phase 8 swap execution API', () => {
  let app: NestFastifyApplication;
  let db: Database;
  let pool: ReturnType<typeof createDb>['pool'];
  let simulationSuccess = true;
  let rpcFailure = false;
  let buildData = makeBuildData();
  let buildRouter = router;
  let buildValue = '0';
  let buildAmountOut = '2000000000000000000';
  let quotePriceImpact: string | null = '0.0010';
  let quoteAmountInUsd: string | number | null = '1.00';
  let quoteAmountOutUsd: string | number | null = '0.999';
  let allowance = '0';
  let chainTx: RpcTransaction | null = null;
  let chainReceipt: RpcReceipt | null = null;
  let latestBlock = 1000;
  let latestNonce = 7;
  let blockTimestamp = Math.floor(Date.now() / 1000);

  const kyber = {
    configured: true,
    getRoutes: async (input: { tokenIn: string; tokenOut: string; amountInBase: string }) => ({
      routeSummary: {
        tokenIn: input.tokenIn,
        tokenOut: input.tokenOut,
        amountIn: input.amountInBase,
        amountOut: '2000000000000000000',
        amountInUsd: quoteAmountInUsd,
        amountOutUsd: quoteAmountOutUsd,
        gas: '120000',
        gasUsd: '0.05',
        priceImpact: quotePriceImpact,
        routeID: 'route-test-1',
      },
      routerAddress: router,
      amountIn: input.amountInBase,
      amountOut: '2000000000000000000',
      amountInUsd: quoteAmountInUsd,
      amountOutUsd: quoteAmountOutUsd,
      gas: '120000',
      gasUsd: '0.05',
      priceImpact: quotePriceImpact,
    }),
    buildRoute: async (input: { sender: string; recipient: string; slippageBps: number }) => ({
      data: buildData,
      routerAddress: buildRouter,
      amountIn: '1000000000000000000',
      amountOut: buildAmountOut,
      transactionValue: buildValue,
      gas: '120000',
      gasUsd: '0.05',
      sender: input.sender,
      recipient: input.recipient,
      slippageBps: input.slippageBps,
    }),
  };

  const rpc = {
    configured: true,
    getErc20Allowance: async () => allowance,
    getErc20Balance: async () => '1000000000000000000000',
    getNativeBalance: async () => '1000000000000000000',
    getTransactionByHash: async () => chainTx,
    getTransactionReceipt: async () => chainReceipt,
    getBlockNumber: async () => latestBlock,
    getTransactionCount: async () => latestNonce,
    getBlock: async () => ({
      number: latestBlock,
      timestamp: blockTimestamp,
      hash: `0x${'f'.repeat(64)}`,
    }),
    simulate: async () => {
      if (rpcFailure) throw new Error('rpc unavailable');

      return {
        success: simulationSuccess,
        revertReason: simulationSuccess ? null : 'execution reverted: test',
        gasEstimate: simulationSuccess ? '120000' : null,
        chainId: 56,
      };
    },
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

    return {
      userId: setup.body.user.id as string,
      csrf: csrfFrom(enabled),
      secret: totpSetup.body.secret as string,
    };
  }

  beforeAll(async () => {
    env.SWAP_ENABLED = true;
    env.SWAP_KILL_SWITCH = false;
    env.SWAP_WALLET_ALLOWLIST = wallet;
    env.SWAP_ROUTER_ALLOWLIST = router;
    env.SWAP_EXECUTOR_ALLOWLIST = executor;
    env.SWAP_SELECTOR_ALLOWLIST = selectorAllowlist;
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
    rpcFailure = false;
    buildData = makeBuildData();
    buildRouter = router;
    buildValue = '0';
    buildAmountOut = '2000000000000000000';
    quotePriceImpact = '0.0010';
    quoteAmountInUsd = '1.00';
    quoteAmountOutUsd = '0.999';
    allowance = '0';
    chainTx = null;
    chainReceipt = null;
    latestBlock = 1000;
    latestNonce = 7;
    blockTimestamp = Math.floor(Date.now() / 1000);
    env.SWAP_KILL_SWITCH = false;
    env.SWAP_SELECTOR_ALLOWLIST = selectorAllowlist;
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
      amountInUsd: '1.00000000',
      amountOutUsd: '0.999',
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
    expect(built.body.deadline).toBeGreaterThan(Math.floor(Date.now() / 1000));
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

  it('rejects calldata with a different recipient or a lower minimum output', async () => {
    const agent = request.agent(app.getHttpServer());
    const owner = await setupOwner(agent);
    const quoted = await agent
      .post('/api/v1/swap/quote')
      .set('x-csrf-token', owner.csrf)
      .send({ chain: 'bsc', tokenIn, tokenOut, amountIn: '1', walletAddress: wallet })
      .expect(201);
    const orderId = quoted.body.id as string;

    buildData = makeBuildData({ recipient: '0x3333333333333333333333333333333333333333' });
    const wrongRecipient = await agent
      .post('/api/v1/swap/build')
      .set('x-csrf-token', owner.csrf)
      .send({ orderId, walletAddress: wallet })
      .expect(400);
    expect(wrongRecipient.body.error).toMatchObject({
      code: 'SWAP_VALIDATION_FAILED',
      details: { reason: 'SWAP_RECIPIENT_MISMATCH' },
    });

    buildData = makeBuildData({ minOut: 1n });
    const wrongMinOut = await agent
      .post('/api/v1/swap/build')
      .set('x-csrf-token', owner.csrf)
      .send({ orderId, walletAddress: wallet })
      .expect(400);
    expect(wrongMinOut.body.error).toMatchObject({
      code: 'SWAP_VALIDATION_FAILED',
      details: { reason: 'SWAP_MIN_OUT_MISMATCH' },
    });

    buildData = makeBuildData();
    const built = await agent
      .post('/api/v1/swap/build')
      .set('x-csrf-token', owner.csrf)
      .send({ orderId, walletAddress: wallet })
      .expect(201);
    expect(built.body.validation).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ check: 'calldata.recipient', passed: true }),
        expect.objectContaining({ check: 'calldata.amount', passed: true }),
        expect.objectContaining({ check: 'calldata.executor', passed: true }),
        expect.objectContaining({
          check: 'calldata.deadline',
          passed: true,
          detail: 'server-enforced (nested route)',
        }),
      ]),
    );

    await db
      .update(swapOrders)
      .set({ deadline: Math.floor(Date.now() / 1000) - 1 })
      .where(eq(swapOrders.id, orderId));
    const expired = await agent
      .post(`/api/v1/swap/orders/${orderId}/submitted`)
      .set('x-csrf-token', owner.csrf)
      .send({ txHash: `0x${'e'.repeat(64)}` })
      .expect(409);
    expect(expired.body.error.code).toBe('SWAP_DEADLINE_PASSED');
  }, 60_000);

  it('accepts swapGeneric calldata when both selectors are allowlisted', async () => {
    const agent = request.agent(app.getHttpServer());
    const owner = await setupOwner(agent);
    const quoted = await agent
      .post('/api/v1/swap/quote')
      .set('x-csrf-token', owner.csrf)
      .send({ chain: 'bsc', tokenIn, tokenOut, amountIn: '1', walletAddress: wallet })
      .expect(201);

    buildData = makeBuildData({}, 'swapGeneric');
    const built = await agent
      .post('/api/v1/swap/build')
      .set('x-csrf-token', owner.csrf)
      .send({ orderId: quoted.body.id, walletAddress: wallet })
      .expect(201);

    expect(built.body).toMatchObject({
      status: 'BUILT',
      routerAddress: router.toLowerCase(),
    });
    expect(built.body.validation).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ check: 'calldata-decode', passed: true }),
        expect.objectContaining({ check: 'calldata.simpleMode', passed: true }),
      ]),
    );
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

    env.SWAP_SELECTOR_ALLOWLIST = '';
    await agent
      .post('/api/v1/swap/build')
      .set('x-csrf-token', owner.csrf)
      .send({ orderId, walletAddress: wallet })
      .expect(503);
    env.SWAP_SELECTOR_ALLOWLIST = selectorAllowlist;

    env.SWAP_WALLET_ALLOWLIST = '';
    await agent
      .post('/api/v1/swap/build')
      .set('x-csrf-token', owner.csrf)
      .send({ orderId, walletAddress: wallet })
      .expect(403);
    env.SWAP_WALLET_ALLOWLIST = wallet;

    buildData = '0xzz';
    await agent
      .post('/api/v1/swap/build')
      .set('x-csrf-token', owner.csrf)
      .send({ orderId, walletAddress: wallet })
      .expect(400);

    buildData = `0xdeadbeef${'0'.repeat(120)}`;
    await agent
      .post('/api/v1/swap/build')
      .set('x-csrf-token', owner.csrf)
      .send({ orderId, walletAddress: wallet })
      .expect(400);

    const failedDetail = await agent.get(`/api/v1/swap/orders/${orderId}`).expect(200);
    expect(failedDetail.body.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'build_failed',
          payload: { code: 'SWAP_SELECTOR_NOT_ALLOWED' },
        }),
      ]),
    );
    const failedAudit = await agent.get('/api/v1/audit-log?action=swap.build_failed').expect(200);
    expect(failedAudit.body.data.length).toBeGreaterThan(0);

    buildData = `${selector}${'0'.repeat(120)}`;
    buildRouter = '0x4444444444444444444444444444444444444444';
    await agent
      .post('/api/v1/swap/build')
      .set('x-csrf-token', owner.csrf)
      .send({ orderId, walletAddress: wallet })
      .expect(400);

    buildRouter = router;
    buildValue = '1';
    await agent
      .post('/api/v1/swap/build')
      .set('x-csrf-token', owner.csrf)
      .send({ orderId, walletAddress: wallet })
      .expect(400);

    buildValue = '0';
    buildAmountOut = '1';
    await agent
      .post('/api/v1/swap/build')
      .set('x-csrf-token', owner.csrf)
      .send({ orderId, walletAddress: wallet })
      .expect(400);

    buildAmountOut = '2000000000000000000';
    buildData = makeBuildData();
    simulationSuccess = false;
    await agent
      .post('/api/v1/swap/build')
      .set('x-csrf-token', owner.csrf)
      .send({ orderId, walletAddress: wallet })
      .expect(400);

    simulationSuccess = true;
    rpcFailure = true;
    await agent
      .post('/api/v1/swap/build')
      .set('x-csrf-token', owner.csrf)
      .send({ orderId, walletAddress: wallet })
      .expect(503);
    rpcFailure = false;
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

  it('allows only one concurrent build for a quote', async () => {
    const agent = request.agent(app.getHttpServer());
    const owner = await setupOwner(agent);
    const quoted = await agent
      .post('/api/v1/swap/quote')
      .set('x-csrf-token', owner.csrf)
      .send({ chain: 'bsc', tokenIn, tokenOut, amountIn: '1', walletAddress: wallet })
      .expect(201);
    const orderId = quoted.body.id as string;

    const responses = await Promise.all([
      agent
        .post('/api/v1/swap/build')
        .set('x-csrf-token', owner.csrf)
        .send({ orderId, walletAddress: wallet }),
      agent
        .post('/api/v1/swap/build')
        .set('x-csrf-token', owner.csrf)
        .send({ orderId, walletAddress: wallet }),
    ]);

    expect(responses.map((response) => response.status).sort()).toEqual([201, 409]);
  }, 60_000);

  it('fails closed when the provider omits USD and normalizes numeric USD', async () => {
    const agent = request.agent(app.getHttpServer());
    const owner = await setupOwner(agent);

    quoteAmountInUsd = null;
    await agent
      .post('/api/v1/swap/quote')
      .set('x-csrf-token', owner.csrf)
      .send({ chain: 'bsc', tokenIn, tokenOut, amountIn: '1', walletAddress: wallet })
      .expect(400);

    quoteAmountInUsd = 600;
    quoteAmountOutUsd = 599.4;
    const quoted = await agent
      .post('/api/v1/swap/quote')
      .set('x-csrf-token', owner.csrf)
      .send({ chain: 'bsc', tokenIn, tokenOut, amountIn: '1', walletAddress: wallet })
      .expect(201);
    expect(quoted.body.amountInUsd).toBe('600.00000000');

    await agent
      .post('/api/v1/swap/build')
      .set('x-csrf-token', owner.csrf)
      .send({ orderId: quoted.body.id, walletAddress: wallet })
      .expect(403);
  }, 60_000);

  it('requires step-up TOTP above $500 and builds/submits exact approvals', async () => {
    const agent = request.agent(app.getHttpServer());
    const owner = await setupOwner(agent);
    quoteAmountInUsd = '600.00';
    quoteAmountOutUsd = '599.40';

    const quoted = await agent
      .post('/api/v1/swap/quote')
      .set('x-csrf-token', owner.csrf)
      .send({ chain: 'bsc', tokenIn, tokenOut, amountIn: '1', walletAddress: wallet })
      .expect(201);
    const orderId = quoted.body.id as string;

    await agent
      .post('/api/v1/swap/build')
      .set('x-csrf-token', owner.csrf)
      .send({ orderId, walletAddress: wallet })
      .expect(403);

    const stepUp = await agent
      .post('/api/v1/auth/step-up')
      .set('x-csrf-token', owner.csrf)
      .send({ code: generateSync({ secret: owner.secret }) })
      .expect(200);
    expect(new Date(stepUp.body.stepUpUntil).getTime()).toBeGreaterThan(Date.now());

    await agent
      .post('/api/v1/swap/build')
      .set('x-csrf-token', owner.csrf)
      .send({ orderId, walletAddress: wallet })
      .expect(201);

    env.SWAP_WALLET_ALLOWLIST = '';
    await agent
      .post('/api/v1/swap/approvals/build')
      .set('x-csrf-token', owner.csrf)
      .send({ orderId })
      .expect(403);
    await agent
      .post(`/api/v1/swap/orders/${orderId}/submitted`)
      .set('x-csrf-token', owner.csrf)
      .send({ txHash: `0x${'d'.repeat(64)}` })
      .expect(403);
    env.SWAP_WALLET_ALLOWLIST = wallet;

    const approval = await agent
      .post('/api/v1/swap/approvals/build')
      .set('x-csrf-token', owner.csrf)
      .send({ orderId })
      .expect(201);
    expect(approval.body.calldata.startsWith('0x095ea7b3')).toBe(true);
    expect(approval.body.approval).toMatchObject({
      orderId,
      status: 'BUILT',
      spenderAddress: router.toLowerCase(),
    });
    expect(approval.body.approval.amountWei).toBe('1000000000000000000');

    const encoded = approval.body.calldata.slice(2);
    expect(`0x${encoded.slice(8 + 24, 8 + 64)}`).toBe(router.toLowerCase());
    expect(BigInt(`0x${encoded.slice(72, 136)}`).toString()).toBe('1000000000000000000');

    const duplicateApproval = await agent
      .post('/api/v1/swap/approvals/build')
      .set('x-csrf-token', owner.csrf)
      .send({ orderId });
    expect([409, 400]).toContain(duplicateApproval.status);

    allowance = '1000000000000000000';
    await agent
      .post('/api/v1/swap/approvals/build')
      .set('x-csrf-token', owner.csrf)
      .send({ orderId })
      .expect(409);
    allowance = '0';

    const approvals = await agent.get('/api/v1/swap/approvals').expect(200);
    expect(approvals.body.data).toHaveLength(1);

    const approvalSubmitted = await agent
      .post(`/api/v1/swap/approvals/${approval.body.approval.id}/submitted`)
      .set('x-csrf-token', owner.csrf)
      .send({ txHash: `0x${'a'.repeat(64)}` })
      .expect(200);
    expect(approvalSubmitted.body.status).toBe('SUBMITTED');

    const submitted = await agent
      .post(`/api/v1/swap/orders/${orderId}/submitted`)
      .set('x-csrf-token', owner.csrf)
      .send({ txHash: `0x${'b'.repeat(64)}` })
      .expect(200);
    expect(submitted.body).toMatchObject({
      status: 'SUBMITTED',
      txHash: `0x${'b'.repeat(64)}`,
    });

    await agent
      .post(`/api/v1/swap/orders/${orderId}/submitted`)
      .set('x-csrf-token', owner.csrf)
      .send({ txHash: `0x${'c'.repeat(64)}` })
      .expect(409);
  }, 60_000);

  it('applies the fraction-based price impact gate and USD fallback', async () => {
    const agent = request.agent(app.getHttpServer());
    const owner = await setupOwner(agent);
    const quote = () =>
      agent
        .post('/api/v1/swap/quote')
        .set('x-csrf-token', owner.csrf)
        .send({ chain: 'bsc', tokenIn, tokenOut, amountIn: '1', walletAddress: wallet });

    quotePriceImpact = '0.019';
    quoteAmountOutUsd = '0.981';
    const pass = await quote().expect(201);
    expect(pass.body.priceImpactBps).toBe(190);

    quotePriceImpact = '0.021';
    quoteAmountOutUsd = '0.979';
    await quote().expect(400);

    quotePriceImpact = null;
    quoteAmountInUsd = '1.00';
    quoteAmountOutUsd = '0.99';
    const fallback = await quote().expect(201);
    expect(fallback.body.priceImpactBps).toBe(100);

    quoteAmountInUsd = null;
    quoteAmountOutUsd = null;
    await quote().expect(400);
  }, 60_000);

  it('tracks a confirmed swap and writes idempotent accounting', async () => {
    const agent = request.agent(app.getHttpServer());
    const owner = await setupOwner(agent);
    const accounts = app.get(AccountsService);
    const assets = app.get(AssetsService);
    const ledger = app.get(LedgerService);
    const tracking = app.get(SwapTrackingService);

    const account = await accounts.defaultWalletForChain(owner.userId, 'bsc');
    const tokenInAsset = await assets.ensureForSwapToken('bsc', getSwapToken('bsc', tokenIn)!);
    const bnbAsset = await assets.ensureForSwapToken('bsc', {
      symbol: 'BNB',
      name: 'BNB',
      address: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE',
      decimals: 18,
      native: true,
    });

    await ledger.createManual(
      owner.userId,
      {
        type: 'deposit',
        accountId: account.id,
        assetId: tokenInAsset.id,
        amount: '10',
        usdValue: '10',
      },
      {},
    );
    await ledger.createManual(
      owner.userId,
      {
        type: 'deposit',
        accountId: account.id,
        assetId: bnbAsset.id,
        amount: '0.1',
        usdValue: '60',
      },
      {},
    );

    const quoted = await agent
      .post('/api/v1/swap/quote')
      .set('x-csrf-token', owner.csrf)
      .send({ chain: 'bsc', tokenIn, tokenOut, amountIn: '1', walletAddress: wallet })
      .expect(201);
    const orderId = quoted.body.id as string;
    const built = await agent
      .post('/api/v1/swap/build')
      .set('x-csrf-token', owner.csrf)
      .send({ orderId, walletAddress: wallet })
      .expect(201);
    const txHash = `0x${'1'.repeat(64)}`;

    await agent
      .post(`/api/v1/swap/orders/${orderId}/submitted`)
      .set('x-csrf-token', owner.csrf)
      .send({ txHash })
      .expect(200);

    chainTx = {
      hash: txHash,
      from: wallet,
      to: router,
      input: built.body.calldata as string,
      value: '0x0',
      nonce: 7,
      blockNumber: 100,
    };
    chainReceipt = {
      status: true,
      blockNumber: 100,
      blockHash: `0x${'f'.repeat(64)}`,
      gasUsed: '100000',
      effectiveGasPrice: '0x3b9aca00',
      logs: [swappedLog(1_000_000_000_000_000_000n, 2_100_000_000_000_000_000n)],
    };
    latestBlock = 114;
    blockTimestamp = Math.floor(Date.now() / 1000);

    await tracking.tick();

    const [order] = await db.select().from(swapOrders).where(eq(swapOrders.id, orderId));
    expect(order).toMatchObject({
      status: 'CONFIRMED',
      confirmations: 15,
      blockNumber: 100,
      executedAmountIn: '1.000000000000000000',
      executedAmountOut: '2.100000000000000000',
      networkFeeWei: '100000000000000',
      networkFeeUsd: '0.04166667',
    });
    expect(order.accountingTransactionId).toBeTruthy();
    expect(order.tradeGroupId).toBeTruthy();

    const [accounting] = await db
      .select()
      .from(transactions)
      .where(eq(transactions.id, order.accountingTransactionId!));
    expect(accounting).toMatchObject({
      type: 'trade',
      subtype: 'swap',
      source: 'kyberswap',
      sourceId: txHash,
    });

    const accountingPostings = await db
      .select()
      .from(postings)
      .where(eq(postings.transactionId, accounting.id));
    expect(accountingPostings).toHaveLength(6);

    const [lot] = await db
      .select()
      .from(lots)
      .where(eq(lots.acquisitionTransactionId, accounting.id));
    expect(lot?.amount).toBe('2.100000000000000000');

    await tracking.tick();
    const repeats = await db
      .select()
      .from(transactions)
      .where(and(eq(transactions.source, 'kyberswap'), eq(transactions.sourceId, txHash)));
    expect(repeats).toHaveLength(1);
  }, 60_000);

  it('marks a replaced transaction without accounting', async () => {
    const agent = request.agent(app.getHttpServer());
    const owner = await setupOwner(agent);
    const tracking = app.get(SwapTrackingService);

    const quoted = await agent
      .post('/api/v1/swap/quote')
      .set('x-csrf-token', owner.csrf)
      .send({ chain: 'bsc', tokenIn, tokenOut, amountIn: '1', walletAddress: wallet })
      .expect(201);
    const orderId = quoted.body.id as string;
    await agent
      .post('/api/v1/swap/build')
      .set('x-csrf-token', owner.csrf)
      .send({ orderId, walletAddress: wallet })
      .expect(201);
    await agent
      .post(`/api/v1/swap/orders/${orderId}/submitted`)
      .set('x-csrf-token', owner.csrf)
      .send({ txHash: `0x${'3'.repeat(64)}` })
      .expect(200);

    await db.update(swapOrders).set({ nonce: 7 }).where(eq(swapOrders.id, orderId));
    latestNonce = 8;
    chainTx = null;
    await tracking.tick();

    const [order] = await db.select().from(swapOrders).where(eq(swapOrders.id, orderId));
    expect(order).toMatchObject({ status: 'REPLACED', accountingTransactionId: null });
  }, 60_000);

  it('returns a confirmed order to pending when confirmations drop', async () => {
    const agent = request.agent(app.getHttpServer());
    const owner = await setupOwner(agent);
    const tracking = app.get(SwapTrackingService);

    const quoted = await agent
      .post('/api/v1/swap/quote')
      .set('x-csrf-token', owner.csrf)
      .send({ chain: 'bsc', tokenIn, tokenOut, amountIn: '1', walletAddress: wallet })
      .expect(201);
    const orderId = quoted.body.id as string;
    await agent
      .post('/api/v1/swap/build')
      .set('x-csrf-token', owner.csrf)
      .send({ orderId, walletAddress: wallet })
      .expect(201);

    await db
      .update(swapOrders)
      .set({
        status: 'CONFIRMED',
        confirmedAt: new Date(),
        blockNumber: 100,
        confirmations: 15,
        networkFeeWei: '100000000000000',
        networkFeeUsd: '0.04166667',
      })
      .where(eq(swapOrders.id, orderId));

    chainReceipt = {
      status: true,
      blockNumber: 100,
      blockHash: `0x${'d'.repeat(64)}`,
      gasUsed: '100000',
      effectiveGasPrice: '0x3b9aca00',
      logs: [],
    };
    latestBlock = 105;
    await tracking.tick();

    const [order] = await db.select().from(swapOrders).where(eq(swapOrders.id, orderId));
    expect(order).toMatchObject({
      status: 'PENDING',
      confirmedAt: null,
      accountingTransactionId: null,
    });
    const events = await db.select().from(swapEvents).where(eq(swapEvents.orderId, orderId));
    expect(events.some((event) => event.type === 'reorg')).toBe(true);
  }, 60_000);

  it('marks a reverted swap failed without accounting', async () => {
    const agent = request.agent(app.getHttpServer());
    const owner = await setupOwner(agent);
    const tracking = app.get(SwapTrackingService);

    const quoted = await agent
      .post('/api/v1/swap/quote')
      .set('x-csrf-token', owner.csrf)
      .send({ chain: 'bsc', tokenIn, tokenOut, amountIn: '1', walletAddress: wallet })
      .expect(201);
    const orderId = quoted.body.id as string;
    const built = await agent
      .post('/api/v1/swap/build')
      .set('x-csrf-token', owner.csrf)
      .send({ orderId, walletAddress: wallet })
      .expect(201);
    const txHash = `0x${'2'.repeat(64)}`;

    await agent
      .post(`/api/v1/swap/orders/${orderId}/submitted`)
      .set('x-csrf-token', owner.csrf)
      .send({ txHash })
      .expect(200);

    chainTx = {
      hash: txHash,
      from: wallet,
      to: router,
      input: built.body.calldata as string,
      value: '0x0',
      nonce: 8,
      blockNumber: 101,
    };
    chainReceipt = {
      status: false,
      blockNumber: 101,
      blockHash: `0x${'e'.repeat(64)}`,
      gasUsed: '50000',
      effectiveGasPrice: '0x3b9aca00',
      logs: [],
    };
    latestBlock = 115;

    await tracking.tick();

    const [order] = await db.select().from(swapOrders).where(eq(swapOrders.id, orderId));
    expect(order).toMatchObject({ status: 'FAILED', accountingTransactionId: null });

    const accounting = await db
      .select()
      .from(transactions)
      .where(and(eq(transactions.source, 'kyberswap'), eq(transactions.sourceId, txHash)));
    expect(accounting).toHaveLength(0);
  }, 60_000);
});

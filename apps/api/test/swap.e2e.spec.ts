import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import cookie from '@fastify/cookie';
import { and, eq, sql } from 'drizzle-orm';
import { generateSync } from 'otplib';
import request, { type SuperAgentTest } from 'supertest';
import { encodeAbiParameters, encodeFunctionData, toEventSelector } from 'viem';
import {
  assets,
  auditLog,
  createDb,
  indexedTransfers,
  lots,
  postings,
  swapEvents,
  swapOrderCloseGroups,
  swapOrders,
  tokenApprovals,
  transactions,
  watchedAddresses,
  type Database,
} from '@nexter/db';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { AccountsService } from '../src/modules/accounting/accounts.service';
import { AssetsService } from '../src/modules/accounting/assets.service';
import { LedgerService } from '../src/modules/accounting/ledger.service';
import {
  EvmRpcService,
  type RpcLog,
  type RpcReceipt,
  type RpcTransaction,
} from '../src/modules/swap/evm-rpc.service';
import { KYBER_ROUTER_ABI } from '../src/modules/swap/kyber-calldata';
import { KyberSwapClient } from '../src/modules/swap/kyber-swap.client';
import { OnchainIndexerService } from '../src/modules/reconciliation/onchain-indexer.service';
import { SwapTrackingService } from '../src/modules/swap/swap-tracking.service';
import {
  NATIVE_ADDRESS,
  getSwapToken,
  nativeTokenForChain,
} from '../src/modules/swap/token-registry';
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
const ethereumTokenIn = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48';
const ethereumTokenOut = '0x514910771af9ca656af840dff83e8264ecf986ca';
const chainlinkAddress = '0xf8a0bf9cf54bb92f17374d9e9a321e6a111a51bd';

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

function swappedLog(
  spentAmount: bigint,
  returnAmount: bigint,
  srcToken = tokenIn,
  dstToken = tokenOut,
) {
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
      [wallet, srcToken, dstToken, wallet, spentAmount, returnAmount],
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
  let simulationGasEstimate: string | null = '120000';
  let rpcChainId = 56;
  let rpcFailureChain: string | null = null;
  let rpcLogs: RpcLog[] = [];
  let rpcBlockTransactions: RpcTransaction[] = [];
  let erc20Balances: Record<string, string> = {};
  let erc20DefaultBalance = '1000000000000000000000';
  let rpcFailure = false;
  let buildData = makeBuildData();
  let buildRouter = router;
  let buildValue = '0';
  let buildAmountIn = '1000000000000000000';
  let buildAmountOut = '2000000000000000000';
  let quotePriceImpact: string | null = '0.0010';
  let quoteGasUsd: string | null = '0.05';
  let buildGasUsd: string | null = '0.05';
  let quoteAmountInUsd: string | number | null = '1.00';
  let quoteAmountOutUsd: string | number | null = '0.999';
  let allowance = '1000000000000000000000';
  let chainTx: RpcTransaction | null = null;
  let replacementTx: RpcTransaction | null = null;
  let matchingTxs: RpcTransaction[] = [];
  let nativeBalance = '1000000000000000000';
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
        gasUsd: quoteGasUsd,
        priceImpact: quotePriceImpact,
        routeID: 'route-test-1',
      },
      routerAddress: router,
      amountIn: input.amountInBase,
      amountOut: '2000000000000000000',
      amountInUsd: quoteAmountInUsd,
      amountOutUsd: quoteAmountOutUsd,
      gas: '120000',
      gasUsd: quoteGasUsd,
      priceImpact: quotePriceImpact,
    }),
    buildRoute: async (input: { sender: string; recipient: string; slippageBps: number }) => ({
      data: buildData,
      routerAddress: buildRouter,
      amountIn: buildAmountIn,
      amountOut: buildAmountOut,
      transactionValue: buildValue,
      gas: '120000',
      gasUsd: buildGasUsd,
      sender: input.sender,
      recipient: input.recipient,
      slippageBps: input.slippageBps,
    }),
  };

  const rpc = {
    configured: true,
    configuredFor: () => true,
    ensureChain: async () => undefined,
    getErc20Allowance: async () => allowance,
    getErc20Balance: async (_chain: string, token: string) =>
      erc20Balances[token.toLowerCase()] ?? erc20DefaultBalance,
    getNativeBalance: async () => nativeBalance,
    getGasPrice: async () => '0x3b9aca00',
    findTransactionByNonce: async () => replacementTx,
    findMatchingTransactions: async () => matchingTxs,
    getTransactionByHash: async () => chainTx,
    getTransactionReceipt: async () => chainReceipt,
    getBlockNumber: async (chain: string) => {
      if (rpcFailureChain === chain) throw new Error(`${chain} rpc down`);
      return latestBlock;
    },
    getTransactionCount: async () => latestNonce,
    getBlock: async () => ({
      number: latestBlock,
      timestamp: blockTimestamp,
      hash: `0x${'f'.repeat(64)}`,
    }),
    getLogs: async () => rpcLogs,
    getBlockTransactions: async () => rpcBlockTransactions,
    simulate: async () => {
      if (rpcFailure) throw new Error('rpc unavailable');

      return {
        success: simulationSuccess,
        revertReason: simulationSuccess ? null : 'execution reverted: test',
        gasEstimate: simulationSuccess ? simulationGasEstimate : null,
        chainId: rpcChainId,
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
    env.SWAP_EXECUTION_ENABLED = true;
    env.SWAP_QUOTE_TTL_SECONDS = 15;
    env.SWAP_MAX_PRICE_IMPACT_BPS = 200;
    env.SWAP_MAX_GAS_USD = '5';

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(KyberSwapClient)
      .useValue(kyber)
      .overrideProvider(EvmRpcService)
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
    simulationGasEstimate = '120000';
    rpcChainId = 56;
    rpcFailureChain = null;
    rpcLogs = [];
    rpcBlockTransactions = [];
    erc20Balances = {};
    erc20DefaultBalance = '1000000000000000000000';
    env.RECONCILIATION_ENABLED = false;
    env.RECONCILIATION_LOOKBACK_BLOCKS = 100;
    env.RECONCILIATION_MAX_BLOCKS_PER_TICK = 50;
    rpcFailure = false;
    buildData = makeBuildData();
    buildRouter = router;
    buildValue = '0';
    buildAmountIn = '1000000000000000000';
    buildAmountOut = '2000000000000000000';
    quotePriceImpact = '0.0010';
    quoteGasUsd = '0.05';
    buildGasUsd = '0.05';
    quoteAmountInUsd = '1.00';
    quoteAmountOutUsd = '0.999';
    allowance = '1000000000000000000000';
    chainTx = null;
    replacementTx = null;
    matchingTxs = [];
    chainReceipt = null;
    nativeBalance = '1000000000000000000';
    latestBlock = 1000;
    latestNonce = 7;
    blockTimestamp = Math.floor(Date.now() / 1000);
    env.SWAP_KILL_SWITCH = false;
    env.SWAP_ETHEREUM_EXECUTION_ENABLED = false;
    env.SWAP_ROUTER_ALLOWLIST = router;
    env.SWAP_EXECUTOR_ALLOWLIST = executor;
    env.SWAP_SELECTOR_ALLOWLIST = selectorAllowlist;
    await db.execute(sql`truncate table users restart identity cascade`);
    await db.execute(sql`truncate table indexed_transfers restart identity`);
    await db.execute(
      sql`delete from postings where asset_id in (select id from assets where symbol = 'TESTNULL')`,
    );
    await db.execute(sql`delete from assets where symbol = 'TESTNULL'`);
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
    expect(config.body.chains).toHaveLength(2);
    expect(config.body.chains.map((chain: { code: string }) => chain.code)).toEqual([
      'bsc',
      'ethereum',
    ]);
    expect(config.body.chains[0].tokens).toHaveLength(7);
    expect(config.body.chains[1].tokens).toHaveLength(5);
    expect(config.body.chains[0].executionEnabled).toBe(true);
    expect(config.body.chains[1].executionEnabled).toBe(false);

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

  it('links a swap to selected close groups and fails when a group changes', async () => {
    const agent = request.agent(app.getHttpServer());
    const owner = await setupOwner(agent);
    const assetsResponse = await agent.get('/api/v1/assets').expect(200);
    const assets = assetsResponse.body.assets as Array<{
      id: string;
      symbol: string;
      chainCode: string;
      contractAddress: string | null;
    }>;
    const accountsResponse = await agent.get('/api/v1/accounts').expect(200);
    const accounts = accountsResponse.body.accounts as Array<{
      id: string;
      name: string;
      type: string;
    }>;
    const usdc = assets.find((asset) => asset.chainCode === 'bsc' && asset.symbol === 'USDC');
    const based = assets.find((asset) => asset.chainCode === 'bsc' && asset.symbol === 'BASED');
    const ledgerWallet = accounts.find(
      (account) => account.name === 'Tangem BSC' && account.type === 'wallet',
    );

    expect(usdc?.contractAddress).toBeTruthy();
    expect(based?.contractAddress).toBeTruthy();
    expect(ledgerWallet).toBeDefined();

    await agent
      .post('/api/v1/transactions')
      .set('x-csrf-token', owner.csrf)
      .send({
        type: 'deposit',
        accountId: ledgerWallet?.id,
        assetId: usdc?.id,
        amount: '1000',
        usdValue: '1000',
      })
      .expect(201);
    await agent
      .post('/api/v1/transactions')
      .set('x-csrf-token', owner.csrf)
      .send({
        type: 'buy',
        accountId: ledgerWallet?.id,
        assetId: based?.id,
        amount: '10',
        quoteAssetId: usdc?.id,
        quoteAmount: '20',
      })
      .expect(201);

    const groupsResponse = await agent.get(`/api/v1/trade-groups?assetId=${based?.id}`).expect(200);
    const group = (
      groupsResponse.body.data as Array<{
        id: string;
        remainingAmount: string;
      }>
    ).find((item) => item.remainingAmount.startsWith('10.'));

    expect(group).toBeDefined();

    const quote = await agent
      .post('/api/v1/swap/quote')
      .set('x-csrf-token', owner.csrf)
      .send({
        chain: 'bsc',
        tokenIn: based?.contractAddress,
        tokenOut: usdc?.contractAddress,
        amountIn: '10',
        walletAddress: wallet,
        closeGroupIds: [group?.id],
      })
      .expect(201);

    expect(quote.body.closeGroupIds).toEqual([group?.id]);
    const closeRows = await db
      .select()
      .from(swapOrderCloseGroups)
      .where(eq(swapOrderCloseGroups.orderId, quote.body.id));
    expect(closeRows).toHaveLength(1);
    expect(closeRows[0]?.tradeGroupId).toBe(group?.id);
    expect(closeRows[0]?.expectedAmount).toBe('10.000000000000000000');

    await db
      .update(swapOrders)
      .set({
        status: 'AWAITING_SIGNATURE',
        deadline: Math.floor(Date.now() / 1000) + 300,
      })
      .where(eq(swapOrders.id, quote.body.id));

    const busy = await agent
      .post('/api/v1/swap/quote')
      .set('x-csrf-token', owner.csrf)
      .send({
        chain: 'bsc',
        tokenIn: based?.contractAddress,
        tokenOut: usdc?.contractAddress,
        amountIn: '10',
        walletAddress: wallet,
        closeGroupIds: [group?.id],
      })
      .expect(409);
    expect(busy.body.error.code).toBe('SWAP_CLOSE_GROUP_BUSY');

    await db
      .update(swapOrders)
      .set({ deadline: Math.floor(Date.now() / 1000) - 1 })
      .where(eq(swapOrders.id, quote.body.id));

    const afterDeadline = await agent
      .post('/api/v1/swap/quote')
      .set('x-csrf-token', owner.csrf)
      .send({
        chain: 'bsc',
        tokenIn: based?.contractAddress,
        tokenOut: usdc?.contractAddress,
        amountIn: '10',
        walletAddress: wallet,
        closeGroupIds: [group?.id],
      })
      .expect(201);
    expect(afterDeadline.body.closeGroupIds).toEqual([group?.id]);

    await agent
      .post(`/api/v1/swap/orders/${afterDeadline.body.id}/cancel`)
      .set('x-csrf-token', owner.csrf)
      .expect(200);

    const mismatch = await agent
      .post('/api/v1/swap/quote')
      .set('x-csrf-token', owner.csrf)
      .send({
        chain: 'bsc',
        tokenIn: based?.contractAddress,
        tokenOut: usdc?.contractAddress,
        amountIn: '9',
        walletAddress: wallet,
        closeGroupIds: [group?.id],
      })
      .expect(400);
    expect(mismatch.body.error.code).toBe('SWAP_CLOSE_AMOUNT_MISMATCH');

    const changedQuote = await agent
      .post('/api/v1/swap/quote')
      .set('x-csrf-token', owner.csrf)
      .send({
        chain: 'bsc',
        tokenIn: based?.contractAddress,
        tokenOut: usdc?.contractAddress,
        amountIn: '10',
        walletAddress: wallet,
        closeGroupIds: [group?.id],
      })
      .expect(201);

    await agent
      .post('/api/v1/transactions')
      .set('x-csrf-token', owner.csrf)
      .send({
        type: 'sell',
        accountId: ledgerWallet?.id,
        assetId: based?.id,
        amount: '1',
        proceedsAssetId: usdc?.id,
        proceedsAmount: '2',
        tradeGroupId: group?.id,
      })
      .expect(201);

    const changed = await agent
      .post('/api/v1/swap/build')
      .set('x-csrf-token', owner.csrf)
      .send({ orderId: changedQuote.body.id, walletAddress: wallet })
      .expect(400);
    expect(changed.body.error.code).toBe('SWAP_CLOSE_GROUP_CHANGED');
  }, 60_000);

  it('supersedes a stale unsigned close order for the same groups', async () => {
    const agent = request.agent(app.getHttpServer());
    const owner = await setupOwner(agent);
    const assetsResponse = await agent.get('/api/v1/assets').expect(200);
    const allAssets = assetsResponse.body.assets as Array<{
      id: string;
      symbol: string;
      chainCode: string;
      contractAddress: string | null;
    }>;
    const accountsResponse = await agent.get('/api/v1/accounts').expect(200);
    const allAccounts = accountsResponse.body.accounts as Array<{
      id: string;
      name: string;
      type: string;
    }>;
    const usdc = allAssets.find((asset) => asset.chainCode === 'bsc' && asset.symbol === 'USDC');
    const based = allAssets.find((asset) => asset.chainCode === 'bsc' && asset.symbol === 'BASED');
    const ledger = allAccounts.find(
      (account) => account.name === 'Tangem BSC' && account.type === 'wallet',
    );

    await agent
      .post('/api/v1/transactions')
      .set('x-csrf-token', owner.csrf)
      .send({
        type: 'deposit',
        accountId: ledger?.id,
        assetId: usdc?.id,
        amount: '1000',
        usdValue: '1000',
      })
      .expect(201);
    await agent
      .post('/api/v1/transactions')
      .set('x-csrf-token', owner.csrf)
      .send({
        type: 'buy',
        accountId: ledger?.id,
        assetId: based?.id,
        amount: '10',
        quoteAssetId: usdc?.id,
        quoteAmount: '20',
      })
      .expect(201);

    const group = (
      (await agent.get(`/api/v1/trade-groups?assetId=${based?.id}`).expect(200)).body
        .data as Array<{ id: string; remainingAmount: string }>
    ).find((item) => item.remainingAmount.startsWith('10.'));
    expect(group).toBeDefined();

    const first = await agent
      .post('/api/v1/swap/quote')
      .set('x-csrf-token', owner.csrf)
      .send({
        chain: 'bsc',
        tokenIn: based?.contractAddress,
        tokenOut: usdc?.contractAddress,
        amountIn: '10',
        walletAddress: wallet,
        closeGroupIds: [group?.id],
      })
      .expect(201);

    await db
      .update(swapOrders)
      .set({
        status: 'READY',
        deadline: Math.floor(Date.now() / 1000) + 300,
        updatedAt: new Date(Date.now() - 10_000),
      })
      .where(eq(swapOrders.id, first.body.id));

    const second = await agent
      .post('/api/v1/swap/quote')
      .set('x-csrf-token', owner.csrf)
      .send({
        chain: 'bsc',
        tokenIn: based?.contractAddress,
        tokenOut: usdc?.contractAddress,
        amountIn: '10',
        walletAddress: wallet,
        closeGroupIds: [group?.id],
      })
      .expect(201);
    expect(second.body.closeGroupIds).toEqual([group?.id]);

    const [superseded] = await db.select().from(swapOrders).where(eq(swapOrders.id, first.body.id));
    expect(superseded?.status).toBe('CANCELLED');

    const events = await db.select().from(swapEvents).where(eq(swapEvents.orderId, first.body.id));
    expect(events.some((event) => event.type === 'cancelled')).toBe(true);

    await agent
      .post(`/api/v1/swap/orders/${second.body.id}/cancel`)
      .set('x-csrf-token', owner.csrf)
      .expect(200);
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
    await app.get(SwapTrackingService).tick();
    const [expiredOrder] = await db.select().from(swapOrders).where(eq(swapOrders.id, orderId));
    expect(expiredOrder.status).toBe('EXPIRED');

    const lateHash = await agent
      .post(`/api/v1/swap/orders/${orderId}/submitted`)
      .set('x-csrf-token', owner.csrf)
      .send({ txHash: `0x${'e'.repeat(64)}` })
      .expect(200);
    expect(lateHash.body.status).toBe('SUBMITTED');
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

  it('quotes, builds, readies, signs and confirms an Ethereum swap', async () => {
    env.SWAP_ETHEREUM_EXECUTION_ENABLED = false;
    rpcChainId = 1;
    buildAmountIn = '1000000';
    buildData = makeBuildData({
      srcToken: ethereumTokenIn,
      dstToken: ethereumTokenOut,
      amount: 1_000_000n,
      minOut: 1_990_000_000_000_000_000n,
    });
    const agent = request.agent(app.getHttpServer());
    const owner = await setupOwner(agent);
    const tracking = app.get(SwapTrackingService);

    const quoted = await agent
      .post('/api/v1/swap/quote')
      .set('x-csrf-token', owner.csrf)
      .send({
        chain: 'ethereum',
        tokenIn: ethereumTokenIn,
        tokenOut: ethereumTokenOut,
        amountIn: '1',
        slippageBps: 50,
        walletAddress: wallet,
      })
      .expect(201);
    expect(quoted.body).toMatchObject({
      chain: 'ethereum',
      status: 'QUOTED',
      tokenIn: { symbol: 'USDC', decimals: 6 },
      tokenOut: { symbol: 'LINK', decimals: 18 },
    });

    const orderId = quoted.body.id as string;
    const built = await agent
      .post('/api/v1/swap/build')
      .set('x-csrf-token', owner.csrf)
      .send({ orderId, walletAddress: wallet })
      .expect(201);
    expect(built.body).toMatchObject({ chain: 'ethereum', status: 'BUILT' });

    await agent
      .post(`/api/v1/swap/orders/${orderId}/ready`)
      .set('x-csrf-token', owner.csrf)
      .expect(200);
    const disabled = await agent
      .post(`/api/v1/swap/orders/${orderId}/signing`)
      .set('x-csrf-token', owner.csrf)
      .expect(503);
    expect(disabled.body.error.code).toBe('SWAP_EXECUTION_DISABLED');

    env.SWAP_ETHEREUM_EXECUTION_ENABLED = true;
    const signing = await agent
      .post(`/api/v1/swap/orders/${orderId}/signing`)
      .set('x-csrf-token', owner.csrf)
      .expect(200);
    expect(signing.body.status).toBe('AWAITING_SIGNATURE');

    const txHash = `0x${'1'.repeat(63)}2`;
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
      blockHash: `0x${'2'.repeat(64)}`,
      transactionHash: txHash,
      gasUsed: '100000',
      effectiveGasPrice: '0x3b9aca00',
      logs: [],
    };
    latestBlock = 111;
    await tracking.tick();

    const [order] = await db.select().from(swapOrders).where(eq(swapOrders.id, orderId));
    expect(order).toMatchObject({
      chain: 'ethereum',
      status: 'CONFIRMED',
      txHash,
      confirmations: 12,
    });
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
    buildAmountIn = '1000000000000000000';
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
    allowance = '0';

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

    const built = await agent
      .post('/api/v1/swap/build')
      .set('x-csrf-token', owner.csrf)
      .send({ orderId, walletAddress: wallet })
      .expect(201);
    expect(built.body).toMatchObject({
      status: 'APPROVAL_REQUIRED',
      approvalRequired: true,
      simulation: null,
    });

    env.SWAP_WALLET_ALLOWLIST = '';
    await agent
      .post('/api/v1/swap/approvals/build')
      .set('x-csrf-token', owner.csrf)
      .send({ orderId })
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

    const approvalTxHash = `0x${'a'.repeat(64)}`;
    chainTx = {
      hash: approvalTxHash,
      from: wallet,
      to: tokenIn,
      input: approval.body.calldata,
      value: '0x0',
      nonce: 10,
      blockNumber: 100,
    };
    chainReceipt = {
      status: true,
      blockNumber: 100,
      blockHash: `0x${'b'.repeat(64)}`,
      transactionHash: approvalTxHash,
      gasUsed: '50000',
      effectiveGasPrice: '0x3b9aca00',
      logs: [],
    };
    latestBlock = 114;
    const tracking = app.get(SwapTrackingService);
    await tracking.tick();

    const [trackedApproval] = await db
      .select()
      .from(tokenApprovals)
      .where(eq(tokenApprovals.id, approval.body.approval.id));
    expect(trackedApproval.status).toBe('CONFIRMED');

    const notReady = await agent
      .post(`/api/v1/swap/orders/${orderId}/ready`)
      .set('x-csrf-token', owner.csrf)
      .expect(409);
    expect(notReady.body.error.code).toBe('SWAP_APPROVAL_REQUIRED');

    allowance = '1000000000000000000';
    const ready = await agent
      .post(`/api/v1/swap/orders/${orderId}/ready`)
      .set('x-csrf-token', owner.csrf)
      .expect(200);
    expect(ready.body).toMatchObject({
      status: 'READY',
      approvalRequired: false,
    });

    const signing = await agent
      .post(`/api/v1/swap/orders/${orderId}/signing`)
      .set('x-csrf-token', owner.csrf)
      .expect(200);
    expect(signing.body.status).toBe('AWAITING_SIGNATURE');

    await agent
      .post(`/api/v1/swap/orders/${orderId}/signing`)
      .set('x-csrf-token', owner.csrf)
      .expect(409);
    await agent
      .post(`/api/v1/swap/orders/${orderId}/ready`)
      .set('x-csrf-token', owner.csrf)
      .expect(409);

    env.SWAP_WALLET_ALLOWLIST = '';
    const submitted = await agent
      .post(`/api/v1/swap/orders/${orderId}/submitted`)
      .set('x-csrf-token', owner.csrf)
      .send({ txHash: `0x${'b'.repeat(64)}` })
      .expect(200);
    env.SWAP_WALLET_ALLOWLIST = wallet;
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

  it('enforces the gas cost cap at quote and build', async () => {
    const agent = request.agent(app.getHttpServer());
    const owner = await setupOwner(agent);
    env.SWAP_MAX_GAS_USD = '0.01';
    await agent
      .post('/api/v1/swap/quote')
      .set('x-csrf-token', owner.csrf)
      .send({ chain: 'bsc', tokenIn, tokenOut, amountIn: '1', walletAddress: wallet })
      .expect(400);
    env.SWAP_MAX_GAS_USD = '5';

    quoteGasUsd = null;
    await agent
      .post('/api/v1/swap/quote')
      .set('x-csrf-token', owner.csrf)
      .send({ chain: 'bsc', tokenIn, tokenOut, amountIn: '1', walletAddress: wallet })
      .expect(400);
    quoteGasUsd = '0.05';

    const quoted = await agent
      .post('/api/v1/swap/quote')
      .set('x-csrf-token', owner.csrf)
      .send({ chain: 'bsc', tokenIn, tokenOut, amountIn: '1', walletAddress: wallet })
      .expect(201);
    buildGasUsd = '10';
    const built = await agent
      .post('/api/v1/swap/build')
      .set('x-csrf-token', owner.csrf)
      .send({ orderId: quoted.body.id, walletAddress: wallet })
      .expect(400);
    expect(built.body.error).toMatchObject({
      code: 'SWAP_VALIDATION_FAILED',
      details: { reason: 'SWAP_GAS_TOO_HIGH' },
    });

    await db.update(swapOrders).set({ gasUsd: null }).where(eq(swapOrders.id, quoted.body.id));
    buildGasUsd = null;
    const missing = await agent
      .post('/api/v1/swap/build')
      .set('x-csrf-token', owner.csrf)
      .send({ orderId: quoted.body.id, walletAddress: wallet })
      .expect(400);
    expect(missing.body.error).toMatchObject({
      code: 'SWAP_VALIDATION_FAILED',
      details: { reason: 'SWAP_GAS_MISSING' },
    });
    buildGasUsd = '0.05';
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

  it('releases a signing lock under the kill switch', async () => {
    const agent = request.agent(app.getHttpServer());
    const owner = await setupOwner(agent);
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
      .post(`/api/v1/swap/orders/${orderId}/ready`)
      .set('x-csrf-token', owner.csrf)
      .expect(200);
    await agent
      .post(`/api/v1/swap/orders/${orderId}/signing`)
      .set('x-csrf-token', owner.csrf)
      .expect(200);

    env.SWAP_KILL_SWITCH = true;
    const cancelled = await agent
      .post(`/api/v1/swap/orders/${orderId}/signing/cancel`)
      .set('x-csrf-token', owner.csrf)
      .expect(200);
    expect(cancelled.body.status).toBe('READY');
    env.SWAP_KILL_SWITCH = false;

    await agent
      .post(`/api/v1/swap/orders/${orderId}/submitted`)
      .set('x-csrf-token', owner.csrf)
      .send({ txHash: `0x${'9'.repeat(64)}` })
      .expect(200);
  }, 60_000);

  it('marks a never-mined approval failed after the timeout', async () => {
    const agent = request.agent(app.getHttpServer());
    const owner = await setupOwner(agent);
    allowance = '0';
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
    const approval = await agent
      .post('/api/v1/swap/approvals/build')
      .set('x-csrf-token', owner.csrf)
      .send({ orderId })
      .expect(201);
    const approvalTxHash = `0x${'8'.repeat(64)}`;
    await agent
      .post(`/api/v1/swap/approvals/${approval.body.approval.id}/submitted`)
      .set('x-csrf-token', owner.csrf)
      .send({ txHash: approvalTxHash })
      .expect(200);

    await db
      .update(tokenApprovals)
      .set({ submittedAt: new Date(Date.now() - 2 * 60 * 60 * 1000) })
      .where(eq(tokenApprovals.id, approval.body.approval.id));

    chainTx = {
      hash: approvalTxHash,
      from: wallet,
      to: tokenIn,
      input: approval.body.calldata,
      value: '0x0',
      nonce: 11,
      blockNumber: null,
    };
    chainReceipt = null;
    latestBlock = 120;
    await app.get(SwapTrackingService).tick();

    const [tracked] = await db
      .select()
      .from(tokenApprovals)
      .where(eq(tokenApprovals.id, approval.body.approval.id));
    expect(tracked.status).toBe('FAILED');
  }, 60_000);

  it('accepts a signed hash while execution is disabled', async () => {
    const agent = request.agent(app.getHttpServer());
    const owner = await setupOwner(agent);
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

    env.SWAP_EXECUTION_ENABLED = false;
    const signed = await agent
      .post(`/api/v1/swap/orders/${orderId}/submitted`)
      .set('x-csrf-token', owner.csrf)
      .send({ txHash: `0x${'f'.repeat(64)}` })
      .expect(200);
    expect(signed.body.status).toBe('SUBMITTED');

    env.SWAP_EXECUTION_ENABLED = true;
  }, 60_000);

  it('uses a Postgres advisory lock so only one tracker replica ticks', async () => {
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
    const txHash = `0x${'9'.repeat(63)}8`;
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
      blockHash: `0x${'8'.repeat(64)}`,
      transactionHash: txHash,
      gasUsed: '100000',
      effectiveGasPrice: '0x3b9aca00',
      logs: [],
    };
    latestBlock = 114;

    const lockClient = await pool.connect();
    try {
      await lockClient.query("select pg_advisory_lock('5712345678901234'::bigint)");
      await tracking.tick();
      const [held] = await db.select().from(swapOrders).where(eq(swapOrders.id, orderId));
      expect(held.status).toBe('SUBMITTED');
      expect(held.confirmations).toBe(0);
    } finally {
      await lockClient.query("select pg_advisory_unlock('5712345678901234'::bigint)");
      lockClient.release();
    }

    await tracking.tick();
    const [confirmed] = await db.select().from(swapOrders).where(eq(swapOrders.id, orderId));
    expect(confirmed.status).toBe('CONFIRMED');
  }, 60_000);

  it('runs a watch-only reconciliation for the native asset', async () => {
    const agent = request.agent(app.getHttpServer());
    const owner = await setupOwner(agent);
    const accounts = app.get(AccountsService);
    const assets = app.get(AssetsService);
    const ledger = app.get(LedgerService);

    const account = await accounts.defaultWalletForChain(owner.userId, 'bsc');
    const native = await assets.ensureForSwapToken(
      'bsc',
      nativeTokenForChain('bsc'),
      undefined,
      owner.userId,
    );
    await ledger.createManual(
      owner.userId,
      {
        type: 'deposit',
        accountId: account.id,
        assetId: native.id,
        amount: '0.5',
        usdValue: '300',
      },
      {},
    );

    nativeBalance = '500000000000000000';
    erc20DefaultBalance = '0';
    env.RECONCILIATION_ENABLED = true;

    await agent
      .post('/api/v1/reconciliation/addresses')
      .set('x-csrf-token', owner.csrf)
      .send({ chain: 'bsc', address: wallet, label: 'acceptance wallet' })
      .expect(201);

    const run = await agent
      .post('/api/v1/reconciliation/run')
      .set('x-csrf-token', owner.csrf)
      .send({ chain: 'bsc' })
      .expect(201);

    expect(run.body.status).toBe('COMPLETED');
    const bnb = run.body.items.find((item: { symbol: string }) => item.symbol === 'BNB');
    expect(bnb).toMatchObject({
      status: 'MATCH',
      ledgerBalance: '0.500000000000000000',
      onchainBalance: '0.500000000000000000',
    });
    expect(run.body.summary).toMatchObject({
      addresses: [wallet],
      blockNumber: 1000,
      gasBackfilled: 0,
    });
  }, 60_000);

  it('reconciles a seeded ERC-20 contract asset', async () => {
    const agent = request.agent(app.getHttpServer());
    const owner = await setupOwner(agent);
    const accounts = app.get(AccountsService);
    const assets = app.get(AssetsService);
    const ledger = app.get(LedgerService);

    const account = await accounts.defaultWalletForChain(owner.userId, 'bsc');
    const usdc = await assets.ensureForSwapToken(
      'bsc',
      getSwapToken('bsc', tokenIn)!,
      undefined,
      owner.userId,
    );
    await ledger.createManual(
      owner.userId,
      {
        type: 'deposit',
        accountId: account.id,
        assetId: usdc.id,
        amount: '1',
        usdValue: '1',
      },
      {},
    );

    nativeBalance = '0';
    erc20DefaultBalance = '0';
    erc20Balances = { [tokenIn.toLowerCase()]: '1000000000000000000' };
    env.RECONCILIATION_ENABLED = true;

    await agent
      .post('/api/v1/reconciliation/addresses')
      .set('x-csrf-token', owner.csrf)
      .send({ chain: 'bsc', address: wallet })
      .expect(201);

    const run = await agent
      .post('/api/v1/reconciliation/run')
      .set('x-csrf-token', owner.csrf)
      .send({ chain: 'bsc' })
      .expect(201);

    const item = run.body.items.find((row: { symbol: string }) => row.symbol === 'USDC');
    expect(item).toMatchObject({
      status: 'MATCH',
      ledgerBalance: '1.000000000000000000',
      onchainBalance: '1.000000000000000000',
    });
    expect(run.body.items).toHaveLength(1);
    expect(run.body.summary).toMatchObject({
      matches: 1,
      mismatches: 0,
      missingOnchain: 0,
      missingLedger: 0,
      unsupportedAssets: [],
    });
  }, 60_000);

  it('reports a ledger asset without a contract as unsupported without failing the run', async () => {
    const agent = request.agent(app.getHttpServer());
    const owner = await setupOwner(agent);
    const accounts = app.get(AccountsService);
    const assetsService = app.get(AssetsService);
    const ledger = app.get(LedgerService);

    const account = await accounts.defaultWalletForChain(owner.userId, 'bsc');
    const usdc = await assetsService.ensureForSwapToken(
      'bsc',
      getSwapToken('bsc', tokenIn)!,
      undefined,
      owner.userId,
    );
    const [manual] = await db
      .insert(assets)
      .values({
        chainId: usdc.chainId,
        symbol: 'TESTNULL',
        name: 'Imported without contract',
        decimals: 18,
        isVerified: false,
      })
      .returning();
    await ledger.createManual(
      owner.userId,
      {
        type: 'deposit',
        accountId: account.id,
        assetId: manual.id,
        amount: '1',
        usdValue: '1',
      },
      {},
    );

    nativeBalance = '0';
    erc20DefaultBalance = '0';
    env.RECONCILIATION_ENABLED = true;

    await agent
      .post('/api/v1/reconciliation/addresses')
      .set('x-csrf-token', owner.csrf)
      .send({ chain: 'bsc', address: wallet })
      .expect(201);

    const run = await agent
      .post('/api/v1/reconciliation/run')
      .set('x-csrf-token', owner.csrf)
      .send({ chain: 'bsc' })
      .expect(201);

    expect(run.body.status).toBe('COMPLETED');
    expect(run.body.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ symbol: 'TESTNULL', status: 'UNSUPPORTED' }),
      ]),
    );
    expect(run.body.summary.unsupportedAssets).toContain('TESTNULL');
  }, 60_000);

  it('indexes ERC-20 and native transfers for a watched address', async () => {
    const agent = request.agent(app.getHttpServer());
    const owner = await setupOwner(agent);
    const indexer = app.get(OnchainIndexerService);

    env.RECONCILIATION_ENABLED = true;
    env.RECONCILIATION_LOOKBACK_BLOCKS = 1;
    env.RECONCILIATION_MAX_BLOCKS_PER_TICK = 50;
    latestBlock = 1;

    await agent
      .post('/api/v1/reconciliation/addresses')
      .set('x-csrf-token', owner.csrf)
      .send({ chain: 'bsc', address: wallet, label: 'indexer wallet' })
      .expect(201);

    const topic = (address: string) =>
      `0x${address.toLowerCase().replace(/^0x/, '').padStart(64, '0')}`;
    const amount = BigInt(1_000_000_000_000_000_000n).toString(16).padStart(64, '0');
    const logTxHash = `0x${'1'.repeat(64)}`;
    rpcLogs = [
      {
        address: tokenIn,
        topics: [
          '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef',
          topic(wallet),
          topic('0x2222222222222222222222222222222222222222'),
        ],
        data: `0x${amount}`,
        transactionHash: logTxHash,
        logIndex: 0,
        blockNumber: 1,
        blockHash: `0x${'2'.repeat(64)}`,
      },
    ];
    rpcBlockTransactions = [
      {
        hash: `0x${'3'.repeat(64)}`,
        from: wallet,
        to: '0x2222222222222222222222222222222222222222',
        input: '0x',
        value: '0x1',
        nonce: 1,
        blockNumber: 1,
      },
    ];

    await indexer.tick();

    const transfers = await db.select().from(indexedTransfers);
    expect(transfers).toHaveLength(2);
    expect(transfers.find((row) => row.assetAddress === tokenIn.toLowerCase())?.amount).toBe(
      '1000000000000000000',
    );
    expect(transfers.find((row) => row.assetAddress === null)?.amount).toBe('1');

    const [watch] = await db
      .select()
      .from(watchedAddresses)
      .where(eq(watchedAddresses.address, wallet));
    expect(watch.lastIndexedBlock).toBe(1);
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
      transactionHash: txHash,
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

    const auditAsset = await assets.ensureForSwapToken(
      'bsc',
      {
        symbol: `AUDIT${Date.now()}`,
        name: 'Audit Asset',
        address: `0x${'a'.repeat(40)}`,
        decimals: 18,
        native: false,
      },
      undefined,
      owner.userId,
    );
    const assetAudits = await db
      .select()
      .from(auditLog)
      .where(
        and(
          eq(auditLog.userId, owner.userId),
          eq(auditLog.action, 'accounting.asset_created'),
          eq(auditLog.entityId, auditAsset.id),
        ),
      );
    expect(assetAudits).toHaveLength(1);

    await tracking.tick();
    const repeats = await db
      .select()
      .from(transactions)
      .where(and(eq(transactions.source, 'kyberswap'), eq(transactions.sourceId, txHash)));
    expect(repeats).toHaveLength(1);
  }, 60_000);

  it('keeps BSC tracking when the Ethereum RPC fails', async () => {
    const agent = request.agent(app.getHttpServer());
    const owner = await setupOwner(agent);
    const tracking = app.get(SwapTrackingService);

    const quoted = await agent
      .post('/api/v1/swap/quote')
      .set('x-csrf-token', owner.csrf)
      .send({ chain: 'bsc', tokenIn, tokenOut, amountIn: '1', walletAddress: wallet })
      .expect(201);
    const bscOrderId = quoted.body.id as string;
    const built = await agent
      .post('/api/v1/swap/build')
      .set('x-csrf-token', owner.csrf)
      .send({ orderId: bscOrderId, walletAddress: wallet })
      .expect(201);
    const bscHash = `0x${'a'.repeat(63)}1`;
    await agent
      .post(`/api/v1/swap/orders/${bscOrderId}/submitted`)
      .set('x-csrf-token', owner.csrf)
      .send({ txHash: bscHash })
      .expect(200);

    await db.insert(swapOrders).values({
      userId: owner.userId,
      chain: 'ethereum',
      walletAddress: wallet,
      tokenIn: ethereumTokenIn,
      tokenOut: ethereumTokenOut,
      tokenInSymbol: 'USDC',
      tokenOutSymbol: 'LINK',
      amountIn: '1',
      amountOut: '2',
      minOut: '1.99',
      slippageBps: 50,
      routeSummary: { amountIn: '1000000' },
      status: 'SUBMITTED',
      txHash: `0x${'b'.repeat(63)}2`,
      submittedAt: new Date(),
      quoteExpiresAt: new Date(Date.now() + 60_000),
    });

    chainTx = {
      hash: bscHash,
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
      blockHash: `0x${'c'.repeat(64)}`,
      transactionHash: bscHash,
      gasUsed: '100000',
      effectiveGasPrice: '0x3b9aca00',
      logs: [],
    };
    latestBlock = 114;
    rpcFailureChain = 'ethereum';
    await tracking.tick();

    const [bscOrder] = await db.select().from(swapOrders).where(eq(swapOrders.id, bscOrderId));
    expect(bscOrder.status).toBe('CONFIRMED');
    const [ethOrder] = await db
      .select()
      .from(swapOrders)
      .where(eq(swapOrders.chain, 'ethereum'))
      .limit(1);
    expect(ethOrder?.status).toBe('SUBMITTED');
  }, 60_000);

  it('tracks and accounts an Ethereum swap with the ETH gas asset', async () => {
    rpcChainId = 1;
    buildAmountIn = '1000000';
    buildData = makeBuildData({
      srcToken: ethereumTokenIn,
      dstToken: ethereumTokenOut,
      amount: 1_000_000n,
      minOut: 1_990_000_000_000_000_000n,
    });
    const agent = request.agent(app.getHttpServer());
    const owner = await setupOwner(agent);
    const accounts = app.get(AccountsService);
    const assets = app.get(AssetsService);
    const ledger = app.get(LedgerService);
    const tracking = app.get(SwapTrackingService);

    const account = await accounts.defaultWalletForChain(owner.userId, 'ethereum');
    const tokenInAsset = await assets.ensureForSwapToken(
      'ethereum',
      getSwapToken('ethereum', ethereumTokenIn)!,
    );
    const ethAsset = await assets.ensureForSwapToken(
      'ethereum',
      getSwapToken('ethereum', NATIVE_ADDRESS)!,
    );

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
        assetId: ethAsset.id,
        amount: '0.1',
        usdValue: '300',
      },
      {},
    );

    const quoted = await agent
      .post('/api/v1/swap/quote')
      .set('x-csrf-token', owner.csrf)
      .send({
        chain: 'ethereum',
        tokenIn: ethereumTokenIn,
        tokenOut: ethereumTokenOut,
        amountIn: '1',
        walletAddress: wallet,
      })
      .expect(201);
    const orderId = quoted.body.id as string;
    const built = await agent
      .post('/api/v1/swap/build')
      .set('x-csrf-token', owner.csrf)
      .send({ orderId, walletAddress: wallet })
      .expect(201);
    const txHash = `0x${'2'.repeat(63)}3`;

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
      blockHash: `0x${'3'.repeat(64)}`,
      transactionHash: txHash,
      gasUsed: '100000',
      effectiveGasPrice: '0x3b9aca00',
      logs: [swappedLog(1_000_000n, 2_100_000_000_000_000_000n, ethereumTokenIn, ethereumTokenOut)],
    };
    latestBlock = 111;
    blockTimestamp = Math.floor(Date.now() / 1000);

    await tracking.tick();

    const [order] = await db.select().from(swapOrders).where(eq(swapOrders.id, orderId));
    expect(order).toMatchObject({
      chain: 'ethereum',
      status: 'CONFIRMED',
      confirmations: 12,
      executedAmountIn: '1.000000000000000000',
      executedAmountOut: '2.100000000000000000',
    });
    expect(order.accountingTransactionId).toBeTruthy();

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
    expect(accountingPostings.find((posting) => posting.assetId === ethAsset.id)).toBeTruthy();
  }, 60_000);

  it('accounts a cash-equivalent output from the actual on-chain amount', async () => {
    const agent = request.agent(app.getHttpServer());
    const owner = await setupOwner(agent);
    const accounts = app.get(AccountsService);
    const assets = app.get(AssetsService);
    const ledger = app.get(LedgerService);
    const tracking = app.get(SwapTrackingService);

    const account = await accounts.defaultWalletForChain(owner.userId, 'bsc');
    const link = getSwapToken('bsc', chainlinkAddress)!;
    const linkAsset = await assets.ensureForSwapToken('bsc', link);
    const usdcAsset = await assets.ensureForSwapToken('bsc', getSwapToken('bsc', tokenIn)!);
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
        assetId: linkAsset.id,
        amount: '1',
        usdValue: '2',
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

    quoteAmountInUsd = '2';
    quoteAmountOutUsd = '2.00000001';
    const quoted = await agent
      .post('/api/v1/swap/quote')
      .set('x-csrf-token', owner.csrf)
      .send({
        chain: 'bsc',
        tokenIn: chainlinkAddress,
        tokenOut: tokenIn,
        amountIn: '1',
        walletAddress: wallet,
      })
      .expect(201);
    const orderId = quoted.body.id as string;

    buildData = makeBuildData({ srcToken: chainlinkAddress, dstToken: tokenIn });
    const built = await agent
      .post('/api/v1/swap/build')
      .set('x-csrf-token', owner.csrf)
      .send({ orderId, walletAddress: wallet })
      .expect(201);
    const txHash = `0x${'4'.repeat(64)}`;

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
      nonce: 9,
      blockNumber: 102,
    };
    chainReceipt = {
      status: true,
      blockNumber: 102,
      blockHash: `0x${'c'.repeat(64)}`,
      transactionHash: txHash,
      gasUsed: '100000',
      effectiveGasPrice: '0x3b9aca00',
      logs: [
        swappedLog(
          1_000_000_000_000_000_000n,
          2_000_000_000_000_000_000n,
          chainlinkAddress,
          tokenIn,
        ),
      ],
    };
    latestBlock = 116;
    blockTimestamp = Math.floor(Date.now() / 1000);

    await tracking.tick();

    const [order] = await db.select().from(swapOrders).where(eq(swapOrders.id, orderId));
    expect(order).toMatchObject({
      status: 'CONFIRMED',
      accountingTransactionId: expect.any(String),
      executedAmountOut: '2.000000000000000000',
    });

    const accountingPostings = await db
      .select()
      .from(postings)
      .where(eq(postings.transactionId, order.accountingTransactionId!));
    expect(accountingPostings).toHaveLength(6);
    expect(accountingPostings.find((posting) => posting.assetId === usdcAsset.id)?.amount).toBe(
      '2.000000000000000000',
    );
  }, 60_000);

  it('adopts a replacement before the first observation without a stored nonce', async () => {
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
    const originalHash = `0x${'a'.repeat(64)}`;
    const replacementHash = `0x${'b'.repeat(64)}`;
    await agent
      .post(`/api/v1/swap/orders/${orderId}/submitted`)
      .set('x-csrf-token', owner.csrf)
      .send({ txHash: originalHash })
      .expect(200);

    chainTx = null;
    matchingTxs = [
      {
        hash: replacementHash,
        from: wallet,
        to: router,
        input: built.body.calldata as string,
        value: '0x0',
        nonce: 12,
        blockNumber: 100,
      },
    ];
    chainReceipt = {
      status: true,
      blockNumber: 100,
      blockHash: `0x${'c'.repeat(64)}`,
      transactionHash: replacementHash,
      gasUsed: '100000',
      effectiveGasPrice: '0x3b9aca00',
      logs: [],
    };
    latestBlock = 114;
    await tracking.tick();

    const [order] = await db.select().from(swapOrders).where(eq(swapOrders.id, orderId));
    expect(order.txHash).toBe(replacementHash);
    expect(order.status).toBe('CONFIRMED');
  }, 60_000);

  it('does not terminally drop a missing replacement and records an anomaly', async () => {
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
      .send({ txHash: `0x${'d'.repeat(64)}` })
      .expect(200);

    await db
      .update(swapOrders)
      .set({ submittedAt: new Date(Date.now() - 2 * 60 * 60 * 1000) })
      .where(eq(swapOrders.id, orderId));
    chainTx = null;
    matchingTxs = [];
    await tracking.tick();

    const [order] = await db.select().from(swapOrders).where(eq(swapOrders.id, orderId));
    expect(order.status).toBe('SUBMITTED');
    expect(order.errors).toContain('SWAP_REPLACEMENT_NOT_FOUND');
  }, 60_000);

  it('records an anomaly instead of adopting an ambiguous replacement', async () => {
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
    await agent
      .post(`/api/v1/swap/orders/${orderId}/submitted`)
      .set('x-csrf-token', owner.csrf)
      .send({ txHash: `0x${'1'.repeat(64)}` })
      .expect(200);

    chainTx = null;
    matchingTxs = [
      {
        hash: `0x${'2'.repeat(64)}`,
        from: wallet,
        to: router,
        input: built.body.calldata as string,
        value: '0x0',
        nonce: 8,
        blockNumber: 100,
      },
      {
        hash: `0x${'3'.repeat(64)}`,
        from: wallet,
        to: router,
        input: built.body.calldata as string,
        value: '0x0',
        nonce: 9,
        blockNumber: 101,
      },
    ];
    await tracking.tick();

    const [order] = await db.select().from(swapOrders).where(eq(swapOrders.id, orderId));
    expect(order.status).toBe('SUBMITTED');
    expect(order.errors).toContain('SWAP_REPLACEMENT_AMBIGUOUS');
  }, 60_000);

  it('keeps an order active while a mismatched replacement is unconfirmed', async () => {
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
      .send({ txHash: `0x${'4'.repeat(64)}` })
      .expect(200);

    await db.update(swapOrders).set({ nonce: 7 }).where(eq(swapOrders.id, orderId));
    latestNonce = 8;
    latestBlock = 105;
    chainTx = null;
    chainReceipt = null;
    replacementTx = {
      hash: `0x${'5'.repeat(64)}`,
      from: wallet,
      to: router,
      input: makeBuildData({ amount: 2_000_000_000_000_000_000n }),
      value: '0x0',
      nonce: 7,
      blockNumber: 100,
    };
    await tracking.tick();

    const [order] = await db.select().from(swapOrders).where(eq(swapOrders.id, orderId));
    expect(order.status).toBe('SUBMITTED');
    expect(order.errors).toContain('SWAP_REPLACEMENT_PENDING');

    chainReceipt = {
      status: true,
      blockNumber: 100,
      blockHash: `0x${'6'.repeat(64)}`,
      transactionHash: `0x${'5'.repeat(64)}`,
      gasUsed: '100000',
      effectiveGasPrice: '0x3b9aca00',
      logs: [],
    };
    latestBlock = 114;
    await tracking.tick();

    const [replaced] = await db.select().from(swapOrders).where(eq(swapOrders.id, orderId));
    expect(replaced.status).toBe('REPLACED');
    expect(replaced.errors).not.toContain('SWAP_REPLACEMENT_PENDING');
  }, 60_000);

  it('does not adopt a different-nonce transaction when the stored nonce is known', async () => {
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
    const originalHash = `0x${'e'.repeat(64)}`;
    await agent
      .post(`/api/v1/swap/orders/${orderId}/submitted`)
      .set('x-csrf-token', owner.csrf)
      .send({ txHash: originalHash })
      .expect(200);

    await db.update(swapOrders).set({ nonce: 7 }).where(eq(swapOrders.id, orderId));
    latestNonce = 8;
    chainTx = null;
    replacementTx = null;
    matchingTxs = [
      {
        hash: `0x${'f'.repeat(64)}`,
        from: wallet,
        to: router,
        input: built.body.calldata as string,
        value: '0x0',
        nonce: 9,
        blockNumber: 100,
      },
    ];
    await tracking.tick();

    const [order] = await db.select().from(swapOrders).where(eq(swapOrders.id, orderId));
    expect(order.status).toBe('SUBMITTED');
    expect(order.txHash).toBe(originalHash);
    expect(order.errors).toContain('SWAP_REPLACEMENT_NOT_FOUND');
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
    replacementTx = {
      hash: `0x${'8'.repeat(64)}`,
      from: wallet,
      to: router,
      input: makeBuildData({ amount: 2_000_000_000_000_000_000n }),
      value: '0x0',
      nonce: 7,
      blockNumber: 100,
    };
    chainReceipt = {
      status: true,
      blockNumber: 100,
      blockHash: `0x${'9'.repeat(64)}`,
      transactionHash: `0x${'8'.repeat(64)}`,
      gasUsed: '100000',
      effectiveGasPrice: '0x3b9aca00',
      logs: [],
    };
    await tracking.tick();

    const [order] = await db.select().from(swapOrders).where(eq(swapOrders.id, orderId));
    expect(order).toMatchObject({ status: 'REPLACED', accountingTransactionId: null });
  }, 60_000);

  it('adopts a same-nonce speed-up replacement', async () => {
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
    const originalHash = `0x${'6'.repeat(64)}`;
    const replacementHash = `0x${'7'.repeat(64)}`;
    await agent
      .post(`/api/v1/swap/orders/${orderId}/submitted`)
      .set('x-csrf-token', owner.csrf)
      .send({ txHash: originalHash })
      .expect(200);

    await db.update(swapOrders).set({ nonce: 7 }).where(eq(swapOrders.id, orderId));
    chainTx = null;
    latestNonce = 8;
    replacementTx = {
      hash: replacementHash,
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
      blockHash: `0x${'9'.repeat(64)}`,
      transactionHash: replacementHash,
      gasUsed: '100000',
      effectiveGasPrice: '0x3b9aca00',
      logs: [],
    };
    latestBlock = 114;
    await tracking.tick();

    const [order] = await db.select().from(swapOrders).where(eq(swapOrders.id, orderId));
    expect(order).toMatchObject({
      status: 'CONFIRMED',
      txHash: replacementHash,
      accountingTransactionId: null,
    });
    const events = await db.select().from(swapEvents).where(eq(swapEvents.orderId, orderId));
    expect(events.some((event) => event.type === 'replacement_adopted')).toBe(true);
  }, 60_000);

  it('re-decodes stored calldata before ready', async () => {
    const agent = request.agent(app.getHttpServer());
    const owner = await setupOwner(agent);
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
        calldata: makeBuildData({
          recipient: '0x3333333333333333333333333333333333333333',
        }),
      })
      .where(eq(swapOrders.id, orderId));

    const ready = await agent
      .post(`/api/v1/swap/orders/${orderId}/ready`)
      .set('x-csrf-token', owner.csrf)
      .expect(400);
    expect(ready.body.error).toMatchObject({
      code: 'SWAP_VALIDATION_FAILED',
      details: { reason: 'SWAP_RECIPIENT_MISMATCH' },
    });
  }, 60_000);

  it('rejects ready when the selector allowlist changed after build', async () => {
    const agent = request.agent(app.getHttpServer());
    const owner = await setupOwner(agent);
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

    env.SWAP_SELECTOR_ALLOWLIST = '0x59e50fed';
    const ready = await agent
      .post(`/api/v1/swap/orders/${orderId}/ready`)
      .set('x-csrf-token', owner.csrf)
      .expect(400);
    expect(ready.body.error.code).toBe('SWAP_SELECTOR_NOT_ALLOWED');
  }, 60_000);

  it('rejects ready when stored minOut exceeds the built output', async () => {
    const agent = request.agent(app.getHttpServer());
    const owner = await setupOwner(agent);
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
      .set({ calldata: makeBuildData({ minOut: 2_000_000_000_000_000_001n }) })
      .where(eq(swapOrders.id, orderId));

    const ready = await agent
      .post(`/api/v1/swap/orders/${orderId}/ready`)
      .set('x-csrf-token', owner.csrf)
      .expect(400);
    expect(ready.body.error).toMatchObject({
      code: 'SWAP_VALIDATION_FAILED',
      details: { reason: 'SWAP_MIN_OUT_MISMATCH' },
    });
  }, 60_000);

  it('persists the built output bound for ready', async () => {
    const agent = request.agent(app.getHttpServer());
    const owner = await setupOwner(agent);
    const quoted = await agent
      .post('/api/v1/swap/quote')
      .set('x-csrf-token', owner.csrf)
      .send({ chain: 'bsc', tokenIn, tokenOut, amountIn: '1', walletAddress: wallet })
      .expect(201);
    const orderId = quoted.body.id as string;
    buildAmountOut = '2010000000000000000';
    await agent
      .post('/api/v1/swap/build')
      .set('x-csrf-token', owner.csrf)
      .send({ orderId, walletAddress: wallet })
      .expect(201);

    const [order] = await db.select().from(swapOrders).where(eq(swapOrders.id, orderId));
    expect(order.builtAmountOut).toBe('2010000000000000000');
  }, 60_000);

  it('falls back to the quote output bound for legacy orders', async () => {
    const agent = request.agent(app.getHttpServer());
    const owner = await setupOwner(agent);
    const quoted = await agent
      .post('/api/v1/swap/quote')
      .set('x-csrf-token', owner.csrf)
      .send({ chain: 'bsc', tokenIn, tokenOut, amountIn: '1', walletAddress: wallet })
      .expect(201);
    const orderId = quoted.body.id as string;
    buildAmountOut = '2010000000000000000';
    await agent
      .post('/api/v1/swap/build')
      .set('x-csrf-token', owner.csrf)
      .send({ orderId, walletAddress: wallet })
      .expect(201);

    await db
      .update(swapOrders)
      .set({
        builtAmountOut: null,
        calldata: makeBuildData({ minOut: 2_005_000_000_000_000_000n }),
      })
      .where(eq(swapOrders.id, orderId));

    const ready = await agent
      .post(`/api/v1/swap/orders/${orderId}/ready`)
      .set('x-csrf-token', owner.csrf)
      .expect(400);
    expect(ready.body.error).toMatchObject({
      code: 'SWAP_VALIDATION_FAILED',
      details: { reason: 'SWAP_MIN_OUT_MISMATCH' },
    });
  }, 60_000);

  it('fails ready when no gas estimate is available', async () => {
    const agent = request.agent(app.getHttpServer());
    const owner = await setupOwner(agent);
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

    await db.update(swapOrders).set({ gasEstimate: null }).where(eq(swapOrders.id, orderId));
    simulationGasEstimate = null;
    const ready = await agent
      .post(`/api/v1/swap/orders/${orderId}/ready`)
      .set('x-csrf-token', owner.csrf)
      .expect(400);
    expect(ready.body.error.code).toBe('SWAP_GAS_MISSING');
  }, 60_000);

  it('re-checks the selector allowlist at signing', async () => {
    const agent = request.agent(app.getHttpServer());
    const owner = await setupOwner(agent);
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
      .post(`/api/v1/swap/orders/${orderId}/ready`)
      .set('x-csrf-token', owner.csrf)
      .expect(200);

    env.SWAP_SELECTOR_ALLOWLIST = '0x59e50fed';
    const signing = await agent
      .post(`/api/v1/swap/orders/${orderId}/signing`)
      .set('x-csrf-token', owner.csrf)
      .expect(400);
    expect(signing.body.error.code).toBe('SWAP_SELECTOR_NOT_ALLOWED');

    env.SWAP_SELECTOR_ALLOWLIST = selectorAllowlist;
    env.SWAP_EXECUTOR_ALLOWLIST = '0x3333333333333333333333333333333333333333';
    const executorSigning = await agent
      .post(`/api/v1/swap/orders/${orderId}/signing`)
      .set('x-csrf-token', owner.csrf)
      .expect(400);
    expect(executorSigning.body.error.code).toBe('SWAP_EXECUTOR_NOT_ALLOWED');
  }, 60_000);

  it('requires ready before signing', async () => {
    const agent = request.agent(app.getHttpServer());
    const owner = await setupOwner(agent);
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
      .post(`/api/v1/swap/orders/${orderId}/signing`)
      .set('x-csrf-token', owner.csrf)
      .expect(409);
    await agent
      .post(`/api/v1/swap/orders/${orderId}/ready`)
      .set('x-csrf-token', owner.csrf)
      .expect(200);
    const signing = await agent
      .post(`/api/v1/swap/orders/${orderId}/signing`)
      .set('x-csrf-token', owner.csrf)
      .expect(200);
    expect(signing.body.status).toBe('AWAITING_SIGNATURE');
  }, 60_000);

  it('rejects build when native balance cannot cover gas', async () => {
    const agent = request.agent(app.getHttpServer());
    const owner = await setupOwner(agent);
    const quoted = await agent
      .post('/api/v1/swap/quote')
      .set('x-csrf-token', owner.csrf)
      .send({ chain: 'bsc', tokenIn, tokenOut, amountIn: '1', walletAddress: wallet })
      .expect(201);
    nativeBalance = '1';
    const built = await agent
      .post('/api/v1/swap/build')
      .set('x-csrf-token', owner.csrf)
      .send({ orderId: quoted.body.id, walletAddress: wallet })
      .expect(400);
    expect(built.body.error.code).toBe('SWAP_INSUFFICIENT_GAS_BALANCE');
    const [failedOrder] = await db
      .select()
      .from(swapOrders)
      .where(eq(swapOrders.id, quoted.body.id));
    expect(failedOrder.errors).toContain('SWAP_INSUFFICIENT_GAS_BALANCE');
    const failedEvents = await db
      .select()
      .from(swapEvents)
      .where(eq(swapEvents.orderId, quoted.body.id));
    expect(failedEvents.some((event) => event.type === 'build_failed')).toBe(true);
    nativeBalance = '1000000000000000000';
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
        txHash: `0x${'d'.repeat(64)}`,
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
      transactionHash: `0x${'d'.repeat(64)}`,
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

  it('returns a confirmed order to pending after repeated missing receipts', async () => {
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

    await db
      .update(swapOrders)
      .set({
        status: 'CONFIRMED',
        txHash: `0x${'e'.repeat(64)}`,
        submittedAt: new Date(),
        confirmedAt: new Date(),
        blockNumber: 100,
        confirmations: 15,
        networkFeeWei: '100000000000000',
        networkFeeUsd: '0.04166667',
      })
      .where(eq(swapOrders.id, orderId));

    chainReceipt = null;
    latestBlock = 114;

    for (let attempt = 0; attempt < 2; attempt += 1) {
      await tracking.tick();
      const [current] = await db.select().from(swapOrders).where(eq(swapOrders.id, orderId));
      expect(current.status).toBe('CONFIRMED');
      expect(
        current.errors.some((code) => code.startsWith('SWAP_ACCOUNTING_RECEIPT_MISSING')),
      ).toBe(true);
      await db
        .update(swapOrders)
        .set({ updatedAt: new Date(Date.now() - 61_000) })
        .where(eq(swapOrders.id, orderId));
    }

    await tracking.tick();

    const [order] = await db.select().from(swapOrders).where(eq(swapOrders.id, orderId));
    expect(order).toMatchObject({
      status: 'PENDING',
      confirmedAt: null,
      accountingTransactionId: null,
    });
    const events = await db.select().from(swapEvents).where(eq(swapEvents.orderId, orderId));
    expect(
      events.some(
        (event) =>
          event.type === 'reorg' &&
          (event.payload as { reason?: string }).reason === 'receipt_missing_after_retries',
      ),
    ).toBe(true);

    chainTx = {
      hash: order.txHash as string,
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
      transactionHash: order.txHash as string,
      gasUsed: '100000',
      effectiveGasPrice: '0x3b9aca00',
      logs: [],
    };
    latestBlock = 114;
    await tracking.tick();

    const [recovered] = await db.select().from(swapOrders).where(eq(swapOrders.id, orderId));
    expect(recovered.status).toBe('CONFIRMED');
    expect(recovered.confirmations).toBe(15);
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
      transactionHash: txHash,
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

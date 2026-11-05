import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { and, desc, eq, gt, inArray, lt, lte, ne, or } from 'drizzle-orm';
import { swapEvents, swapOrders, type Database, type SwapOrder } from '@nexter/db';
import type {
  SwapBuildRequest,
  SwapBuildResponse,
  SwapConfigResponse,
  SwapOrderDetail,
  SwapOrderSummary,
  SwapOrdersQuery,
  SwapOrdersResponse,
  SwapQuoteRequest,
  SwapSubmitRequest,
  SwapToken,
} from '@nexter/contracts';
import type { AuthContext } from '../auth/auth.types';
import { AccountsService } from '../accounting/accounts.service';
import { AuditService } from '../../shared/audit/audit.service';
import { env } from '../../shared/config/env';
import { DB } from '../../shared/db/db.module';
import { Decimal, decimal } from '../../shared/money/decimal';
import { decodeCursor, encodeCursor, isUuid, makePage } from '../../shared/pagination/cursor';
import { BscRpcService } from './bsc-rpc.service';
import {
  KYBER_SUPPORTED_SELECTORS,
  KyberCalldataError,
  decodeKyberSwapCalldata,
  validateKyberSwapBuild,
  type DecodedKyberSwap,
} from './kyber-calldata';
import { assertStepUp, normalizeUsd } from './swap-step-up';
import { KyberApiError, KyberSwapClient } from './kyber-swap.client';
import {
  DEFAULT_BSC_EXECUTOR,
  DEFAULT_BSC_ROUTER,
  SWAP_CHAINS,
  getSwapChain,
  getSwapToken,
  isCashEquivalentSymbol,
  isNativeToken,
  parseAddressList,
} from './token-registry';

interface SwapMeta {
  ip?: string;
  userAgent?: string;
}

const MAX_CALLDATA_LENGTH = 200_000;

function toBaseUnits(amount: string, decimals: number): string {
  const value = decimal(amount);

  if (value.gte(new Decimal(10).pow(18))) {
    throw new BadRequestException({
      code: 'VALIDATION_ERROR',
      message: 'amount is too large',
    });
  }

  const scaled = value.mul(new Decimal(10).pow(decimals));

  if (!scaled.isInteger()) {
    throw new BadRequestException({
      code: 'VALIDATION_ERROR',
      message: `amount supports at most ${decimals} decimal places`,
    });
  }

  return scaled.toFixed(0);
}

function fromBaseUnits(value: string, decimals: number): string {
  return new Decimal(value).div(new Decimal(10).pow(decimals)).toFixed(decimals);
}

function fractionToPriceImpactBps(value: string | null): number | null {
  if (value === null) return null;

  try {
    const parsed = decimal(value);

    if (!parsed.isFinite() || parsed.lt(0)) return null;

    // Kyber routeSummary.priceImpact is a fraction (0.0015 = 0.15%).
    return Math.min(100_000, parsed.mul(10_000).toDecimalPlaces(0).toNumber());
  } catch {
    return null;
  }
}

function usdToPriceImpactBps(
  amountInUsd: string | null,
  amountOutUsd: string | null,
): number | null {
  if (amountInUsd === null || amountOutUsd === null) return null;

  try {
    const input = decimal(amountInUsd);
    const output = decimal(amountOutUsd);

    if (input.lte(0) || output.lt(0)) return null;

    const difference = input.minus(output);
    if (difference.lte(0)) return 0;

    return Math.min(100_000, difference.div(input).mul(10_000).toDecimalPlaces(0).toNumber());
  } catch {
    return null;
  }
}

function normalizeAddress(value: string): string {
  return value.toLowerCase();
}

function routerAllowlist(): string[] {
  const configured = parseAddressList(env.SWAP_ROUTER_ALLOWLIST);
  return configured.length > 0 ? configured : [DEFAULT_BSC_ROUTER.toLowerCase()];
}

function selectorAllowlist(): string[] {
  return (env.SWAP_SELECTOR_ALLOWLIST ?? '')
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
}

function executorAllowlist(): string[] {
  const configured = parseAddressList(env.SWAP_EXECUTOR_ALLOWLIST);
  return configured.length > 0 ? configured : [DEFAULT_BSC_EXECUTOR.toLowerCase()];
}

function tokenFor(address: string, chain: string, symbol: string): SwapToken {
  return (
    getSwapToken(chain, address) ?? {
      symbol,
      name: symbol,
      address,
      decimals: 18,
      native: isNativeToken(address),
    }
  );
}

@Injectable()
export class SwapService {
  private readonly logger = new Logger(SwapService.name);

  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly kyber: KyberSwapClient,
    private readonly rpc: BscRpcService,
    private readonly audit: AuditService,
    private readonly accounts: AccountsService,
  ) {}

  config(): SwapConfigResponse {
    const allowlist = parseAddressList(env.SWAP_WALLET_ALLOWLIST);
    const selectors = selectorAllowlist();
    const enabled = env.SWAP_ENABLED && !env.SWAP_KILL_SWITCH;

    return {
      enabled,
      killSwitch: env.SWAP_KILL_SWITCH,
      providerConfigured: this.kyber.configured,
      providerMode: this.kyber.mode,
      walletConnectProjectId: env.WALLETCONNECT_PROJECT_ID ?? null,
      buildEnabled:
        enabled &&
        allowlist.length > 0 &&
        selectors.some((item) => KYBER_SUPPORTED_SELECTORS.includes(item)),
      executionEnabled: env.SWAP_EXECUTION_ENABLED && enabled,
      rpcConfigured: this.rpc.configured,
      walletAllowlistConfigured: allowlist.length > 0,
      chains: SWAP_CHAINS,
      quoteTtlSeconds: env.SWAP_QUOTE_TTL_SECONDS,
      maxPriceImpactBps: env.SWAP_MAX_PRICE_IMPACT_BPS,
      stepUpThresholdUsd: env.SWAP_STEP_UP_THRESHOLD_USD.toFixed(2),
      defaultSlippageBps: env.SWAP_DEFAULT_SLIPPAGE_BPS,
      maxSlippageBps: env.SWAP_MAX_SLIPPAGE_BPS,
    };
  }

  async quote(userId: string, input: SwapQuoteRequest, meta: SwapMeta): Promise<SwapOrderDetail> {
    this.assertEnabled();

    const chain = getSwapChain(input.chain);
    if (!chain) {
      throw new BadRequestException({
        code: 'SWAP_CHAIN_UNSUPPORTED',
        message: 'This chain is not enabled for swaps',
      });
    }

    const tokenIn = getSwapToken(input.chain, input.tokenIn);
    const tokenOut = getSwapToken(input.chain, input.tokenOut);

    if (!tokenIn || !tokenOut) {
      throw new BadRequestException({
        code: 'SWAP_TOKEN_NOT_ALLOWED',
        message: 'One or both tokens are not in the allowlist',
      });
    }

    this.assertWallet(input.walletAddress);

    if (input.accountId) {
      await this.accounts.requireWalletForChain(userId, input.accountId, input.chain);
    }

    const slippageBps = input.slippageBps ?? env.SWAP_DEFAULT_SLIPPAGE_BPS;
    if (slippageBps > env.SWAP_MAX_SLIPPAGE_BPS) {
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: `slippageBps must be at most ${env.SWAP_MAX_SLIPPAGE_BPS}`,
      });
    }

    const amountInBase = toBaseUnits(input.amountIn, tokenIn.decimals);

    let route;

    try {
      route = await this.kyber.getRoutes({
        chain: input.chain,
        tokenIn: tokenIn.address,
        tokenOut: tokenOut.address,
        amountInBase,
        walletAddress: input.walletAddress,
        slippageBps,
      });
    } catch (error) {
      throw this.providerError(error, 'SWAP_QUOTE_FAILED');
    }

    if (route.amountIn !== amountInBase) {
      throw new BadRequestException({
        code: 'SWAP_VALIDATION_FAILED',
        message: 'Provider amountIn does not match the requested amount',
      });
    }

    const amountOutBase = route.amountOut;
    if (!/^\d+$/.test(amountOutBase) || amountOutBase.length > 36 || BigInt(amountOutBase) <= 0n) {
      throw new BadRequestException({
        code: 'SWAP_VALIDATION_FAILED',
        message: 'Provider returned an invalid output amount',
      });
    }

    if (!/^0x[0-9a-fA-F]{40}$/.test(route.routerAddress)) {
      throw new BadRequestException({
        code: 'SWAP_VALIDATION_FAILED',
        message: 'Provider returned an invalid router address',
      });
    }

    const routeIn = route.routeSummary.tokenIn;
    const routeOut = route.routeSummary.tokenOut;

    if (
      typeof routeIn !== 'string' ||
      normalizeAddress(routeIn) !== normalizeAddress(tokenIn.address)
    ) {
      throw new BadRequestException({
        code: 'SWAP_VALIDATION_FAILED',
        message: 'Provider route tokenIn does not match the request',
      });
    }

    if (
      typeof routeOut !== 'string' ||
      normalizeAddress(routeOut) !== normalizeAddress(tokenOut.address)
    ) {
      throw new BadRequestException({
        code: 'SWAP_VALIDATION_FAILED',
        message: 'Provider route tokenOut does not match the request',
      });
    }

    const amountInUsd = normalizeUsd(route.amountInUsd);
    if (!amountInUsd) {
      throw new BadRequestException({
        code: 'SWAP_VALIDATION_FAILED',
        message: 'Provider did not return a valid input USD value',
      });
    }
    const amountOutUsd = normalizeUsd(route.amountOutUsd);

    if (!amountOutUsd && !isCashEquivalentSymbol(tokenOut.symbol)) {
      throw new BadRequestException({
        code: 'SWAP_VALIDATION_FAILED',
        message: 'Provider did not return a valid output USD value',
        details: { reason: 'SWAP_OUTPUT_USD_MISSING' },
      });
    }

    const providerImpactBps = fractionToPriceImpactBps(route.priceImpact);
    const usdImpactBps = usdToPriceImpactBps(amountInUsd, amountOutUsd);
    const priceImpactBps =
      providerImpactBps === null
        ? usdImpactBps
        : usdImpactBps === null
          ? providerImpactBps
          : Math.max(providerImpactBps, usdImpactBps);

    if (priceImpactBps === null) {
      throw new BadRequestException({
        code: 'SWAP_VALIDATION_FAILED',
        message: 'Provider did not return enough data to validate price impact',
      });
    }

    if (priceImpactBps > env.SWAP_MAX_PRICE_IMPACT_BPS) {
      throw new BadRequestException({
        code: 'SWAP_PRICE_IMPACT_TOO_HIGH',
        message: `Price impact ${(priceImpactBps / 100).toFixed(2)}% exceeds the configured limit`,
      });
    }

    const warnings: string[] = [];

    const minOutBase = (BigInt(amountOutBase) * BigInt(10_000 - slippageBps)) / BigInt(10_000);
    const quoteExpiresAt = new Date(Date.now() + env.SWAP_QUOTE_TTL_SECONDS * 1000);
    const routeIdValue =
      typeof route.routeSummary.routeID === 'string'
        ? route.routeSummary.routeID
        : typeof route.routeSummary.routeId === 'string'
          ? route.routeSummary.routeId
          : null;
    const routeId = routeIdValue ? routeIdValue.slice(0, 200) : null;
    const gasUsd =
      route.gasUsd && /^\d+(?:\.\d+)?$/.test(route.gasUsd) && route.gasUsd.length <= 32
        ? route.gasUsd
        : null;

    const order = await this.db.transaction(async (tx) => {
      const [created] = await tx
        .insert(swapOrders)
        .values({
          userId,
          accountId: input.accountId ?? null,
          chain: input.chain,
          walletAddress: input.walletAddress ? normalizeAddress(input.walletAddress) : null,
          tokenIn: normalizeAddress(tokenIn.address),
          tokenOut: normalizeAddress(tokenOut.address),
          tokenInSymbol: tokenIn.symbol,
          tokenOutSymbol: tokenOut.symbol,
          amountIn: input.amountIn,
          amountInUsd,
          amountOut: fromBaseUnits(amountOutBase, tokenOut.decimals),
          minOut: fromBaseUnits(minOutBase.toString(), tokenOut.decimals),
          slippageBps,
          priceImpactBps,
          routeId,
          routeSummary: route.routeSummary,
          routerAddress: normalizeAddress(route.routerAddress),
          gasUsd,
          status: 'QUOTED',
          quoteExpiresAt,
        })
        .returning();

      if (!created) throw new Error('Failed to create swap quote');

      await tx.insert(swapEvents).values({
        orderId: created.id,
        type: 'quote_created',
        payload: {
          quoteExpiresAt: quoteExpiresAt.toISOString(),
          priceImpactBps,
          warnings,
        },
      });

      await this.audit.log(
        {
          userId,
          action: 'swap.quote_created',
          entityType: 'swap_order',
          entityId: created.id,
          after: {
            chain: input.chain,
            tokenIn: tokenIn.symbol,
            tokenOut: tokenOut.symbol,
            amountIn: input.amountIn,
            amountOut: created.amountOut,
            status: 'QUOTED',
          },
          ip: meta.ip,
          userAgent: meta.userAgent,
        },
        { executor: tx, strict: true },
      );

      return created;
    });

    return this.detail(userId, order.id, warnings);
  }

  async build(
    auth: AuthContext,
    input: SwapBuildRequest,
    meta: SwapMeta,
  ): Promise<SwapBuildResponse> {
    const userId = auth.user.id;
    this.assertEnabled();
    this.assertWallet(input.walletAddress, true);

    const order = await this.requireOrder(userId, input.orderId);
    await this.expireIfNeeded(order);

    if (order.status !== 'QUOTED') {
      throw new ConflictException({
        code: 'SWAP_STATE_INVALID',
        message: `Swap order is ${order.status}`,
      });
    }

    assertStepUp(auth, order);

    const selectors = selectorAllowlist();
    if (selectors.length === 0) {
      throw new ServiceUnavailableException({
        code: 'SWAP_SELECTOR_NOT_CONFIGURED',
        message: 'Swap calldata selector allowlist is not configured',
      });
    }

    const wallet = normalizeAddress(input.walletAddress);
    const deadline = Math.floor(Date.now() / 1000) + env.SWAP_BUILD_DEADLINE_SECONDS;

    let built;

    try {
      built = await this.kyber.buildRoute({
        chain: order.chain,
        routeSummary: order.routeSummary as Record<string, unknown>,
        sender: wallet,
        recipient: wallet,
        slippageBps: order.slippageBps,
        deadline,
      });
    } catch (error) {
      await this.recordBuildFailure(order, 'SWAP_PROVIDER_ERROR', meta);
      throw this.providerError(error, 'SWAP_BUILD_FAILED');
    }

    const validation: SwapBuildResponse['validation'] = [];
    const fail = async (check: string, code: string, detail: string): Promise<never> => {
      validation.push({ check, passed: false, detail });
      await this.recordBuildFailure(order, code, meta);
      throw new BadRequestException({
        code: 'SWAP_VALIDATION_FAILED',
        message: `${check}: ${detail}`,
        details: { reason: code },
      });
    };
    const pass = (check: string, detail: string | null = null) =>
      validation.push({ check, passed: true, detail });

    if (!routerAllowlist().includes(normalizeAddress(built.routerAddress))) {
      await fail('router', 'SWAP_ROUTER_NOT_ALLOWED', 'Router is not in the allowlist');
    }
    pass('router');

    if (!/^0x[0-9a-fA-F]*$/.test(built.data) || built.data.length < 10) {
      await fail('calldata', 'SWAP_CALLDATA_INVALID', 'Calldata is not valid hex');
    }
    if (built.data.length > MAX_CALLDATA_LENGTH) {
      await fail('calldata-length', 'SWAP_CALLDATA_TOO_LARGE', 'Calldata is too large');
    }
    if (!selectors.includes(built.data.slice(0, 10).toLowerCase())) {
      await fail(
        'selector',
        'SWAP_SELECTOR_NOT_ALLOWED',
        'Calldata selector is not in the allowlist',
      );
    }
    pass('calldata');

    const routeSummary = order.routeSummary as Record<string, unknown>;
    const quotedAmountIn = typeof routeSummary.amountIn === 'string' ? routeSummary.amountIn : null;

    if (!quotedAmountIn || !/^\d+$/.test(quotedAmountIn)) {
      await this.recordBuildFailure(order, 'SWAP_AMOUNT_INVALID', meta);
      throw new BadRequestException({
        code: 'SWAP_VALIDATION_FAILED',
        message: 'Stored route is missing a valid amountIn',
        details: { reason: 'SWAP_AMOUNT_INVALID' },
      });
    }
    if (built.amountIn !== quotedAmountIn) {
      await fail('amountIn', 'SWAP_AMOUNT_MISMATCH', 'Built amountIn does not match the quote');
    }
    pass('amountIn');

    if (!/^\d+$/.test(built.amountOut) || built.amountOut.length > 36) {
      await fail('amountOut', 'SWAP_AMOUNT_INVALID', 'Built amountOut is not a bounded integer');
    }
    if (!/^\d+$/.test(built.transactionValue) || built.transactionValue.length > 78) {
      await fail(
        'transactionValue',
        'SWAP_TX_VALUE_INVALID',
        'Transaction value is not a bounded integer',
      );
    }

    const tokenOut = getSwapToken(order.chain, order.tokenOut);
    const tokenIn = getSwapToken(order.chain, order.tokenIn);

    if (!tokenOut || !tokenIn) {
      await this.recordBuildFailure(order, 'SWAP_TOKEN_NOT_ALLOWED', meta);
      throw new BadRequestException({
        code: 'SWAP_VALIDATION_FAILED',
        message: 'Stored token is not in the current registry',
        details: { reason: 'SWAP_TOKEN_NOT_ALLOWED' },
      });
    }

    const minOutBase = toBaseUnits(order.minOut, tokenOut.decimals);
    if (BigInt(built.amountOut) < BigInt(minOutBase)) {
      await fail('minOut', 'SWAP_MIN_OUT', 'Built output is below the quoted minimum');
    }
    pass('minOut');

    const expectedValue = tokenIn.native ? quotedAmountIn : '0';
    if (BigInt(built.transactionValue) !== BigInt(expectedValue)) {
      await fail(
        'transactionValue',
        'SWAP_TX_VALUE_MISMATCH',
        'Transaction value does not match the expected native amount',
      );
    }
    pass('transactionValue');

    const decoded = await (async (): Promise<DecodedKyberSwap> => {
      try {
        return await decodeKyberSwapCalldata(built.data);
      } catch (error) {
        const code = error instanceof KyberCalldataError ? error.code : 'SWAP_CALLDATA_INVALID';
        return await fail(
          'calldata-decode',
          code,
          'Calldata could not be decoded against the Kyber router ABI',
        );
      }
    })();
    pass('calldata-decode');

    const calldataValidation = validateKyberSwapBuild(decoded, {
      wallet,
      tokenIn: tokenIn.address,
      tokenOut: tokenOut.address,
      nativeIn: tokenIn.native,
      amountInBase: quotedAmountIn,
      minOutBase: minOutBase.toString(),
      quotedAmountOut: built.amountOut,
      routerAddress: built.routerAddress,
      executorAllowlist: executorAllowlist(),
      deadline,
    });

    for (const item of calldataValidation.issues) {
      await fail(item.check, item.code, item.detail);
    }

    for (const check of calldataValidation.passedChecks) {
      pass(check);
    }

    pass(
      'calldata.deadline',
      calldataValidation.deadlineSource === 'server' ? 'server-enforced (nested route)' : null,
    );

    let balance: string | null;

    try {
      balance = tokenIn.native
        ? await this.rpc.getNativeBalance(wallet)
        : await this.rpc.getErc20Balance(tokenIn.address, wallet);
    } catch {
      await this.recordBuildFailure(order, 'SWAP_RPC_UNAVAILABLE', meta);
      throw new ServiceUnavailableException({
        code: 'SWAP_PROVIDER_UNAVAILABLE',
        message: 'BSC RPC is unavailable',
      });
    }

    if (balance === null) {
      await this.recordBuildFailure(order, 'SWAP_RPC_UNAVAILABLE', meta);
      throw new ServiceUnavailableException({
        code: 'SWAP_PROVIDER_UNAVAILABLE',
        message: 'BSC RPC is unavailable',
      });
    }

    if (BigInt(balance) < BigInt(quotedAmountIn)) {
      await this.recordBuildFailure(order, 'SWAP_INSUFFICIENT_BALANCE', meta);
      throw new BadRequestException({
        code: 'SWAP_INSUFFICIENT_BALANCE',
        message: 'Wallet balance is below the input amount',
      });
    }
    pass('balance');

    let allowance: string | null = null;
    let approvalRequired = false;

    if (!tokenIn.native) {
      try {
        allowance = await this.rpc.getErc20Allowance(tokenIn.address, wallet, built.routerAddress);
      } catch {
        await this.recordBuildFailure(order, 'SWAP_RPC_UNAVAILABLE', meta);
        throw new ServiceUnavailableException({
          code: 'SWAP_PROVIDER_UNAVAILABLE',
          message: 'BSC RPC is unavailable',
        });
      }

      if (allowance === null) {
        await this.recordBuildFailure(order, 'SWAP_RPC_UNAVAILABLE', meta);
        throw new ServiceUnavailableException({
          code: 'SWAP_PROVIDER_UNAVAILABLE',
          message: 'BSC RPC is unavailable',
        });
      }

      approvalRequired = BigInt(allowance) < BigInt(quotedAmountIn);

      if (approvalRequired) {
        validation.push({ check: 'allowance', passed: false, detail: 'approval required' });
        validation.push({
          check: 'simulation',
          passed: false,
          detail: 'skipped until approval',
        });
      } else {
        pass('allowance');
      }
    } else {
      pass('allowance', 'native input');
    }

    let simulation: Awaited<ReturnType<BscRpcService['simulate']>> | null = null;

    if (!approvalRequired) {
      try {
        simulation = await this.rpc.simulate({
          from: wallet,
          to: built.routerAddress,
          data: built.data,
          value: built.transactionValue,
        });
      } catch {
        await this.recordBuildFailure(order, 'SWAP_RPC_UNAVAILABLE', meta);
        throw new ServiceUnavailableException({
          code: 'SWAP_PROVIDER_UNAVAILABLE',
          message: 'BSC RPC is unavailable',
        });
      }

      if (!simulation.success) {
        await this.recordBuildFailure(order, 'SWAP_SIMULATION_FAILED', meta);
        throw new BadRequestException({
          code: 'SWAP_SIMULATION_FAILED',
          message: 'Swap simulation failed',
          details: { revertReason: simulation.revertReason },
        });
      }

      validation.push({ check: 'simulation', passed: true, detail: null });
    }

    const gasEstimate = built.gas ?? simulation?.gasEstimate ?? null;
    if (gasEstimate && (!/^\d+$/.test(gasEstimate) || gasEstimate.length > 24)) {
      await fail('gas', 'SWAP_GAS_INVALID', 'Gas estimate is not a bounded integer');
    }

    const gasUsd =
      built.gasUsd && /^\d+(?:\.\d+)?$/.test(built.gasUsd) && built.gasUsd.length <= 32
        ? built.gasUsd
        : order.gasUsd;

    if (order.quoteExpiresAt.getTime() <= Date.now()) {
      await this.expireIfNeeded(order);
      throw new ConflictException({
        code: 'SWAP_STATE_INVALID',
        message: 'Swap quote expired during build',
      });
    }

    const builtStatus = approvalRequired ? 'APPROVAL_REQUIRED' : 'BUILT';

    const updated = await this.db.transaction(async (tx) => {
      const [row] = await tx
        .update(swapOrders)
        .set({
          walletAddress: wallet,
          routerAddress: normalizeAddress(built.routerAddress),
          calldata: built.data,
          transactionValue: built.transactionValue,
          gasEstimate,
          gasUsd,
          deadline,
          status: builtStatus,
          errors: [],
          builtAt: new Date(),
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(swapOrders.id, order.id),
            eq(swapOrders.userId, userId),
            eq(swapOrders.status, 'QUOTED'),
            gt(swapOrders.quoteExpiresAt, new Date()),
          ),
        )
        .returning();

      if (!row) {
        throw new ConflictException({
          code: 'SWAP_STATE_INVALID',
          message: 'Swap order is no longer buildable',
        });
      }

      await tx.insert(swapEvents).values({
        orderId: order.id,
        type: 'built',
        payload: {
          routerAddress: row.routerAddress,
          gasEstimate: row.gasEstimate,
          deadline: row.deadline,
          approvalRequired,
          allowance,
          calldata: {
            functionName: decoded.functionName,
            executor: decoded.callTarget,
            recipient: decoded.dstReceiver,
            minReturnAmount: decoded.minReturnAmount,
            deadlineSource: calldataValidation.deadlineSource,
            embeddedDeadline: decoded.simpleDeadline,
          },
          simulation: simulation
            ? { success: true, gasEstimate: simulation.gasEstimate }
            : { success: false, skipped: true, reason: 'approval_required' },
        },
      });

      await this.audit.log(
        {
          userId,
          action: 'swap.order_built',
          entityType: 'swap_order',
          entityId: order.id,
          after: {
            routerAddress: row.routerAddress,
            gasEstimate: row.gasEstimate,
            status: builtStatus,
            approvalRequired,
            allowance,
            calldataRecipient: decoded.dstReceiver,
            calldataMinOut: decoded.minReturnAmount,
            deadlineSource: calldataValidation.deadlineSource,
          },
          ip: meta.ip,
          userAgent: meta.userAgent,
        },
        { executor: tx, strict: true },
      );

      return row;
    });

    return {
      ...(await this.detail(userId, updated.id, [])),
      approvalRequired,
      allowance,
      simulation,
      validation,
    };
  }

  async ready(auth: AuthContext, orderId: string, meta: SwapMeta): Promise<SwapBuildResponse> {
    this.assertEnabled();
    const userId = auth.user.id;
    const order = await this.requireOrder(userId, orderId);

    if (!['APPROVAL_REQUIRED', 'BUILT', 'READY'].includes(order.status)) {
      throw new ConflictException({
        code: 'SWAP_STATE_INVALID',
        message: `Swap order is ${order.status}`,
      });
    }

    assertStepUp(auth, order);
    this.assertWallet(order.walletAddress ?? undefined, true);

    if (!order.routerAddress || !routerAllowlist().includes(order.routerAddress.toLowerCase())) {
      throw new BadRequestException({
        code: 'SWAP_ROUTER_NOT_ALLOWED',
        message: 'Router is not in the allowlist',
      });
    }

    if (!order.deadline || order.deadline <= Math.floor(Date.now() / 1000)) {
      throw new ConflictException({
        code: 'SWAP_DEADLINE_PASSED',
        message: 'Swap deadline has passed',
      });
    }

    if (!order.calldata || order.transactionValue === null) {
      throw new ConflictException({
        code: 'SWAP_STATE_INVALID',
        message: 'Swap order has no stored build',
      });
    }

    const tokenIn = getSwapToken(order.chain, order.tokenIn);
    const tokenOut = getSwapToken(order.chain, order.tokenOut);
    const routeSummary = order.routeSummary as Record<string, unknown>;
    const amountIn = typeof routeSummary.amountIn === 'string' ? routeSummary.amountIn : null;

    if (!tokenIn || !tokenOut || !amountIn || !/^\d+$/.test(amountIn)) {
      throw new BadRequestException({
        code: 'SWAP_VALIDATION_FAILED',
        message: 'Stored swap order is incomplete',
      });
    }

    const wallet = order.walletAddress as string;

    let balance: string | null;

    try {
      balance = tokenIn.native
        ? await this.rpc.getNativeBalance(wallet)
        : await this.rpc.getErc20Balance(tokenIn.address, wallet);
    } catch {
      throw new ServiceUnavailableException({
        code: 'SWAP_PROVIDER_UNAVAILABLE',
        message: 'BSC RPC is unavailable',
      });
    }

    if (balance === null) {
      throw new ServiceUnavailableException({
        code: 'SWAP_PROVIDER_UNAVAILABLE',
        message: 'BSC RPC is unavailable',
      });
    }

    if (BigInt(balance) < BigInt(amountIn)) {
      throw new BadRequestException({
        code: 'SWAP_INSUFFICIENT_BALANCE',
        message: 'Wallet balance is below the input amount',
      });
    }

    let allowance: string | null = null;

    if (!tokenIn.native) {
      try {
        allowance = await this.rpc.getErc20Allowance(tokenIn.address, wallet, order.routerAddress);
      } catch {
        throw new ServiceUnavailableException({
          code: 'SWAP_PROVIDER_UNAVAILABLE',
          message: 'BSC RPC is unavailable',
        });
      }

      if (allowance === null) {
        throw new ServiceUnavailableException({
          code: 'SWAP_PROVIDER_UNAVAILABLE',
          message: 'BSC RPC is unavailable',
        });
      }

      if (BigInt(allowance) < BigInt(amountIn)) {
        throw new ConflictException({
          code: 'SWAP_APPROVAL_REQUIRED',
          message: 'Token allowance is still insufficient',
        });
      }
    }

    let simulation: Awaited<ReturnType<BscRpcService['simulate']>>;

    try {
      simulation = await this.rpc.simulate({
        from: wallet,
        to: order.routerAddress,
        data: order.calldata,
        value: order.transactionValue,
      });
    } catch {
      throw new ServiceUnavailableException({
        code: 'SWAP_PROVIDER_UNAVAILABLE',
        message: 'BSC RPC is unavailable',
      });
    }

    if (!simulation.success) {
      throw new BadRequestException({
        code: 'SWAP_SIMULATION_FAILED',
        message: 'Swap simulation failed',
        details: { revertReason: simulation.revertReason },
      });
    }

    const updated = await this.db.transaction(async (tx) => {
      const [row] = await tx
        .update(swapOrders)
        .set({ status: 'READY', updatedAt: new Date() })
        .where(
          and(
            eq(swapOrders.id, order.id),
            eq(swapOrders.userId, userId),
            inArray(swapOrders.status, ['APPROVAL_REQUIRED', 'BUILT', 'READY']),
            gt(swapOrders.deadline, Math.floor(Date.now() / 1000)),
          ),
        )
        .returning();

      if (!row) return null;

      await tx.insert(swapEvents).values({
        orderId: order.id,
        type: 'ready',
        payload: { allowance, simulation: { success: true, gasEstimate: simulation.gasEstimate } },
      });

      await this.audit.log(
        {
          userId,
          action: 'swap.order_ready',
          entityType: 'swap_order',
          entityId: order.id,
          after: { status: 'READY', allowance },
          ip: meta.ip,
          userAgent: meta.userAgent,
        },
        { executor: tx, strict: true },
      );

      return row;
    });

    if (!updated) {
      throw new ConflictException({
        code: 'SWAP_STATE_INVALID',
        message: 'Swap order is no longer ready',
      });
    }

    return {
      ...(await this.detail(userId, updated.id, [])),
      approvalRequired: false,
      allowance,
      simulation,
      validation: [
        { check: 'balance', passed: true, detail: null },
        { check: 'allowance', passed: true, detail: null },
        { check: 'simulation', passed: true, detail: null },
      ],
    };
  }

  async signing(auth: AuthContext, orderId: string, meta: SwapMeta): Promise<SwapOrderDetail> {
    this.assertEnabled();
    this.assertExecutionEnabled();
    const userId = auth.user.id;
    const order = await this.requireOrder(userId, orderId);

    if (!['BUILT', 'READY'].includes(order.status)) {
      throw new ConflictException({
        code: 'SWAP_STATE_INVALID',
        message: `Swap order is ${order.status}`,
      });
    }

    assertStepUp(auth, order);
    this.assertWallet(order.walletAddress ?? undefined, true);

    if (!order.routerAddress || !routerAllowlist().includes(order.routerAddress.toLowerCase())) {
      throw new BadRequestException({
        code: 'SWAP_ROUTER_NOT_ALLOWED',
        message: 'Router is not in the allowlist',
      });
    }

    if (!order.deadline || order.deadline <= Math.floor(Date.now() / 1000)) {
      throw new ConflictException({
        code: 'SWAP_DEADLINE_PASSED',
        message: 'Swap deadline has passed',
      });
    }

    const updated = await this.db.transaction(async (tx) => {
      const [row] = await tx
        .update(swapOrders)
        .set({ status: 'AWAITING_SIGNATURE', updatedAt: new Date() })
        .where(
          and(
            eq(swapOrders.id, order.id),
            eq(swapOrders.userId, userId),
            inArray(swapOrders.status, ['BUILT', 'READY']),
            gt(swapOrders.deadline, Math.floor(Date.now() / 1000)),
          ),
        )
        .returning({ id: swapOrders.id });

      if (!row) return null;

      await tx.insert(swapEvents).values({
        orderId: order.id,
        type: 'signing',
        payload: { walletAddress: order.walletAddress },
      });

      await this.audit.log(
        {
          userId,
          action: 'swap.order_signing',
          entityType: 'swap_order',
          entityId: order.id,
          before: { status: order.status },
          after: { status: 'AWAITING_SIGNATURE' },
          ip: meta.ip,
          userAgent: meta.userAgent,
        },
        { executor: tx, strict: true },
      );

      return row;
    });

    if (!updated) {
      throw new ConflictException({
        code: 'SWAP_STATE_INVALID',
        message: 'Swap order is already being signed or no longer ready',
      });
    }

    return this.detail(userId, orderId, []);
  }

  async cancelSigning(
    auth: AuthContext,
    orderId: string,
    meta: SwapMeta,
  ): Promise<SwapOrderDetail> {
    const userId = auth.user.id;
    const order = await this.requireOrder(userId, orderId);

    if (order.status !== 'AWAITING_SIGNATURE') {
      throw new ConflictException({
        code: 'SWAP_STATE_INVALID',
        message: `Swap order is ${order.status}`,
      });
    }

    const updated = await this.db.transaction(async (tx) => {
      const [row] = await tx
        .update(swapOrders)
        .set({ status: 'READY', updatedAt: new Date() })
        .where(
          and(
            eq(swapOrders.id, order.id),
            eq(swapOrders.userId, userId),
            eq(swapOrders.status, 'AWAITING_SIGNATURE'),
          ),
        )
        .returning({ id: swapOrders.id });

      if (!row) return null;

      await tx.insert(swapEvents).values({
        orderId: order.id,
        type: 'signing_cancelled',
        payload: {},
      });

      await this.audit.log(
        {
          userId,
          action: 'swap.order_signing_cancelled',
          entityType: 'swap_order',
          entityId: order.id,
          before: { status: 'AWAITING_SIGNATURE' },
          after: { status: 'READY' },
          ip: meta.ip,
          userAgent: meta.userAgent,
        },
        { executor: tx, strict: true },
      );

      return row;
    });

    if (!updated) {
      throw new ConflictException({
        code: 'SWAP_STATE_INVALID',
        message: 'Swap order is no longer awaiting signature',
      });
    }

    return this.detail(userId, orderId, []);
  }

  async submit(
    auth: AuthContext,
    orderId: string,
    input: SwapSubmitRequest,
    meta: SwapMeta,
  ): Promise<SwapOrderDetail> {
    this.assertEnabled();
    this.assertExecutionEnabled();
    const userId = auth.user.id;
    const order = await this.requireOrder(userId, orderId);

    if (!['BUILT', 'READY', 'AWAITING_SIGNATURE'].includes(order.status)) {
      throw new ConflictException({
        code: 'SWAP_STATE_INVALID',
        message: `Swap order is ${order.status}`,
      });
    }

    assertStepUp(auth, order);
    this.assertWallet(order.walletAddress ?? undefined, true);

    if (!order.routerAddress || !routerAllowlist().includes(order.routerAddress.toLowerCase())) {
      throw new BadRequestException({
        code: 'SWAP_ROUTER_NOT_ALLOWED',
        message: 'Router is not in the allowlist',
      });
    }

    const now = Math.floor(Date.now() / 1000);

    if (!order.deadline || order.deadline <= now) {
      throw new ConflictException({
        code: 'SWAP_DEADLINE_PASSED',
        message: 'Swap deadline has passed',
      });
    }

    const txHash = input.txHash.toLowerCase();

    try {
      await this.db.transaction(async (tx) => {
        const [row] = await tx
          .update(swapOrders)
          .set({
            status: 'SUBMITTED',
            txHash,
            submittedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(swapOrders.id, orderId),
              eq(swapOrders.userId, userId),
              inArray(swapOrders.status, ['BUILT', 'READY', 'AWAITING_SIGNATURE']),
              gt(swapOrders.deadline, now),
            ),
          )
          .returning({ id: swapOrders.id });

        if (!row) {
          const [current] = await tx
            .select({ deadline: swapOrders.deadline, status: swapOrders.status })
            .from(swapOrders)
            .where(and(eq(swapOrders.id, orderId), eq(swapOrders.userId, userId)))
            .limit(1);

          if (current?.deadline && current.deadline <= now) {
            throw new ConflictException({
              code: 'SWAP_DEADLINE_PASSED',
              message: 'Swap deadline has passed',
            });
          }

          throw new ConflictException({
            code: 'SWAP_STATE_INVALID',
            message: 'Swap order is no longer submittable',
          });
        }

        await tx.insert(swapEvents).values({
          orderId,
          type: 'submitted',
          payload: { txHash },
        });

        await this.audit.log(
          {
            userId,
            action: 'swap.order_submitted',
            entityType: 'swap_order',
            entityId: orderId,
            before: { status: order.status },
            after: { status: 'SUBMITTED', txHash },
            ip: meta.ip,
            userAgent: meta.userAgent,
          },
          { executor: tx, strict: true },
        );
      });
    } catch (error) {
      const candidate =
        typeof error === 'object' && error !== null
          ? (error as { code?: string; cause?: { code?: string } })
          : null;

      if (candidate?.code === '23505' || candidate?.cause?.code === '23505') {
        throw new ConflictException({
          code: 'CONFLICT',
          message: 'Transaction hash is already attached to another swap',
        });
      }
      throw error;
    }

    return this.detail(userId, orderId, []);
  }

  async cancel(userId: string, orderId: string, meta: SwapMeta): Promise<SwapOrderDetail> {
    const order = await this.requireOrder(userId, orderId);

    if (!['QUOTED', 'BUILT', 'APPROVAL_REQUIRED', 'READY'].includes(order.status)) {
      throw new ConflictException({
        code: 'SWAP_STATE_INVALID',
        message: `Swap order is ${order.status}`,
      });
    }

    await this.db.transaction(async (tx) => {
      const [cancelled] = await tx
        .update(swapOrders)
        .set({ status: 'CANCELLED', cancelledAt: new Date(), updatedAt: new Date() })
        .where(
          and(
            eq(swapOrders.id, orderId),
            eq(swapOrders.userId, userId),
            inArray(swapOrders.status, ['QUOTED', 'BUILT', 'APPROVAL_REQUIRED', 'READY']),
          ),
        )
        .returning({ id: swapOrders.id });

      if (!cancelled) {
        throw new ConflictException({
          code: 'SWAP_STATE_INVALID',
          message: 'Swap order is no longer cancellable',
        });
      }

      await tx.insert(swapEvents).values({
        orderId,
        type: 'cancelled',
        payload: { previousStatus: order.status },
      });

      await this.audit.log(
        {
          userId,
          action: 'swap.order_cancelled',
          entityType: 'swap_order',
          entityId: orderId,
          before: { status: order.status },
          after: { status: 'CANCELLED' },
          ip: meta.ip,
          userAgent: meta.userAgent,
        },
        { executor: tx, strict: true },
      );
    });

    return this.detail(userId, orderId, []);
  }

  async list(userId: string, query: SwapOrdersQuery): Promise<SwapOrdersResponse> {
    const conditions = [eq(swapOrders.userId, userId)];

    if (query.status) conditions.push(eq(swapOrders.status, query.status));
    conditions.push(
      or(ne(swapOrders.status, 'QUOTED'), gt(swapOrders.quoteExpiresAt, new Date()))!,
    );
    if (query.cursor) {
      const cursor = decodeCursor<{ createdAt: string; id: string }>(query.cursor);

      if (
        typeof cursor.createdAt !== 'string' ||
        !isUuid(cursor.id) ||
        Number.isNaN(new Date(cursor.createdAt).getTime())
      ) {
        throw new BadRequestException({
          code: 'VALIDATION_ERROR',
          message: 'Invalid pagination cursor',
        });
      }

      const cursorDate = new Date(cursor.createdAt);
      conditions.push(
        or(
          lt(swapOrders.createdAt, cursorDate),
          and(eq(swapOrders.createdAt, cursorDate), lt(swapOrders.id, cursor.id)),
        )!,
      );
    }

    const rows = await this.db
      .select()
      .from(swapOrders)
      .where(and(...conditions))
      .orderBy(desc(swapOrders.createdAt), desc(swapOrders.id))
      .limit(query.limit + 1);
    const page = makePage(rows, query.limit, (row) =>
      encodeCursor({ createdAt: row.createdAt.toISOString(), id: row.id }),
    );

    return {
      data: page.data.map((row) => this.summary(row)),
      page: { nextCursor: page.nextCursor, hasMore: page.hasMore },
    };
  }

  async get(userId: string, orderId: string): Promise<SwapOrderDetail> {
    return this.detail(userId, orderId, []);
  }

  private async detail(
    userId: string,
    orderId: string,
    warnings: string[],
  ): Promise<SwapOrderDetail> {
    const order = await this.requireOrder(userId, orderId);
    await this.expireIfNeeded(order);
    const events = await this.db
      .select()
      .from(swapEvents)
      .where(eq(swapEvents.orderId, orderId))
      .orderBy(swapEvents.createdAt);

    return {
      ...this.summary(order),
      routerAddress: order.routerAddress,
      calldata: order.calldata,
      transactionValue: order.transactionValue,
      gasEstimate: order.gasEstimate,
      errors: [...order.errors, ...warnings],
      events: events.map((event) => ({
        id: event.id,
        type: event.type,
        payload: event.payload,
        createdAt: event.createdAt.toISOString(),
      })),
    };
  }

  private summary(order: SwapOrder): SwapOrderSummary {
    const routeSummary = order.routeSummary as Record<string, unknown>;
    const routeValue = (value: unknown): string | null =>
      typeof value === 'string'
        ? value
        : typeof value === 'number' && Number.isFinite(value)
          ? String(value)
          : null;

    return {
      id: order.id,
      chain: order.chain as 'bsc',
      walletAddress: order.walletAddress,
      accountId: order.accountId,
      tokenIn: tokenFor(order.tokenIn, order.chain, order.tokenInSymbol),
      tokenOut: tokenFor(order.tokenOut, order.chain, order.tokenOutSymbol),
      amountIn: order.amountIn,
      amountOut: order.amountOut,
      executedAmountIn: order.executedAmountIn,
      executedAmountOut: order.executedAmountOut,
      amountInUsd: order.amountInUsd ?? routeValue(routeSummary.amountInUsd),
      amountOutUsd: routeValue(routeSummary.amountOutUsd),
      minOut: order.minOut,
      slippageBps: order.slippageBps,
      priceImpactBps: order.priceImpactBps,
      gasUsd: order.gasUsd,
      routeId: order.routeId,
      status: order.status,
      quoteExpiresAt: order.quoteExpiresAt.toISOString(),
      builtAt: order.builtAt?.toISOString() ?? null,
      deadline: order.deadline,
      submittedAt: order.submittedAt?.toISOString() ?? null,
      confirmedAt: order.confirmedAt?.toISOString() ?? null,
      cancelledAt: order.cancelledAt?.toISOString() ?? null,
      confirmations: order.confirmations,
      txHash: order.txHash,
      blockNumber: order.blockNumber,
      networkFeeWei: order.networkFeeWei,
      networkFeeUsd: order.networkFeeUsd,
      accountingTransactionId: order.accountingTransactionId,
      tradeGroupId: order.tradeGroupId,
      createdAt: order.createdAt.toISOString(),
    };
  }

  private async requireOrder(userId: string, orderId: string): Promise<SwapOrder> {
    const [order] = await this.db
      .select()
      .from(swapOrders)
      .where(and(eq(swapOrders.id, orderId), eq(swapOrders.userId, userId)))
      .limit(1);

    if (!order) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Swap order not found' });
    }

    return order;
  }

  private async expireIfNeeded(order: SwapOrder): Promise<boolean> {
    if (order.status !== 'QUOTED' || order.quoteExpiresAt.getTime() > Date.now()) return false;

    const expired = await this.db.transaction(async (tx) => {
      const [row] = await tx
        .update(swapOrders)
        .set({ status: 'EXPIRED', updatedAt: new Date() })
        .where(
          and(
            eq(swapOrders.id, order.id),
            eq(swapOrders.status, 'QUOTED'),
            lte(swapOrders.quoteExpiresAt, new Date()),
          ),
        )
        .returning({ id: swapOrders.id });

      if (!row) return false;

      await tx.insert(swapEvents).values({
        orderId: order.id,
        type: 'expired',
        payload: { quoteExpiresAt: order.quoteExpiresAt.toISOString() },
      });

      await this.audit.log(
        {
          userId: order.userId,
          action: 'swap.order_expired',
          entityType: 'swap_order',
          entityId: order.id,
          before: { status: 'QUOTED' },
          after: { status: 'EXPIRED' },
        },
        { executor: tx, strict: true },
      );

      return true;
    });

    if (expired) order.status = 'EXPIRED';
    return expired;
  }

  private async recordBuildFailure(order: SwapOrder, code: string, meta: SwapMeta): Promise<void> {
    const bounded = code.replaceAll(/[^A-Z0-9_]/g, '_').slice(0, 64);
    this.logger.warn(`Swap ${order.id} build failed: ${bounded}`);

    await this.db.transaction(async (tx) => {
      const [row] = await tx
        .update(swapOrders)
        .set({
          errors: [...order.errors, bounded].slice(-20),
          updatedAt: new Date(),
        })
        .where(and(eq(swapOrders.id, order.id), eq(swapOrders.userId, order.userId)))
        .returning({ id: swapOrders.id });

      if (!row) return;

      await tx.insert(swapEvents).values({
        orderId: order.id,
        type: 'build_failed',
        payload: { code: bounded },
      });

      await this.audit.log(
        {
          userId: order.userId,
          action: 'swap.build_failed',
          entityType: 'swap_order',
          entityId: order.id,
          before: { status: order.status },
          after: { status: order.status, code: bounded },
          ip: meta.ip,
          userAgent: meta.userAgent,
        },
        { executor: tx, strict: true },
      );
    });
  }

  private assertEnabled(): void {
    if (!env.SWAP_ENABLED || env.SWAP_KILL_SWITCH) {
      throw new ServiceUnavailableException({
        code: 'SWAP_DISABLED',
        message: 'Swaps are disabled',
      });
    }
  }

  private assertExecutionEnabled(): void {
    if (!env.SWAP_EXECUTION_ENABLED) {
      throw new ServiceUnavailableException({
        code: 'SWAP_EXECUTION_DISABLED',
        message: 'Swap execution is disabled',
      });
    }
  }

  private assertWallet(address: string | undefined, required = false): void {
    const allowlist = parseAddressList(env.SWAP_WALLET_ALLOWLIST);

    if (!address) {
      if (required || allowlist.length > 0) {
        throw new ForbiddenException({
          code: 'SWAP_WALLET_NOT_ALLOWED',
          message: 'A wallet address is required for swaps',
        });
      }
      return;
    }

    if (allowlist.length === 0) {
      if (required) {
        throw new ForbiddenException({
          code: 'SWAP_WALLET_NOT_ALLOWED',
          message: 'Swap wallet allowlist is not configured',
        });
      }
      return;
    }

    if (!allowlist.includes(normalizeAddress(address))) {
      throw new ForbiddenException({
        code: 'SWAP_WALLET_NOT_ALLOWED',
        message: 'Wallet is not in the swap allowlist',
      });
    }
  }

  private providerError(error: unknown, fallbackCode: string): Error {
    if (error instanceof KyberApiError) {
      if (error.code === 'SWAP_RATE_LIMITED' || error.code === 'SWAP_PROVIDER_UNAVAILABLE') {
        return new ServiceUnavailableException({
          code: error.code,
          message: error.message,
        });
      }

      return new ServiceUnavailableException({
        code: fallbackCode,
        message: error.message,
      });
    }

    return new ServiceUnavailableException({
      code: 'SWAP_PROVIDER_UNAVAILABLE',
      message: 'Swap provider is unavailable',
    });
  }
}

import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { and, desc, eq, lt, or } from 'drizzle-orm';
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
  SwapToken,
} from '@nexter/contracts';
import { AuditService } from '../../shared/audit/audit.service';
import { env } from '../../shared/config/env';
import { DB } from '../../shared/db/db.module';
import { Decimal, decimal } from '../../shared/money/decimal';
import { decodeCursor, encodeCursor, isUuid, makePage } from '../../shared/pagination/cursor';
import { BscRpcService } from './bsc-rpc.service';
import { KyberApiError, KyberSwapClient } from './kyber-swap.client';
import {
  DEFAULT_BSC_ROUTER,
  SWAP_CHAINS,
  getSwapChain,
  getSwapToken,
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

function toPriceImpactBps(value: string | null): number | null {
  if (value === null) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  // Clamp before multiplying so a hostile provider cannot overflow the
  // integer column. Anything above the 2% gate is rejected by the caller.
  return Math.max(-100_000, Math.min(100_000, Math.round(parsed * 100)));
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
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly kyber: KyberSwapClient,
    private readonly rpc: BscRpcService,
    private readonly audit: AuditService,
  ) {}

  config(): SwapConfigResponse {
    const allowlist = parseAddressList(env.SWAP_WALLET_ALLOWLIST);
    const enabled = env.SWAP_ENABLED && !env.SWAP_KILL_SWITCH;

    return {
      enabled,
      killSwitch: env.SWAP_KILL_SWITCH,
      providerConfigured: this.kyber.configured,
      rpcConfigured: this.rpc.configured,
      walletAllowlistConfigured: allowlist.length > 0,
      chains: SWAP_CHAINS,
      quoteTtlSeconds: env.SWAP_QUOTE_TTL_SECONDS,
      maxPriceImpactBps: env.SWAP_MAX_PRICE_IMPACT_BPS,
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

    const priceImpactBps = toPriceImpactBps(route.priceImpact);
    const warnings: string[] = [];

    if (priceImpactBps === null) {
      throw new BadRequestException({
        code: 'SWAP_VALIDATION_FAILED',
        message: 'Provider did not return a valid price impact',
      });
    }

    if (priceImpactBps > env.SWAP_MAX_PRICE_IMPACT_BPS) {
      throw new BadRequestException({
        code: 'SWAP_PRICE_IMPACT_TOO_HIGH',
        message: `Price impact ${(priceImpactBps / 100).toFixed(2)}% exceeds the configured limit`,
      });
    }

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
          chain: input.chain,
          walletAddress: input.walletAddress ? normalizeAddress(input.walletAddress) : null,
          tokenIn: normalizeAddress(tokenIn.address),
          tokenOut: normalizeAddress(tokenOut.address),
          tokenInSymbol: tokenIn.symbol,
          tokenOutSymbol: tokenOut.symbol,
          amountIn: input.amountIn,
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

  async build(userId: string, input: SwapBuildRequest, meta: SwapMeta): Promise<SwapBuildResponse> {
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
      await this.recordBuildFailure(order, error);
      throw this.providerError(error, 'SWAP_BUILD_FAILED');
    }

    const validation: SwapBuildResponse['validation'] = [];
    const fail = (check: string, detail: string): never => {
      validation.push({ check, passed: false, detail });
      throw new BadRequestException({
        code: 'SWAP_VALIDATION_FAILED',
        message: `${check}: ${detail}`,
      });
    };
    const pass = (check: string) => validation.push({ check, passed: true, detail: null });

    if (!routerAllowlist().includes(normalizeAddress(built.routerAddress))) {
      fail('router', 'Router is not in the allowlist');
    }
    pass('router');

    if (!/^0x[0-9a-fA-F]*$/.test(built.data) || built.data.length < 10) {
      fail('calldata', 'Calldata is not valid hex');
    }
    if (built.data.length > MAX_CALLDATA_LENGTH) {
      fail('calldata-length', 'Calldata is too large');
    }
    if (!selectors.includes(built.data.slice(0, 10).toLowerCase())) {
      fail('selector', 'Calldata selector is not in the allowlist');
    }
    pass('calldata');

    const routeSummary = order.routeSummary as Record<string, unknown>;
    const quotedAmountIn = typeof routeSummary.amountIn === 'string' ? routeSummary.amountIn : null;

    if (!quotedAmountIn || !/^\d+$/.test(quotedAmountIn)) {
      throw new BadRequestException({
        code: 'SWAP_VALIDATION_FAILED',
        message: 'Stored route is missing a valid amountIn',
      });
    }
    if (built.amountIn !== quotedAmountIn) {
      fail('amountIn', 'Built amountIn does not match the quote');
    }
    pass('amountIn');

    if (!/^\d+$/.test(built.amountOut) || built.amountOut.length > 36) {
      fail('amountOut', 'Built amountOut is not a bounded integer');
    }
    if (!/^\d+$/.test(built.transactionValue) || built.transactionValue.length > 78) {
      fail('transactionValue', 'Transaction value is not a bounded integer');
    }

    const tokenOut = getSwapToken(order.chain, order.tokenOut);
    const tokenIn = getSwapToken(order.chain, order.tokenIn);

    if (!tokenOut || !tokenIn) {
      throw new BadRequestException({
        code: 'SWAP_VALIDATION_FAILED',
        message: 'Stored token is not in the current registry',
      });
    }

    const minOutBase = toBaseUnits(order.minOut, tokenOut.decimals);
    if (BigInt(built.amountOut) < BigInt(minOutBase)) {
      fail('minOut', 'Built output is below the quoted minimum');
    }
    pass('minOut');

    const expectedValue = tokenIn.native ? quotedAmountIn : '0';
    if (BigInt(built.transactionValue) !== BigInt(expectedValue)) {
      fail('transactionValue', 'Transaction value does not match the expected native amount');
    }
    pass('transactionValue');

    const simulation = await this.rpc.simulate({
      from: wallet,
      to: built.routerAddress,
      data: built.data,
      value: built.transactionValue,
    });

    if (!simulation.success) {
      await this.recordBuildFailure(
        order,
        new Error(simulation.revertReason ?? 'Simulation failed'),
      );
      throw new BadRequestException({
        code: 'SWAP_SIMULATION_FAILED',
        message: 'Swap simulation failed',
        details: { revertReason: simulation.revertReason },
      });
    }

    validation.push({ check: 'simulation', passed: true, detail: null });

    const gasEstimate = built.gas ?? simulation.gasEstimate;
    if (gasEstimate && (!/^\d+$/.test(gasEstimate) || gasEstimate.length > 24)) {
      fail('gas', 'Gas estimate is not a bounded integer');
    }

    const gasUsd =
      built.gasUsd && /^\d+(?:\.\d+)?$/.test(built.gasUsd) && built.gasUsd.length <= 32
        ? built.gasUsd
        : order.gasUsd;

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
          status: 'BUILT',
          errors: [],
          builtAt: new Date(),
          updatedAt: new Date(),
        })
        .where(and(eq(swapOrders.id, order.id), eq(swapOrders.userId, userId)))
        .returning();

      if (!row) throw new Error('Failed to update swap order');

      await tx.insert(swapEvents).values({
        orderId: order.id,
        type: 'built',
        payload: {
          routerAddress: row.routerAddress,
          gasEstimate: row.gasEstimate,
          simulation: { success: true, gasEstimate: simulation.gasEstimate },
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
            status: 'BUILT',
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
      simulation,
      validation,
    };
  }

  async cancel(userId: string, orderId: string, meta: SwapMeta): Promise<SwapOrderDetail> {
    const order = await this.requireOrder(userId, orderId);

    if (!['QUOTED', 'BUILT'].includes(order.status)) {
      throw new ConflictException({
        code: 'SWAP_STATE_INVALID',
        message: `Swap order is ${order.status}`,
      });
    }

    await this.db.transaction(async (tx) => {
      await tx
        .update(swapOrders)
        .set({ status: 'CANCELLED', cancelledAt: new Date(), updatedAt: new Date() })
        .where(and(eq(swapOrders.id, orderId), eq(swapOrders.userId, userId)));

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
    return {
      id: order.id,
      chain: order.chain as 'bsc',
      walletAddress: order.walletAddress,
      tokenIn: tokenFor(order.tokenIn, order.chain, order.tokenInSymbol),
      tokenOut: tokenFor(order.tokenOut, order.chain, order.tokenOutSymbol),
      amountIn: order.amountIn,
      amountOut: order.amountOut,
      minOut: order.minOut,
      slippageBps: order.slippageBps,
      priceImpactBps: order.priceImpactBps,
      gasUsd: order.gasUsd,
      routeId: order.routeId,
      status: order.status,
      quoteExpiresAt: order.quoteExpiresAt.toISOString(),
      builtAt: order.builtAt?.toISOString() ?? null,
      cancelledAt: order.cancelledAt?.toISOString() ?? null,
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

  private async expireIfNeeded(order: SwapOrder): Promise<void> {
    if (order.status !== 'QUOTED' || order.quoteExpiresAt.getTime() > Date.now()) return;

    await this.db.transaction(async (tx) => {
      await tx
        .update(swapOrders)
        .set({ status: 'EXPIRED', updatedAt: new Date() })
        .where(and(eq(swapOrders.id, order.id), eq(swapOrders.status, 'QUOTED')));
      await tx.insert(swapEvents).values({
        orderId: order.id,
        type: 'expired',
        payload: { quoteExpiresAt: order.quoteExpiresAt.toISOString() },
      });
    });

    order.status = 'EXPIRED';
  }

  private async recordBuildFailure(order: SwapOrder, error: unknown): Promise<void> {
    const message =
      error instanceof KyberApiError
        ? error.message
        : error instanceof Error
          ? error.message
          : 'Swap build failed';

    await this.db.transaction(async (tx) => {
      await tx
        .update(swapOrders)
        .set({
          errors: [...order.errors, message.slice(0, 500)],
          updatedAt: new Date(),
        })
        .where(eq(swapOrders.id, order.id));
      await tx.insert(swapEvents).values({
        orderId: order.id,
        type: 'build_failed',
        payload: { message: message.slice(0, 500) },
      });
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

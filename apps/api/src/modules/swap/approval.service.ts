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
import { swapOrders, tokenApprovals, type Database, type SwapOrder } from '@nexter/db';
import type {
  ApprovalBuildResponse,
  ApprovalsQuery,
  ApprovalsResponse,
  TokenApproval,
} from '@nexter/contracts';
import type { AuthContext } from '../auth/auth.types';
import { AuditService } from '../../shared/audit/audit.service';
import { env } from '../../shared/config/env';
import { DB } from '../../shared/db/db.module';
import { decodeCursor, encodeCursor, isUuid, makePage } from '../../shared/pagination/cursor';
import { BscRpcService, padUint } from './bsc-rpc.service';
import { assertStepUp } from './swap-step-up';
import {
  DEFAULT_BSC_ROUTER,
  getSwapToken,
  isNativeToken,
  parseAddressList,
} from './token-registry';

interface SwapMeta {
  ip?: string;
  userAgent?: string;
}

function padAddress(address: string): string {
  return address.toLowerCase().replace(/^0x/, '').padStart(64, '0');
}

function isUniqueViolation(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const candidate = error as { code?: string; cause?: { code?: string } };
  return candidate.code === '23505' || candidate.cause?.code === '23505';
}

function routerAllowlist(): string[] {
  const configured = parseAddressList(env.SWAP_ROUTER_ALLOWLIST);
  return configured.length > 0 ? configured : [DEFAULT_BSC_ROUTER.toLowerCase()];
}

@Injectable()
export class ApprovalService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly rpc: BscRpcService,
    private readonly audit: AuditService,
  ) {}

  async list(userId: string, query: ApprovalsQuery): Promise<ApprovalsResponse> {
    const conditions = [eq(tokenApprovals.userId, userId)];

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
          lt(tokenApprovals.createdAt, cursorDate),
          and(eq(tokenApprovals.createdAt, cursorDate), lt(tokenApprovals.id, cursor.id)),
        )!,
      );
    }

    const rows = await this.db
      .select()
      .from(tokenApprovals)
      .where(and(...conditions))
      .orderBy(desc(tokenApprovals.createdAt), desc(tokenApprovals.id))
      .limit(query.limit + 1);
    const page = makePage(rows, query.limit, (row) =>
      encodeCursor({ createdAt: row.createdAt.toISOString(), id: row.id }),
    );

    return {
      data: page.data.map((row) => this.toContract(row)),
      page: { nextCursor: page.nextCursor, hasMore: page.hasMore },
    };
  }

  async build(auth: AuthContext, orderId: string, meta: SwapMeta): Promise<ApprovalBuildResponse> {
    this.assertEnabled();
    const userId = auth.user.id;
    const order = await this.requireOrder(userId, orderId);

    if (order.status !== 'BUILT') {
      throw new ConflictException({
        code: 'SWAP_STATE_INVALID',
        message: `Swap order is ${order.status}`,
      });
    }

    const token = getSwapToken(order.chain, order.tokenIn);
    if (!token || isNativeToken(token.address)) {
      throw new BadRequestException({
        code: 'SWAP_APPROVAL_NOT_REQUIRED',
        message: 'Native token swaps do not require an ERC-20 approval',
      });
    }

    if (!order.walletAddress || !order.routerAddress) {
      throw new BadRequestException({
        code: 'SWAP_VALIDATION_FAILED',
        message: 'Swap order is missing wallet or router',
      });
    }

    const routeSummary = order.routeSummary as Record<string, unknown>;
    const amountWei = typeof routeSummary.amountIn === 'string' ? routeSummary.amountIn : null;

    if (!amountWei || !/^\d+$/.test(amountWei) || amountWei.length > 78) {
      throw new BadRequestException({
        code: 'SWAP_VALIDATION_FAILED',
        message: 'Swap order is missing a valid input amount',
      });
    }

    const spender = order.routerAddress.toLowerCase();
    if (!routerAllowlist().includes(spender)) {
      throw new BadRequestException({
        code: 'SWAP_ROUTER_NOT_ALLOWED',
        message: 'Router is not in the allowlist',
      });
    }

    if (!order.deadline || order.deadline < Math.floor(Date.now() / 1000)) {
      throw new ConflictException({
        code: 'SWAP_APPROVAL_EXPIRED',
        message: 'Swap order deadline has passed',
      });
    }

    this.assertWallet(order.walletAddress);
    assertStepUp(auth, order);

    let allowance: string | null;

    try {
      allowance = await this.rpc.getErc20Allowance(token.address, order.walletAddress, spender);
    } catch {
      throw new ServiceUnavailableException({
        code: 'SWAP_PROVIDER_UNAVAILABLE',
        message: 'BSC RPC is unavailable',
      });
    }

    if (allowance === null) {
      throw new ServiceUnavailableException({
        code: 'SWAP_PROVIDER_UNAVAILABLE',
        message: 'BSC RPC is not configured',
      });
    }

    if (BigInt(allowance) >= BigInt(amountWei)) {
      throw new ConflictException({
        code: 'SWAP_APPROVAL_NOT_REQUIRED',
        message: 'Token allowance is already sufficient',
      });
    }

    const calldata = `0x095ea7b3${padAddress(spender)}${padUint(amountWei)}`;
    const simulation = await this.rpc.simulate({
      from: order.walletAddress,
      to: token.address,
      data: calldata,
      value: '0',
    });

    if (!simulation.success) {
      throw new BadRequestException({
        code: 'SWAP_SIMULATION_FAILED',
        message: 'Approval simulation failed',
        details: { revertReason: simulation.revertReason },
      });
    }

    let approval;

    try {
      approval = await this.db.transaction(async (tx) => {
        const [created] = await tx
          .insert(tokenApprovals)
          .values({
            userId,
            orderId,
            chain: order.chain,
            walletAddress: order.walletAddress as string,
            tokenAddress: token.address.toLowerCase(),
            spenderAddress: spender,
            amountWei,
            calldata,
            status: 'BUILT',
          })
          .returning();

        if (!created) throw new Error('Failed to create token approval');

        await this.audit.log(
          {
            userId,
            action: 'swap.approval_built',
            entityType: 'token_approval',
            entityId: created.id,
            after: {
              orderId,
              token: token.symbol,
              spender,
              amountWei,
            },
            ip: meta.ip,
            userAgent: meta.userAgent,
          },
          { executor: tx, strict: true },
        );

        return created;
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException({
          code: 'CONFLICT',
          message: 'An active approval already exists for this order',
        });
      }
      throw error;
    }

    return {
      approval: this.toContract(approval),
      to: token.address,
      value: '0',
      calldata,
      simulation: {
        success: simulation.success,
        revertReason: simulation.revertReason,
        gasEstimate: simulation.gasEstimate,
      },
    };
  }

  async submitted(
    userId: string,
    approvalId: string,
    txHash: string,
    meta: SwapMeta,
  ): Promise<TokenApproval> {
    this.assertEnabled();
    const [approval] = await this.db
      .select()
      .from(tokenApprovals)
      .where(and(eq(tokenApprovals.id, approvalId), eq(tokenApprovals.userId, userId)))
      .limit(1);

    if (!approval) {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        message: 'Token approval not found',
      });
    }

    if (approval.status !== 'BUILT') {
      throw new ConflictException({
        code: 'SWAP_STATE_INVALID',
        message: `Token approval is ${approval.status}`,
      });
    }

    const normalized = txHash.toLowerCase();
    let updated;

    try {
      updated = await this.db.transaction(async (tx) => {
        const [row] = await tx
          .update(tokenApprovals)
          .set({
            status: 'SUBMITTED',
            txHash: normalized,
            submittedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(tokenApprovals.id, approvalId),
              eq(tokenApprovals.userId, userId),
              eq(tokenApprovals.status, 'BUILT'),
            ),
          )
          .returning();

        if (!row) {
          throw new ConflictException({
            code: 'SWAP_STATE_INVALID',
            message: 'Token approval is no longer submittable',
          });
        }

        await this.audit.log(
          {
            userId,
            action: 'swap.approval_submitted',
            entityType: 'token_approval',
            entityId: approvalId,
            after: { status: 'SUBMITTED', txHash: normalized },
            ip: meta.ip,
            userAgent: meta.userAgent,
          },
          { executor: tx, strict: true },
        );

        return row;
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException({
          code: 'CONFLICT',
          message: 'Transaction hash is already attached to another approval',
        });
      }
      throw error;
    }

    return this.toContract(updated);
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

  private assertWallet(address: string | null): void {
    const allowlist = parseAddressList(env.SWAP_WALLET_ALLOWLIST);

    if (!address || allowlist.length === 0 || !allowlist.includes(address.toLowerCase())) {
      throw new ForbiddenException({
        code: 'SWAP_WALLET_NOT_ALLOWED',
        message: 'Wallet is not in the swap allowlist',
      });
    }
  }

  private assertEnabled(): void {
    if (!env.SWAP_ENABLED || env.SWAP_KILL_SWITCH) {
      throw new ServiceUnavailableException({
        code: 'SWAP_DISABLED',
        message: 'Swaps are disabled',
      });
    }
  }

  private toContract(row: typeof tokenApprovals.$inferSelect): TokenApproval {
    return {
      id: row.id,
      orderId: row.orderId,
      chain: row.chain as 'bsc',
      walletAddress: row.walletAddress,
      tokenAddress: row.tokenAddress,
      spenderAddress: row.spenderAddress,
      amountWei: row.amountWei,
      status: row.status as TokenApproval['status'],
      txHash: row.txHash,
      blockNumber: row.blockNumber,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      submittedAt: row.submittedAt?.toISOString() ?? null,
      confirmedAt: row.confirmedAt?.toISOString() ?? null,
    };
  }
}

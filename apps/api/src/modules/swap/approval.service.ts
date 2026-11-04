import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { and, desc, eq } from 'drizzle-orm';
import { swapOrders, tokenApprovals, type Database, type SwapOrder } from '@nexter/db';
import type { ApprovalBuildResponse, ApprovalsResponse, TokenApproval } from '@nexter/contracts';
import type { AuthContext } from '../auth/auth.types';
import { AuditService } from '../../shared/audit/audit.service';
import { env } from '../../shared/config/env';
import { DB } from '../../shared/db/db.module';
import { decimal } from '../../shared/money/decimal';
import { BscRpcService, padUint } from './bsc-rpc.service';
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

  async list(userId: string): Promise<ApprovalsResponse> {
    const rows = await this.db
      .select()
      .from(tokenApprovals)
      .where(eq(tokenApprovals.userId, userId))
      .orderBy(desc(tokenApprovals.createdAt))
      .limit(50);

    return {
      data: rows.map((row) => this.toContract(row)),
      page: { nextCursor: null, hasMore: false },
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

    this.assertStepUp(auth, order);

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

    const approval = await this.db.transaction(async (tx) => {
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
    const updated = await this.db.transaction(async (tx) => {
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

  private assertStepUp(auth: AuthContext, order: SwapOrder): void {
    const routeSummary = order.routeSummary as Record<string, unknown>;
    const rawUsd = routeSummary.amountInUsd;
    const usd = typeof rawUsd === 'string' ? decimal(rawUsd) : null;

    if (usd === null || usd.lte(500)) return;

    if (!auth.session.stepUpUntil || auth.session.stepUpUntil.getTime() <= Date.now()) {
      throw new ForbiddenException({
        code: 'SWAP_STEP_UP_REQUIRED',
        message: 'Step-up TOTP is required for this swap',
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

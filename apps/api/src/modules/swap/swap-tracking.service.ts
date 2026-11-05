import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { and, asc, eq, inArray, isNotNull, isNull, lt, lte, ne, or, sql } from 'drizzle-orm';
import { swapEvents, swapOrders, tokenApprovals, type Database, type SwapOrder } from '@nexter/db';
import { AuditService } from '../../shared/audit/audit.service';
import { env } from '../../shared/config/env';
import { DB } from '../../shared/db/db.module';
import { decimal, usdString } from '../../shared/money/decimal';
import { AccountsService } from '../accounting/accounts.service';
import { AssetsService } from '../accounting/assets.service';
import { LedgerService } from '../accounting/ledger.service';
import { BscRpcService, type RpcReceipt, type RpcTransaction } from './bsc-rpc.service';
import { KYBER_ROUTER_ABI } from './kyber-calldata';
import { normalizeUsd } from './swap-step-up';
import { getSwapToken, isCashEquivalentSymbol } from './token-registry';

const ACTIVE_STATUSES = ['SUBMITTED', 'PENDING'] as const;
const BNB_WEI = decimal('1000000000000000000');

function fromBaseUnits(value: string, decimals: number): string {
  return decimal(value).div(decimal('10').pow(decimals)).toFixed(decimals);
}

function toBaseUnits(value: string, decimals: number): bigint {
  return BigInt(decimal(value).mul(decimal('10').pow(decimals)).toFixed(0));
}

const TRACKING_ANOMALY_PREFIXES = ['SWAP_REPLACEMENT_', 'SWAP_TX_NOT_FOUND'];

function withoutTrackingAnomalies(errors: string[]): string[] {
  return errors.filter(
    (item) => !TRACKING_ANOMALY_PREFIXES.some((prefix) => item.startsWith(prefix)),
  );
}

@Injectable()
export class SwapTrackingService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(SwapTrackingService.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly rpc: BscRpcService,
    private readonly accounts: AccountsService,
    private readonly assets: AssetsService,
    private readonly ledger: LedgerService,
    private readonly audit: AuditService,
  ) {}

  onApplicationBootstrap(): void {
    if (env.NODE_ENV === 'test' || !this.rpc.configured) return;

    this.timer = setInterval(() => {
      void this.tick();
    }, env.SWAP_TRACK_INTERVAL_SECONDS * 1000);
    this.timer.unref();
    this.logger.log(`Swap tracking started (${env.SWAP_TRACK_INTERVAL_SECONDS}s interval)`);
  }

  onApplicationShutdown(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;

    try {
      const latest = await this.rpc.getBlockNumber();
      if (latest === null) return;

      await this.expireStaleOrders();

      const active = await this.db
        .select()
        .from(swapOrders)
        .where(
          and(
            inArray(swapOrders.status, [...ACTIVE_STATUSES]),
            isNotNull(swapOrders.txHash),
            isNotNull(swapOrders.submittedAt),
          ),
        )
        .orderBy(asc(swapOrders.submittedAt))
        .limit(20);

      for (const order of active) {
        await this.safeTrack(order, latest);
      }

      const approvals = await this.db
        .select()
        .from(tokenApprovals)
        .where(
          and(
            eq(tokenApprovals.status, 'SUBMITTED'),
            isNotNull(tokenApprovals.txHash),
            isNotNull(tokenApprovals.submittedAt),
          ),
        )
        .orderBy(asc(tokenApprovals.submittedAt))
        .limit(20);

      for (const approval of approvals) {
        await this.safeTrackApproval(approval, latest);
      }

      const confirmed = await this.db
        .select()
        .from(swapOrders)
        .where(
          and(
            eq(swapOrders.status, 'CONFIRMED'),
            isNull(swapOrders.accountingTransactionId),
            isNotNull(swapOrders.confirmedAt),
            or(
              sql`jsonb_array_length(${swapOrders.errors}) = 0`,
              lte(swapOrders.updatedAt, new Date(Date.now() - 60_000)),
            ),
          ),
        )
        .orderBy(sql`jsonb_array_length(${swapOrders.errors}) asc`, asc(swapOrders.updatedAt))
        .limit(20);

      for (const order of confirmed) {
        await this.safeAccount(order);
      }
    } catch (error) {
      this.logger.error(
        `Swap tracking tick failed: ${error instanceof Error ? error.message : 'unknown error'}`,
      );
    } finally {
      this.running = false;
    }
  }

  private async expireStaleOrders(): Promise<void> {
    const stale = await this.db
      .select()
      .from(swapOrders)
      .where(
        and(
          inArray(swapOrders.status, ['APPROVAL_REQUIRED', 'BUILT', 'READY']),
          isNull(swapOrders.txHash),
          lt(swapOrders.deadline, Math.floor(Date.now() / 1000)),
        ),
      )
      .orderBy(asc(swapOrders.deadline))
      .limit(20);

    for (const order of stale) {
      await this.db.transaction(async (dbtx) => {
        const [row] = await dbtx
          .update(swapOrders)
          .set({ status: 'EXPIRED', updatedAt: new Date() })
          .where(
            and(
              eq(swapOrders.id, order.id),
              eq(swapOrders.userId, order.userId),
              inArray(swapOrders.status, ['APPROVAL_REQUIRED', 'BUILT', 'READY']),
              isNull(swapOrders.txHash),
              lt(swapOrders.deadline, Math.floor(Date.now() / 1000)),
            ),
          )
          .returning({ id: swapOrders.id });

        if (!row) return;

        await dbtx.insert(swapEvents).values({
          orderId: order.id,
          type: 'expired',
          payload: { reason: 'deadline_passed_before_signing' },
        });

        await this.audit.log(
          {
            userId: order.userId,
            action: 'swap.order_expired',
            entityType: 'swap_order',
            entityId: order.id,
            before: { status: order.status },
            after: { status: 'EXPIRED' },
          },
          { executor: dbtx, strict: true },
        );
      });
    }
  }

  private async safeTrack(order: SwapOrder, latestBlock: number): Promise<void> {
    try {
      await this.track(order, latestBlock);
    } catch (error) {
      this.logger.warn(
        `Swap ${order.id} tracking failed: ${error instanceof Error ? error.message : 'unknown error'}`,
      );
    }
  }

  private async safeTrackApproval(
    approval: typeof tokenApprovals.$inferSelect,
    latestBlock: number,
  ): Promise<void> {
    try {
      await this.trackApproval(approval, latestBlock);
    } catch (error) {
      this.logger.warn(
        `Approval ${approval.id} tracking failed: ${
          error instanceof Error ? error.message : 'unknown error'
        }`,
      );
    }
  }

  private async trackApproval(
    approval: typeof tokenApprovals.$inferSelect,
    latestBlock: number,
  ): Promise<void> {
    const txHash = approval.txHash;
    if (!txHash) return;

    const tx = await this.rpc.getTransactionByHash(txHash);

    if (!tx) {
      if (
        approval.submittedAt &&
        Date.now() - approval.submittedAt.getTime() > env.SWAP_DROP_TIMEOUT_SECONDS * 1000
      ) {
        await this.markApproval(approval, 'FAILED', 'approval_tx_not_found');
      }
      return;
    }

    if (
      tx.from.toLowerCase() !== approval.walletAddress.toLowerCase() ||
      !tx.to ||
      tx.to.toLowerCase() !== approval.tokenAddress.toLowerCase() ||
      !approval.calldata ||
      tx.input.toLowerCase() !== approval.calldata.toLowerCase()
    ) {
      await this.markApproval(approval, 'FAILED', 'approval_tx_mismatch');
      return;
    }

    const receipt = await this.rpc.getTransactionReceipt(txHash);

    if (!receipt) {
      if (
        approval.submittedAt &&
        Date.now() - approval.submittedAt.getTime() > env.SWAP_DROP_TIMEOUT_SECONDS * 1000
      ) {
        await this.markApproval(approval, 'FAILED', 'approval_not_mined');
      }
      return;
    }

    if (!receipt.status) {
      await this.markApproval(approval, 'FAILED', 'approval_receipt_failed', receipt.blockNumber);
      return;
    }

    if (latestBlock - receipt.blockNumber + 1 < env.SWAP_CONFIRMATIONS) return;

    await this.markApproval(approval, 'CONFIRMED', null, receipt.blockNumber);
  }

  private async markApproval(
    approval: typeof tokenApprovals.$inferSelect,
    status: 'CONFIRMED' | 'FAILED',
    reason: string | null,
    blockNumber?: number,
  ): Promise<void> {
    await this.db.transaction(async (dbtx) => {
      const [row] = await dbtx
        .update(tokenApprovals)
        .set({
          status,
          blockNumber: blockNumber ?? approval.blockNumber,
          confirmedAt: status === 'CONFIRMED' ? new Date() : null,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(tokenApprovals.id, approval.id),
            eq(tokenApprovals.userId, approval.userId),
            eq(tokenApprovals.status, 'SUBMITTED'),
          ),
        )
        .returning({ id: tokenApprovals.id });

      if (!row) return;

      await dbtx.insert(swapEvents).values({
        orderId: approval.orderId,
        type: status === 'CONFIRMED' ? 'approval_confirmed' : 'approval_failed',
        payload: { approvalId: approval.id, txHash: approval.txHash, reason, blockNumber },
      });

      await this.audit.log(
        {
          userId: approval.userId,
          action: `swap.approval_${status.toLowerCase()}`,
          entityType: 'token_approval',
          entityId: approval.id,
          after: { status, txHash: approval.txHash, reason, blockNumber: blockNumber ?? null },
        },
        { executor: dbtx, strict: true },
      );
    });
  }

  private async safeAccount(order: SwapOrder): Promise<void> {
    try {
      await this.account(order);
    } catch (error) {
      this.logger.warn(
        `Swap ${order.id} accounting failed: ${error instanceof Error ? error.message : 'unknown error'}`,
      );
    }
  }

  private async track(order: SwapOrder, latestBlock: number): Promise<void> {
    const originalHash = order.txHash;
    if (!originalHash) return;

    let currentOrder = order;
    let txHash = originalHash;
    let tx = await this.rpc.getTransactionByHash(txHash);

    if (!tx && order.walletAddress && order.routerAddress && order.calldata) {
      if (order.nonce !== null) {
        const count = await this.rpc.getTransactionCount(order.walletAddress);

        if (count !== null && count > order.nonce) {
          const candidate = await this.rpc.findTransactionByNonce(
            order.walletAddress,
            order.nonce,
            env.SWAP_REPLACEMENT_LOOKBACK_BLOCKS,
          );

          if (candidate) {
            if (!this.replacementMatches(order, candidate)) {
              const receipt = await this.rpc.getTransactionReceipt(candidate.hash);
              const confirmations = receipt
                ? Math.max(0, latestBlock - receipt.blockNumber + 1)
                : 0;

              if (!receipt || confirmations < env.SWAP_CONFIRMATIONS) {
                await this.recordTrackingAnomaly(order, 'SWAP_REPLACEMENT_PENDING', {
                  candidateHash: candidate.hash,
                  candidateBlock: receipt?.blockNumber ?? candidate.blockNumber,
                  confirmations,
                  nonce: order.nonce,
                });
                return;
              }

              const replaced = await this.mark(
                order,
                'REPLACED',
                {
                  reason: 'replacement_not_matching_order',
                  nonce: order.nonce,
                  latestNonce: count,
                  candidateHash: candidate.hash,
                  candidateBlock: receipt.blockNumber,
                  confirmations,
                },
                order.txHash,
              );

              if (!replaced) await this.recheckAdoptionMiss(order);
              return;
            }

            const adopted = await this.adoptReplacement(order, candidate);

            if (!adopted) {
              await this.recheckAdoptionMiss(order);
              return;
            }

            tx = candidate;
            txHash = candidate.hash;
            currentOrder = {
              ...order,
              status: 'PENDING',
              txHash,
              nonce: candidate.nonce ?? order.nonce,
            };
          } else {
            await this.recordTrackingAnomaly(order, 'SWAP_REPLACEMENT_NOT_FOUND', {
              nonce: order.nonce,
              latestNonce: count,
              lookbackBlocks: env.SWAP_REPLACEMENT_LOOKBACK_BLOCKS,
            });
            return;
          }
        }
      } else {
        const matches = await this.rpc.findMatchingTransactions({
          owner: order.walletAddress,
          router: order.routerAddress,
          calldata: order.calldata,
          value: order.transactionValue ?? '0',
          lookbackBlocks: env.SWAP_REPLACEMENT_LOOKBACK_BLOCKS,
          sinceTimestamp: Math.floor(
            ((order.submittedAt ?? order.createdAt).getTime() - 120_000) / 1000,
          ),
        });

        if (matches.length !== 1) {
          await this.recordTrackingAnomaly(
            order,
            matches.length > 1 ? 'SWAP_REPLACEMENT_AMBIGUOUS' : 'SWAP_REPLACEMENT_NOT_FOUND',
            {
              matchCount: matches.length,
              candidateHashes: matches.slice(0, 10).map((item) => item.hash),
              lookbackBlocks: env.SWAP_REPLACEMENT_LOOKBACK_BLOCKS,
              submittedAt: order.submittedAt?.toISOString() ?? null,
            },
          );
          return;
        }

        const adopted = await this.adoptReplacement(order, matches[0]);

        if (!adopted) {
          await this.recheckAdoptionMiss(order);
          return;
        }

        tx = matches[0];
        txHash = matches[0].hash;
        currentOrder = {
          ...order,
          status: 'PENDING',
          txHash,
          nonce: matches[0].nonce ?? order.nonce,
        };
      }
    }

    if (!tx) {
      await this.recordTrackingAnomaly(order, 'SWAP_TX_NOT_FOUND', {
        submittedAt: order.submittedAt?.toISOString() ?? null,
        nonce: order.nonce,
      });
      return;
    }

    const mismatch = this.verifyTransaction(currentOrder, tx, txHash);
    if (mismatch) {
      await this.mark(currentOrder, 'FAILED', { reason: mismatch, txHash });
      return;
    }

    const receipt = await this.rpc.getTransactionReceipt(txHash);

    if (!receipt) {
      await this.setPending(currentOrder, tx, 0, latestBlock);
      return;
    }

    if (receipt.transactionHash && receipt.transactionHash.toLowerCase() !== txHash.toLowerCase()) {
      await this.mark(currentOrder, 'FAILED', { reason: 'receipt_hash_mismatch', txHash });
      return;
    }

    if (!receipt.status) {
      await this.mark(currentOrder, 'FAILED', {
        reason: 'receipt_failed',
        blockNumber: receipt.blockNumber,
      });
      return;
    }

    const confirmations = Math.max(0, latestBlock - receipt.blockNumber + 1);

    if (confirmations < env.SWAP_CONFIRMATIONS) {
      await this.setPending(currentOrder, tx, confirmations, latestBlock, receipt);
      return;
    }

    await this.confirm(currentOrder, tx, receipt, confirmations);
  }

  private replacementMatches(order: SwapOrder, tx: RpcTransaction): boolean {
    if (!order.walletAddress || !order.routerAddress || !order.calldata) return false;
    if (tx.from.toLowerCase() !== order.walletAddress.toLowerCase()) return false;
    if (!tx.to || tx.to.toLowerCase() !== order.routerAddress.toLowerCase()) return false;
    if (tx.input.toLowerCase() !== order.calldata.toLowerCase()) return false;

    try {
      return BigInt(tx.value || '0x0') === BigInt(order.transactionValue ?? '0');
    } catch {
      return false;
    }
  }

  private async adoptReplacement(order: SwapOrder, tx: RpcTransaction): Promise<boolean> {
    return this.db.transaction(async (dbtx) => {
      const [conflict] = await dbtx
        .select({ id: swapOrders.id })
        .from(swapOrders)
        .where(and(eq(swapOrders.txHash, tx.hash.toLowerCase()), ne(swapOrders.id, order.id)))
        .limit(1);

      if (conflict) return false;

      const [row] = await dbtx
        .update(swapOrders)
        .set({
          txHash: tx.hash.toLowerCase(),
          nonce: tx.nonce ?? order.nonce,
          blockNumber: tx.blockNumber ?? order.blockNumber,
          status: 'PENDING',
          confirmations: 0,
          errors: withoutTrackingAnomalies(order.errors),
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(swapOrders.id, order.id),
            eq(swapOrders.userId, order.userId),
            eq(swapOrders.txHash, order.txHash as string),
            inArray(swapOrders.status, [...ACTIVE_STATUSES]),
          ),
        )
        .returning({ id: swapOrders.id });

      if (!row) return false;

      await dbtx.insert(swapEvents).values({
        orderId: order.id,
        type: 'replacement_adopted',
        payload: {
          previousTxHash: order.txHash,
          txHash: tx.hash,
          nonce: tx.nonce,
          blockNumber: tx.blockNumber,
        },
      });

      await this.audit.log(
        {
          userId: order.userId,
          action: 'swap.order_replacement_adopted',
          entityType: 'swap_order',
          entityId: order.id,
          after: { previousTxHash: order.txHash, txHash: tx.hash, nonce: tx.nonce },
        },
        { executor: dbtx, strict: true },
      );

      return true;
    });
  }

  private async recheckAdoptionMiss(order: SwapOrder): Promise<void> {
    const [current] = await this.db
      .select({ status: swapOrders.status, txHash: swapOrders.txHash })
      .from(swapOrders)
      .where(and(eq(swapOrders.id, order.id), eq(swapOrders.userId, order.userId)))
      .limit(1);

    if (!current) return;
    if (current.txHash !== order.txHash || !['SUBMITTED', 'PENDING'].includes(current.status)) {
      return;
    }

    await this.recordTrackingAnomaly(order, 'SWAP_REPLACEMENT_NOT_RECORDED');
  }

  private async recordTrackingAnomaly(
    order: SwapOrder,
    code: string,
    details: Record<string, unknown> = {},
  ): Promise<void> {
    const bounded = code.replaceAll(/[^A-Z0-9_]/g, '_').slice(0, 64);
    const exists = order.errors.includes(bounded);

    if (!exists) {
      this.logger.warn(`Swap ${order.id} tracking anomaly: ${bounded}`);
    }

    await this.db.transaction(async (dbtx) => {
      await dbtx
        .update(swapOrders)
        .set({
          errors: exists ? order.errors : [...order.errors, bounded].slice(-20),
          updatedAt: new Date(),
        })
        .where(and(eq(swapOrders.id, order.id), eq(swapOrders.userId, order.userId)));

      if (exists) return;

      await dbtx.insert(swapEvents).values({
        orderId: order.id,
        type: 'tracking_anomaly',
        payload: { code: bounded, ...details },
      });

      await this.audit.log(
        {
          userId: order.userId,
          action: 'swap.tracking_anomaly',
          entityType: 'swap_order',
          entityId: order.id,
          after: { code: bounded, txHash: order.txHash, ...details },
        },
        { executor: dbtx, strict: true },
      );
    });
  }

  private verifyTransaction(
    order: SwapOrder,
    tx: RpcTransaction,
    expectedHash: string,
  ): string | null {
    if (!order.walletAddress || !order.routerAddress || !order.calldata) {
      return 'missing_order_data';
    }

    if (tx.hash.toLowerCase() !== expectedHash.toLowerCase()) {
      return 'hash_mismatch';
    }

    if (tx.from.toLowerCase() !== order.walletAddress.toLowerCase()) {
      return 'sender_mismatch';
    }

    if (!tx.to || tx.to.toLowerCase() !== order.routerAddress.toLowerCase()) {
      return 'router_mismatch';
    }

    if (tx.input.toLowerCase() !== order.calldata.toLowerCase()) {
      return 'calldata_mismatch';
    }

    try {
      if (BigInt(tx.value || '0x0') !== BigInt(order.transactionValue ?? '0')) {
        return 'value_mismatch';
      }
    } catch {
      return 'value_mismatch';
    }

    return null;
  }

  private async setPending(
    order: SwapOrder,
    tx: RpcTransaction,
    confirmations: number,
    latestBlock: number,
    receipt?: RpcReceipt,
  ): Promise<void> {
    const status = 'PENDING' as const;

    if (order.status === status && order.confirmations === confirmations) {
      return;
    }

    await this.db.transaction(async (dbtx) => {
      const [row] = await dbtx
        .update(swapOrders)
        .set({
          status,
          nonce: tx.nonce ?? order.nonce,
          blockNumber: receipt?.blockNumber ?? tx.blockNumber ?? order.blockNumber,
          confirmations,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(swapOrders.id, order.id),
            eq(swapOrders.userId, order.userId),
            eq(swapOrders.status, order.status),
            eq(swapOrders.txHash, order.txHash as string),
          ),
        )
        .returning({ id: swapOrders.id });

      if (!row) return;

      await dbtx.insert(swapEvents).values({
        orderId: order.id,
        type: 'pending',
        payload: {
          txHash: order.txHash,
          blockNumber: receipt?.blockNumber ?? tx.blockNumber,
          confirmations,
          latestBlock,
        },
      });

      await this.audit.log(
        {
          userId: order.userId,
          action: 'swap.order_pending',
          entityType: 'swap_order',
          entityId: order.id,
          before: { status: order.status },
          after: { status, confirmations, blockNumber: receipt?.blockNumber ?? tx.blockNumber },
        },
        { executor: dbtx, strict: true },
      );
    });
  }

  private async confirm(
    order: SwapOrder,
    tx: RpcTransaction,
    receipt: RpcReceipt,
    confirmations: number,
  ): Promise<void> {
    const { feeWei, feeUsd } = this.networkFee(order, receipt);
    const confirmedAt = new Date();
    const tokenIn = getSwapToken(order.chain, order.tokenIn);
    const tokenOut = getSwapToken(order.chain, order.tokenOut);
    const swapped =
      tokenIn && tokenOut ? await this.swappedAmounts(receipt, order, tokenIn, tokenOut) : null;
    const executedAmountIn =
      swapped && tokenIn ? fromBaseUnits(swapped.spentAmount, tokenIn.decimals) : null;
    const executedAmountOut =
      swapped && tokenOut ? fromBaseUnits(swapped.returnAmount, tokenOut.decimals) : null;

    const row = await this.db.transaction(async (dbtx) => {
      const [updated] = await dbtx
        .update(swapOrders)
        .set({
          status: 'CONFIRMED',
          nonce: tx.nonce ?? order.nonce,
          blockNumber: receipt.blockNumber,
          confirmations,
          confirmedAt,
          executedAmountIn,
          executedAmountOut,
          networkFeeWei: feeWei,
          networkFeeUsd: feeUsd,
          errors: withoutTrackingAnomalies(order.errors),
          updatedAt: confirmedAt,
        })
        .where(
          and(
            eq(swapOrders.id, order.id),
            eq(swapOrders.userId, order.userId),
            eq(swapOrders.status, order.status),
            eq(swapOrders.txHash, order.txHash as string),
          ),
        )
        .returning();

      if (!updated) return null;

      await dbtx.insert(swapEvents).values({
        orderId: order.id,
        type: 'confirmed',
        payload: {
          txHash: order.txHash,
          blockNumber: receipt.blockNumber,
          confirmations,
          executedAmountIn,
          executedAmountOut,
          networkFeeWei: feeWei,
          networkFeeUsd: feeUsd,
        },
      });

      await this.audit.log(
        {
          userId: order.userId,
          action: 'swap.order_confirmed',
          entityType: 'swap_order',
          entityId: order.id,
          before: { status: order.status },
          after: {
            status: 'CONFIRMED',
            blockNumber: receipt.blockNumber,
            confirmations,
            executedAmountIn,
            executedAmountOut,
            networkFeeWei: feeWei,
            networkFeeUsd: feeUsd,
          },
        },
        { executor: dbtx, strict: true },
      );

      return updated;
    });

    if (!row) return;

    await this.safeAccount(row);
  }

  private async swappedAmounts(
    receipt: RpcReceipt,
    order: SwapOrder,
    tokenIn: { address: string; decimals: number },
    tokenOut: { address: string; decimals: number },
  ): Promise<{ spentAmount: string; returnAmount: string } | null> {
    if (!order.routerAddress || !order.walletAddress) return null;

    const wallet = order.walletAddress.toLowerCase();
    const expectedIn = toBaseUnits(order.amountIn, tokenIn.decimals);
    const minOut = toBaseUnits(order.minOut, tokenOut.decimals);
    const { decodeEventLog } = await import('viem');
    let found: { spentAmount: string; returnAmount: string } | null = null;

    for (const log of receipt.logs) {
      if (log.address.toLowerCase() !== order.routerAddress.toLowerCase()) continue;

      try {
        const decoded = decodeEventLog({
          abi: KYBER_ROUTER_ABI,
          data: log.data as `0x${string}`,
          topics: log.topics as [`0x${string}`, ...`0x${string}`[]],
        });

        if (decoded.eventName !== 'Swapped') continue;
        const args = decoded.args as unknown as {
          sender: string;
          srcToken: string;
          dstToken: string;
          dstReceiver: string;
          spentAmount: bigint;
          returnAmount: bigint;
        };

        if (args.sender.toLowerCase() !== wallet) continue;
        if (args.srcToken.toLowerCase() !== tokenIn.address.toLowerCase()) continue;
        if (args.dstToken.toLowerCase() !== tokenOut.address.toLowerCase()) continue;
        if (args.dstReceiver.toLowerCase() !== wallet) continue;
        if (args.spentAmount !== expectedIn) continue;
        if (args.returnAmount < minOut) continue;

        // Keep the last matching event; nested router calls can emit earlier ones.
        found = {
          spentAmount: args.spentAmount.toString(),
          returnAmount: args.returnAmount.toString(),
        };
      } catch {
        continue;
      }
    }

    return found;
  }

  private networkFee(
    order: SwapOrder,
    receipt: RpcReceipt,
  ): { feeWei: string; feeUsd: string | null } {
    let gasUsed: bigint;

    try {
      gasUsed = BigInt(receipt.gasUsed);
    } catch {
      return { feeWei: '0', feeUsd: null };
    }

    if (gasUsed <= 0n || !receipt.effectiveGasPrice) {
      return { feeWei: '0', feeUsd: null };
    }

    let gasPrice: bigint;

    try {
      gasPrice = BigInt(receipt.effectiveGasPrice);
    } catch {
      return { feeWei: '0', feeUsd: null };
    }

    const feeWei = gasUsed * gasPrice;

    if (feeWei <= 0n) return { feeWei: '0', feeUsd: null };

    if (!order.gasUsd || !order.gasEstimate) {
      return { feeWei: feeWei.toString(), feeUsd: null };
    }

    try {
      const estimate = BigInt(order.gasEstimate);

      if (estimate <= 0n) {
        return { feeWei: feeWei.toString(), feeUsd: null };
      }

      const usd = decimal(order.gasUsd).mul(gasUsed.toString()).div(estimate.toString());

      return {
        feeWei: feeWei.toString(),
        feeUsd: usd.gt(0) ? usdString(usd) : null,
      };
    } catch {
      return { feeWei: feeWei.toString(), feeUsd: null };
    }
  }

  private async mark(
    order: SwapOrder,
    status: 'FAILED' | 'REPLACED' | 'DROPPED',
    payload: Record<string, unknown>,
    expectedTxHash: string | null = order.txHash,
  ): Promise<boolean> {
    return this.db.transaction(async (dbtx) => {
      const conditions = [
        eq(swapOrders.id, order.id),
        eq(swapOrders.userId, order.userId),
        inArray(swapOrders.status, [...ACTIVE_STATUSES]),
        isNull(swapOrders.accountingTransactionId),
      ];

      if (expectedTxHash) conditions.push(eq(swapOrders.txHash, expectedTxHash));

      const [row] = await dbtx
        .update(swapOrders)
        .set({
          status,
          confirmations: 0,
          ...(status === 'FAILED' ? {} : { blockNumber: null }),
          updatedAt: new Date(),
        })
        .where(and(...conditions))
        .returning({ id: swapOrders.id });

      if (!row) return false;

      await dbtx.insert(swapEvents).values({
        orderId: order.id,
        type: status.toLowerCase(),
        payload,
      });

      await this.audit.log(
        {
          userId: order.userId,
          action: `swap.order_${status.toLowerCase()}`,
          entityType: 'swap_order',
          entityId: order.id,
          before: { status: order.status },
          after: { status, ...payload },
        },
        { executor: dbtx, strict: true },
      );

      return true;
    });
  }

  private async account(order: SwapOrder): Promise<void> {
    if (order.accountingTransactionId) return;

    if (order.status === 'CONFIRMED') {
      const latest = await this.rpc.getBlockNumber();
      const receipt = order.txHash ? await this.rpc.getTransactionReceipt(order.txHash) : null;

      if (latest === null) return;

      const blockMismatch =
        receipt !== null && order.blockNumber !== null && receipt.blockNumber !== order.blockNumber;

      if (
        !receipt ||
        !receipt.status ||
        latest - receipt.blockNumber + 1 < env.SWAP_CONFIRMATIONS ||
        blockMismatch
      ) {
        await this.revertConfirmed(
          order,
          receipt,
          latest,
          blockMismatch ? 'reorg_block_mismatch' : undefined,
        );
        return;
      }
    }

    if (order.errors.length > 0 && Date.now() - order.updatedAt.getTime() < 60_000) {
      return;
    }

    const tokenIn = getSwapToken(order.chain, order.tokenIn);
    const tokenOut = getSwapToken(order.chain, order.tokenOut);

    if (!tokenIn || !tokenOut) {
      await this.recordAccountingFailure(order, 'SWAP_ACCOUNTING_TOKEN_MISSING');
      return;
    }

    if (!order.executedAmountIn || !order.executedAmountOut) {
      await this.recordAccountingFailure(order, 'SWAP_ACCOUNTING_EXECUTED_AMOUNT_MISSING');
      return;
    }

    const routeSummary = order.routeSummary as Record<string, unknown>;
    const amountInUsd = normalizeUsd(order.amountInUsd) ?? normalizeUsd(routeSummary.amountInUsd);
    const amountOutUsd = normalizeUsd(routeSummary.amountOutUsd);

    if (!amountInUsd) {
      await this.recordAccountingFailure(order, 'SWAP_ACCOUNTING_USD_MISSING');
      return;
    }

    if (!amountOutUsd && !isCashEquivalentSymbol(tokenOut.symbol)) {
      await this.recordAccountingFailure(order, 'SWAP_ACCOUNTING_USD_MISSING');
      return;
    }

    if (!order.txHash) {
      await this.recordAccountingFailure(order, 'SWAP_ACCOUNTING_TX_MISSING');
      return;
    }

    const assetIn = await this.assets.ensureForSwapToken(
      order.chain,
      tokenIn,
      this.db,
      order.userId,
    );
    const assetOut = await this.assets.ensureForSwapToken(
      order.chain,
      tokenOut,
      this.db,
      order.userId,
    );

    const feeWei = BigInt(order.networkFeeWei ?? '0');
    const feeUsd = order.networkFeeUsd;

    if (feeWei > 0n && (!feeUsd || decimal(feeUsd).lte(0))) {
      await this.recordAccountingFailure(order, 'SWAP_ACCOUNTING_GAS_USD_MISSING');
      return;
    }

    let fee: { feeAssetId: string; feeAmount: string; feeUsdValue: string } | undefined;
    let bnbAssetId: string | null = null;

    if (feeWei > 0n && feeUsd && decimal(feeUsd).gt(0)) {
      const bnb = await this.assets.ensureForSwapToken(
        order.chain,
        {
          symbol: 'BNB',
          name: 'BNB',
          address: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE',
          decimals: 18,
          native: true,
        },
        this.db,
        order.userId,
      );

      bnbAssetId = bnb.id;
      fee = {
        feeAssetId: bnb.id,
        feeAmount: decimal(feeWei.toString()).div(BNB_WEI).toFixed(18),
        feeUsdValue: feeUsd,
      };
    }

    let accountId: string | null = order.accountId;

    if (accountId) {
      accountId = (await this.accounts.requireWalletForChain(order.userId, accountId, order.chain))
        .id;
    } else {
      const wallets = await this.accounts.walletsForChain(order.userId, order.chain);
      const requiredIn = decimal(order.executedAmountIn);
      const requiredGas = decimal(feeWei.toString()).div(BNB_WEI);

      for (const wallet of wallets) {
        const inputBalance = await this.accounts.balance(wallet.id, assetIn.id);

        if (decimal(inputBalance).lt(requiredIn)) continue;

        if (bnbAssetId && feeWei > 0n) {
          const gasBalance = await this.accounts.balance(wallet.id, bnbAssetId);

          if (decimal(gasBalance).lt(requiredGas)) continue;
        }

        accountId = wallet.id;
        break;
      }

      if (!accountId) {
        await this.recordAccountingFailure(order, 'SWAP_ACCOUNTING_NO_FUNDED_ACCOUNT');
        return;
      }

      await this.db
        .update(swapOrders)
        .set({ accountId, updatedAt: new Date() })
        .where(
          and(
            eq(swapOrders.id, order.id),
            eq(swapOrders.userId, order.userId),
            isNull(swapOrders.accountId),
          ),
        );

      await this.audit.log(
        {
          userId: order.userId,
          action: 'swap.accounting_account_selected',
          entityType: 'swap_order',
          entityId: order.id,
          after: { accountId },
        },
        { strict: true },
      );

      this.logger.log(`Swap ${order.id} accounting account selected: ${accountId}`);
    }

    const block = order.blockNumber ? await this.rpc.getBlock(order.blockNumber) : null;
    const occurredAt = block
      ? new Date(block.timestamp * 1000).toISOString()
      : (order.confirmedAt ?? new Date()).toISOString();

    const inUsd = usdString(decimal(amountInUsd).mul(order.executedAmountIn).div(order.amountIn));
    const outUsd = amountOutUsd
      ? usdString(decimal(amountOutUsd).mul(order.executedAmountOut).div(order.amountOut))
      : null;
    // Cash-equivalent legs must derive USD from the actual on-chain amount;
    // quote-derived USD can differ by rounding and the ledger rejects it.
    const usdValueIn = assetIn.isCashEquivalent ? undefined : inUsd;
    const usdValueOut = assetOut.isCashEquivalent || !outUsd ? undefined : outUsd;

    let result;

    try {
      result = await this.ledger.createManual(
        order.userId,
        {
          type: 'swap',
          accountId,
          assetInId: assetIn.id,
          amountIn: order.executedAmountIn,
          assetOutId: assetOut.id,
          amountOut: order.executedAmountOut,
          ...(usdValueIn ? { usdValueIn } : {}),
          ...(usdValueOut ? { usdValueOut } : {}),
          ...(fee ?? {}),
          occurredAt,
          notes: `KyberSwap ${tokenIn.symbol} -> ${tokenOut.symbol} (${order.txHash})`,
        },
        { userAgent: 'swap-tracker' },
        order.txHash,
        { source: 'kyberswap', sourceId: order.txHash },
      );
    } catch (error) {
      this.logger.warn(
        `Swap ${order.id} accounting failed: ${
          error instanceof Error ? error.message : 'unknown error'
        }`,
      );
      const code = this.accountingErrorCode(error);
      await this.recordAccountingFailure(order, code);
      return;
    }

    await this.db.transaction(async (dbtx) => {
      const [row] = await dbtx
        .update(swapOrders)
        .set({
          accountingTransactionId: result.transaction.id,
          tradeGroupId: result.transaction.tradeGroupId,
          errors: order.errors.filter((code) => !code.startsWith('SWAP_ACCOUNTING_')),
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(swapOrders.id, order.id),
            eq(swapOrders.userId, order.userId),
            eq(swapOrders.status, 'CONFIRMED'),
            isNull(swapOrders.accountingTransactionId),
          ),
        )
        .returning({ id: swapOrders.id });

      if (!row) return;

      await dbtx.insert(swapEvents).values({
        orderId: order.id,
        type: 'accounted',
        payload: {
          transactionId: result.transaction.id,
          tradeGroupId: result.transaction.tradeGroupId,
        },
      });

      await this.audit.log(
        {
          userId: order.userId,
          action: 'swap.order_accounted',
          entityType: 'swap_order',
          entityId: order.id,
          after: {
            transactionId: result.transaction.id,
            tradeGroupId: result.transaction.tradeGroupId,
            source: 'kyberswap',
          },
        },
        { executor: dbtx, strict: true },
      );
    });

    this.logger.log(
      `Swap ${order.id} accounted: transaction=${result.transaction.id} tradeGroup=${result.transaction.tradeGroupId ?? 'none'}`,
    );
  }

  private async revertConfirmed(
    order: SwapOrder,
    receipt: RpcReceipt | null,
    latestBlock: number | null,
    reason?: string,
  ): Promise<void> {
    const failed = receipt !== null && !receipt.status;
    const status = failed ? 'FAILED' : 'PENDING';
    const confirmations =
      receipt && latestBlock !== null ? Math.max(0, latestBlock - receipt.blockNumber + 1) : 0;

    await this.db.transaction(async (dbtx) => {
      const [row] = await dbtx
        .update(swapOrders)
        .set({
          status,
          confirmations,
          confirmedAt: null,
          blockNumber: null,
          executedAmountIn: null,
          executedAmountOut: null,
          networkFeeWei: null,
          networkFeeUsd: null,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(swapOrders.id, order.id),
            eq(swapOrders.userId, order.userId),
            eq(swapOrders.status, 'CONFIRMED'),
            isNull(swapOrders.accountingTransactionId),
          ),
        )
        .returning({ id: swapOrders.id });

      if (!row) return;

      await dbtx.insert(swapEvents).values({
        orderId: order.id,
        type: failed ? 'failed' : 'reorg',
        payload: {
          reason: failed
            ? 'receipt_failed_after_confirmation'
            : (reason ?? 'reorg_below_confirmations'),
          blockNumber: receipt?.blockNumber ?? null,
          confirmations,
        },
      });

      await this.audit.log(
        {
          userId: order.userId,
          action: failed ? 'swap.order_failed' : 'swap.order_reorg',
          entityType: 'swap_order',
          entityId: order.id,
          before: { status: 'CONFIRMED' },
          after: { status, confirmations },
        },
        { executor: dbtx, strict: true },
      );
    });
  }

  private accountingErrorCode(error: unknown): string {
    if (error && typeof error === 'object') {
      const candidate = error as {
        response?: { code?: unknown };
        getResponse?: () => unknown;
        code?: unknown;
        message?: unknown;
      };
      const response =
        typeof candidate.getResponse === 'function' ? candidate.getResponse() : candidate.response;
      const responseCode =
        response && typeof response === 'object'
          ? (response as { code?: unknown }).code
          : undefined;

      if (responseCode === 'NEGATIVE_BALANCE') {
        return 'SWAP_ACCOUNTING_NEGATIVE_BALANCE';
      }
      if (responseCode === 'INSUFFICIENT_LOTS') {
        return 'SWAP_ACCOUNTING_INSUFFICIENT_LOTS';
      }
      if (typeof responseCode === 'string') return responseCode;
      if (typeof candidate.code === 'string' && candidate.code.startsWith('SWAP_')) {
        return candidate.code;
      }
    }

    return 'SWAP_ACCOUNTING_FAILED';
  }

  private async recordAccountingFailure(order: SwapOrder, code: string): Promise<void> {
    const bounded = code.replaceAll(/[^A-Z0-9_]/g, '_').slice(0, 64);
    const exists = order.errors.includes(bounded);

    if (!exists) {
      this.logger.warn(`Swap ${order.id} accounting failed: ${bounded}`);
    }

    await this.db.transaction(async (dbtx) => {
      await dbtx
        .update(swapOrders)
        .set({
          errors: exists ? order.errors : [...order.errors, bounded].slice(-20),
          updatedAt: new Date(),
        })
        .where(and(eq(swapOrders.id, order.id), eq(swapOrders.userId, order.userId)));

      if (exists) return;

      await dbtx.insert(swapEvents).values({
        orderId: order.id,
        type: 'accounting_failed',
        payload: { code: bounded },
      });

      await this.audit.log(
        {
          userId: order.userId,
          action: 'swap.accounting_failed',
          entityType: 'swap_order',
          entityId: order.id,
          after: { code: bounded },
        },
        { executor: dbtx, strict: true },
      );
    });
  }
}

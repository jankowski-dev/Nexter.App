import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { and, asc, eq, inArray, isNotNull, isNull, lte, or, sql } from 'drizzle-orm';
import { swapEvents, swapOrders, type Database, type SwapOrder } from '@nexter/db';
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

  private async safeTrack(order: SwapOrder, latestBlock: number): Promise<void> {
    try {
      await this.track(order, latestBlock);
    } catch (error) {
      this.logger.warn(
        `Swap ${order.id} tracking failed: ${error instanceof Error ? error.message : 'unknown error'}`,
      );
    }
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
    const txHash = order.txHash;
    if (!txHash) return;

    const tx = await this.rpc.getTransactionByHash(txHash);

    if (!tx) {
      if (order.nonce !== null) {
        const count = await this.rpc.getTransactionCount(order.walletAddress ?? '');

        if (count !== null && count > order.nonce) {
          await this.mark(order, 'REPLACED', {
            reason: 'nonce_already_used',
            nonce: order.nonce,
            latestNonce: count,
          });
          return;
        }
      }

      if (
        order.submittedAt &&
        Date.now() - order.submittedAt.getTime() > env.SWAP_DROP_TIMEOUT_SECONDS * 1000
      ) {
        await this.mark(order, 'DROPPED', { reason: 'not_found_in_mempool_or_chain' });
      }
      return;
    }

    const mismatch = this.verifyTransaction(order, tx);
    if (mismatch) {
      await this.mark(order, 'FAILED', { reason: mismatch, txHash });
      return;
    }

    const receipt = await this.rpc.getTransactionReceipt(txHash);

    if (!receipt) {
      await this.setPending(order, tx, 0, latestBlock);
      return;
    }

    if (receipt.transactionHash && receipt.transactionHash.toLowerCase() !== txHash.toLowerCase()) {
      await this.mark(order, 'FAILED', { reason: 'receipt_hash_mismatch', txHash });
      return;
    }

    if (!receipt.status) {
      await this.mark(order, 'FAILED', {
        reason: 'receipt_failed',
        blockNumber: receipt.blockNumber,
      });
      return;
    }

    const confirmations = Math.max(0, latestBlock - receipt.blockNumber + 1);

    if (confirmations < env.SWAP_CONFIRMATIONS) {
      await this.setPending(order, tx, confirmations, latestBlock, receipt);
      return;
    }

    await this.confirm(order, tx, receipt, confirmations);
  }

  private verifyTransaction(order: SwapOrder, tx: RpcTransaction): string | null {
    if (!order.walletAddress || !order.routerAddress || !order.calldata || !order.txHash) {
      return 'missing_order_data';
    }

    if (tx.hash.toLowerCase() !== order.txHash.toLowerCase()) {
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
          updatedAt: confirmedAt,
        })
        .where(
          and(
            eq(swapOrders.id, order.id),
            eq(swapOrders.userId, order.userId),
            eq(swapOrders.status, order.status),
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
  ): Promise<void> {
    await this.db.transaction(async (dbtx) => {
      const [row] = await dbtx
        .update(swapOrders)
        .set({
          status,
          confirmations: 0,
          ...(status === 'FAILED' ? {} : { blockNumber: null }),
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(swapOrders.id, order.id),
            eq(swapOrders.userId, order.userId),
            inArray(swapOrders.status, [...ACTIVE_STATUSES]),
            isNull(swapOrders.accountingTransactionId),
          ),
        )
        .returning({ id: swapOrders.id });

      if (!row) return;

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

    const accountId = order.accountId
      ? (await this.accounts.requireWalletForChain(order.userId, order.accountId, order.chain)).id
      : (await this.accounts.defaultWalletForChain(order.userId, order.chain)).id;
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

      fee = {
        feeAssetId: bnb.id,
        feeAmount: decimal(feeWei.toString()).div(BNB_WEI).toFixed(18),
        feeUsdValue: feeUsd,
      };
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

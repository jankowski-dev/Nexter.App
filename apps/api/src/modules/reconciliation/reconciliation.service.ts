import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { and, desc, eq, inArray, isNotNull, isNull, or, sql } from 'drizzle-orm';
import {
  accounts,
  assets,
  chains,
  indexedTransfers,
  postings,
  reconciliationItems,
  reconciliationRuns,
  swapOrders,
  watchedAddresses,
  type Database,
  type ReconciliationItemStatus,
} from '@nexter/db';
import type {
  ReconciliationAddress,
  ReconciliationAddressCreate,
  ReconciliationIndexerStatus,
  ReconciliationItem,
  ReconciliationRun,
  ReconciliationRunRequest,
  ReconciliationRunsQuery,
} from '@nexter/contracts';
import { AuditService } from '../../shared/audit/audit.service';
import { env } from '../../shared/config/env';
import { DB } from '../../shared/db/db.module';
import { decimal } from '../../shared/money/decimal';
import { EvmRpcService } from '../swap/evm-rpc.service';
import { getSwapChain, nativeTokenForChain } from '../swap/token-registry';
import { AssetsService } from '../accounting/assets.service';

interface ReconciliationMeta {
  ip?: string;
  userAgent?: string;
}

const ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/;

function normalizeAddress(address: string): string {
  return address.toLowerCase();
}

function toContractAddress(row: typeof watchedAddresses.$inferSelect): ReconciliationAddress {
  return {
    id: row.id,
    chain: row.chain as ReconciliationAddress['chain'],
    address: row.address,
    label: row.label,
    enabled: row.enabled,
    lastIndexedBlock: row.lastIndexedBlock,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toContractItem(row: typeof reconciliationItems.$inferSelect): ReconciliationItem {
  return {
    id: row.id,
    symbol: row.symbol,
    contractAddress: row.contractAddress,
    ledgerBalance: row.ledgerBalance,
    onchainBalance: row.onchainBalance,
    delta: row.delta,
    status: row.status,
    details: row.details,
  };
}

function toContractRun(
  row: typeof reconciliationRuns.$inferSelect,
  items?: ReconciliationItem[],
): ReconciliationRun {
  return {
    id: row.id,
    chain: row.chain as ReconciliationRun['chain'],
    status: row.status,
    blockNumber: row.blockNumber,
    summary: row.summary,
    error: row.error,
    startedAt: row.startedAt.toISOString(),
    completedAt: row.completedAt?.toISOString() ?? null,
    ...(items ? { items } : {}),
  };
}

function itemStatus(ledger: string, onchain: string): ReconciliationItemStatus {
  const ledgerValue = decimal(ledger);
  const onchainValue = decimal(onchain);

  if (ledgerValue.eq(0) && onchainValue.eq(0)) return 'MATCH';
  if (ledgerValue.gt(0) && onchainValue.eq(0)) return 'MISSING_ONCHAIN';
  if (ledgerValue.eq(0) && onchainValue.gt(0)) return 'MISSING_LEDGER';
  return ledgerValue.minus(onchainValue).eq(0) ? 'MATCH' : 'MISMATCH';
}

@Injectable()
export class ReconciliationService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly rpc: EvmRpcService,
    private readonly assets: AssetsService,
    private readonly audit: AuditService,
  ) {}

  async addresses(userId: string): Promise<ReconciliationAddress[]> {
    const rows = await this.db
      .select()
      .from(watchedAddresses)
      .where(eq(watchedAddresses.userId, userId))
      .orderBy(watchedAddresses.chain, watchedAddresses.address);

    return rows.map(toContractAddress);
  }

  async addAddress(
    userId: string,
    input: ReconciliationAddressCreate,
    meta: ReconciliationMeta,
  ): Promise<ReconciliationAddress> {
    const chain = getSwapChain(input.chain);

    if (!chain) {
      throw new BadRequestException({
        code: 'RECONCILIATION_FAILED',
        message: 'Unsupported chain',
      });
    }

    if (!ADDRESS_PATTERN.test(input.address)) {
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: 'Invalid wallet address',
      });
    }

    const address = normalizeAddress(input.address);

    return this.db.transaction(async (tx) => {
      const [row] = await tx
        .insert(watchedAddresses)
        .values({
          userId,
          chain: input.chain,
          address,
          label: input.label ?? null,
          enabled: true,
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: [watchedAddresses.userId, watchedAddresses.chain, watchedAddresses.address],
          set: {
            label: input.label ?? null,
            enabled: true,
            updatedAt: new Date(),
          },
        })
        .returning();

      if (!row) throw new ConflictException({ code: 'CONFLICT', message: 'Address conflict' });

      await this.audit.log(
        {
          userId,
          action: 'reconciliation.address_upserted',
          entityType: 'watched_address',
          entityId: row.id,
          after: {
            chain: row.chain,
            address: row.address,
            label: row.label,
            enabled: row.enabled,
          },
          ip: meta.ip,
          userAgent: meta.userAgent,
        },
        { executor: tx, strict: true },
      );

      return toContractAddress(row);
    });
  }

  async listRuns(userId: string, query: ReconciliationRunsQuery): Promise<ReconciliationRun[]> {
    const conditions = [eq(reconciliationRuns.userId, userId)];

    if (query.chain) conditions.push(eq(reconciliationRuns.chain, query.chain));

    const rows = await this.db
      .select()
      .from(reconciliationRuns)
      .where(and(...conditions))
      .orderBy(desc(reconciliationRuns.startedAt))
      .limit(query.limit);

    return rows.map((row) => toContractRun(row));
  }

  async getRun(userId: string, runId: string): Promise<ReconciliationRun> {
    const [run] = await this.db
      .select()
      .from(reconciliationRuns)
      .where(and(eq(reconciliationRuns.id, runId), eq(reconciliationRuns.userId, userId)))
      .limit(1);

    if (!run) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Reconciliation run not found' });
    }

    const items = await this.db
      .select()
      .from(reconciliationItems)
      .where(eq(reconciliationItems.runId, runId))
      .orderBy(reconciliationItems.symbol);

    return toContractRun(run, items.map(toContractItem));
  }

  async indexerStatus(userId: string): Promise<ReconciliationIndexerStatus[]> {
    const watched = await this.db
      .select()
      .from(watchedAddresses)
      .where(and(eq(watchedAddresses.userId, userId), eq(watchedAddresses.enabled, true)));

    const chainsToCheck = new Set(watched.map((row) => row.chain));
    const result: ReconciliationIndexerStatus[] = [];

    for (const chain of chainsToCheck) {
      const chainAddresses = watched.filter((row) => row.chain === chain);
      const addresses = chainAddresses.map((row) => row.address);
      const [count] = await this.db
        .select({ count: sql<string>`count(*)::text` })
        .from(indexedTransfers)
        .where(
          and(
            eq(indexedTransfers.chain, chain),
            or(
              inArray(indexedTransfers.fromAddress, addresses),
              inArray(indexedTransfers.toAddress, addresses),
            ),
          ),
        );
      const latestBlock = await this.rpc.getBlockNumber(chain);
      const lastIndexed = chainAddresses.reduce<number | null>((current, row) => {
        if (row.lastIndexedBlock === null) return current;
        return current === null ? row.lastIndexedBlock : Math.max(current, row.lastIndexedBlock);
      }, null);

      result.push({
        chain: chain as ReconciliationIndexerStatus['chain'],
        rpcConfigured: this.rpc.configuredFor(chain),
        watchedAddresses: chainAddresses.length,
        indexedTransfers: Number(count?.count ?? '0'),
        lastIndexedBlock: lastIndexed,
        latestBlock,
      });
    }

    return result.sort((a, b) => a.chain.localeCompare(b.chain));
  }

  async run(
    userId: string,
    input: ReconciliationRunRequest,
    meta: ReconciliationMeta,
  ): Promise<ReconciliationRun> {
    if (!env.RECONCILIATION_ENABLED) {
      throw new ServiceUnavailableException({
        code: 'RECONCILIATION_DISABLED',
        message: 'On-chain reconciliation is disabled',
      });
    }

    const chain = getSwapChain(input.chain);

    if (!chain) {
      throw new BadRequestException({
        code: 'RECONCILIATION_FAILED',
        message: 'Unsupported chain',
      });
    }

    await this.ensureWatchedFromSwapOrders(userId, input.chain, meta);
    const watches = await this.db
      .select()
      .from(watchedAddresses)
      .where(
        and(
          eq(watchedAddresses.userId, userId),
          eq(watchedAddresses.chain, input.chain),
          eq(watchedAddresses.enabled, true),
        ),
      );

    if (watches.length === 0) {
      throw new BadRequestException({
        code: 'RECONCILIATION_NO_ADDRESSES',
        message: 'No watch-only addresses are configured',
      });
    }

    const [created] = await this.db
      .insert(reconciliationRuns)
      .values({ userId, chain: input.chain, status: 'RUNNING' })
      .returning();

    if (!created) throw new Error('Failed to create reconciliation run');

    try {
      const gasBackfilled = await this.backfillGas(userId, input.chain, meta);
      const latestBlock = await this.rpc.getBlockNumber(input.chain);

      if (latestBlock === null) {
        throw new ServiceUnavailableException({
          code: 'RECONCILIATION_FAILED',
          message: 'RPC is unavailable for this chain',
        });
      }

      await this.assets.ensureForSwapToken(
        input.chain,
        nativeTokenForChain(input.chain),
        this.db,
        userId,
      );

      const assetRows = await this.db
        .select({
          id: assets.id,
          symbol: assets.symbol,
          contractAddress: assets.contractAddress,
          decimals: assets.decimals,
        })
        .from(assets)
        .innerJoin(chains, eq(assets.chainId, chains.id))
        .where(eq(chains.code, input.chain))
        .orderBy(assets.symbol);

      const ledgerRows = await this.db
        .select({
          assetId: postings.assetId,
          balance: sql<string>`coalesce(sum(${postings.amount}), 0)::text`,
        })
        .from(postings)
        .innerJoin(accounts, eq(accounts.id, postings.accountId))
        .innerJoin(assets, eq(assets.id, postings.assetId))
        .innerJoin(chains, eq(chains.id, assets.chainId))
        .where(
          and(
            eq(accounts.userId, userId),
            eq(accounts.type, 'wallet'),
            eq(chains.code, input.chain),
          ),
        )
        .groupBy(postings.assetId);
      const ledgerByAsset = new Map(ledgerRows.map((row) => [row.assetId, row.balance]));

      const items: Array<typeof reconciliationItems.$inferInsert> = [];
      const summary = {
        addresses: watches.map((row) => row.address),
        blockNumber: latestBlock,
        assets: assetRows.length,
        matches: 0,
        mismatches: 0,
        missingOnchain: 0,
        missingLedger: 0,
        gasBackfilled,
      };

      for (const asset of assetRows) {
        let onchain = decimal('0');

        for (const watch of watches) {
          const raw = asset.contractAddress
            ? await this.rpc.getErc20Balance(input.chain, asset.contractAddress, watch.address)
            : await this.rpc.getNativeBalance(input.chain, watch.address);

          if (raw === null) {
            throw new ServiceUnavailableException({
              code: 'RECONCILIATION_FAILED',
              message: 'RPC returned an incomplete balance',
            });
          }

          onchain = onchain.plus(decimal(raw).div(decimal('10').pow(String(asset.decimals))));
        }

        const ledgerBalance = decimal(ledgerByAsset.get(asset.id) ?? '0');
        const onchainBalance = onchain;
        const delta = ledgerBalance.minus(onchainBalance);
        const status = itemStatus(
          ledgerBalance.toFixed(asset.decimals),
          onchainBalance.toFixed(asset.decimals),
        );

        if (ledgerBalance.eq(0) && onchainBalance.eq(0)) continue;

        if (status === 'MATCH') summary.matches += 1;
        else if (status === 'MISSING_ONCHAIN') summary.missingOnchain += 1;
        else if (status === 'MISSING_LEDGER') summary.missingLedger += 1;
        else summary.mismatches += 1;

        items.push({
          runId: created.id,
          assetId: asset.id,
          symbol: asset.symbol,
          contractAddress: asset.contractAddress,
          ledgerBalance: ledgerBalance.toFixed(asset.decimals),
          onchainBalance: onchainBalance.toFixed(asset.decimals),
          delta: delta.toFixed(asset.decimals),
          status,
          details: {
            decimals: asset.decimals,
            addresses: watches.map((row) => row.address),
          },
        });
      }

      await this.db.transaction(async (tx) => {
        if (items.length > 0) await tx.insert(reconciliationItems).values(items);

        await tx
          .update(reconciliationRuns)
          .set({
            status: 'COMPLETED',
            blockNumber: latestBlock,
            completedAt: new Date(),
            summary,
          })
          .where(eq(reconciliationRuns.id, created.id));

        await this.audit.log(
          {
            userId,
            action: 'reconciliation.completed',
            entityType: 'reconciliation_run',
            entityId: created.id,
            after: { chain: input.chain, ...summary },
            ip: meta.ip,
            userAgent: meta.userAgent,
          },
          { executor: tx, strict: true },
        );
      });

      return this.getRun(userId, created.id);
    } catch (error) {
      const message =
        error instanceof Error ? error.message.slice(0, 500) : 'Reconciliation failed';

      await this.db.transaction(async (tx) => {
        await tx
          .update(reconciliationRuns)
          .set({
            status: 'FAILED',
            error: message,
            completedAt: new Date(),
          })
          .where(eq(reconciliationRuns.id, created.id));

        await this.audit.log(
          {
            userId,
            action: 'reconciliation.failed',
            entityType: 'reconciliation_run',
            entityId: created.id,
            after: { chain: input.chain, error: message },
            ip: meta.ip,
            userAgent: meta.userAgent,
          },
          { executor: tx, strict: true },
        );
      });

      throw error;
    }
  }

  private async ensureWatchedFromSwapOrders(
    userId: string,
    chain: string,
    meta: ReconciliationMeta,
  ): Promise<void> {
    const rows = await this.db
      .select({ walletAddress: swapOrders.walletAddress })
      .from(swapOrders)
      .where(
        and(
          eq(swapOrders.userId, userId),
          eq(swapOrders.chain, chain),
          isNotNull(swapOrders.walletAddress),
        ),
      );
    const addresses = [...new Set(rows.map((row) => row.walletAddress as string))];

    if (addresses.length === 0) return;

    await this.db.transaction(async (tx) => {
      const created = await tx
        .insert(watchedAddresses)
        .values(
          addresses.map((address) => ({
            userId,
            chain,
            address: normalizeAddress(address),
            label: 'KyberSwap wallet',
            enabled: true,
            updatedAt: new Date(),
          })),
        )
        .onConflictDoNothing({
          target: [watchedAddresses.userId, watchedAddresses.chain, watchedAddresses.address],
        })
        .returning();

      for (const row of created) {
        await this.audit.log(
          {
            userId,
            action: 'reconciliation.address_auto_added',
            entityType: 'watched_address',
            entityId: row.id,
            after: { chain: row.chain, address: row.address, label: row.label },
            ip: meta.ip,
            userAgent: meta.userAgent,
          },
          { executor: tx, strict: true },
        );
      }
    });
  }

  private async backfillGas(
    userId: string,
    chain: string,
    meta: ReconciliationMeta,
  ): Promise<number> {
    const orders = await this.db
      .select()
      .from(swapOrders)
      .where(
        and(
          eq(swapOrders.userId, userId),
          eq(swapOrders.chain, chain),
          eq(swapOrders.status, 'CONFIRMED'),
          isNotNull(swapOrders.txHash),
          isNull(swapOrders.networkFeeWei),
        ),
      )
      .limit(50);
    let backfilled = 0;

    for (const order of orders) {
      const receipt = await this.rpc.getTransactionReceipt(chain, order.txHash as string);

      if (!receipt || !receipt.effectiveGasPrice) continue;

      let feeWei: bigint;

      try {
        feeWei = BigInt(receipt.gasUsed) * BigInt(receipt.effectiveGasPrice);
      } catch {
        continue;
      }

      const updated = await this.db.transaction(async (tx) => {
        const [row] = await tx
          .update(swapOrders)
          .set({ networkFeeWei: feeWei.toString(), updatedAt: new Date() })
          .where(
            and(
              eq(swapOrders.id, order.id),
              eq(swapOrders.userId, userId),
              isNull(swapOrders.networkFeeWei),
            ),
          )
          .returning({ id: swapOrders.id });

        if (!row) return false;

        await this.audit.log(
          {
            userId,
            action: 'swap.gas_backfilled',
            entityType: 'swap_order',
            entityId: order.id,
            after: { networkFeeWei: feeWei.toString(), txHash: order.txHash },
            ip: meta.ip,
            userAgent: meta.userAgent,
          },
          { executor: tx, strict: true },
        );

        return true;
      });

      if (updated) backfilled += 1;
    }

    return backfilled;
  }
}

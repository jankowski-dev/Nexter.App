import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { and, eq, isNotNull } from 'drizzle-orm';
import {
  assets,
  chains,
  indexedTransfers,
  watchedAddresses,
  type Database,
  type DbExecutor,
} from '@nexter/db';
import type { Pool, PoolClient } from 'pg';
import { AuditService } from '../../shared/audit/audit.service';
import { env } from '../../shared/config/env';
import { DB, DB_POOL } from '../../shared/db/db.module';
import { EvmRpcService, type RpcLog } from '../swap/evm-rpc.service';
import { getSwapChain } from '../swap/token-registry';

const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const INDEXER_LOCK_KEY = '5712345678901236';

function padTopicAddress(address: string): string {
  return `0x${address.toLowerCase().replace(/^0x/, '').padStart(64, '0')}`;
}

function topicAddress(topic: string | undefined): string | null {
  if (!topic || !/^0x[0-9a-fA-F]{64}$/.test(topic)) return null;
  return `0x${topic.slice(-40).toLowerCase()}`;
}

@Injectable()
export class OnchainIndexerService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(OnchainIndexerService.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(DB_POOL) private readonly pool: Pool,
    private readonly rpc: EvmRpcService,
    private readonly audit: AuditService,
  ) {}

  onApplicationBootstrap(): void {
    if (env.NODE_ENV === 'test' || !env.RECONCILIATION_ENABLED || !this.rpc.configured) return;

    this.timer = setInterval(() => {
      void this.tick();
    }, env.RECONCILIATION_INDEX_INTERVAL_SECONDS * 1000);
    this.timer.unref();
    this.logger.log(
      `On-chain indexer started (${env.RECONCILIATION_INDEX_INTERVAL_SECONDS}s interval)`,
    );
  }

  onApplicationShutdown(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async tick(): Promise<void> {
    if (this.running || !env.RECONCILIATION_ENABLED) return;
    this.running = true;
    let client: PoolClient | null = null;
    let locked = false;
    let destroyConnection = false;

    try {
      client = await this.pool.connect();
      const lease = await client.query<{ locked: boolean }>(
        'select pg_try_advisory_lock($1::bigint) as locked',
        [INDEXER_LOCK_KEY],
      );

      locked = lease.rows[0]?.locked === true;
      if (!locked) return;

      await this.indexAll();
    } catch (error) {
      this.logger.warn(
        `On-chain indexer tick failed: ${error instanceof Error ? error.message : 'unknown error'}`,
      );
    } finally {
      if (client) {
        if (locked) {
          try {
            await client.query('select pg_advisory_unlock($1::bigint)', [INDEXER_LOCK_KEY]);
          } catch (error) {
            destroyConnection = true;
            this.logger.warn(
              `On-chain indexer advisory unlock failed: ${
                error instanceof Error ? error.message : 'unknown error'
              }`,
            );
          }
        }
        client.release(destroyConnection);
      }
      this.running = false;
    }
  }

  private async indexAll(): Promise<void> {
    const watches = await this.db
      .select()
      .from(watchedAddresses)
      .where(eq(watchedAddresses.enabled, true))
      .orderBy(watchedAddresses.chain, watchedAddresses.createdAt);

    const byChain = new Map<string, typeof watches>();
    for (const watch of watches) {
      const list = byChain.get(watch.chain) ?? [];
      list.push(watch);
      byChain.set(watch.chain, list);
    }

    for (const [chain, chainWatches] of byChain) {
      if (!this.rpc.configuredFor(chain)) continue;

      const latest = await this.rpc.getBlockNumber(chain);
      if (latest === null) continue;

      const chainConfig = getSwapChain(chain);
      const assetRows = await this.db
        .select({ address: assets.contractAddress })
        .from(assets)
        .innerJoin(chains, eq(assets.chainId, chains.id))
        .where(and(eq(chains.code, chain), isNotNull(assets.contractAddress)));
      const tokenAddresses = [
        ...new Set([
          ...(chainConfig?.tokens.filter((token) => !token.native).map((token) => token.address) ??
            []),
          ...assetRows.map((row) => row.address as string),
        ]),
      ].map((address) => address.toLowerCase());

      for (const watch of chainWatches) {
        const from =
          watch.lastIndexedBlock === null
            ? Math.max(0, latest - env.RECONCILIATION_LOOKBACK_BLOCKS)
            : watch.lastIndexedBlock + 1;

        if (from > latest) continue;

        const to = Math.min(latest, from + env.RECONCILIATION_MAX_BLOCKS_PER_TICK - 1);

        try {
          const indexed = await this.indexRange(chain, watch.address, from, to, tokenAddresses);
          await this.db
            .update(watchedAddresses)
            .set({ lastIndexedBlock: to, updatedAt: new Date() })
            .where(eq(watchedAddresses.id, watch.id));

          if (indexed > 0) {
            await this.audit.log(
              {
                userId: watch.userId,
                action: 'reconciliation.indexer_tick',
                entityType: 'watched_address',
                entityId: watch.id,
                after: { chain, address: watch.address, fromBlock: from, toBlock: to, indexed },
              },
              { strict: true },
            );
          }
        } catch (error) {
          this.logger.warn(
            `Indexer failed for ${chain} ${watch.address}: ${
              error instanceof Error ? error.message : 'unknown error'
            }`,
          );
        }
      }
    }
  }

  private async indexRange(
    chain: string,
    address: string,
    fromBlock: number,
    toBlock: number,
    tokenAddresses: string[],
  ): Promise<number> {
    const padded = padTopicAddress(address);
    const incoming =
      tokenAddresses.length > 0
        ? await this.rpc.getLogs(chain, {
            fromBlock,
            toBlock,
            address: tokenAddresses,
            topics: [TRANSFER_TOPIC, null, padded],
          })
        : [];
    const outgoing =
      tokenAddresses.length > 0
        ? await this.rpc.getLogs(chain, {
            fromBlock,
            toBlock,
            address: tokenAddresses,
            topics: [TRANSFER_TOPIC, padded],
          })
        : [];
    const logs = new Map<string, RpcLog>();

    for (const log of [...incoming, ...outgoing]) {
      if (!log.transactionHash || log.logIndex === undefined) continue;
      logs.set(`${log.transactionHash.toLowerCase()}:${log.logIndex}`, log);
    }

    let indexed = 0;

    for (const log of logs.values()) {
      if (log.topics.length < 3) continue;
      const from = topicAddress(log.topics[1]);
      const to = topicAddress(log.topics[2]);

      if (!from || !to) continue;

      if (!/^0x[0-9a-fA-F]{64}$/.test(log.data)) continue;

      let amount: string;
      try {
        amount = BigInt(log.data).toString();
      } catch {
        continue;
      }

      if (amount.length > 78) continue;

      const txHash = log.transactionHash!.toLowerCase();
      const created = await this.insertTransfer(this.db, {
        chain,
        eventKey: `${chain}:${txHash}:${log.logIndex}`,
        txHash,
        logIndex: log.logIndex!,
        blockNumber: log.blockNumber ?? fromBlock,
        blockHash: log.blockHash ?? null,
        fromAddress: from,
        toAddress: to,
        assetAddress: log.address.toLowerCase(),
        amount,
      });

      if (created) indexed += 1;
    }

    for (let blockNumber = fromBlock; blockNumber <= toBlock; blockNumber += 1) {
      const transactions = await this.rpc.getBlockTransactions(chain, blockNumber);

      for (const tx of transactions) {
        if (!tx.to) continue;
        if (
          tx.from.toLowerCase() !== address.toLowerCase() &&
          tx.to.toLowerCase() !== address.toLowerCase()
        ) {
          continue;
        }

        let amount: string;
        try {
          const value = BigInt(tx.value || '0x0');
          if (value === 0n) continue;
          amount = value.toString();
          if (amount.length > 78) continue;
        } catch {
          continue;
        }

        const created = await this.insertTransfer(this.db, {
          chain,
          eventKey: `${chain}:${tx.hash.toLowerCase()}:native`,
          txHash: tx.hash.toLowerCase(),
          logIndex: -1,
          blockNumber: tx.blockNumber ?? blockNumber,
          blockHash: null,
          fromAddress: tx.from.toLowerCase(),
          toAddress: tx.to.toLowerCase(),
          assetAddress: null,
          amount,
        });

        if (created) indexed += 1;
      }
    }

    return indexed;
  }

  private async insertTransfer(
    executor: DbExecutor,
    value: typeof indexedTransfers.$inferInsert,
  ): Promise<boolean> {
    const [row] = await executor
      .insert(indexedTransfers)
      .values(value)
      .onConflictDoNothing({ target: indexedTransfers.eventKey })
      .returning({ id: indexedTransfers.id });

    return Boolean(row);
  }
}

import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, eq, gt, inArray, isNull, ne, or, sql } from 'drizzle-orm';
import {
  accounts,
  assets,
  chains,
  importRows,
  imports,
  lotConsumptions,
  lots,
  postings,
  prices,
  tradeDetails,
  tradeGroups,
  transactions,
  type Database,
  type DbExecutor,
  type TradeGroupStatus,
} from '@nexter/db';
import type {
  ImportReconciliationResponse,
  ImportResponse,
  ImportRowStatus,
  ImportStatus,
  ImportSummary,
  ImportsResponse,
  NotionImportRequest,
} from '@nexter/contracts';
import { AuditService } from '../../shared/audit/audit.service';
import { DB } from '../../shared/db/db.module';
import { Decimal, amountString, decimal, usdString } from '../../shared/money/decimal';
import { AccountingBootstrapService } from '../accounting/accounting-bootstrap.service';
import {
  parseNotionExport,
  payloadHash,
  type NormalizedOrder,
  type NormalizedSource,
  type NormalizedTransaction,
} from './notion-import.parser';

export interface ImportMeta {
  ip?: string;
  userAgent?: string;
}

const NOTION = 'notion';
const BSC = 'bsc';
const QUALITY_FLAGS = {
  chainKnown: false,
  contractKnown: false,
  networkFeeIncluded: false,
  priceSource: 'notion',
  reconciled: false,
  assetVerified: false,
};

const buySourceId = (orderId: string) => `notion:order:${orderId}:buy`;
const sellSourceId = (orderId: string) => `notion:order:${orderId}:sell`;
const cashSourceId = (pageId: string) => `notion:transaction:${pageId}`;

interface RowDecision {
  status: ImportRowStatus;
  error: string | null;
}

interface Detection {
  orderDecisions: Map<string, RowDecision>;
  transactionDecisions: Map<string, RowDecision>;
  newOrders: number;
  updatedOrders: number;
  skippedOrders: number;
  newTransactions: number;
  skippedTransactions: number;
  newAssets: number;
  reusedAssets: number;
  errors: string[];
  warnings: string[];
}

interface ImportRowSeed {
  entityType: 'source' | 'order' | 'transaction';
  sourceId: string;
  data: Record<string, unknown>;
  status: ImportRowStatus;
  error: string | null;
}

@Injectable()
export class NotionImportService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly bootstrap: AccountingBootstrapService,
    private readonly audit: AuditService,
  ) {}

  async preview(
    userId: string,
    payload: NotionImportRequest,
    meta: ImportMeta,
  ): Promise<ImportResponse> {
    const parsed = parseNotionExport(payload);
    const hash = payloadHash({
      source: payload.source,
      orders: payload.orders,
      transactions: payload.transactions,
    });

    const importId = await this.db.transaction(async (tx) => {
      await this.lockUser(userId, tx);

      const [existing] = await tx
        .select()
        .from(imports)
        .where(
          and(eq(imports.userId, userId), eq(imports.source, NOTION), eq(imports.sourceHash, hash)),
        )
        .limit(1)
        .for('update');

      if (existing?.status === 'committed') {
        throw new ConflictException({
          code: 'CONFLICT',
          message: 'This Notion export has already been committed',
        });
      }

      const detection = await this.detectExisting(userId, parsed.parsed, tx);
      const summary: ImportSummary = {
        ...parsed.parsed.summary,
        counts: {
          ...parsed.parsed.summary.counts,
          newOrders: detection.newOrders,
          updatedOrders: detection.updatedOrders,
          skippedOrders: detection.skippedOrders,
          newTransactions: detection.newTransactions,
          skippedTransactions: detection.skippedTransactions,
          newAssets: detection.newAssets,
          reusedAssets: detection.reusedAssets,
        },
        warnings: [...parsed.parsed.summary.warnings, ...detection.warnings],
        errors: [...parsed.parsed.summary.errors, ...detection.errors],
      };

      const rowSeeds: ImportRowSeed[] = [
        ...parsed.parsed.source.map((row) => ({
          entityType: 'source' as const,
          sourceId: row.sourceId,
          data: row as unknown as Record<string, unknown>,
          status: 'pending' as const,
          error: null,
        })),
        ...parsed.parsed.orders.map((row) => {
          const decision = detection.orderDecisions.get(row.sourceId) ?? {
            status: 'pending',
            error: null,
          };

          return {
            entityType: 'order' as const,
            sourceId: row.sourceId,
            data: row as unknown as Record<string, unknown>,
            status: decision.status,
            error: decision.error,
          };
        }),
        ...parsed.parsed.transactions.map((row) => {
          const decision = detection.transactionDecisions.get(row.sourceId) ?? {
            status: 'pending',
            error: null,
          };

          return {
            entityType: 'transaction' as const,
            sourceId: row.sourceId,
            data: row as unknown as Record<string, unknown>,
            status: decision.status,
            error: decision.error,
          };
        }),
      ];

      let id: string;
      let action: string;

      if (existing) {
        await tx.delete(importRows).where(eq(importRows.importId, existing.id));
        await tx
          .update(imports)
          .set({
            status: 'preview',
            fileName: payload.fileName ?? null,
            summary,
            committedAt: null,
            rolledBackAt: null,
          })
          .where(eq(imports.id, existing.id));
        id = existing.id;
        action = 'import.notion_preview_refreshed';
      } else {
        const [created] = await tx
          .insert(imports)
          .values({
            userId,
            source: NOTION,
            status: 'preview',
            sourceHash: hash,
            fileName: payload.fileName ?? null,
            summary,
          })
          .returning({ id: imports.id });

        if (!created) throw new Error('Failed to create import preview');
        id = created.id;
        action = 'import.notion_previewed';
      }

      await tx.insert(importRows).values(
        rowSeeds.map((row) => ({
          importId: id,
          entityType: row.entityType,
          sourceId: row.sourceId,
          sourceHash: payloadHash(row.data),
          status: row.status,
          data: row.data,
          error: row.error,
        })),
      );

      await this.audit.log(
        {
          userId,
          action,
          entityType: 'import',
          entityId: id,
          after: summary,
          ip: meta.ip,
          userAgent: meta.userAgent,
        },
        { executor: tx, strict: true },
      );

      return id;
    });

    return this.get(userId, importId);
  }

  async commit(userId: string, importId: string, meta: ImportMeta): Promise<ImportResponse> {
    await this.db.transaction(async (tx) => {
      await this.lockUser(userId, tx);

      const [importRecord] = await tx
        .select()
        .from(imports)
        .where(and(eq(imports.id, importId), eq(imports.userId, userId)))
        .limit(1)
        .for('update');

      if (!importRecord) {
        throw new NotFoundException({ code: 'NOT_FOUND', message: 'Import not found' });
      }
      if (importRecord.status !== 'preview') {
        throw new ConflictException({
          code: 'CONFLICT',
          message: `Import is ${importRecord.status}`,
        });
      }

      const summary = importRecord.summary as unknown as ImportSummary;
      const rows = await tx.select().from(importRows).where(eq(importRows.importId, importId));
      const rowErrors = rows
        .filter((row) => row.status === 'error')
        .map((row) => row.error)
        .filter((error): error is string => Boolean(error));

      if (summary.errors.length > 0) {
        if (rowErrors.length > 0) {
          throw new ConflictException({
            code: 'IMPORT_CONFLICT',
            message: 'Import has conflicts and cannot be committed',
            details: rowErrors,
          });
        }

        throw new BadRequestException({
          code: 'VALIDATION_ERROR',
          message: 'Import has errors and cannot be committed',
          details: summary.errors,
        });
      }

      await this.bootstrap.ensureDefaults(userId, tx, meta, true);

      const [chain] = await tx.select().from(chains).where(eq(chains.code, BSC)).limit(1);

      if (!chain) throw new Error('BSC chain is not seeded');

      const wallet = await this.requireAccount(userId, 'Tangem BSC', tx);
      const external = await this.requireAccount(userId, 'External', tx);
      const usdt = await this.ensureAsset(
        {
          symbol: 'USDT',
          name: 'Tether USD',
          coingeckoId: 'tether',
          description: null,
          priceUsd: null,
          isStablecoin: true,
          sourceId: null,
          raw: {},
        },
        chain.id,
        tx,
      );

      const sourceData = rows
        .filter((row) => row.entityType === 'source')
        .map((row) => row.data as unknown as NormalizedSource);
      const orderData = rows
        .filter((row) => row.entityType === 'order')
        .map((row) => row.data as unknown as NormalizedOrder)
        .sort((a, b) => a.openedAt.localeCompare(b.openedAt) || a.orderId.localeCompare(b.orderId));
      const transactionData = rows
        .filter((row) => row.entityType === 'transaction')
        .map((row) => row.data as unknown as NormalizedTransaction)
        .sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));

      // Preview statuses can become stale if another import was rolled back or
      // committed, or if manual activity changed an existing lot. Re-detect
      // under the user lock before writing anything to the ledger.
      const detection = await this.detectExisting(
        userId,
        { source: sourceData, orders: orderData, transactions: transactionData },
        tx,
      );

      if (detection.errors.length > 0) {
        throw new ConflictException({
          code: 'IMPORT_CONFLICT',
          message: 'Import state changed since preview; re-preview the export',
          details: detection.errors,
        });
      }

      for (const order of orderData) {
        const decision = detection.orderDecisions.get(order.sourceId) ?? {
          status: 'pending' as const,
          error: null,
        };
        await this.markRow(
          importId,
          'order',
          order.sourceId,
          decision.status,
          null,
          decision.error,
          tx,
        );
      }

      for (const transaction of transactionData) {
        const decision = detection.transactionDecisions.get(transaction.sourceId) ?? {
          status: 'pending' as const,
          error: null,
        };
        await this.markRow(
          importId,
          'transaction',
          transaction.sourceId,
          decision.status,
          null,
          decision.error,
          tx,
        );
      }

      const refreshedSummary: ImportSummary = {
        ...summary,
        counts: {
          ...summary.counts,
          newOrders: detection.newOrders,
          updatedOrders: detection.updatedOrders,
          skippedOrders: detection.skippedOrders,
          newTransactions: detection.newTransactions,
          skippedTransactions: detection.skippedTransactions,
          newAssets: detection.newAssets,
          reusedAssets: detection.reusedAssets,
        },
        warnings: [
          ...summary.warnings,
          ...detection.warnings.filter((warning) => !summary.warnings.includes(warning)),
        ],
      };

      await tx.update(imports).set({ summary: refreshedSummary }).where(eq(imports.id, importId));

      const sourceRows = sourceData;
      const orderRows = orderData.filter(
        (order) => detection.orderDecisions.get(order.sourceId)?.status === 'pending',
      );
      const transactionRows = transactionData.filter(
        (transaction) =>
          detection.transactionDecisions.get(transaction.sourceId)?.status === 'pending',
      );

      const assetBySymbol = new Map<string, typeof assets.$inferSelect>();
      assetBySymbol.set('USDT', usdt);

      for (const source of sourceRows) {
        const asset = await this.ensureAsset(source, chain.id, tx);
        assetBySymbol.set(source.symbol, asset);
      }

      for (const order of orderRows) {
        if (!assetBySymbol.has(order.destinationSymbol)) {
          const asset = await this.ensureAsset(
            {
              symbol: order.destinationSymbol,
              name: order.destinationSymbol,
              coingeckoId: null,
              description: null,
              priceUsd: null,
              isStablecoin: false,
              sourceId: null,
              raw: {},
            },
            chain.id,
            tx,
          );
          assetBySymbol.set(order.destinationSymbol, asset);
        }
      }

      const observedAt = new Date();
      const pricedAssetIds = new Set<string>();

      for (const source of sourceRows) {
        const asset = assetBySymbol.get(source.symbol);

        if (!asset) throw new Error(`Asset ${source.symbol} was not created`);

        if (source.priceUsd && !asset.isCashEquivalent && !pricedAssetIds.has(asset.id)) {
          pricedAssetIds.add(asset.id);
          await tx.insert(prices).values({
            assetId: asset.id,
            priceUsd: usdString(decimal(source.priceUsd)),
            observedAt,
            source: NOTION,
            importId,
          });
        }

        await this.markRow(importId, 'source', source.sourceId, 'imported', null, null, tx);
      }

      const existingOrderTransactions = await this.loadExistingOrderTransactions(
        userId,
        orderRows,
        tx,
      );
      const existingBuyTransactionIds = orderRows
        .map((order) => existingOrderTransactions.get(buySourceId(order.orderId)))
        .flatMap((row) => (row ? [row.id] : []));
      const existingGroupIds = [
        ...new Set(
          orderRows
            .map((order) => existingOrderTransactions.get(buySourceId(order.orderId)))
            .map((row) => row?.tradeGroupId)
            .filter((id): id is string => Boolean(id)),
        ),
      ];
      const groupRows =
        existingGroupIds.length === 0
          ? []
          : await tx.select().from(tradeGroups).where(inArray(tradeGroups.id, existingGroupIds));
      const groupById = new Map(groupRows.map((row) => [row.id, row]));
      const existingLotRows =
        existingBuyTransactionIds.length === 0
          ? []
          : await tx
              .select()
              .from(lots)
              .where(inArray(lots.acquisitionTransactionId, existingBuyTransactionIds))
              .for('update');
      const lotByBuyTransaction = new Map(
        existingLotRows.map((row) => [row.acquisitionTransactionId, row]),
      );

      for (const transaction of transactionRows) {
        await this.insertCashTransaction(
          userId,
          importId,
          wallet.id,
          external.id,
          usdt.id,
          transaction,
          tx,
        );
      }

      for (const order of orderRows) {
        const asset = assetBySymbol.get(order.destinationSymbol);

        if (!asset) {
          throw new BadRequestException({
            code: 'VALIDATION_ERROR',
            message: `Asset ${order.destinationSymbol} is not available`,
          });
        }

        const existingBuy = existingOrderTransactions.get(buySourceId(order.orderId));
        const existingSell = existingOrderTransactions.get(sellSourceId(order.orderId));

        if (existingBuy && existingSell) {
          continue;
        }
        if (existingSell && !existingBuy) {
          throw new ConflictException({
            code: 'IMPORT_CONFLICT',
            message: `Order ${order.orderId}: sell exists without buy`,
          });
        }

        if (existingBuy) {
          await this.reconcileExistingOrder(
            userId,
            importId,
            wallet.id,
            external.id,
            usdt.id,
            asset,
            order,
            existingBuy,
            groupById,
            lotByBuyTransaction,
            tx,
          );
          continue;
        }

        await this.insertNewOrder(
          userId,
          importId,
          wallet.id,
          external.id,
          usdt.id,
          asset,
          order,
          tx,
        );
      }

      await this.assertNonNegativeWalletBalances(userId, tx);

      await tx
        .update(imports)
        .set({ status: 'committed', committedAt: new Date() })
        .where(eq(imports.id, importId));

      await this.audit.log(
        {
          userId,
          action: 'import.notion_committed',
          entityType: 'import',
          entityId: importId,
          after: {
            totals: refreshedSummary.totals,
            counts: refreshedSummary.counts,
            control: refreshedSummary.control,
            valuation: refreshedSummary.valuation,
          },
          ip: meta.ip,
          userAgent: meta.userAgent,
        },
        { executor: tx, strict: true },
      );
    });

    return this.get(userId, importId);
  }

  async rollback(userId: string, importId: string, meta: ImportMeta): Promise<ImportResponse> {
    await this.db.transaction(async (tx) => {
      await this.lockUser(userId, tx);

      const [importRecord] = await tx
        .select()
        .from(imports)
        .where(and(eq(imports.id, importId), eq(imports.userId, userId)))
        .limit(1)
        .for('update');

      if (!importRecord) {
        throw new NotFoundException({ code: 'NOT_FOUND', message: 'Import not found' });
      }
      if (importRecord.status !== 'committed') {
        throw new ConflictException({
          code: 'CONFLICT',
          message: 'Only committed imports can be rolled back',
        });
      }
      if (!importRecord.committedAt) {
        throw new ConflictException({
          code: 'CONFLICT',
          message: 'Import has no commit timestamp',
        });
      }

      const [laterImport] = await tx
        .select({ id: imports.id })
        .from(imports)
        .where(
          and(
            eq(imports.userId, userId),
            ne(imports.id, importId),
            eq(imports.status, 'committed'),
            gt(imports.committedAt, importRecord.committedAt),
          ),
        )
        .limit(1);

      if (laterImport) {
        throw new ConflictException({
          code: 'CONFLICT',
          message: 'A later import exists; a compensating reversal is required',
        });
      }

      const [laterTransaction] = await tx
        .select({ id: transactions.id })
        .from(transactions)
        .where(
          and(
            eq(transactions.userId, userId),
            gt(transactions.createdAt, importRecord.committedAt),
            or(isNull(transactions.importId), ne(transactions.importId, importId)),
          ),
        )
        .limit(1);

      if (laterTransaction) {
        throw new ConflictException({
          code: 'CONFLICT',
          message: 'Later ledger activity exists; a compensating reversal is required',
        });
      }

      const imported = await tx
        .select()
        .from(transactions)
        .where(and(eq(transactions.userId, userId), eq(transactions.importId, importId)))
        .for('update');
      const ids = imported.map((row) => row.id);
      const createdGroupIds = [
        ...new Set(
          imported
            .filter((row) => row.subtype === 'buy')
            .map((row) => row.tradeGroupId)
            .filter((id): id is string => Boolean(id)),
        ),
      ];
      const updatedGroupIds = [
        ...new Set(
          imported
            .filter((row) => row.subtype === 'sell')
            .map((row) => row.tradeGroupId)
            .filter((id): id is string => typeof id === 'string' && !createdGroupIds.includes(id)),
        ),
      ];

      if (ids.length > 0) {
        const consumptions = await tx
          .select()
          .from(lotConsumptions)
          .where(inArray(lotConsumptions.disposalTransactionId, ids))
          .for('update');

        for (const consumption of consumptions) {
          const [lot] = await tx
            .select()
            .from(lots)
            .where(eq(lots.id, consumption.lotId))
            .limit(1)
            .for('update');

          if (!lot) continue;

          await tx
            .update(lots)
            .set({
              remainingAmount: amountString(decimal(lot.remainingAmount).plus(consumption.amount)),
              remainingCostBasisUsd: usdString(
                decimal(lot.remainingCostBasisUsd).plus(consumption.costBasisUsd),
              ),
            })
            .where(eq(lots.id, lot.id));
        }

        await tx.delete(lotConsumptions).where(inArray(lotConsumptions.disposalTransactionId, ids));

        await tx.delete(lots).where(inArray(lots.acquisitionTransactionId, ids));
        await tx.delete(tradeDetails).where(inArray(tradeDetails.transactionId, ids));
        await tx.delete(transactions).where(inArray(transactions.id, ids));
      }

      if (createdGroupIds.length > 0) {
        await tx.delete(tradeGroups).where(inArray(tradeGroups.id, createdGroupIds));
      }

      for (const groupId of updatedGroupIds) {
        const [totals] = await tx
          .select({
            total: sql<string>`coalesce(sum(${lots.amount}), 0)::text`,
            remaining: sql<string>`coalesce(sum(${lots.remainingAmount}), 0)::text`,
          })
          .from(lots)
          .where(eq(lots.tradeGroupId, groupId));

        const total = decimal(totals?.total ?? '0');
        const remaining = decimal(totals?.remaining ?? '0');
        const status = remaining.isZero() ? 'closed' : remaining.lt(total) ? 'partial' : 'open';

        await tx
          .update(tradeGroups)
          .set({
            status,
            closedAt: status === 'closed' ? new Date() : null,
            updatedAt: new Date(),
          })
          .where(eq(tradeGroups.id, groupId));
      }

      const orderRows = await tx
        .select()
        .from(importRows)
        .where(and(eq(importRows.importId, importId), eq(importRows.entityType, 'order')));
      const previousGroupStates = new Map<
        string,
        { status: TradeGroupStatus; closedAt: string | null }
      >();

      for (const row of orderRows) {
        const groupId = row.metadata.groupId;
        const previousGroupStatus = row.metadata.previousGroupStatus;

        if (typeof groupId === 'string' && typeof previousGroupStatus === 'string') {
          previousGroupStates.set(groupId, {
            status: previousGroupStatus as TradeGroupStatus,
            closedAt:
              typeof row.metadata.previousGroupClosedAt === 'string'
                ? row.metadata.previousGroupClosedAt
                : null,
          });
        }
      }

      for (const [groupId, state] of previousGroupStates) {
        if (createdGroupIds.includes(groupId)) continue;

        await tx
          .update(tradeGroups)
          .set({
            status: state.status,
            closedAt: state.closedAt ? new Date(state.closedAt) : null,
            updatedAt: new Date(),
          })
          .where(eq(tradeGroups.id, groupId));
      }

      await tx.delete(prices).where(eq(prices.importId, importId));

      await tx
        .update(importRows)
        .set({ status: 'rolled_back', transactionId: null })
        .where(
          and(
            eq(importRows.importId, importId),
            inArray(importRows.status, ['imported', 'updated']),
          ),
        );

      await tx
        .update(imports)
        .set({ status: 'rolled_back', rolledBackAt: new Date() })
        .where(eq(imports.id, importId));

      await this.audit.log(
        {
          userId,
          action: 'import.notion_rolled_back',
          entityType: 'import',
          entityId: importId,
          after: {
            transactions: ids.length,
            groupsDeleted: createdGroupIds.length,
            groupsRestored: previousGroupStates.size,
          },
          ip: meta.ip,
          userAgent: meta.userAgent,
        },
        { executor: tx, strict: true },
      );
    });

    return this.get(userId, importId);
  }

  async reconciliation(userId: string, importId: string): Promise<ImportReconciliationResponse> {
    const result = await this.get(userId, importId);

    return {
      importId: result.import.id,
      status: result.import.status,
      control: result.import.summary.control,
      currentDeltas: result.import.summary.currentDeltas,
      valuation: result.import.summary.valuation,
    };
  }

  async list(userId: string): Promise<ImportsResponse> {
    const rows = await this.db
      .select()
      .from(imports)
      .where(eq(imports.userId, userId))
      .orderBy(sql`${imports.createdAt} desc`);

    return { imports: rows.map((row) => this.toContract(row)) };
  }

  async get(userId: string, importId: string): Promise<ImportResponse> {
    const [row] = await this.db
      .select()
      .from(imports)
      .where(and(eq(imports.id, importId), eq(imports.userId, userId)))
      .limit(1);

    if (!row) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Import not found' });

    const rows = await this.db.select().from(importRows).where(eq(importRows.importId, importId));

    return {
      import: this.toContract(row),
      rows: rows.map((item) => ({
        id: item.id,
        entityType: item.entityType,
        sourceId: item.sourceId,
        status: item.status as ImportRowStatus,
        error: item.error,
      })),
    };
  }

  private toContract(row: typeof imports.$inferSelect): ImportResponse['import'] {
    return {
      id: row.id,
      status: row.status as ImportStatus,
      source: row.source,
      fileName: row.fileName,
      createdAt: row.createdAt.toISOString(),
      committedAt: row.committedAt?.toISOString() ?? null,
      rolledBackAt: row.rolledBackAt?.toISOString() ?? null,
      summary: row.summary as unknown as ImportSummary,
    };
  }

  private async lockUser(userId: string, executor: DbExecutor): Promise<void> {
    await executor.execute(
      sql`select pg_advisory_xact_lock(hashtext(${`accounting:${userId}`})::bigint)`,
    );
  }

  private async detectExisting(
    userId: string,
    parsed: {
      source: NormalizedSource[];
      orders: NormalizedOrder[];
      transactions: NormalizedTransaction[];
    },
    executor: DbExecutor,
  ): Promise<Detection> {
    const errors: string[] = [];
    const warnings: string[] = [];
    const orderDecisions = new Map<string, RowDecision>();
    const transactionDecisions = new Map<string, RowDecision>();

    const [chain] = await executor.select().from(chains).where(eq(chains.code, BSC)).limit(1);

    if (!chain) {
      errors.push(`Chain ${BSC} is not seeded`);
    }

    const assetRows = chain
      ? await executor.select().from(assets).where(eq(assets.chainId, chain.id))
      : [];
    const assetById = new Map(assetRows.map((row) => [row.id, row]));
    const existingSymbols = new Set(assetRows.map((row) => row.symbol));
    const symbolsToCheck = new Set<string>([
      'USDT',
      ...parsed.source.map((row) => row.symbol),
      ...parsed.orders.map((row) => row.destinationSymbol),
    ]);
    let newAssets = 0;
    let reusedAssets = 0;

    for (const symbol of symbolsToCheck) {
      if (existingSymbols.has(symbol)) reusedAssets += 1;
      else newAssets += 1;
    }

    const sourceIds = [
      ...parsed.orders.flatMap((order) => [
        buySourceId(order.orderId),
        sellSourceId(order.orderId),
      ]),
      ...parsed.transactions.map((transaction) => cashSourceId(transaction.sourceId)),
    ];
    const existingTransactions =
      sourceIds.length === 0
        ? []
        : await executor
            .select()
            .from(transactions)
            .where(
              and(
                eq(transactions.userId, userId),
                eq(transactions.source, NOTION),
                inArray(transactions.sourceId, sourceIds),
              ),
            );
    const existingBySourceId = new Map(
      existingTransactions
        .filter((row): row is typeof row & { sourceId: string } => Boolean(row.sourceId))
        .map((row) => [row.sourceId, row]),
    );

    const buyOnlyOrderRows = parsed.orders.filter((order) => {
      const buy = existingBySourceId.has(buySourceId(order.orderId));
      const sell = existingBySourceId.has(sellSourceId(order.orderId));
      return buy && !sell;
    });
    const buyOnlyTransactionIds = buyOnlyOrderRows
      .map((order) => existingBySourceId.get(buySourceId(order.orderId)))
      .flatMap((row) => (row ? [row.id] : []));
    const buyOnlyGroupIds = [
      ...new Set(
        buyOnlyOrderRows
          .map((order) => existingBySourceId.get(buySourceId(order.orderId)))
          .map((row) => row?.tradeGroupId)
          .filter((id): id is string => Boolean(id)),
      ),
    ];
    const groupById = new Map(
      buyOnlyGroupIds.length === 0
        ? []
        : (
            await executor
              .select()
              .from(tradeGroups)
              .where(inArray(tradeGroups.id, buyOnlyGroupIds))
          ).map((row) => [row.id, row]),
    );
    const lotByBuyTransaction = new Map(
      buyOnlyTransactionIds.length === 0
        ? []
        : (
            await executor
              .select()
              .from(lots)
              .where(inArray(lots.acquisitionTransactionId, buyOnlyTransactionIds))
          ).map((row) => [row.acquisitionTransactionId, row]),
    );

    let newOrders = 0;
    let updatedOrders = 0;
    let skippedOrders = 0;
    let newTransactions = 0;
    let skippedTransactions = 0;

    for (const order of parsed.orders) {
      const buy = existingBySourceId.get(buySourceId(order.orderId));
      const sell = existingBySourceId.get(sellSourceId(order.orderId));

      if (buy && sell) {
        skippedOrders += 1;
        orderDecisions.set(order.sourceId, {
          status: 'skipped',
          error: 'Already imported',
        });
        continue;
      }

      if (sell && !buy) {
        const message = `Order ${order.orderId}: sell transaction exists without buy`;
        errors.push(message);
        orderDecisions.set(order.sourceId, { status: 'error', error: message });
        continue;
      }

      if (!buy) {
        newOrders += 1;
        orderDecisions.set(order.sourceId, { status: 'pending', error: null });
        continue;
      }

      if (!buy.tradeGroupId) {
        const message = `Order ${order.orderId}: existing buy has no trade group`;
        errors.push(message);
        orderDecisions.set(order.sourceId, { status: 'error', error: message });
        continue;
      }

      const group = groupById.get(buy.tradeGroupId);

      if (!group) {
        const message = `Order ${order.orderId}: existing trade group not found`;
        errors.push(message);
        orderDecisions.set(order.sourceId, { status: 'error', error: message });
        continue;
      }

      const groupAsset = assetById.get(group.assetId);

      if (!groupAsset || groupAsset.symbol !== order.destinationSymbol) {
        const message = `Order ${order.orderId}: existing trade group asset does not match`;
        errors.push(message);
        orderDecisions.set(order.sourceId, { status: 'error', error: message });
        continue;
      }

      const lot = lotByBuyTransaction.get(buy.id);

      if (!lot) {
        const message = `Order ${order.orderId}: existing lot not found`;
        errors.push(message);
        orderDecisions.set(order.sourceId, { status: 'error', error: message });
        continue;
      }

      if (!decimal(lot.amount).eq(decimal(order.destinationAmount))) {
        const message = `Order ${order.orderId}: existing lot amount does not match the export`;
        errors.push(message);
        orderDecisions.set(order.sourceId, { status: 'error', error: message });
        continue;
      }

      if (!decimal(lot.costBasisUsd).eq(decimal(order.buyUsd))) {
        const message = `Order ${order.orderId}: existing lot cost basis does not match the export`;
        errors.push(message);
        orderDecisions.set(order.sourceId, { status: 'error', error: message });
        continue;
      }

      const lotFullyOpen =
        decimal(lot.remainingAmount).eq(decimal(order.destinationAmount)) &&
        decimal(lot.remainingCostBasisUsd).eq(decimal(order.buyUsd));

      if (order.status !== 'closed' && group.status === order.status && lotFullyOpen) {
        skippedOrders += 1;
        orderDecisions.set(order.sourceId, {
          status: 'skipped',
          error: 'Already imported',
        });
        continue;
      }

      if (!lotFullyOpen) {
        const message = `Order ${order.orderId}: existing lot is not fully open`;
        errors.push(message);
        orderDecisions.set(order.sourceId, { status: 'error', error: message });
        continue;
      }

      updatedOrders += 1;
      orderDecisions.set(order.sourceId, { status: 'pending', error: null });
    }

    for (const transaction of parsed.transactions) {
      if (existingBySourceId.has(cashSourceId(transaction.sourceId))) {
        skippedTransactions += 1;
        transactionDecisions.set(transaction.sourceId, {
          status: 'skipped',
          error: 'Already imported',
        });
      } else {
        newTransactions += 1;
        transactionDecisions.set(transaction.sourceId, {
          status: 'pending',
          error: null,
        });
      }
    }

    if (newAssets > 0) {
      warnings.push(`${newAssets} assets will be created as unverified BSC assets`);
    }

    return {
      orderDecisions,
      transactionDecisions,
      newOrders,
      updatedOrders,
      skippedOrders,
      newTransactions,
      skippedTransactions,
      newAssets,
      reusedAssets,
      errors,
      warnings,
    };
  }

  private async requireAccount(
    userId: string,
    name: string,
    executor: DbExecutor,
  ): Promise<typeof accounts.$inferSelect> {
    const [account] = await executor
      .select()
      .from(accounts)
      .where(and(eq(accounts.userId, userId), eq(accounts.name, name)))
      .limit(1);

    if (!account) throw new Error(`Account ${name} is not configured`);
    return account;
  }

  private async ensureAsset(
    source: {
      symbol: string;
      name: string;
      coingeckoId: string | null;
      description: string | null;
      priceUsd: string | null;
      isStablecoin: boolean;
      sourceId: string | null;
      raw: Record<string, unknown>;
    },
    chainId: string,
    executor: DbExecutor,
  ): Promise<typeof assets.$inferSelect> {
    const [existing] = await executor
      .select()
      .from(assets)
      .where(and(eq(assets.chainId, chainId), eq(assets.symbol, source.symbol)))
      .limit(1);

    if (existing) return existing;

    const [created] = await executor
      .insert(assets)
      .values({
        chainId,
        symbol: source.symbol,
        name: source.name,
        coingeckoId: source.coingeckoId,
        decimals: 18,
        isStablecoin: source.isStablecoin,
        isCashEquivalent: source.isStablecoin,
        isVerified: false,
        sourceId: source.sourceId,
        dataQuality: QUALITY_FLAGS,
      })
      .returning();

    if (!created) throw new Error(`Failed to create asset ${source.symbol}`);
    return created;
  }

  private async insertCashTransaction(
    userId: string,
    importId: string,
    walletId: string,
    externalId: string,
    usdtId: string,
    transaction: NormalizedTransaction,
    executor: DbExecutor,
  ): Promise<void> {
    const [created] = await executor
      .insert(transactions)
      .values({
        userId,
        type: transaction.type,
        subtype: transaction.type,
        source: NOTION,
        sourceId: cashSourceId(transaction.sourceId),
        importId,
        occurredAt: new Date(transaction.occurredAt),
        notes: transaction.notes,
        dataQuality: QUALITY_FLAGS,
      })
      .returning({ id: transactions.id });

    if (!created) throw new Error('Failed to create imported cash transaction');

    const sign = transaction.type === 'deposit' ? 1 : -1;
    const postingsToInsert = [
      {
        transactionId: created.id,
        accountId: walletId,
        assetId: usdtId,
        amount: amountString(decimal(transaction.amountUsd).mul(sign)),
        usdValue: usdString(decimal(transaction.amountUsd).mul(sign)),
      },
      {
        transactionId: created.id,
        accountId: externalId,
        assetId: usdtId,
        amount: amountString(decimal(transaction.amountUsd).mul(-sign)),
        usdValue: usdString(decimal(transaction.amountUsd).mul(-sign)),
      },
    ];

    this.assertBalanced(postingsToInsert);
    await executor.insert(postings).values(postingsToInsert);

    await this.markRow(
      importId,
      'transaction',
      transaction.sourceId,
      'imported',
      created.id,
      null,
      executor,
    );
  }

  private async insertNewOrder(
    userId: string,
    importId: string,
    walletId: string,
    externalId: string,
    usdtId: string,
    asset: typeof assets.$inferSelect,
    order: NormalizedOrder,
    executor: DbExecutor,
  ): Promise<void> {
    const [group] = await executor
      .insert(tradeGroups)
      .values({
        userId,
        assetId: asset.id,
        status: order.status,
        openedAt: new Date(order.openedAt),
        closedAt: order.status === 'closed' ? new Date(order.closedAt ?? order.openedAt) : null,
      })
      .returning({ id: tradeGroups.id });

    if (!group) throw new Error('Failed to create imported trade group');

    const buyId = buySourceId(order.orderId);
    const buyTransactionId = await this.insertTradeTransaction(
      userId,
      importId,
      {
        sourceId: buyId,
        subtype: 'buy',
        occurredAt: new Date(order.openedAt),
        tradeGroupId: group.id,
        notes: `Импорт Notion · заказ ${order.orderId}`,
        postings: [
          {
            accountId: walletId,
            assetId: asset.id,
            amount: order.destinationAmount,
            usdValue: order.buyUsd,
          },
          {
            accountId: externalId,
            assetId: asset.id,
            amount: amountString(decimal(order.destinationAmount).negated()),
            usdValue: usdString(decimal(order.buyUsd).negated()),
          },
          {
            accountId: walletId,
            assetId: usdtId,
            amount: amountString(decimal(order.sourceAmount).negated()),
            usdValue: usdString(decimal(order.buyUsd).negated()),
          },
          {
            accountId: externalId,
            assetId: usdtId,
            amount: order.sourceAmount,
            usdValue: order.buyUsd,
          },
        ],
      },
      executor,
    );

    const [lot] = await executor
      .insert(lots)
      .values({
        userId,
        assetId: asset.id,
        tradeGroupId: group.id,
        acquisitionTransactionId: buyTransactionId,
        amount: order.destinationAmount,
        remainingAmount:
          order.status === 'closed' ? '0.000000000000000000' : order.destinationAmount,
        costBasisUsd: order.buyUsd,
        remainingCostBasisUsd: order.status === 'closed' ? '0.00000000' : order.buyUsd,
        acquiredAt: new Date(order.openedAt),
      })
      .returning({ id: lots.id });

    if (!lot) throw new Error('Failed to create imported lot');

    await executor.insert(tradeDetails).values({
      tradeGroupId: group.id,
      transactionId: buyTransactionId,
      referencePriceUsd: usdString(decimal(order.buyUsd).div(decimal(order.destinationAmount))),
      executionCostUsd: null,
    });

    if (order.status === 'closed') {
      const sellId = sellSourceId(order.orderId);
      const sellTransactionId = await this.insertTradeTransaction(
        userId,
        importId,
        {
          sourceId: sellId,
          subtype: 'sell',
          occurredAt: new Date(order.closedAt ?? order.openedAt),
          tradeGroupId: group.id,
          notes: `Импорт Notion · заказ ${order.orderId}`,
          postings: [
            {
              accountId: walletId,
              assetId: asset.id,
              amount: amountString(decimal(order.destinationAmount).negated()),
              usdValue: usdString(decimal(order.sellUsd).negated()),
            },
            {
              accountId: externalId,
              assetId: asset.id,
              amount: order.destinationAmount,
              usdValue: order.sellUsd,
            },
            {
              accountId: walletId,
              assetId: usdtId,
              amount: order.sellUsd,
              usdValue: order.sellUsd,
            },
            {
              accountId: externalId,
              assetId: usdtId,
              amount: amountString(decimal(order.sellUsd).negated()),
              usdValue: usdString(decimal(order.sellUsd).negated()),
            },
          ],
        },
        executor,
      );

      await executor.insert(lotConsumptions).values({
        lotId: lot.id,
        disposalTransactionId: sellTransactionId,
        amount: order.destinationAmount,
        costBasisUsd: order.buyUsd,
        proceedsUsd: order.sellUsd,
        realizedPnlUsd: usdString(decimal(order.sellUsd).minus(decimal(order.buyUsd))),
      });

      await executor.insert(tradeDetails).values({
        tradeGroupId: group.id,
        transactionId: sellTransactionId,
        referencePriceUsd: order.saleRate,
        executionCostUsd: null,
      });
    }

    await this.markRow(
      importId,
      'order',
      order.sourceId,
      'imported',
      buyTransactionId,
      null,
      executor,
    );
  }

  private async reconcileExistingOrder(
    userId: string,
    importId: string,
    walletId: string,
    externalId: string,
    usdtId: string,
    asset: typeof assets.$inferSelect,
    order: NormalizedOrder,
    existingBuy: typeof transactions.$inferSelect,
    groupById: Map<string, typeof tradeGroups.$inferSelect>,
    lotByBuyTransaction: Map<string, typeof lots.$inferSelect>,
    executor: DbExecutor,
  ): Promise<void> {
    const groupId = existingBuy.tradeGroupId;

    if (!groupId) {
      throw new ConflictException({
        code: 'IMPORT_CONFLICT',
        message: `Order ${order.orderId}: existing buy has no trade group`,
      });
    }

    const group = groupById.get(groupId);

    if (!group) {
      throw new ConflictException({
        code: 'IMPORT_CONFLICT',
        message: `Order ${order.orderId}: existing trade group not found`,
      });
    }

    if (group.assetId !== asset.id) {
      throw new ConflictException({
        code: 'IMPORT_CONFLICT',
        message: `Order ${order.orderId}: existing trade group asset does not match`,
      });
    }

    const lot = lotByBuyTransaction.get(existingBuy.id);

    if (!lot) {
      throw new ConflictException({
        code: 'IMPORT_CONFLICT',
        message: `Order ${order.orderId}: existing lot not found`,
      });
    }

    if (!decimal(lot.amount).eq(decimal(order.destinationAmount))) {
      throw new ConflictException({
        code: 'IMPORT_CONFLICT',
        message: `Order ${order.orderId}: existing lot amount does not match the export`,
      });
    }

    if (!decimal(lot.costBasisUsd).eq(decimal(order.buyUsd))) {
      throw new ConflictException({
        code: 'IMPORT_CONFLICT',
        message: `Order ${order.orderId}: existing lot cost basis does not match the export`,
      });
    }

    if (order.status !== 'closed') {
      if (!decimal(lot.remainingAmount).eq(decimal(order.destinationAmount))) {
        throw new ConflictException({
          code: 'IMPORT_CONFLICT',
          message: `Order ${order.orderId}: existing lot is partially consumed and cannot be treated as open`,
        });
      }

      if (!decimal(lot.remainingCostBasisUsd).eq(decimal(order.buyUsd))) {
        throw new ConflictException({
          code: 'IMPORT_CONFLICT',
          message: `Order ${order.orderId}: existing lot cost basis is not fully open`,
        });
      }

      await executor
        .update(tradeGroups)
        .set({
          status: order.status,
          closedAt: null,
          updatedAt: new Date(),
        })
        .where(eq(tradeGroups.id, group.id));

      await this.markRow(
        importId,
        'order',
        order.sourceId,
        'updated',
        existingBuy.id,
        null,
        executor,
        {
          updateKind: 'status',
          groupId: group.id,
          previousGroupStatus: group.status,
          previousGroupClosedAt: group.closedAt?.toISOString() ?? null,
        },
      );
      return;
    }

    if (group.status === 'closed' || decimal(lot.remainingAmount).isZero()) {
      throw new ConflictException({
        code: 'IMPORT_CONFLICT',
        message: `Order ${order.orderId}: existing order is already closed`,
      });
    }

    if (!decimal(lot.remainingAmount).eq(decimal(order.destinationAmount))) {
      throw new ConflictException({
        code: 'IMPORT_CONFLICT',
        message: `Order ${order.orderId}: existing lot is not fully open and cannot be closed by this import`,
      });
    }

    if (!decimal(lot.remainingCostBasisUsd).eq(decimal(order.buyUsd))) {
      throw new ConflictException({
        code: 'IMPORT_CONFLICT',
        message: `Order ${order.orderId}: existing lot cost basis is not fully open`,
      });
    }

    const sellTransactionId = await this.insertTradeTransaction(
      userId,
      importId,
      {
        sourceId: sellSourceId(order.orderId),
        subtype: 'sell',
        occurredAt: new Date(order.closedAt ?? order.openedAt),
        tradeGroupId: group.id,
        notes: `Импорт Notion · заказ ${order.orderId}`,
        postings: [
          {
            accountId: walletId,
            assetId: asset.id,
            amount: amountString(decimal(order.destinationAmount).negated()),
            usdValue: usdString(decimal(order.sellUsd).negated()),
          },
          {
            accountId: externalId,
            assetId: asset.id,
            amount: order.destinationAmount,
            usdValue: order.sellUsd,
          },
          {
            accountId: walletId,
            assetId: usdtId,
            amount: order.sellUsd,
            usdValue: order.sellUsd,
          },
          {
            accountId: externalId,
            assetId: usdtId,
            amount: amountString(decimal(order.sellUsd).negated()),
            usdValue: usdString(decimal(order.sellUsd).negated()),
          },
        ],
      },
      executor,
    );

    await executor.insert(lotConsumptions).values({
      lotId: lot.id,
      disposalTransactionId: sellTransactionId,
      amount: order.destinationAmount,
      costBasisUsd: lot.remainingCostBasisUsd,
      proceedsUsd: order.sellUsd,
      realizedPnlUsd: usdString(decimal(order.sellUsd).minus(decimal(lot.remainingCostBasisUsd))),
    });

    await executor
      .update(lots)
      .set({
        remainingAmount: '0.000000000000000000',
        remainingCostBasisUsd: '0.00000000',
      })
      .where(eq(lots.id, lot.id));

    await executor
      .update(tradeGroups)
      .set({
        status: 'closed',
        closedAt: new Date(order.closedAt ?? order.openedAt),
        updatedAt: new Date(),
      })
      .where(eq(tradeGroups.id, group.id));

    await executor.insert(tradeDetails).values({
      tradeGroupId: group.id,
      transactionId: sellTransactionId,
      referencePriceUsd: order.saleRate,
      executionCostUsd: null,
    });

    await this.markRow(
      importId,
      'order',
      order.sourceId,
      'updated',
      sellTransactionId,
      null,
      executor,
      {
        updateKind: 'close',
        groupId: group.id,
        previousGroupStatus: group.status,
        previousGroupClosedAt: group.closedAt?.toISOString() ?? null,
      },
    );
  }

  private async insertTradeTransaction(
    userId: string,
    importId: string,
    data: {
      sourceId: string;
      subtype: 'buy' | 'sell';
      occurredAt: Date;
      tradeGroupId: string;
      notes: string;
      postings: Array<{
        accountId: string;
        assetId: string;
        amount: string;
        usdValue: string;
      }>;
    },
    executor: DbExecutor,
  ): Promise<string> {
    this.assertBalanced(
      data.postings.map((posting) => ({
        transactionId: '',
        ...posting,
      })),
    );

    const [created] = await executor
      .insert(transactions)
      .values({
        userId,
        type: 'trade',
        subtype: data.subtype,
        source: NOTION,
        sourceId: data.sourceId,
        importId,
        tradeGroupId: data.tradeGroupId,
        occurredAt: data.occurredAt,
        notes: data.notes,
        dataQuality: QUALITY_FLAGS,
      })
      .returning({ id: transactions.id });

    if (!created) throw new Error('Failed to create imported trade transaction');

    await executor.insert(postings).values(
      data.postings.map((posting) => ({
        transactionId: created.id,
        accountId: posting.accountId,
        assetId: posting.assetId,
        amount: posting.amount,
        usdValue: posting.usdValue,
      })),
    );

    return created.id;
  }

  private async loadExistingOrderTransactions(
    userId: string,
    orders: NormalizedOrder[],
    executor: DbExecutor,
  ): Promise<Map<string, typeof transactions.$inferSelect>> {
    const sourceIds = orders.flatMap((order) => [
      buySourceId(order.orderId),
      sellSourceId(order.orderId),
    ]);

    if (sourceIds.length === 0) return new Map();

    const rows = await executor
      .select()
      .from(transactions)
      .where(
        and(
          eq(transactions.userId, userId),
          eq(transactions.source, NOTION),
          inArray(transactions.sourceId, sourceIds),
        ),
      );

    return new Map(
      rows
        .filter((row): row is typeof row & { sourceId: string } => Boolean(row.sourceId))
        .map((row) => [row.sourceId, row]),
    );
  }

  private async markRow(
    importId: string,
    entityType: 'source' | 'order' | 'transaction',
    sourceId: string,
    status: ImportRowStatus,
    transactionId: string | null,
    error: string | null,
    executor: DbExecutor,
    metadata: Record<string, unknown> = {},
  ): Promise<void> {
    await executor
      .update(importRows)
      .set({ status, transactionId, error, metadata })
      .where(
        and(
          eq(importRows.importId, importId),
          eq(importRows.entityType, entityType),
          eq(importRows.sourceId, sourceId),
        ),
      );
  }

  private async assertNonNegativeWalletBalances(
    userId: string,
    executor: DbExecutor,
  ): Promise<void> {
    const balances = await executor
      .select({
        accountId: postings.accountId,
        assetId: postings.assetId,
        amount: sql<string>`coalesce(sum(${postings.amount}), 0)::text`,
      })
      .from(postings)
      .innerJoin(accounts, eq(postings.accountId, accounts.id))
      .where(and(eq(accounts.userId, userId), eq(accounts.type, 'wallet')))
      .groupBy(postings.accountId, postings.assetId);

    const bad = balances.find((row) => decimal(row.amount).isNegative());

    if (bad) {
      throw new BadRequestException({
        code: 'NEGATIVE_BALANCE',
        message: 'Import would leave a negative wallet balance',
        details: bad,
      });
    }
  }

  private assertBalanced(
    postingsToCheck: Array<{
      transactionId: string;
      accountId: string;
      assetId: string;
      amount: string;
      usdValue: string;
    }>,
  ): void {
    const byAsset = new Map<string, Decimal>();

    for (const posting of postingsToCheck) {
      const amount = decimal(posting.amount);
      const usdValue = decimal(posting.usdValue);

      if (amount.decimalPlaces() > 18) {
        throw new Error('Import amount supports at most 18 decimal places');
      }
      if (usdValue.decimalPlaces() > 8) {
        throw new Error('Import USD value supports at most 8 decimal places');
      }
      if (amount.abs().gte(new Decimal('1e18')) || usdValue.abs().gte(new Decimal('1e16'))) {
        throw new Error('Import posting is too large');
      }

      byAsset.set(posting.assetId, (byAsset.get(posting.assetId) ?? new Decimal(0)).plus(amount));
    }

    for (const total of byAsset.values()) {
      if (!total.isZero()) {
        throw new Error('Imported ledger postings are not balanced');
      }
    }
  }
}

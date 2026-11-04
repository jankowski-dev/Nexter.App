import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, desc, eq, gte, ilike, inArray, lt, lte, or, sql } from 'drizzle-orm';
import {
  assets,
  auditLog,
  chains,
  lotConsumptions,
  lots,
  postings,
  tradeGroups,
  transactions,
  type Database,
  type TradeGroup,
  type TransactionSource,
} from '@nexter/db';
import type {
  AuditEntry,
  ManualTransactionRequest,
  TradeGroupDetail,
  TradeGroupListQuery,
  TradeGroupNotesRequest,
  TradeGroupSellRequest,
  TradeGroupSummary,
  TradeGroupsResponse,
  Transaction,
} from '@nexter/contracts';
import { AuditService } from '../../shared/audit/audit.service';
import { DB } from '../../shared/db/db.module';
import { Decimal, decimal, usdString } from '../../shared/money/decimal';
import { decodeCursor, encodeCursor, isUuid, makePage } from '../../shared/pagination/cursor';
import { LedgerService, type LedgerMeta } from './ledger.service';
import { PricingService } from './pricing.service';

interface GroupRow {
  group: TradeGroup;
  asset: typeof assets.$inferSelect;
  chainCode: string;
  buyUsd: string | null;
  remainingAmount: string | null;
  remainingCost: string | null;
  sellUsd: string | null;
  realized: string | null;
  source: string | null;
}

@Injectable()
export class TradeGroupsService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly pricing: PricingService,
    private readonly ledger: LedgerService,
    private readonly audit: AuditService,
  ) {}

  async list(userId: string, query: TradeGroupListQuery): Promise<TradeGroupsResponse> {
    const rows = await this.queryRows(userId, query, query.limit + 1);
    const priceByAsset = await this.pricing.latestForAssets([
      ...new Set(rows.map((row) => row.asset.id)),
    ]);
    const summaries = rows.map((row) => this.toSummary(row, priceByAsset.get(row.asset.id)));
    const filtered = query.pnl
      ? summaries.filter((summary) => {
          if (summary.totalPnlUsd === null) return false;
          const pnl = decimal(summary.totalPnlUsd);
          return query.pnl === 'positive' ? pnl.gt(0) : pnl.lt(0);
        })
      : summaries;
    const page = makePage(rows, query.limit, (row) =>
      encodeCursor({ openedAt: row.group.openedAt.toISOString(), id: row.group.id }),
    );

    return {
      data: filtered.slice(0, query.limit),
      page: { nextCursor: page.nextCursor, hasMore: page.hasMore },
    };
  }

  async get(userId: string, groupId: string): Promise<TradeGroupDetail> {
    const rows = await this.queryRows(
      userId,
      { limit: 1, assetId: undefined, status: undefined, source: undefined, search: undefined },
      1,
      groupId,
    );
    const row = rows[0];

    if (!row) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Trade group not found' });
    }

    const priceByAsset = await this.pricing.latestForAssets([row.asset.id]);
    const group = this.toSummary(row, priceByAsset.get(row.asset.id));
    const legRows = await this.db
      .select()
      .from(transactions)
      .where(and(eq(transactions.userId, userId), eq(transactions.tradeGroupId, groupId)))
      .orderBy(transactions.occurredAt, transactions.createdAt);
    const lotRows = await this.db
      .select()
      .from(lots)
      .where(and(eq(lots.userId, userId), eq(lots.tradeGroupId, groupId)))
      .orderBy(lots.acquiredAt, lots.createdAt);
    const consumptionRows = await this.db
      .select({
        consumption: lotConsumptions,
        disposalOccurredAt: transactions.occurredAt,
      })
      .from(lotConsumptions)
      .innerJoin(lots, eq(lotConsumptions.lotId, lots.id))
      .innerJoin(transactions, eq(lotConsumptions.disposalTransactionId, transactions.id))
      .where(and(eq(lots.userId, userId), eq(lots.tradeGroupId, groupId)))
      .orderBy(transactions.occurredAt, lotConsumptions.createdAt, lotConsumptions.id);

    const linkedLegIds = new Set(legRows.map((leg) => leg.id));
    const disposalIds = [
      ...new Set(consumptionRows.map(({ consumption }) => consumption.disposalTransactionId)),
    ].filter((id) => !linkedLegIds.has(id));
    const disposalRows =
      disposalIds.length === 0
        ? []
        : await this.db
            .select()
            .from(transactions)
            .where(and(eq(transactions.userId, userId), inArray(transactions.id, disposalIds)));
    const allLegRows = [...legRows, ...disposalRows].sort(
      (a, b) => a.occurredAt.getTime() - b.occurredAt.getTime(),
    );
    const legIds = allLegRows.map((leg) => leg.id);
    const postingRows =
      legIds.length === 0
        ? []
        : await this.db.select().from(postings).where(inArray(postings.transactionId, legIds));
    const postingsByTransaction = new Map<string, typeof postingRows>();
    for (const posting of postingRows) {
      const list = postingsByTransaction.get(posting.transactionId) ?? [];
      list.push(posting);
      postingsByTransaction.set(posting.transactionId, list);
    }
    const legs: Transaction[] = allLegRows.map((leg) => ({
      id: leg.id,
      type: leg.type,
      subtype: leg.subtype,
      source: leg.source,
      sourceId: leg.sourceId,
      tradeGroupId: leg.tradeGroupId,
      occurredAt: leg.occurredAt.toISOString(),
      notes: leg.notes,
      feesUsd: leg.feesUsd,
      postings: (postingsByTransaction.get(leg.id) ?? []).map((posting) => ({
        id: posting.id,
        accountId: posting.accountId,
        assetId: posting.assetId,
        amount: posting.amount,
        usdValue: posting.usdValue,
      })),
    }));

    const importIds = [
      ...new Set(allLegRows.map((leg) => leg.importId).filter((id): id is string => Boolean(id))),
    ];
    const auditRows = await this.db
      .select()
      .from(auditLog)
      .where(
        and(
          or(
            and(
              eq(auditLog.entityType, 'transaction'),
              legIds.length > 0 ? inArray(auditLog.entityId, legIds) : sql`false`,
            ),
            and(eq(auditLog.entityType, 'trade_group'), eq(auditLog.entityId, groupId)),
            and(
              eq(auditLog.entityType, 'import'),
              importIds.length > 0 ? inArray(auditLog.entityId, importIds) : sql`false`,
            ),
          ),
        ),
      )
      .orderBy(desc(auditLog.createdAt))
      .limit(100);

    return {
      group,
      legs,
      lots: lotRows.map((lot) => ({
        id: lot.id,
        assetId: lot.assetId,
        tradeGroupId: lot.tradeGroupId,
        acquisitionTransactionId: lot.acquisitionTransactionId,
        amount: lot.amount,
        remainingAmount: lot.remainingAmount,
        costBasisUsd: lot.costBasisUsd,
        remainingCostBasisUsd: lot.remainingCostBasisUsd,
        acquiredAt: lot.acquiredAt.toISOString(),
      })),
      consumptions: consumptionRows.map(({ consumption, disposalOccurredAt }) => ({
        id: consumption.id,
        lotId: consumption.lotId,
        disposalTransactionId: consumption.disposalTransactionId,
        disposalOccurredAt: disposalOccurredAt.toISOString(),
        amount: consumption.amount,
        costBasisUsd: consumption.costBasisUsd,
        proceedsUsd: consumption.proceedsUsd,
        realizedPnlUsd: consumption.realizedPnlUsd,
        createdAt: consumption.createdAt.toISOString(),
      })),
      audit: auditRows.map((entry) => this.toAuditEntry(entry)),
    };
  }

  async updateNotes(
    userId: string,
    groupId: string,
    input: TradeGroupNotesRequest,
    meta: LedgerMeta,
  ): Promise<TradeGroupDetail> {
    const [group] = await this.db
      .select()
      .from(tradeGroups)
      .where(and(eq(tradeGroups.id, groupId), eq(tradeGroups.userId, userId)))
      .limit(1);

    if (!group) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Trade group not found' });
    }

    await this.db.transaction(async (tx) => {
      await tx
        .update(tradeGroups)
        .set({ notes: input.notes, updatedAt: new Date() })
        .where(eq(tradeGroups.id, groupId));

      await this.audit.log(
        {
          userId,
          action: 'trade_group.notes_updated',
          entityType: 'trade_group',
          entityId: groupId,
          before: { notes: group.notes },
          after: { notes: input.notes },
          ip: meta.ip,
          userAgent: meta.userAgent,
        },
        { executor: tx, strict: true },
      );
    });

    return this.get(userId, groupId);
  }

  async sell(
    userId: string,
    groupId: string,
    input: TradeGroupSellRequest,
    meta: LedgerMeta,
    idempotencyKey?: string,
  ): Promise<TradeGroupDetail> {
    const [group] = await this.db
      .select()
      .from(tradeGroups)
      .where(and(eq(tradeGroups.id, groupId), eq(tradeGroups.userId, userId)))
      .limit(1);

    if (!group) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Trade group not found' });
    }
    if (group.status === 'closed') {
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: 'Cannot sell from a closed trade group',
      });
    }

    const request: ManualTransactionRequest = {
      type: 'sell',
      accountId: input.accountId,
      assetId: group.assetId,
      amount: input.amount,
      proceedsAssetId: input.proceedsAssetId,
      proceedsAmount: input.proceedsAmount,
      tradeGroupId: group.id,
      usdValue: input.usdValue,
      feeAssetId: input.feeAssetId,
      feeAmount: input.feeAmount,
      feeUsdValue: input.feeUsdValue,
      occurredAt: input.occurredAt,
      notes: input.notes,
    };

    await this.ledger.createManual(userId, request, meta, idempotencyKey);
    return this.get(userId, groupId);
  }

  private async queryRows(
    userId: string,
    query: Partial<TradeGroupListQuery>,
    limit: number,
    groupId?: string,
  ): Promise<GroupRow[]> {
    const conditions = [eq(tradeGroups.userId, userId)];

    if (groupId) conditions.push(eq(tradeGroups.id, groupId));
    if (query.status) conditions.push(eq(tradeGroups.status, query.status));
    if (query.assetId) conditions.push(eq(tradeGroups.assetId, query.assetId));
    if (query.from) conditions.push(gte(tradeGroups.openedAt, new Date(query.from)));
    if (query.to) conditions.push(lte(tradeGroups.openedAt, new Date(query.to)));
    if (query.source) {
      conditions.push(
        sql`exists (
          select 1 from ${transactions} tx
          where tx.trade_group_id = ${tradeGroups.id}
            and tx.user_id = ${userId}
            and tx.subtype = 'buy'
            and tx.source = ${query.source}
        )`,
      );
    }
    if (query.search) {
      const pattern = `%${query.search}%`;
      conditions.push(or(ilike(assets.symbol, pattern), ilike(assets.name, pattern))!);
    }
    if (query.cursor) {
      const cursor = decodeCursor<{ openedAt: string; id: string }>(query.cursor);

      if (
        typeof cursor.openedAt !== 'string' ||
        !isUuid(cursor.id) ||
        Number.isNaN(new Date(cursor.openedAt).getTime())
      ) {
        throw new BadRequestException({
          code: 'VALIDATION_ERROR',
          message: 'Invalid pagination cursor',
        });
      }

      const cursorDate = new Date(cursor.openedAt);
      conditions.push(
        or(
          lt(tradeGroups.openedAt, cursorDate),
          and(eq(tradeGroups.openedAt, cursorDate), lt(tradeGroups.id, cursor.id)),
        )!,
      );
    }

    const baseRows = await this.db
      .select({
        group: tradeGroups,
        asset: assets,
        chainCode: chains.code,
      })
      .from(tradeGroups)
      .innerJoin(assets, eq(tradeGroups.assetId, assets.id))
      .innerJoin(chains, eq(assets.chainId, chains.id))
      .where(and(...conditions))
      .orderBy(desc(tradeGroups.openedAt), desc(tradeGroups.id))
      .limit(limit);

    if (baseRows.length === 0) {
      return [];
    }

    const groupIds = baseRows.map((row) => row.group.id);
    const [lotRows, consumptionRows, sourceRows] = await Promise.all([
      this.db
        .select({
          groupId: lots.tradeGroupId,
          buyUsd: sql<string>`coalesce(sum(${lots.costBasisUsd}), 0)::text`,
          remainingAmount: sql<string>`coalesce(sum(${lots.remainingAmount}), 0)::text`,
          remainingCost: sql<string>`coalesce(sum(${lots.remainingCostBasisUsd}), 0)::text`,
        })
        .from(lots)
        .where(and(eq(lots.userId, userId), inArray(lots.tradeGroupId, groupIds)))
        .groupBy(lots.tradeGroupId),
      this.db
        .select({
          groupId: lots.tradeGroupId,
          sellUsd: sql<string>`coalesce(sum(${lotConsumptions.proceedsUsd}), 0)::text`,
          realized: sql<string>`coalesce(sum(${lotConsumptions.realizedPnlUsd}), 0)::text`,
        })
        .from(lotConsumptions)
        .innerJoin(lots, eq(lotConsumptions.lotId, lots.id))
        .where(and(eq(lots.userId, userId), inArray(lots.tradeGroupId, groupIds)))
        .groupBy(lots.tradeGroupId),
      this.db
        .select({
          groupId: transactions.tradeGroupId,
          source: sql<string>`min(${transactions.source})`,
        })
        .from(transactions)
        .where(
          and(
            eq(transactions.userId, userId),
            eq(transactions.subtype, 'buy'),
            inArray(transactions.tradeGroupId, groupIds),
          ),
        )
        .groupBy(transactions.tradeGroupId),
    ]);

    const lotByGroup = new Map(lotRows.map((row) => [row.groupId, row]));
    const consumptionByGroup = new Map(consumptionRows.map((row) => [row.groupId, row]));
    const sourceByGroup = new Map(sourceRows.map((row) => [row.groupId, row.source]));

    return baseRows.map((row) => ({
      group: row.group,
      asset: row.asset,
      chainCode: row.chainCode,
      buyUsd: lotByGroup.get(row.group.id)?.buyUsd ?? '0',
      remainingAmount: lotByGroup.get(row.group.id)?.remainingAmount ?? '0',
      remainingCost: lotByGroup.get(row.group.id)?.remainingCost ?? '0',
      sellUsd: consumptionByGroup.get(row.group.id)?.sellUsd ?? '0',
      realized: consumptionByGroup.get(row.group.id)?.realized ?? '0',
      source: sourceByGroup.get(row.group.id) ?? null,
    }));
  }

  private toSummary(row: GroupRow, priceValue?: string): TradeGroupSummary {
    const buyUsd = decimal(row.buyUsd ?? '0');
    const sellUsd = decimal(row.sellUsd ?? '0');
    const realized = decimal(row.realized ?? '0');
    const remainingAmount = decimal(row.remainingAmount ?? '0');
    const remainingCost = decimal(row.remainingCost ?? '0');
    const price = priceValue ? decimal(priceValue) : null;
    const source = (row.source ?? 'manual') as TransactionSource;
    const end = row.group.closedAt ?? new Date();
    const holdingDays = Math.max(
      0,
      Math.floor((end.getTime() - row.group.openedAt.getTime()) / 86_400_000),
    );

    let unrealized: Decimal | null;

    if (remainingAmount.isZero()) {
      unrealized = new Decimal(0);
    } else if (price) {
      unrealized = decimal(usdString(remainingAmount.mul(price).minus(remainingCost)));
    } else {
      unrealized = null;
    }

    const totalPnl = unrealized === null ? null : realized.plus(unrealized);
    const returnPct = totalPnl && buyUsd.gt(0) ? totalPnl.div(buyUsd).mul(100).toFixed(2) : null;
    const chainKnown = row.asset.dataQuality.chainKnown !== false;
    const contractKnown = row.asset.dataQuality.contractKnown !== false;

    return {
      id: row.group.id,
      asset: {
        id: row.asset.id,
        chainId: row.asset.chainId,
        chainCode: row.chainCode,
        symbol: row.asset.symbol,
        name: row.asset.name,
        decimals: row.asset.decimals,
        contractAddress: row.asset.contractAddress,
        coingeckoId: row.asset.coingeckoId,
        isStablecoin: row.asset.isStablecoin,
        isCashEquivalent: row.asset.isCashEquivalent,
        isVerified: row.asset.isVerified,
      },
      status: row.group.status,
      openedAt: row.group.openedAt.toISOString(),
      closedAt: row.group.closedAt?.toISOString() ?? null,
      buyUsd: usdString(buyUsd),
      sellUsd: usdString(sellUsd),
      realizedPnlUsd: usdString(realized),
      unrealizedPnlUsd: unrealized === null ? null : usdString(unrealized),
      totalPnlUsd: totalPnl === null ? null : usdString(totalPnl),
      remainingAmount: remainingAmount.toFixed(18),
      costBasisUsd: usdString(buyUsd),
      remainingCostBasisUsd: usdString(remainingCost),
      returnPct,
      holdingDays,
      source,
      notes: row.group.notes,
      quality: {
        assetVerified: row.asset.isVerified,
        chainKnown,
        contractKnown,
        networkFeeIncluded: source !== 'notion',
        reconciled: source !== 'notion',
      },
    };
  }

  private toAuditEntry(entry: typeof auditLog.$inferSelect): AuditEntry {
    return {
      id: entry.id,
      userId: entry.userId,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId,
      before: entry.before,
      after: entry.after,
      ip: entry.ip,
      userAgent: entry.userAgent,
      createdAt: entry.createdAt.toISOString(),
    };
  }
}

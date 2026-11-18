import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, desc, eq } from 'drizzle-orm';
import { assets, chains, pendingOrders, type Database } from '@nexter/db';
import type {
  Asset,
  PendingOrder,
  PendingOrderCreateRequest,
  PendingOrderUpdateRequest,
  PendingOrdersResponse,
} from '@nexter/contracts';
import { AuditService } from '../../shared/audit/audit.service';
import { DB } from '../../shared/db/db.module';

interface PendingOrderMeta {
  ip?: string;
  userAgent?: string;
}

function toAsset(row: {
  assets: typeof assets.$inferSelect;
  chains: typeof chains.$inferSelect;
}): Asset {
  return {
    id: row.assets.id,
    chainId: row.assets.chainId,
    chainCode: row.chains.code,
    symbol: row.assets.symbol,
    name: row.assets.name,
    decimals: row.assets.decimals,
    contractAddress: row.assets.contractAddress,
    coingeckoId: row.assets.coingeckoId,
    logoUrl: row.assets.logoUrl,
    isStablecoin: row.assets.isStablecoin,
    isCashEquivalent: row.assets.isCashEquivalent,
    isVerified: row.assets.isVerified,
  };
}

@Injectable()
export class PendingOrdersService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly audit: AuditService,
  ) {}

  async list(userId: string): Promise<PendingOrdersResponse> {
    const rows = await this.db
      .select({ order: pendingOrders, asset: assets, chain: chains })
      .from(pendingOrders)
      .innerJoin(assets, eq(assets.id, pendingOrders.assetId))
      .innerJoin(chains, eq(chains.id, assets.chainId))
      .where(and(eq(pendingOrders.userId, userId)))
      .orderBy(desc(pendingOrders.createdAt));

    return {
      data: rows.map((row) =>
        this.toContract(row.order, toAsset({ assets: row.asset, chains: row.chain })),
      ),
    };
  }

  async create(
    userId: string,
    input: PendingOrderCreateRequest,
    meta: PendingOrderMeta,
  ): Promise<PendingOrder> {
    const [assetRow] = await this.db
      .select({ assets: assets, chains: chains })
      .from(assets)
      .innerJoin(chains, eq(chains.id, assets.chainId))
      .where(eq(assets.id, input.assetId))
      .limit(1);

    if (!assetRow) {
      throw new BadRequestException({ code: 'VALIDATION_ERROR', message: 'Asset not found' });
    }

    const [created] = await this.db
      .insert(pendingOrders)
      .values({
        userId,
        assetId: input.assetId,
        amountUsd: input.amountUsd,
        triggerPriceUsd: input.triggerPriceUsd,
        stopLossPct:
          input.stopLossPct === null || input.stopLossPct === undefined
            ? null
            : String(input.stopLossPct),
        takeProfitPct:
          input.takeProfitPct === null || input.takeProfitPct === undefined
            ? null
            : String(input.takeProfitPct),
        status: 'pending',
      })
      .returning();

    if (!created) throw new Error('Failed to create pending order');

    await this.audit.log(
      {
        userId,
        action: 'pending_order.created',
        entityType: 'pending_order',
        entityId: created.id,
        after: {
          assetId: created.assetId,
          amountUsd: created.amountUsd,
          triggerPriceUsd: created.triggerPriceUsd,
          stopLossPct: created.stopLossPct,
          takeProfitPct: created.takeProfitPct,
        },
        ip: meta.ip,
        userAgent: meta.userAgent,
      },
      { strict: true },
    );

    return this.toContract(created, toAsset(assetRow));
  }

  async update(
    userId: string,
    id: string,
    input: PendingOrderUpdateRequest,
    meta: PendingOrderMeta,
  ): Promise<PendingOrder> {
    const [existing] = await this.db
      .select()
      .from(pendingOrders)
      .where(and(eq(pendingOrders.id, id), eq(pendingOrders.userId, userId)))
      .limit(1);

    if (!existing) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Pending order not found' });
    }

    if (input.status === 'pending' && existing.status === 'proposed') {
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: 'A proposed pending order cannot be reopened; edit the price instead',
      });
    }

    const [updated] = await this.db
      .update(pendingOrders)
      .set({
        amountUsd: input.amountUsd ?? existing.amountUsd,
        triggerPriceUsd: input.triggerPriceUsd ?? existing.triggerPriceUsd,
        stopLossPct:
          input.stopLossPct !== undefined
            ? input.stopLossPct === null
              ? null
              : String(input.stopLossPct)
            : existing.stopLossPct,
        takeProfitPct:
          input.takeProfitPct !== undefined
            ? input.takeProfitPct === null
              ? null
              : String(input.takeProfitPct)
            : existing.takeProfitPct,
        status: input.status ?? existing.status,
        lastNotifiedAt: input.status === 'pending' ? null : existing.lastNotifiedAt,
        updatedAt: new Date(),
      })
      .where(and(eq(pendingOrders.id, id), eq(pendingOrders.userId, userId)))
      .returning();

    if (!updated) throw new Error('Failed to update pending order');

    const [assetRow] = await this.db
      .select({ assets: assets, chains: chains })
      .from(assets)
      .innerJoin(chains, eq(chains.id, assets.chainId))
      .where(eq(assets.id, updated.assetId))
      .limit(1);

    if (!assetRow) throw new Error('Pending order asset not found');

    await this.audit.log(
      {
        userId,
        action: 'pending_order.updated',
        entityType: 'pending_order',
        entityId: id,
        before: existing,
        after: input,
        ip: meta.ip,
        userAgent: meta.userAgent,
      },
      { strict: true },
    );

    return this.toContract(updated, toAsset(assetRow));
  }

  private toContract(order: typeof pendingOrders.$inferSelect, asset: Asset): PendingOrder {
    return {
      id: order.id,
      asset,
      amountUsd: order.amountUsd,
      triggerPriceUsd: order.triggerPriceUsd,
      stopLossPct: order.stopLossPct,
      takeProfitPct: order.takeProfitPct,
      status: order.status as PendingOrder['status'],
      lastNotifiedAt: order.lastNotifiedAt?.toISOString() ?? null,
      createdAt: order.createdAt.toISOString(),
      updatedAt: order.updatedAt.toISOString(),
    };
  }
}

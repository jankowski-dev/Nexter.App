import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { desc, eq, inArray } from 'drizzle-orm';
import { prices, type Database } from '@nexter/db';
import type { Price, SetPriceRequest } from '@nexter/contracts';
import { AuditService } from '../../shared/audit/audit.service';
import { DB } from '../../shared/db/db.module';
import { Decimal, decimal, usdString } from '../../shared/money/decimal';
import { AssetsService } from './assets.service';

export interface PriceMeta {
  ip?: string;
  userAgent?: string;
}

@Injectable()
export class PricingService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly assets: AssetsService,
    private readonly audit: AuditService,
  ) {}

  async set(
    userId: string,
    assetId: string,
    input: SetPriceRequest,
    meta: PriceMeta,
  ): Promise<Price> {
    const asset = await this.assets.require(assetId);
    const observedAt = input.observedAt ? new Date(input.observedAt) : new Date();
    const price = decimal(input.priceUsd);

    if (price.gte(new Decimal('1e16'))) {
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: 'Price is too large',
      });
    }

    const result = await this.db.transaction(async (tx) => {
      const [priceRow] = await tx
        .insert(prices)
        .values({
          assetId: asset.id,
          priceUsd: usdString(price),
          observedAt,
          source: 'manual',
        })
        .returning();

      if (!priceRow) {
        throw new Error('Failed to save price');
      }

      await this.audit.log(
        {
          userId,
          action: 'accounting.price_set',
          entityType: 'asset',
          entityId: asset.id,
          after: { priceUsd: priceRow.priceUsd, observedAt: observedAt.toISOString() },
          ip: meta.ip,
          userAgent: meta.userAgent,
        },
        { executor: tx, strict: true },
      );

      return priceRow;
    });

    return this.toContract(result);
  }

  async list(assetId: string): Promise<Price[]> {
    await this.assets.require(assetId);

    const rows = await this.db
      .select()
      .from(prices)
      .where(eq(prices.assetId, assetId))
      .orderBy(desc(prices.observedAt))
      .limit(100);

    return rows.map((row) => this.toContract(row));
  }

  async latestForAssets(assetIds: string[]): Promise<Map<string, string>> {
    if (assetIds.length === 0) {
      return new Map();
    }

    const rows = await this.db
      .select()
      .from(prices)
      .where(inArray(prices.assetId, assetIds))
      .orderBy(desc(prices.observedAt));

    const result = new Map<string, string>();

    for (const row of rows) {
      if (!result.has(row.assetId)) {
        result.set(row.assetId, row.priceUsd);
      }
    }

    return result;
  }

  private toContract(row: typeof prices.$inferSelect): Price {
    return {
      id: row.id,
      assetId: row.assetId,
      priceUsd: row.priceUsd,
      observedAt: row.observedAt.toISOString(),
      source: row.source,
    };
  }
}

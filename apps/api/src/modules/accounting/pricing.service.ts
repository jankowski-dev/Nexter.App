import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { desc, eq, inArray } from 'drizzle-orm';
import { prices, type Database } from '@nexter/db';
import type { Price, SetPriceRequest } from '@nexter/contracts';
import { AuditService } from '../../shared/audit/audit.service';
import { DB } from '../../shared/db/db.module';
import { Decimal, decimal, usdString } from '../../shared/money/decimal';
import { MarketQuoteService } from '../market-data/market-quote.service';
import { AssetsService } from './assets.service';

export interface PriceQuote {
  priceUsd: string;
  change24hPct: string | null;
  source: string;
  fetchedAt: Date;
  changedAt: Date;
}

export interface PriceMeta {
  ip?: string;
  userAgent?: string;
}

@Injectable()
export class PricingService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly assets: AssetsService,
    private readonly quotes: MarketQuoteService,
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
    const roundedPrice = decimal(usdString(price));

    if (roundedPrice.gte(new Decimal('1e16'))) {
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
          priceUsd: usdString(roundedPrice),
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

  async latestForAssets(assetIds: string[]): Promise<Map<string, PriceQuote>> {
    if (assetIds.length === 0) {
      return new Map();
    }

    const result = new Map<string, PriceQuote>();
    const marketQuotes = await this.quotes.getQuotes(assetIds);

    for (const [assetId, quote] of marketQuotes) {
      result.set(assetId, {
        priceUsd: quote.priceUsd,
        change24hPct: quote.change24hPct,
        source: quote.source,
        fetchedAt: quote.fetchedAt,
        changedAt: quote.changedAt,
      });
    }

    const missing = assetIds.filter((assetId) => !result.has(assetId));
    if (missing.length === 0) return result;

    const rows = await this.db
      .select()
      .from(prices)
      .where(inArray(prices.assetId, missing))
      .orderBy(desc(prices.observedAt));

    const rowsByAsset = new Map<string, typeof rows>();
    for (const row of rows) {
      const list = rowsByAsset.get(row.assetId) ?? [];
      list.push(row);
      rowsByAsset.set(row.assetId, list);
    }

    const cutoff = Date.now() - 24 * 60 * 60 * 1000;

    for (const [assetId, assetRows] of rowsByAsset) {
      const latest = assetRows[0];
      if (!latest || result.has(assetId)) continue;

      let change24hPct: string | null = null;
      if (latest.observedAt.getTime() >= cutoff) {
        const previous = assetRows.find(
          (row) => row.observedAt.getTime() <= latest.observedAt.getTime() - 24 * 60 * 60 * 1000,
        );
        if (previous && decimal(previous.priceUsd).gt(0)) {
          change24hPct = decimal(latest.priceUsd)
            .minus(previous.priceUsd)
            .div(previous.priceUsd)
            .mul(100)
            .toFixed(2);
        }
      }

      result.set(assetId, {
        priceUsd: latest.priceUsd,
        change24hPct,
        source: latest.source,
        fetchedAt: latest.observedAt,
        changedAt: latest.observedAt,
      });
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

import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { lots, watchlist, type Database } from '@nexter/db';
import type {
  PortfolioAssetDetail,
  Position,
  TradeGroupSummary,
  Transaction,
} from '@nexter/contracts';
import { DB } from '../../shared/db/db.module';
import { AssetsService } from './assets.service';
import { LedgerService } from './ledger.service';
import { PricingService } from './pricing.service';
import { ReportingService } from './reporting.service';
import { TradeGroupsService } from './trade-groups.service';

@Injectable()
export class PortfolioService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly assets: AssetsService,
    private readonly reporting: ReportingService,
    private readonly pricing: PricingService,
    private readonly tradeGroups: TradeGroupsService,
    private readonly ledger: LedgerService,
  ) {}

  async assetDetail(userId: string, assetId: string): Promise<PortfolioAssetDetail> {
    const asset = await this.assets.get(assetId);
    let position: Position | null = null;

    try {
      position = await this.reporting.position(userId, assetId);
    } catch (error) {
      if (!(error instanceof NotFoundException)) throw error;
    }

    const lotRows = await this.db
      .select()
      .from(lots)
      .where(and(eq(lots.userId, userId), eq(lots.assetId, assetId)))
      .orderBy(lots.acquiredAt, lots.createdAt);
    const [watched] = await this.db
      .select()
      .from(watchlist)
      .where(and(eq(watchlist.userId, userId), eq(watchlist.assetId, assetId)))
      .limit(1);
    const [allGroups, allTransactions, prices, priceByAsset] = await Promise.all([
      this.allTradeGroups(userId, assetId),
      this.allTransactions(userId, assetId),
      this.pricing.list(assetId),
      this.pricing.latestForAssets([assetId]),
    ]);
    const quote = priceByAsset.get(assetId);

    return {
      asset,
      position,
      quote: quote
        ? {
            priceUsd: quote.priceUsd,
            change24hPct: quote.change24hPct,
            change7dPct: quote.change7dPct,
            change30dPct: quote.change30dPct,
            change1yPct: quote.change1yPct,
            marketCapUsd: quote.marketCapUsd,
            priceUpdatedAt: quote.changedAt.toISOString(),
            priceFetchedAt: quote.fetchedAt.toISOString(),
            priceSource: quote.source,
          }
        : null,
      thesis: watched?.thesis ?? null,
      tags: watched?.tags ?? [],
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
      tradeGroups: allGroups,
      transactions: allTransactions,
      prices,
    };
  }

  private async allTradeGroups(userId: string, assetId: string): Promise<TradeGroupSummary[]> {
    const all: TradeGroupSummary[] = [];
    let cursor: string | undefined;

    do {
      const page = await this.tradeGroups.list(userId, {
        limit: 100,
        assetId,
        cursor,
      });
      all.push(...page.data);
      cursor = page.page.nextCursor ?? undefined;
      if (!page.page.hasMore) break;
    } while (cursor);

    return all;
  }

  private async allTransactions(userId: string, assetId: string): Promise<Transaction[]> {
    const all: Transaction[] = [];
    let cursor: string | undefined;

    do {
      const page = await this.ledger.list(userId, {
        limit: 100,
        assetId,
        cursor,
      });
      all.push(...page.transactions);
      cursor = page.page.nextCursor ?? undefined;
      if (!page.page.hasMore) break;
    } while (cursor);

    return all;
  }
}

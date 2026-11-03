import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { lots, type Database } from '@nexter/db';
import type { PortfolioAssetDetail, Position } from '@nexter/contracts';
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
    const [tradeGroups, transactions, prices] = await Promise.all([
      this.tradeGroups.list(userId, { limit: 50, assetId }),
      this.ledger.list(userId, { limit: 50, assetId }),
      this.pricing.list(assetId),
    ]);

    return {
      asset,
      position,
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
      tradeGroups: tradeGroups.data,
      transactions: transactions.transactions,
      prices,
    };
  }
}

import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, eq, inArray, sql } from 'drizzle-orm';
import {
  accounts,
  assets,
  chains,
  lotConsumptions,
  lots,
  postings,
  transactions,
  type Database,
} from '@nexter/db';
import type {
  Asset as AssetContract,
  DashboardSummary,
  Position,
  PositionsResponse,
} from '@nexter/contracts';
import { DB } from '../../shared/db/db.module';
import { Decimal, decimal, usdString } from '../../shared/money/decimal';
import { AccountingBootstrapService } from './accounting-bootstrap.service';
import { PricingService } from './pricing.service';

@Injectable()
export class ReportingService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly bootstrap: AccountingBootstrapService,
    private readonly pricing: PricingService,
  ) {}

  async positions(userId: string): Promise<PositionsResponse> {
    await this.bootstrap.ensureDefaults(userId);

    const balanceRows = await this.db
      .select({
        assetId: postings.assetId,
        amount: sql<string>`coalesce(sum(${postings.amount}), 0)::text`,
      })
      .from(postings)
      .innerJoin(accounts, eq(postings.accountId, accounts.id))
      .where(and(eq(accounts.userId, userId), eq(accounts.type, 'wallet')))
      .groupBy(postings.assetId);

    const assetIds = balanceRows.map((row) => row.assetId);
    const assetRows =
      assetIds.length === 0
        ? []
        : await this.db
            .select({ asset: assets, chainCode: chains.code })
            .from(assets)
            .innerJoin(chains, eq(assets.chainId, chains.id))
            .where(inArray(assets.id, assetIds));

    const assetById = new Map(assetRows.map((row) => [row.asset.id, row]));
    const priceByAsset = await this.pricing.latestForAssets(assetIds);
    const costRows = await this.db
      .select({
        assetId: lots.assetId,
        costBasis: sql<string>`coalesce(sum(${lots.remainingCostBasisUsd}), 0)::text`,
      })
      .from(lots)
      .where(eq(lots.userId, userId))
      .groupBy(lots.assetId);
    const costByAsset = new Map(costRows.map((row) => [row.assetId, row.costBasis]));

    let cashUsd = new Decimal(0);
    let positionsValueUsd = new Decimal(0);
    let unrealizedPnlUsd = new Decimal(0);
    const positions: Position[] = [];
    const missingPrices: string[] = [];

    for (const row of balanceRows) {
      const amount = decimal(row.amount);
      const assetRow = assetById.get(row.assetId);

      if (!assetRow || amount.isZero()) {
        continue;
      }

      const assetContract: AssetContract = {
        id: assetRow.asset.id,
        chainId: assetRow.asset.chainId,
        chainCode: assetRow.chainCode,
        symbol: assetRow.asset.symbol,
        name: assetRow.asset.name,
        decimals: assetRow.asset.decimals,
        contractAddress: assetRow.asset.contractAddress,
        coingeckoId: assetRow.asset.coingeckoId,
        isStablecoin: assetRow.asset.isStablecoin,
        isCashEquivalent: assetRow.asset.isCashEquivalent,
        isVerified: assetRow.asset.isVerified,
      };

      const price = priceByAsset.get(row.assetId);
      const priceValue = price ? decimal(price) : null;
      const costBasis = decimal(costByAsset.get(row.assetId) ?? '0');

      if (assetRow.asset.isCashEquivalent) {
        const cashPrice = priceValue ?? new Decimal(1);
        cashUsd = cashUsd.plus(amount.mul(cashPrice));
        continue;
      }

      const value = priceValue ? amount.mul(priceValue) : null;
      const unrealized = value ? value.minus(costBasis) : null;

      if (!priceValue) {
        missingPrices.push(assetRow.asset.symbol);
      } else {
        positionsValueUsd = positionsValueUsd.plus(value ?? 0);
        unrealizedPnlUsd = unrealizedPnlUsd.plus(unrealized ?? 0);
      }

      positions.push({
        asset: assetContract,
        amount: amount.toFixed(18),
        priceUsd: price ?? null,
        valueUsd: value ? usdString(value) : null,
        costBasisUsd: usdString(costBasis),
        unrealizedPnlUsd: unrealized ? usdString(unrealized) : null,
        isCashEquivalent: false,
      });
    }

    return {
      positions,
      cashUsd: usdString(cashUsd),
      positionsValueUsd: usdString(positionsValueUsd),
      equityUsd: usdString(cashUsd.plus(positionsValueUsd)),
      missingPrices,
    };
  }

  async position(userId: string, assetId: string): Promise<Position> {
    const result = await this.positions(userId);
    const position = result.positions.find((item) => item.asset.id === assetId);

    if (!position) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Position not found' });
    }

    return position;
  }

  async dashboard(userId: string): Promise<DashboardSummary> {
    const positions = await this.positions(userId);
    const realized = await this.realizedPnl(userId);
    const income = await this.income(userId);
    const adjustments = await this.adjustments(userId);
    const fees = await this.fees(userId);
    const unrealized = positions.positions.reduce(
      (total, position) => total.plus(decimal(position.unrealizedPnlUsd ?? '0')),
      new Decimal(0),
    );
    const netDeposits = await this.netDeposits(userId);

    return {
      cashUsd: positions.cashUsd,
      positionsValueUsd: positions.positionsValueUsd,
      equityUsd: positions.equityUsd,
      netDepositsUsd: usdString(netDeposits),
      incomeUsd: usdString(income),
      adjustmentsUsd: usdString(adjustments),
      feesUsd: usdString(fees),
      realizedPnlUsd: usdString(realized),
      unrealizedPnlUsd: usdString(unrealized),
      totalPnlUsd: usdString(realized.plus(unrealized).plus(income).plus(adjustments).minus(fees)),
      missingPrices: positions.missingPrices,
    };
  }

  private async realizedPnl(userId: string): Promise<Decimal> {
    const [row] = await this.db
      .select({
        total: sql<string>`coalesce(sum(${lotConsumptions.realizedPnlUsd}), 0)::text`,
      })
      .from(lotConsumptions)
      .innerJoin(lots, eq(lotConsumptions.lotId, lots.id))
      .where(eq(lots.userId, userId));

    return decimal(row?.total ?? '0');
  }

  private async income(userId: string): Promise<Decimal> {
    const [row] = await this.db
      .select({
        total: sql<string>`coalesce(sum(${postings.usdValue}), 0)::text`,
      })
      .from(postings)
      .innerJoin(transactions, eq(postings.transactionId, transactions.id))
      .innerJoin(accounts, eq(postings.accountId, accounts.id))
      .where(
        and(
          eq(transactions.userId, userId),
          eq(accounts.type, 'wallet'),
          eq(transactions.type, 'income'),
        ),
      );

    return decimal(row?.total ?? '0');
  }

  private async adjustments(userId: string): Promise<Decimal> {
    const [row] = await this.db
      .select({
        total: sql<string>`coalesce(sum(${postings.usdValue}), 0)::text`,
      })
      .from(postings)
      .innerJoin(transactions, eq(postings.transactionId, transactions.id))
      .innerJoin(accounts, eq(postings.accountId, accounts.id))
      .where(
        and(
          eq(transactions.userId, userId),
          eq(accounts.type, 'wallet'),
          eq(transactions.type, 'adjustment'),
        ),
      );

    return decimal(row?.total ?? '0');
  }

  private async fees(userId: string): Promise<Decimal> {
    const [row] = await this.db
      .select({
        total: sql<string>`coalesce(sum(${transactions.feesUsd}), 0)::text`,
      })
      .from(transactions)
      .where(eq(transactions.userId, userId));

    return decimal(row?.total ?? '0');
  }

  private async netDeposits(userId: string): Promise<Decimal> {
    const [row] = await this.db
      .select({
        total: sql<string>`coalesce(sum(${postings.usdValue}), 0)::text`,
      })
      .from(postings)
      .innerJoin(transactions, eq(postings.transactionId, transactions.id))
      .innerJoin(accounts, eq(postings.accountId, accounts.id))
      .where(
        and(
          eq(transactions.userId, userId),
          eq(accounts.type, 'wallet'),
          inArray(transactions.type, ['deposit', 'withdrawal']),
        ),
      );

    return decimal(row?.total ?? '0');
  }
}

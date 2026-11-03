import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, eq, inArray, sql } from 'drizzle-orm';
import {
  accounts,
  assets,
  chains,
  lotConsumptions,
  lots,
  postings,
  settings as settingsTable,
  transactions,
  type Database,
} from '@nexter/db';
import type {
  Asset as AssetContract,
  DashboardActivePositions,
  DashboardAllocation,
  DashboardDataQuality,
  DashboardPnl,
  DashboardRecentTrades,
  DashboardSummary,
  EquityCurve,
  Position,
  PositionsResponse,
} from '@nexter/contracts';
import { DB } from '../../shared/db/db.module';
import { Decimal, decimal, usdString } from '../../shared/money/decimal';
import { AccountingBootstrapService } from './accounting-bootstrap.service';
import { PricingService } from './pricing.service';
import { TradeGroupsService } from './trade-groups.service';

@Injectable()
export class ReportingService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly bootstrap: AccountingBootstrapService,
    private readonly pricing: PricingService,
    private readonly tradeGroups: TradeGroupsService,
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
        cashUsd = cashUsd.plus(decimal(usdString(amount)));
        continue;
      }

      const value = priceValue ? decimal(usdString(amount.mul(priceValue))) : null;
      const unrealized = value ? decimal(usdString(value.minus(costBasis))) : null;

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
        avgCostUsd: amount.gt(0) ? usdString(costBasis.div(amount)) : null,
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
    await this.bootstrap.ensureDefaults(userId);

    const [assetRow] = await this.db
      .select({ asset: assets, chainCode: chains.code })
      .from(assets)
      .innerJoin(chains, eq(assets.chainId, chains.id))
      .where(eq(assets.id, assetId))
      .limit(1);

    if (!assetRow) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Position not found' });
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

    if (assetRow.asset.isCashEquivalent) {
      const [balance] = await this.db
        .select({
          amount: sql<string>`coalesce(sum(${postings.amount}), 0)::text`,
        })
        .from(postings)
        .innerJoin(accounts, eq(postings.accountId, accounts.id))
        .where(
          and(
            eq(accounts.userId, userId),
            eq(accounts.type, 'wallet'),
            eq(postings.assetId, assetId),
          ),
        );
      const amount = decimal(balance?.amount ?? '0');

      return {
        asset: assetContract,
        amount: amount.toFixed(18),
        priceUsd: '1.00000000',
        valueUsd: usdString(amount),
        avgCostUsd: '1.00000000',
        costBasisUsd: usdString(amount),
        unrealizedPnlUsd: '0.00000000',
        isCashEquivalent: true,
      };
    }

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

    const totalPnl = realized.plus(unrealized).plus(income).plus(adjustments).minus(fees);
    const roiPct = netDeposits.gt(0) ? totalPnl.div(netDeposits).mul(100).toFixed(2) : null;

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
      totalPnlUsd: usdString(totalPnl),
      roiPct,
      activePositionsCount: positions.positions.length,
      missingPrices: positions.missingPrices,
    };
  }

  async allocation(userId: string): Promise<DashboardAllocation> {
    const positions = await this.positions(userId);
    const total = decimal(positions.equityUsd);
    const slices: DashboardAllocation['slices'] = [];

    if (decimal(positions.cashUsd).gt(0)) {
      slices.push({
        key: 'cash',
        label: 'USDT / cash',
        kind: 'cash',
        valueUsd: positions.cashUsd,
        percent: total.gt(0) ? decimal(positions.cashUsd).div(total).mul(100).toFixed(2) : '0.00',
      });
    }

    for (const position of positions.positions) {
      if (!position.valueUsd || decimal(position.valueUsd).lte(0)) continue;

      slices.push({
        key: position.asset.id,
        label: position.asset.symbol,
        kind: 'asset',
        valueUsd: position.valueUsd,
        percent: total.gt(0) ? decimal(position.valueUsd).div(total).mul(100).toFixed(2) : '0.00',
      });
    }

    slices.sort((a, b) => decimal(b.valueUsd).comparedTo(decimal(a.valueUsd)));

    return {
      totalUsd: positions.equityUsd,
      slices,
      missingPrices: positions.missingPrices,
    };
  }

  async pnlByMonth(userId: string): Promise<DashboardPnl> {
    const [settingsRow] = await this.db
      .select()
      .from(settingsTable)
      .where(eq(settingsTable.userId, userId))
      .limit(1);
    const configuredTimezone = settingsRow?.timezone ?? 'Europe/Minsk';
    let timezone = 'Europe/Minsk';

    try {
      new Intl.DateTimeFormat('en-US', { timeZone: configuredTimezone }).format();
      timezone = configuredTimezone;
    } catch {
      timezone = 'Europe/Minsk';
    }

    // Use a validated literal so the SELECT and GROUP BY expressions are
    // syntactically identical (separate bind placeholders are not).
    const timezoneLiteral = sql.raw(`'${timezone.replaceAll("'", "''")}'`);
    const monthExpression = sql<string>`to_char(date_trunc('month', ${transactions.occurredAt} AT TIME ZONE ${timezoneLiteral}), 'YYYY-MM')`;
    const monthGroup = sql`date_trunc('month', ${transactions.occurredAt} AT TIME ZONE ${timezoneLiteral})`;

    const realizedRows = await this.db
      .select({
        month: monthExpression,
        total: sql<string>`coalesce(sum(${lotConsumptions.realizedPnlUsd}), 0)::text`,
      })
      .from(lotConsumptions)
      .innerJoin(lots, eq(lotConsumptions.lotId, lots.id))
      .innerJoin(transactions, eq(lotConsumptions.disposalTransactionId, transactions.id))
      .where(eq(lots.userId, userId))
      .groupBy(monthGroup);

    const cashRows = await this.db
      .select({
        month: monthExpression,
        type: transactions.type,
        total: sql<string>`coalesce(sum(${postings.usdValue}), 0)::text`,
      })
      .from(postings)
      .innerJoin(transactions, eq(postings.transactionId, transactions.id))
      .innerJoin(accounts, eq(postings.accountId, accounts.id))
      .where(
        and(
          eq(transactions.userId, userId),
          eq(accounts.type, 'wallet'),
          inArray(transactions.type, ['income', 'adjustment']),
        ),
      )
      .groupBy(monthGroup, transactions.type);

    const feeRows = await this.db
      .select({
        month: monthExpression,
        total: sql<string>`coalesce(sum(${transactions.feesUsd}), 0)::text`,
      })
      .from(transactions)
      .where(eq(transactions.userId, userId))
      .groupBy(monthGroup);

    const months = new Map<
      string,
      { realized: Decimal; income: Decimal; adjustments: Decimal; fees: Decimal }
    >();

    const bucket = (month: string) => {
      const existing = months.get(month);
      if (existing) return existing;

      const created = {
        realized: new Decimal(0),
        income: new Decimal(0),
        adjustments: new Decimal(0),
        fees: new Decimal(0),
      };
      months.set(month, created);
      return created;
    };

    for (const row of realizedRows) bucket(row.month).realized = decimal(row.total);
    for (const row of cashRows) {
      const entry = bucket(row.month);
      if (row.type === 'income') entry.income = entry.income.plus(row.total);
      else entry.adjustments = entry.adjustments.plus(row.total);
    }
    for (const row of feeRows) bucket(row.month).fees = decimal(row.total);

    return {
      months: [...months.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([month, value]) => ({
          month,
          realizedUsd: usdString(value.realized),
          incomeUsd: usdString(value.income),
          adjustmentsUsd: usdString(value.adjustments),
          feesUsd: usdString(value.fees),
          totalUsd: usdString(
            value.realized.plus(value.income).plus(value.adjustments).minus(value.fees),
          ),
        })),
    };
  }

  async activePositions(userId: string): Promise<DashboardActivePositions> {
    const positions = await this.positions(userId);
    return {
      positions: positions.positions,
      missingPrices: positions.missingPrices,
    };
  }

  async recentTrades(userId: string): Promise<DashboardRecentTrades> {
    const result = await this.tradeGroups.list(userId, { limit: 5 });
    return { data: result.data };
  }

  async dataQuality(userId: string): Promise<DashboardDataQuality> {
    const positions = await this.positions(userId);
    const assetRows = await this.db.select().from(assets);
    const transactionRows = await this.db
      .select({
        id: transactions.id,
        source: transactions.source,
        sourceId: transactions.sourceId,
        dataQuality: transactions.dataQuality,
      })
      .from(transactions)
      .where(eq(transactions.userId, userId));

    const unverifiedAssets = assetRows
      .filter((asset) => !asset.isVerified)
      .map((asset) => asset.symbol);
    const unknownChain = assetRows
      .filter((asset) => asset.dataQuality.chainKnown === false)
      .map((asset) => asset.symbol);
    const unknownContract = assetRows
      .filter((asset) => asset.dataQuality.contractKnown === false)
      .map((asset) => asset.symbol);
    const missingGas = transactionRows
      .filter((row) => row.dataQuality.networkFeeIncluded === false)
      .map((row) => row.sourceId ?? row.id);
    const unreconciled = transactionRows
      .filter((row) => row.dataQuality.reconciled === false)
      .map((row) => row.sourceId ?? row.id);

    const negativeRows = await this.db
      .select({
        accountId: accounts.id,
        accountName: accounts.name,
        assetId: assets.id,
        symbol: assets.symbol,
        amount: sql<string>`coalesce(sum(${postings.amount}), 0)::text`,
      })
      .from(postings)
      .innerJoin(accounts, eq(postings.accountId, accounts.id))
      .innerJoin(assets, eq(postings.assetId, assets.id))
      .where(and(eq(accounts.userId, userId), eq(accounts.type, 'wallet')))
      .groupBy(accounts.id, accounts.name, assets.id, assets.symbol)
      .having(sql`sum(${postings.amount}) < 0`);

    const issues: DashboardDataQuality['issues'] = [];
    const addIssue = (
      code: string,
      label: string,
      severity: 'info' | 'warning' | 'error',
      values: string[],
    ) => {
      if (values.length === 0) return;
      issues.push({
        code,
        label,
        severity,
        count: values.length,
        details: values.slice(0, 20),
      });
    };

    addIssue(
      'negative_balances',
      'Отрицательные балансы кошельков',
      'error',
      negativeRows.map((row) => `${row.accountName}: ${row.symbol} ${row.amount}`),
    );
    addIssue('missing_prices', 'Нет цены для активов', 'warning', positions.missingPrices);
    addIssue('unverified_assets', 'Непроверенные активы', 'warning', unverifiedAssets);
    addIssue(
      'unknown_chain',
      'Неизвестная сеть у импортированных активов',
      'warning',
      unknownChain,
    );
    addIssue(
      'unknown_contract',
      'Неизвестный контракт у импортированных активов',
      'warning',
      unknownContract,
    );
    addIssue('missing_gas', 'Не указан сетевой сбор', 'warning', missingGas);
    addIssue('unreconciled', 'Не сверено с ончейн-данными', 'info', unreconciled);

    return {
      issues,
      missingPrices: positions.missingPrices,
      unverifiedAssets,
      negativeBalances: negativeRows,
    };
  }

  async equityCurve(userId: string): Promise<EquityCurve> {
    const rows = await this.db
      .select({
        assetId: postings.assetId,
        amount: postings.amount,
        occurredAt: transactions.occurredAt,
        isCashEquivalent: assets.isCashEquivalent,
      })
      .from(postings)
      .innerJoin(accounts, eq(postings.accountId, accounts.id))
      .innerJoin(transactions, eq(postings.transactionId, transactions.id))
      .innerJoin(assets, eq(postings.assetId, assets.id))
      .where(and(eq(accounts.userId, userId), eq(accounts.type, 'wallet')))
      .orderBy(transactions.occurredAt, transactions.createdAt);

    if (rows.length === 0) {
      return {
        valuation: 'current-prices',
        note: 'Нет проводок для построения кривой.',
        points: [],
      };
    }

    const nonCashAssetIds = [
      ...new Set(rows.filter((row) => !row.isCashEquivalent).map((row) => row.assetId)),
    ];
    const priceByAsset = await this.pricing.latestForAssets(nonCashAssetIds);
    const balances = new Map<string, Decimal>();
    let cursor = 0;
    const points: EquityCurve['points'] = [];
    const now = new Date();
    const first = rows[0]?.occurredAt ?? now;
    const earliestStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 35, 1));
    const start = first.getTime() < earliestStart.getTime() ? earliestStart : first;
    let year = start.getUTCFullYear();
    let month = start.getUTCMonth();

    while (points.length < 36) {
      const monthEnd = new Date(Date.UTC(year, month + 1, 0, 23, 59, 59, 999));
      const isCurrentPoint = monthEnd.getTime() >= now.getTime();
      const pointDate = isCurrentPoint ? now : monthEnd;

      // The current point represents the current ledger state. Some imported
      // date-only closes are normalized to end of day and can be a few hours
      // ahead of the clock; include all recorded postings for "now".
      while (
        cursor < rows.length &&
        (isCurrentPoint || (rows[cursor]?.occurredAt.getTime() ?? 0) <= pointDate.getTime())
      ) {
        const row = rows[cursor];
        if (!row) break;
        balances.set(row.assetId, (balances.get(row.assetId) ?? new Decimal(0)).plus(row.amount));
        cursor += 1;
      }

      let cash = new Decimal(0);
      let positionsValue = new Decimal(0);

      for (const [assetId, amount] of balances) {
        const row = rows.find((item) => item.assetId === assetId);
        if (row?.isCashEquivalent) {
          cash = cash.plus(decimal(usdString(amount)));
          continue;
        }
        const price = priceByAsset.get(assetId);
        if (price) {
          positionsValue = positionsValue.plus(decimal(usdString(amount.mul(decimal(price)))));
        }
      }

      points.push({
        date: pointDate.toISOString(),
        cashUsd: usdString(cash),
        positionsValueUsd: usdString(positionsValue),
        equityUsd: usdString(cash.plus(positionsValue)),
      });

      if (monthEnd.getTime() >= now.getTime()) break;
      month += 1;
      if (month > 11) {
        month = 0;
        year += 1;
      }
    }

    return {
      valuation: 'current-prices',
      note: 'Исторические остатки оценены по текущим ценам; точная историческая переоценка появится после ежедневных снимков.',
      points,
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

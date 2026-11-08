import { Inject, Injectable } from '@nestjs/common';
import { and, eq, gte, inArray, isNotNull, lt, sql } from 'drizzle-orm';
import {
  accounts,
  assets,
  chains,
  lotConsumptions,
  lots,
  postings,
  swapOrders,
  transactions,
  type Database,
} from '@nexter/db';
import type {
  Asset as AssetContract,
  ReportAsset,
  ReportMonth,
  ReportOperation,
  ReportsQuery,
  ReportsResponse,
} from '@nexter/contracts';
import { DB } from '../../shared/db/db.module';
import { Decimal, decimal, usdString } from '../../shared/money/decimal';
import { resolveReportPeriod } from './report-period';

const OPERATION_ORDER = [
  'deposit',
  'withdrawal',
  'buy',
  'sell',
  'swap',
  'transfer',
  'income',
  'adjustment',
  'fee',
];

interface MonthBucket {
  realized: Decimal;
  fees: Decimal;
  gas: Decimal;
  deposits: Decimal;
  withdrawals: Decimal;
  income: Decimal;
  adjustments: Decimal;
  transactionsCount: number;
}

interface AssetBucket {
  asset: AssetContract;
  realized: Decimal;
  proceeds: Decimal;
  costBasis: Decimal;
  consumptionsCount: number;
  tradeGroupIds: Set<string>;
  lastDisposalAt: Date;
}

function assetContract(asset: typeof assets.$inferSelect, chainCode: string): AssetContract {
  return {
    id: asset.id,
    chainId: asset.chainId,
    chainCode,
    symbol: asset.symbol,
    name: asset.name,
    decimals: asset.decimals,
    contractAddress: asset.contractAddress,
    coingeckoId: asset.coingeckoId,
    isStablecoin: asset.isStablecoin,
    isCashEquivalent: asset.isCashEquivalent,
    isVerified: asset.isVerified,
  };
}

@Injectable()
export class ReportsService {
  constructor(@Inject(DB) private readonly db: Database) {}

  async report(userId: string, query: ReportsQuery): Promise<ReportsResponse> {
    const period = await resolveReportPeriod(this.db, userId, query.from, query.to);
    const timezoneLiteral = sql.raw(`'${period.timezone.replaceAll("'", "''")}'`);
    const monthExpression = sql<string>`to_char(date_trunc('month', ${transactions.occurredAt} AT TIME ZONE ${timezoneLiteral}), 'YYYY-MM')`;
    const monthGroup = sql`date_trunc('month', ${transactions.occurredAt} AT TIME ZONE ${timezoneLiteral})`;

    const transactionConditions = [eq(transactions.userId, userId)];
    if (period.fromInstant) {
      transactionConditions.push(gte(transactions.occurredAt, period.fromInstant));
    }
    if (period.toInstantExclusive) {
      transactionConditions.push(lt(transactions.occurredAt, period.toInstantExclusive));
    }

    const consumptionConditions = [eq(lots.userId, userId)];
    if (period.fromInstant) {
      consumptionConditions.push(gte(transactions.occurredAt, period.fromInstant));
    }
    if (period.toInstantExclusive) {
      consumptionConditions.push(lt(transactions.occurredAt, period.toInstantExclusive));
    }

    const consumptionRows = await this.db
      .select({
        tradeGroupId: lots.tradeGroupId,
        assetId: lots.assetId,
        realized: sql<string>`coalesce(sum(${lotConsumptions.realizedPnlUsd}), 0)::text`,
        proceeds: sql<string>`coalesce(sum(${lotConsumptions.proceedsUsd}), 0)::text`,
        costBasis: sql<string>`coalesce(sum(${lotConsumptions.costBasisUsd}), 0)::text`,
        consumptionsCount: sql<number>`count(*)::int`,
        lastDisposalAt: sql<Date>`max(${transactions.occurredAt})`,
        asset: assets,
        chainCode: chains.code,
      })
      .from(lotConsumptions)
      .innerJoin(lots, eq(lotConsumptions.lotId, lots.id))
      .innerJoin(transactions, eq(lotConsumptions.disposalTransactionId, transactions.id))
      .innerJoin(assets, eq(lots.assetId, assets.id))
      .innerJoin(chains, eq(assets.chainId, chains.id))
      .where(and(...consumptionConditions))
      .groupBy(lots.tradeGroupId, lots.assetId, assets.id, chains.code);

    const realizedMonthlyRows = await this.db
      .select({
        month: monthExpression,
        total: sql<string>`coalesce(sum(${lotConsumptions.realizedPnlUsd}), 0)::text`,
      })
      .from(lotConsumptions)
      .innerJoin(lots, eq(lotConsumptions.lotId, lots.id))
      .innerJoin(transactions, eq(lotConsumptions.disposalTransactionId, transactions.id))
      .where(and(...consumptionConditions))
      .groupBy(monthGroup);

    const cashMonthlyRows = await this.db
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
          ...transactionConditions,
          eq(accounts.type, 'wallet'),
          inArray(transactions.type, ['deposit', 'withdrawal', 'income', 'adjustment']),
        ),
      )
      .groupBy(monthGroup, transactions.type);

    const transactionMonthlyRows = await this.db
      .select({
        month: monthExpression,
        count: sql<number>`count(*)::int`,
        fees: sql<string>`coalesce(sum(${transactions.feesUsd}), 0)::text`,
      })
      .from(transactions)
      .where(and(...transactionConditions))
      .groupBy(monthGroup);

    const gasConditions = [eq(swapOrders.userId, userId), eq(swapOrders.status, 'CONFIRMED')];
    if (period.fromInstant) {
      gasConditions.push(gte(swapOrders.confirmedAt, period.fromInstant));
    }
    if (period.toInstantExclusive) {
      gasConditions.push(lt(swapOrders.confirmedAt, period.toInstantExclusive));
    }

    const gasMonthlyRows = await this.db
      .select({
        month: sql<string>`to_char(date_trunc('month', ${swapOrders.confirmedAt} AT TIME ZONE ${timezoneLiteral}), 'YYYY-MM')`,
        total: sql<string>`coalesce(sum(${swapOrders.networkFeeUsd}), 0)::text`,
      })
      .from(swapOrders)
      .where(and(...gasConditions, isNotNull(swapOrders.confirmedAt)))
      .groupBy(sql`date_trunc('month', ${swapOrders.confirmedAt} AT TIME ZONE ${timezoneLiteral})`);

    const operationRows = await this.db
      .select({
        subtype: transactions.subtype,
        count: sql<number>`count(*)::int`,
        fees: sql<string>`coalesce(sum(${transactions.feesUsd}), 0)::text`,
      })
      .from(transactions)
      .where(and(...transactionConditions))
      .groupBy(transactions.subtype);

    const groupPnl = new Map<string, Decimal>();
    const assetMap = new Map<string, AssetBucket>();
    let realized = new Decimal(0);

    for (const row of consumptionRows) {
      const value = decimal(row.realized);
      realized = realized.plus(value);

      if (row.tradeGroupId) {
        groupPnl.set(
          row.tradeGroupId,
          (groupPnl.get(row.tradeGroupId) ?? new Decimal(0)).plus(value),
        );
      }

      // Fee-asset lots are reduced without proceeds or realized P&L. They are
      // not disposals and should not appear as an asset with a zero result.
      if (!row.tradeGroupId && decimal(row.proceeds).isZero() && value.isZero()) {
        continue;
      }

      const existing = assetMap.get(row.assetId);
      const lastDisposalAt = row.lastDisposalAt ? new Date(row.lastDisposalAt) : new Date(0);

      if (existing) {
        existing.realized = existing.realized.plus(row.realized);
        existing.proceeds = existing.proceeds.plus(row.proceeds);
        existing.costBasis = existing.costBasis.plus(row.costBasis);
        existing.consumptionsCount += Number(row.consumptionsCount);
        if (row.tradeGroupId) existing.tradeGroupIds.add(row.tradeGroupId);
        if (lastDisposalAt > existing.lastDisposalAt) existing.lastDisposalAt = lastDisposalAt;
        continue;
      }

      assetMap.set(row.assetId, {
        asset: assetContract(row.asset, row.chainCode),
        realized: decimal(row.realized),
        proceeds: decimal(row.proceeds),
        costBasis: decimal(row.costBasis),
        consumptionsCount: Number(row.consumptionsCount),
        tradeGroupIds: new Set(row.tradeGroupId ? [row.tradeGroupId] : []),
        lastDisposalAt,
      });
    }

    let grossProfit = new Decimal(0);
    let grossLoss = new Decimal(0);
    let winningTrades = 0;
    let losingTrades = 0;

    for (const value of groupPnl.values()) {
      if (value.gt(0)) {
        grossProfit = grossProfit.plus(value);
        winningTrades += 1;
      } else if (value.lt(0)) {
        grossLoss = grossLoss.plus(value.abs());
        losingTrades += 1;
      }
    }

    const months = new Map<string, MonthBucket>();
    const bucket = (month: string): MonthBucket => {
      const existing = months.get(month);
      if (existing) return existing;

      const created: MonthBucket = {
        realized: new Decimal(0),
        fees: new Decimal(0),
        gas: new Decimal(0),
        deposits: new Decimal(0),
        withdrawals: new Decimal(0),
        income: new Decimal(0),
        adjustments: new Decimal(0),
        transactionsCount: 0,
      };
      months.set(month, created);
      return created;
    };

    for (const row of realizedMonthlyRows) {
      bucket(row.month).realized = decimal(row.total);
    }

    for (const row of cashMonthlyRows) {
      const entry = bucket(row.month);
      const value = decimal(row.total);

      if (row.type === 'deposit') entry.deposits = entry.deposits.plus(value);
      else if (row.type === 'withdrawal') entry.withdrawals = entry.withdrawals.plus(value.abs());
      else if (row.type === 'income') entry.income = entry.income.plus(value);
      else if (row.type === 'adjustment') entry.adjustments = entry.adjustments.plus(value);
    }

    for (const row of transactionMonthlyRows) {
      const entry = bucket(row.month);
      entry.fees = entry.fees.plus(row.fees);
      entry.transactionsCount += Number(row.count);
    }

    for (const row of gasMonthlyRows) {
      bucket(row.month).gas = decimal(row.total);
    }

    let fees = new Decimal(0);
    let gas = new Decimal(0);
    let deposits = new Decimal(0);
    let withdrawals = new Decimal(0);
    let income = new Decimal(0);
    let adjustments = new Decimal(0);
    let transactionsCount = 0;

    const monthly: ReportMonth[] = [...months.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, value]) => {
        fees = fees.plus(value.fees);
        gas = gas.plus(value.gas);
        deposits = deposits.plus(value.deposits);
        withdrawals = withdrawals.plus(value.withdrawals);
        income = income.plus(value.income);
        adjustments = adjustments.plus(value.adjustments);
        transactionsCount += value.transactionsCount;

        return {
          month,
          realizedPnlUsd: usdString(value.realized),
          feesUsd: usdString(value.fees),
          gasUsd: usdString(value.gas),
          depositsUsd: usdString(value.deposits),
          withdrawalsUsd: usdString(value.withdrawals),
          incomeUsd: usdString(value.income),
          adjustmentsUsd: usdString(value.adjustments),
          netPnlUsd: usdString(
            value.realized.plus(value.income).plus(value.adjustments).minus(value.fees),
          ),
          transactionsCount: value.transactionsCount,
        };
      });

    const totalTrades = winningTrades + losingTrades;
    const byAsset: ReportAsset[] = [...assetMap.values()]
      .sort((a, b) => {
        const pnl = b.realized.comparedTo(a.realized);
        return pnl !== 0 ? pnl : a.asset.symbol.localeCompare(b.asset.symbol);
      })
      .map((entry) => ({
        asset: entry.asset,
        realizedPnlUsd: usdString(entry.realized),
        proceedsUsd: usdString(entry.proceeds),
        costBasisUsd: usdString(entry.costBasis),
        consumptionsCount: entry.consumptionsCount,
        tradesCount: entry.tradeGroupIds.size,
        lastDisposalAt: entry.lastDisposalAt.toISOString(),
      }));

    const operations: ReportOperation[] = operationRows
      .map((row) => ({
        subtype: row.subtype,
        count: Number(row.count),
        feesUsd: usdString(decimal(row.fees)),
      }))
      .sort((a, b) => {
        const aIndex = OPERATION_ORDER.indexOf(a.subtype);
        const bIndex = OPERATION_ORDER.indexOf(b.subtype);
        return (
          (aIndex === -1 ? OPERATION_ORDER.length : aIndex) -
          (bIndex === -1 ? OPERATION_ORDER.length : bIndex)
        );
      });

    return {
      period: { from: period.from, to: period.to, timezone: period.timezone },
      summary: {
        realizedPnlUsd: usdString(realized),
        grossProfitUsd: usdString(grossProfit),
        grossLossUsd: usdString(grossLoss),
        profitFactor: grossLoss.gt(0) ? grossProfit.div(grossLoss).toFixed(4) : null,
        winningTrades,
        losingTrades,
        winRatePct:
          totalTrades > 0 ? new Decimal(winningTrades).div(totalTrades).mul(100).toFixed(2) : null,
        feesUsd: usdString(fees),
        gasUsd: usdString(gas),
        depositsUsd: usdString(deposits),
        withdrawalsUsd: usdString(withdrawals),
        netDepositsUsd: usdString(deposits.minus(withdrawals)),
        netPnlUsd: usdString(realized.plus(income).plus(adjustments).minus(fees)),
        incomeUsd: usdString(income),
        adjustmentsUsd: usdString(adjustments),
        transactionsCount,
        tradesCount: groupPnl.size,
      },
      monthly,
      byAsset,
      operations,
    };
  }
}

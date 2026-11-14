import type { PortfolioTokenSummary, TradeGroupSummary } from '@nexter/contracts';
import { Decimal, amountString, decimal, usdString } from '../../shared/money/decimal';

/**
 * Consolidates only currently open trade groups. Closed groups and their realized
 * P&L/turnover are deliberately excluded: the portfolio cards describe active
 * deals, not the token's all-time history.
 */
export function aggregateTokenSummaries(groups: TradeGroupSummary[]): PortfolioTokenSummary[] {
  const byAsset = new Map<
    string,
    {
      asset: TradeGroupSummary['asset'];
      invested: Decimal;
      currentValue: Decimal;
      realized: Decimal;
      unrealized: Decimal;
      positiveUnrealized: Decimal;
      negativeUnrealized: Decimal;
      turnover: Decimal;
      remainingAmount: Decimal;
      orders: number;
      hasUnrealized: boolean;
    }
  >();

  for (const group of groups) {
    const remainingAmount = decimal(group.remainingAmount);
    if (group.status === 'closed' || remainingAmount.lte(0)) continue;

    const entry = byAsset.get(group.asset.id) ?? {
      asset: group.asset,
      invested: new Decimal(0),
      currentValue: new Decimal(0),
      realized: new Decimal(0),
      unrealized: new Decimal(0),
      positiveUnrealized: new Decimal(0),
      negativeUnrealized: new Decimal(0),
      turnover: new Decimal(0),
      remainingAmount: new Decimal(0),
      orders: 0,
      hasUnrealized: false,
    };

    entry.orders += 1;
    entry.realized = entry.realized.plus(decimal(group.realizedPnlUsd));
    entry.turnover = entry.turnover.plus(decimal(group.buyUsd)).plus(decimal(group.sellUsd));
    entry.remainingAmount = entry.remainingAmount.plus(remainingAmount);
    entry.invested = entry.invested.plus(decimal(group.remainingCostBasisUsd));
    entry.currentValue = entry.currentValue.plus(
      decimal(group.remainingCostBasisUsd).plus(
        group.unrealizedPnlUsd !== null ? decimal(group.unrealizedPnlUsd) : 0,
      ),
    );

    if (group.unrealizedPnlUsd !== null) {
      const pnl = decimal(group.unrealizedPnlUsd);
      entry.hasUnrealized = true;
      entry.unrealized = entry.unrealized.plus(pnl);
      if (pnl.gt(0)) entry.positiveUnrealized = entry.positiveUnrealized.plus(pnl);
      else if (pnl.lt(0)) entry.negativeUnrealized = entry.negativeUnrealized.plus(pnl.abs());
    }

    byAsset.set(group.asset.id, entry);
  }

  return [...byAsset.values()]
    .sort((left, right) => right.invested.comparedTo(left.invested))
    .map((entry) => ({
      asset: entry.asset,
      investedUsd: usdString(entry.invested),
      currentValueUsd: usdString(entry.currentValue),
      realizedPnlUsd: usdString(entry.realized),
      unrealizedPnlUsd: entry.hasUnrealized ? usdString(entry.unrealized) : null,
      positiveUnrealizedUsd: usdString(entry.positiveUnrealized),
      negativeUnrealizedUsd: usdString(entry.negativeUnrealized),
      totalPnlUsd: usdString(entry.realized.plus(entry.unrealized)),
      turnoverUsd: usdString(entry.turnover),
      breakEvenPriceUsd: entry.remainingAmount.gt(0)
        ? entry.invested.div(entry.remainingAmount).toFixed(18)
        : null,
      openOrdersCount: entry.orders,
      ordersCount: entry.orders,
      remainingAmount: amountString(entry.remainingAmount),
    }));
}

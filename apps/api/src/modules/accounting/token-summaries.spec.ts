import { randomUUID } from 'node:crypto';
import type { Asset, TradeGroupSummary } from '@nexter/contracts';
import { describe, expect, it } from 'vitest';
import { aggregateTokenSummaries } from './token-summaries';

function asset(symbol: string): Asset {
  return {
    id: randomUUID(),
    chainId: randomUUID(),
    chainCode: 'bsc',
    symbol,
    name: symbol,
    decimals: 18,
    contractAddress: null,
    coingeckoId: null,
    logoUrl: null,
    isStablecoin: false,
    isCashEquivalent: false,
    isVerified: true,
  };
}

function group(token: Asset, overrides: Partial<TradeGroupSummary> = {}): TradeGroupSummary {
  return {
    id: randomUUID(),
    asset: token,
    status: 'open',
    openedAt: '2026-01-01T00:00:00.000Z',
    closedAt: null,
    buyUsd: '0',
    sellUsd: '0',
    realizedPnlUsd: '0',
    unrealizedPnlUsd: null,
    totalPnlUsd: null,
    priceUpdatedAt: null,
    priceFetchedAt: null,
    priceSource: null,
    gasUsd: '0',
    remainingAmount: '0',
    costBasisUsd: '0',
    remainingCostBasisUsd: '0',
    returnPct: null,
    holdingDays: 0,
    source: 'manual',
    notes: null,
    quality: {
      assetVerified: true,
      chainKnown: true,
      contractKnown: false,
      networkFeeIncluded: false,
      reconciled: false,
    },
    ...overrides,
  };
}

describe('aggregateTokenSummaries', () => {
  it('consolidates open, partial, closed, and missing-quote orders per token', () => {
    const alpha = asset('ALPHA');
    const beta = asset('BETA');
    const gamma = asset('GAMMA');

    const rows = aggregateTokenSummaries([
      group(alpha, {
        status: 'closed',
        buyUsd: '500',
        sellUsd: '800',
        realizedPnlUsd: '300',
        remainingAmount: '0',
        remainingCostBasisUsd: '0',
      }),
      group(alpha, {
        status: 'open',
        buyUsd: '1000',
        sellUsd: '0',
        realizedPnlUsd: '0',
        unrealizedPnlUsd: '150',
        remainingAmount: '10',
        remainingCostBasisUsd: '900',
      }),
      group(alpha, {
        status: 'partial',
        buyUsd: '2000',
        sellUsd: '500',
        realizedPnlUsd: '100',
        unrealizedPnlUsd: '-80',
        remainingAmount: '20',
        remainingCostBasisUsd: '1200',
      }),
      group(beta, {
        status: 'closed',
        buyUsd: '500',
        sellUsd: '600',
        realizedPnlUsd: '100',
      }),
      group(gamma, {
        status: 'partial',
        buyUsd: '60',
        sellUsd: '10',
        realizedPnlUsd: '10',
        unrealizedPnlUsd: null,
        remainingAmount: '5',
        remainingCostBasisUsd: '50',
      }),
    ]);

    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      asset: alpha,
      investedUsd: '2100.00000000',
      realizedPnlUsd: '100.00000000',
      unrealizedPnlUsd: '70.00000000',
      positiveUnrealizedUsd: '150.00000000',
      negativeUnrealizedUsd: '80.00000000',
      totalPnlUsd: '170.00000000',
      turnoverUsd: '3500.00000000',
      breakEvenPriceUsd: '70.000000000000000000',
      openOrdersCount: 2,
      ordersCount: 2,
      remainingAmount: '30.000000000000000000',
    });

    expect(rows[1]).toMatchObject({
      asset: gamma,
      investedUsd: '50.00000000',
      realizedPnlUsd: '10.00000000',
      unrealizedPnlUsd: null,
      positiveUnrealizedUsd: '0.00000000',
      negativeUnrealizedUsd: '0.00000000',
      totalPnlUsd: '10.00000000',
      turnoverUsd: '70.00000000',
      breakEvenPriceUsd: '10.000000000000000000',
      openOrdersCount: 1,
      ordersCount: 1,
    });
  });
});

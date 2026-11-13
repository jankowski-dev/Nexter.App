import { z } from 'zod';
import { auditEntrySchema } from './audit';
import {
  assetSchema,
  positionSchema,
  positiveDecimalSchema,
  priceSchema,
  tradeGroupStatusSchema,
  transactionSchema,
  transactionSourceSchema,
} from './accounting';
import { pageMetaSchema } from './pagination';

export const lotSchema = z.object({
  id: z.uuid(),
  assetId: z.uuid(),
  tradeGroupId: z.uuid().nullable(),
  acquisitionTransactionId: z.uuid(),
  amount: z.string(),
  remainingAmount: z.string(),
  costBasisUsd: z.string(),
  remainingCostBasisUsd: z.string(),
  acquiredAt: z.iso.datetime(),
});

export const lotConsumptionSchema = z.object({
  id: z.uuid(),
  lotId: z.uuid(),
  disposalTransactionId: z.uuid(),
  disposalOccurredAt: z.iso.datetime(),
  amount: z.string(),
  costBasisUsd: z.string(),
  proceedsUsd: z.string(),
  realizedPnlUsd: z.string(),
  createdAt: z.iso.datetime(),
});

export const tradeGroupQualitySchema = z.object({
  assetVerified: z.boolean(),
  chainKnown: z.boolean(),
  contractKnown: z.boolean(),
  networkFeeIncluded: z.boolean(),
  reconciled: z.boolean(),
});

export const tradeGroupSummarySchema = z.object({
  id: z.uuid(),
  asset: assetSchema,
  status: tradeGroupStatusSchema,
  openedAt: z.iso.datetime(),
  closedAt: z.iso.datetime().nullable(),
  buyUsd: z.string(),
  sellUsd: z.string(),
  realizedPnlUsd: z.string(),
  unrealizedPnlUsd: z.string().nullable(),
  totalPnlUsd: z.string().nullable(),
  priceUpdatedAt: z.iso.datetime().nullable(),
  priceFetchedAt: z.iso.datetime().nullable(),
  priceSource: z.string().nullable(),
  gasUsd: z.string(),
  remainingAmount: z.string(),
  costBasisUsd: z.string(),
  remainingCostBasisUsd: z.string(),
  returnPct: z.string().nullable(),
  holdingDays: z.number().int().nonnegative(),
  source: transactionSourceSchema,
  notes: z.string().nullable(),
  quality: tradeGroupQualitySchema,
});

export const tradeGroupsResponseSchema = z.object({
  data: z.array(tradeGroupSummarySchema),
  page: pageMetaSchema,
});

export const tradeGroupDetailSchema = z.object({
  group: tradeGroupSummarySchema,
  legs: z.array(transactionSchema),
  lots: z.array(lotSchema),
  consumptions: z.array(lotConsumptionSchema),
  audit: z.array(auditEntrySchema),
});

export const tradeGroupSellRequestSchema = z.object({
  accountId: z.uuid(),
  amount: positiveDecimalSchema,
  proceedsAssetId: z.uuid(),
  proceedsAmount: positiveDecimalSchema,
  usdValue: positiveDecimalSchema.optional(),
  feeAssetId: z.uuid().optional(),
  feeAmount: positiveDecimalSchema.optional(),
  feeUsdValue: positiveDecimalSchema.optional(),
  occurredAt: z.iso.datetime().optional(),
  notes: z.string().max(2000).optional(),
});

export const tradeGroupNotesRequestSchema = z.object({
  notes: z.string().max(2000).nullable(),
});

export const tradeGroupListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().min(1).optional(),
  status: tradeGroupStatusSchema.optional(),
  assetId: z.uuid().optional(),
  source: transactionSourceSchema.optional(),
  search: z.string().max(100).optional(),
  pnl: z.enum(['positive', 'negative']).optional(),
  view: z.enum(['active', 'profitable', 'losing', 'closed']).optional(),
  from: z.iso.datetime().optional(),
  to: z.iso.datetime().optional(),
});

export const transactionsPageResponseSchema = z.object({
  transactions: z.array(transactionSchema),
  page: pageMetaSchema,
});

export const transactionsListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().min(1).optional(),
  type: z
    .enum(['trade', 'transfer', 'deposit', 'withdrawal', 'fee', 'income', 'adjustment'])
    .optional(),
  subtype: z
    .enum([
      'buy',
      'sell',
      'swap',
      'transfer',
      'deposit',
      'withdrawal',
      'fee',
      'income',
      'adjustment',
    ])
    .optional(),
  source: transactionSourceSchema.optional(),
  assetId: z.uuid().optional(),
  tradeGroupId: z.uuid().optional(),
  from: z.iso.datetime().optional(),
  to: z.iso.datetime().optional(),
  search: z.string().max(100).optional(),
});

export const portfolioQuoteSchema = z.object({
  priceUsd: z.string(),
  change24hPct: z.string().nullable(),
  change7dPct: z.string().nullable(),
  change30dPct: z.string().nullable(),
  change1yPct: z.string().nullable(),
  marketCapUsd: z.string().nullable(),
  priceUpdatedAt: z.iso.datetime().nullable(),
  priceFetchedAt: z.iso.datetime().nullable(),
  priceSource: z.string().nullable(),
});

export const portfolioAssetDetailSchema = z.object({
  asset: assetSchema,
  position: positionSchema.nullable(),
  quote: portfolioQuoteSchema.nullable(),
  thesis: z.string().nullable(),
  tags: z.array(z.string()),
  lots: z.array(lotSchema),
  tradeGroups: z.array(tradeGroupSummarySchema),
  transactions: z.array(transactionSchema),
  prices: z.array(priceSchema),
});

export const allocationSliceSchema = z.object({
  key: z.string(),
  label: z.string(),
  kind: z.enum(['cash', 'asset', 'chain']),
  valueUsd: z.string(),
  percent: z.string(),
});

export const dashboardAllocationSchema = z.object({
  totalUsd: z.string(),
  slices: z.array(allocationSliceSchema),
  missingPrices: z.array(z.string()),
});

export const pnlMonthSchema = z.object({
  month: z.string(),
  realizedUsd: z.string(),
  incomeUsd: z.string(),
  adjustmentsUsd: z.string(),
  feesUsd: z.string(),
  totalUsd: z.string(),
});

export const dashboardPnlSchema = z.object({
  months: z.array(pnlMonthSchema),
});

export const dashboardActivePositionsSchema = z.object({
  positions: z.array(positionSchema),
  missingPrices: z.array(z.string()),
});

export const dashboardRecentTradesSchema = z.object({
  data: z.array(tradeGroupSummarySchema),
});

export const dataQualityIssueSchema = z.object({
  code: z.string(),
  label: z.string(),
  severity: z.enum(['info', 'warning', 'error']),
  count: z.number().int().nonnegative(),
  details: z.array(z.string()),
});

export const dashboardDataQualitySchema = z.object({
  issues: z.array(dataQualityIssueSchema),
  missingPrices: z.array(z.string()),
  unverifiedAssets: z.array(z.string()),
  negativeBalances: z.array(
    z.object({
      accountId: z.uuid(),
      accountName: z.string(),
      assetId: z.uuid(),
      symbol: z.string(),
      amount: z.string(),
    }),
  ),
});

export const equityCurvePointSchema = z.object({
  date: z.iso.datetime(),
  cashUsd: z.string(),
  positionsValueUsd: z.string(),
  equityUsd: z.string(),
});

export const equityCurveSchema = z.object({
  valuation: z.enum(['current-prices', 'daily-snapshots']),
  note: z.string(),
  points: z.array(equityCurvePointSchema),
});

export const portfolioSnapshotSchema = z.object({
  snapshotDate: z.string(),
  cashUsd: z.string(),
  positionsValueUsd: z.string(),
  equityUsd: z.string(),
  capturedAt: z.iso.datetime(),
});

export type Lot = z.infer<typeof lotSchema>;
export type LotConsumption = z.infer<typeof lotConsumptionSchema>;
export type TradeGroupQuality = z.infer<typeof tradeGroupQualitySchema>;
export type TradeGroupSummary = z.infer<typeof tradeGroupSummarySchema>;
export type TradeGroupsResponse = z.infer<typeof tradeGroupsResponseSchema>;
export type TradeGroupDetail = z.infer<typeof tradeGroupDetailSchema>;
export type TradeGroupSellRequest = z.infer<typeof tradeGroupSellRequestSchema>;
export type TradeGroupNotesRequest = z.infer<typeof tradeGroupNotesRequestSchema>;
export type TradeGroupView = NonNullable<z.infer<typeof tradeGroupListQuerySchema>['view']>;
export type TradeGroupListQuery = z.infer<typeof tradeGroupListQuerySchema>;
export type TransactionsListQuery = z.infer<typeof transactionsListQuerySchema>;
export type TransactionsPageResponse = z.infer<typeof transactionsPageResponseSchema>;
export type PortfolioQuote = z.infer<typeof portfolioQuoteSchema>;
export type PortfolioAssetDetail = z.infer<typeof portfolioAssetDetailSchema>;
export type AllocationSlice = z.infer<typeof allocationSliceSchema>;
export type DashboardAllocation = z.infer<typeof dashboardAllocationSchema>;
export type PnlMonth = z.infer<typeof pnlMonthSchema>;
export type DashboardPnl = z.infer<typeof dashboardPnlSchema>;
export type DashboardActivePositions = z.infer<typeof dashboardActivePositionsSchema>;
export type DashboardRecentTrades = z.infer<typeof dashboardRecentTradesSchema>;
export type DataQualityIssue = z.infer<typeof dataQualityIssueSchema>;
export type DashboardDataQuality = z.infer<typeof dashboardDataQualitySchema>;
export type EquityCurvePoint = z.infer<typeof equityCurvePointSchema>;
export type EquityCurve = z.infer<typeof equityCurveSchema>;
export type PortfolioSnapshot = z.infer<typeof portfolioSnapshotSchema>;

export const portfolioTokenSummarySchema = z.object({
  asset: assetSchema,
  investedUsd: z.string(),
  realizedPnlUsd: z.string(),
  unrealizedPnlUsd: z.string().nullable(),
  positiveUnrealizedUsd: z.string(),
  negativeUnrealizedUsd: z.string(),
  totalPnlUsd: z.string(),
  turnoverUsd: z.string(),
  breakEvenPriceUsd: z.string().nullable(),
  openOrdersCount: z.number().int().nonnegative(),
  ordersCount: z.number().int().nonnegative(),
  remainingAmount: z.string(),
});

export const portfolioTokenSummariesResponseSchema = z.object({
  data: z.array(portfolioTokenSummarySchema),
});

export type PortfolioTokenSummary = z.infer<typeof portfolioTokenSummarySchema>;
export type PortfolioTokenSummariesResponse = z.infer<typeof portfolioTokenSummariesResponseSchema>;

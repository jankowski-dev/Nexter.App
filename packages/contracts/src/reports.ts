import { z } from 'zod';
import { assetSchema, transactionSubtypeSchema } from './accounting';

export const reportsQuerySchema = z.object({
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
});

export const reportPeriodSchema = z.object({
  from: z.iso.date().nullable(),
  to: z.iso.date().nullable(),
  timezone: z.string().min(1),
});

export const reportSummarySchema = z.object({
  realizedPnlUsd: z.string(),
  grossProfitUsd: z.string(),
  grossLossUsd: z.string(),
  profitFactor: z.string().nullable(),
  winningTrades: z.number().int().nonnegative(),
  losingTrades: z.number().int().nonnegative(),
  winRatePct: z.string().nullable(),
  feesUsd: z.string(),
  gasUsd: z.string(),
  depositsUsd: z.string(),
  withdrawalsUsd: z.string(),
  netDepositsUsd: z.string(),
  netPnlUsd: z.string(),
  incomeUsd: z.string(),
  adjustmentsUsd: z.string(),
  transactionsCount: z.number().int().nonnegative(),
  tradesCount: z.number().int().nonnegative(),
});

export const reportMonthSchema = z.object({
  month: z.string(),
  realizedPnlUsd: z.string(),
  feesUsd: z.string(),
  gasUsd: z.string(),
  depositsUsd: z.string(),
  withdrawalsUsd: z.string(),
  incomeUsd: z.string(),
  adjustmentsUsd: z.string(),
  netPnlUsd: z.string(),
  transactionsCount: z.number().int().nonnegative(),
});

export const reportAssetSchema = z.object({
  asset: assetSchema,
  realizedPnlUsd: z.string(),
  proceedsUsd: z.string(),
  costBasisUsd: z.string(),
  consumptionsCount: z.number().int().nonnegative(),
  tradesCount: z.number().int().nonnegative(),
  lastDisposalAt: z.iso.datetime(),
});

export const reportOperationSchema = z.object({
  subtype: transactionSubtypeSchema,
  count: z.number().int().nonnegative(),
  feesUsd: z.string(),
});

export const reportsResponseSchema = z.object({
  period: reportPeriodSchema,
  summary: reportSummarySchema,
  monthly: z.array(reportMonthSchema),
  byAsset: z.array(reportAssetSchema),
  operations: z.array(reportOperationSchema),
});

export type ReportsQuery = z.infer<typeof reportsQuerySchema>;
export type ReportPeriod = z.infer<typeof reportPeriodSchema>;
export type ReportSummary = z.infer<typeof reportSummarySchema>;
export type ReportMonth = z.infer<typeof reportMonthSchema>;
export type ReportAsset = z.infer<typeof reportAssetSchema>;
export type ReportOperation = z.infer<typeof reportOperationSchema>;
export type ReportsResponse = z.infer<typeof reportsResponseSchema>;

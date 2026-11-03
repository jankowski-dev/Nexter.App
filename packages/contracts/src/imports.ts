import { z } from 'zod';

const notionRowSchema = z.record(z.string(), z.unknown());

export const notionImportRequestSchema = z.object({
  fileName: z.string().max(255).optional(),
  source: z.array(notionRowSchema).max(10_000),
  orders: z.array(notionRowSchema).max(50_000),
  transactions: z.array(notionRowSchema).max(50_000),
});

const importTotalsSchema = z.object({
  orders: z.number().int(),
  closedOrders: z.number().int(),
  activeOrders: z.number().int(),
  depositsUsd: z.string(),
  withdrawalsUsd: z.string(),
  buyUsd: z.string(),
  sellUsd: z.string(),
  realizedPnlUsd: z.string(),
  cashUsd: z.string(),
  activeCostUsd: z.string(),
});

const importValuationSchema = z.object({
  priceSource: z.literal('notion:Курс [1]'),
  activeCostUsd: z.string(),
  activeValueUsd: z.string(),
  unrealizedPnlUsd: z.string(),
  realizedPnlUsd: z.string(),
  cashUsd: z.string(),
  equityUsd: z.string(),
  totalPnlUsd: z.string(),
  missingPrices: z.array(z.string()),
  controlSnapshot: z.object({
    activeCostUsd: z.string(),
    activeValueUsd: z.string(),
    unrealizedPnlUsd: z.string(),
    equityUsd: z.string(),
    totalPnlUsd: z.string(),
    note: z.string(),
  }),
});

const importCountsSchema = z.object({
  sourceAssets: z.number().int().nonnegative(),
  orders: z.number().int().nonnegative(),
  closedOrders: z.number().int().nonnegative(),
  activeOrders: z.number().int().nonnegative(),
  transactions: z.number().int().nonnegative(),
  newOrders: z.number().int().nonnegative(),
  updatedOrders: z.number().int().nonnegative(),
  skippedOrders: z.number().int().nonnegative(),
  newTransactions: z.number().int().nonnegative(),
  skippedTransactions: z.number().int().nonnegative(),
  newAssets: z.number().int().nonnegative(),
  reusedAssets: z.number().int().nonnegative(),
});

export const importSummarySchema = z.object({
  counts: importCountsSchema,
  totals: importTotalsSchema,
  control: z.object({
    applicable: z.boolean(),
    matches: z.boolean(),
    toleranceUsd: z.string(),
    expected: importTotalsSchema,
    baseline: importTotalsSchema,
    deltas: importTotalsSchema,
    adjustments: z.object({
      addedOrderIds: z.array(z.string()),
      closedAfterSnapshotOrderIds: z.array(z.string()),
    }),
  }),
  currentDeltas: importTotalsSchema,
  valuation: importValuationSchema,
  warnings: z.array(z.string()),
  errors: z.array(z.string()),
});

export const importStatusSchema = z.enum(['preview', 'committed', 'rolled_back', 'failed']);

export const importRowStatusSchema = z.enum([
  'pending',
  'imported',
  'updated',
  'skipped',
  'error',
  'rolled_back',
]);

export const importResponseSchema = z.object({
  import: z.object({
    id: z.uuid(),
    status: importStatusSchema,
    source: z.string(),
    fileName: z.string().nullable(),
    createdAt: z.iso.datetime(),
    committedAt: z.iso.datetime().nullable(),
    rolledBackAt: z.iso.datetime().nullable(),
    summary: importSummarySchema,
  }),
  rows: z
    .array(
      z.object({
        id: z.uuid(),
        entityType: z.string(),
        sourceId: z.string(),
        status: importRowStatusSchema,
        error: z.string().nullable(),
      }),
    )
    .optional(),
});

export const importsResponseSchema = z.object({
  imports: z.array(importResponseSchema.shape.import),
});

export const importReconciliationResponseSchema = z.object({
  importId: z.uuid(),
  status: importStatusSchema,
  control: importSummarySchema.shape.control,
  currentDeltas: importTotalsSchema,
  valuation: importValuationSchema,
});

export type NotionImportRequest = z.infer<typeof notionImportRequestSchema>;
export type ImportTotals = z.infer<typeof importTotalsSchema>;
export type ImportCounts = z.infer<typeof importCountsSchema>;
export type ImportSummary = z.infer<typeof importSummarySchema>;
export type ImportStatus = z.infer<typeof importStatusSchema>;
export type ImportRowStatus = z.infer<typeof importRowStatusSchema>;
export type ImportResponse = z.infer<typeof importResponseSchema>;
export type ImportsResponse = z.infer<typeof importsResponseSchema>;
export type ImportReconciliationResponse = z.infer<typeof importReconciliationResponseSchema>;
export type ImportValuation = z.infer<typeof importValuationSchema>;

import { z } from 'zod';
import { swapChainCodeSchema } from './swap';

export const reconciliationAddressSchema = z.object({
  id: z.uuid(),
  chain: swapChainCodeSchema,
  address: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  label: z.string().nullable(),
  enabled: z.boolean(),
  lastIndexedBlock: z.number().int().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export const reconciliationAddressesResponseSchema = z.object({
  data: z.array(reconciliationAddressSchema),
});

export const reconciliationAddressCreateSchema = z.object({
  chain: swapChainCodeSchema,
  address: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  label: z.string().trim().min(1).max(80).optional(),
});

export const reconciliationItemSchema = z.object({
  id: z.uuid(),
  symbol: z.string(),
  contractAddress: z.string().nullable(),
  ledgerBalance: z.string(),
  onchainBalance: z.string(),
  delta: z.string(),
  status: z.enum(['MATCH', 'MISMATCH', 'MISSING_ONCHAIN', 'MISSING_LEDGER', 'UNSUPPORTED']),
  details: z.unknown(),
});

export const reconciliationRunSchema = z.object({
  id: z.uuid(),
  chain: swapChainCodeSchema,
  status: z.enum(['RUNNING', 'COMPLETED', 'FAILED']),
  blockNumber: z.number().int().nullable(),
  summary: z.unknown(),
  error: z.string().nullable(),
  startedAt: z.iso.datetime(),
  completedAt: z.iso.datetime().nullable(),
  items: z.array(reconciliationItemSchema).optional(),
});

export const reconciliationRunsResponseSchema = z.object({
  data: z.array(reconciliationRunSchema.omit({ items: true })),
});

export const reconciliationRunRequestSchema = z.object({
  chain: swapChainCodeSchema,
});

export const reconciliationRunsQuerySchema = z.object({
  chain: swapChainCodeSchema.optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export const reconciliationIndexerStatusSchema = z.object({
  chain: swapChainCodeSchema,
  rpcConfigured: z.boolean(),
  watchedAddresses: z.number().int().nonnegative(),
  indexedTransfers: z.number().int().nonnegative(),
  lastIndexedBlock: z.number().int().nullable(),
  latestBlock: z.number().int().nullable(),
});

export const reconciliationIndexerStatusResponseSchema = z.object({
  data: z.array(reconciliationIndexerStatusSchema),
});

export type ReconciliationAddress = z.infer<typeof reconciliationAddressSchema>;
export type ReconciliationAddressesResponse = z.infer<typeof reconciliationAddressesResponseSchema>;
export type ReconciliationAddressCreate = z.infer<typeof reconciliationAddressCreateSchema>;
export type ReconciliationItem = z.infer<typeof reconciliationItemSchema>;
export type ReconciliationRun = z.infer<typeof reconciliationRunSchema>;
export type ReconciliationRunsResponse = z.infer<typeof reconciliationRunsResponseSchema>;
export type ReconciliationRunRequest = z.infer<typeof reconciliationRunRequestSchema>;
export type ReconciliationRunsQuery = z.infer<typeof reconciliationRunsQuerySchema>;
export type ReconciliationIndexerStatus = z.infer<typeof reconciliationIndexerStatusSchema>;
export type ReconciliationIndexerStatusResponse = z.infer<
  typeof reconciliationIndexerStatusResponseSchema
>;

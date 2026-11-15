import { z } from 'zod';

export const systemJobStateSchema = z.enum(['ok', 'stale', 'error', 'disabled', 'idle']);

export const systemStatusSchema = z.object({
  generatedAt: z.iso.datetime(),
  version: z.string(),
  nodeEnv: z.string(),
  uptimeSeconds: z.number().nonnegative(),
  database: z.object({
    ok: z.boolean(),
    latencyMs: z.number().nonnegative(),
  }),
  flags: z.object({
    marketQuotesEnabled: z.boolean(),
    botRunnerEnabled: z.boolean(),
    portfolioSnapshotsEnabled: z.boolean(),
    reconciliationEnabled: z.boolean(),
    swapEnabled: z.boolean(),
    swapExecutionEnabled: z.boolean(),
    swapKillSwitch: z.boolean(),
    rpcConfigured: z.object({
      bsc: z.boolean(),
      ethereum: z.boolean(),
    }),
  }),
  intervals: z.object({
    marketQuoteSeconds: z.number().int(),
    marketQuoteCoinGeckoSeconds: z.number().int(),
    botRunnerSeconds: z.number().int(),
    portfolioSnapshotSeconds: z.number().int(),
    reconciliationIndexSeconds: z.number().int(),
    swapTrackSeconds: z.number().int(),
  }),
  quotes: z.object({
    assets: z.number().int(),
    quoted: z.number().int(),
    missing: z.number().int(),
    stale15m: z.number().int(),
    lastFetchedAt: z.iso.datetime().nullable(),
    bySource: z.record(z.string(), z.number().int()),
  }),
  bots: z.object({
    running: z.number().int(),
    stale: z.number().int(),
    errors24h: z.number().int(),
    lastTickAt: z.iso.datetime().nullable(),
  }),
  swaps: z.object({
    active: z.number().int(),
    unaccounted: z.number().int(),
    stuck: z.number().int(),
    failed24h: z.number().int(),
    lastActivityAt: z.iso.datetime().nullable(),
  }),
  externalApis: z.array(
    z.object({
      provider: z.string(),
      calls24h: z.number().int(),
      errors24h: z.number().int(),
      errorRatePct: z.number(),
      p95LatencyMs: z.number().nullable(),
      lastCallAt: z.iso.datetime().nullable(),
      lastStatus: z.number().int().nullable(),
    }),
  ),
  snapshots: z.object({
    lastCapturedAt: z.iso.datetime().nullable(),
  }),
  reconciliation: z.object({
    lastRunAt: z.iso.datetime().nullable(),
    lastStatus: z.string().nullable(),
    lastError: z.string().nullable(),
    issues: z.number().int(),
  }),
  indexer: z.array(
    z.object({
      chain: z.string(),
      addresses: z.number().int(),
      lastIndexedAt: z.iso.datetime().nullable(),
      lastIndexedBlock: z.string().nullable(),
      transfers: z.number().int(),
    }),
  ),
  warnings: z.array(
    z.object({
      code: z.string(),
      severity: z.enum(['info', 'warning', 'error']),
      message: z.string(),
    }),
  ),
});

export type SystemStatus = z.infer<typeof systemStatusSchema>;
export type SystemJobState = z.infer<typeof systemJobStateSchema>;

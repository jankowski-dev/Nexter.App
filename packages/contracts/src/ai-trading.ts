import { z } from 'zod';
import { assetSchema } from './accounting';

export const aiTimeframes = ['1h', '1d', '4h', '15m', '5m'] as const;
export const aiTimeframeSchema = z.enum(aiTimeframes);
export const aiServiceKeys = ['data', 'analyst', 'backtest', 'risk', 'reporter'] as const;
export const aiServiceKeySchema = z.enum(aiServiceKeys);

const decimal = z
  .string()
  .trim()
  .min(1)
  .max(40)
  .regex(/^\d+(?:\.\d+)?$/, 'Expected a non-negative decimal');

const modelSettingsSchema = z.object({
  model: z.string().trim().min(1).max(100),
  temperature: z.number().min(0).max(2),
  maxTokens: z.number().int().min(256).max(8192),
  timeoutSeconds: z.number().int().min(10).max(180),
});

const scheduleSchema = z.object({
  weeklyReview: z.boolean(),
  weeklyDay: z.number().int().min(0).max(6),
  weeklyHour: z.number().int().min(0).max(23),
  events: z.boolean(),
});

export const aiProfileSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  enabled: z.boolean(),
  budgetUsd: z.string(),
  cashUsd: z.string(),
  reservedUsd: z.string(),
  maxWorkers: z.number().int(),
  maxWorkerAllocationPct: z.number().int(),
  maxTokenExposurePct: z.number().int(),
  maxInvestedPct: z.number().int(),
  riskPerTradePct: z.string(),
  dailyLossLimitPct: z.string(),
  maxDrawdownPct: z.string(),
  maxAiSpendUsd: z.string(),
  maxBacktestsPerDay: z.number().int(),
  workerMaxTokens: z.number().int(),
  modelSettings: modelSettingsSchema,
  schedule: scheduleSchema,
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export const aiProfileUpdateRequestSchema = z
  .object({
    name: z.string().trim().min(1).max(80).optional(),
    enabled: z.boolean().optional(),
    budgetUsd: decimal.optional(),
    cashUsd: decimal.optional(),
    reservedUsd: decimal.optional(),
    maxWorkers: z.number().int().min(1).max(50).optional(),
    maxWorkerAllocationPct: z.number().int().min(1).max(100).optional(),
    maxTokenExposurePct: z.number().int().min(1).max(100).optional(),
    maxInvestedPct: z.number().int().min(1).max(100).optional(),
    riskPerTradePct: decimal.optional(),
    dailyLossLimitPct: decimal.optional(),
    maxDrawdownPct: decimal.optional(),
    maxAiSpendUsd: decimal.optional(),
    maxBacktestsPerDay: z.number().int().min(1).max(1000).optional(),
    workerMaxTokens: z.number().int().min(1).max(5).optional(),
    modelSettings: modelSettingsSchema.optional(),
    schedule: scheduleSchema.optional(),
  })
  .refine((value) => Object.keys(value).length > 0, 'At least one field must be provided');

export const aiProfileTokenSchema = z.object({
  id: z.uuid(),
  asset: assetSchema,
  timeframes: z.array(aiTimeframeSchema),
  priority: z.number().int(),
  maxAllocationPct: z.string().nullable(),
  enabled: z.boolean(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export const aiProfileTokensResponseSchema = z.object({
  data: z.array(aiProfileTokenSchema),
});

export const aiProfileTokenCreateRequestSchema = z.object({
  assetId: z.uuid(),
  timeframes: z.array(aiTimeframeSchema).min(1).max(5).default(['1h', '1d']),
  priority: z.number().int().min(0).max(100).default(0),
  maxAllocationPct: decimal.nullable().optional(),
  enabled: z.boolean().default(true),
});

export const aiProfileTokenUpdateRequestSchema = z
  .object({
    timeframes: z.array(aiTimeframeSchema).min(1).max(5).optional(),
    priority: z.number().int().min(0).max(100).optional(),
    maxAllocationPct: decimal.nullable().optional(),
    enabled: z.boolean().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, 'At least one field must be provided');

export const aiServiceConfigSchema = z.object({
  service: aiServiceKeySchema,
  enabled: z.boolean(),
  config: z.record(z.string(), z.unknown()),
  concurrency: z.number().int().min(1).max(4),
  updatedAt: z.iso.datetime(),
});

export const aiServiceConfigsResponseSchema = z.object({
  data: z.array(aiServiceConfigSchema),
});

export const aiServiceConfigUpdateRequestSchema = z
  .object({
    enabled: z.boolean().optional(),
    config: z.record(z.string(), z.unknown()).optional(),
    concurrency: z.number().int().min(1).max(4).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, 'At least one field must be provided');

export const aiCoverageStatusSchema = z.enum(['ok', 'partial', 'stale', 'missing']);

export const aiCoverageTimeframeSchema = z.object({
  timeframe: aiTimeframeSchema,
  candles: z.number().int(),
  expected: z.number().int(),
  firstOpenTime: z.iso.datetime().nullable(),
  lastOpenTime: z.iso.datetime().nullable(),
  stale: z.boolean(),
  status: aiCoverageStatusSchema,
});

export const aiCoverageTokenSchema = z.object({
  assetId: z.uuid(),
  symbol: z.string(),
  name: z.string(),
  logoUrl: z.string().nullable(),
  timeframes: z.array(aiCoverageTimeframeSchema),
});

export const aiCoverageSchema = z.object({
  generatedAt: z.iso.datetime(),
  tokens: z.array(aiCoverageTokenSchema),
});

export const aiDataRefreshRequestSchema = z.object({
  assetId: z.uuid().optional(),
  timeframes: z.array(aiTimeframeSchema).min(1).max(5).optional(),
  days: z.number().int().min(7).max(365).default(90),
});

export const aiDataRefreshResponseSchema = z.object({
  pairs: z.number().int(),
  upserted: z.number().int(),
  failed: z.array(
    z.object({
      assetId: z.uuid(),
      symbol: z.string(),
      timeframe: aiTimeframeSchema,
      reason: z.string(),
    }),
  ),
});

export const aiLabRegimeSchema = z.enum([
  'trend_up',
  'trend_down',
  'range',
  'high_volatility',
  'unclear',
]);

export const aiLabFeaturesSchema = z.object({
  candles: z.number().int(),
  lastPriceUsd: z.string(),
  change24hPct: z.string().nullable(),
  return30Pct: z.string().nullable(),
  return90Pct: z.string().nullable(),
  volatilityPct: z.string(),
  maxDrawdownPct: z.string(),
  sma20Usd: z.string().nullable(),
  sma50Usd: z.string().nullable(),
  trend: z.enum(['up', 'down', 'flat']),
  volume24hUsd: z.string().nullable(),
  stale: z.boolean(),
});

export const aiLabStatsSchema = z.object({
  returnPct: z.string(),
  maxDrawdownPct: z.string(),
  profitFactor: z.string().nullable(),
  winRate: z.string().nullable(),
  trades: z.number().int(),
  buyHoldPct: z.string().nullable(),
});

export const aiLabCandidateMetricsSchema = z.object({
  train: aiLabStatsSchema.optional(),
  oos: aiLabStatsSchema.optional(),
  policyScore: z.number().optional(),
  backtestedAt: z.iso.datetime().optional(),
  reasons: z.array(z.string()).optional(),
});

export const aiLabCandidateSchema = z.object({
  id: z.uuid(),
  strategyKey: z.string(),
  strategyName: z.string(),
  params: z.record(z.string(), z.unknown()),
  aiScore: z.number().nullable(),
  aiConfidence: z.number().nullable(),
  rationale: z.string().nullable(),
  risks: z.array(z.string()),
  metrics: aiLabCandidateMetricsSchema,
  policyScore: z.number().nullable(),
  status: z.string(),
  createdAt: z.iso.datetime(),
});

export const aiLabAnalysisSchema = z.object({
  runId: z.uuid(),
  assetId: z.uuid(),
  symbol: z.string(),
  timeframe: aiTimeframeSchema,
  generatedAt: z.iso.datetime(),
  source: z.enum(['ai', 'fallback']),
  regime: aiLabRegimeSchema,
  confidence: z.number(),
  summary: z.string(),
  features: aiLabFeaturesSchema,
  warnings: z.array(z.string()),
  candidates: z.array(aiLabCandidateSchema),
});

export const aiLabLatestSchema = z.object({
  analysis: aiLabAnalysisSchema.nullable(),
});

export const aiLabAnalyzeRequestSchema = z.object({
  assetId: z.uuid(),
  timeframe: aiTimeframeSchema.default('1d'),
  lookbackDays: z.number().int().min(30).max(365).default(180),
});

export const aiLabQuerySchema = z.object({
  assetId: z.uuid(),
  timeframe: aiTimeframeSchema.default('1d'),
});

export const aiLabBacktestRequestSchema = z.object({
  candidateId: z.uuid(),
});

export const aiLabBacktestResponseSchema = z.object({
  candidateId: z.uuid(),
  strategyKey: z.string(),
  train: aiLabStatsSchema,
  oos: aiLabStatsSchema,
  policyScore: z.number(),
  status: z.string(),
  reasons: z.array(z.string()),
});

export const aiSearchTimeframes = ['1h', '4h'] as const;
export const aiSearchTimeframeSchema = z.enum(aiSearchTimeframes);

export const aiSearchRequestSchema = z.object({
  assetId: z.uuid(),
  timeframe: aiSearchTimeframeSchema.default('1h'),
  horizonDays: z.union([z.literal(1), z.literal(3), z.literal(5), z.literal(10)]).default(5),
  variants: z.number().int().min(100).max(5000).default(5000),
  seed: z.number().int().min(0).max(2_147_483_647).optional(),
});

export const aiSearchStartResponseSchema = z.object({ runId: z.uuid() });

export const aiSearchStatsSchema = z.object({
  total: z.number().int(),
  evaluated: z.number().int(),
  valid: z.number().int(),
  recommended: z.number().int(),
  bestReturnPct: z.string(),
  averageReturnPct: z.string(),
  medianReturnPct: z.string(),
  worstReturnPct: z.string(),
  profitablePct: z.string(),
  averageDrawdownPct: z.string(),
  bestOosReturnPct: z.string(),
  medianOosReturnPct: z.string(),
  worstOosReturnPct: z.string(),
  stabilityPct: z.string(),
  holdoutReturnPct: z.string().nullable(),
});

export const aiSearchCandidateSchema = z.object({
  id: z.uuid(),
  strategyKey: z.string(),
  strategyName: z.string(),
  params: z.record(z.string(), z.unknown()),
  oosMedianReturnPct: z.string(),
  oosMeanReturnPct: z.string(),
  oosWorstReturnPct: z.string(),
  maxDrawdownPct: z.string(),
  trades: z.number().int(),
  positiveFolds: z.number().int(),
  stabilityPct: z.string(),
  holdoutReturnPct: z.string().nullable(),
  policyScore: z.string(),
});

export const aiSearchStatusSchema = z.object({
  runId: z.uuid(),
  status: z.enum(['queued', 'running', 'succeeded', 'failed', 'cancelled']),
  evaluated: z.number().int(),
  total: z.number().int(),
  percent: z.number(),
  stats: aiSearchStatsSchema.nullable(),
  error: z.string().nullable(),
  startedAt: z.iso.datetime().nullable(),
  finishedAt: z.iso.datetime().nullable(),
});

export const aiSearchResultsSchema = z.object({
  runId: z.uuid(),
  status: z.enum(['queued', 'running', 'succeeded', 'failed', 'cancelled']),
  stats: aiSearchStatsSchema,
  candidates: z.array(aiSearchCandidateSchema),
  rejectionReasons: z.record(z.string(), z.number().int()),
});

export const aiTradingDashboardSchema = z.object({
  profile: aiProfileSchema,
  tokensCount: z.number().int(),
  workersCount: z.number().int(),
  activeWorkers: z.number().int(),
  queueCount: z.number().int(),
  lastRunAt: z.iso.datetime().nullable(),
  lastRunStatus: z.string().nullable(),
});

export type AiTimeframe = z.infer<typeof aiTimeframeSchema>;
export type AiServiceKey = z.infer<typeof aiServiceKeySchema>;
export type AiModelSettings = z.infer<typeof modelSettingsSchema>;
export type AiSchedule = z.infer<typeof scheduleSchema>;
export type AiProfile = z.infer<typeof aiProfileSchema>;
export type AiProfileUpdateRequest = z.infer<typeof aiProfileUpdateRequestSchema>;
export type AiProfileToken = z.infer<typeof aiProfileTokenSchema>;
export type AiProfileTokensResponse = z.infer<typeof aiProfileTokensResponseSchema>;
export type AiProfileTokenCreateRequest = z.infer<typeof aiProfileTokenCreateRequestSchema>;
export type AiProfileTokenUpdateRequest = z.infer<typeof aiProfileTokenUpdateRequestSchema>;
export type AiServiceConfig = z.infer<typeof aiServiceConfigSchema>;
export type AiServiceConfigsResponse = z.infer<typeof aiServiceConfigsResponseSchema>;
export type AiServiceConfigUpdateRequest = z.infer<typeof aiServiceConfigUpdateRequestSchema>;
export type AiCoverageStatus = z.infer<typeof aiCoverageStatusSchema>;
export type AiCoverageTimeframe = z.infer<typeof aiCoverageTimeframeSchema>;
export type AiCoverageToken = z.infer<typeof aiCoverageTokenSchema>;
export type AiCoverage = z.infer<typeof aiCoverageSchema>;
export type AiDataRefreshRequest = z.infer<typeof aiDataRefreshRequestSchema>;
export type AiDataRefreshResponse = z.infer<typeof aiDataRefreshResponseSchema>;
export type AiLabRegime = z.infer<typeof aiLabRegimeSchema>;
export type AiLabFeatures = z.infer<typeof aiLabFeaturesSchema>;
export type AiLabStats = z.infer<typeof aiLabStatsSchema>;
export type AiLabCandidateMetrics = z.infer<typeof aiLabCandidateMetricsSchema>;
export type AiLabCandidate = z.infer<typeof aiLabCandidateSchema>;
export type AiLabAnalysis = z.infer<typeof aiLabAnalysisSchema>;
export type AiLabLatest = z.infer<typeof aiLabLatestSchema>;
export type AiLabAnalyzeRequest = z.infer<typeof aiLabAnalyzeRequestSchema>;
export type AiLabQuery = z.infer<typeof aiLabQuerySchema>;
export type AiLabBacktestRequest = z.infer<typeof aiLabBacktestRequestSchema>;
export type AiLabBacktestResponse = z.infer<typeof aiLabBacktestResponseSchema>;
export type AiSearchTimeframe = z.infer<typeof aiSearchTimeframeSchema>;
export type AiSearchRequest = z.infer<typeof aiSearchRequestSchema>;
export type AiSearchStartResponse = z.infer<typeof aiSearchStartResponseSchema>;
export type AiSearchStats = z.infer<typeof aiSearchStatsSchema>;
export type AiSearchCandidate = z.infer<typeof aiSearchCandidateSchema>;
export type AiSearchStatus = z.infer<typeof aiSearchStatusSchema>;
export type AiSearchResults = z.infer<typeof aiSearchResultsSchema>;

export type AiTradingDashboard = z.infer<typeof aiTradingDashboardSchema>;

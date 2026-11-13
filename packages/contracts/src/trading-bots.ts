import { z } from 'zod';
import { assetSchema, positiveDecimalSchema } from './accounting';

export const botStrategyKeys = [
  'momentum_breakout',
  'mean_reversion',
  'grid_range',
  'trend_pullback',
  'dca_dip',
] as const;

export const botStrategyKeySchema = z.enum(botStrategyKeys);
export const botStatusSchema = z.enum(['draft', 'running', 'stopped']);
export const botStrategyKindSchema = z.enum(['system', 'custom']);
export const botTradeSideSchema = z.enum(['buy', 'sell']);

const paramsSchema = z.record(z.string(), z.unknown());

export const botStrategyParamFieldSchema = z.object({
  key: z.string(),
  label: z.string(),
  hint: z.string().optional(),
  min: z.number().optional(),
  max: z.number().optional(),
  step: z.number().optional(),
  unit: z.string().optional(),
  integer: z.boolean().optional(),
});

export const botStrategyTemplateSchema = z.object({
  key: botStrategyKeySchema,
  name: z.string(),
  description: z.string(),
  guide: z.string(),
  icon: z.string(),
  kind: botStrategyKindSchema,
  defaultParams: paramsSchema,
  paramFields: z.array(botStrategyParamFieldSchema),
});

export const botStatsSchema = z.object({
  budgetUsd: z.string(),
  cashUsd: z.string(),
  positionsValueUsd: z.string(),
  equityUsd: z.string(),
  realizedPnlUsd: z.string(),
  unrealizedPnlUsd: z.string(),
  totalPnlUsd: z.string(),
  grossProfitUsd: z.string(),
  grossLossUsd: z.string(),
  profitFactor: z.string().nullable(),
  winRate: z.string().nullable(),
  tradesCount: z.number().int().nonnegative(),
  wins: z.number().int().nonnegative(),
  losses: z.number().int().nonnegative(),
  openPositions: z.number().int().nonnegative(),
  maxDrawdownPct: z.string().nullable(),
});

export const botSummarySchema = z.object({
  id: z.uuid(),
  name: z.string(),
  description: z.string(),
  status: botStatusSchema,
  strategy: z.object({
    key: botStrategyKeySchema,
    name: z.string(),
    icon: z.string(),
    kind: botStrategyKindSchema,
  }),
  budgetUsd: z.string(),
  cashUsd: z.string(),
  maxPositions: z.number().int(),
  positionSizePct: z.number(),
  feeBps: z.number().int(),
  slippageBps: z.number().int(),
  maxDailyLossPct: z.number(),
  cooldownMinutes: z.number().int(),
  startedAt: z.iso.datetime().nullable(),
  stoppedAt: z.iso.datetime().nullable(),
  lastTickAt: z.iso.datetime().nullable(),
  archivedAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  stats: botStatsSchema,
});

export const botTokenSchema = z.object({
  assetId: z.uuid(),
  symbol: z.string(),
  name: z.string(),
  chainCode: z.string(),
  logoUrl: z.string().nullable(),
  enabled: z.boolean(),
});

export const botPositionSchema = z.object({
  asset: assetSchema,
  amount: z.string(),
  avgCostUsd: z.string(),
  costBasisUsd: z.string(),
  currentPriceUsd: z.string().nullable(),
  valueUsd: z.string().nullable(),
  unrealizedPnlUsd: z.string().nullable(),
  openedAt: z.iso.datetime(),
});

export const botTradeSchema = z.object({
  id: z.uuid(),
  asset: assetSchema,
  side: botTradeSideSchema,
  amount: z.string(),
  priceUsd: z.string(),
  usdValue: z.string(),
  feeUsd: z.string(),
  slippageUsd: z.string(),
  realizedPnlUsd: z.string(),
  reason: z.string(),
  executedAt: z.iso.datetime(),
});

export const botEventSchema = z.object({
  id: z.uuid(),
  type: z.string(),
  message: z.string(),
  payload: z.record(z.string(), z.unknown()),
  createdAt: z.iso.datetime(),
});

export const botEquityPointSchema = z.object({
  capturedAt: z.iso.datetime(),
  cashUsd: z.string(),
  positionsValueUsd: z.string(),
  equityUsd: z.string(),
  realizedPnlUsd: z.string(),
  unrealizedPnlUsd: z.string(),
});

export const tradingBotsResponseSchema = z.object({
  data: z.array(botSummarySchema),
});

export const botDetailResponseSchema = z.object({
  bot: botSummarySchema,
  strategy: botStrategyTemplateSchema,
  strategyParams: paramsSchema,
  tokens: z.array(botTokenSchema),
  positions: z.array(botPositionSchema),
});

export const botCreateRequestSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    description: z.string().max(2000).optional(),
    strategyKey: botStrategyKeySchema,
    strategyParams: paramsSchema.optional(),
    tokenAssetIds: z.array(z.uuid()).min(1).max(50),
    budgetUsd: positiveDecimalSchema,
    maxPositions: z.number().int().min(1).max(20).default(5),
    positionSizePct: z.number().min(1).max(100).default(20),
    feeBps: z.number().int().min(0).max(500).default(25),
    slippageBps: z.number().int().min(0).max(500).default(10),
    maxDailyLossPct: z.number().min(0).max(100).default(10),
    cooldownMinutes: z.number().int().min(0).max(1440).default(15),
  })
  .refine((value) => Number(value.budgetUsd) >= 100, {
    message: 'Budget must be at least 100 USD',
    path: ['budgetUsd'],
  })
  .refine((value) => new Set(value.tokenAssetIds).size === value.tokenAssetIds.length, {
    message: 'Token list must not contain duplicates',
    path: ['tokenAssetIds'],
  });

export const botUpdateRequestSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    description: z.string().max(2000).optional(),
    strategyKey: botStrategyKeySchema.optional(),
    strategyParams: paramsSchema.optional(),
    tokenAssetIds: z.array(z.uuid()).min(1).max(50).optional(),
    maxPositions: z.number().int().min(1).max(20).optional(),
    positionSizePct: z.number().min(1).max(100).optional(),
    feeBps: z.number().int().min(0).max(500).optional(),
    slippageBps: z.number().int().min(0).max(500).optional(),
    maxDailyLossPct: z.number().min(0).max(100).optional(),
    cooldownMinutes: z.number().int().min(0).max(1440).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, 'At least one field must be provided')
  .refine(
    (value) =>
      value.tokenAssetIds === undefined ||
      new Set(value.tokenAssetIds).size === value.tokenAssetIds.length,
    { message: 'Token list must not contain duplicates', path: ['tokenAssetIds'] },
  );

export const botTradesResponseSchema = z.object({
  data: z.array(botTradeSchema),
});

export const botEventsResponseSchema = z.object({
  data: z.array(botEventSchema),
});

export const botEquityResponseSchema = z.object({
  data: z.array(botEquityPointSchema),
});

export const botSignalActionSchema = z.enum(['buy', 'sell', 'hold']);

export const botSignalSchema = z.object({
  assetId: z.uuid(),
  symbol: z.string(),
  name: z.string(),
  chainCode: z.string(),
  logoUrl: z.string().nullable(),
  priceUsd: z.string().nullable(),
  change24hPct: z.string().nullable(),
  action: botSignalActionSchema,
  reason: z.string(),
  hasPosition: z.boolean(),
  updatedAt: z.iso.datetime().nullable(),
});

export const botSignalsResponseSchema = z.object({
  data: z.array(botSignalSchema),
});

export const botCandleSchema = z.object({
  date: z.string(),
  openUsd: z.string(),
  highUsd: z.string(),
  lowUsd: z.string(),
  closeUsd: z.string(),
  volumeUsd: z.string().nullable(),
});

export const botBacktestTradeSchema = z.object({
  index: z.number().int().nonnegative(),
  side: botTradeSideSchema,
  date: z.string(),
  priceUsd: z.string(),
  amount: z.string(),
  usdValue: z.string(),
  feeUsd: z.string(),
  slippageUsd: z.string(),
  realizedPnlUsd: z.string(),
  reason: z.string(),
  equityUsd: z.string(),
});

export const botBacktestEquityPointSchema = z.object({
  date: z.string(),
  equityUsd: z.string(),
});

export const botBacktestStatsSchema = z.object({
  initialCapitalUsd: z.string(),
  finalEquityUsd: z.string(),
  totalPnlUsd: z.string(),
  totalReturnPct: z.string(),
  grossProfitUsd: z.string(),
  grossLossUsd: z.string(),
  profitFactor: z.string().nullable(),
  winRate: z.string().nullable(),
  tradesCount: z.number().int().nonnegative(),
  wins: z.number().int().nonnegative(),
  losses: z.number().int().nonnegative(),
  maxDrawdownPct: z.string(),
  buyHoldReturnPct: z.string().nullable(),
});

export const botBacktestAssetSchema = z.object({
  id: z.uuid(),
  symbol: z.string(),
  name: z.string(),
  chainCode: z.string(),
  logoUrl: z.string().nullable(),
});

export const botBacktestRunSummarySchema = z.object({
  id: z.uuid(),
  strategyKey: botStrategyKeySchema,
  strategyName: z.string(),
  asset: botBacktestAssetSchema,
  days: z.number().int(),
  source: z.string(),
  stats: botBacktestStatsSchema,
  createdAt: z.iso.datetime(),
});

export const botBacktestRunSchema = botBacktestRunSummarySchema.extend({
  strategyParams: paramsSchema,
  candles: z.array(botCandleSchema),
  trades: z.array(botBacktestTradeSchema),
  equityCurve: z.array(botBacktestEquityPointSchema),
});

export const botBacktestPreviewRequestSchema = z.object({
  assetId: z.uuid(),
  days: z.coerce.number().int().min(30).max(730).default(365),
});

export const botBacktestPreviewResponseSchema = z.object({
  asset: botBacktestAssetSchema,
  days: z.number().int(),
  source: z.string(),
  candles: z.array(botCandleSchema),
});

export const botBacktestRequestSchema = botBacktestPreviewRequestSchema.extend({
  strategyKey: botStrategyKeySchema,
  strategyParams: paramsSchema.optional(),
});

export const botBacktestListQuerySchema = z.object({
  strategyKey: botStrategyKeySchema.optional(),
  assetId: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export const botBacktestsResponseSchema = z.object({
  data: z.array(botBacktestRunSummarySchema),
});

export const botStrategiesResponseSchema = z.object({
  data: z.array(botStrategyTemplateSchema),
});

export const botListQuerySchema = z.object({
  includeArchived: z
    .union([z.boolean(), z.enum(['true', 'false'])])
    .transform((value) => value === true || value === 'true')
    .default(false),
});

export const botHistoryQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(500).default(100),
});

export type BotStrategyKey = z.infer<typeof botStrategyKeySchema>;
export type BotStatus = z.infer<typeof botStatusSchema>;
export type BotStrategyTemplate = z.infer<typeof botStrategyTemplateSchema>;
export type BotStats = z.infer<typeof botStatsSchema>;
export type BotSummary = z.infer<typeof botSummarySchema>;
export type BotToken = z.infer<typeof botTokenSchema>;
export type BotPosition = z.infer<typeof botPositionSchema>;
export type BotTrade = z.infer<typeof botTradeSchema>;
export type BotEvent = z.infer<typeof botEventSchema>;
export type BotEquityPoint = z.infer<typeof botEquityPointSchema>;
export type BotSignalAction = z.infer<typeof botSignalActionSchema>;
export type BotSignal = z.infer<typeof botSignalSchema>;
export type BotSignalsResponse = z.infer<typeof botSignalsResponseSchema>;
export type BotCandle = z.infer<typeof botCandleSchema>;
export type BotBacktestTrade = z.infer<typeof botBacktestTradeSchema>;
export type BotBacktestEquityPoint = z.infer<typeof botBacktestEquityPointSchema>;
export type BotBacktestStats = z.infer<typeof botBacktestStatsSchema>;
export type BotBacktestAsset = z.infer<typeof botBacktestAssetSchema>;
export type BotBacktestRunSummary = z.infer<typeof botBacktestRunSummarySchema>;
export type BotBacktestRun = z.infer<typeof botBacktestRunSchema>;
export type BotBacktestPreviewRequest = z.infer<typeof botBacktestPreviewRequestSchema>;
export type BotBacktestPreviewResponse = z.infer<typeof botBacktestPreviewResponseSchema>;
export type BotBacktestRequest = z.infer<typeof botBacktestRequestSchema>;
export type BotBacktestListQuery = z.infer<typeof botBacktestListQuerySchema>;
export type BotBacktestsResponse = z.infer<typeof botBacktestsResponseSchema>;
export type BotStrategyParamField = z.infer<typeof botStrategyParamFieldSchema>;
export type BotDetailResponse = z.infer<typeof botDetailResponseSchema>;
export type TradingBotsResponse = z.infer<typeof tradingBotsResponseSchema>;
export type BotCreateRequest = z.infer<typeof botCreateRequestSchema>;
export type BotUpdateRequest = z.infer<typeof botUpdateRequestSchema>;
export type BotTradesResponse = z.infer<typeof botTradesResponseSchema>;
export type BotEventsResponse = z.infer<typeof botEventsResponseSchema>;
export type BotEquityResponse = z.infer<typeof botEquityResponseSchema>;
export type BotStrategiesResponse = z.infer<typeof botStrategiesResponseSchema>;
export type BotListQuery = z.infer<typeof botListQuerySchema>;
export type BotHistoryQuery = z.infer<typeof botHistoryQuerySchema>;

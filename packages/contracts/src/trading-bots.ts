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
export const botTradeSideSchema = z.enum(['buy', 'sell']);

const paramsSchema = z.record(z.string(), z.unknown());

export const botStrategyTemplateSchema = z.object({
  key: botStrategyKeySchema,
  name: z.string(),
  description: z.string(),
  icon: z.string(),
  defaultParams: paramsSchema,
});

export const botStrategySchema = z.object({
  id: z.uuid(),
  key: botStrategyKeySchema,
  name: z.string(),
  description: z.string(),
  icon: z.string(),
  version: z.number().int().positive(),
  params: paramsSchema,
  archivedAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export const botStrategyCreateRequestSchema = z.object({
  key: botStrategyKeySchema,
  name: z.string().trim().min(1).max(120),
  description: z.string().max(2000).optional(),
  params: paramsSchema.optional(),
});

export const botStrategyUpdateRequestSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    description: z.string().max(2000).optional(),
    params: paramsSchema.optional(),
    archived: z.boolean().optional(),
  })
  .refine(
    (value) =>
      value.name !== undefined ||
      value.description !== undefined ||
      value.params !== undefined ||
      value.archived !== undefined,
    'At least one field must be provided',
  );

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
    id: z.uuid(),
    key: botStrategyKeySchema,
    name: z.string(),
    icon: z.string(),
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
  strategy: botStrategySchema,
  tokens: z.array(botTokenSchema),
  positions: z.array(botPositionSchema),
});

export const botCreateRequestSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    description: z.string().max(2000).optional(),
    strategyId: z.uuid(),
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
    strategyId: z.uuid().optional(),
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

export const botStrategiesResponseSchema = z.object({
  templates: z.array(botStrategyTemplateSchema),
  data: z.array(botStrategySchema),
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
export type BotStrategy = z.infer<typeof botStrategySchema>;
export type BotStrategyCreateRequest = z.infer<typeof botStrategyCreateRequestSchema>;
export type BotStrategyUpdateRequest = z.infer<typeof botStrategyUpdateRequestSchema>;
export type BotStats = z.infer<typeof botStatsSchema>;
export type BotSummary = z.infer<typeof botSummarySchema>;
export type BotToken = z.infer<typeof botTokenSchema>;
export type BotPosition = z.infer<typeof botPositionSchema>;
export type BotTrade = z.infer<typeof botTradeSchema>;
export type BotEvent = z.infer<typeof botEventSchema>;
export type BotEquityPoint = z.infer<typeof botEquityPointSchema>;
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

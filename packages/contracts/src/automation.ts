import { z } from 'zod';
import { assetSchema } from './accounting';

const decimal = z
  .string()
  .trim()
  .min(1)
  .max(40)
  .regex(/^\d+(?:\.\d+)?$/, 'Expected a non-negative decimal');

export const automationRuleKindSchema = z.enum([
  'buy',
  'stop_loss',
  'take_profit',
  'trailing_stop',
]);
export const automationRuleStatusSchema = z.enum(['draft', 'armed', 'paused', 'done']);
export const automationExecutionModeSchema = z.enum(['dry_run', 'proposal']);
export const automationRunStatusSchema = z.enum(['would_execute', 'proposed', 'skipped', 'failed']);

export const automationBuyParamsSchema = z
  .object({
    target: z.enum(['price_below', 'drop_from_high']),
    thresholdUsd: decimal.optional(),
    dropPct: z.number().min(0.1).max(90).optional(),
    amountUsd: decimal,
    maxPriceUsd: decimal.optional(),
  })
  .superRefine((value, context) => {
    if (value.target === 'price_below' && !value.thresholdUsd) {
      context.addIssue({
        code: 'custom',
        path: ['thresholdUsd'],
        message: 'thresholdUsd is required for price_below',
      });
    }
    if (value.target === 'drop_from_high' && value.dropPct === undefined) {
      context.addIssue({
        code: 'custom',
        path: ['dropPct'],
        message: 'dropPct is required for drop_from_high',
      });
    }
  });

export const automationStopLossParamsSchema = z.object({
  stopLossPct: z.number().min(1).max(90),
});

export const automationTakeProfitParamsSchema = z.object({
  takeProfitPct: z.number().min(1).max(1000),
  partialPct: z.number().min(1).max(100).optional(),
});

export const automationTrailingStopParamsSchema = z.object({
  trailPct: z.number().min(1).max(90),
  activationPct: z.number().min(1).max(1000).optional(),
});

const ruleBase = z.object({
  name: z.string().trim().min(1).max(120),
  assetId: z.uuid(),
  tradeGroupId: z.uuid().nullable().optional(),
  executionMode: automationExecutionModeSchema.default('dry_run'),
  maxOrderUsd: decimal.nullable().optional(),
  cooldownMinutes: z.number().int().min(5).max(1440).default(60),
});

export const automationRuleCreateRequestSchema = z.discriminatedUnion('kind', [
  ruleBase.extend({
    kind: z.literal('buy'),
    params: automationBuyParamsSchema,
    tradeGroupId: z.null().optional(),
  }),
  ruleBase.extend({
    kind: z.literal('stop_loss'),
    params: automationStopLossParamsSchema,
    tradeGroupId: z.uuid(),
  }),
  ruleBase.extend({
    kind: z.literal('take_profit'),
    params: automationTakeProfitParamsSchema,
    tradeGroupId: z.uuid(),
  }),
  ruleBase.extend({
    kind: z.literal('trailing_stop'),
    params: automationTrailingStopParamsSchema,
    tradeGroupId: z.uuid(),
  }),
]);

export const automationRuleUpdateRequestSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    status: automationRuleStatusSchema.optional(),
    executionMode: automationExecutionModeSchema.optional(),
    params: z.record(z.string(), z.unknown()).optional(),
    maxOrderUsd: decimal.nullable().optional(),
    cooldownMinutes: z.number().int().min(5).max(1440).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, 'At least one field must be provided');

export const automationRuleSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  kind: automationRuleKindSchema,
  asset: assetSchema,
  tradeGroupId: z.uuid().nullable(),
  status: automationRuleStatusSchema,
  executionMode: automationExecutionModeSchema,
  params: z.record(z.string(), z.unknown()),
  maxOrderUsd: z.string().nullable(),
  cooldownMinutes: z.number().int(),
  lastTriggeredAt: z.iso.datetime().nullable(),
  triggerCount: z.number().int(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export const automationRulesResponseSchema = z.object({
  rules: z.array(automationRuleSchema),
});

export const automationRunSchema = z.object({
  id: z.uuid(),
  ruleId: z.uuid(),
  ruleName: z.string(),
  status: automationRunStatusSchema,
  triggerKey: z.string(),
  reason: z.string(),
  triggerPriceUsd: z.string().nullable(),
  amount: z.string().nullable(),
  usdValue: z.string().nullable(),
  tradeGroupId: z.uuid().nullable(),
  createdAt: z.iso.datetime(),
});

export const automationRunsResponseSchema = z.object({
  runs: z.array(automationRunSchema),
});

export const automationTestResponseSchema = z.object({
  status: automationRunStatusSchema,
  reason: z.string(),
  triggerPriceUsd: z.string().nullable(),
  amount: z.string().nullable(),
  usdValue: z.string().nullable(),
});

export type AutomationRuleKind = z.infer<typeof automationRuleKindSchema>;
export type AutomationRuleStatus = z.infer<typeof automationRuleStatusSchema>;
export type AutomationExecutionMode = z.infer<typeof automationExecutionModeSchema>;
export type AutomationRunStatus = z.infer<typeof automationRunStatusSchema>;
export type AutomationBuyParams = z.infer<typeof automationBuyParamsSchema>;
export type AutomationStopLossParams = z.infer<typeof automationStopLossParamsSchema>;
export type AutomationTakeProfitParams = z.infer<typeof automationTakeProfitParamsSchema>;
export type AutomationTrailingStopParams = z.infer<typeof automationTrailingStopParamsSchema>;
export type AutomationRule = z.infer<typeof automationRuleSchema>;
export type AutomationRuleCreateRequest = z.infer<typeof automationRuleCreateRequestSchema>;
export type AutomationRuleUpdateRequest = z.infer<typeof automationRuleUpdateRequestSchema>;
export type AutomationRulesResponse = z.infer<typeof automationRulesResponseSchema>;
export type AutomationRun = z.infer<typeof automationRunSchema>;
export type AutomationRunsResponse = z.infer<typeof automationRunsResponseSchema>;
export type AutomationTestResponse = z.infer<typeof automationTestResponseSchema>;

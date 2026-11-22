import { z } from 'zod';

export const aiProviderSchema = z.enum(['deepseek']);
export const aiReasoningSchema = z.enum(['fast', 'reasoning']);

export const aiModelOptions = [
  'deepseek-flash',
  'deepseek-v4-pro',
  'deepseek-chat',
  'deepseek-reasoner',
] as const;
export const aiModelSchema = z.string().trim().min(1).max(100);

export const AI_CYCLE_LIMIT_MIN = 1;
export const AI_CYCLE_LIMIT_MAX = 200;

export const aiCycleLimitDefaults = {
  perDay: 20,
  unlimited: false,
} as const;

export const aiCycleLimitSchema = z.object({
  perDay: z.number().int().min(AI_CYCLE_LIMIT_MIN).max(AI_CYCLE_LIMIT_MAX),
  unlimited: z.boolean(),
});

/** Reads the cycle limit stored inside ai_profiles.model_settings; invalid data falls back to defaults. */
export function readAiCycleLimit(modelSettings: unknown): AiCycleLimit {
  if (!modelSettings || typeof modelSettings !== 'object' || Array.isArray(modelSettings)) {
    return { ...aiCycleLimitDefaults };
  }
  const parsed = aiCycleLimitSchema.safeParse(
    (modelSettings as Record<string, unknown>).cycleLimit,
  );
  return parsed.success ? parsed.data : { ...aiCycleLimitDefaults };
}

/** Stores the cycle limit inside ai_profiles.model_settings without dropping other model settings. */
export function withAiCycleLimit(
  modelSettings: unknown,
  cycleLimit: AiCycleLimit,
): Record<string, unknown> {
  const base =
    modelSettings && typeof modelSettings === 'object' && !Array.isArray(modelSettings)
      ? { ...(modelSettings as Record<string, unknown>) }
      : {};
  return { ...base, cycleLimit: { perDay: cycleLimit.perDay, unlimited: cycleLimit.unlimited } };
}

export const aiSettingsSchema = z.object({
  enabled: z.boolean(),
  provider: aiProviderSchema,
  model: aiModelSchema,
  reasoning: aiReasoningSchema,
  temperature: z.number().min(0).max(2),
  maxTokens: z.number().int().min(256).max(8192),
  fallbackToRaw: z.boolean(),
  cycleLimit: aiCycleLimitSchema,
  hasApiKey: z.boolean(),
  updatedAt: z.iso.datetime(),
});

export const updateAiSettingsRequestSchema = z
  .object({
    enabled: z.boolean().optional(),
    provider: aiProviderSchema.optional(),
    model: aiModelSchema.optional(),
    reasoning: aiReasoningSchema.optional(),
    temperature: z.number().min(0).max(2).optional(),
    maxTokens: z.number().int().min(256).max(8192).optional(),
    fallbackToRaw: z.boolean().optional(),
    cycleLimit: aiCycleLimitSchema.optional(),
    apiKey: z.string().trim().min(1).max(500).optional(),
    clearApiKey: z.boolean().optional(),
  })
  .refine(
    (value) =>
      value.enabled !== undefined ||
      value.provider !== undefined ||
      value.model !== undefined ||
      value.reasoning !== undefined ||
      value.temperature !== undefined ||
      value.maxTokens !== undefined ||
      value.fallbackToRaw !== undefined ||
      value.cycleLimit !== undefined ||
      value.apiKey !== undefined ||
      value.clearApiKey !== undefined,
    'At least one field must be provided',
  );

export const aiTestResponseSchema = z.object({
  ok: z.boolean(),
  latencyMs: z.number().int().nonnegative(),
  model: z.string(),
  response: z.string().nullable(),
  error: z.string().nullable(),
});

export type AiProvider = z.infer<typeof aiProviderSchema>;
export type AiReasoning = z.infer<typeof aiReasoningSchema>;
export type AiCycleLimit = z.infer<typeof aiCycleLimitSchema>;
export type AiSettings = z.infer<typeof aiSettingsSchema>;
export type UpdateAiSettingsRequest = z.infer<typeof updateAiSettingsRequestSchema>;
export type AiTestResponse = z.infer<typeof aiTestResponseSchema>;

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

export const aiSettingsSchema = z.object({
  enabled: z.boolean(),
  provider: aiProviderSchema,
  model: aiModelSchema,
  reasoning: aiReasoningSchema,
  temperature: z.number().min(0).max(2),
  maxTokens: z.number().int().min(256).max(8192),
  fallbackToRaw: z.boolean(),
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
export type AiSettings = z.infer<typeof aiSettingsSchema>;
export type UpdateAiSettingsRequest = z.infer<typeof updateAiSettingsRequestSchema>;
export type AiTestResponse = z.infer<typeof aiTestResponseSchema>;

import { z } from 'zod';
import { AUDIO_MAX_MB_MAX, AUDIO_MAX_MB_MIN } from './audio-notes';

export const audioMaxMbSchema = z.number().int().min(AUDIO_MAX_MB_MIN).max(AUDIO_MAX_MB_MAX);

export const settingsSchema = z.object({
  baseCurrency: z.string(),
  displayCurrency: z.string(),
  taxMethod: z.string(),
  includeGasInCostBasis: z.boolean(),
  timezone: z.string(),
  audioMaxMb: audioMaxMbSchema,
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export const updateSettingsRequestSchema = z
  .object({
    includeGasInCostBasis: z.boolean().optional(),
    timezone: z.string().min(1).max(100).optional(),
    audioMaxMb: audioMaxMbSchema.optional(),
  })
  .refine(
    (value) =>
      value.includeGasInCostBasis !== undefined ||
      value.timezone !== undefined ||
      value.audioMaxMb !== undefined,
    'At least one setting must be provided',
  );

export type Settings = z.infer<typeof settingsSchema>;
export type UpdateSettingsRequest = z.infer<typeof updateSettingsRequestSchema>;

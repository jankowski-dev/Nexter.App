import { z } from 'zod';

export const settingsSchema = z.object({
  baseCurrency: z.string(),
  displayCurrency: z.string(),
  taxMethod: z.string(),
  includeGasInCostBasis: z.boolean(),
  timezone: z.string(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export const updateSettingsRequestSchema = z
  .object({
    includeGasInCostBasis: z.boolean().optional(),
    timezone: z.string().min(1).max(100).optional(),
  })
  .refine(
    (value) => value.includeGasInCostBasis !== undefined || value.timezone !== undefined,
    'At least one setting must be provided',
  );

export type Settings = z.infer<typeof settingsSchema>;
export type UpdateSettingsRequest = z.infer<typeof updateSettingsRequestSchema>;

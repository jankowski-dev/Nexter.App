import { z } from 'zod';
import { assetSchema } from './accounting';

const decimal = z
  .string()
  .trim()
  .min(1)
  .max(40)
  .regex(/^\d+(?:\.\d+)?$/, 'Expected a non-negative decimal');

const positiveDecimal = decimal.refine((value) => Number(value) > 0, 'Expected a positive decimal');

export const pendingOrderStatusSchema = z.enum(['pending', 'proposed', 'cancelled', 'done']);

export const pendingOrderSchema = z.object({
  id: z.uuid(),
  asset: assetSchema,
  amountUsd: z.string(),
  triggerPriceUsd: z.string(),
  stopLossPct: z.string().nullable(),
  takeProfitPct: z.string().nullable(),
  status: pendingOrderStatusSchema,
  lastNotifiedAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export const pendingOrdersResponseSchema = z.object({
  data: z.array(pendingOrderSchema),
});

export const pendingOrderCreateRequestSchema = z.object({
  assetId: z.uuid(),
  amountUsd: positiveDecimal,
  triggerPriceUsd: positiveDecimal,
  stopLossPct: z.number().min(1).max(90).nullable().optional(),
  takeProfitPct: z.number().min(1).max(1000).nullable().optional(),
});

export const pendingOrderUpdateRequestSchema = z
  .object({
    amountUsd: positiveDecimal.optional(),
    triggerPriceUsd: positiveDecimal.optional(),
    stopLossPct: z.number().min(1).max(90).nullable().optional(),
    takeProfitPct: z.number().min(1).max(1000).nullable().optional(),
    status: z.enum(['pending', 'cancelled']).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, 'At least one field must be provided');

export type PendingOrderStatus = z.infer<typeof pendingOrderStatusSchema>;
export type PendingOrder = z.infer<typeof pendingOrderSchema>;
export type PendingOrdersResponse = z.infer<typeof pendingOrdersResponseSchema>;
export type PendingOrderCreateRequest = z.infer<typeof pendingOrderCreateRequestSchema>;
export type PendingOrderUpdateRequest = z.infer<typeof pendingOrderUpdateRequestSchema>;

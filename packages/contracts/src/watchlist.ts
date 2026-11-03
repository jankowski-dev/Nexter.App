import { z } from 'zod';
import { assetSchema } from './accounting';
import { pageMetaSchema } from './pagination';

export const watchlistEntrySchema = z.object({
  id: z.uuid(),
  asset: assetSchema,
  thesis: z.string().nullable(),
  tags: z.array(z.string()),
  priority: z.number().int(),
  archivedAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  priceUsd: z.string().nullable(),
  price24hAgoUsd: z.string().nullable(),
  change24hPct: z.string().nullable(),
});

export const watchlistResponseSchema = z.object({
  data: z.array(watchlistEntrySchema),
  page: pageMetaSchema,
});

export const watchlistCreateRequestSchema = z.object({
  assetId: z.uuid(),
  thesis: z.string().max(2000).nullable().optional(),
  tags: z.array(z.string().min(1).max(40)).max(20).optional(),
  priority: z.number().int().min(0).max(100).optional(),
});

export const watchlistUpdateRequestSchema = z.object({
  thesis: z.string().max(2000).nullable().optional(),
  tags: z.array(z.string().min(1).max(40)).max(20).optional(),
  priority: z.number().int().min(0).max(100).optional(),
  archived: z.boolean().optional(),
});

export const watchlistListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().min(1).optional(),
  includeArchived: z
    .union([z.boolean(), z.enum(['true', 'false'])])
    .transform((value) => value === true || value === 'true')
    .default(false),
  search: z.string().max(100).optional(),
});

export type WatchlistEntry = z.infer<typeof watchlistEntrySchema>;
export type WatchlistResponse = z.infer<typeof watchlistResponseSchema>;
export type WatchlistCreateRequest = z.infer<typeof watchlistCreateRequestSchema>;
export type WatchlistUpdateRequest = z.infer<typeof watchlistUpdateRequestSchema>;
export type WatchlistListQuery = z.infer<typeof watchlistListQuerySchema>;

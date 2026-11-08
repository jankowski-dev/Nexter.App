import { z } from 'zod';
import { assetSchema } from './accounting';
import { pageMetaSchema } from './pagination';

export const watchlistGroupSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  sortOrder: z.number().int(),
  isDefault: z.boolean(),
  entryCount: z.number().int().nonnegative(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export const watchlistGroupsResponseSchema = z.object({
  groups: z.array(watchlistGroupSchema),
});

export const watchlistGroupCreateRequestSchema = z.object({
  name: z.string().trim().min(1).max(60),
  sortOrder: z.number().int().min(0).max(10_000).optional(),
});

export const watchlistGroupUpdateRequestSchema = z.object({
  name: z.string().trim().min(1).max(60).optional(),
  sortOrder: z.number().int().min(0).max(10_000).optional(),
});

export const watchlistEntrySchema = z.object({
  id: z.uuid(),
  asset: assetSchema,
  groupId: z.uuid().nullable(),
  logoUrl: z.string().nullable(),
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
  groupId: z.uuid().optional(),
  thesis: z.string().max(2000).nullable().optional(),
  tags: z.array(z.string().min(1).max(40)).max(20).optional(),
  priority: z.number().int().min(0).max(100).optional(),
});

export const watchlistUpdateRequestSchema = z.object({
  groupId: z.uuid().nullable().optional(),
  thesis: z.string().max(2000).nullable().optional(),
  tags: z.array(z.string().min(1).max(40)).max(20).optional(),
  priority: z.number().int().min(0).max(100).optional(),
  archived: z.boolean().optional(),
});

export const watchlistTokenSearchQuerySchema = z.object({
  chain: z.enum(['bsc', 'ethereum']),
  address: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
});

export const watchlistTokenSearchResultSchema = z.object({
  chain: z.enum(['bsc', 'ethereum']),
  address: z.string(),
  name: z.string(),
  symbol: z.string(),
  decimals: z.number().int().min(0).max(36),
  coingeckoId: z.string().nullable(),
  logoUrl: z.string().nullable(),
  priceUsd: z.string().nullable(),
  change24hPct: z.string().nullable(),
  marketCapUsd: z.string().nullable(),
  volume24hUsd: z.string().nullable(),
  assetId: z.uuid().nullable(),
  alreadyInWatchlist: z.boolean(),
});

export const watchlistFromContractRequestSchema = z.object({
  chain: z.enum(['bsc', 'ethereum']),
  address: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  groupId: z.uuid().optional(),
  thesis: z.string().max(2000).nullable().optional(),
  tags: z.array(z.string().min(1).max(40)).max(20).optional(),
  priority: z.number().int().min(0).max(100).optional(),
});

export const watchlistListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().min(1).optional(),
  includeArchived: z
    .union([z.boolean(), z.enum(['true', 'false'])])
    .transform((value) => value === true || value === 'true')
    .default(false),
  search: z.string().max(100).optional(),
  groupId: z.uuid().optional(),
});

export type WatchlistGroup = z.infer<typeof watchlistGroupSchema>;
export type WatchlistGroupsResponse = z.infer<typeof watchlistGroupsResponseSchema>;
export type WatchlistGroupCreateRequest = z.infer<typeof watchlistGroupCreateRequestSchema>;
export type WatchlistGroupUpdateRequest = z.infer<typeof watchlistGroupUpdateRequestSchema>;
export type WatchlistEntry = z.infer<typeof watchlistEntrySchema>;
export type WatchlistResponse = z.infer<typeof watchlistResponseSchema>;
export type WatchlistCreateRequest = z.infer<typeof watchlistCreateRequestSchema>;
export type WatchlistUpdateRequest = z.infer<typeof watchlistUpdateRequestSchema>;
export type WatchlistListQuery = z.infer<typeof watchlistListQuerySchema>;
export type WatchlistTokenSearchQuery = z.infer<typeof watchlistTokenSearchQuerySchema>;
export type WatchlistTokenSearchResult = z.infer<typeof watchlistTokenSearchResultSchema>;
export type WatchlistFromContractRequest = z.infer<typeof watchlistFromContractRequestSchema>;

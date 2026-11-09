import { z } from 'zod';

export const noteSchema = z.object({
  id: z.uuid(),
  title: z.string(),
  body: z.string(),
  tags: z.array(z.string()),
  pinned: z.boolean(),
  relatedAssetId: z.uuid().nullable(),
  relatedTradeGroupId: z.uuid().nullable(),
  archivedAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export const noteListQuerySchema = z.object({
  search: z.string().max(100).optional(),
  includeArchived: z
    .union([z.boolean(), z.enum(['true', 'false'])])
    .transform((value) => value === true || value === 'true')
    .default(false),
  limit: z.coerce.number().int().min(1).max(500).default(200),
});

export const noteCreateRequestSchema = z.object({
  title: z.string().trim().min(1).max(200),
  body: z.string().max(20_000).optional(),
  tags: z.array(z.string().trim().min(1).max(40)).max(20).optional(),
  pinned: z.boolean().optional(),
  relatedAssetId: z.uuid().nullable().optional(),
  relatedTradeGroupId: z.uuid().nullable().optional(),
});

export const noteUpdateRequestSchema = z
  .object({
    title: z.string().trim().min(1).max(200).optional(),
    body: z.string().max(20_000).optional(),
    tags: z.array(z.string().trim().min(1).max(40)).max(20).optional(),
    pinned: z.boolean().optional(),
    relatedAssetId: z.uuid().nullable().optional(),
    relatedTradeGroupId: z.uuid().nullable().optional(),
    archived: z.boolean().optional(),
  })
  .refine(
    (value) =>
      value.title !== undefined ||
      value.body !== undefined ||
      value.tags !== undefined ||
      value.pinned !== undefined ||
      value.relatedAssetId !== undefined ||
      value.relatedTradeGroupId !== undefined ||
      value.archived !== undefined,
    'At least one field must be provided',
  );

export const notesResponseSchema = z.object({ data: z.array(noteSchema) });

export type Note = z.infer<typeof noteSchema>;
export type NoteListQuery = z.infer<typeof noteListQuerySchema>;
export type NoteCreateRequest = z.infer<typeof noteCreateRequestSchema>;
export type NoteUpdateRequest = z.infer<typeof noteUpdateRequestSchema>;
export type NotesResponse = z.infer<typeof notesResponseSchema>;

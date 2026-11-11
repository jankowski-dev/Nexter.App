import { z } from 'zod';

export const noteImageMimeSchema = z.enum([
  'image/png',
  'image/jpeg',
  'image/webp',
  'application/pdf',
  'text/plain',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.rar',
  'application/x-rar-compressed',
  'application/zip',
  'application/x-zip-compressed',
]);

export const noteImageSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  mimeType: noteImageMimeSchema,
  dataUrl: z.string(),
  sizeBytes: z.number().int().nonnegative(),
  createdAt: z.iso.datetime(),
});

export const noteSchema = z.object({
  id: z.uuid(),
  title: z.string(),
  body: z.string(),
  tags: z.array(z.string()),
  images: z.array(noteImageSchema),
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
  archivedOnly: z
    .union([z.boolean(), z.enum(['true', 'false'])])
    .transform((value) => value === true || value === 'true')
    .default(false),
  offset: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});

export const noteImageCreateRequestSchema = z.object({
  name: z.string().trim().min(1).max(120),
  mimeType: noteImageMimeSchema,
  dataUrl: z
    .string()
    .max(2_000_000)
    .regex(/^data:[a-z0-9.+-]+\/[a-z0-9.+-]+;base64,[A-Za-z0-9+/=]+$/i),
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

export const notesResponseSchema = z.object({
  data: z.array(noteSchema),
  hasMore: z.boolean(),
});

export type NoteImage = z.infer<typeof noteImageSchema>;
export type NoteImageCreateRequest = z.infer<typeof noteImageCreateRequestSchema>;
export type Note = z.infer<typeof noteSchema>;
export type NoteListQuery = z.infer<typeof noteListQuerySchema>;
export type NoteCreateRequest = z.infer<typeof noteCreateRequestSchema>;
export type NoteUpdateRequest = z.infer<typeof noteUpdateRequestSchema>;
export type NotesResponse = z.infer<typeof notesResponseSchema>;

import { z } from 'zod';

export const pageMetaSchema = z.object({
  nextCursor: z.string().nullable(),
  hasMore: z.boolean(),
});

export type PageMeta = z.infer<typeof pageMetaSchema>;

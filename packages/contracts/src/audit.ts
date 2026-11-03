import { z } from 'zod';
import { pageMetaSchema } from './pagination';

export const auditEntrySchema = z.object({
  id: z.uuid(),
  userId: z.uuid().nullable(),
  action: z.string(),
  entityType: z.string(),
  entityId: z.string().nullable(),
  before: z.unknown(),
  after: z.unknown(),
  ip: z.string().nullable(),
  userAgent: z.string().nullable(),
  createdAt: z.iso.datetime(),
});

export const auditLogResponseSchema = z.object({
  data: z.array(auditEntrySchema),
  page: pageMetaSchema,
});

export const auditLogQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().min(1).optional(),
  action: z.string().max(100).optional(),
  entityType: z.string().max(100).optional(),
  from: z.iso.datetime().optional(),
  to: z.iso.datetime().optional(),
});

export type AuditEntry = z.infer<typeof auditEntrySchema>;
export type AuditLogResponse = z.infer<typeof auditLogResponseSchema>;
export type AuditLogQuery = z.infer<typeof auditLogQuerySchema>;

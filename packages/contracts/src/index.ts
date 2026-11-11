import { z } from 'zod';

export { scrubSentryBreadcrumb, scrubSentryEvent } from './sentry';
export * from './auth';
export * from './accounting';
export * from './audit';
export * from './finance';
export * from './habits';
export * from './imports';
export * from './notes';
export * from './pagination';
export * from './portfolio';
export * from './reconciliation';
export * from './reports';
export * from './settings';
export * from './swap';
export * from './tasks';
export * from './vault';
export * from './watchlist';

export const uuidSchema = z.uuid();

export const moneySchema = z
  .string()
  .regex(/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/, 'Expected a decimal string');

export const healthResponseSchema = z.object({
  status: z.literal('ok'),
  uptime: z.number().nonnegative(),
  timestamp: z.iso.datetime(),
  version: z.string().min(1),
});

export const readinessResponseSchema = z.object({
  status: z.literal('ready'),
  database: z.literal('ok'),
  timestamp: z.iso.datetime(),
});

export const errorEnvelopeSchema = z.object({
  error: z.object({
    code: z.string().min(1),
    message: z.string().min(1),
    details: z.unknown().optional(),
    requestId: z.string().min(1),
  }),
});

export const paginationQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().min(1).optional(),
});

export type HealthResponse = z.infer<typeof healthResponseSchema>;
export type ReadinessResponse = z.infer<typeof readinessResponseSchema>;
export type ErrorEnvelope = z.infer<typeof errorEnvelopeSchema>;
export type PaginationQuery = z.infer<typeof paginationQuerySchema>;

import { z } from 'zod';

export const taskStatusSchema = z.enum(['open', 'done', 'cancelled']);

export const taskSchema = z.object({
  id: z.uuid(),
  title: z.string(),
  description: z.string().nullable(),
  status: taskStatusSchema,
  priority: z.number().int().min(0).max(3),
  dueAt: z.iso.datetime().nullable(),
  completedAt: z.iso.datetime().nullable(),
  relatedAssetId: z.uuid().nullable(),
  archivedAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export const taskListQuerySchema = z.object({
  status: taskStatusSchema.optional(),
  search: z.string().max(100).optional(),
  includeArchived: z
    .union([z.boolean(), z.enum(['true', 'false'])])
    .transform((value) => value === true || value === 'true')
    .default(false),
  limit: z.coerce.number().int().min(1).max(500).default(200),
});

export const taskCreateRequestSchema = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().max(5000).nullable().optional(),
  priority: z.number().int().min(0).max(3).optional(),
  dueAt: z.iso.datetime().nullable().optional(),
  relatedAssetId: z.uuid().nullable().optional(),
});

export const taskUpdateRequestSchema = z
  .object({
    title: z.string().trim().min(1).max(200).optional(),
    description: z.string().max(5000).nullable().optional(),
    status: taskStatusSchema.optional(),
    priority: z.number().int().min(0).max(3).optional(),
    dueAt: z.iso.datetime().nullable().optional(),
    relatedAssetId: z.uuid().nullable().optional(),
    archived: z.boolean().optional(),
  })
  .refine(
    (value) =>
      value.title !== undefined ||
      value.description !== undefined ||
      value.status !== undefined ||
      value.priority !== undefined ||
      value.dueAt !== undefined ||
      value.relatedAssetId !== undefined ||
      value.archived !== undefined,
    'At least one field must be provided',
  );

export const tasksResponseSchema = z.object({ data: z.array(taskSchema) });

export type TaskStatus = z.infer<typeof taskStatusSchema>;
export type Task = z.infer<typeof taskSchema>;
export type TaskListQuery = z.infer<typeof taskListQuerySchema>;
export type TaskCreateRequest = z.infer<typeof taskCreateRequestSchema>;
export type TaskUpdateRequest = z.infer<typeof taskUpdateRequestSchema>;
export type TasksResponse = z.infer<typeof tasksResponseSchema>;

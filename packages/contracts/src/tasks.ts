import { z } from 'zod';

export const taskStatusSchema = z.enum(['open', 'done', 'cancelled']);
export const taskRecurrenceSchema = z.enum(['daily', 'weekly', 'monthly']);
export const taskImageMimeSchema = z.enum(['image/png', 'image/jpeg', 'image/webp']);

export const taskImageSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  mimeType: taskImageMimeSchema,
  dataUrl: z.string(),
  sizeBytes: z.number().int().nonnegative(),
  createdAt: z.iso.datetime(),
});

export const taskSchema = z.object({
  id: z.uuid(),
  title: z.string(),
  description: z.string().nullable(),
  status: taskStatusSchema,
  priority: z.number().int().min(0).max(3),
  tags: z.array(z.string()),
  images: z.array(taskImageSchema),
  dueAt: z.iso.datetime().nullable(),
  completedAt: z.iso.datetime().nullable(),
  relatedAssetId: z.uuid().nullable(),
  seriesId: z.uuid().nullable(),
  recurrence: taskRecurrenceSchema.nullable(),
  recurrenceEndsAt: z.iso.datetime().nullable(),
  occurrenceIndex: z.number().int().nonnegative(),
  archivedAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export const taskListQuerySchema = z
  .object({
    status: taskStatusSchema.optional(),
    search: z.string().max(100).optional(),
    includeArchived: z
      .union([z.boolean(), z.enum(['true', 'false'])])
      .transform((value) => value === true || value === 'true')
      .default(false),
    archivedOnly: z
      .union([z.boolean(), z.enum(['true', 'false'])])
      .transform((value) => value === true || value === 'true')
      .default(false),
    from: z.iso.datetime().optional(),
    to: z.iso.datetime().optional(),
    limit: z.coerce.number().int().min(1).max(500).default(200),
  })
  .refine(
    (value) =>
      !value.from || !value.to || new Date(value.from).getTime() <= new Date(value.to).getTime(),
    'from must be before or equal to to',
  );

export const taskCreateRequestSchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    description: z.string().max(5000).nullable().optional(),
    priority: z.number().int().min(0).max(3).optional(),
    tags: z.array(z.string().trim().min(1).max(40)).max(20).optional(),
    dueAt: z.iso.datetime().nullable().optional(),
    relatedAssetId: z.uuid().nullable().optional(),
    recurrence: taskRecurrenceSchema.optional(),
    recurrenceEndsAt: z.iso.datetime().nullable().optional(),
  })
  .refine((value) => !value.recurrence || value.dueAt, {
    message: 'A recurring task requires a due date',
    path: ['dueAt'],
  })
  .refine(
    (value) =>
      !value.recurrenceEndsAt ||
      (value.recurrence !== undefined &&
        value.dueAt &&
        new Date(value.recurrenceEndsAt).getTime() >= new Date(value.dueAt).getTime()),
    {
      message: 'recurrenceEndsAt must be on or after dueAt and requires recurrence',
      path: ['recurrenceEndsAt'],
    },
  );

export const taskUpdateRequestSchema = z
  .object({
    title: z.string().trim().min(1).max(200).optional(),
    description: z.string().max(5000).nullable().optional(),
    status: taskStatusSchema.optional(),
    priority: z.number().int().min(0).max(3).optional(),
    tags: z.array(z.string().trim().min(1).max(40)).max(20).optional(),
    dueAt: z.iso.datetime().nullable().optional(),
    relatedAssetId: z.uuid().nullable().optional(),
    archived: z.boolean().optional(),
    applyToSeries: z.boolean().optional(),
  })
  .refine(
    (value) =>
      value.title !== undefined ||
      value.description !== undefined ||
      value.status !== undefined ||
      value.priority !== undefined ||
      value.tags !== undefined ||
      value.dueAt !== undefined ||
      value.relatedAssetId !== undefined ||
      value.archived !== undefined ||
      value.applyToSeries !== undefined,
    'At least one field must be provided',
  );

export const taskImageCreateRequestSchema = z.object({
  name: z.string().trim().min(1).max(120),
  mimeType: taskImageMimeSchema,
  dataUrl: z
    .string()
    .max(2_000_000)
    .regex(/^data:[a-z0-9.+-]+\/[a-z0-9.+-]+;base64,[A-Za-z0-9+/=]+$/i),
});

export const tasksResponseSchema = z.object({ data: z.array(taskSchema) });

export type TaskStatus = z.infer<typeof taskStatusSchema>;
export type TaskRecurrence = z.infer<typeof taskRecurrenceSchema>;
export type TaskImage = z.infer<typeof taskImageSchema>;
export type TaskImageCreateRequest = z.infer<typeof taskImageCreateRequestSchema>;
export type Task = z.infer<typeof taskSchema>;
export type TaskListQuery = z.infer<typeof taskListQuerySchema>;
export type TaskCreateRequest = z.infer<typeof taskCreateRequestSchema>;
export type TaskUpdateRequest = z.infer<typeof taskUpdateRequestSchema>;
export type TasksResponse = z.infer<typeof tasksResponseSchema>;

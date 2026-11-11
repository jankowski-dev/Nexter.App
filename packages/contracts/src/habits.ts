import { z } from 'zod';

const dateOnlySchema = z.iso.date();

export const habitSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  startedOn: dateOnlySchema,
  archivedAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export const habitsResponseSchema = z.object({ data: z.array(habitSchema) });

export const habitCreateRequestSchema = z.object({
  name: z.string().trim().min(1).max(80),
  startedOn: dateOnlySchema,
});

export const habitUpdateRequestSchema = z
  .object({
    name: z.string().trim().min(1).max(80).optional(),
    startedOn: dateOnlySchema.optional(),
    archived: z.boolean().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, 'At least one field must be provided');

export const habitListQuerySchema = z.object({
  includeArchived: z
    .union([z.boolean(), z.enum(['true', 'false'])])
    .transform((value) => value === true || value === 'true')
    .default(false),
});

export type Habit = z.infer<typeof habitSchema>;
export type HabitsResponse = z.infer<typeof habitsResponseSchema>;
export type HabitCreateRequest = z.infer<typeof habitCreateRequestSchema>;
export type HabitUpdateRequest = z.infer<typeof habitUpdateRequestSchema>;
export type HabitListQuery = z.infer<typeof habitListQuerySchema>;

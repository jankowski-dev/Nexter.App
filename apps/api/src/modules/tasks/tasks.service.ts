import { randomUUID } from 'node:crypto';
import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, eq, gte, ilike, inArray, isNotNull, isNull, lte, or, sql } from 'drizzle-orm';
import {
  assets,
  taskImages,
  tasks,
  type Database,
  type DbExecutor,
  type TaskRecord,
  type TaskRecurrence,
} from '@nexter/db';
import type {
  Task,
  TaskCreateRequest,
  TaskImage,
  TaskImageCreateRequest,
  TaskListQuery,
  TaskUpdateRequest,
  TasksResponse,
} from '@nexter/contracts';
import { AuditService } from '../../shared/audit/audit.service';
import { DB } from '../../shared/db/db.module';

interface TaskMeta {
  ip?: string;
  userAgent?: string;
}

function toImage(row: {
  id: string;
  name: string;
  mimeType: string;
  dataUrl: string;
  sizeBytes: number;
  createdAt: Date;
}): TaskImage {
  return {
    id: row.id,
    name: row.name,
    mimeType: row.mimeType as TaskImage['mimeType'],
    dataUrl: row.dataUrl,
    sizeBytes: row.sizeBytes,
    createdAt: row.createdAt.toISOString(),
  };
}

async function loadImages(
  executor: DbExecutor,
  userId: string,
  taskIds: string[],
): Promise<Map<string, TaskImage[]>> {
  const byTask = new Map<string, TaskImage[]>();
  if (taskIds.length === 0) return byTask;

  const rows = await executor
    .select()
    .from(taskImages)
    .where(and(eq(taskImages.userId, userId), inArray(taskImages.taskId, taskIds)))
    .orderBy(taskImages.createdAt);

  for (const row of rows) {
    const list = byTask.get(row.taskId) ?? [];
    list.push(toImage(row));
    byTask.set(row.taskId, list);
  }

  return byTask;
}

function toContract(row: TaskRecord, images: TaskImage[] = []): Task {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    status: row.status,
    priority: row.priority,
    tags: row.tags,
    images,
    dueAt: row.dueAt?.toISOString() ?? null,
    completedAt: row.completedAt?.toISOString() ?? null,
    relatedAssetId: row.relatedAssetId,
    seriesId: row.seriesId,
    recurrence: row.recurrence,
    recurrenceEndsAt: row.recurrenceEndsAt?.toISOString() ?? null,
    occurrenceIndex: row.occurrenceIndex,
    archivedAt: row.archivedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

const MAX_OCCURRENCES = 366;

function addMonthsUtc(date: Date, months: number): Date {
  const day = date.getUTCDate();
  const result = new Date(
    Date.UTC(
      date.getUTCFullYear(),
      date.getUTCMonth() + months,
      1,
      date.getUTCHours(),
      date.getUTCMinutes(),
      date.getUTCSeconds(),
      date.getUTCMilliseconds(),
    ),
  );
  const lastDay = new Date(
    Date.UTC(result.getUTCFullYear(), result.getUTCMonth() + 1, 0),
  ).getUTCDate();
  result.setUTCDate(Math.min(day, lastDay));

  return result;
}

function occurrenceAt(anchor: Date, recurrence: TaskRecurrence, index: number): Date {
  if (recurrence === 'daily') return new Date(anchor.getTime() + index * 86_400_000);
  if (recurrence === 'weekly') return new Date(anchor.getTime() + index * 7 * 86_400_000);
  return addMonthsUtc(anchor, index);
}

function recurrenceHorizon(anchor: Date, endsAt: Date | null): Date {
  return endsAt ?? addMonthsUtc(anchor, 12);
}

@Injectable()
export class TasksService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly audit: AuditService,
  ) {}

  async list(userId: string, query: TaskListQuery): Promise<TasksResponse> {
    const conditions = [eq(tasks.userId, userId)];

    if (query.archivedOnly) conditions.push(isNotNull(tasks.archivedAt));
    else if (!query.includeArchived) conditions.push(isNull(tasks.archivedAt));
    if (query.status) conditions.push(eq(tasks.status, query.status));
    if (query.from) conditions.push(gte(tasks.dueAt, new Date(query.from)));
    if (query.to) conditions.push(lte(tasks.dueAt, new Date(query.to)));
    if (query.search) {
      const pattern = `%${query.search}%`;
      conditions.push(or(ilike(tasks.title, pattern), ilike(tasks.description, pattern))!);
    }

    const rows = await this.db
      .select()
      .from(tasks)
      .where(and(...conditions))
      .orderBy(
        sql`case when ${tasks.status} = 'open' then 0 else 1 end`,
        sql`${tasks.priority} desc`,
        sql`${tasks.dueAt} asc nulls last`,
        sql`${tasks.createdAt} desc`,
      )
      .limit(query.limit);

    const images = await loadImages(
      this.db,
      userId,
      rows.map((row) => row.id),
    );

    return { data: rows.map((row) => toContract(row, images.get(row.id) ?? [])) };
  }

  async create(userId: string, input: TaskCreateRequest, meta: TaskMeta): Promise<Task> {
    await this.requireAsset(input.relatedAssetId);

    const dueAt = input.dueAt ? new Date(input.dueAt) : null;
    const recurrence = input.recurrence ?? null;
    const recurrenceEndsAt = input.recurrenceEndsAt ? new Date(input.recurrenceEndsAt) : null;

    if (recurrence && !dueAt) {
      throw new BadRequestException({
        code: 'VALIDATION_FAILED',
        message: 'A recurring task requires a due date',
      });
    }

    const seriesId = recurrence ? randomUUID() : null;
    const occurrences =
      recurrence && dueAt
        ? Array.from({ length: MAX_OCCURRENCES }, (_, index) => ({
            index,
            dueAt: occurrenceAt(dueAt, recurrence, index),
          })).filter(
            (occurrence) =>
              occurrence.dueAt.getTime() <= recurrenceHorizon(dueAt, recurrenceEndsAt).getTime(),
          )
        : [{ index: 0, dueAt }];

    if (occurrences.length === 0) {
      throw new BadRequestException({
        code: 'VALIDATION_FAILED',
        message: 'recurrenceEndsAt must be on or after dueAt',
      });
    }

    const createdRows = await this.db.transaction(async (tx) => {
      const created = await tx
        .insert(tasks)
        .values(
          occurrences.map((occurrence) => ({
            userId,
            title: input.title,
            description: input.description ?? null,
            priority: input.priority ?? 0,
            tags: input.tags ?? [],
            dueAt: occurrence.dueAt,
            relatedAssetId: input.relatedAssetId ?? null,
            seriesId,
            recurrence,
            recurrenceEndsAt,
            occurrenceIndex: occurrence.index,
          })),
        )
        .returning();

      const first = created[0];
      if (!first) throw new Error('Failed to create task');

      await this.audit.log(
        {
          userId,
          action: 'task.created',
          entityType: 'task',
          entityId: first.id,
          after: {
            title: first.title,
            status: first.status,
            priority: first.priority,
            dueAt: first.dueAt?.toISOString() ?? null,
            relatedAssetId: first.relatedAssetId,
            seriesId,
            recurrence,
            recurrenceEndsAt: recurrenceEndsAt?.toISOString() ?? null,
            occurrenceCount: created.length,
          },
          ip: meta.ip,
          userAgent: meta.userAgent,
        },
        { executor: tx, strict: true },
      );

      return created;
    });

    return toContract(createdRows[0] as TaskRecord, []);
  }

  async update(
    userId: string,
    id: string,
    input: TaskUpdateRequest,
    meta: TaskMeta,
  ): Promise<Task> {
    const [existing] = await this.db
      .select()
      .from(tasks)
      .where(and(eq(tasks.id, id), eq(tasks.userId, userId)))
      .limit(1);

    if (!existing) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Task not found' });
    }

    await this.requireAsset(input.relatedAssetId);

    const now = new Date();
    const applyToSeries = Boolean(existing.seriesId) && input.applyToSeries !== false;
    const seriesId = existing.seriesId as string;

    if (applyToSeries && seriesId) {
      if (input.dueAt === null) {
        throw new BadRequestException({
          code: 'VALIDATION_FAILED',
          message: 'A recurring series must keep a due date',
        });
      }
      if (input.dueAt !== undefined && !existing.dueAt) {
        throw new BadRequestException({
          code: 'VALIDATION_FAILED',
          message: 'The recurring series has no anchor due date to shift',
        });
      }
      const updated = await this.db.transaction(async (tx) => {
        const rows = await tx
          .select()
          .from(tasks)
          .where(and(eq(tasks.userId, userId), eq(tasks.seriesId, seriesId)))
          .for('update');

        const deltaMs =
          input.dueAt !== undefined && existing.dueAt
            ? new Date(input.dueAt as string).getTime() - existing.dueAt.getTime()
            : null;

        for (const row of rows) {
          await tx
            .update(tasks)
            .set({
              ...(input.title !== undefined ? { title: input.title } : {}),
              ...(input.description !== undefined ? { description: input.description } : {}),
              ...(input.priority !== undefined ? { priority: input.priority } : {}),
              ...(input.tags !== undefined ? { tags: input.tags } : {}),
              ...(input.relatedAssetId !== undefined
                ? { relatedAssetId: input.relatedAssetId }
                : {}),
              ...(input.dueAt !== undefined
                ? {
                    dueAt:
                      row.dueAt && deltaMs !== null
                        ? new Date(row.dueAt.getTime() + deltaMs)
                        : new Date(input.dueAt as string),
                    ...(row.recurrenceEndsAt && deltaMs !== null
                      ? { recurrenceEndsAt: new Date(row.recurrenceEndsAt.getTime() + deltaMs) }
                      : {}),
                  }
                : {}),
              ...(input.archived !== undefined
                ? { archivedAt: input.archived ? (row.archivedAt ?? now) : null }
                : {}),
              updatedAt: now,
            })
            .where(eq(tasks.id, row.id));
        }

        if (input.status !== undefined) {
          await tx
            .update(tasks)
            .set({
              status: input.status,
              completedAt: input.status === 'done' ? (existing.completedAt ?? now) : null,
              updatedAt: now,
            })
            .where(eq(tasks.id, id));
        }

        const [refreshed] = await tx
          .select()
          .from(tasks)
          .where(and(eq(tasks.id, id), eq(tasks.userId, userId)))
          .limit(1);

        if (!refreshed) throw new Error('Failed to update task series');

        await this.audit.log(
          {
            userId,
            action: 'task.series_updated',
            entityType: 'task',
            entityId: id,
            before: {
              title: existing.title,
              priority: existing.priority,
              dueAt: existing.dueAt?.toISOString() ?? null,
              archivedAt: existing.archivedAt?.toISOString() ?? null,
            },
            after: {
              title: refreshed.title,
              priority: refreshed.priority,
              dueAt: refreshed.dueAt?.toISOString() ?? null,
              archivedAt: refreshed.archivedAt?.toISOString() ?? null,
              seriesId,
              affected: rows.length,
            },
            ip: meta.ip,
            userAgent: meta.userAgent,
          },
          { executor: tx, strict: true },
        );

        return refreshed;
      });

      const images = await loadImages(this.db, userId, [updated.id]);
      return toContract(updated, images.get(updated.id) ?? []);
    }

    const status = input.status ?? existing.status;
    const completedAt =
      status === 'done'
        ? (existing.completedAt ?? new Date())
        : input.status !== undefined
          ? null
          : existing.completedAt;
    const archivedAt =
      input.archived === undefined ? existing.archivedAt : input.archived ? new Date() : null;

    const [updated] = await this.db
      .update(tasks)
      .set({
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.priority !== undefined ? { priority: input.priority } : {}),
        ...(input.tags !== undefined ? { tags: input.tags } : {}),
        ...(input.dueAt !== undefined ? { dueAt: input.dueAt ? new Date(input.dueAt) : null } : {}),
        ...(input.relatedAssetId !== undefined ? { relatedAssetId: input.relatedAssetId } : {}),
        ...(input.status !== undefined ? { status: input.status } : {}),
        completedAt,
        archivedAt,
        updatedAt: new Date(),
      })
      .where(eq(tasks.id, id))
      .returning();

    if (!updated) throw new Error('Failed to update task');

    await this.audit.log(
      {
        userId,
        action: 'task.updated',
        entityType: 'task',
        entityId: id,
        before: {
          title: existing.title,
          status: existing.status,
          priority: existing.priority,
          archivedAt: existing.archivedAt?.toISOString() ?? null,
        },
        after: {
          title: updated.title,
          status: updated.status,
          priority: updated.priority,
          archivedAt: updated.archivedAt?.toISOString() ?? null,
        },
        ip: meta.ip,
        userAgent: meta.userAgent,
      },
      { strict: true },
    );

    const images = await loadImages(this.db, userId, [updated.id]);

    return toContract(updated, images.get(updated.id) ?? []);
  }

  async addImage(
    userId: string,
    taskId: string,
    input: TaskImageCreateRequest,
    meta: TaskMeta,
  ): Promise<TaskImage> {
    const [task] = await this.db
      .select({ id: tasks.id })
      .from(tasks)
      .where(and(eq(tasks.id, taskId), eq(tasks.userId, userId)))
      .limit(1);

    if (!task) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Task not found' });
    }

    const existing = await this.db
      .select({ id: taskImages.id })
      .from(taskImages)
      .where(and(eq(taskImages.userId, userId), eq(taskImages.taskId, taskId)));

    if (existing.length >= 5) {
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: 'A task can have at most 5 images',
      });
    }

    const base64 = input.dataUrl.slice(input.dataUrl.indexOf(',') + 1);
    const sizeBytes = Buffer.byteLength(base64, 'base64');

    if (sizeBytes <= 0 || sizeBytes > 1_500_000) {
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: 'Image must be between 1 byte and 1.5 MB',
      });
    }

    if (!input.dataUrl.startsWith(`data:${input.mimeType};base64,`)) {
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: 'Image MIME type does not match the data URL',
      });
    }

    const [created] = await this.db
      .insert(taskImages)
      .values({
        userId,
        taskId,
        name: input.name,
        mimeType: input.mimeType,
        dataUrl: input.dataUrl,
        sizeBytes,
      })
      .returning();

    if (!created) throw new Error('Failed to add task image');

    await this.audit.log(
      {
        userId,
        action: 'task.image_added',
        entityType: 'task',
        entityId: taskId,
        after: { imageId: created.id, name: created.name, sizeBytes: created.sizeBytes },
        ip: meta.ip,
        userAgent: meta.userAgent,
      },
      { strict: true },
    );

    return toImage(created);
  }

  async removeImage(
    userId: string,
    taskId: string,
    imageId: string,
    meta: TaskMeta,
  ): Promise<void> {
    const [image] = await this.db
      .select()
      .from(taskImages)
      .where(
        and(
          eq(taskImages.id, imageId),
          eq(taskImages.userId, userId),
          eq(taskImages.taskId, taskId),
        ),
      )
      .limit(1);

    if (!image) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Task image not found' });
    }

    await this.db.delete(taskImages).where(eq(taskImages.id, image.id));

    await this.audit.log(
      {
        userId,
        action: 'task.image_removed',
        entityType: 'task',
        entityId: taskId,
        before: { imageId: image.id, name: image.name, sizeBytes: image.sizeBytes },
        ip: meta.ip,
        userAgent: meta.userAgent,
      },
      { strict: true },
    );
  }

  private async requireAsset(assetId: string | null | undefined): Promise<void> {
    if (!assetId) return;

    const [asset] = await this.db
      .select({ id: assets.id })
      .from(assets)
      .where(eq(assets.id, assetId))
      .limit(1);

    if (!asset) {
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: 'Related asset not found',
      });
    }
  }
}

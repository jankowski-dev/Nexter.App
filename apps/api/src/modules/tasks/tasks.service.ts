import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, eq, ilike, isNull, or, sql } from 'drizzle-orm';
import { assets, tasks, type Database, type TaskRecord } from '@nexter/db';
import type {
  Task,
  TaskCreateRequest,
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

function toContract(row: TaskRecord): Task {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    status: row.status,
    priority: row.priority,
    dueAt: row.dueAt?.toISOString() ?? null,
    completedAt: row.completedAt?.toISOString() ?? null,
    relatedAssetId: row.relatedAssetId,
    archivedAt: row.archivedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

@Injectable()
export class TasksService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly audit: AuditService,
  ) {}

  async list(userId: string, query: TaskListQuery): Promise<TasksResponse> {
    const conditions = [eq(tasks.userId, userId)];

    if (!query.includeArchived) conditions.push(isNull(tasks.archivedAt));
    if (query.status) conditions.push(eq(tasks.status, query.status));
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

    return { data: rows.map(toContract) };
  }

  async create(userId: string, input: TaskCreateRequest, meta: TaskMeta): Promise<Task> {
    await this.requireAsset(input.relatedAssetId);
    const [created] = await this.db
      .insert(tasks)
      .values({
        userId,
        title: input.title,
        description: input.description ?? null,
        priority: input.priority ?? 0,
        dueAt: input.dueAt ? new Date(input.dueAt) : null,
        relatedAssetId: input.relatedAssetId ?? null,
      })
      .returning();

    if (!created) throw new Error('Failed to create task');

    await this.audit.log(
      {
        userId,
        action: 'task.created',
        entityType: 'task',
        entityId: created.id,
        after: {
          title: created.title,
          status: created.status,
          priority: created.priority,
          dueAt: created.dueAt?.toISOString() ?? null,
          relatedAssetId: created.relatedAssetId,
        },
        ip: meta.ip,
        userAgent: meta.userAgent,
      },
      { strict: true },
    );

    return toContract(created);
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

    return toContract(updated);
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

import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, desc, eq, isNull } from 'drizzle-orm';
import { habits, type Database, type HabitRecord } from '@nexter/db';
import type {
  Habit,
  HabitCreateRequest,
  HabitListQuery,
  HabitUpdateRequest,
  HabitsResponse,
} from '@nexter/contracts';
import { AuditService } from '../../shared/audit/audit.service';
import { DB } from '../../shared/db/db.module';

interface HabitMeta {
  ip?: string;
  userAgent?: string;
}

function toContract(row: HabitRecord): Habit {
  return {
    id: row.id,
    name: row.name,
    startedOn: row.startedOn,
    archivedAt: row.archivedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

@Injectable()
export class HabitsService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly audit: AuditService,
  ) {}

  async list(userId: string, query: HabitListQuery): Promise<HabitsResponse> {
    const conditions = [eq(habits.userId, userId)];
    if (!query.includeArchived) conditions.push(isNull(habits.archivedAt));

    const rows = await this.db
      .select()
      .from(habits)
      .where(and(...conditions))
      .orderBy(desc(habits.startedOn), asc(habits.name));

    return { data: rows.map(toContract) };
  }

  async create(userId: string, input: HabitCreateRequest, meta: HabitMeta): Promise<Habit> {
    try {
      const [created] = await this.db
        .insert(habits)
        .values({
          userId,
          name: input.name,
          startedOn: input.startedOn,
        })
        .returning();

      if (!created) throw new Error('Failed to create habit');

      await this.audit.log(
        {
          userId,
          action: 'habit.created',
          entityType: 'habit',
          entityId: created.id,
          after: { name: created.name, startedOn: created.startedOn },
          ip: meta.ip,
          userAgent: meta.userAgent,
        },
        { strict: true },
      );

      return toContract(created);
    } catch (error) {
      if (
        typeof error === 'object' &&
        error !== null &&
        ((error as { code?: string }).code === '23505' ||
          (error as { cause?: { code?: string } }).cause?.code === '23505')
      ) {
        throw new ConflictException({
          code: 'CONFLICT',
          message: 'Привычка с таким названием уже существует',
        });
      }
      throw error;
    }
  }

  async update(
    userId: string,
    id: string,
    input: HabitUpdateRequest,
    meta: HabitMeta,
  ): Promise<Habit> {
    const [existing] = await this.db
      .select()
      .from(habits)
      .where(and(eq(habits.id, id), eq(habits.userId, userId)))
      .limit(1);

    if (!existing) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Habit not found' });
    }

    try {
      const [updated] = await this.db
        .update(habits)
        .set({
          name: input.name ?? existing.name,
          startedOn: input.startedOn ?? existing.startedOn,
          archivedAt:
            input.archived === undefined ? existing.archivedAt : input.archived ? new Date() : null,
          updatedAt: new Date(),
        })
        .where(and(eq(habits.id, id), eq(habits.userId, userId)))
        .returning();

      if (!updated) throw new Error('Failed to update habit');

      await this.audit.log(
        {
          userId,
          action: 'habit.updated',
          entityType: 'habit',
          entityId: id,
          before: {
            name: existing.name,
            startedOn: existing.startedOn,
            archivedAt: existing.archivedAt?.toISOString() ?? null,
          },
          after: {
            name: updated.name,
            startedOn: updated.startedOn,
            archivedAt: updated.archivedAt?.toISOString() ?? null,
          },
          ip: meta.ip,
          userAgent: meta.userAgent,
        },
        { strict: true },
      );

      return toContract(updated);
    } catch (error) {
      if (
        typeof error === 'object' &&
        error !== null &&
        ((error as { code?: string }).code === '23505' ||
          (error as { cause?: { code?: string } }).cause?.code === '23505')
      ) {
        throw new ConflictException({
          code: 'CONFLICT',
          message: 'Привычка с таким названием уже существует',
        });
      }
      throw error;
    }
  }
}

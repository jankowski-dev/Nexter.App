import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, eq, ilike, isNull, or, sql } from 'drizzle-orm';
import { assets, notes, tradeGroups, type Database, type NoteRecord } from '@nexter/db';
import type {
  Note,
  NoteCreateRequest,
  NoteListQuery,
  NoteUpdateRequest,
  NotesResponse,
} from '@nexter/contracts';
import { AuditService } from '../../shared/audit/audit.service';
import { DB } from '../../shared/db/db.module';

interface NoteMeta {
  ip?: string;
  userAgent?: string;
}

function toContract(row: NoteRecord): Note {
  return {
    id: row.id,
    title: row.title,
    body: row.body,
    tags: row.tags,
    pinned: row.pinned,
    relatedAssetId: row.relatedAssetId,
    relatedTradeGroupId: row.relatedTradeGroupId,
    archivedAt: row.archivedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

@Injectable()
export class NotesService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly audit: AuditService,
  ) {}

  async list(userId: string, query: NoteListQuery): Promise<NotesResponse> {
    const conditions = [eq(notes.userId, userId)];

    if (!query.includeArchived) conditions.push(isNull(notes.archivedAt));
    if (query.search) {
      const pattern = `%${query.search}%`;
      conditions.push(
        or(
          ilike(notes.title, pattern),
          ilike(notes.body, pattern),
          sql`array_to_string(${notes.tags}, ' ') ilike ${pattern}`,
        )!,
      );
    }

    const rows = await this.db
      .select()
      .from(notes)
      .where(and(...conditions))
      .orderBy(sql`${notes.pinned} desc`, sql`${notes.updatedAt} desc`)
      .limit(query.limit);

    return { data: rows.map(toContract) };
  }

  async create(userId: string, input: NoteCreateRequest, meta: NoteMeta): Promise<Note> {
    await this.requireLinks(userId, input.relatedAssetId, input.relatedTradeGroupId);
    const [created] = await this.db
      .insert(notes)
      .values({
        userId,
        title: input.title,
        body: input.body ?? '',
        tags: input.tags ?? [],
        pinned: input.pinned ?? false,
        relatedAssetId: input.relatedAssetId ?? null,
        relatedTradeGroupId: input.relatedTradeGroupId ?? null,
      })
      .returning();

    if (!created) throw new Error('Failed to create note');

    await this.audit.log(
      {
        userId,
        action: 'note.created',
        entityType: 'note',
        entityId: created.id,
        after: {
          title: created.title,
          tags: created.tags,
          pinned: created.pinned,
          relatedAssetId: created.relatedAssetId,
          relatedTradeGroupId: created.relatedTradeGroupId,
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
    input: NoteUpdateRequest,
    meta: NoteMeta,
  ): Promise<Note> {
    const [existing] = await this.db
      .select()
      .from(notes)
      .where(and(eq(notes.id, id), eq(notes.userId, userId)))
      .limit(1);

    if (!existing) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Note not found' });
    }

    await this.requireLinks(userId, input.relatedAssetId, input.relatedTradeGroupId);
    const archivedAt =
      input.archived === undefined ? existing.archivedAt : input.archived ? new Date() : null;

    const [updated] = await this.db
      .update(notes)
      .set({
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.body !== undefined ? { body: input.body } : {}),
        ...(input.tags !== undefined ? { tags: input.tags } : {}),
        ...(input.pinned !== undefined ? { pinned: input.pinned } : {}),
        ...(input.relatedAssetId !== undefined ? { relatedAssetId: input.relatedAssetId } : {}),
        ...(input.relatedTradeGroupId !== undefined
          ? { relatedTradeGroupId: input.relatedTradeGroupId }
          : {}),
        archivedAt,
        updatedAt: new Date(),
      })
      .where(eq(notes.id, id))
      .returning();

    if (!updated) throw new Error('Failed to update note');

    await this.audit.log(
      {
        userId,
        action: 'note.updated',
        entityType: 'note',
        entityId: id,
        before: { title: existing.title, pinned: existing.pinned, archivedAt: existing.archivedAt },
        after: { title: updated.title, pinned: updated.pinned, archivedAt: updated.archivedAt },
        ip: meta.ip,
        userAgent: meta.userAgent,
      },
      { strict: true },
    );

    return toContract(updated);
  }

  private async requireLinks(
    userId: string,
    assetId: string | null | undefined,
    tradeGroupId: string | null | undefined,
  ): Promise<void> {
    if (assetId) {
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

    if (tradeGroupId) {
      const [group] = await this.db
        .select({ id: tradeGroups.id })
        .from(tradeGroups)
        .where(and(eq(tradeGroups.id, tradeGroupId), eq(tradeGroups.userId, userId)))
        .limit(1);

      if (!group) {
        throw new BadRequestException({
          code: 'VALIDATION_ERROR',
          message: 'Related trade group not found',
        });
      }
    }
  }
}

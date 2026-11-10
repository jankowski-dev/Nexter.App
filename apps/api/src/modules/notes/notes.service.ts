import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, eq, ilike, inArray, isNotNull, isNull, or, sql } from 'drizzle-orm';
import {
  assets,
  noteImages,
  notes,
  tradeGroups,
  type Database,
  type DbExecutor,
  type NoteRecord,
} from '@nexter/db';
import type {
  Note,
  NoteCreateRequest,
  NoteImage,
  NoteImageCreateRequest,
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

function toImage(row: {
  id: string;
  name: string;
  mimeType: string;
  dataUrl: string;
  sizeBytes: number;
  createdAt: Date;
}): NoteImage {
  return {
    id: row.id,
    name: row.name,
    mimeType: row.mimeType as NoteImage['mimeType'],
    dataUrl: row.dataUrl,
    sizeBytes: row.sizeBytes,
    createdAt: row.createdAt.toISOString(),
  };
}

async function loadImages(
  executor: DbExecutor,
  userId: string,
  noteIds: string[],
): Promise<Map<string, NoteImage[]>> {
  const byNote = new Map<string, NoteImage[]>();
  if (noteIds.length === 0) return byNote;
  const rows = await executor
    .select()
    .from(noteImages)
    .where(and(eq(noteImages.userId, userId), inArray(noteImages.noteId, noteIds)))
    .orderBy(noteImages.createdAt);
  for (const row of rows) {
    const list = byNote.get(row.noteId) ?? [];
    list.push(toImage(row));
    byNote.set(row.noteId, list);
  }
  return byNote;
}

function toContract(row: NoteRecord, images: NoteImage[] = []): Note {
  return {
    id: row.id,
    title: row.title,
    body: row.body,
    tags: row.tags,
    images,
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

    if (query.archivedOnly) conditions.push(isNotNull(notes.archivedAt));
    else if (!query.includeArchived) conditions.push(isNull(notes.archivedAt));
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
      .orderBy(sql`${notes.pinned} desc`, sql`${notes.updatedAt} desc`, sql`${notes.id} desc`)
      .limit(query.limit + 1)
      .offset(query.offset);

    const hasMore = rows.length > query.limit;
    const page = hasMore ? rows.slice(0, query.limit) : rows;
    const images = await loadImages(
      this.db,
      userId,
      page.map((row) => row.id),
    );

    return {
      data: page.map((row) => toContract(row, images.get(row.id) ?? [])),
      hasMore,
    };
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

    return toContract(created, []);
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
        ...(input.archived !== undefined ? { archivedAt } : {}),
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

    const images = await loadImages(this.db, userId, [updated.id]);
    return toContract(updated, images.get(updated.id) ?? []);
  }

  async addImage(
    userId: string,
    noteId: string,
    input: NoteImageCreateRequest,
    meta: NoteMeta,
  ): Promise<NoteImage> {
    const [note] = await this.db
      .select({ id: notes.id })
      .from(notes)
      .where(and(eq(notes.id, noteId), eq(notes.userId, userId)))
      .limit(1);

    if (!note) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Note not found' });
    }

    const existing = await this.db
      .select({ id: noteImages.id })
      .from(noteImages)
      .where(and(eq(noteImages.userId, userId), eq(noteImages.noteId, noteId)));

    if (existing.length >= 5) {
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: 'A note can have at most 5 images',
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
      .insert(noteImages)
      .values({
        userId,
        noteId,
        name: input.name,
        mimeType: input.mimeType,
        dataUrl: input.dataUrl,
        sizeBytes,
      })
      .returning();

    if (!created) throw new Error('Failed to add note image');

    await this.audit.log(
      {
        userId,
        action: 'note.image_added',
        entityType: 'note',
        entityId: noteId,
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
    noteId: string,
    imageId: string,
    meta: NoteMeta,
  ): Promise<void> {
    const [image] = await this.db
      .select()
      .from(noteImages)
      .where(
        and(
          eq(noteImages.id, imageId),
          eq(noteImages.userId, userId),
          eq(noteImages.noteId, noteId),
        ),
      )
      .limit(1);

    if (!image) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Note image not found' });
    }

    await this.db.delete(noteImages).where(eq(noteImages.id, image.id));

    await this.audit.log(
      {
        userId,
        action: 'note.image_removed',
        entityType: 'note',
        entityId: noteId,
        before: { imageId: image.id, name: image.name, sizeBytes: image.sizeBytes },
        ip: meta.ip,
        userAgent: meta.userAgent,
      },
      { strict: true },
    );
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

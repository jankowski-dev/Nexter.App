import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, gte, ilike, isNull, lt, lte, or, sql, type SQL } from 'drizzle-orm';
import { auditLog, type Database } from '@nexter/db';
import type { AuditEntry, AuditLogQuery, AuditLogResponse } from '@nexter/contracts';
import { DB } from '../../shared/db/db.module';
import { decodeCursor, encodeCursor, makePage } from '../../shared/pagination/cursor';

/**
 * Cursors are ISO strings (millisecond precision) while `timestamptz` stores
 * microseconds. Comparing raw columns would skip rows that share the cursor's
 * millisecond, so both ordering and predicate use the truncated expression.
 */
const createdAtMs = sql`date_trunc('milliseconds', ${auditLog.createdAt})`;

@Injectable()
export class AuditLogService {
  constructor(@Inject(DB) private readonly db: Database) {}

  async list(userId: string, query: AuditLogQuery): Promise<AuditLogResponse> {
    const conditions: SQL[] = [or(eq(auditLog.userId, userId), isNull(auditLog.userId))!];

    if (query.action) conditions.push(ilike(auditLog.action, `%${query.action}%`));
    if (query.entityType) conditions.push(eq(auditLog.entityType, query.entityType));
    if (query.from) conditions.push(gte(auditLog.createdAt, new Date(query.from)));
    if (query.to) conditions.push(lte(auditLog.createdAt, new Date(query.to)));
    if (query.cursor) {
      const cursor = decodeCursor<{ createdAt: string; id: string }>(query.cursor);

      if (
        typeof cursor.createdAt !== 'string' ||
        typeof cursor.id !== 'string' ||
        Number.isNaN(new Date(cursor.createdAt).getTime())
      ) {
        throw new BadRequestException({
          code: 'VALIDATION_ERROR',
          message: 'Invalid pagination cursor',
        });
      }

      const cursorDate = new Date(cursor.createdAt);
      conditions.push(
        or(
          lt(createdAtMs, cursorDate),
          and(eq(createdAtMs, cursorDate), lt(auditLog.id, cursor.id)),
        )!,
      );
    }

    const rows = await this.db
      .select()
      .from(auditLog)
      .where(and(...conditions))
      .orderBy(desc(createdAtMs), desc(auditLog.id))
      .limit(query.limit + 1);
    const page = makePage(rows, query.limit, (row) =>
      encodeCursor({ createdAt: row.createdAt.toISOString(), id: row.id }),
    );

    return {
      data: page.data.map((row) => this.toContract(row)),
      page: { nextCursor: page.nextCursor, hasMore: page.hasMore },
    };
  }

  private toContract(row: typeof auditLog.$inferSelect): AuditEntry {
    return {
      id: row.id,
      userId: row.userId,
      action: row.action,
      entityType: row.entityType,
      entityId: row.entityId,
      before: row.before,
      after: row.after,
      ip: row.ip,
      userAgent: row.userAgent,
      createdAt: row.createdAt.toISOString(),
    };
  }
}

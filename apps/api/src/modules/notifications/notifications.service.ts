import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { notifications, type Database, type NotificationRecord } from '@nexter/db';
import type {
  Notification,
  NotificationsClearResponse,
  NotificationsReadAllResponse,
  NotificationsResponse,
  NotificationUnreadCount,
} from '@nexter/contracts';
import { DB } from '../../shared/db/db.module';

export interface CreateNotificationInput {
  userId: string;
  type: string;
  title: string;
  body?: string;
  href?: string | null;
  payload?: Record<string, unknown>;
}

function toNotification(row: NotificationRecord): Notification {
  return {
    id: row.id,
    type: row.type,
    title: row.title,
    body: row.body,
    href: row.href,
    payload: row.payload,
    readAt: row.readAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

@Injectable()
export class NotificationsService {
  constructor(@Inject(DB) private readonly db: Database) {}

  async list(userId: string, limit: number): Promise<NotificationsResponse> {
    const notCleared = sql`coalesce(${notifications.payload}->>'cleared', 'false') <> 'true'`;
    const [rows, unreadCount] = await Promise.all([
      this.db
        .select()
        .from(notifications)
        .where(and(eq(notifications.userId, userId), notCleared))
        .orderBy(desc(notifications.createdAt))
        .limit(limit),
      this.unreadCountValue(userId),
    ]);

    return {
      data: rows.map(toNotification),
      unreadCount,
    };
  }

  async unreadCount(userId: string): Promise<NotificationUnreadCount> {
    return { count: await this.unreadCountValue(userId) };
  }

  async markAllRead(userId: string): Promise<NotificationsReadAllResponse> {
    const notCleared = sql`coalesce(${notifications.payload}->>'cleared', 'false') <> 'true'`;
    const updated = await this.db
      .update(notifications)
      .set({ readAt: new Date() })
      .where(and(eq(notifications.userId, userId), isNull(notifications.readAt), notCleared))
      .returning({ id: notifications.id });

    return { updated: updated.length };
  }

  async clear(userId: string): Promise<NotificationsClearResponse> {
    const updated = await this.db
      .update(notifications)
      .set({
        readAt: new Date(),
        payload: sql`${notifications.payload} || '{"cleared": true}'::jsonb`,
      })
      .where(
        and(
          eq(notifications.userId, userId),
          sql`coalesce(${notifications.payload}->>'cleared', 'false') <> 'true'`,
        ),
      )
      .returning({ id: notifications.id });

    return { cleared: updated.length };
  }

  async create(input: CreateNotificationInput): Promise<Notification> {
    const [created] = await this.db
      .insert(notifications)
      .values({
        userId: input.userId,
        type: input.type,
        title: input.title,
        body: input.body ?? '',
        href: input.href ?? null,
        payload: input.payload ?? {},
      })
      .returning();

    if (!created) throw new Error('Failed to create notification');
    return toNotification(created);
  }

  private async unreadCountValue(userId: string): Promise<number> {
    const [row] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(notifications)
      .where(
        and(
          eq(notifications.userId, userId),
          isNull(notifications.readAt),
          sql`coalesce(${notifications.payload}->>'cleared', 'false') <> 'true'`,
        ),
      );

    return Number(row?.count ?? 0);
  }
}

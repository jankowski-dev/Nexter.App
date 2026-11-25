import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, desc, eq, isNotNull, sql } from 'drizzle-orm';
import { users, viberNotifications, type Database, type ViberNotificationRecord } from '@nexter/db';
import type {
  ViberAckRequest,
  ViberAckResponse,
  ViberListResponse,
  ViberNotification,
  ViberPendingResponse,
  ViberStatusResponse,
  ViberTestResponse,
} from '@nexter/contracts';
import { AuditService } from '../../shared/audit/audit.service';
import { env } from '../../shared/config/env';
import { DB } from '../../shared/db/db.module';
import { SettingsService } from '../settings/settings.service';

export interface EnqueueViberInput {
  userId: string;
  type: string;
  title: string;
  body: string;
  payload?: Record<string, unknown>;
}

export function nextViberFailure(attempts: number): {
  attempts: number;
  status: 'pending' | 'failed';
} {
  const nextAttempts = attempts + 1;
  return {
    attempts: nextAttempts,
    status: nextAttempts >= 3 ? 'failed' : 'pending',
  };
}

function toContract(row: ViberNotificationRecord): ViberNotification {
  return {
    id: row.id,
    type: row.type,
    title: row.title,
    body: row.body,
    payload: row.payload,
    status: row.status as ViberNotification['status'],
    attempts: row.attempts,
    error: row.error,
    sentAt: row.sentAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

@Injectable()
export class ViberOutboxService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
  ) {}

  async enqueue(input: EnqueueViberInput): Promise<ViberNotification> {
    return this.insert(input, 'viber.enqueued');
  }

  async pendingForBot(limit = 50): Promise<ViberPendingResponse> {
    return this.pending(await this.ownerUserId(), limit);
  }

  async ackForBot(id: string, input: ViberAckRequest): Promise<ViberAckResponse> {
    return this.ack(await this.ownerUserId(), id, input);
  }

  async pending(userId: string, limit = 20): Promise<ViberPendingResponse> {
    const safeLimit = Math.min(Math.max(Math.trunc(limit), 1), 50);
    const rows = await this.db
      .select()
      .from(viberNotifications)
      .where(and(eq(viberNotifications.userId, userId), eq(viberNotifications.status, 'pending')))
      .orderBy(asc(viberNotifications.createdAt))
      .limit(safeLimit);
    const runtime = await this.settings.getRuntime();

    return {
      items: rows.map(toContract),
      frequency: runtime.viberFrequency,
      digestTime: runtime.viberDigestTime,
      timezone: runtime.timezone,
    };
  }

  async ack(userId: string, id: string, input: ViberAckRequest): Promise<ViberAckResponse> {
    const [existing] = await this.db
      .select()
      .from(viberNotifications)
      .where(and(eq(viberNotifications.userId, userId), eq(viberNotifications.id, id)))
      .limit(1);

    if (!existing) {
      throw new NotFoundException({
        code: 'VIBER_NOTIFICATION_NOT_FOUND',
        message: 'Viber notification not found',
      });
    }

    if (existing.status !== 'pending') {
      return { id: existing.id, status: existing.status as ViberAckResponse['status'] };
    }

    if (input.status === 'sent') {
      const row = await this.db.transaction(async (tx) => {
        const [updated] = await tx
          .update(viberNotifications)
          .set({
            status: 'sent',
            sentAt: new Date(),
            error: null,
            updatedAt: new Date(),
          })
          .where(eq(viberNotifications.id, id))
          .returning();

        if (!updated) throw new Error('Failed to acknowledge Viber notification');
        await this.audit.log(
          {
            userId,
            action: 'viber.acknowledged',
            entityType: 'viber_notification',
            entityId: updated.id,
            after: { status: updated.status, attempts: updated.attempts },
          },
          { executor: tx, strict: true },
        );
        return updated;
      });

      return { id: row.id, status: 'sent' };
    }

    const next = nextViberFailure(existing.attempts);
    const error = input.error ?? 'Viber delivery failed';
    const row = await this.db.transaction(async (tx) => {
      const [updated] = await tx
        .update(viberNotifications)
        .set({
          status: next.status,
          attempts: next.attempts,
          error,
          updatedAt: new Date(),
        })
        .where(eq(viberNotifications.id, id))
        .returning();

      if (!updated) throw new Error('Failed to acknowledge Viber notification');
      await this.audit.log(
        {
          userId,
          action: next.status === 'failed' ? 'viber.failed' : 'viber.delivery_failed',
          entityType: 'viber_notification',
          entityId: updated.id,
          after: { status: updated.status, attempts: updated.attempts, error },
        },
        { executor: tx, strict: true },
      );
      return updated;
    });

    return { id: row.id, status: row.status as ViberAckResponse['status'] };
  }

  async status(userId: string): Promise<ViberStatusResponse> {
    const [counts] = await this.db
      .select({
        pending: sql<number>`count(*) filter (where ${viberNotifications.status} = 'pending')::int`,
        sent24h: sql<number>`count(*) filter (where ${viberNotifications.status} = 'sent' and ${viberNotifications.sentAt} >= now() - interval '24 hours')::int`,
        failed24h: sql<number>`count(*) filter (where ${viberNotifications.status} = 'failed' and ${viberNotifications.updatedAt} >= now() - interval '24 hours')::int`,
        lastSentAt: sql<Date | null>`max(${viberNotifications.sentAt})`,
      })
      .from(viberNotifications)
      .where(eq(viberNotifications.userId, userId));

    const [lastFailure] = await this.db
      .select({ error: viberNotifications.error })
      .from(viberNotifications)
      .where(
        and(
          eq(viberNotifications.userId, userId),
          eq(viberNotifications.status, 'failed'),
          isNotNull(viberNotifications.error),
        ),
      )
      .orderBy(desc(viberNotifications.updatedAt))
      .limit(1);

    return {
      configured: Boolean(env.BOT_API_TOKEN),
      pending: Number(counts?.pending ?? 0),
      sent24h: Number(counts?.sent24h ?? 0),
      failed24h: Number(counts?.failed24h ?? 0),
      lastSentAt: counts?.lastSentAt ? new Date(counts.lastSentAt).toISOString() : null,
      lastError: lastFailure?.error ?? null,
    };
  }

  async list(userId: string, limit = 10): Promise<ViberListResponse> {
    const safeLimit = Math.min(Math.max(Math.trunc(limit), 1), 50);
    const rows = await this.db
      .select()
      .from(viberNotifications)
      .where(eq(viberNotifications.userId, userId))
      .orderBy(desc(viberNotifications.createdAt))
      .limit(safeLimit);

    return { data: rows.map(toContract) };
  }

  async test(userId: string): Promise<ViberTestResponse> {
    const created = await this.insert(
      {
        userId,
        type: 'viber_test',
        title: 'ViberBot',
        body: 'Тест доставки ViberBot ✅',
        payload: { test: true },
      },
      'viber.test_queued',
    );
    return { id: created.id };
  }

  private async ownerUserId(): Promise<string> {
    const [owner] = await this.db
      .select({ id: users.id })
      .from(users)
      .orderBy(asc(users.createdAt))
      .limit(1);
    if (!owner) {
      throw new NotFoundException({
        code: 'VIBER_OWNER_NOT_FOUND',
        message: 'Owner user not found',
      });
    }
    return owner.id;
  }

  private async insert(input: EnqueueViberInput, auditAction: string): Promise<ViberNotification> {
    const row = await this.db.transaction(async (tx) => {
      const [created] = await tx
        .insert(viberNotifications)
        .values({
          userId: input.userId,
          type: input.type,
          title: input.title,
          body: input.body,
          payload: input.payload ?? {},
        })
        .returning();

      if (!created) throw new Error('Failed to enqueue Viber notification');
      await this.audit.log(
        {
          userId: input.userId,
          action: auditAction,
          entityType: 'viber_notification',
          entityId: created.id,
          after: { type: created.type, title: created.title, status: created.status },
        },
        { executor: tx, strict: true },
      );
      return created;
    });

    return toContract(row);
  }
}

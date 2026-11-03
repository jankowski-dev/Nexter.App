import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, gt, isNull, ne } from 'drizzle-orm';
import { sessions, users, type Database, type DbExecutor, type Session } from '@nexter/db';
import { env } from '../../shared/config/env';
import { DB } from '../../shared/db/db.module';
import { CryptoService } from './crypto.service';
import type { AuthContext } from './auth.types';

export interface SessionTokens {
  token: string;
  csrfToken: string;
  session: Session;
}

export interface SessionMeta {
  ip?: string;
  userAgent?: string;
}

@Injectable()
export class SessionService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly crypto: CryptoService,
  ) {}

  async create(
    userId: string,
    data: { twoFactorVerified: boolean } & SessionMeta,
    executor: DbExecutor = this.db,
  ): Promise<SessionTokens> {
    const token = this.crypto.randomToken(32);
    const csrfToken = this.crypto.randomToken(32);
    const now = new Date();
    const expiresAt = new Date(now.getTime() + env.SESSION_TTL_DAYS * 86_400_000);

    const [session] = await executor
      .insert(sessions)
      .values({
        userId,
        tokenHash: this.crypto.sha256(token),
        csrfTokenHash: this.crypto.sha256(csrfToken),
        twoFactorVerified: data.twoFactorVerified,
        ip: data.ip,
        userAgent: data.userAgent,
        expiresAt,
        lastSeenAt: now,
      })
      .returning();

    if (!session) {
      throw new Error('Failed to create session');
    }

    return { token, csrfToken, session };
  }

  async resolve(rawToken: string, meta: SessionMeta): Promise<AuthContext | null> {
    const [row] = await this.db
      .select({ session: sessions, user: users })
      .from(sessions)
      .innerJoin(users, eq(sessions.userId, users.id))
      .where(eq(sessions.tokenHash, this.crypto.sha256(rawToken)))
      .limit(1);

    if (!row) return null;

    const { session, user } = row;
    const now = new Date();

    if (session.revokedAt || session.expiresAt <= now) {
      return null;
    }

    if (!session.lastSeenAt || now.getTime() - session.lastSeenAt.getTime() > 300_000) {
      await this.db
        .update(sessions)
        .set({
          lastSeenAt: now,
          ip: meta.ip ?? session.ip,
          userAgent: meta.userAgent ?? session.userAgent,
        })
        .where(eq(sessions.id, session.id));
    }

    return { user, session };
  }

  async rotate(
    oldSession: Session,
    data: { twoFactorVerified: boolean } & SessionMeta,
    executor: DbExecutor = this.db,
  ): Promise<SessionTokens> {
    await this.revoke(oldSession.id, executor);
    return this.create(oldSession.userId, data, executor);
  }

  async revoke(sessionId: string, executor: DbExecutor = this.db): Promise<void> {
    await executor
      .update(sessions)
      .set({ revokedAt: new Date() })
      .where(eq(sessions.id, sessionId));
  }

  async revokeOthers(
    userId: string,
    currentSessionId: string,
    executor: DbExecutor = this.db,
  ): Promise<void> {
    await executor
      .update(sessions)
      .set({ revokedAt: new Date() })
      .where(
        and(
          eq(sessions.userId, userId),
          ne(sessions.id, currentSessionId),
          isNull(sessions.revokedAt),
        ),
      );
  }

  async revokeAll(userId: string, executor: DbExecutor = this.db): Promise<void> {
    await executor
      .update(sessions)
      .set({ revokedAt: new Date() })
      .where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt)));
  }

  async list(userId: string) {
    return this.db
      .select()
      .from(sessions)
      .where(
        and(
          eq(sessions.userId, userId),
          isNull(sessions.revokedAt),
          gt(sessions.expiresAt, new Date()),
        ),
      )
      .orderBy(desc(sessions.createdAt));
  }
}

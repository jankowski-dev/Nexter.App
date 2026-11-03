import { HttpException, HttpStatus, Inject, Injectable } from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';
import { rateLimits, type Database } from '@nexter/db';
import { DB } from '../../shared/db/db.module';
import { AuditService } from '../../shared/audit/audit.service';

export interface ThrottleOptions {
  max: number;
  windowSeconds: number;
  blockSeconds: number;
}

export interface ThrottleMeta {
  ip?: string;
  userAgent?: string;
}

@Injectable()
export class AuthThrottleService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly audit: AuditService,
  ) {}

  async assertNotBlocked(key: string, meta: ThrottleMeta = {}): Promise<void> {
    const [row] = await this.db.select().from(rateLimits).where(eq(rateLimits.key, key)).limit(1);

    if (row?.blockedUntil && row.blockedUntil > new Date()) {
      await this.audit.log({
        action: 'auth.rate_limited',
        entityType: 'rate_limit',
        entityId: key,
        after: { key },
        ip: meta.ip,
        userAgent: meta.userAgent,
      });
      throw new HttpException(
        { code: 'RATE_LIMITED', message: 'Too many attempts. Try again later.' },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  async hit(key: string, options: ThrottleOptions, meta: ThrottleMeta = {}): Promise<void> {
    const now = new Date();
    const windowStart = new Date(now.getTime() - options.windowSeconds * 1000);
    const blockedUntil = new Date(now.getTime() + options.blockSeconds * 1000);

    const reset = sql`((${rateLimits.blockedUntil} is null or ${rateLimits.blockedUntil} <= ${now}::timestamptz) and ((${rateLimits.blockedUntil} is not null and ${rateLimits.blockedUntil} <= ${now}::timestamptz) or ${rateLimits.windowStartedAt} < ${windowStart}::timestamptz))`;
    const nextPoints = sql`(case when ${reset} then 1 else ${rateLimits.points} + 1 end)`;

    const [row] = await this.db
      .insert(rateLimits)
      .values({
        key,
        points: 1,
        windowStartedAt: now,
        blockedUntil: null,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: rateLimits.key,
        set: {
          points: nextPoints,
          windowStartedAt: sql`case when ${reset} then ${now}::timestamptz else ${rateLimits.windowStartedAt} end`,
          blockedUntil: sql`case when ${nextPoints} >= ${options.max} then ${blockedUntil}::timestamptz else null::timestamptz end`,
          updatedAt: now,
        },
      })
      .returning({ points: rateLimits.points, blockedUntil: rateLimits.blockedUntil });

    if (row?.blockedUntil && row.blockedUntil > now) {
      await this.audit.log({
        action: 'auth.rate_limited',
        entityType: 'rate_limit',
        entityId: key,
        after: { key, points: row.points },
        ip: meta.ip,
        userAgent: meta.userAgent,
      });
      throw new HttpException(
        { code: 'RATE_LIMITED', message: 'Too many attempts. Try again later.' },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  async reset(key: string): Promise<void> {
    await this.db.delete(rateLimits).where(eq(rateLimits.key, key));
  }
}

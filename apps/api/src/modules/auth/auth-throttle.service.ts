import { HttpException, HttpStatus, Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { rateLimits, type Database } from '@nexter/db';
import { DB } from '../../shared/db/db.module';

export interface ThrottleOptions {
  max: number;
  windowSeconds: number;
  blockSeconds: number;
}

@Injectable()
export class AuthThrottleService {
  constructor(@Inject(DB) private readonly db: Database) {}

  async assertNotBlocked(key: string): Promise<void> {
    const [row] = await this.db.select().from(rateLimits).where(eq(rateLimits.key, key)).limit(1);

    if (row?.blockedUntil && row.blockedUntil > new Date()) {
      throw new HttpException(
        { code: 'RATE_LIMITED', message: 'Too many attempts. Try again later.' },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  async hit(key: string, options: ThrottleOptions): Promise<void> {
    const now = new Date();
    const windowStart = new Date(now.getTime() - options.windowSeconds * 1000);
    const [row] = await this.db.select().from(rateLimits).where(eq(rateLimits.key, key)).limit(1);

    if (!row || row.windowStartedAt < windowStart) {
      await this.db
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
            points: 1,
            windowStartedAt: now,
            blockedUntil: null,
            updatedAt: now,
          },
        });
      return;
    }

    const points = row.points + 1;
    const blockedUntil =
      points >= options.max ? new Date(now.getTime() + options.blockSeconds * 1000) : null;

    await this.db
      .update(rateLimits)
      .set({ points, blockedUntil, updatedAt: now })
      .where(eq(rateLimits.key, key));

    if (blockedUntil) {
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

import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { portfolioSnapshots, settings as settingsTable, users, type Database } from '@nexter/db';
import type { PortfolioSnapshot } from '@nexter/contracts';
import { AuditService } from '../../shared/audit/audit.service';
import { env } from '../../shared/config/env';
import { DB } from '../../shared/db/db.module';
import { decimal, usdString } from '../../shared/money/decimal';
import { ReportingService } from './reporting.service';

@Injectable()
export class PortfolioSnapshotService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(PortfolioSnapshotService.name);
  private timer: NodeJS.Timeout | null = null;

  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly reporting: ReportingService,
    private readonly audit: AuditService,
  ) {}

  onApplicationBootstrap(): void {
    if (!env.PORTFOLIO_SNAPSHOTS_ENABLED || env.NODE_ENV === 'test') return;

    this.timer = setInterval(() => {
      void this.captureAll();
    }, env.PORTFOLIO_SNAPSHOT_INTERVAL_SECONDS * 1000);
    this.timer.unref();

    void this.captureAll();
  }

  onApplicationShutdown(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async capture(userId: string): Promise<PortfolioSnapshot> {
    const positions = await this.reporting.positions(userId);
    const [settingsRow] = await this.db
      .select({ timezone: settingsTable.timezone })
      .from(settingsTable)
      .where(eq(settingsTable.userId, userId))
      .limit(1);
    const timezone = this.validTimezone(settingsRow?.timezone ?? 'Europe/Minsk');
    const snapshotDate = new Intl.DateTimeFormat('en-CA', { timeZone: timezone }).format(
      new Date(),
    );
    const capturedAt = new Date();

    const [row] = await this.db
      .insert(portfolioSnapshots)
      .values({
        userId,
        snapshotDate,
        cashUsd: usdString(decimal(positions.cashUsd)),
        positionsValueUsd: usdString(decimal(positions.positionsValueUsd)),
        equityUsd: usdString(decimal(positions.equityUsd)),
        capturedAt,
      })
      .onConflictDoUpdate({
        target: [portfolioSnapshots.userId, portfolioSnapshots.snapshotDate],
        set: {
          cashUsd: usdString(decimal(positions.cashUsd)),
          positionsValueUsd: usdString(decimal(positions.positionsValueUsd)),
          equityUsd: usdString(decimal(positions.equityUsd)),
          capturedAt,
        },
      })
      .returning();

    if (!row) throw new Error('Failed to persist portfolio snapshot');

    await this.audit.log(
      {
        userId,
        action: 'accounting.portfolio_snapshot',
        entityType: 'portfolio_snapshot',
        entityId: row.id,
        after: {
          snapshotDate: row.snapshotDate,
          cashUsd: row.cashUsd,
          positionsValueUsd: row.positionsValueUsd,
          equityUsd: row.equityUsd,
        },
      },
      { strict: true },
    );

    return {
      snapshotDate: row.snapshotDate,
      cashUsd: row.cashUsd,
      positionsValueUsd: row.positionsValueUsd,
      equityUsd: row.equityUsd,
      capturedAt: row.capturedAt.toISOString(),
    };
  }

  async captureAll(): Promise<void> {
    const userRows = await this.db.select({ id: users.id }).from(users);

    for (const user of userRows) {
      try {
        await this.capture(user.id);
      } catch (error) {
        this.logger.warn(
          `Portfolio snapshot failed for ${user.id}: ${
            error instanceof Error ? error.message : 'unknown error'
          }`,
        );
      }
    }
  }

  private validTimezone(value: string): string {
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: value }).format();
      return value;
    } catch {
      return 'Europe/Minsk';
    }
  }
}

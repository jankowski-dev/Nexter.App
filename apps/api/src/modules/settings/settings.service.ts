import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { settings, type Database } from '@nexter/db';
import type { Settings, UpdateSettingsRequest } from '@nexter/contracts';
import { AuditService } from '../../shared/audit/audit.service';
import { DB } from '../../shared/db/db.module';

interface SettingsMeta {
  ip?: string;
  userAgent?: string;
}

@Injectable()
export class SettingsService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly audit: AuditService,
  ) {}

  async get(userId: string): Promise<Settings> {
    const [row] = await this.db.select().from(settings).where(eq(settings.userId, userId)).limit(1);

    if (row) return this.toContract(row);

    const [created] = await this.db
      .insert(settings)
      .values({ userId })
      .onConflictDoNothing()
      .returning();

    if (created) return this.toContract(created);

    const [existing] = await this.db
      .select()
      .from(settings)
      .where(eq(settings.userId, userId))
      .limit(1);

    if (!existing) throw new Error('Failed to create settings');
    return this.toContract(existing);
  }

  async update(
    userId: string,
    input: UpdateSettingsRequest,
    meta: SettingsMeta,
  ): Promise<Settings> {
    if (input.timezone !== undefined) {
      try {
        new Intl.DateTimeFormat('en-US', { timeZone: input.timezone }).format();
      } catch {
        throw new BadRequestException({
          code: 'VALIDATION_ERROR',
          message: 'Invalid timezone',
        });
      }
    }

    const before = await this.get(userId);

    await this.db.transaction(async (tx) => {
      await tx
        .update(settings)
        .set({
          includeGasInCostBasis:
            input.includeGasInCostBasis !== undefined
              ? input.includeGasInCostBasis
              : before.includeGasInCostBasis,
          timezone: input.timezone !== undefined ? input.timezone : before.timezone,
          updatedAt: new Date(),
        })
        .where(eq(settings.userId, userId));

      await this.audit.log(
        {
          userId,
          action: 'settings.updated',
          entityType: 'settings',
          entityId: userId,
          before,
          after: input,
          ip: meta.ip,
          userAgent: meta.userAgent,
        },
        { executor: tx, strict: true },
      );
    });

    return this.get(userId);
  }

  private toContract(row: typeof settings.$inferSelect): Settings {
    return {
      baseCurrency: row.baseCurrency,
      displayCurrency: row.displayCurrency,
      taxMethod: row.taxMethod,
      includeGasInCostBasis: row.includeGasInCostBasis,
      timezone: row.timezone,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}

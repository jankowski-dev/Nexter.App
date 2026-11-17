import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { settings, type Database } from '@nexter/db';
import {
  AUDIO_MAX_MB_DEFAULT,
  clampAudioMaxMb,
  type Settings,
  type UpdateSettingsRequest,
} from '@nexter/contracts';
import { AuditService } from '../../shared/audit/audit.service';
import { DB } from '../../shared/db/db.module';

interface SettingsMeta {
  ip?: string;
  userAgent?: string;
}

@Injectable()
export class SettingsService {
  private ownerAudioMaxMb: { value: number; expiresAt: number } | null = null;

  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly audit: AuditService,
  ) {}

  async get(userId: string): Promise<Settings> {
    const [row] = await this.db.select().from(settings).where(eq(settings.userId, userId)).limit(1);

    if (row) return this.toContract(row);

    return this.db.transaction(async (tx) => {
      const [created] = await tx
        .insert(settings)
        .values({ userId })
        .onConflictDoNothing()
        .returning();

      if (!created) {
        const [existing] = await tx
          .select()
          .from(settings)
          .where(eq(settings.userId, userId))
          .limit(1);

        if (!existing) throw new Error('Failed to create settings');
        return this.toContract(existing);
      }

      const contract = this.toContract(created);
      await this.audit.log(
        {
          userId,
          action: 'settings.created',
          entityType: 'settings',
          entityId: userId,
          after: contract,
        },
        { executor: tx, strict: true },
      );

      return contract;
    });
  }

  /**
   * Single-owner app: the bot endpoint has no user session, so it reads the
   * owner's row directly. Missing rows fall back to the contract default. The
   * short cache avoids a query on every request while `update` invalidates it.
   */
  async getOwnerAudioMaxMb(): Promise<number> {
    const now = Date.now();
    if (this.ownerAudioMaxMb && this.ownerAudioMaxMb.expiresAt > now) {
      return this.ownerAudioMaxMb.value;
    }

    const [row] = await this.db.select({ audioMaxMb: settings.audioMaxMb }).from(settings).limit(1);
    const value = clampAudioMaxMb(row?.audioMaxMb ?? AUDIO_MAX_MB_DEFAULT);
    this.ownerAudioMaxMb = { value, expiresAt: now + 30_000 };
    return value;
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
          audioMaxMb:
            input.audioMaxMb !== undefined ? clampAudioMaxMb(input.audioMaxMb) : before.audioMaxMb,
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

    this.ownerAudioMaxMb = null;
    return this.get(userId);
  }

  private toContract(row: typeof settings.$inferSelect): Settings {
    return {
      baseCurrency: row.baseCurrency,
      displayCurrency: row.displayCurrency,
      taxMethod: row.taxMethod,
      includeGasInCostBasis: row.includeGasInCostBasis,
      timezone: row.timezone,
      audioMaxMb: clampAudioMaxMb(row.audioMaxMb),
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}

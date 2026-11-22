import {
  BadRequestException,
  Inject,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { aiProfiles, aiSettings, type AiSettingsRecord, type Database } from '@nexter/db';
import {
  readAiCycleLimit,
  withAiCycleLimit,
  type AiCycleLimit,
  type AiSettings,
  type UpdateAiSettingsRequest,
} from '@nexter/contracts';
import { AuditService } from '../../shared/audit/audit.service';
import { DB } from '../../shared/db/db.module';
import { DEFAULT_AI_MODEL_SETTINGS } from '../../shared/ai/ai-profile-defaults';
import { CryptoService } from '../auth/crypto.service';

const DEFAULTS = {
  enabled: false,
  provider: 'deepseek' as const,
  model: 'deepseek-flash',
  reasoning: 'fast' as const,
  temperature: 0.3,
  maxTokens: 2000,
  fallbackToRaw: true,
};

function toContract(row: AiSettingsRecord | null, modelSettings: unknown): AiSettings {
  return {
    enabled: row?.enabled ?? DEFAULTS.enabled,
    provider: (row?.provider as AiSettings['provider'] | undefined) ?? DEFAULTS.provider,
    model: row?.model ?? DEFAULTS.model,
    reasoning: (row?.reasoning as AiSettings['reasoning'] | undefined) ?? DEFAULTS.reasoning,
    temperature: row ? Number(row.temperature) : DEFAULTS.temperature,
    maxTokens: row?.maxTokens ?? DEFAULTS.maxTokens,
    fallbackToRaw: row?.fallbackToRaw ?? DEFAULTS.fallbackToRaw,
    cycleLimit: readAiCycleLimit(modelSettings),
    hasApiKey: Boolean(row?.apiKeyEncrypted),
    updatedAt: (row?.updatedAt ?? new Date()).toISOString(),
  };
}

@Injectable()
export class AiSettingsService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly crypto: CryptoService,
    private readonly audit: AuditService,
  ) {}

  async get(userId: string): Promise<AiSettings> {
    const [row, profile] = await Promise.all([this.row(userId), this.profileRow(userId)]);
    return toContract(row, profile?.modelSettings);
  }

  async update(userId: string, input: UpdateAiSettingsRequest): Promise<AiSettings> {
    if (input.apiKey && input.clearApiKey) {
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: 'Нельзя одновременно задать и удалить ключ',
      });
    }

    const [existing, profile] = await Promise.all([this.row(userId), this.profileRow(userId)]);
    const apiKeyEncrypted =
      input.apiKey !== undefined
        ? this.crypto.encryptSecret(input.apiKey)
        : input.clearApiKey
          ? null
          : (existing?.apiKeyEncrypted ?? null);
    const values = {
      enabled: input.enabled ?? existing?.enabled ?? DEFAULTS.enabled,
      provider: input.provider ?? existing?.provider ?? DEFAULTS.provider,
      model: input.model ?? existing?.model ?? DEFAULTS.model,
      reasoning: input.reasoning ?? existing?.reasoning ?? DEFAULTS.reasoning,
      temperature: String(input.temperature ?? existing?.temperature ?? DEFAULTS.temperature),
      maxTokens: input.maxTokens ?? existing?.maxTokens ?? DEFAULTS.maxTokens,
      fallbackToRaw: input.fallbackToRaw ?? existing?.fallbackToRaw ?? DEFAULTS.fallbackToRaw,
      apiKeyEncrypted,
      updatedAt: new Date(),
    };

    const [row] = existing
      ? await this.db
          .update(aiSettings)
          .set(values)
          .where(eq(aiSettings.userId, userId))
          .returning()
      : await this.db
          .insert(aiSettings)
          .values({ userId, ...values })
          .returning();

    if (!row) throw new Error('Failed to save AI settings');

    const updatedProfile =
      input.cycleLimit !== undefined
        ? await this.saveCycleLimit(userId, input.cycleLimit)
        : profile;

    await this.audit.log(
      {
        userId,
        action: 'ai.settings_updated',
        entityType: 'ai_settings',
        entityId: userId,
        before: existing
          ? {
              enabled: existing.enabled,
              provider: existing.provider,
              model: existing.model,
              reasoning: existing.reasoning,
              cycleLimit: readAiCycleLimit(profile?.modelSettings),
              hasApiKey: Boolean(existing.apiKeyEncrypted),
            }
          : null,
        after: {
          enabled: row.enabled,
          provider: row.provider,
          model: row.model,
          reasoning: row.reasoning,
          cycleLimit: readAiCycleLimit(updatedProfile?.modelSettings),
          hasApiKey: Boolean(row.apiKeyEncrypted),
          keyChanged: input.apiKey !== undefined || input.clearApiKey === true,
        },
      },
      { strict: true },
    );

    return toContract(row, updatedProfile?.modelSettings);
  }

  async requireKey(userId: string): Promise<{ settings: AiSettings; apiKey: string }> {
    const row = await this.row(userId);
    const settings = toContract(row, null);
    if (!settings.enabled) {
      throw new ServiceUnavailableException({
        code: 'AI_NOT_CONFIGURED',
        message: 'ИИ отключён в настройках',
      });
    }
    if (!row?.apiKeyEncrypted) {
      throw new ServiceUnavailableException({
        code: 'AI_NOT_CONFIGURED',
        message: 'Не задан API-ключ ИИ',
      });
    }

    try {
      return { settings, apiKey: this.crypto.decryptSecret(row.apiKeyEncrypted) };
    } catch {
      throw new ServiceUnavailableException({
        code: 'AI_NOT_CONFIGURED',
        message: 'Не удалось расшифровать API-ключ ИИ',
      });
    }
  }

  async fallbackToRaw(userId: string): Promise<boolean> {
    const row = await this.row(userId);
    return toContract(row, null).fallbackToRaw;
  }

  private async saveCycleLimit(
    userId: string,
    cycleLimit: AiCycleLimit,
  ): Promise<typeof aiProfiles.$inferSelect> {
    const existing = await this.profileRow(userId);
    if (!existing) {
      const [created] = await this.db
        .insert(aiProfiles)
        .values({
          userId,
          modelSettings: withAiCycleLimit(DEFAULT_AI_MODEL_SETTINGS, cycleLimit),
        })
        .onConflictDoNothing()
        .returning();
      if (created) return created;
    }

    const current = existing ?? (await this.profileRow(userId));
    if (!current) throw new Error('Failed to save AI cycle limit');

    const [updated] = await this.db
      .update(aiProfiles)
      .set({
        modelSettings: withAiCycleLimit(current.modelSettings, cycleLimit),
        updatedAt: new Date(),
      })
      .where(eq(aiProfiles.userId, userId))
      .returning();
    if (!updated) throw new Error('Failed to save AI cycle limit');
    return updated;
  }

  private async row(userId: string): Promise<AiSettingsRecord | null> {
    const [row] = await this.db
      .select()
      .from(aiSettings)
      .where(eq(aiSettings.userId, userId))
      .limit(1);
    return row ?? null;
  }

  private async profileRow(userId: string): Promise<typeof aiProfiles.$inferSelect | null> {
    const [row] = await this.db
      .select()
      .from(aiProfiles)
      .where(eq(aiProfiles.userId, userId))
      .limit(1);
    return row ?? null;
  }
}

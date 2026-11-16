import {
  BadRequestException,
  Inject,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { aiSettings, type AiSettingsRecord, type Database } from '@nexter/db';
import type { AiSettings, UpdateAiSettingsRequest } from '@nexter/contracts';
import { AuditService } from '../../shared/audit/audit.service';
import { DB } from '../../shared/db/db.module';
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

function toContract(row: AiSettingsRecord | null): AiSettings {
  return {
    enabled: row?.enabled ?? DEFAULTS.enabled,
    provider: (row?.provider as AiSettings['provider'] | undefined) ?? DEFAULTS.provider,
    model: row?.model ?? DEFAULTS.model,
    reasoning: (row?.reasoning as AiSettings['reasoning'] | undefined) ?? DEFAULTS.reasoning,
    temperature: row ? Number(row.temperature) : DEFAULTS.temperature,
    maxTokens: row?.maxTokens ?? DEFAULTS.maxTokens,
    fallbackToRaw: row?.fallbackToRaw ?? DEFAULTS.fallbackToRaw,
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
    return toContract(await this.row(userId));
  }

  async update(userId: string, input: UpdateAiSettingsRequest): Promise<AiSettings> {
    if (input.apiKey && input.clearApiKey) {
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: 'Нельзя одновременно задать и удалить ключ',
      });
    }

    const existing = await this.row(userId);
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
              hasApiKey: Boolean(existing.apiKeyEncrypted),
            }
          : null,
        after: {
          enabled: row.enabled,
          provider: row.provider,
          model: row.model,
          reasoning: row.reasoning,
          hasApiKey: Boolean(row.apiKeyEncrypted),
          keyChanged: input.apiKey !== undefined || input.clearApiKey === true,
        },
      },
      { strict: true },
    );

    return toContract(row);
  }

  async requireKey(userId: string): Promise<{ settings: AiSettings; apiKey: string }> {
    const row = await this.row(userId);
    const settings = toContract(row);
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
    return toContract(row).fallbackToRaw;
  }

  private async row(userId: string): Promise<AiSettingsRecord | null> {
    const [row] = await this.db
      .select()
      .from(aiSettings)
      .where(eq(aiSettings.userId, userId))
      .limit(1);
    return row ?? null;
  }
}

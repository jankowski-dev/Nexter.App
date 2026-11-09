import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, desc, eq, isNull } from 'drizzle-orm';
import {
  vaultConfigs,
  vaultItems,
  type Database,
  type VaultConfig,
  type VaultItem,
} from '@nexter/db';
import type {
  VaultConfig as VaultConfigContract,
  VaultInitializeRequest,
  VaultItem as VaultItemContract,
  VaultItemCreateRequest,
  VaultItemUpdateRequest,
  VaultQuery,
  VaultResponse,
} from '@nexter/contracts';
import { AuditService } from '../../shared/audit/audit.service';
import { DB } from '../../shared/db/db.module';

interface VaultMeta {
  ip?: string;
  userAgent?: string;
}

function isUniqueViolation(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const candidate = error as { code?: string; cause?: { code?: string } };
  return candidate.code === '23505' || candidate.cause?.code === '23505';
}

function toConfigContract(row: VaultConfig): VaultConfigContract {
  return {
    salt: row.salt,
    iterations: row.iterations,
    wrappedKey: row.wrappedKey,
    wrappedKeyIv: row.wrappedKeyIv,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toItemContract(row: VaultItem): VaultItemContract {
  return {
    id: row.id,
    ciphertext: row.ciphertext,
    iv: row.iv,
    archivedAt: row.archivedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

@Injectable()
export class VaultService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly audit: AuditService,
  ) {}

  async get(userId: string, query: VaultQuery): Promise<VaultResponse> {
    const [config] = await this.db
      .select()
      .from(vaultConfigs)
      .where(eq(vaultConfigs.userId, userId))
      .limit(1);
    const rows = config
      ? await this.db
          .select()
          .from(vaultItems)
          .where(
            query.includeArchived
              ? eq(vaultItems.userId, userId)
              : and(eq(vaultItems.userId, userId), isNull(vaultItems.archivedAt)),
          )
          .orderBy(desc(vaultItems.updatedAt))
          .limit(500)
      : [];

    return {
      config: config ? toConfigContract(config) : null,
      items: rows.map(toItemContract),
    };
  }

  async initialize(
    userId: string,
    input: VaultInitializeRequest,
    meta: VaultMeta,
  ): Promise<VaultConfigContract> {
    const [existing] = await this.db
      .select({ id: vaultConfigs.id })
      .from(vaultConfigs)
      .where(eq(vaultConfigs.userId, userId))
      .limit(1);

    if (existing) {
      throw new ConflictException({
        code: 'CONFLICT',
        message: 'Vault is already initialized',
      });
    }

    let created: VaultConfig | undefined;

    try {
      [created] = await this.db
        .insert(vaultConfigs)
        .values({
          userId,
          salt: input.salt,
          iterations: input.iterations,
          wrappedKey: input.wrappedKey,
          wrappedKeyIv: input.wrappedKeyIv,
        })
        .returning();
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException({
          code: 'CONFLICT',
          message: 'Vault is already initialized',
        });
      }
      throw error;
    }

    if (!created) throw new Error('Failed to initialize vault');

    await this.audit.log(
      {
        userId,
        action: 'vault.initialized',
        entityType: 'vault',
        entityId: created.id,
        after: { iterations: created.iterations },
        ip: meta.ip,
        userAgent: meta.userAgent,
      },
      { strict: true },
    );

    return toConfigContract(created);
  }

  async createItem(
    userId: string,
    input: VaultItemCreateRequest,
    meta: VaultMeta,
  ): Promise<VaultItemContract> {
    await this.requireConfig(userId);
    const [created] = await this.db
      .insert(vaultItems)
      .values({ userId, ciphertext: input.ciphertext, iv: input.iv })
      .returning();

    if (!created) throw new Error('Failed to create vault item');

    await this.audit.log(
      {
        userId,
        action: 'vault.item_created',
        entityType: 'vault_item',
        entityId: created.id,
        after: { archivedAt: null },
        ip: meta.ip,
        userAgent: meta.userAgent,
      },
      { strict: true },
    );

    return toItemContract(created);
  }

  async updateItem(
    userId: string,
    id: string,
    input: VaultItemUpdateRequest,
    meta: VaultMeta,
  ): Promise<VaultItemContract> {
    const [existing] = await this.db
      .select()
      .from(vaultItems)
      .where(and(eq(vaultItems.id, id), eq(vaultItems.userId, userId)))
      .limit(1);

    if (!existing) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Vault item not found' });
    }

    if ((input.ciphertext === undefined) !== (input.iv === undefined)) {
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: 'ciphertext and iv must be provided together',
      });
    }

    const archivedAt =
      input.archived === undefined ? existing.archivedAt : input.archived ? new Date() : null;
    const [updated] = await this.db
      .update(vaultItems)
      .set({
        ...(input.ciphertext !== undefined && input.iv !== undefined
          ? { ciphertext: input.ciphertext, iv: input.iv }
          : {}),
        archivedAt,
        updatedAt: new Date(),
      })
      .where(eq(vaultItems.id, id))
      .returning();

    if (!updated) throw new Error('Failed to update vault item');

    await this.audit.log(
      {
        userId,
        action: 'vault.item_updated',
        entityType: 'vault_item',
        entityId: id,
        before: { archivedAt: existing.archivedAt?.toISOString() ?? null },
        after: {
          archivedAt: updated.archivedAt?.toISOString() ?? null,
          contentChanged: input.ciphertext !== undefined,
        },
        ip: meta.ip,
        userAgent: meta.userAgent,
      },
      { strict: true },
    );

    return toItemContract(updated);
  }

  private async requireConfig(userId: string): Promise<VaultConfig> {
    const [config] = await this.db
      .select()
      .from(vaultConfigs)
      .where(eq(vaultConfigs.userId, userId))
      .limit(1);

    if (!config) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Vault is not initialized' });
    }

    return config;
  }
}

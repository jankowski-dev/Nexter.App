import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, asc, desc, eq, ilike, inArray, isNull, lt, ne, or, sql } from 'drizzle-orm';
import {
  assets,
  auditLog,
  chains,
  importRows,
  imports,
  prices,
  watchlist,
  watchlistGroups,
  type Database,
} from '@nexter/db';
import type {
  WatchlistCreateRequest,
  WatchlistEntry,
  WatchlistFromContractRequest,
  WatchlistGroup,
  WatchlistGroupCreateRequest,
  WatchlistGroupUpdateRequest,
  WatchlistGroupsResponse,
  WatchlistListQuery,
  WatchlistResponse,
  WatchlistTokenSearchQuery,
  WatchlistTokenSearchResult,
  WatchlistUpdateRequest,
} from '@nexter/contracts';
import { AuditService } from '../../shared/audit/audit.service';
import { DB } from '../../shared/db/db.module';
import { decimal } from '../../shared/money/decimal';
import { decodeCursor, encodeCursor, isUuid, makePage } from '../../shared/pagination/cursor';
import type { CoinGeckoMarket } from '../market-data/coingecko.client';
import { MarketDataService } from '../market-data/market-data.service';

interface WatchlistMeta {
  ip?: string;
  userAgent?: string;
}

interface SourceImportData {
  symbol?: unknown;
  description?: unknown;
  raw?: unknown;
}

/**
 * Cursors carry millisecond ISO dates; `timestamptz` stores microseconds.
 * Use the same truncated expression for ordering and the page predicate.
 */
const createdAtMs = sql`date_trunc('milliseconds', ${watchlist.createdAt})`;

@Injectable()
export class WatchlistService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly audit: AuditService,
    private readonly marketData: MarketDataService,
  ) {}

  async listGroups(userId: string): Promise<WatchlistGroupsResponse> {
    await this.ensureDefaultGroup(userId);

    const rows = await this.db
      .select({
        group: watchlistGroups,
        entryCount: sql<number>`count(${watchlist.id})::int`,
      })
      .from(watchlistGroups)
      .leftJoin(
        watchlist,
        and(eq(watchlist.groupId, watchlistGroups.id), isNull(watchlist.archivedAt)),
      )
      .where(eq(watchlistGroups.userId, userId))
      .groupBy(watchlistGroups.id)
      .orderBy(asc(watchlistGroups.sortOrder), asc(watchlistGroups.name));

    return {
      groups: rows.map((row) => this.toGroupContract(row.group, Number(row.entryCount))),
    };
  }

  async createGroup(
    userId: string,
    input: WatchlistGroupCreateRequest,
    meta: WatchlistMeta,
  ): Promise<WatchlistGroup> {
    await this.ensureDefaultGroup(userId);

    const [maxRow] = await this.db
      .select({ max: sql<number>`coalesce(max(${watchlistGroups.sortOrder}), 0)::int` })
      .from(watchlistGroups)
      .where(eq(watchlistGroups.userId, userId));
    const sortOrder = input.sortOrder ?? Number(maxRow?.max ?? 0) + 1;

    const [created] = await this.db
      .insert(watchlistGroups)
      .values({
        userId,
        name: input.name,
        sortOrder,
        isDefault: false,
      })
      .onConflictDoNothing({ target: [watchlistGroups.userId, watchlistGroups.name] })
      .returning();

    if (!created) {
      throw new ConflictException({
        code: 'CONFLICT',
        message: 'A watchlist group with this name already exists',
      });
    }

    await this.audit.log(
      {
        userId,
        action: 'watchlist.group_created',
        entityType: 'watchlist_group',
        entityId: created.id,
        after: { name: created.name, sortOrder: created.sortOrder },
        ip: meta.ip,
        userAgent: meta.userAgent,
      },
      { strict: true },
    );

    return this.toGroupContract(created, 0);
  }

  async updateGroup(
    userId: string,
    id: string,
    input: WatchlistGroupUpdateRequest,
    meta: WatchlistMeta,
  ): Promise<WatchlistGroup> {
    const existing = await this.requireGroup(userId, id);

    if (input.name && input.name !== existing.name) {
      const [duplicate] = await this.db
        .select({ id: watchlistGroups.id })
        .from(watchlistGroups)
        .where(
          and(
            eq(watchlistGroups.userId, userId),
            eq(watchlistGroups.name, input.name),
            ne(watchlistGroups.id, id),
          ),
        )
        .limit(1);

      if (duplicate) {
        throw new ConflictException({
          code: 'CONFLICT',
          message: 'A watchlist group with this name already exists',
        });
      }
    }

    const [updated] = await this.db
      .update(watchlistGroups)
      .set({
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}),
        updatedAt: new Date(),
      })
      .where(and(eq(watchlistGroups.id, id), eq(watchlistGroups.userId, userId)))
      .returning();

    if (!updated) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Watchlist group not found' });
    }

    await this.audit.log(
      {
        userId,
        action: 'watchlist.group_updated',
        entityType: 'watchlist_group',
        entityId: id,
        before: { name: existing.name, sortOrder: existing.sortOrder },
        after: { name: updated.name, sortOrder: updated.sortOrder },
        ip: meta.ip,
        userAgent: meta.userAgent,
      },
      { strict: true },
    );

    const [countRow] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(watchlist)
      .where(and(eq(watchlist.groupId, id), isNull(watchlist.archivedAt)));

    return this.toGroupContract(updated, Number(countRow?.count ?? 0));
  }

  async deleteGroup(userId: string, id: string, meta: WatchlistMeta): Promise<void> {
    const existing = await this.requireGroup(userId, id);

    if (existing.isDefault) {
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: 'The default watchlist group cannot be deleted',
      });
    }

    const defaultGroup = await this.ensureDefaultGroup(userId);

    await this.db.transaction(async (tx) => {
      await tx
        .update(watchlist)
        .set({ groupId: defaultGroup.id, updatedAt: new Date() })
        .where(and(eq(watchlist.userId, userId), eq(watchlist.groupId, id)));

      await tx
        .delete(watchlistGroups)
        .where(and(eq(watchlistGroups.id, id), eq(watchlistGroups.userId, userId)));

      await this.audit.log(
        {
          userId,
          action: 'watchlist.group_deleted',
          entityType: 'watchlist_group',
          entityId: id,
          before: { name: existing.name, sortOrder: existing.sortOrder },
          after: { movedToGroupId: defaultGroup.id },
          ip: meta.ip,
          userAgent: meta.userAgent,
        },
        { executor: tx, strict: true },
      );
    });
  }

  async searchToken(
    userId: string,
    query: WatchlistTokenSearchQuery,
  ): Promise<WatchlistTokenSearchResult> {
    return this.marketData.search(userId, query.chain, query.address);
  }

  async fetchIcon(url: string): Promise<{ body: Buffer; contentType: string }> {
    return this.marketData.fetchIcon(url);
  }

  async fromContract(
    userId: string,
    input: WatchlistFromContractRequest,
    meta: WatchlistMeta,
  ): Promise<WatchlistEntry> {
    const group = input.groupId
      ? await this.requireGroup(userId, input.groupId)
      : await this.ensureDefaultGroup(userId);
    const { asset } = await this.marketData.ensureAsset(userId, input.chain, input.address);

    return this.create(
      userId,
      {
        assetId: asset.id,
        groupId: group.id,
        thesis: input.thesis ?? null,
        tags: input.tags ?? [],
        twitterUrl: input.twitterUrl ?? null,
        websiteUrl: input.websiteUrl ?? null,
        investors: input.investors ?? [],
        priority: input.priority ?? 0,
      },
      meta,
    );
  }

  private async ensureDefaultGroup(userId: string) {
    const [existing] = await this.db
      .select()
      .from(watchlistGroups)
      .where(and(eq(watchlistGroups.userId, userId), eq(watchlistGroups.isDefault, true)))
      .limit(1);

    if (existing) return existing;

    const [created] = await this.db
      .insert(watchlistGroups)
      .values({
        userId,
        name: 'Основная',
        sortOrder: 0,
        isDefault: true,
      })
      .onConflictDoNothing({ target: [watchlistGroups.userId, watchlistGroups.name] })
      .returning();

    if (created) {
      await this.audit.log(
        {
          userId,
          action: 'watchlist.group_created',
          entityType: 'watchlist_group',
          entityId: created.id,
          after: { name: created.name, sortOrder: created.sortOrder, isDefault: true },
        },
        { strict: true },
      );
      return created;
    }

    const [fallback] = await this.db
      .select()
      .from(watchlistGroups)
      .where(and(eq(watchlistGroups.userId, userId), eq(watchlistGroups.isDefault, true)))
      .limit(1);

    if (!fallback) throw new Error('Failed to ensure default watchlist group');
    return fallback;
  }

  private async requireGroup(userId: string, id: string) {
    const [group] = await this.db
      .select()
      .from(watchlistGroups)
      .where(and(eq(watchlistGroups.id, id), eq(watchlistGroups.userId, userId)))
      .limit(1);

    if (!group) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Watchlist group not found' });
    }

    return group;
  }

  async list(userId: string, query: WatchlistListQuery): Promise<WatchlistResponse> {
    await this.backfillFromNotion(userId);
    await this.ensureDefaultGroup(userId);

    const conditions = [eq(watchlist.userId, userId)];
    if (!query.includeArchived) conditions.push(isNull(watchlist.archivedAt));
    if (query.groupId) {
      const group = await this.requireGroup(userId, query.groupId);
      conditions.push(
        group.isDefault
          ? or(eq(watchlist.groupId, group.id), isNull(watchlist.groupId))!
          : eq(watchlist.groupId, group.id),
      );
    }
    if (query.search) {
      const pattern = `%${query.search}%`;
      conditions.push(or(ilike(assets.symbol, pattern), ilike(assets.name, pattern))!);
    }
    if (query.cursor) {
      const cursor = decodeCursor<{
        priority: number;
        createdAt: string;
        id: string;
      }>(query.cursor);

      if (
        typeof cursor.priority !== 'number' ||
        typeof cursor.createdAt !== 'string' ||
        !isUuid(cursor.id) ||
        Number.isNaN(new Date(cursor.createdAt).getTime())
      ) {
        throw new BadRequestException({
          code: 'VALIDATION_ERROR',
          message: 'Invalid pagination cursor',
        });
      }

      const cursorDate = new Date(cursor.createdAt);
      conditions.push(
        or(
          lt(watchlist.priority, cursor.priority),
          and(eq(watchlist.priority, cursor.priority), lt(createdAtMs, cursorDate)),
          and(
            eq(watchlist.priority, cursor.priority),
            eq(createdAtMs, cursorDate),
            lt(watchlist.id, cursor.id),
          ),
        )!,
      );
    }

    const rows = await this.db
      .select({ entry: watchlist, asset: assets, chainCode: chains.code })
      .from(watchlist)
      .innerJoin(assets, eq(watchlist.assetId, assets.id))
      .innerJoin(chains, eq(assets.chainId, chains.id))
      .where(and(...conditions))
      .orderBy(desc(watchlist.priority), desc(createdAtMs), desc(watchlist.id))
      .limit(query.limit + 1);
    const page = makePage(rows, query.limit, (row) =>
      encodeCursor({
        priority: row.entry.priority,
        createdAt: row.entry.createdAt.toISOString(),
        id: row.entry.id,
      }),
    );
    const priceByAsset = await this.priceContext(page.data.map((row) => row.entry.assetId));
    const marketByCoingeckoId = await this.marketData.getMarkets(
      page.data.map((row) => row.asset.coingeckoId).filter((id): id is string => Boolean(id)),
    );

    return {
      data: page.data.map((row) =>
        this.toContract(
          row,
          priceByAsset.get(row.entry.assetId),
          row.asset.coingeckoId ? marketByCoingeckoId.get(row.asset.coingeckoId) : undefined,
        ),
      ),
      page: { nextCursor: page.nextCursor, hasMore: page.hasMore },
    };
  }

  async create(
    userId: string,
    input: WatchlistCreateRequest,
    meta: WatchlistMeta,
  ): Promise<WatchlistEntry> {
    await this.requireAsset(input.assetId);
    const group = input.groupId
      ? await this.requireGroup(userId, input.groupId)
      : await this.ensureDefaultGroup(userId);

    const [existing] = await this.db
      .select()
      .from(watchlist)
      .where(and(eq(watchlist.userId, userId), eq(watchlist.assetId, input.assetId)))
      .limit(1);

    if (existing) {
      throw new ConflictException({
        code: 'CONFLICT',
        message: 'Asset is already in the watchlist',
      });
    }

    let createdId: string;

    try {
      createdId = await this.db.transaction(async (tx) => {
        const [created] = await tx
          .insert(watchlist)
          .values({
            userId,
            assetId: input.assetId,
            groupId: group.id,
            thesis: input.thesis ?? null,
            tags: input.tags ?? [],
            twitterUrl: input.twitterUrl ?? null,
            websiteUrl: input.websiteUrl ?? null,
            investors: input.investors ?? [],
            priority: input.priority ?? 0,
          })
          .returning({ id: watchlist.id });

        if (!created) throw new Error('Failed to create watchlist entry');

        await this.audit.log(
          {
            userId,
            action: 'watchlist.created',
            entityType: 'watchlist',
            entityId: created.id,
            after: { ...input, groupId: group.id },
            ip: meta.ip,
            userAgent: meta.userAgent,
          },
          { executor: tx, strict: true },
        );

        return created.id;
      });
    } catch (error) {
      if (
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        (error as { code?: string }).code === '23505'
      ) {
        throw new ConflictException({
          code: 'CONFLICT',
          message: 'Asset is already in the watchlist',
        });
      }
      throw error;
    }

    return this.requireEntry(userId, createdId);
  }

  async update(
    userId: string,
    id: string,
    input: WatchlistUpdateRequest,
    meta: WatchlistMeta,
  ): Promise<WatchlistEntry> {
    const [existing] = await this.db
      .select()
      .from(watchlist)
      .where(and(eq(watchlist.id, id), eq(watchlist.userId, userId)))
      .limit(1);

    if (!existing) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Watchlist entry not found' });
    }

    const targetGroup =
      input.groupId !== undefined
        ? input.groupId
          ? await this.requireGroup(userId, input.groupId)
          : await this.ensureDefaultGroup(userId)
        : null;

    await this.db.transaction(async (tx) => {
      await tx
        .update(watchlist)
        .set({
          groupId: targetGroup ? targetGroup.id : existing.groupId,
          thesis: input.thesis !== undefined ? input.thesis : existing.thesis,
          tags: input.tags !== undefined ? input.tags : existing.tags,
          twitterUrl: input.twitterUrl !== undefined ? input.twitterUrl : existing.twitterUrl,
          websiteUrl: input.websiteUrl !== undefined ? input.websiteUrl : existing.websiteUrl,
          investors: input.investors !== undefined ? input.investors : existing.investors,
          priority: input.priority !== undefined ? input.priority : existing.priority,
          archivedAt:
            input.archived === undefined ? existing.archivedAt : input.archived ? new Date() : null,
          updatedAt: new Date(),
        })
        .where(eq(watchlist.id, id));

      await this.audit.log(
        {
          userId,
          action: 'watchlist.updated',
          entityType: 'watchlist',
          entityId: id,
          before: existing,
          after: input,
          ip: meta.ip,
          userAgent: meta.userAgent,
        },
        { executor: tx, strict: true },
      );
    });

    return this.requireEntry(userId, id);
  }

  async archive(userId: string, id: string, meta: WatchlistMeta): Promise<void> {
    const [existing] = await this.db
      .select()
      .from(watchlist)
      .where(and(eq(watchlist.id, id), eq(watchlist.userId, userId)))
      .limit(1);

    if (!existing) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Watchlist entry not found' });
    }

    await this.db.transaction(async (tx) => {
      const archivedAt = new Date();
      await tx
        .update(watchlist)
        .set({ archivedAt, updatedAt: archivedAt })
        .where(eq(watchlist.id, id));

      await this.audit.log(
        {
          userId,
          action: 'watchlist.archived',
          entityType: 'watchlist',
          entityId: id,
          before: { archivedAt: existing.archivedAt },
          after: { archivedAt: archivedAt.toISOString() },
          ip: meta.ip,
          userAgent: meta.userAgent,
        },
        { executor: tx, strict: true },
      );
    });
  }

  private async backfillFromNotion(userId: string): Promise<void> {
    const [alreadyBackfilled] = await this.db
      .select({ id: auditLog.id })
      .from(auditLog)
      .where(and(eq(auditLog.userId, userId), eq(auditLog.action, 'watchlist.backfilled')))
      .limit(1);

    if (alreadyBackfilled) return;

    const [importRow] = await this.db
      .select()
      .from(imports)
      .where(
        and(
          eq(imports.userId, userId),
          eq(imports.source, 'notion'),
          eq(imports.status, 'committed'),
        ),
      )
      .orderBy(desc(imports.committedAt))
      .limit(1);

    if (!importRow) return;

    const sourceRows = await this.db
      .select()
      .from(importRows)
      .where(and(eq(importRows.importId, importRow.id), eq(importRows.entityType, 'source')));
    const [bsc] = await this.db.select().from(chains).where(eq(chains.code, 'bsc')).limit(1);

    if (!bsc || sourceRows.length === 0) return;

    const assetRows = await this.db.select().from(assets).where(eq(assets.chainId, bsc.id));
    const assetBySymbol = new Map(assetRows.map((asset) => [asset.symbol, asset]));
    const defaultGroup = await this.ensureDefaultGroup(userId);
    const values: Array<{
      userId: string;
      assetId: string;
      groupId: string;
      thesis: string | null;
      tags: string[];
    }> = [];

    for (const row of sourceRows) {
      const data = row.data as unknown as SourceImportData;
      const symbol = typeof data.symbol === 'string' ? data.symbol : null;
      const asset = symbol ? assetBySymbol.get(symbol) : undefined;
      if (!asset) continue;

      const raw =
        data.raw && typeof data.raw === 'object' && !Array.isArray(data.raw)
          ? (data.raw as Record<string, unknown>)
          : {};
      const tags: string[] = [];
      for (const [key, label] of [
        ['Топ', 'Топ'],
        ['Дашбоард', 'Дашбоард'],
        ['Дашборд', 'Дашбоард'],
        ['П-Мкап', 'П-Мкап'],
      ] as const) {
        const value = raw[key];
        if (
          typeof value === 'string' &&
          !value.startsWith('formulaResult://') &&
          !['Нет', 'No', 'false'].includes(value)
        ) {
          tags.push(label);
        }
      }

      values.push({
        userId,
        assetId: asset.id,
        groupId: defaultGroup.id,
        thesis: typeof data.description === 'string' ? data.description : null,
        tags,
      });
    }

    if (values.length === 0) return;

    await this.db.transaction(async (tx) => {
      const inserted = await tx
        .insert(watchlist)
        .values(values)
        .onConflictDoNothing()
        .returning({ id: watchlist.id });
      await this.audit.log(
        {
          userId,
          action: 'watchlist.backfilled',
          entityType: 'watchlist',
          after: { count: inserted.length, importId: importRow.id },
        },
        { executor: tx, strict: true },
      );
    });
  }

  private async requireAsset(assetId: string): Promise<void> {
    const [asset] = await this.db.select().from(assets).where(eq(assets.id, assetId)).limit(1);
    if (!asset) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Asset not found' });
    }
  }

  private async requireEntry(userId: string, id: string): Promise<WatchlistEntry> {
    const [row] = await this.db
      .select({ entry: watchlist, asset: assets, chainCode: chains.code })
      .from(watchlist)
      .innerJoin(assets, eq(watchlist.assetId, assets.id))
      .innerJoin(chains, eq(assets.chainId, chains.id))
      .where(and(eq(watchlist.id, id), eq(watchlist.userId, userId)))
      .limit(1);

    if (!row) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Watchlist entry not found' });
    }

    const priceByAsset = await this.priceContext([row.entry.assetId]);
    const marketByCoingeckoId = row.asset.coingeckoId
      ? await this.marketData.getMarkets([row.asset.coingeckoId])
      : new Map<string, CoinGeckoMarket>();

    return this.toContract(
      row,
      priceByAsset.get(row.entry.assetId),
      row.asset.coingeckoId ? marketByCoingeckoId.get(row.asset.coingeckoId) : undefined,
    );
  }

  private async priceContext(
    assetIds: string[],
  ): Promise<
    Map<string, { latest: string | null; latestObservedAt: Date | null; previous: string | null }>
  > {
    if (assetIds.length === 0) return new Map();

    const rows = await this.db
      .select()
      .from(prices)
      .where(inArray(prices.assetId, [...new Set(assetIds)]))
      .orderBy(desc(prices.observedAt));
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    const result = new Map<
      string,
      { latest: string | null; latestObservedAt: Date | null; previous: string | null }
    >();

    for (const row of rows) {
      const current = result.get(row.assetId) ?? {
        latest: null,
        latestObservedAt: null,
        previous: null,
      };

      if (!current.latest) {
        current.latest = row.priceUsd;
        current.latestObservedAt = row.observedAt;
      } else if (
        current.latestObservedAt &&
        current.latestObservedAt.getTime() >= cutoff &&
        !current.previous &&
        row.observedAt.getTime() <= current.latestObservedAt.getTime() - 24 * 60 * 60 * 1000
      ) {
        current.previous = row.priceUsd;
      }

      result.set(row.assetId, current);
    }

    return result;
  }

  private toGroupContract(
    row: typeof watchlistGroups.$inferSelect,
    entryCount: number,
  ): WatchlistGroup {
    return {
      id: row.id,
      name: row.name,
      sortOrder: row.sortOrder,
      isDefault: row.isDefault,
      entryCount,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  private toContract(
    row: {
      entry: typeof watchlist.$inferSelect;
      asset: typeof assets.$inferSelect;
      chainCode: string;
    },
    price?: {
      latest: string | null;
      latestObservedAt: Date | null;
      previous: string | null;
    },
    market?: CoinGeckoMarket,
  ): WatchlistEntry {
    const latest = market?.priceUsd ?? price?.latest ?? null;
    const previous = price?.previous ?? null;
    const change =
      market?.change24hPct ??
      (latest && previous && decimal(previous).gt(0)
        ? decimal(latest).minus(previous).div(previous).mul(100).toFixed(2)
        : null);
    const derivedPrevious =
      previous ??
      (latest && change && decimal(change).gt(-100)
        ? decimal(latest)
            .div(decimal('1').plus(decimal(change).div(100)))
            .toFixed(8)
        : null);

    return {
      id: row.entry.id,
      asset: {
        id: row.asset.id,
        chainId: row.asset.chainId,
        chainCode: row.chainCode,
        symbol: row.asset.symbol,
        name: row.asset.name,
        decimals: row.asset.decimals,
        contractAddress: row.asset.contractAddress,
        coingeckoId: row.asset.coingeckoId,
        isStablecoin: row.asset.isStablecoin,
        isCashEquivalent: row.asset.isCashEquivalent,
        isVerified: row.asset.isVerified,
      },
      groupId: row.entry.groupId,
      logoUrl: row.asset.logoUrl ?? market?.logoUrl ?? null,
      thesis: row.entry.thesis,
      tags: row.entry.tags,
      twitterUrl: row.entry.twitterUrl,
      websiteUrl: row.entry.websiteUrl,
      investors: row.entry.investors,
      priority: row.entry.priority,
      archivedAt: row.entry.archivedAt?.toISOString() ?? null,
      createdAt: row.entry.createdAt.toISOString(),
      updatedAt: row.entry.updatedAt.toISOString(),
      priceUsd: latest,
      price24hAgoUsd: derivedPrevious,
      change24hPct: change,
    };
  }
}

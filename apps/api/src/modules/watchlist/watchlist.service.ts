import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, desc, eq, ilike, inArray, isNull, lt, or, sql } from 'drizzle-orm';
import {
  assets,
  auditLog,
  chains,
  importRows,
  imports,
  prices,
  watchlist,
  type Database,
} from '@nexter/db';
import type {
  WatchlistCreateRequest,
  WatchlistEntry,
  WatchlistListQuery,
  WatchlistResponse,
  WatchlistUpdateRequest,
} from '@nexter/contracts';
import { AuditService } from '../../shared/audit/audit.service';
import { DB } from '../../shared/db/db.module';
import { decimal } from '../../shared/money/decimal';
import { decodeCursor, encodeCursor, isUuid, makePage } from '../../shared/pagination/cursor';

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
  ) {}

  async list(userId: string, query: WatchlistListQuery): Promise<WatchlistResponse> {
    await this.backfillFromNotion(userId);

    const conditions = [eq(watchlist.userId, userId)];
    if (!query.includeArchived) conditions.push(isNull(watchlist.archivedAt));
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

    return {
      data: page.data.map((row) => this.toContract(row, priceByAsset.get(row.entry.assetId))),
      page: { nextCursor: page.nextCursor, hasMore: page.hasMore },
    };
  }

  async create(
    userId: string,
    input: WatchlistCreateRequest,
    meta: WatchlistMeta,
  ): Promise<WatchlistEntry> {
    await this.requireAsset(input.assetId);

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
            thesis: input.thesis ?? null,
            tags: input.tags ?? [],
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
            after: input,
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

    await this.db.transaction(async (tx) => {
      await tx
        .update(watchlist)
        .set({
          thesis: input.thesis !== undefined ? input.thesis : existing.thesis,
          tags: input.tags !== undefined ? input.tags : existing.tags,
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
    const values: Array<{
      userId: string;
      assetId: string;
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
    return this.toContract(row, priceByAsset.get(row.entry.assetId));
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
  ): WatchlistEntry {
    const latest = price?.latest ?? null;
    const previous = price?.previous ?? null;
    const change =
      latest && previous && decimal(previous).gt(0)
        ? decimal(latest).minus(previous).div(previous).mul(100).toFixed(2)
        : null;

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
      thesis: row.entry.thesis,
      tags: row.entry.tags,
      priority: row.entry.priority,
      archivedAt: row.entry.archivedAt?.toISOString() ?? null,
      createdAt: row.entry.createdAt.toISOString(),
      updatedAt: row.entry.updatedAt.toISOString(),
      priceUsd: latest,
      price24hAgoUsd: previous,
      change24hPct: change,
    };
  }
}

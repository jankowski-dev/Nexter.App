import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { sandboxCandles, sandboxTokens, type Database } from '@nexter/db';
import { SANDBOX_TIMEFRAME } from '@nexter/contracts';
import { DB } from '../../shared/db/db.module';

export interface SandboxCandleUpsertOptions {
  /**
   * Synthetic (CoinGecko) data may only replace rows that are already
   * synthetic; a real GeckoTerminal/Binance bar always wins.
   */
  protectPrimaryRows?: boolean;
}

export interface SandboxTokenRecord {
  id: string;
  userId: string;
  tokenKey: string;
  symbol: string;
  name: string;
  chain: string;
  contractAddress: string | null;
  coingeckoId: string | null;
  enabled: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface SandboxTokenInsert {
  userId: string;
  tokenKey: string;
  symbol: string;
  name: string;
  chain: string;
  contractAddress: string | null;
  coingeckoId: string | null;
  enabled: boolean;
}

export interface SandboxTokenUpdate {
  symbol?: string;
  name?: string;
  coingeckoId?: string | null;
  enabled?: boolean;
}

export interface SandboxCandleInput {
  tokenKey: string;
  timeframe: typeof SANDBOX_TIMEFRAME;
  openTime: Date;
  open: string;
  high: string;
  low: string;
  close: string;
  volumeUsd: string;
  source: string;
  fetchedAt: Date;
}

export interface SandboxCandleStats {
  available: number;
  firstOpenTime: Date | null;
  lastOpenTime: Date | null;
  syntheticCandles: number;
}

/** Drizzle access for the sandbox token universe and its 1h candle store. */
@Injectable()
export class SandboxRepository {
  constructor(@Inject(DB) private readonly db: Database) {}

  async listTokens(userId: string): Promise<SandboxTokenRecord[]> {
    return this.db
      .select()
      .from(sandboxTokens)
      .where(eq(sandboxTokens.userId, userId))
      .orderBy(asc(sandboxTokens.symbol), asc(sandboxTokens.tokenKey));
  }

  async findTokenById(userId: string, id: string): Promise<SandboxTokenRecord | null> {
    const [row] = await this.db
      .select()
      .from(sandboxTokens)
      .where(and(eq(sandboxTokens.userId, userId), eq(sandboxTokens.id, id)))
      .limit(1);

    return row ?? null;
  }

  async insertToken(input: SandboxTokenInsert): Promise<SandboxTokenRecord> {
    const [row] = await this.db.insert(sandboxTokens).values(input).returning();
    if (!row) throw new Error('Sandbox token insert returned no row');

    return row;
  }

  async updateToken(
    userId: string,
    id: string,
    patch: SandboxTokenUpdate,
  ): Promise<SandboxTokenRecord | null> {
    const set: SandboxTokenUpdate & { updatedAt: Date } = { updatedAt: new Date() };
    if (patch.symbol !== undefined) set.symbol = patch.symbol;
    if (patch.name !== undefined) set.name = patch.name;
    if (patch.coingeckoId !== undefined) set.coingeckoId = patch.coingeckoId;
    if (patch.enabled !== undefined) set.enabled = patch.enabled;

    const [row] = await this.db
      .update(sandboxTokens)
      .set(set)
      .where(and(eq(sandboxTokens.userId, userId), eq(sandboxTokens.id, id)))
      .returning();

    return row ?? null;
  }

  /**
   * Upserts candles by `(tokenKey, timeframe, openTime)`. Candles are shared by
   * provider key because the integration is read-only market data; every query
   * that exposes them is scoped through the owner's token universe.
   *
   * With `protectPrimaryRows`, a synthetic (CoinGecko) row only replaces an
   * existing synthetic row, so a temporary primary-provider failure cannot
   * downgrade real OHLCV.
   */
  async upsertCandles(
    rows: SandboxCandleInput[],
    options: SandboxCandleUpsertOptions = {},
  ): Promise<number> {
    if (rows.length === 0) return 0;

    await this.db
      .insert(sandboxCandles)
      .values(rows)
      .onConflictDoUpdate({
        target: [sandboxCandles.tokenKey, sandboxCandles.timeframe, sandboxCandles.openTime],
        set: {
          open: sql`excluded."open"`,
          high: sql`excluded."high"`,
          low: sql`excluded."low"`,
          close: sql`excluded."close"`,
          volumeUsd: sql`excluded."volume_usd"`,
          source: sql`excluded."source"`,
          fetchedAt: sql`excluded."fetched_at"`,
        },
        setWhere: options.protectPrimaryRows
          ? sql`${sandboxCandles.source} = 'coingecko'`
          : undefined,
      });

    return rows.length;
  }

  async candleStatsMany(tokenKeys: string[]): Promise<Map<string, SandboxCandleStats>> {
    const unique = [...new Set(tokenKeys)];
    if (unique.length === 0) return new Map();

    const rows = await this.db
      .select({
        tokenKey: sandboxCandles.tokenKey,
        available: sql<number>`count(*)::int`,
        firstOpenTime: sql<Date | null>`min(${sandboxCandles.openTime})`,
        lastOpenTime: sql<Date | null>`max(${sandboxCandles.openTime})`,
        syntheticCandles: sql<number>`(count(*) filter (where ${sandboxCandles.source} = 'coingecko'))::int`,
      })
      .from(sandboxCandles)
      .where(
        and(
          eq(sandboxCandles.timeframe, SANDBOX_TIMEFRAME),
          inArray(sandboxCandles.tokenKey, unique),
        ),
      )
      .groupBy(sandboxCandles.tokenKey);

    return new Map(
      rows.map((row) => [
        row.tokenKey,
        {
          available: Number(row.available ?? 0),
          firstOpenTime: row.firstOpenTime ? new Date(row.firstOpenTime) : null,
          lastOpenTime: row.lastOpenTime ? new Date(row.lastOpenTime) : null,
          syntheticCandles: Number(row.syntheticCandles ?? 0),
        },
      ]),
    );
  }
}

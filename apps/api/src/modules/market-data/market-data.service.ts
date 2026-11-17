import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, eq, isNull, or } from 'drizzle-orm';
import {
  assets,
  chains,
  marketHistory,
  marketQuotes,
  watchlist,
  type Asset,
  type Database,
} from '@nexter/db';
import type { WatchlistTokenSearchResult } from '@nexter/contracts';
import { DB } from '../../shared/db/db.module';
import { AssetsService } from '../accounting/assets.service';
import { EvmRpcService } from '../swap/evm-rpc.service';
import { CoinGeckoClient, type CoinGeckoMarket } from './coingecko.client';
import { GeckoTerminalClient } from './geckoterminal.client';

interface IconCacheEntry {
  body: Buffer;
  contentType: string;
  expiresAt: number;
}

const ICON_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const ICON_CACHE_MAX_ENTRIES = 200;
const ICON_CACHE_MAX_BYTES = 8 * 1024 * 1024;
const HISTORY_FRESH_MS = 24 * 60 * 60 * 1000;
const HISTORY_FETCH_INTERVAL_MS = 1500;
const HISTORY_MAX_DAYS = 365;
const HISTORY_RETRY_MS = [
  30 * 60 * 1000,
  2 * 60 * 60 * 1000,
  12 * 60 * 60 * 1000,
  24 * 60 * 60 * 1000,
];

interface PriceHistoryPoint {
  date: string;
  priceUsd: string;
}

interface CachedHistory {
  source: string;
  points: PriceHistoryPoint[];
  fetchedAt: Date;
  nextAttemptAt: Date | null;
  failures: number;
}

function sliceHistory(points: PriceHistoryPoint[], days: number): PriceHistoryPoint[] {
  const cutoff = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
  return points.filter((point) => point.date >= cutoff).slice(-days);
}

@Injectable()
export class MarketDataService {
  private readonly iconCache = new Map<string, IconCacheEntry>();
  private readonly iconInFlight = new Map<string, Promise<{ body: Buffer; contentType: string }>>();
  private iconCacheBytes = 0;
  private historyQueue: Promise<void> = Promise.resolve();
  private lastHistoryFetchAt = 0;

  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly rpc: EvmRpcService,
    private readonly coingecko: CoinGeckoClient,
    private readonly geckoterminal: GeckoTerminalClient,
    private readonly assets: AssetsService,
  ) {}

  async search(
    userId: string,
    chain: 'bsc' | 'ethereum',
    address: string,
  ): Promise<WatchlistTokenSearchResult> {
    const normalized = address.toLowerCase();
    const metadata = await this.rpc.getErc20Metadata(chain, normalized);

    if (!metadata) {
      throw new BadRequestException({
        code: 'TOKEN_METADATA_FAILED',
        message: 'Could not read ERC-20 metadata from the contract',
        details: { chain, address: normalized },
      });
    }

    const market = await this.coingecko.getTokenByContract(chain, normalized);
    const [assetRow] = await this.db
      .select()
      .from(assets)
      .innerJoin(chains, eq(assets.chainId, chains.id))
      .where(
        and(
          eq(chains.code, chain),
          or(
            eq(assets.contractAddress, normalized),
            and(isNull(assets.contractAddress), eq(assets.symbol, metadata.symbol)),
          ),
        ),
      )
      .limit(1);

    let alreadyInWatchlist = false;
    let quote: typeof marketQuotes.$inferSelect | undefined;

    if (assetRow) {
      const [entry] = await this.db
        .select({ id: watchlist.id })
        .from(watchlist)
        .where(and(eq(watchlist.userId, userId), eq(watchlist.assetId, assetRow.assets.id)))
        .limit(1);
      alreadyInWatchlist = Boolean(entry);

      [quote] = await this.db
        .select()
        .from(marketQuotes)
        .where(eq(marketQuotes.assetId, assetRow.assets.id))
        .limit(1);
    }

    return {
      chain,
      address: normalized,
      name: metadata.name,
      symbol: metadata.symbol,
      decimals: metadata.decimals,
      coingeckoId: market?.coingeckoId ?? assetRow?.assets.coingeckoId ?? null,
      logoUrl: market?.logoUrl ?? assetRow?.assets.logoUrl ?? null,
      priceUsd: quote?.priceUsd ?? market?.priceUsd ?? null,
      change24hPct: quote?.change24hPct ?? market?.change24hPct ?? null,
      marketCapUsd: quote?.marketCapUsd ?? market?.marketCapUsd ?? null,
      volume24hUsd: market?.volume24hUsd ?? null,
      liquidityUsd: quote?.liquidityUsd ?? null,
      assetId: assetRow?.assets.id ?? null,
      alreadyInWatchlist,
    };
  }

  async ensureAsset(
    userId: string,
    chain: 'bsc' | 'ethereum',
    address: string,
  ): Promise<{ asset: Asset; market: Awaited<ReturnType<CoinGeckoClient['getTokenByContract']>> }> {
    const normalized = address.toLowerCase();
    const metadata = await this.rpc.getErc20Metadata(chain, normalized);

    if (!metadata) {
      throw new BadRequestException({
        code: 'TOKEN_METADATA_FAILED',
        message: 'Could not read ERC-20 metadata from the contract',
        details: { chain, address: normalized },
      });
    }

    const market = await this.coingecko.getTokenByContract(chain, normalized);
    const asset = await this.assets.ensureMarketAsset(userId, chain, {
      symbol: metadata.symbol,
      name: metadata.name,
      address: normalized,
      decimals: metadata.decimals,
      coingeckoId: market?.coingeckoId ?? null,
      logoUrl: market?.logoUrl ?? null,
    });

    return { asset, market };
  }

  async getMarkets(ids: string[]): Promise<Map<string, CoinGeckoMarket>> {
    return this.coingecko.getMarkets(ids);
  }

  async getPriceHistory(
    chainCode: string,
    contractAddress: string | null,
    coingeckoId: string | null,
    days: number,
  ): Promise<{ source: string; points: PriceHistoryPoint[] }> {
    const key = `${chainCode}:${contractAddress ?? ''}:${coingeckoId ?? ''}`;
    const cached = await this.readHistory(key).catch(() => null);
    const now = Date.now();

    if (cached) {
      const hasData = cached.points.length >= 2;
      const fresh = hasData && now - cached.fetchedAt.getTime() < HISTORY_FRESH_MS;
      const waiting = (cached.nextAttemptAt?.getTime() ?? 0) > now;
      if (fresh || waiting) {
        return { source: cached.source, points: sliceHistory(cached.points, days) };
      }
    }

    let result: { source: string; points: PriceHistoryPoint[] };
    try {
      result = await this.enqueueHistoryFetch(() =>
        this.fetchDailyHistory(chainCode, contractAddress, coingeckoId),
      );
    } catch {
      result = { source: 'none', points: [] };
    }

    const hasFreshData = result.points.length >= 2;
    const useFetched = hasFreshData || !cached;
    const points = useFetched ? result.points : cached.points;
    const source = useFetched ? result.source : cached.source;
    const fetchedAt = useFetched ? new Date(now) : cached.fetchedAt;
    const failures = hasFreshData ? 0 : Math.min((cached?.failures ?? 0) + 1, 3);
    const nextAttemptAt = hasFreshData
      ? null
      : new Date(now + HISTORY_RETRY_MS[Math.min(failures, HISTORY_RETRY_MS.length - 1)]);

    await this.writeHistory(key, source, points, fetchedAt, nextAttemptAt, failures).catch(
      () => undefined,
    );

    return { source, points: sliceHistory(points, days) };
  }

  private async fetchDailyHistory(
    chainCode: string,
    contractAddress: string | null,
    coingeckoId: string | null,
  ): Promise<{ source: string; points: PriceHistoryPoint[] }> {
    let source = 'coingecko';
    let candles =
      contractAddress && (chainCode === 'bsc' || chainCode === 'ethereum')
        ? await this.geckoterminal.getDailyCandles(chainCode, contractAddress, HISTORY_MAX_DAYS)
        : [];

    if (candles.length > 0) source = 'geckoterminal';

    if (candles.length < HISTORY_MAX_DAYS && coingeckoId) {
      const coingeckoCandles = await this.coingecko.getDailyCandles(coingeckoId, HISTORY_MAX_DAYS);
      if (coingeckoCandles.length > candles.length) {
        candles = coingeckoCandles;
        source = 'coingecko';
      }
    }

    const points = candles
      .filter((candle) => Number(candle.closeUsd) > 0)
      .sort((left, right) => left.date.localeCompare(right.date))
      .slice(-HISTORY_MAX_DAYS)
      .map((candle) => ({ date: candle.date, priceUsd: candle.closeUsd }));

    return { source: points.length > 0 ? source : 'none', points };
  }

  private enqueueHistoryFetch<T>(task: () => Promise<T>): Promise<T> {
    const run = this.historyQueue.then(async () => {
      const wait = Math.max(0, HISTORY_FETCH_INTERVAL_MS - (Date.now() - this.lastHistoryFetchAt));
      if (wait > 0) {
        await new Promise((resolve) => setTimeout(resolve, wait));
      }
      this.lastHistoryFetchAt = Date.now();
      return task();
    });
    this.historyQueue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  private async readHistory(key: string): Promise<CachedHistory | null> {
    const [row] = await this.db
      .select()
      .from(marketHistory)
      .where(eq(marketHistory.cacheKey, key))
      .limit(1);
    if (!row) return null;

    return {
      source: row.source,
      points: row.points,
      fetchedAt: row.fetchedAt,
      nextAttemptAt: row.nextAttemptAt,
      failures: row.failures,
    };
  }

  private async writeHistory(
    key: string,
    source: string,
    points: PriceHistoryPoint[],
    fetchedAt: Date,
    nextAttemptAt: Date | null,
    failures: number,
  ): Promise<void> {
    const now = new Date();
    await this.db
      .insert(marketHistory)
      .values({
        cacheKey: key,
        source,
        points,
        fetchedAt,
        nextAttemptAt,
        failures,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: marketHistory.cacheKey,
        set: {
          source,
          points,
          fetchedAt,
          nextAttemptAt,
          failures,
          updatedAt: now,
        },
      });
  }

  async fetchIcon(url: string): Promise<{ body: Buffer; contentType: string }> {
    const cached = this.iconCache.get(url);
    if (cached && cached.expiresAt > Date.now()) {
      return { body: cached.body, contentType: cached.contentType };
    }
    if (cached) {
      this.iconCache.delete(url);
      this.iconCacheBytes -= cached.body.length;
    }

    const inFlight = this.iconInFlight.get(url);
    if (inFlight) return inFlight;

    const pending = this.fetchIconUncached(url).then((icon) => {
      if (icon.body.length <= ICON_CACHE_MAX_BYTES) {
        while (
          this.iconCache.size > 0 &&
          (this.iconCache.size >= ICON_CACHE_MAX_ENTRIES ||
            this.iconCacheBytes + icon.body.length > ICON_CACHE_MAX_BYTES)
        ) {
          const oldestKey = this.iconCache.keys().next().value;
          if (!oldestKey) break;
          const oldest = this.iconCache.get(oldestKey);
          this.iconCache.delete(oldestKey);
          if (oldest) this.iconCacheBytes -= oldest.body.length;
        }

        this.iconCache.set(url, { ...icon, expiresAt: Date.now() + ICON_CACHE_TTL_MS });
        this.iconCacheBytes += icon.body.length;
      }
      return icon;
    });

    this.iconInFlight.set(url, pending);
    try {
      return await pending;
    } finally {
      this.iconInFlight.delete(url);
    }
  }

  private async fetchIconUncached(url: string): Promise<{ body: Buffer; contentType: string }> {
    let parsed: URL;

    try {
      parsed = new URL(url);
    } catch {
      throw new BadRequestException({ code: 'VALIDATION_ERROR', message: 'Invalid icon URL' });
    }

    const allowedHosts = new Set(['coin-images.coingecko.com', 'assets.coingecko.com']);

    if (parsed.protocol !== 'https:' || !allowedHosts.has(parsed.hostname)) {
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: 'Icon host is not allowed',
      });
    }

    const response = await fetch(parsed, {
      headers: { accept: 'image/*' },
      signal: AbortSignal.timeout(5000),
    });

    if (!response.ok) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Icon not found' });
    }

    const contentType = response.headers.get('content-type') ?? '';
    if (!contentType.startsWith('image/')) {
      throw new BadRequestException({ code: 'VALIDATION_ERROR', message: 'Not an image' });
    }

    const body = Buffer.from(await response.arrayBuffer());
    if (body.length > 1_000_000) {
      throw new BadRequestException({ code: 'VALIDATION_ERROR', message: 'Icon is too large' });
    }

    return { body, contentType };
  }
}

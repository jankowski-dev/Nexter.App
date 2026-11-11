import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { assets, chains, watchlist, type Asset, type Database } from '@nexter/db';
import type { WatchlistTokenSearchResult } from '@nexter/contracts';
import { DB } from '../../shared/db/db.module';
import { AssetsService } from '../accounting/assets.service';
import { EvmRpcService } from '../swap/evm-rpc.service';
import { CoinGeckoClient, type CoinGeckoMarket } from './coingecko.client';

interface IconCacheEntry {
  body: Buffer;
  contentType: string;
  expiresAt: number;
}

const ICON_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const ICON_CACHE_MAX_ENTRIES = 200;

@Injectable()
export class MarketDataService {
  private readonly iconCache = new Map<string, IconCacheEntry>();
  private readonly iconInFlight = new Map<string, Promise<{ body: Buffer; contentType: string }>>();

  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly rpc: EvmRpcService,
    private readonly coingecko: CoinGeckoClient,
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
      .select({ id: assets.id })
      .from(assets)
      .innerJoin(chains, eq(assets.chainId, chains.id))
      .where(and(eq(chains.code, chain), eq(assets.contractAddress, normalized)))
      .limit(1);

    let alreadyInWatchlist = false;

    if (assetRow) {
      const [entry] = await this.db
        .select({ id: watchlist.id })
        .from(watchlist)
        .where(and(eq(watchlist.userId, userId), eq(watchlist.assetId, assetRow.id)))
        .limit(1);
      alreadyInWatchlist = Boolean(entry);
    }

    return {
      chain,
      address: normalized,
      name: metadata.name,
      symbol: metadata.symbol,
      decimals: metadata.decimals,
      coingeckoId: market?.coingeckoId ?? null,
      logoUrl: market?.logoUrl ?? null,
      priceUsd: market?.priceUsd ?? null,
      change24hPct: market?.change24hPct ?? null,
      marketCapUsd: market?.marketCapUsd ?? null,
      volume24hUsd: market?.volume24hUsd ?? null,
      assetId: assetRow?.id ?? null,
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

  async fetchIcon(url: string): Promise<{ body: Buffer; contentType: string }> {
    const cached = this.iconCache.get(url);
    if (cached && cached.expiresAt > Date.now()) {
      return { body: cached.body, contentType: cached.contentType };
    }
    if (cached) this.iconCache.delete(url);

    const inFlight = this.iconInFlight.get(url);
    if (inFlight) return inFlight;

    const pending = this.fetchIconUncached(url).then((icon) => {
      if (this.iconCache.size >= ICON_CACHE_MAX_ENTRIES) {
        const oldest = this.iconCache.keys().next().value;
        if (oldest) this.iconCache.delete(oldest);
      }
      this.iconCache.set(url, { ...icon, expiresAt: Date.now() + ICON_CACHE_TTL_MS });
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

import { Inject, Injectable, Logger } from '@nestjs/common';
import { eq, inArray } from 'drizzle-orm';
import { assets, chains, marketQuotes, type Database, type MarketQuote } from '@nexter/db';
import { env } from '../../shared/config/env';
import { DB } from '../../shared/db/db.module';
import { decimal } from '../../shared/money/decimal';
import { CoinGeckoClient } from './coingecko.client';
import { DexScreenerClient } from './dexscreener.client';

export interface MarketQuoteValue {
  priceUsd: string;
  change24hPct: string | null;
  source: string;
  liquidityUsd: string | null;
  fetchedAt: Date;
  changedAt: Date;
}

interface QuoteInput {
  assetId: string;
  priceUsd: string;
  change24hPct: string | null;
  source: string;
  liquidityUsd: string | null;
}

function toValue(row: MarketQuote): MarketQuoteValue {
  return {
    priceUsd: row.priceUsd,
    change24hPct: row.change24hPct,
    source: row.source,
    liquidityUsd: row.liquidityUsd,
    fetchedAt: row.fetchedAt,
    changedAt: row.changedAt,
  };
}

@Injectable()
export class MarketQuoteService {
  private readonly logger = new Logger(MarketQuoteService.name);
  private lastCoinGeckoAt = 0;

  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly coingecko: CoinGeckoClient,
    private readonly dexscreener: DexScreenerClient,
  ) {}

  async getQuotes(assetIds: string[]): Promise<Map<string, MarketQuoteValue>> {
    if (assetIds.length === 0) return new Map();

    const rows = await this.db
      .select()
      .from(marketQuotes)
      .where(inArray(marketQuotes.assetId, assetIds));

    return new Map(rows.map((row) => [row.assetId, toValue(row)]));
  }

  async refreshAll(): Promise<void> {
    const rows = await this.db
      .select({
        id: assets.id,
        symbol: assets.symbol,
        contractAddress: assets.contractAddress,
        coingeckoId: assets.coingeckoId,
        isCashEquivalent: assets.isCashEquivalent,
        chainCode: chains.code,
      })
      .from(assets)
      .innerJoin(chains, eq(assets.chainId, chains.id));

    if (rows.length === 0) return;

    const existingRows = await this.db.select().from(marketQuotes);
    const existingById = new Map(existingRows.map((row) => [row.assetId, row]));
    const quotes: QuoteInput[] = [];
    const dexCovered = new Set<string>();
    const minLiquidity = decimal(env.MARKET_QUOTE_MIN_LIQUIDITY_USD);
    const now = new Date();

    for (const row of rows) {
      if (!row.isCashEquivalent) continue;

      quotes.push({
        assetId: row.id,
        priceUsd: '1.000000000000000000',
        change24hPct: '0.0000',
        source: 'stablecoin',
        liquidityUsd: null,
      });
    }

    const dexRows = rows.filter(
      (row) =>
        !row.isCashEquivalent &&
        row.contractAddress &&
        (row.chainCode === 'bsc' || row.chainCode === 'ethereum'),
    );

    await this.mapWithConcurrency(dexRows, 4, async (row) => {
      const quote = await this.dexscreener.getBestQuote(
        row.chainCode as 'bsc' | 'ethereum',
        row.contractAddress as string,
        minLiquidity,
      );
      if (!quote) return;

      dexCovered.add(row.id);
      quotes.push({
        assetId: row.id,
        priceUsd: quote.priceUsd,
        change24hPct: quote.change24hPct,
        source: 'dexscreener',
        liquidityUsd: quote.liquidityUsd,
      });
    });

    const cgDue =
      Date.now() - this.lastCoinGeckoAt >= env.MARKET_QUOTE_COINGECKO_INTERVAL_SECONDS * 1000;
    const cgRows = rows.filter((row) => {
      if (row.isCashEquivalent || dexCovered.has(row.id) || !row.coingeckoId) return false;
      return cgDue || !existingById.has(row.id);
    });
    const cgIds = [...new Set(cgRows.map((row) => row.coingeckoId as string))];

    if (cgIds.length > 0) {
      this.lastCoinGeckoAt = Date.now();
      const markets = await this.coingecko.getMarkets(cgIds);

      for (const row of cgRows) {
        const market = row.coingeckoId ? markets.get(row.coingeckoId) : undefined;
        if (!market) continue;

        quotes.push({
          assetId: row.id,
          priceUsd: market.priceUsd,
          change24hPct: market.change24hPct,
          source: 'coingecko',
          liquidityUsd: null,
        });
      }
    }

    if (quotes.length === 0) return;

    for (const quote of quotes) {
      if (decimal(quote.priceUsd).lte(0)) {
        this.logger.warn(`Skipping non-positive market quote for asset ${quote.assetId}`);
        continue;
      }

      const change24hPct =
        quote.change24hPct && decimal(quote.change24hPct).abs().lt(99_999_999.9999)
          ? decimal(quote.change24hPct).toFixed(4)
          : null;
      const existing = existingById.get(quote.assetId);
      const changed = !existing || !decimal(existing.priceUsd).eq(decimal(quote.priceUsd));
      const changedAt = changed ? now : (existing?.changedAt ?? now);

      try {
        await this.db
          .insert(marketQuotes)
          .values({
            assetId: quote.assetId,
            priceUsd: quote.priceUsd,
            change24hPct,
            source: quote.source,
            liquidityUsd: quote.liquidityUsd,
            fetchedAt: now,
            changedAt,
            updatedAt: now,
          })
          .onConflictDoUpdate({
            target: marketQuotes.assetId,
            set: {
              priceUsd: quote.priceUsd,
              change24hPct,
              source: quote.source,
              liquidityUsd: quote.liquidityUsd,
              fetchedAt: now,
              changedAt,
              updatedAt: now,
            },
          });
      } catch (error) {
        this.logger.warn(
          `Market quote upsert failed for asset ${quote.assetId}: ${
            error instanceof Error ? error.message : 'unknown error'
          }`,
        );
      }
    }

    this.logger.log(
      `Market quotes refreshed: ${quotes.length} assets (${dexCovered.size} DEX, ${cgIds.length} CoinGecko)`,
    );
  }

  private async mapWithConcurrency<T>(
    items: T[],
    concurrency: number,
    action: (item: T) => Promise<void>,
  ): Promise<void> {
    let index = 0;

    const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
      while (index < items.length) {
        const current = items[index];
        index += 1;
        if (current) await action(current);
      }
    });

    await Promise.all(workers);
  }
}

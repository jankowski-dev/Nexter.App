import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { and, eq, isNull } from 'drizzle-orm';
import { assets, chains, type Database } from '@nexter/db';
import { AuditService } from '../../shared/audit/audit.service';
import { env } from '../../shared/config/env';
import { DB } from '../../shared/db/db.module';
import { CoinGeckoClient } from './coingecko.client';

const BACKFILL_INTERVAL_MS = 6 * 60 * 60 * 1000;
const CONTRACT_LOOKUPS_PER_TICK = 8;

@Injectable()
export class AssetLogoBackfillService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(AssetLogoBackfillService.name);
  private timer: NodeJS.Timeout | null = null;
  private initialTimer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly coingecko: CoinGeckoClient,
    private readonly audit: AuditService,
  ) {}

  onApplicationBootstrap(): void {
    if (env.NODE_ENV === 'test') return;

    this.initialTimer = setTimeout(() => {
      void this.tick();
    }, 5_000);
    this.initialTimer.unref();

    this.timer = setInterval(() => {
      void this.tick();
    }, BACKFILL_INTERVAL_MS);
    this.timer.unref();
  }

  onApplicationShutdown(): void {
    if (this.timer) clearInterval(this.timer);
    if (this.initialTimer) clearTimeout(this.initialTimer);
    this.timer = null;
    this.initialTimer = null;
  }

  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;

    try {
      const missing = await this.db
        .select({ asset: assets, chainCode: chains.code })
        .from(assets)
        .innerJoin(chains, eq(assets.chainId, chains.id))
        .where(isNull(assets.logoUrl));

      if (missing.length === 0) return;

      const byCoingecko = new Map(
        missing
          .filter((row) => row.asset.coingeckoId)
          .map((row) => [row.asset.coingeckoId as string, row]),
      );
      const markets = await this.coingecko.getMarkets([...byCoingecko.keys()]);
      const updated: string[] = [];

      for (const [id, row] of byCoingecko) {
        const market = markets.get(id);
        if (!market?.logoUrl) continue;

        await this.db
          .update(assets)
          .set({ logoUrl: market.logoUrl, updatedAt: new Date() })
          .where(and(eq(assets.id, row.asset.id), isNull(assets.logoUrl)));
        updated.push(row.asset.symbol);
      }

      const byContract = missing
        .filter(
          (row) =>
            !row.asset.logoUrl && !row.asset.coingeckoId && Boolean(row.asset.contractAddress),
        )
        .slice(0, CONTRACT_LOOKUPS_PER_TICK);

      for (const row of byContract) {
        const market = await this.coingecko.getTokenByContract(
          row.chainCode,
          row.asset.contractAddress as string,
        );
        if (!market?.logoUrl) continue;

        await this.db
          .update(assets)
          .set({
            logoUrl: market.logoUrl,
            coingeckoId: market.coingeckoId,
            updatedAt: new Date(),
          })
          .where(and(eq(assets.id, row.asset.id), isNull(assets.logoUrl)));
        updated.push(row.asset.symbol);
      }

      if (updated.length === 0) return;

      await this.audit.log({
        userId: null,
        action: 'accounting.asset_logos_backfilled',
        entityType: 'asset',
        after: { count: updated.length, symbols: updated },
      });
      this.logger.log(`Backfilled ${updated.length} asset logo(s): ${updated.join(', ')}`);
    } catch (error) {
      this.logger.warn(
        `Asset logo backfill failed: ${error instanceof Error ? error.message : 'unknown error'}`,
      );
    } finally {
      this.running = false;
    }
  }
}

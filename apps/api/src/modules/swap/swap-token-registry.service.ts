import {
  Inject,
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from '@nestjs/common';
import { and, eq, inArray, isNotNull, isNull } from 'drizzle-orm';
import { assets, chains, watchlist, watchlistGroups, type Database } from '@nexter/db';
import { DB } from '../../shared/db/db.module';
import type { SwapToken } from '@nexter/contracts';
import { replaceDynamicSwapTokens } from './token-registry';

const REFRESH_INTERVAL_MS = 60_000;

@Injectable()
export class SwapTokenRegistryService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(SwapTokenRegistryService.name);
  private timer: NodeJS.Timeout | null = null;

  constructor(@Inject(DB) private readonly db: Database) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.refresh();
    this.timer = setInterval(() => void this.refresh(), REFRESH_INTERVAL_MS);
    this.timer.unref();
  }

  onApplicationShutdown(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async refresh(): Promise<void> {
    try {
      const rows = await this.db
        .select({
          symbol: assets.symbol,
          name: assets.name,
          address: assets.contractAddress,
          decimals: assets.decimals,
          chainCode: chains.code,
        })
        .from(watchlist)
        .innerJoin(
          watchlistGroups,
          and(eq(watchlistGroups.id, watchlist.groupId), eq(watchlistGroups.isDefault, true)),
        )
        .innerJoin(assets, eq(assets.id, watchlist.assetId))
        .innerJoin(chains, eq(chains.id, assets.chainId))
        .where(
          and(
            isNull(watchlist.archivedAt),
            eq(watchlist.swapEnabled, true),
            isNotNull(assets.contractAddress),
            inArray(chains.code, ['bsc', 'ethereum']),
          ),
        );

      const seen = new Set<string>();
      const entries: Array<{ chainCode: string; token: SwapToken }> = [];

      for (const row of rows) {
        if (!row.address || row.decimals < 0 || row.decimals > 36) continue;
        const key = `${row.chainCode}:${row.address.toLowerCase()}`;
        if (seen.has(key)) continue;
        seen.add(key);
        entries.push({
          chainCode: row.chainCode,
          token: {
            symbol: row.symbol,
            name: row.name,
            address: row.address.toLowerCase(),
            decimals: row.decimals,
            native: false,
          },
        });
      }

      replaceDynamicSwapTokens(entries);
      this.logger.log(`Dynamic swap tokens refreshed: ${entries.length}`);
    } catch (error) {
      this.logger.warn(
        `Dynamic swap token refresh failed: ${error instanceof Error ? error.message : 'unknown'}`,
      );
    }
  }
}

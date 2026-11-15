import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, eq, isNull, sql } from 'drizzle-orm';
import {
  lots,
  tradeGroups,
  watchlist,
  watchlistGroups,
  type Database,
  type DbExecutor,
} from '@nexter/db';
import { DB } from '../../shared/db/db.module';
import { Decimal, decimal } from '../../shared/money/decimal';

@Injectable()
export class TradePolicyService {
  constructor(@Inject(DB) private readonly db: Database) {}

  async assertBuyAssetInDefaultGroup(
    userId: string,
    assetId: string,
    executor: DbExecutor = this.db,
  ): Promise<void> {
    const [entry] = await executor
      .select({ id: watchlist.id })
      .from(watchlist)
      .innerJoin(watchlistGroups, eq(watchlist.groupId, watchlistGroups.id))
      .where(
        and(
          eq(watchlist.userId, userId),
          eq(watchlist.assetId, assetId),
          isNull(watchlist.archivedAt),
          eq(watchlistGroups.isDefault, true),
        ),
      )
      .limit(1);

    if (!entry) {
      throw new ForbiddenException({
        code: 'TRADE_ASSET_NOT_ALLOWED',
        message: 'Buying is allowed only for assets in the default watchlist group',
        details: { assetId },
      });
    }
  }

  assertAccountAssetChain(
    account: { chainId: string | null },
    asset: { chainId: string; symbol: string },
  ): void {
    if (account.chainId && account.chainId !== asset.chainId) {
      throw new BadRequestException({
        code: 'TRADE_ACCOUNT_CHAIN_MISMATCH',
        message: `Wallet and ${asset.symbol} are on different chains`,
        details: { accountChainId: account.chainId, assetChainId: asset.chainId },
      });
    }
  }

  async assertSellableGroup(
    userId: string,
    groupId: string,
    assetId: string,
    amount: Decimal,
    executor: DbExecutor = this.db,
  ): Promise<void> {
    const [group] = await executor
      .select({
        id: tradeGroups.id,
        status: tradeGroups.status,
        assetId: tradeGroups.assetId,
      })
      .from(tradeGroups)
      .where(and(eq(tradeGroups.id, groupId), eq(tradeGroups.userId, userId)))
      .limit(1);

    if (!group) {
      throw new NotFoundException({
        code: 'TRADE_GROUP_NOT_FOUND',
        message: 'Trade group not found',
      });
    }

    if (group.assetId !== assetId) {
      throw new BadRequestException({
        code: 'TRADE_GROUP_ASSET_MISMATCH',
        message: 'Trade group belongs to another asset',
        details: { groupId, assetId },
      });
    }

    if (group.status === 'closed') {
      throw new BadRequestException({
        code: 'TRADE_GROUP_CLOSED',
        message: 'Trade group is already closed',
        details: { groupId },
      });
    }

    const [row] = await executor
      .select({ remaining: sql<string>`coalesce(sum(${lots.remainingAmount}), 0)::text` })
      .from(lots)
      .where(and(eq(lots.tradeGroupId, groupId), eq(lots.userId, userId)));

    const remaining = decimal(row?.remaining ?? '0');
    if (amount.gt(remaining)) {
      throw new BadRequestException({
        code: 'TRADE_AMOUNT_EXCEEDS_REMAINING',
        message: 'Sell amount exceeds the trade group remaining amount',
        details: { groupId, remaining: remaining.toFixed(), requested: amount.toFixed() },
      });
    }
  }
}

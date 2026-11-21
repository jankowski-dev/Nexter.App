import { Inject, Injectable } from '@nestjs/common';
import { and, eq, isNull } from 'drizzle-orm';
import { botTokens, tradingBots, type Database } from '@nexter/db';
import { decimal, usdString } from '../../shared/money/decimal';
import { DB } from '../../shared/db/db.module';
import { AiTradingService } from './ai-trading.service';

export interface DraftCapacity {
  slots: number;
  budgetUsd: string;
  maxInvestedUsd: string;
  usedBudgetUsd: string;
  freeBudgetUsd: string;
  perBotBudgetUsd: string;
  tokenCapUsd: string;
  exposureByAsset: Record<string, string>;
}

@Injectable()
export class AiRiskService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly aiTrading: AiTradingService,
  ) {}

  async draftCapacity(userId: string): Promise<DraftCapacity> {
    const profile = await this.aiTrading.getProfile(userId);
    const [bots, links] = await Promise.all([
      this.db
        .select({ id: tradingBots.id, budgetUsd: tradingBots.budgetUsd })
        .from(tradingBots)
        .where(
          and(
            eq(tradingBots.userId, userId),
            eq(tradingBots.origin, 'ai'),
            isNull(tradingBots.archivedAt),
          ),
        ),
      this.db
        .select({ assetId: botTokens.assetId, budgetUsd: tradingBots.budgetUsd })
        .from(botTokens)
        .innerJoin(tradingBots, eq(tradingBots.id, botTokens.botId))
        .where(
          and(
            eq(tradingBots.userId, userId),
            eq(tradingBots.origin, 'ai'),
            isNull(tradingBots.archivedAt),
          ),
        ),
    ]);

    const budget = decimal(profile.budgetUsd);
    const used = bots.reduce((sum, bot) => sum.plus(decimal(bot.budgetUsd)), decimal('0'));
    const maxInvested = budget.mul(profile.maxInvestedPct).div(100);
    const free = budget.minus(used).lt(maxInvested) ? budget.minus(used) : maxInvested.minus(used);
    const freeBudget = free.lt(0) ? decimal('0') : free;
    const allocationPct = Math.min(profile.maxWorkerAllocationPct, profile.maxTokenExposurePct);
    const perBot = budget.mul(allocationPct).div(100).lt(freeBudget)
      ? budget.mul(allocationPct).div(100)
      : freeBudget;
    const tokenCap = budget.mul(profile.maxTokenExposurePct).div(100);
    const exposureByAsset: Record<string, string> = {};
    for (const link of links) {
      exposureByAsset[link.assetId] = usdString(
        decimal(exposureByAsset[link.assetId] ?? '0').plus(decimal(link.budgetUsd)),
      );
    }

    return {
      slots: Math.max(0, profile.maxWorkers - bots.length),
      budgetUsd: usdString(budget),
      maxInvestedUsd: usdString(maxInvested),
      usedBudgetUsd: usdString(used),
      freeBudgetUsd: usdString(freeBudget),
      perBotBudgetUsd: usdString(perBot),
      tokenCapUsd: usdString(tokenCap),
      exposureByAsset,
    };
  }
}

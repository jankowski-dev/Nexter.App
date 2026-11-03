import { BadRequestException, Injectable } from '@nestjs/common';
import { and, asc, eq, gt, sql } from 'drizzle-orm';
import { lotConsumptions, lots, tradeGroups, type DbExecutor } from '@nexter/db';
import { Decimal, amountString, decimal, usdString } from '../../shared/money/decimal';
import { planFifo } from './fifo.math';

export interface ConsumeOptions {
  proceedsUsd?: Decimal;
  feeUsd?: Decimal;
  realize?: boolean;
}

export interface ConsumeResult {
  costBasisUsd: Decimal;
  realizedPnlUsd: Decimal;
  groupIds: string[];
}

@Injectable()
export class FifoService {
  async consume(
    userId: string,
    assetId: string,
    amountValue: string,
    disposalTransactionId: string,
    executor: DbExecutor,
    options: ConsumeOptions = {},
  ): Promise<ConsumeResult> {
    const amount = decimal(amountValue);
    const lotRows = await executor
      .select()
      .from(lots)
      .where(and(eq(lots.userId, userId), eq(lots.assetId, assetId), gt(lots.remainingAmount, '0')))
      .orderBy(asc(lots.acquiredAt), asc(lots.createdAt))
      .for('update');

    const plan = planFifo(
      lotRows.map((lot) => ({
        id: lot.id,
        remainingAmount: lot.remainingAmount,
        remainingCostBasisUsd: lot.remainingCostBasisUsd,
        tradeGroupId: lot.tradeGroupId,
      })),
      amountValue,
    );

    if (!plan) {
      const available = lotRows.reduce(
        (total, lot) => total.plus(decimal(lot.remainingAmount)),
        new Decimal(0),
      );

      throw new BadRequestException({
        code: 'INSUFFICIENT_LOTS',
        message: 'Not enough FIFO lots for this disposal',
        details: {
          assetId,
          requested: amountValue,
          available: available.toFixed(18),
        },
      });
    }

    const realize = options.realize ?? true;
    const proceeds = realize ? (options.proceedsUsd ?? new Decimal(0)) : new Decimal(0);
    const fees = realize ? (options.feeUsd ?? new Decimal(0)) : new Decimal(0);
    const lotById = new Map(lotRows.map((lot) => [lot.id, lot]));

    let allocatedProceeds = new Decimal(0);
    let allocatedFees = new Decimal(0);
    let totalCostBasis = new Decimal(0);
    let totalRealized = new Decimal(0);
    const groupIds = new Set<string>();

    for (const [index, allocation] of plan.allocations.entries()) {
      const lot = lotById.get(allocation.lotId);

      if (!lot) {
        throw new Error('FIFO lot disappeared during allocation');
      }

      const isLast = index === plan.allocations.length - 1;
      const allocationProceeds = isLast
        ? proceeds.minus(allocatedProceeds)
        : proceeds.mul(allocation.amount).div(amount);
      const allocationFee = isLast
        ? fees.minus(allocatedFees)
        : fees.mul(allocation.amount).div(amount);
      const realized = realize
        ? allocationProceeds.minus(allocation.costBasisUsd).minus(allocationFee)
        : new Decimal(0);

      allocatedProceeds = allocatedProceeds.plus(allocationProceeds);
      allocatedFees = allocatedFees.plus(allocationFee);
      totalCostBasis = totalCostBasis.plus(allocation.costBasisUsd);
      totalRealized = totalRealized.plus(realized);

      const lotRemaining = decimal(lot.remainingAmount);
      const lotCostBasis = decimal(lot.remainingCostBasisUsd);
      const newRemaining = lotRemaining.minus(allocation.amount);
      const newCostBasis = allocation.amount.eq(lotRemaining)
        ? new Decimal(0)
        : lotCostBasis.minus(allocation.costBasisUsd);

      await executor
        .update(lots)
        .set({
          remainingAmount: amountString(newRemaining.isNegative() ? new Decimal(0) : newRemaining),
          remainingCostBasisUsd: usdString(
            newCostBasis.isNegative() ? new Decimal(0) : newCostBasis,
          ),
        })
        .where(eq(lots.id, lot.id));

      await executor.insert(lotConsumptions).values({
        lotId: lot.id,
        disposalTransactionId,
        amount: amountString(allocation.amount),
        costBasisUsd: usdString(allocation.costBasisUsd),
        proceedsUsd: usdString(allocationProceeds),
        realizedPnlUsd: usdString(realized),
      });

      if (lot.tradeGroupId) {
        groupIds.add(lot.tradeGroupId);
      }
    }

    await this.refreshGroups(groupIds, executor);

    return {
      costBasisUsd: totalCostBasis,
      realizedPnlUsd: totalRealized,
      groupIds: [...groupIds],
    };
  }

  async refreshGroups(groupIds: Iterable<string>, executor: DbExecutor): Promise<void> {
    const now = new Date();

    for (const groupId of groupIds) {
      const [totals] = await executor
        .select({
          total: sql<string>`coalesce(sum(${lots.amount}), 0)::text`,
          remaining: sql<string>`coalesce(sum(${lots.remainingAmount}), 0)::text`,
        })
        .from(lots)
        .where(eq(lots.tradeGroupId, groupId));

      const total = decimal(totals?.total ?? '0');
      const remaining = decimal(totals?.remaining ?? '0');
      const status = remaining.isZero() ? 'closed' : remaining.lt(total) ? 'partial' : 'open';

      await executor
        .update(tradeGroups)
        .set({
          status,
          closedAt: status === 'closed' ? now : null,
          updatedAt: now,
        })
        .where(eq(tradeGroups.id, groupId));
    }
  }
}

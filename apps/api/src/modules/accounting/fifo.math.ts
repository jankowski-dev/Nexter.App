import { Decimal, decimal } from '../../shared/money/decimal';

export interface FifoLot {
  id: string;
  remainingAmount: string;
  remainingCostBasisUsd: string;
  tradeGroupId?: string | null;
}

export interface FifoAllocation {
  lotId: string;
  amount: Decimal;
  costBasisUsd: Decimal;
  tradeGroupId?: string | null;
}

export interface FifoPlan {
  allocations: FifoAllocation[];
  totalCostBasisUsd: Decimal;
}

/**
 * Pure FIFO allocator. Callers pass lots in acquisition order.
 * Returns null when the available amount is insufficient.
 */
export function planFifo(lots: FifoLot[], amountValue: string): FifoPlan | null {
  const amount = decimal(amountValue);

  if (amount.lte(0)) {
    return null;
  }

  const available = lots.reduce(
    (total, lot) => total.plus(decimal(lot.remainingAmount)),
    new Decimal(0),
  );

  if (available.lt(amount)) {
    return null;
  }

  const allocations: FifoAllocation[] = [];
  let remaining = amount;

  for (const lot of lots) {
    if (remaining.lte(0)) break;

    const lotAmount = decimal(lot.remainingAmount);

    if (lotAmount.lte(0)) continue;

    const take = Decimal.min(remaining, lotAmount);
    const lotCostBasis = decimal(lot.remainingCostBasisUsd);
    const costBasis = take.eq(lotAmount) ? lotCostBasis : lotCostBasis.mul(take).div(lotAmount);

    allocations.push({
      lotId: lot.id,
      amount: take,
      costBasisUsd: costBasis,
      tradeGroupId: lot.tradeGroupId,
    });

    remaining = remaining.minus(take);
  }

  const totalCostBasisUsd = allocations.reduce(
    (total, allocation) => total.plus(allocation.costBasisUsd),
    new Decimal(0),
  );

  return { allocations, totalCostBasisUsd };
}

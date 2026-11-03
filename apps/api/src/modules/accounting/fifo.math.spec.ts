import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { Decimal, decimal } from '../../shared/money/decimal';
import { planFifo } from './fifo.math';

const decimalArb = (max: number) =>
  fc.integer({ min: 1, max: max * 1000 }).map((value) => (value / 1000).toFixed(3));

describe('planFifo', () => {
  it('never allocates more than the requested amount and preserves non-negative cost basis', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            amount: decimalArb(100),
            costBasis: decimalArb(1000),
          }),
          { minLength: 1, maxLength: 8 },
        ),
        fc.integer({ min: 1, max: 1000 }),
        (rawLots, requestedPermille) => {
          const lots = rawLots.map((lot, index) => ({
            id: `lot-${index}`,
            remainingAmount: lot.amount,
            remainingCostBasisUsd: lot.costBasis,
          }));
          const available = lots.reduce(
            (total, lot) => total.plus(decimal(lot.remainingAmount)),
            new Decimal(0),
          );
          const requested = available.mul(requestedPermille).div(1000);
          const plan = planFifo(lots, requested.toFixed(18));

          expect(plan).not.toBeNull();
          if (!plan) return;

          const allocated = plan.allocations.reduce(
            (total, allocation) => total.plus(allocation.amount),
            new Decimal(0),
          );
          expect(allocated.eq(requested)).toBe(true);
          expect(plan.totalCostBasisUsd.gte(0)).toBe(true);
          expect(
            plan.allocations.every(
              (allocation) => allocation.amount.gt(0) && allocation.costBasisUsd.gte(0),
            ),
          ).toBe(true);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('returns null when the requested amount exceeds available lots', () => {
    const plan = planFifo(
      [{ id: 'lot-1', remainingAmount: '1', remainingCostBasisUsd: '10' }],
      '1.000000000000000001',
    );

    expect(plan).toBeNull();
  });
});

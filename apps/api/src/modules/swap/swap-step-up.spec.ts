import { describe, expect, it } from 'vitest';
import type { SwapOrder } from '@nexter/db';
import { amountInUsd, assertStepUp, requiresStepUp } from './swap-step-up';

function order(values: { amountInUsd?: string | null; routeAmountInUsd?: unknown }): SwapOrder {
  return {
    amountInUsd: values.amountInUsd ?? null,
    routeSummary: { amountInUsd: values.routeAmountInUsd },
  } as unknown as SwapOrder;
}

describe('swap step-up gate', () => {
  it('uses a stored or normalized USD value', () => {
    expect(amountInUsd(order({ amountInUsd: '600.00000000' }))?.toFixed(2)).toBe('600.00');
    expect(amountInUsd(order({ routeAmountInUsd: 600 }))?.toFixed(2)).toBe('600.00');
    expect(amountInUsd(order({ routeAmountInUsd: '600.00' }))?.toFixed(2)).toBe('600.00');
  });

  it('fails closed when USD is missing, invalid or non-positive', () => {
    expect(requiresStepUp(order({}))).toBe(true);
    expect(requiresStepUp(order({ routeAmountInUsd: null }))).toBe(true);
    expect(requiresStepUp(order({ routeAmountInUsd: 'abc' }))).toBe(true);
    expect(requiresStepUp(order({ routeAmountInUsd: '-100' }))).toBe(true);
    expect(requiresStepUp(order({ routeAmountInUsd: 0 }))).toBe(true);
  });

  it('applies the threshold only above the boundary', () => {
    expect(requiresStepUp(order({ amountInUsd: '500.00' }))).toBe(false);
    expect(requiresStepUp(order({ amountInUsd: '500.01' }))).toBe(true);
  });

  it('requires a current step-up window above the threshold', () => {
    const high = order({ amountInUsd: '600.00' });

    expect(() => assertStepUp({ session: { stepUpUntil: null } } as never, high)).toThrow(
      /Step-up/,
    );

    expect(() =>
      assertStepUp({ session: { stepUpUntil: new Date(Date.now() - 1000) } } as never, high),
    ).toThrow(/Step-up/);

    expect(() =>
      assertStepUp({ session: { stepUpUntil: new Date(Date.now() + 60_000) } } as never, high),
    ).not.toThrow();
  });
});

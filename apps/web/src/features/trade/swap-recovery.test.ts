import { describe, expect, it } from 'vitest';
import { selectRecoverableSwapOrders } from './swap-recovery';

const now = Date.parse('2026-11-26T16:00:00.000Z');

function order(
  overrides: Partial<{
    id: string;
    status: string;
    txHash: string | null;
    createdAt: string;
    builtAt: string | null;
  }>,
) {
  return {
    id: 'order-1',
    status: 'AWAITING_SIGNATURE',
    txHash: null,
    createdAt: '2026-11-26T15:53:58.000Z',
    builtAt: '2026-11-26T15:53:59.000Z',
    ...overrides,
  };
}

describe('selectRecoverableSwapOrders', () => {
  it('keeps a recent awaiting-signature order without a hash', () => {
    expect(selectRecoverableSwapOrders([order({})], now)).toHaveLength(1);
  });

  it('drops orders that already have a hash or another status', () => {
    expect(selectRecoverableSwapOrders([order({ txHash: `0x${'a'.repeat(64)}` })], now)).toEqual(
      [],
    );
    expect(selectRecoverableSwapOrders([order({ status: 'SUBMITTED' })], now)).toEqual([]);
  });

  it('keeps a recently cancelled order that had a build', () => {
    expect(selectRecoverableSwapOrders([order({ status: 'CANCELLED' })], now)).toHaveLength(1);
    expect(
      selectRecoverableSwapOrders([order({ status: 'CANCELLED', builtAt: null })], now),
    ).toEqual([]);
  });

  it('drops awaiting-signature orders older than the recovery window', () => {
    expect(
      selectRecoverableSwapOrders([order({ createdAt: '2026-11-18T15:53:58.000Z' })], now),
    ).toEqual([]);
    expect(
      selectRecoverableSwapOrders([order({ createdAt: '2026-11-20T16:00:01.000Z' })], now),
    ).toHaveLength(1);
  });
});

import { describe, expect, it } from 'vitest';
import { Reason } from './reason-codes';

describe('Reason', () => {
  it('has a unique value for every code', () => {
    const values = Object.values(Reason);
    expect(values.length).toBeGreaterThan(0);
    expect(new Set(values).size).toBe(values.length);
  });

  it('maps every key to itself', () => {
    for (const [key, value] of Object.entries(Reason)) {
      expect(value).toBe(key);
    }
  });

  it('is frozen', () => {
    expect(Object.isFrozen(Reason)).toBe(true);
  });

  it('reserves the ranking, execution, ledger and paper families', () => {
    const codes = [
      'RANK_COOLDOWN',
      'RANK_BLOCKED',
      'FILL_FILLED',
      'FILL_PARTIAL',
      'FILL_REJECTED',
      'FILL_EXPIRED',
      'FILL_NO_DATA',
      'FILL_INSUFFICIENT_CASH',
      'FILL_LIQUIDITY',
      'FILL_POSITION_EXISTS',
      'FILL_NO_POSITION',
      'FILL_DUPLICATE',
      'LEDGER_BUY',
      'LEDGER_SELL',
      'PAPER_RUN_STARTED',
      'PAPER_RUN_COMPLETED',
      'COOLDOWN_AFTER_STOP',
    ] as const;

    for (const code of codes) {
      expect(Reason[code]).toBe(code);
    }
  });
});

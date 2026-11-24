import { describe, expect, it, vi } from 'vitest';
import { sandboxIntents } from '@nexter/db';
import { Reason, type OrderIntent } from '@nexter/sandbox-core';
import { SandboxRepository, SANDBOX_CANDLE_READ_LIMIT } from './sandbox.repository';

const TOKEN = 'bsc:0x1111111111111111111111111111111111111111';
const RUN = '11111111-1111-4111-8111-111111111111';
const AT = Date.UTC(2026, 0, 1);
const HOUR = 3_600_000;

function row(openTime: number) {
  return {
    openTime: new Date(openTime),
    open: '100.00000000',
    high: '101.00000000',
    low: '99.00000000',
    close: '100.50000000',
    volumeUsd: '100000.000000000000000000',
  };
}

function repoWith(select: ReturnType<typeof vi.fn>): SandboxRepository {
  return new SandboxRepository({ select } as never);
}

describe('SandboxRepository candle reads', () => {
  it('reads one bounded newest-first page per token and reverses it', async () => {
    const rows = [row(AT + 2 * HOUR), row(AT + HOUR), row(AT)];
    const limit = vi.fn(async () => rows);
    const orderBy = vi.fn(() => ({ limit }));
    const where = vi.fn(() => ({ orderBy }));
    const from = vi.fn(() => ({ where }));
    const select = vi.fn(() => ({ from }));
    const repository = repoWith(select);

    const candles = await repository.loadCandles([TOKEN]);

    expect(select).toHaveBeenCalledTimes(1);
    expect(limit).toHaveBeenCalledWith(SANDBOX_CANDLE_READ_LIMIT);
    expect(SANDBOX_CANDLE_READ_LIMIT).toBe(4321);
    expect(candles.map((candle) => candle.openTime)).toEqual([AT, AT + HOUR, AT + 2 * HOUR]);
    expect(candles[0]).toMatchObject({ tokenId: TOKEN, timeframe: '1h', close: '100.50000000' });
  });
});

describe('SandboxRepository pending intents', () => {
  it('returns the inserted row count and persists decision stop/take', async () => {
    const returning = vi.fn(async () => [{ intentId: 'intent-1' }]);
    const onConflictDoNothing = vi.fn(() => ({ returning }));
    const values = vi.fn(() => ({ onConflictDoNothing }));
    const insert = vi.fn(() => ({ values }));
    const repository = new SandboxRepository({ insert } as never);

    const intent: OrderIntent = {
      intentId: 'intent-1',
      tokenId: TOKEN,
      side: 'buy',
      strategyKey: 'trend_pullback',
      strategyVersion: 1,
      reasonCode: Reason.TREND_PULLBACK_ENTRY,
      sizeUsd: '200.00',
      amount: null,
      stopLossPct: '3.00',
      takeProfitPct: '9.00',
      decisionPriceUsd: '100.00000000',
      clockTime: AT,
    };

    const count = await repository.insertPendingIntents({ insert } as never, RUN, [intent]);

    expect(count).toBe(1);
    expect(values).toHaveBeenCalledWith([
      expect.objectContaining({
        runId: RUN,
        intentId: 'intent-1',
        stopLossPct: '3.00',
        takeProfitPct: '9.00',
        status: 'pending',
      }),
    ]);
    expect(onConflictDoNothing).toHaveBeenCalled();
    expect(returning).toHaveBeenCalledWith({ intentId: sandboxIntents.intentId });
  });

  it('returns zero when the pending unique index skips every row', async () => {
    const returning = vi.fn(async () => []);
    const onConflictDoNothing = vi.fn(() => ({ returning }));
    const values = vi.fn(() => ({ onConflictDoNothing }));
    const insert = vi.fn(() => ({ values }));
    const repository = new SandboxRepository({ insert } as never);

    const intent: OrderIntent = {
      intentId: 'intent-1',
      tokenId: TOKEN,
      side: 'buy',
      strategyKey: 'trend_pullback',
      strategyVersion: 1,
      reasonCode: Reason.TREND_PULLBACK_ENTRY,
      sizeUsd: '200.00',
      amount: null,
      stopLossPct: null,
      takeProfitPct: null,
      decisionPriceUsd: '100.00000000',
      clockTime: AT,
    };

    expect(await repository.insertPendingIntents({ insert } as never, RUN, [intent])).toBe(0);
  });
});

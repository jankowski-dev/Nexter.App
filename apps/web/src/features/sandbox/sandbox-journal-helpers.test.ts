import { describe, expect, it } from 'vitest';
import {
  appendSandboxEvents,
  clampSandboxPageLimit,
  defaultSandboxEventFilters,
  filterSandboxEvents,
  filterSandboxIntents,
  filterSandboxTrades,
  flattenSandboxEventPages,
  sandboxEventWhyNot,
  sandboxIntentFiltersActive,
  sandboxIntentFiltersWithOffset,
  sandboxPageState,
  sandboxRiskEvents,
  sandboxTradeFilterActive,
  sandboxTradeFilterWithOffset,
} from './sandbox-journal-helpers';
import {
  sandboxEventFixture,
  sandboxIntentFixture,
  sandboxTokenId,
  sandboxTradeFixture,
} from './sandbox-test-fixtures';

describe('sandbox journal filters', () => {
  const events = [
    sandboxEventFixture({ seq: 1, module: 'risk', severity: 'decision', eventType: 'risk.passed' }),
    sandboxEventFixture({
      seq: 2,
      module: 'execution',
      severity: 'info',
      eventType: 'execution.intent_pending',
      tokenId: 'bsc:0xbbb',
      decision: null,
      riskChecks: [],
      alternatives: [],
    }),
    sandboxEventFixture({
      seq: 3,
      module: 'data',
      severity: 'warn',
      eventType: 'data.stale',
      decision: null,
      riskChecks: [],
      alternatives: [],
    }),
  ];

  it('filters by token, module, severity and event type', () => {
    expect(
      filterSandboxEvents(events, {
        ...defaultSandboxEventFilters,
        tokenId: 'bsc:0xbbb',
      }).map((event) => event.seq),
    ).toEqual([2]);
    expect(
      filterSandboxEvents(events, { ...defaultSandboxEventFilters, module: 'risk' }).map(
        (event) => event.seq,
      ),
    ).toEqual([1]);
    expect(
      filterSandboxEvents(events, { ...defaultSandboxEventFilters, severity: 'warn' }).map(
        (event) => event.seq,
      ),
    ).toEqual([3]);
    expect(
      filterSandboxEvents(events, { ...defaultSandboxEventFilters, eventType: 'INTENT' }).map(
        (event) => event.seq,
      ),
    ).toEqual([2]);
    expect(filterSandboxEvents(events, defaultSandboxEventFilters)).toHaveLength(3);
  });

  it('appends event pages, de-duplicates by seq and keeps ascending order', () => {
    const merged = appendSandboxEvents(
      [sandboxEventFixture({ seq: 1 }), sandboxEventFixture({ seq: 3 })],
      [sandboxEventFixture({ seq: 3, eventType: 'updated' }), sandboxEventFixture({ seq: 2 })],
    );
    expect(merged.map((event) => event.seq)).toEqual([1, 2, 3]);
    expect(merged[2]?.eventType).toBe('updated');
  });

  it('flattens infinite pages with the same dedupe', () => {
    const flattened = flattenSandboxEventPages([
      [sandboxEventFixture({ seq: 1 }), sandboxEventFixture({ seq: 2 })],
      [sandboxEventFixture({ seq: 2, eventType: 'updated' }), sandboxEventFixture({ seq: 3 })],
      [sandboxEventFixture({ seq: 3 }), sandboxEventFixture({ seq: 4 })],
    ]);
    expect(flattened.map((event) => event.seq)).toEqual([1, 2, 3, 4]);
    expect(flattened[1]?.eventType).toBe('updated');
  });

  it('extracts risk-check events and why-not alternatives', () => {
    expect(sandboxRiskEvents(events).map((event) => event.seq)).toEqual([1]);
    expect(sandboxEventWhyNot(events[0]!)).toEqual(['Альтернатива с меньшим приоритетом.']);
    expect(sandboxEventWhyNot(events[1]!)).toEqual([]);
  });

  it('computes offset pagination state', () => {
    expect(sandboxPageState(120, 50, 0)).toMatchObject({
      from: 1,
      to: 50,
      canPrev: false,
      canNext: true,
    });
    expect(sandboxPageState(120, 50, 100)).toMatchObject({
      from: 101,
      to: 120,
      canPrev: true,
      canNext: false,
    });
    expect(sandboxPageState(0, 50, 0)).toMatchObject({ from: 0, to: 0, canNext: false });
  });

  it('filters intents by status, side and token', () => {
    const intents = [
      sandboxIntentFixture({ intentId: 'a', status: 'filled', side: 'buy' }),
      sandboxIntentFixture({
        intentId: 'b',
        status: 'rejected',
        side: 'sell',
        tokenId: 'bsc:0xbbb',
      }),
    ];
    expect(
      filterSandboxIntents(intents, { status: 'rejected', side: 'all', tokenId: null }).map(
        (intent) => intent.intentId,
      ),
    ).toEqual(['b']);
    expect(
      filterSandboxIntents(intents, { status: 'all', side: 'buy', tokenId: sandboxTokenId }).map(
        (intent) => intent.intentId,
      ),
    ).toEqual(['a']);
    expect(
      filterSandboxIntents(intents, { status: 'all', side: 'all', tokenId: null }),
    ).toHaveLength(2);
  });

  it('filters trades by status', () => {
    const trades = [
      sandboxTradeFixture({ tradeId: 'open', status: 'open' }),
      sandboxTradeFixture({ tradeId: 'closed', status: 'closed' }),
    ];
    expect(filterSandboxTrades(trades, 'all')).toHaveLength(2);
    expect(filterSandboxTrades(trades, 'closed').map((trade) => trade.tradeId)).toEqual(['closed']);
  });

  it('clamps page limits to the API range', () => {
    expect(clampSandboxPageLimit(0)).toBe(1);
    expect(clampSandboxPageLimit(9999)).toBe(500);
    expect(clampSandboxPageLimit(Number.NaN)).toBe(50);
  });

  it('resets offset paging whenever an intent/trade filter changes', () => {
    const base = { status: 'all' as const, side: 'all' as const, tokenId: null };
    expect(sandboxIntentFiltersActive(base)).toBe(false);
    expect(sandboxIntentFiltersActive({ ...base, status: 'filled' })).toBe(true);
    expect(sandboxIntentFiltersActive({ ...base, side: 'sell' })).toBe(true);
    expect(sandboxIntentFiltersActive({ ...base, tokenId: sandboxTokenId })).toBe(true);

    const changed = sandboxIntentFiltersWithOffset(
      { ...base, status: 'filled' },
      { status: 'rejected' },
    );
    expect(changed).toEqual({
      filters: { ...base, status: 'rejected' },
      offset: 0,
    });

    expect(sandboxTradeFilterActive('all')).toBe(false);
    expect(sandboxTradeFilterActive('closed')).toBe(true);
    expect(sandboxTradeFilterWithOffset('open')).toEqual({ status: 'open', offset: 0 });
  });
});

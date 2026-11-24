import { describe, expect, it } from 'vitest';
import {
  sandboxAbsolutePnlUsd,
  sandboxCloseConfirmation,
  sandboxCloseEligibility,
  sandboxFreshnessTone,
  sandboxFreshnessWarnings,
  sandboxLastDecision,
  sandboxPositionPnl,
  sandboxRunCounts,
  sandboxRunDrawdownPct,
  sandboxRunReturnPct,
  sandboxRunStaleTokens,
  sandboxTailEventsAfterSeq,
  sandboxTokenStates,
} from './sandbox-dashboard-helpers';
import {
  sandboxEventFixture,
  sandboxPositionFixture,
  sandboxRunDetailFixture,
  sandboxTokenId,
} from './sandbox-test-fixtures';

describe('sandbox dashboard derivations', () => {
  it('derives return and drawdown from contract strings', () => {
    expect(sandboxRunReturnPct({ equityUsd: '1042.00', initialCapitalUsd: '1000.00' })).toBe(
      '4.20',
    );
    expect(sandboxRunReturnPct({ equityUsd: '950.00', initialCapitalUsd: '1000.00' })).toBe(
      '-5.00',
    );
    expect(sandboxRunReturnPct({ equityUsd: '10.00', initialCapitalUsd: '0' })).toBe('0.00');
    expect(sandboxRunDrawdownPct({ equityUsd: '1042.00', peakEquityUsd: '1080.00' })).toBe(
      '3.5185',
    );
    expect(sandboxRunDrawdownPct({ equityUsd: '1200.00', peakEquityUsd: '1080.00' })).toBe(
      '0.0000',
    );
  });

  it('derives the absolute P&L from equity minus initial capital', () => {
    expect(sandboxAbsolutePnlUsd({ equityUsd: '1042.00', initialCapitalUsd: '1000.00' })).toBe(
      '42.00',
    );
    expect(sandboxAbsolutePnlUsd({ equityUsd: '950.00', initialCapitalUsd: '1000.00' })).toBe(
      '-50.00',
    );
  });

  it('computes the exclusive afterSeq of the latest-events tail', () => {
    expect(sandboxTailEventsAfterSeq(0, 200)).toBeNull();
    expect(sandboxTailEventsAfterSeq(1, 200)).toBeNull();
    expect(sandboxTailEventsAfterSeq(200, 200)).toBeNull();
    expect(sandboxTailEventsAfterSeq(201, 200)).toBe(0);
    expect(sandboxTailEventsAfterSeq(1000, 200)).toBe(799);
  });

  it('scopes universe staleness to the run tokens', () => {
    expect(
      sandboxRunStaleTokens(['bsc:0xaaa', 'bsc:0xbbb', 'bsc:0xccc'], ['bsc:0xbbb', 'bsc:0xccc']),
    ).toEqual(['bsc:0xbbb', 'bsc:0xccc']);
    expect(sandboxRunStaleTokens(['bsc:0xaaa'], ['bsc:0xbbb'])).toEqual([]);
  });

  it('derives position P&L from the cost basis and market value', () => {
    const positive = sandboxPositionPnl(sandboxPositionFixture());
    expect(positive.pnlUsd).toBe('16.00');
    expect(positive.pnlPct).toBe('2.67');
    expect(positive.tone).toBe('positive');

    const negative = sandboxPositionPnl(
      sandboxPositionFixture({ costBasisUsd: '600.00', marketValueUsd: '540.00' }),
    );
    expect(negative.pnlUsd).toBe('-60.00');
    expect(negative.pnlPct).toBe('-10.00');
    expect(negative.tone).toBe('negative');

    const flat = sandboxPositionPnl(
      sandboxPositionFixture({ costBasisUsd: '600.00', marketValueUsd: '600.00' }),
    );
    expect(flat.pnlUsd).toBe('0.00');
    expect(flat.tone).toBe('flat');
  });

  it('allows a close only for a running run with a positive amount', () => {
    expect(sandboxCloseEligibility({ status: 'running', amount: '1.00' }).eligible).toBe(true);
    expect(sandboxCloseEligibility({ status: 'paused', amount: '1.00' })).toEqual({
      eligible: false,
      reason: 'Закрытие доступно только у работающего запуска.',
    });
    expect(sandboxCloseEligibility({ status: 'running', amount: '0' }).eligible).toBe(false);
    expect(sandboxCloseEligibility({ status: 'running', amount: '0' }).reason).toContain(
      'нет открытой позиции',
    );
    expect(
      sandboxCloseEligibility({
        status: 'running',
        amount: '1.00',
        archivedAt: '2026-11-24T06:00:00.000Z',
      }),
    ).toMatchObject({ eligible: false, reason: expect.stringContaining('архиве') });
  });

  it('explains the queued close in the confirmation copy', () => {
    const copy = sandboxCloseConfirmation('AAA');
    expect(copy).toMatchObject({
      title: 'Закрыть сделку?',
      confirmLabel: 'Закрыть сделку',
      variant: 'danger',
    });
    expect(copy.description).toContain('следующем закрытом баре 1h');
    expect(copy.description).toContain('Ручная покупка');
  });

  it('derives token regime, decision, position and risk from the latest event', () => {
    const events = [
      sandboxEventFixture({ seq: 2, regime: 'RANGE', severity: 'info' }),
      sandboxEventFixture({
        seq: 5,
        regime: 'TREND_DOWN',
        severity: 'warn',
        decision: {
          action: 'hold',
          sizeUsd: null,
          reasonCode: 'RISK_HOLD',
          reasonText: 'Позиция удерживается.',
        },
        riskChecks: [
          { name: 'drawdown', value: '4%', limit: '15%', passed: true },
          { name: 'cash buffer', value: '4%', limit: '10%', passed: false },
        ],
      }),
      sandboxEventFixture({ seq: 7, tokenId: null, decision: null }),
    ];

    const states = sandboxTokenStates({
      tokens: [
        {
          tokenKey: sandboxTokenId,
          symbol: 'AAA',
          chain: 'bsc',
          contractAddress: null,
          enabled: true,
        },
      ],
      events,
      positions: [sandboxPositionFixture({ amount: '10.00000000' })],
    });

    expect(states).toHaveLength(1);
    expect(states[0]).toMatchObject({
      tokenId: sandboxTokenId,
      symbol: 'AAA',
      regime: 'TREND_DOWN',
      action: 'hold',
      reasonText: 'Позиция удерживается.',
      severity: 'warn',
      positionAmount: '10.00000000',
      riskStatus: 'failed',
      failedRiskChecks: 1,
    });
  });

  it('reads regime/decision/risk from relevant events, not the latest unrelated event', () => {
    const events = [
      sandboxEventFixture({
        seq: 2,
        module: 'risk',
        eventType: 'risk.passed',
        severity: 'decision',
        regime: 'TREND_UP',
        clockTime: '2026-11-24T02:00:00.000Z',
        decision: {
          action: 'hold',
          sizeUsd: null,
          reasonCode: 'RISK_HOLD',
          reasonText: 'Ждём подтверждения.',
        },
        riskChecks: [
          { name: 'drawdown', value: '2%', limit: '15%', passed: true },
          { name: 'liquidity', value: '$90k', limit: '$50k', passed: true },
        ],
      }),
      sandboxEventFixture({
        seq: 9,
        module: 'strategy',
        eventType: 'strategy.evaluated',
        severity: 'info',
        regime: null,
        decision: null,
        riskChecks: [],
        alternatives: [],
        clockTime: '2026-11-24T05:00:00.000Z',
        reasonCode: null,
        reasonText: null,
      }),
      sandboxEventFixture({
        seq: 10,
        module: 'ledger',
        eventType: 'ledger.entry',
        severity: 'info',
        regime: null,
        decision: null,
        riskChecks: [],
        alternatives: [],
        clockTime: '2026-11-24T05:00:01.000Z',
        reasonCode: null,
        reasonText: null,
      }),
    ];

    const [state] = sandboxTokenStates({
      tokens: [
        {
          tokenKey: sandboxTokenId,
          symbol: 'AAA',
          chain: 'bsc',
          contractAddress: null,
          enabled: true,
        },
      ],
      events,
      positions: [],
    });

    expect(state).toMatchObject({
      regime: 'TREND_UP',
      action: 'hold',
      reasonText: 'Ждём подтверждения.',
      severity: 'info',
      lastEventAt: '2026-11-24T05:00:01.000Z',
      riskStatus: 'passed',
      failedRiskChecks: 0,
    });
  });

  it('does not claim a risk result when no event carries risk checks', () => {
    const events = [
      sandboxEventFixture({
        seq: 3,
        regime: 'RANGE',
        decision: null,
        riskChecks: [],
        alternatives: [],
      }),
      sandboxEventFixture({
        seq: 8,
        module: 'strategy',
        eventType: 'strategy.evaluated',
        severity: 'info',
        regime: null,
        decision: null,
        riskChecks: [],
        alternatives: [],
      }),
    ];
    const [state] = sandboxTokenStates({
      tokens: [
        {
          tokenKey: sandboxTokenId,
          symbol: 'AAA',
          chain: 'bsc',
          contractAddress: null,
          enabled: true,
        },
      ],
      events,
      positions: [],
    });
    expect(state?.riskStatus).toBeNull();
    expect(state?.failedRiskChecks).toBe(0);
    expect(state?.action).toBeNull();
    expect(state?.regime).toBe('RANGE');
  });

  it('reports an empty token state when there is no event or position yet', () => {
    const states = sandboxTokenStates({
      tokens: [
        {
          tokenKey: sandboxTokenId,
          symbol: 'AAA',
          chain: 'bsc',
          contractAddress: null,
          enabled: true,
        },
      ],
      events: [],
      positions: [],
    });
    expect(states[0]).toMatchObject({
      regime: null,
      action: null,
      severity: null,
      positionAmount: null,
      failedRiskChecks: 0,
    });
  });

  it('selects the latest decision event by sequence', () => {
    const events = [
      sandboxEventFixture({
        seq: 3,
        decision: { action: 'buy', sizeUsd: '10.00', reasonCode: 'A', reasonText: 'a' },
      }),
      sandboxEventFixture({ seq: 9, decision: null }),
      sandboxEventFixture({
        seq: 6,
        decision: { action: 'sell', sizeUsd: null, reasonCode: 'B', reasonText: 'b' },
        alternatives: [],
      }),
    ];
    expect(sandboxLastDecision(events)).toMatchObject({
      seq: 6,
      action: 'sell',
      sizeUsd: null,
      reasonText: 'b',
      alternatives: 0,
    });
    expect(sandboxLastDecision([])).toBeNull();
    expect(sandboxLastDecision([sandboxEventFixture({ decision: null })])).toBeNull();
  });

  it('explains stale bars, stale candles and stale tokens', () => {
    const now = new Date('2026-11-24T06:00:00.000Z');
    const warnings = sandboxFreshnessWarnings({
      lastBarClose: '2026-11-24T00:00:00.000Z',
      lastTickAt: '2026-11-24T05:50:00.000Z',
      lastCandleAt: '2026-11-24T00:00:00.000Z',
      staleTokens: ['bsc:0xaaa', 'bsc:0xbbb'],
      now,
    });
    const messages = warnings.map((warning) => warning.message).join(' ');
    expect(messages).toContain('Устаревшие данные 1h: 2');
    expect(messages).toContain('Последний закрытый бар старше двух часов');
    expect(messages).toContain('Последняя свеча 1h старше двух часов');
    expect(messages).toContain('Последний тик был больше трёх минут назад');
    expect(sandboxFreshnessTone(warnings)).toBe('danger');
  });

  it('is quiet when the run data is fresh', () => {
    const warnings = sandboxFreshnessWarnings({
      lastBarClose: '2026-11-24T05:00:00.000Z',
      lastTickAt: '2026-11-24T05:59:00.000Z',
      lastCandleAt: '2026-11-24T05:00:00.000Z',
      staleTokens: [],
      now: new Date('2026-11-24T06:00:00.000Z'),
    });
    expect(warnings).toEqual([]);
    expect(sandboxFreshnessTone(warnings)).toBe('ok');
  });

  it('flags a run without a closed bar yet', () => {
    const warnings = sandboxFreshnessWarnings({
      lastBarClose: null,
      lastTickAt: null,
      lastCandleAt: null,
      staleTokens: [],
      now: new Date('2026-11-24T06:00:00.000Z'),
    });
    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.message).toContain('Закрытых баров 1h ещё нет');
    expect(sandboxFreshnessTone(warnings)).toBe('warning');
  });

  it('passes through run counters', () => {
    expect(sandboxRunCounts(sandboxRunDetailFixture())).toEqual({
      positions: 1,
      openTrades: 1,
      closedTrades: 2,
      intents: 4,
      pendingIntents: 0,
      events: 12,
    });
  });
});

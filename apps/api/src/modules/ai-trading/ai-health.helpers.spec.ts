import { describe, expect, it } from 'vitest';
import { evaluateAiBotHealth, type AiHealthInput } from './ai-health.helpers';

const now = new Date('2026-11-20T12:00:00.000Z');

function input(overrides: Partial<AiHealthInput> = {}): AiHealthInput {
  return {
    status: 'running',
    startedAt: new Date('2026-11-18T12:00:00.000Z'),
    lastTickAt: new Date('2026-11-20T11:59:00.000Z'),
    maxDrawdownPct: '3.50',
    maxDailyLossPct: 10,
    budgetUsd: '1000.00',
    equityUsd: '1050.00',
    dailyOpenEquityUsd: '1040.00',
    candidate: {
      status: 'accepted',
      metrics: { horizonDays: 5, maxDrawdownPct: 12, oosWorstReturnPct: -8 },
    },
    recentError: false,
    now,
    ...overrides,
  };
}

describe('AI bot health', () => {
  it('reports ok for a healthy running bot', () => {
    const result = evaluateAiBotHealth(input());
    expect(result.level).toBe('ok');
    expect(result.reasons).toHaveLength(0);
    expect(result.totalPnlPct).toBe('5.00');
    expect(result.horizonDays).toBe(5);
  });

  it('stops on drawdown above the candidate threshold', () => {
    const result = evaluateAiBotHealth(input({ maxDrawdownPct: '20' }));
    expect(result.level).toBe('stop');
    expect(result.reasons.map((reason) => reason.code)).toContain('DRAWDOWN');
  });

  it('stops on daily loss above the bot limit', () => {
    const result = evaluateAiBotHealth(
      input({ dailyOpenEquityUsd: '1200', equityUsd: '1050', maxDailyLossPct: 10 }),
    );
    expect(result.level).toBe('stop');
    expect(result.reasons.map((reason) => reason.code)).toContain('DAILY_LOSS');
  });

  it('reviews stale ticks, expired horizon, low P&L, errors and missing recommendation', () => {
    const result = evaluateAiBotHealth(
      input({
        lastTickAt: new Date('2026-11-20T11:40:00.000Z'),
        startedAt: new Date('2026-11-10T12:00:00.000Z'),
        equityUsd: '900',
        dailyOpenEquityUsd: '900',
        candidate: { status: 'rejected', metrics: { horizonDays: 5, oosWorstReturnPct: -8 } },
        recentError: true,
      }),
    );
    expect(result.level).toBe('review');
    const codes = result.reasons.map((reason) => reason.code);
    expect(codes).toContain('STALE_DATA');
    expect(codes).toContain('HORIZON_EXPIRED');
    expect(codes).toContain('NEGATIVE_PNL');
    expect(codes).toContain('BOT_ERROR');
    expect(codes).toContain('RECOMMENDATION_MISSING');
  });

  it('ignores runtime signals for draft bots', () => {
    const result = evaluateAiBotHealth(
      input({
        status: 'draft',
        startedAt: null,
        lastTickAt: null,
        maxDrawdownPct: '99',
        equityUsd: '10',
        dailyOpenEquityUsd: '1000',
        recentError: true,
      }),
    );
    expect(result.level).toBe('ok');
    expect(result.reasons).toHaveLength(0);
  });
});

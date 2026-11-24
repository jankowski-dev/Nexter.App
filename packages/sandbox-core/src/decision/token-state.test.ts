import { describe, expect, it } from 'vitest';
import { Reason } from './reason-codes';
import { deriveTokenPhase } from './token-state';
import type { TokenStateInput } from './token-state';
import type { PortfolioPosition } from './types';

const NOW = Date.UTC(2026, 0, 2, 0, 0, 0);
const HOUR_MS = 3_600_000;

function position(tokenId: string, overrides: Partial<PortfolioPosition> = {}): PortfolioPosition {
  return {
    tokenId,
    strategyKey: 'trend_pullback',
    strategyVersion: 1,
    amount: '100',
    avgCostUsd: '1',
    marketPriceUsd: '1',
    marketValueUsd: '100',
    openedAt: 0,
    stopLossPct: null,
    takeProfitPct: null,
    ...overrides,
  };
}

function input(overrides: Partial<TokenStateInput> = {}): TokenStateInput {
  return {
    tokenId: 'token',
    position: null,
    previous: null,
    cooldownUntil: null,
    now: NOW,
    regime: 'TREND_UP',
    staleBars: 0,
    hasBuyIntent: false,
    ...overrides,
  };
}

describe('deriveTokenPhase precedence', () => {
  it('puts an open position above cooldown, blocked regime and a buy intent', () => {
    const outcome = deriveTokenPhase(
      input({
        position: position('token'),
        cooldownUntil: NOW + HOUR_MS,
        regime: 'ILLIQUID',
        staleBars: 5,
        hasBuyIntent: true,
      }),
    );

    expect(outcome).toEqual({
      phase: 'IN_POSITION',
      reasonCode: Reason.TOKEN_IN_POSITION,
      changed: true,
    });
  });

  it('puts an active cooldown above a blocked regime and a buy intent', () => {
    const outcome = deriveTokenPhase(
      input({
        cooldownUntil: NOW + HOUR_MS,
        regime: 'UNKNOWN',
        staleBars: 3,
        hasBuyIntent: true,
      }),
    );

    expect(outcome).toEqual({
      phase: 'COOLDOWN',
      reasonCode: Reason.TOKEN_COOLDOWN,
      changed: true,
    });
  });

  it('treats a cooldown ending exactly at now as over', () => {
    const outcome = deriveTokenPhase(
      input({ cooldownUntil: NOW, regime: 'TREND_UP', hasBuyIntent: true }),
    );

    expect(outcome.phase).toBe('ARMED');
    expect(outcome.reasonCode).toBe(Reason.TOKEN_ARMED);
  });

  it('puts a blocked regime above a buy intent', () => {
    const illiquid = deriveTokenPhase(input({ regime: 'ILLIQUID', hasBuyIntent: true }));
    const unknown = deriveTokenPhase(input({ regime: 'UNKNOWN', hasBuyIntent: true }));
    const stale = deriveTokenPhase(input({ regime: 'TREND_UP', staleBars: 1, hasBuyIntent: true }));

    expect(illiquid).toEqual({
      phase: 'BLOCKED',
      reasonCode: Reason.TOKEN_BLOCKED,
      changed: true,
    });
    expect(unknown.phase).toBe('BLOCKED');
    expect(stale.phase).toBe('BLOCKED');
    expect(stale.reasonCode).toBe(Reason.TOKEN_BLOCKED);
  });

  it('puts a buy intent above sleeping', () => {
    const outcome = deriveTokenPhase(input({ regime: 'RANGE', hasBuyIntent: true }));

    expect(outcome).toEqual({
      phase: 'ARMED',
      reasonCode: Reason.TOKEN_ARMED,
      changed: true,
    });
  });

  it('sleeps when no rule applies', () => {
    const outcome = deriveTokenPhase(input({ regime: 'TREND_DOWN' }));

    expect(outcome).toEqual({
      phase: 'SLEEPING',
      reasonCode: Reason.TOKEN_SLEEPING,
      changed: true,
    });
  });

  it('treats every non-blocked regime as eligible for ARMED', () => {
    for (const regime of ['TREND_UP', 'TREND_DOWN', 'RANGE', 'CRASH', 'RECOVERY'] as const) {
      expect(deriveTokenPhase(input({ regime, hasBuyIntent: true })).phase).toBe('ARMED');
    }
  });

  it('does not mutate its input', () => {
    const state = input({ cooldownUntil: NOW + HOUR_MS, regime: 'ILLIQUID', hasBuyIntent: true });
    const before = JSON.parse(JSON.stringify(state)) as TokenStateInput;

    deriveTokenPhase(state);

    expect(state).toEqual(before);
  });
});

describe('deriveTokenPhase change detection', () => {
  it('logs the first observation as a change', () => {
    expect(deriveTokenPhase(input({ previous: null })).changed).toBe(true);
  });

  it('does not log an unchanged phase', () => {
    const outcome = deriveTokenPhase(input({ previous: 'SLEEPING' }));

    expect(outcome.phase).toBe('SLEEPING');
    expect(outcome.changed).toBe(false);
  });

  it('logs every phase transition', () => {
    const transitions = [
      { previous: 'SLEEPING', target: 'ARMED', expected: true },
      { previous: 'ARMED', target: 'SLEEPING', expected: true },
      { previous: 'ARMED', target: 'IN_POSITION', expected: true },
      { previous: 'IN_POSITION', target: 'COOLDOWN', expected: true },
      { previous: 'COOLDOWN', target: 'BLOCKED', expected: true },
      { previous: 'BLOCKED', target: 'ARMED', expected: true },
      { previous: 'ARMED', target: 'ARMED', expected: false },
      { previous: 'BLOCKED', target: 'BLOCKED', expected: false },
    ] as const;

    for (const transition of transitions) {
      const outcome = deriveTokenPhase(
        input({
          previous: transition.previous,
          position: transition.target === 'IN_POSITION' ? position('token') : null,
          cooldownUntil: transition.target === 'COOLDOWN' ? NOW + HOUR_MS : null,
          regime: transition.target === 'BLOCKED' ? 'ILLIQUID' : 'TREND_UP',
          hasBuyIntent: transition.target === 'ARMED',
        }),
      );

      expect(outcome.phase, transition.previous).toBe(transition.target);
      expect(outcome.changed, transition.previous).toBe(transition.expected);
    }
  });
});

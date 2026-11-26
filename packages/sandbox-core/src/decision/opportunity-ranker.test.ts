import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from './defaults';
import { rankOpportunities } from './opportunity-ranker';
import type { OpportunityCandidate } from './opportunity-ranker';
import { Reason } from './reason-codes';
import type { StrategySignal } from './strategies';
import type { SandboxDecisionSettings, StrategyKey } from './types';

function signal(overrides: Partial<StrategySignal> = {}): StrategySignal {
  return {
    action: 'buy',
    reasonCode: Reason.RECOVERY_ENTRY,
    reasonText: 'entry',
    confidence: 0.6,
    riskWeight: 1,
    stopLossPct: '4',
    takeProfitPct: null,
    nextState: {},
    ...overrides,
  };
}

function candidate(
  tokenId: string,
  overrides: Partial<OpportunityCandidate> = {},
): OpportunityCandidate {
  return {
    tokenId,
    strategyKey: 'trend_pullback',
    signal: signal(),
    atrPct: '2',
    avgVolumeUsd: '200000',
    ...overrides,
  };
}

const SETTINGS: SandboxDecisionSettings = DEFAULT_SETTINGS;

function rankedView(
  result: ReturnType<typeof rankOpportunities>,
): Array<{ tokenId: string; strategyKey: StrategyKey; score: string; rank: number }> {
  return result.ranked.map((entry) => ({
    tokenId: entry.tokenId,
    strategyKey: entry.strategyKey,
    score: entry.score,
    rank: entry.rank,
  }));
}

describe('rankOpportunities score', () => {
  it('computes confidence * (1 / (atrPct + 1)) * liquidityFactor', () => {
    const result = rankOpportunities([candidate('token')], SETTINGS);

    expect(result.dropped).toEqual([]);
    expect(result.ranked).toHaveLength(1);
    expect(result.ranked[0]?.score).toBe('0.200000');
    expect(result.ranked[0]?.rank).toBe(1);
  });

  it('applies the linear liquidity factor between the minimum and twice the minimum', () => {
    const result = rankOpportunities([candidate('token', { avgVolumeUsd: '75000' })], SETTINGS);

    // factor = 0.5 + 0.5 * (75000 - 50000) / 50000 = 0.75
    expect(result.ranked[0]?.score).toBe('0.150000');
  });

  it('uses a factor of 0.5 exactly at the minimum and 1 at twice the minimum', () => {
    const atMinimum = rankOpportunities([candidate('token', { avgVolumeUsd: '50000' })], SETTINGS);
    const atTwice = rankOpportunities([candidate('token', { avgVolumeUsd: '100000' })], SETTINGS);

    expect(atMinimum.ranked[0]?.score).toBe('0.100000');
    expect(atTwice.ranked[0]?.score).toBe('0.200000');
  });

  it('respects a custom minLiquidityUsd from settings', () => {
    const settings: SandboxDecisionSettings = {
      ...SETTINGS,
      regime: { ...SETTINGS.regime, minLiquidityUsd: '10000' },
    };
    const result = rankOpportunities([candidate('token', { avgVolumeUsd: '15000' })], settings);

    // min 10000, twice min 20000, so 15000 sits half way: factor 0.75
    expect(result.ranked[0]?.score).toBe('0.150000');
  });

  it('does not drop a low-volume candidate in execution-liquidity mode', () => {
    const settings: SandboxDecisionSettings = {
      ...SETTINGS,
      regime: { ...SETTINGS.regime, liquidityMode: 'execution' },
    };
    const result = rankOpportunities([candidate('token', { avgVolumeUsd: '100' })], settings);

    expect(result.dropped).toEqual([]);
    expect(result.ranked[0]?.score).toBe('0.200000');
  });

  it('sorts by score descending and assigns 1-based ranks', () => {
    const result = rankOpportunities(
      [
        candidate('low', { atrPct: '4' }),
        candidate('high', { atrPct: '0' }),
        candidate('mid', { atrPct: '2' }),
      ],
      SETTINGS,
    );

    expect(rankedView(result)).toEqual([
      { tokenId: 'high', strategyKey: 'trend_pullback', score: '0.600000', rank: 1 },
      { tokenId: 'mid', strategyKey: 'trend_pullback', score: '0.200000', rank: 2 },
      { tokenId: 'low', strategyKey: 'trend_pullback', score: '0.120000', rank: 3 },
    ]);
  });
});

describe('rankOpportunities tie-breaks', () => {
  it('breaks an equal score by higher confidence', () => {
    const lowerConfidence = candidate('token-a', {
      atrPct: '0.5',
      signal: signal({ confidence: 0.5 }),
    });
    const higherConfidence = candidate('token-b', {
      atrPct: '2',
      signal: signal({ confidence: 1 }),
    });

    const result = rankOpportunities([lowerConfidence, higherConfidence], SETTINGS);

    // Both scores are exactly 1/3, so confidence decides.
    expect(result.ranked.map((entry) => entry.tokenId)).toEqual(['token-b', 'token-a']);
    expect(result.ranked[0]?.score).toBe('0.333333');
    expect(result.ranked[1]?.score).toBe('0.333333');
  });

  it('breaks a full tie by tokenId in code-unit order', () => {
    const upper = candidate('Token-1', { signal: signal({ confidence: 0.5 }), atrPct: '0' });
    const lower = candidate('token-1', { signal: signal({ confidence: 0.5 }), atrPct: '0' });

    const result = rankOpportunities([lower, upper], SETTINGS);

    expect(result.ranked.map((entry) => entry.tokenId)).toEqual(['Token-1', 'token-1']);
    expect(result.ranked.map((entry) => entry.score)).toEqual(['0.500000', '0.500000']);
  });

  it('breaks a token tie by strategyKey in code-unit order', () => {
    const trend = candidate('token', {
      strategyKey: 'trend_pullback',
      signal: signal({ confidence: 0.5 }),
      atrPct: '0',
    });
    const range = candidate('token', {
      strategyKey: 'range_reversion',
      signal: signal({ confidence: 0.5 }),
      atrPct: '0',
    });
    const recovery = candidate('token', {
      strategyKey: 'recovery',
      signal: signal({ confidence: 0.5 }),
      atrPct: '0',
    });

    const result = rankOpportunities([trend, recovery, range], SETTINGS);

    expect(result.ranked.map((entry) => entry.strategyKey)).toEqual([
      'range_reversion',
      'recovery',
      'trend_pullback',
    ]);
  });
});

describe('rankOpportunities drops', () => {
  it('drops a candidate below minLiquidityUsd as RANK_ILLIQUID', () => {
    const result = rankOpportunities([candidate('dust', { avgVolumeUsd: '49999.99' })], SETTINGS);

    expect(result.ranked).toEqual([]);
    expect(result.dropped).toHaveLength(1);
    expect(result.dropped[0]?.candidate.tokenId).toBe('dust');
    expect(result.dropped[0]?.reasonCode).toBe(Reason.RANK_ILLIQUID);
    expect(result.dropped[0]?.reasonText.length).toBeGreaterThan(0);
  });

  it.each([
    ['missing ATR', { atrPct: null }],
    ['invalid ATR', { atrPct: 'not-a-number' }],
    ['negative ATR', { atrPct: '-1' }],
    ['infinite ATR', { atrPct: 'Infinity' }],
    ['missing volume', { avgVolumeUsd: null }],
    ['invalid volume', { avgVolumeUsd: 'abc' }],
    ['negative volume', { avgVolumeUsd: '-1' }],
  ] as const)('drops %s as RANK_NO_DATA', (_label, overrides) => {
    const result = rankOpportunities([candidate('token', overrides)], SETTINGS);

    expect(result.ranked).toEqual([]);
    expect(result.dropped).toHaveLength(1);
    expect(result.dropped[0]?.reasonCode).toBe(Reason.RANK_NO_DATA);
  });

  it.each([[-0.01], [1.01], [Number.NaN], [Number.POSITIVE_INFINITY]])(
    'drops confidence %s outside 0..1 as RANK_NO_DATA',
    (confidence) => {
      const result = rankOpportunities(
        [candidate('token', { signal: signal({ confidence }) })],
        SETTINGS,
      );

      expect(result.ranked).toEqual([]);
      expect(result.dropped[0]?.reasonCode).toBe(Reason.RANK_NO_DATA);
    },
  );

  it('accepts confidence 0 and 1', () => {
    const result = rankOpportunities(
      [
        candidate('zero', { atrPct: '0', signal: signal({ confidence: 0 }) }),
        candidate('one', { atrPct: '0', signal: signal({ confidence: 1 }) }),
      ],
      SETTINGS,
    );

    expect(result.ranked.map((entry) => entry.tokenId)).toEqual(['one', 'zero']);
    expect(result.ranked[1]?.score).toBe('0.000000');
  });

  it('orders drops deterministically by tokenId then strategyKey', () => {
    const result = rankOpportunities(
      [
        candidate('token-b', { avgVolumeUsd: '1000' }),
        candidate('Token-a', { avgVolumeUsd: '1000' }),
        candidate('token-b', { strategyKey: 'recovery', avgVolumeUsd: null }),
      ],
      SETTINGS,
    );

    expect(result.ranked).toEqual([]);
    expect(
      result.dropped.map((drop) => [drop.candidate.tokenId, drop.candidate.strategyKey]),
    ).toEqual([
      ['Token-a', 'trend_pullback'],
      ['token-b', 'recovery'],
      ['token-b', 'trend_pullback'],
    ]);
  });
});

describe('rankOpportunities determinism', () => {
  it('does not depend on the input order', () => {
    const candidates = [
      candidate('token-c', { atrPct: '4' }),
      candidate('token-a', { atrPct: '0' }),
      candidate('token-b', { atrPct: '2' }),
      candidate('dust', { avgVolumeUsd: '100' }),
      candidate('Token-d', { atrPct: '1' }),
    ];

    const forward = rankOpportunities(candidates, SETTINGS);
    const reversed = rankOpportunities([...candidates].reverse(), SETTINGS);

    expect(rankedView(reversed)).toEqual(rankedView(forward));
    expect(reversed.dropped.map((drop) => drop.candidate.tokenId)).toEqual(
      forward.dropped.map((drop) => drop.candidate.tokenId),
    );
  });

  it('does not mutate the input array', () => {
    const first = candidate('token-a');
    const second = candidate('token-b', { atrPct: '0' });
    const candidates = [first, second];

    rankOpportunities(candidates, SETTINGS);

    expect(candidates[0]).toBe(first);
    expect(candidates[1]).toBe(second);
  });

  it('handles an empty candidate list', () => {
    expect(rankOpportunities([], SETTINGS)).toEqual({ ranked: [], dropped: [] });
  });
});

import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from './defaults';
import type { OpportunityCandidate, RankedOpportunity } from './opportunity-ranker';
import { allocateOpportunities } from './portfolio-allocator';
import { Reason } from './reason-codes';
import { checkBuyRisk } from './risk-manager';
import type { StrategySignal } from './strategies';
import type { PortfolioPosition, PortfolioSnapshot, SandboxDecisionSettings } from './types';

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

function ranked(
  tokenId: string,
  rank: number,
  overrides: Partial<OpportunityCandidate> = {},
): RankedOpportunity {
  return { ...candidate(tokenId, overrides), score: '0.200000', rank };
}

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

function portfolio(
  options: {
    equity?: string;
    cash?: string;
    positions?: readonly PortfolioPosition[];
  } = {},
): PortfolioSnapshot {
  const equity = options.equity ?? '1000';
  return {
    equityUsd: equity,
    cashUsd: options.cash ?? equity,
    dayStartEquityUsd: equity,
    peakEquityUsd: equity,
    positions: options.positions ?? [],
  };
}

function settings(overrides: Partial<SandboxDecisionSettings> = {}): SandboxDecisionSettings {
  return { ...DEFAULT_SETTINGS, ...overrides };
}

// Generous caps so one intended constraint is the only minimum in a test.
const OPEN_CAPS: Partial<SandboxDecisionSettings> = {
  maxPositions: 5,
  maxTokenExposurePct: 50,
  maxStrategyExposurePct: 80,
  cashBufferPct: 10,
  perTradeRiskPct: 5,
  minOrderUsd: '10',
  liquidityCapPct: 100,
};

describe('allocateOpportunities caps', () => {
  it('binds the token cap', () => {
    const result = allocateOpportunities(
      [ranked('new', 1, { strategyKey: 'recovery', signal: signal({ stopLossPct: '1' }) })],
      portfolio({
        positions: [position('held', { marketValueUsd: '150' })],
      }),
      settings({ ...OPEN_CAPS, maxTokenExposurePct: 5 }),
    );

    // equity 1000 * 5% = 50 for the new token, which has no current value.
    expect(result.drops).toEqual([]);
    expect(result.allocations).toHaveLength(1);
    expect(result.allocations[0]?.sizeUsd).toBe('50.00');
    expect(result.allocations[0]?.bindingConstraint).toBe(Reason.ALLOC_TOKEN_CAP);
  });

  it('applies the token cap independently to each token', () => {
    // The engine only ranks tokens without a position, so current token
    // exposure is zero for every candidate; the cap applies per token.
    const result = allocateOpportunities(
      [
        ranked('first', 1, { strategyKey: 'trend_pullback', signal: signal({ stopLossPct: '1' }) }),
        ranked('second', 2, { strategyKey: 'recovery', signal: signal({ stopLossPct: '1' }) }),
      ],
      portfolio(),
      settings({ ...OPEN_CAPS, maxTokenExposurePct: 10 }),
    );

    // Two different tokens: each gets the full 10% token cap.
    expect(result.allocations.map((entry) => entry.sizeUsd)).toEqual(['100.00', '100.00']);
    expect(result.allocations.map((entry) => entry.bindingConstraint)).toEqual([
      Reason.ALLOC_TOKEN_CAP,
      Reason.ALLOC_TOKEN_CAP,
    ]);
  });

  it('binds the strategy cap', () => {
    const result = allocateOpportunities(
      [ranked('new', 1, { strategyKey: 'trend_pullback', signal: signal({ stopLossPct: '1' }) })],
      portfolio({
        positions: [position('held', { strategyKey: 'trend_pullback', marketValueUsd: '350' })],
      }),
      settings({ ...OPEN_CAPS, maxStrategyExposurePct: 40 }),
    );

    // equity 1000 * 40% = 400, minus 350 already in trend_pullback = 50.
    expect(result.allocations).toHaveLength(1);
    expect(result.allocations[0]?.sizeUsd).toBe('50.00');
    expect(result.allocations[0]?.bindingConstraint).toBe(Reason.ALLOC_STRATEGY_CAP);
  });

  it('binds the cash buffer with the available cash above the buffer', () => {
    const result = allocateOpportunities(
      [ranked('new', 1, { signal: signal({ stopLossPct: '1' }) })],
      portfolio({ cash: '150' }),
      settings(OPEN_CAPS),
    );

    // cash 150 - equity 1000 * 10% buffer = 50 available.
    expect(result.allocations).toHaveLength(1);
    expect(result.allocations[0]?.sizeUsd).toBe('50.00');
    expect(result.allocations[0]?.bindingConstraint).toBe(Reason.ALLOC_CASH_BUFFER);
  });

  it('allows no allocations when cash is already at the buffer', () => {
    const result = allocateOpportunities(
      [ranked('a', 1), ranked('b', 2)],
      portfolio({ cash: '100' }),
      settings(OPEN_CAPS),
    );

    expect(result.allocations).toEqual([]);
    expect(result.drops).toHaveLength(2);
    expect(result.drops.map((drop) => drop.reasonCode)).toEqual([
      Reason.ALLOC_CASH_BUFFER,
      Reason.ALLOC_CASH_BUFFER,
    ]);
  });

  it('allows no allocations when cash is below the buffer', () => {
    const result = allocateOpportunities(
      [ranked('a', 1)],
      portfolio({ cash: '50' }),
      settings(OPEN_CAPS),
    );

    expect(result.allocations).toEqual([]);
    expect(result.drops[0]?.reasonCode).toBe(Reason.ALLOC_CASH_BUFFER);
  });

  it('binds the per-trade risk cap', () => {
    const result = allocateOpportunities(
      [ranked('new', 1, { signal: signal({ stopLossPct: '4', riskWeight: 1 }) })],
      portfolio(),
      settings({ ...OPEN_CAPS, perTradeRiskPct: 1 }),
    );

    // equity 1000 * 1% = 10 risk; 10 / 4% = 250 size.
    expect(result.allocations).toHaveLength(1);
    expect(result.allocations[0]?.sizeUsd).toBe('250.00');
    expect(result.allocations[0]?.bindingConstraint).toBe(Reason.ALLOC_RISK_CAP);
  });

  it('scales the per-trade risk cap by the signal risk weight', () => {
    const result = allocateOpportunities(
      [ranked('new', 1, { signal: signal({ stopLossPct: '4', riskWeight: 0.5 }) })],
      portfolio(),
      settings({ ...OPEN_CAPS, perTradeRiskPct: 1 }),
    );

    // risk 10 * 0.5 = 5; 5 / 4% = 125.
    expect(result.allocations[0]?.sizeUsd).toBe('125.00');
    expect(result.allocations[0]?.bindingConstraint).toBe(Reason.ALLOC_RISK_CAP);
  });

  it('binds the liquidity cap', () => {
    const result = allocateOpportunities(
      [
        ranked('new', 1, {
          avgVolumeUsd: '50000',
          signal: signal({ stopLossPct: '1' }),
        }),
      ],
      portfolio(),
      settings({ ...OPEN_CAPS, liquidityCapPct: 0.1 }),
    );

    // 50000 * 0.1% = 50.
    expect(result.allocations).toHaveLength(1);
    expect(result.allocations[0]?.sizeUsd).toBe('50.00');
    expect(result.allocations[0]?.bindingConstraint).toBe(Reason.ALLOC_LIQUIDITY_CAP);
  });
});

describe('allocateOpportunities drops', () => {
  it('drops a size below minOrderUsd', () => {
    const result = allocateOpportunities(
      [ranked('new', 1, { signal: signal({ stopLossPct: '1' }) })],
      portfolio({ cash: '105' }),
      settings(OPEN_CAPS),
    );

    // cash available 5, below the 10 USD minimum order.
    expect(result.allocations).toEqual([]);
    expect(result.drops).toHaveLength(1);
    expect(result.drops[0]?.reasonCode).toBe(Reason.ALLOC_SIZE_TOO_SMALL);
  });

  it('drops a candidate whose token already has a position', () => {
    const result = allocateOpportunities(
      [ranked('held', 1), ranked('new', 2, { signal: signal({ stopLossPct: '1' }) })],
      portfolio({ positions: [position('held')] }),
      settings(OPEN_CAPS),
    );

    expect(result.allocations).toHaveLength(1);
    expect(result.allocations[0]?.candidate.tokenId).toBe('new');
    expect(result.drops).toHaveLength(1);
    expect(result.drops[0]?.candidate.tokenId).toBe('held');
    expect(result.drops[0]?.reasonCode).toBe(Reason.ALLOC_EXISTING_POSITION);
  });

  it('drops the current and all remaining candidates when max positions is reached', () => {
    const result = allocateOpportunities(
      [ranked('a', 1), ranked('b', 2), ranked('c', 3)],
      portfolio({ positions: [position('held')] }),
      settings({ ...OPEN_CAPS, maxPositions: 1 }),
    );

    expect(result.allocations).toEqual([]);
    expect(result.drops.map((drop) => drop.candidate.tokenId)).toEqual(['a', 'b', 'c']);
    expect(result.drops.map((drop) => drop.reasonCode)).toEqual([
      Reason.ALLOC_MAX_POSITIONS,
      Reason.ALLOC_MAX_POSITIONS,
      Reason.ALLOC_MAX_POSITIONS,
    ]);
  });

  it('drops candidates after the first accepted allocation fills the last slot', () => {
    const result = allocateOpportunities(
      [ranked('a', 1, { signal: signal({ stopLossPct: '1' }) }), ranked('b', 2)],
      portfolio(),
      settings({ ...OPEN_CAPS, maxPositions: 1 }),
    );

    expect(result.allocations).toHaveLength(1);
    expect(result.allocations[0]?.candidate.tokenId).toBe('a');
    expect(result.drops).toHaveLength(1);
    expect(result.drops[0]?.candidate.tokenId).toBe('b');
    expect(result.drops[0]?.reasonCode).toBe(Reason.ALLOC_MAX_POSITIONS);
  });

  it.each(['0', '0.00', '-1', 'not-a-number'])(
    'drops a non-positive or invalid stop %s as ALLOC_INVALID_STOP',
    (stopLossPct) => {
      const result = allocateOpportunities(
        [ranked('new', 1, { signal: signal({ stopLossPct }) })],
        portfolio(),
        settings(OPEN_CAPS),
      );

      expect(result.allocations).toEqual([]);
      expect(result.drops[0]?.reasonCode).toBe(Reason.ALLOC_INVALID_STOP);
    },
  );

  it('falls back to defaultStopPct when the signal has no stop', () => {
    const result = allocateOpportunities(
      [ranked('new', 1, { signal: signal({ stopLossPct: null }) })],
      portfolio(),
      settings({ ...OPEN_CAPS, perTradeRiskPct: 1, defaultStopPct: 3 }),
    );

    expect(result.allocations).toHaveLength(1);
    expect(Number(result.allocations[0]?.stopLossPct)).toBe(3);
    expect(result.allocations[0]?.bindingConstraint).toBe(Reason.ALLOC_RISK_CAP);
    expect(result.allocations[0]?.sizeUsd).toBe('333.33');
  });

  it('drops a zero or negative risk budget as ALLOC_RISK_CAP', () => {
    const zeroWeight = allocateOpportunities(
      [ranked('a', 1, { signal: signal({ stopLossPct: '4', riskWeight: 0 }) })],
      portfolio(),
      settings(OPEN_CAPS),
    );
    const negativeWeight = allocateOpportunities(
      [ranked('b', 1, { signal: signal({ stopLossPct: '4', riskWeight: -1 }) })],
      portfolio(),
      settings(OPEN_CAPS),
    );

    expect(zeroWeight.drops[0]?.reasonCode).toBe(Reason.ALLOC_RISK_CAP);
    expect(negativeWeight.drops[0]?.reasonCode).toBe(Reason.ALLOC_RISK_CAP);
  });
});

describe('allocateOpportunities sequencing and output', () => {
  it('reduces available cash after every accepted allocation', () => {
    const result = allocateOpportunities(
      [
        ranked('a', 1, { signal: signal({ stopLossPct: '1' }) }),
        ranked('b', 2, { signal: signal({ stopLossPct: '1' }) }),
        ranked('c', 3, { signal: signal({ stopLossPct: '1' }) }),
      ],
      portfolio({ cash: '500' }),
      settings({ ...OPEN_CAPS, maxTokenExposurePct: 30 }),
    );

    // available 400; token cap 300 -> a=300, then b gets the remaining 100,
    // then c sees zero cash and is dropped.
    expect(result.allocations.map((entry) => entry.sizeUsd)).toEqual(['300.00', '100.00']);
    expect(result.allocations.map((entry) => entry.bindingConstraint)).toEqual([
      Reason.ALLOC_TOKEN_CAP,
      Reason.ALLOC_CASH_BUFFER,
    ]);
    expect(result.drops).toHaveLength(1);
    expect(result.drops[0]?.candidate.tokenId).toBe('c');
    expect(result.drops[0]?.reasonCode).toBe(Reason.ALLOC_CASH_BUFFER);
  });

  it('keeps decimal money free of float drift', () => {
    const result = allocateOpportunities(
      [ranked('a', 1), ranked('b', 2), ranked('c', 3), ranked('d', 4)],
      portfolio({ equity: '1', cash: '0.30' }),
      settings({
        ...OPEN_CAPS,
        maxTokenExposurePct: 10,
        maxStrategyExposurePct: 100,
        cashBufferPct: 0,
        perTradeRiskPct: 100,
        minOrderUsd: '0.01',
      }),
    );

    expect(result.allocations.map((entry) => entry.sizeUsd)).toEqual(['0.10', '0.10', '0.10']);
    for (const allocation of result.allocations) {
      expect(allocation.sizeUsd).toMatch(/^\d+\.\d{2}$/);
    }
    // 0.30 USD is fully spent by exact decimal arithmetic, so the fourth
    // candidate is rejected by the exhausted cash buffer, not by rounding.
    expect(result.drops).toHaveLength(1);
    expect(result.drops[0]?.candidate.tokenId).toBe('d');
    expect(result.drops[0]?.reasonCode).toBe(Reason.ALLOC_CASH_BUFFER);
  });

  it('returns the signal take profit untouched', () => {
    const result = allocateOpportunities(
      [ranked('new', 1, { signal: signal({ takeProfitPct: '6.5' }) })],
      portfolio(),
      settings(OPEN_CAPS),
    );

    expect(result.allocations[0]?.takeProfitPct).toBe('6.5');
  });

  it('processes candidates in rank order regardless of input order', () => {
    const first = ranked('first', 1, { signal: signal({ stopLossPct: '1' }) });
    const second = ranked('second', 2, { signal: signal({ stopLossPct: '1' }) });
    const input = [second, first];

    const result = allocateOpportunities(input, portfolio(), settings(OPEN_CAPS));

    expect(result.allocations.map((entry) => entry.candidate.tokenId)).toEqual(['first', 'second']);
    expect(input[0]).toBe(second);
    expect(input[1]).toBe(first);
  });

  it('allocates a duplicate token only once and adds it to the held set', () => {
    const result = allocateOpportunities(
      [
        ranked('shared', 1, { signal: signal({ stopLossPct: '10' }) }),
        ranked('shared', 2, { strategyKey: 'recovery', signal: signal({ stopLossPct: '10' }) }),
        ranked('other', 3, { signal: signal({ stopLossPct: '10' }) }),
      ],
      portfolio(),
      settings({
        ...OPEN_CAPS,
        maxPositions: 2,
        maxTokenExposurePct: 100,
        maxStrategyExposurePct: 100,
        cashBufferPct: 0,
        perTradeRiskPct: 1,
      }),
    );

    // Risk binds at 100 USD per candidate. Without the accepted-token guard
    // the second `shared` candidate would allocate again and fill both slots,
    // pushing `other` out with ALLOC_MAX_POSITIONS.
    expect(result.allocations.map((entry) => entry.candidate.tokenId)).toEqual(['shared', 'other']);
    expect(result.allocations.map((entry) => entry.sizeUsd)).toEqual(['100.00', '100.00']);
    expect(result.drops).toHaveLength(1);
    expect(result.drops[0]?.candidate.tokenId).toBe('shared');
    expect(result.drops[0]?.reasonCode).toBe(Reason.ALLOC_EXISTING_POSITION);
  });

  it('does not mutate the portfolio snapshot', () => {
    const snapshot = portfolio({ positions: [position('held')] });
    const before = JSON.parse(JSON.stringify(snapshot)) as PortfolioSnapshot;

    allocateOpportunities([ranked('new', 1)], snapshot, settings(OPEN_CAPS));

    expect(snapshot).toEqual(before);
    expect(snapshot.positions).toHaveLength(1);
  });

  it('handles an empty ranked list', () => {
    expect(allocateOpportunities([], portfolio(), settings(OPEN_CAPS))).toEqual({
      allocations: [],
      drops: [],
    });
  });
});

describe('allocateOpportunities cent truncation', () => {
  it('emits a floored cap size that still passes every risk check', () => {
    // equity 992.14 * 20% = 198.428; half-up would emit 198.43 and the risk
    // manager would veto its own allocation (value 20.00 == limit 20.00).
    const capSettings = settings({
      ...OPEN_CAPS,
      maxTokenExposurePct: 20,
      perTradeRiskPct: 1,
      liquidityCapPct: 1,
    });
    const snapshot = portfolio({ equity: '992.14' });
    const candidates = [
      ranked('new', 1, { strategyKey: 'recovery', signal: signal({ stopLossPct: '3' }) }),
    ];

    const result = allocateOpportunities(candidates, snapshot, capSettings);

    expect(result.drops).toEqual([]);
    expect(result.allocations).toHaveLength(1);
    const allocation = result.allocations[0];
    expect(allocation?.sizeUsd).toBe('198.42');
    expect(allocation?.bindingConstraint).toBe(Reason.ALLOC_TOKEN_CAP);
    expect(allocation).toBeDefined();
    if (allocation === undefined) throw new Error('unreachable');

    const outcome = checkBuyRisk({
      tokenId: 'new',
      strategyKey: 'recovery',
      sizeUsd: allocation.sizeUsd,
      stopLossPct: allocation.stopLossPct,
      riskWeight: 1,
      context: {
        now: 0,
        portfolio: snapshot,
        settings: capSettings,
        phases: { new: 'SLEEPING' },
        features: {
          new: {
            bars: 300,
            lastClose: '1',
            fastSma: '1',
            slowSma: '1',
            longSma: null,
            atrPct: '1',
            recentHigh: '1',
            recentLow: '1',
            avgVolumeUsd: '200000.00',
            drawdownPct: '0',
            staleBars: 0,
          },
        },
      },
    });

    expect(outcome.passed).toBe(true);
    expect(outcome.failedCode).toBeNull();
    expect(outcome.checks.every((check) => check.passed)).toBe(true);
  });

  it('drops a size whose floored value falls below minOrderUsd', () => {
    // equity 100.04 * 10% = 10.004; the exact size meets minOrder 10.004, but
    // the emitted size is 10.00, so the allocation must be dropped.
    const result = allocateOpportunities(
      [ranked('new', 1, { strategyKey: 'recovery', signal: signal({ stopLossPct: '1' }) })],
      portfolio({ equity: '100.04' }),
      settings({ ...OPEN_CAPS, maxTokenExposurePct: 10, minOrderUsd: '10.004' }),
    );

    expect(result.allocations).toEqual([]);
    expect(result.drops).toHaveLength(1);
    expect(result.drops[0]?.reasonCode).toBe(Reason.ALLOC_SIZE_TOO_SMALL);
    expect(result.drops[0]?.reasonText).toContain('10.00');
  });

  it('accounts with the floored size so later allocations see the emitted cash', () => {
    // equity 1000.02 puts the 20% token cap at 200.004, so the first order
    // emits 200.00 (0.004 less than the exact size). Cash is 210.00, so the
    // second candidate is cash-capped: floored accounting leaves exactly 10.00
    // and it is allocated; exact-size accounting would leave 9.996, floor to
    // 9.99 and drop it below the 10.00 minimum order.
    const result = allocateOpportunities(
      [
        ranked('first', 1, {
          strategyKey: 'trend_pullback',
          signal: signal({ stopLossPct: '10' }),
        }),
        ranked('second', 2, { strategyKey: 'recovery', signal: signal({ stopLossPct: '10' }) }),
      ],
      portfolio({
        equity: '1000.02',
        cash: '210.00',
        positions: [position('held', { strategyKey: 'range_reversion', marketValueUsd: '790.02' })],
      }),
      settings({
        ...OPEN_CAPS,
        maxTokenExposurePct: 20,
        cashBufferPct: 0,
        perTradeRiskPct: 5,
        liquidityCapPct: 100,
      }),
    );

    expect(result.allocations.map((entry) => entry.sizeUsd)).toEqual(['200.00', '10.00']);
    expect(result.allocations.map((entry) => entry.bindingConstraint)).toEqual([
      Reason.ALLOC_TOKEN_CAP,
      Reason.ALLOC_CASH_BUFFER,
    ]);
    expect(result.drops).toEqual([]);
  });
});

import { describe, expect, it } from 'vitest';
import { Reason } from '../decision/reason-codes';
import type { StrategyKey } from '../decision/types';
import { PaperMetricsError, buildEquityCurve, computeMetrics } from './metrics';
import type {
  EquityObservation,
  EquityPoint,
  MetricsInput,
  PaperLedgerState,
  PaperTrade,
} from './types';

const HOUR = 3_600_000;
const T0 = Date.UTC(2026, 0, 1);
const MONEY = /^-?\d+\.\d{2}$/;

function point(
  index: number,
  equityUsd: string,
  cashUsd: string,
  positionsValueUsd: string,
  drawdownPct = '0.00',
): EquityPoint {
  return {
    clockTime: T0 + index * HOUR,
    equityUsd,
    cashUsd,
    positionsValueUsd,
    drawdownPct,
  };
}

function observation(
  index: number,
  equityUsd: string,
  cashUsd: string,
  positionsValueUsd: string,
): EquityObservation {
  return {
    clockTime: T0 + index * HOUR,
    equityUsd,
    cashUsd,
    positionsValueUsd,
  };
}

function makeLedger(overrides: Partial<PaperLedgerState> = {}): PaperLedgerState {
  return {
    cashUsd: '1000.00',
    initialCapitalUsd: '1000.00',
    positions: {},
    entries: [],
    realizedPnlUsd: '0.00',
    feesPaidUsd: '0.00',
    closedTrades: [],
    openTrades: {},
    ...overrides,
  };
}

function makeTrade(input: {
  readonly tradeId: string;
  readonly tokenId: string;
  readonly strategyKey: StrategyKey;
  readonly realizedPnlUsd: string;
}): PaperTrade {
  return {
    tradeId: input.tradeId,
    tokenId: input.tokenId,
    strategyKey: input.strategyKey,
    strategyVersion: 1,
    entryAt: T0,
    entryPriceUsd: '100.00000000',
    entryAmount: '1.00000000',
    entryNotionalUsd: '100.00',
    entryFeeUsd: '0.25',
    entryCostBasisUsd: '100.25',
    entryIntentId: `${input.tradeId}:entry`,
    exitAt: T0 + HOUR,
    exitPriceUsd: '110.00000000',
    exitAmount: '1.00000000',
    exitNotionalUsd: '110.00',
    exitFeeUsd: '0.28',
    exitReasonCode: Reason.TREND_PULLBACK_STOP,
    exitIntentId: `${input.tradeId}:exit`,
    realizedPnlUsd: input.realizedPnlUsd,
    status: 'closed',
  };
}

function makeInput(overrides: Partial<MetricsInput> = {}): MetricsInput {
  return {
    initialCapitalUsd: '1000.00',
    finalEquityUsd: '1000.00',
    finalPositionsValueUsd: '0.00',
    unrealizedPnlUsd: '0.00',
    equityCurve: [],
    ledger: makeLedger(),
    closedTrades: [],
    ...overrides,
  };
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    for (const key of Object.keys(value)) {
      deepFreeze((value as Record<string, unknown>)[key]);
    }
    Object.freeze(value);
  }
  return value;
}

describe('buildEquityCurve', () => {
  it('computes drawdown from the initial capital as the starting peak', () => {
    const curve = buildEquityCurve({
      initialCapitalUsd: '1000',
      points: [
        observation(0, '1000', '1000', '0'),
        observation(1, '1100', '500', '600'),
        observation(2, '990', '500', '490'),
        observation(3, '1050', '1050', '0'),
      ],
    });

    expect(curve).toEqual([
      point(0, '1000.00', '1000.00', '0.00', '0.00'),
      point(1, '1100.00', '500.00', '600.00', '0.00'),
      point(2, '990.00', '500.00', '490.00', '10.00'),
      point(3, '1050.00', '1050.00', '0.00', '4.55'),
    ]);
  });

  it('measures the first point against the initial capital', () => {
    const curve = buildEquityCurve({
      initialCapitalUsd: '1000.00',
      points: [observation(0, '900', '900', '0')],
    });

    expect(curve[0]).toEqual(point(0, '900.00', '900.00', '0.00', '10.00'));
  });

  it('returns an empty curve for no observations', () => {
    expect(buildEquityCurve({ initialCapitalUsd: '1000.00', points: [] })).toEqual([]);
  });

  it('rejects a non-positive initial capital like computeMetrics', () => {
    expect(() => buildEquityCurve({ initialCapitalUsd: '0.00', points: [] })).toThrow(
      PaperMetricsError,
    );
    expect(() => buildEquityCurve({ initialCapitalUsd: '-1.00', points: [] })).toThrow(
      PaperMetricsError,
    );
  });

  it('does not mutate its input', () => {
    const input = deepFreeze({
      initialCapitalUsd: '1000.00',
      points: [observation(0, '1000', '1000', '0'), observation(1, '900', '900', '0')],
    });

    const curve = buildEquityCurve(input);

    expect(curve).toHaveLength(2);
    expect(input.points[0]).toEqual(observation(0, '1000', '1000', '0'));
  });
});

describe('computeMetrics', () => {
  it('computes return, peak, drawdown, exposure and time in market', () => {
    const input = deepFreeze(
      makeInput({
        finalEquityUsd: '1050.00',
        ledger: makeLedger({ cashUsd: '1050.00' }),
        equityCurve: [
          point(0, '1000.00', '1000.00', '0.00'),
          point(1, '1100.00', '500.00', '600.00'),
          point(2, '990.00', '500.00', '490.00'),
          point(3, '1050.00', '1050.00', '0.00'),
        ],
      }),
    );

    const metrics = computeMetrics(input);

    expect(metrics.initialCapitalUsd).toBe('1000.00');
    expect(metrics.finalEquityUsd).toBe('1050.00');
    expect(metrics.totalReturnPct).toBe('5.00');
    expect(metrics.peakEquityUsd).toBe('1100.00');
    expect(metrics.maxDrawdownPct).toBe('10.00');
    expect(metrics.finalCashUsd).toBe('1050.00');
    expect(metrics.finalPositionsValueUsd).toBe('0.00');
    expect(metrics.timeInMarketPct).toBe('50.00');
    // (0 + 600/1100 + 490/990 + 0) / 4 * 100
    expect(metrics.averageExposurePct).toBe('26.01');
    expect(metrics.tradeCount).toBe(0);
    expect(metrics.winRatePct).toBeNull();
    expect(metrics.profitFactor).toBeNull();
    expect(metrics.averageWinUsd).toBeNull();
    expect(metrics.averageLossUsd).toBeNull();
    expect(metrics.perStrategy).toEqual([]);
    expect(metrics.perToken).toEqual([]);
  });

  it('computes win rate, profit factor and average win/loss from closed trades', () => {
    const trades = [
      makeTrade({
        tradeId: 'trade-win',
        tokenId: 'alpha',
        strategyKey: 'trend_pullback',
        realizedPnlUsd: '20.00',
      }),
      makeTrade({
        tradeId: 'trade-loss',
        tokenId: 'beta',
        strategyKey: 'trend_pullback',
        realizedPnlUsd: '-10.00',
      }),
    ];
    const input = deepFreeze(
      makeInput({
        finalEquityUsd: '1010.00',
        ledger: makeLedger({ cashUsd: '1010.00', realizedPnlUsd: '10.00', feesPaidUsd: '2.00' }),
        equityCurve: [
          point(0, '1000.00', '1000.00', '0.00'),
          point(1, '1020.00', '1020.00', '0.00'),
          point(2, '1010.00', '1010.00', '0.00'),
        ],
        closedTrades: trades,
      }),
    );

    const metrics = computeMetrics(input);

    expect(metrics.realizedPnlUsd).toBe('10.00');
    expect(metrics.unrealizedPnlUsd).toBe('0.00');
    expect(metrics.feesPaidUsd).toBe('2.00');
    expect(metrics.tradeCount).toBe(2);
    expect(metrics.wins).toBe(1);
    expect(metrics.losses).toBe(1);
    expect(metrics.winRatePct).toBe('50.00');
    expect(metrics.profitFactor).toBe('2.00');
    expect(metrics.averageWinUsd).toBe('20.00');
    expect(metrics.averageLossUsd).toBe('-10.00');
  });

  it('returns a null profit factor and average loss when there are no losses', () => {
    const trades = [
      makeTrade({
        tradeId: 'trade-1',
        tokenId: 'alpha',
        strategyKey: 'trend_pullback',
        realizedPnlUsd: '20.00',
      }),
      makeTrade({
        tradeId: 'trade-2',
        tokenId: 'alpha',
        strategyKey: 'mean_reversion',
        realizedPnlUsd: '10.00',
      }),
    ];

    const metrics = computeMetrics(
      makeInput({
        finalEquityUsd: '1030.00',
        ledger: makeLedger({ cashUsd: '1030.00', realizedPnlUsd: '30.00' }),
        unrealizedPnlUsd: '12.35',
        closedTrades: trades,
      }),
    );

    expect(metrics.winRatePct).toBe('100.00');
    expect(metrics.profitFactor).toBeNull();
    expect(metrics.averageWinUsd).toBe('15.00');
    expect(metrics.averageLossUsd).toBeNull();
    expect(metrics.unrealizedPnlUsd).toBe('12.35');
  });

  it('returns a zero profit factor when every trade loses', () => {
    const trades = [
      makeTrade({
        tradeId: 'trade-1',
        tokenId: 'alpha',
        strategyKey: 'trend_pullback',
        realizedPnlUsd: '-10.00',
      }),
      makeTrade({
        tradeId: 'trade-2',
        tokenId: 'alpha',
        strategyKey: 'trend_pullback',
        realizedPnlUsd: '-30.00',
      }),
    ];

    const metrics = computeMetrics(
      makeInput({
        finalEquityUsd: '960.00',
        ledger: makeLedger({ cashUsd: '960.00', realizedPnlUsd: '-40.00' }),
        closedTrades: trades,
      }),
    );

    expect(metrics.winRatePct).toBe('0.00');
    expect(metrics.profitFactor).toBe('0.00');
    expect(metrics.averageWinUsd).toBeNull();
    expect(metrics.averageLossUsd).toBe('-20.00');
  });

  it('counts a break-even trade without treating it as a win or a loss', () => {
    const trades = [
      makeTrade({
        tradeId: 'trade-1',
        tokenId: 'alpha',
        strategyKey: 'trend_pullback',
        realizedPnlUsd: '10.00',
      }),
      makeTrade({
        tradeId: 'trade-2',
        tokenId: 'beta',
        strategyKey: 'trend_pullback',
        realizedPnlUsd: '0.00',
      }),
    ];

    const metrics = computeMetrics(
      makeInput({
        finalEquityUsd: '1010.00',
        ledger: makeLedger({ cashUsd: '1010.00', realizedPnlUsd: '10.00' }),
        closedTrades: trades,
      }),
    );

    expect(metrics.tradeCount).toBe(2);
    expect(metrics.wins).toBe(1);
    expect(metrics.losses).toBe(0);
    expect(metrics.winRatePct).toBe('50.00');
    expect(metrics.profitFactor).toBeNull();
    expect(metrics.perStrategy).toEqual([
      {
        strategyKey: 'trend_pullback',
        tradeCount: 2,
        wins: 1,
        losses: 0,
        realizedPnlUsd: '10.00',
        winRatePct: '50.00',
      },
    ]);
    expect(metrics.perToken).toEqual([
      {
        tokenId: 'alpha',
        tradeCount: 1,
        wins: 1,
        losses: 0,
        realizedPnlUsd: '10.00',
        winRatePct: '100.00',
      },
      {
        tokenId: 'beta',
        tradeCount: 1,
        wins: 0,
        losses: 0,
        realizedPnlUsd: '0.00',
        winRatePct: '0.00',
      },
    ]);
  });

  it('aggregates per strategy and per token in code-unit order', () => {
    const trades = [
      makeTrade({
        tradeId: 'trade-1',
        tokenId: 'beta',
        strategyKey: 'trend_pullback',
        realizedPnlUsd: '-10.00',
      }),
      makeTrade({
        tradeId: 'trade-2',
        tokenId: 'alpha',
        strategyKey: 'mean_reversion',
        realizedPnlUsd: '5.00',
      }),
      makeTrade({
        tradeId: 'trade-3',
        tokenId: 'alpha',
        strategyKey: 'trend_pullback',
        realizedPnlUsd: '20.00',
      }),
    ];

    const metrics = computeMetrics(
      makeInput({
        finalEquityUsd: '1015.00',
        ledger: makeLedger({ cashUsd: '1015.00', realizedPnlUsd: '15.00' }),
        closedTrades: trades,
      }),
    );

    expect(metrics.perStrategy).toEqual([
      {
        strategyKey: 'mean_reversion',
        tradeCount: 1,
        wins: 1,
        losses: 0,
        realizedPnlUsd: '5.00',
        winRatePct: '100.00',
      },
      {
        strategyKey: 'trend_pullback',
        tradeCount: 2,
        wins: 1,
        losses: 1,
        realizedPnlUsd: '10.00',
        winRatePct: '50.00',
      },
    ]);
    expect(metrics.perToken).toEqual([
      {
        tokenId: 'alpha',
        tradeCount: 2,
        wins: 2,
        losses: 0,
        realizedPnlUsd: '25.00',
        winRatePct: '100.00',
      },
      {
        tokenId: 'beta',
        tradeCount: 1,
        wins: 0,
        losses: 1,
        realizedPnlUsd: '-10.00',
        winRatePct: '0.00',
      },
    ]);
  });

  it('handles an empty curve and no trades', () => {
    const metrics = computeMetrics(makeInput());

    expect(metrics.totalReturnPct).toBe('0.00');
    expect(metrics.maxDrawdownPct).toBe('0.00');
    expect(metrics.peakEquityUsd).toBe('1000.00');
    expect(metrics.timeInMarketPct).toBe('0.00');
    expect(metrics.averageExposurePct).toBe('0.00');
    expect(metrics.tradeCount).toBe(0);
    expect(metrics.wins).toBe(0);
    expect(metrics.losses).toBe(0);
    expect(metrics.winRatePct).toBeNull();
    expect(metrics.profitFactor).toBeNull();
    expect(metrics.averageWinUsd).toBeNull();
    expect(metrics.averageLossUsd).toBeNull();
  });

  it('normalises a sub-cent loss to 0.00 instead of -0.00', () => {
    const metrics = computeMetrics(
      makeInput({
        finalEquityUsd: '999.99',
        ledger: makeLedger({ cashUsd: '999.99' }),
      }),
    );

    expect(metrics.totalReturnPct).toBe('0.00');
    expect(metrics.maxDrawdownPct).toBe('0.00');
  });

  it('keeps a real negative return at -0.01', () => {
    const metrics = computeMetrics(
      makeInput({
        finalEquityUsd: '999.90',
        ledger: makeLedger({ cashUsd: '999.90' }),
      }),
    );

    expect(metrics.totalReturnPct).toBe('-0.01');
  });

  it('observes the final equity for drawdown when the curve is empty', () => {
    const metrics = computeMetrics(
      makeInput({
        finalEquityUsd: '900.00',
        ledger: makeLedger({ cashUsd: '900.00' }),
        equityCurve: [],
      }),
    );

    expect(metrics.maxDrawdownPct).toBe('10.00');
    expect(metrics.peakEquityUsd).toBe('1000.00');
  });

  it('does not classify a signed-zero P&L as a loss', () => {
    const trades = [
      makeTrade({
        tradeId: 'trade-zero',
        tokenId: 'alpha',
        strategyKey: 'trend_pullback',
        realizedPnlUsd: '-0.00',
      }),
      makeTrade({
        tradeId: 'trade-loss',
        tokenId: 'alpha',
        strategyKey: 'trend_pullback',
        realizedPnlUsd: '-10.00',
      }),
    ];
    const metrics = computeMetrics(
      makeInput({
        finalEquityUsd: '990.00',
        unrealizedPnlUsd: '-0.00',
        ledger: makeLedger({ cashUsd: '990.00', realizedPnlUsd: '-10.00' }),
        closedTrades: trades,
      }),
    );

    expect(metrics.unrealizedPnlUsd).toBe('0.00');
    expect(metrics.tradeCount).toBe(2);
    expect(metrics.wins).toBe(0);
    expect(metrics.losses).toBe(1);
    expect(metrics.averageLossUsd).toBe('-10.00');
    expect(metrics.perStrategy).toEqual([
      {
        strategyKey: 'trend_pullback',
        tradeCount: 2,
        wins: 0,
        losses: 1,
        realizedPnlUsd: '-10.00',
        winRatePct: '0.00',
      },
    ]);
    expect(metrics.perToken).toEqual([
      {
        tokenId: 'alpha',
        tradeCount: 2,
        wins: 0,
        losses: 1,
        realizedPnlUsd: '-10.00',
        winRatePct: '0.00',
      },
    ]);
  });

  it('recomputes drawdown from equity rather than trusting a stale curve field', () => {
    const metrics = computeMetrics(
      makeInput({
        finalEquityUsd: '900.00',
        ledger: makeLedger({ cashUsd: '900.00' }),
        equityCurve: [
          point(0, '1000.00', '1000.00', '0.00', '0.00'),
          point(1, '1000.00', '1000.00', '0.00', '0.00'),
          point(2, '900.00', '900.00', '0.00', '0.00'),
        ],
      }),
    );

    expect(metrics.maxDrawdownPct).toBe('10.00');
  });

  it('formats every money and percent value with two decimals', () => {
    const trades = [
      makeTrade({
        tradeId: 'trade-1',
        tokenId: 'alpha',
        strategyKey: 'trend_pullback',
        realizedPnlUsd: '12.345',
      }),
      makeTrade({
        tradeId: 'trade-2',
        tokenId: 'beta',
        strategyKey: 'mean_reversion',
        realizedPnlUsd: '-3.5',
      }),
    ];
    const metrics = computeMetrics(
      makeInput({
        finalEquityUsd: '1008.85',
        finalPositionsValueUsd: '4.2',
        ledger: makeLedger({
          cashUsd: '1004.65',
          realizedPnlUsd: '8.845',
          feesPaidUsd: '1.1',
        }),
        closedTrades: trades,
        equityCurve: [point(0, '1000', '1000', '0')],
      }),
    );

    const values = [
      metrics.initialCapitalUsd,
      metrics.finalEquityUsd,
      metrics.totalReturnPct,
      metrics.maxDrawdownPct,
      metrics.peakEquityUsd,
      metrics.finalCashUsd,
      metrics.finalPositionsValueUsd,
      metrics.realizedPnlUsd,
      metrics.unrealizedPnlUsd,
      metrics.feesPaidUsd,
      metrics.winRatePct,
      metrics.profitFactor,
      metrics.averageWinUsd,
      metrics.averageLossUsd,
      metrics.timeInMarketPct,
      metrics.averageExposurePct,
    ];
    for (const value of values) {
      expect(value).toMatch(MONEY);
    }
  });

  it('rejects a non-positive initial capital', () => {
    expect(() => computeMetrics(makeInput({ initialCapitalUsd: '0.00' }))).toThrow(
      PaperMetricsError,
    );
    expect(() => computeMetrics(makeInput({ initialCapitalUsd: '-1.00' }))).toThrow(
      PaperMetricsError,
    );
  });

  it('does not mutate the input', () => {
    const input = deepFreeze(
      makeInput({
        finalEquityUsd: '1010.00',
        ledger: makeLedger({ cashUsd: '1010.00', realizedPnlUsd: '10.00' }),
        equityCurve: [
          point(0, '1000.00', '1000.00', '0.00'),
          point(1, '1010.00', '1010.00', '0.00'),
        ],
        closedTrades: [
          makeTrade({
            tradeId: 'trade-1',
            tokenId: 'alpha',
            strategyKey: 'trend_pullback',
            realizedPnlUsd: '10.00',
          }),
        ],
      }),
    );

    const metrics = computeMetrics(input);

    expect(metrics.tradeCount).toBe(1);
    expect(input.equityCurve[1]).toEqual(point(1, '1010.00', '1010.00', '0.00'));
    expect(input.closedTrades[0]?.realizedPnlUsd).toBe('10.00');
  });
});

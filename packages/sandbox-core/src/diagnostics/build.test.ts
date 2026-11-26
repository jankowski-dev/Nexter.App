import { describe, expect, it } from 'vitest';
import type { Candle } from '../types';
import type { SandboxEvent } from '../events/event-types';
import type { IntentRecord } from '../paper/types';
import { buildBarDiagnostics } from './build';

function candle(openTime: string, close: string, volumeUsd = '100'): Candle {
  return {
    tokenId: 'tok',
    timeframe: '1h',
    openTime: Date.parse(openTime),
    open: close,
    high: close,
    low: close,
    close,
    volumeUsd,
  };
}

function event(
  partial: Partial<SandboxEvent> & Pick<SandboxEvent, 'clockTime' | 'eventType'>,
): SandboxEvent {
  return {
    runId: 'run-1',
    module: 'run',
    severity: 'info',
    dataSnapshotId: 'snapshot-1',
    configVersion: 'config-1',
    seed: 7,
    seq: 1,
    recordedAt: '2026-01-01T00:00:00.000Z',
    prevHash: '0'.repeat(64),
    hash: '0'.repeat(64),
    tokenId: 'tok',
    ...partial,
  };
}

const candles: Candle[] = [
  candle('2026-01-01T00:00:00.000Z', '100'),
  candle('2026-01-01T01:00:00.000Z', '101'),
  candle('2026-01-01T02:00:00.000Z', '102'),
];

const intent: IntentRecord = {
  intentId: 'intent-1',
  tokenId: 'tok',
  side: 'buy',
  strategyKey: 'trend_pullback',
  strategyVersion: 1,
  status: 'filled',
  requestedUsd: '100.00',
  requestedAmount: null,
  filledUsd: '100.00',
  filledAmount: '1.00000000',
  priceUsd: '101.00000000',
  feeUsd: '0.25',
  reasonCode: 'FILL_FILLED',
  strategyReasonCode: 'TREND_PULLBACK_ENTRY',
  reasonText: 'Filled at next bar open',
  decisionTime: Date.parse('2026-01-01T02:00:00.000Z'),
  fillTime: Date.parse('2026-01-01T03:00:00.000Z'),
};

const events: SandboxEvent[] = [
  event({
    clockTime: '2026-01-01T02:00:00.000Z',
    eventType: 'regime.evaluated',
    module: 'regime',
    regime: 'TREND_UP',
    inputs: {
      features: {
        bars: 24,
        lastClose: '101',
        fastSma: '100.5',
        slowSma: '99.5',
        longSma: '98',
        atrPct: '1.25',
        recentHigh: '103',
        recentLow: '95',
        avgVolumeUsd: '12345',
        drawdownPct: '1.9',
        staleBars: 0,
      },
      rawRegime: 'TREND_UP',
    },
    reasonCode: 'REGIME_TREND_UP',
  }),
  event({
    clockTime: '2026-01-01T02:00:00.000Z',
    eventType: 'strategy.evaluated',
    module: 'strategy',
    strategyId: 'trend_pullback',
    inputs: {
      action: 'buy',
      confidence: 0.8,
      riskWeight: 1,
      stopLossPct: '3',
      takeProfitPct: '20',
    },
    reasonCode: 'TREND_PULLBACK_ENTRY',
  }),
  event({
    clockTime: '2026-01-01T02:00:00.000Z',
    eventType: 'risk.checked',
    module: 'risk',
    strategyId: 'trend_pullback',
    decision: {
      action: 'buy',
      sizeUsd: '100.00',
      reasonCode: 'RISK_PASSED',
      reasonText: 'passed',
    },
    riskChecks: [
      { name: 'max_positions', value: '1', limit: '5', passed: true },
      { name: 'liquidity', value: '100', limit: '50', passed: true },
    ],
    reasonCode: 'RISK_PASSED',
  }),
  event({
    clockTime: '2026-01-01T03:00:00.000Z',
    eventType: 'execution.filled',
    module: 'execution',
    inputs: {
      side: 'buy',
      priceUsd: '101.00000000',
    },
    reasonCode: 'FILL_FILLED',
  }),
  event({
    clockTime: '2026-01-01T03:00:00.000Z',
    eventType: 'ledger.entry',
    module: 'ledger',
    inputs: {
      side: 'buy',
      priceUsd: '101.00000000',
      positionAmountAfter: '1.00000000',
    },
    reasonCode: 'LEDGER_ENTRY',
  }),
];

const report = {
  intentJournal: [intent],
  equityCurve: [
    {
      clockTime: Date.parse('2026-01-01T01:00:00.000Z'),
      equityUsd: '1000.00',
      cashUsd: '1000.00',
      positionsValueUsd: '0.00',
      drawdownPct: '0.00',
    },
    {
      clockTime: Date.parse('2026-01-01T02:00:00.000Z'),
      equityUsd: '1000.00',
      cashUsd: '1000.00',
      positionsValueUsd: '0.00',
      drawdownPct: '0.00',
    },
    {
      clockTime: Date.parse('2026-01-01T03:00:00.000Z'),
      equityUsd: '1001.00',
      cashUsd: '900.00',
      positionsValueUsd: '101.00',
      drawdownPct: '0.00',
    },
  ],
};

describe('buildBarDiagnostics', () => {
  it('aligns regime, strategy, risk and execution state to the matching bar', () => {
    const rows = buildBarDiagnostics({
      candles,
      events,
      report,
      tokenId: 'tok',
      timeframe: '1h',
    });

    expect(rows).toHaveLength(3);
    expect(rows.map((row) => row.barIndex)).toEqual([0, 1, 2]);
    expect(rows[0]?.regime).toBeNull();
    expect(rows[1]).toMatchObject({
      regime: 'TREND_UP',
      fastSma: '100.5',
      strategyKey: 'trend_pullback',
      signalAction: 'buy',
      riskDecision: 'buy',
      riskChecks: 'max_positions:true:5|liquidity:true:50',
      intentSide: 'buy',
      intentStatus: 'filled',
    });
    expect(rows[1]?.positionAmount).toBeNull();
    expect(rows[2]?.positionAmount).toBe('1.00000000');
    expect(rows[2]?.fillSide).toBe('buy');
    expect(rows[2]?.equityUsd).toBe('1001.00');
  });

  it('ignores other tokens and timeframes', () => {
    const rows = buildBarDiagnostics({
      candles: [...candles, { ...candles[0]!, tokenId: 'other' }],
      events: [
        ...events,
        event({
          clockTime: '2026-01-01T02:00:00.000Z',
          eventType: 'regime.evaluated',
          module: 'regime',
          tokenId: 'other',
          inputs: { features: {} },
        }),
      ],
      report,
      tokenId: 'tok',
      timeframe: '1h',
    });

    expect(rows).toHaveLength(3);
    expect(rows[1]?.regime).toBe('TREND_UP');
  });
});

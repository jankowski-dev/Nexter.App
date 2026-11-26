import { describe, expect, it } from 'vitest';
import { joinAnnotations, parseAnnotationsCsv, renderAnnotationReport } from './annotations';
import type { BarDiagnostic } from './types';

function row(
  barIndex: number,
  closeTime: string,
  overrides: Partial<BarDiagnostic> = {},
): BarDiagnostic {
  return {
    barIndex,
    tokenId: 'tok',
    timeframe: '1h',
    openTime: new Date(Date.parse(closeTime) - 3_600_000).toISOString(),
    closeTime,
    open: '100',
    high: '101',
    low: '99',
    close: '100',
    volumeUsd: '10',
    regime: 'TREND_UP',
    regimeReason: 'REGIME_TREND_UP',
    fastSma: '100',
    slowSma: '99',
    longSma: '98',
    atrPct: '1.2',
    recentHigh: '101',
    recentLow: '95',
    drawdownPct: '0.5',
    avgVolumeUsd: '1000',
    staleBars: 0,
    strategyKey: 'trend_pullback',
    signalAction: 'hold',
    signalReason: 'TREND_PULLBACK_NO_PULLBACK',
    confidence: '0.4',
    riskWeight: '1',
    riskDecision: null,
    riskReason: null,
    riskChecks: null,
    intentSide: null,
    intentStatus: null,
    intentReason: null,
    fillSide: null,
    fillPrice: null,
    fillStatus: null,
    positionAmount: null,
    equityUsd: '1000.00',
    cashUsd: '1000.00',
    equityDrawdownPct: '0.00',
    ...overrides,
  };
}

const rows = [
  row(0, '2026-01-01T01:00:00.000Z'),
  row(1, '2026-01-01T02:00:00.000Z', {
    riskDecision: 'block',
    riskReason: 'RISK_MAX_DRAWDOWN',
    riskChecks: 'max_drawdown:false:15|max_positions:true:5',
  }),
  row(2, '2026-01-01T03:00:00.000Z'),
];

describe('parseAnnotationsCsv', () => {
  it('parses a quoted note and normalizes the timestamp', () => {
    const parsed = parseAnnotationsCsv(
      'timestamp,expected_action,reason_code,note\n2026-01-01T02:00:00.000Z,entry,missed-breakout,"move, then pullback"\n',
    );

    expect(parsed).toEqual([
      {
        timestamp: '2026-01-01T02:00:00.000Z',
        expectedAction: 'entry',
        reasonCode: 'missed-breakout',
        note: 'move, then pullback',
      },
    ]);
  });

  it('rejects an unknown action', () => {
    expect(() =>
      parseAnnotationsCsv(
        'timestamp,expected_action,reason_code,note\n2026-01-01T02:00:00.000Z,buy,x,\n',
      ),
    ).toThrow(/expected_action/);
  });

  it('rejects a bad header', () => {
    expect(() => parseAnnotationsCsv('time,action\n')).toThrow(/header/);
  });
});

describe('joinAnnotations', () => {
  it('attaches a mark to the nearest bar within tolerance', () => {
    const joined = joinAnnotations(
      [
        {
          timestamp: '2026-01-01T02:30:00.000Z',
          expectedAction: 'entry',
          reasonCode: 'missed-breakout',
          note: 'should have entered',
        },
      ],
      rows,
    );

    expect(joined).toHaveLength(1);
    expect(joined[0]?.bar?.barIndex).toBe(1);
  });

  it('keeps an out-of-window mark unmatched', () => {
    const joined = joinAnnotations(
      [
        {
          timestamp: '2026-02-01T00:00:00.000Z',
          expectedAction: 'exit',
          reasonCode: 'premature-exit',
          note: '',
        },
      ],
      rows,
    );

    expect(joined[0]?.bar).toBeNull();
  });
});

describe('renderAnnotationReport', () => {
  it('includes each mark, the engine state and the top blockers', () => {
    const joined = joinAnnotations(
      [
        {
          timestamp: '2026-01-01T02:00:00.000Z',
          expectedAction: 'entry',
          reasonCode: 'missed-breakout',
          note: 'breakout ignored',
        },
      ],
      rows,
    );
    const report = renderAnnotationReport(joined);

    expect(report).toContain('missed-breakout');
    expect(report).toContain('TREND_UP');
    expect(report).toContain('RISK_MAX_DRAWDOWN');
    expect(report).toContain('max_drawdown');
    expect(report).toContain('breakout ignored');
  });
});

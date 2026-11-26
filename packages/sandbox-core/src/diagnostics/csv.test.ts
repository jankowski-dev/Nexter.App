import { describe, expect, it } from 'vitest';
import { DIAGNOSTIC_COLUMNS, renderAnnotationTemplate, renderDiagnosticsCsv } from './csv';
import type { BarDiagnostic } from './types';

function row(overrides: Partial<BarDiagnostic> = {}): BarDiagnostic {
  return {
    barIndex: 0,
    tokenId: 'tok',
    timeframe: '1h',
    openTime: '2026-01-01T00:00:00.000Z',
    closeTime: '2026-01-01T01:00:00.000Z',
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
    signalAction: 'buy',
    signalReason: 'TREND_PULLBACK_ENTRY',
    confidence: '0.8',
    riskWeight: '1',
    riskDecision: 'buy',
    riskReason: 'RISK_PASSED',
    riskChecks: 'max_positions:true:5|liquidity:true:50',
    intentSide: 'buy',
    intentStatus: 'filled',
    intentReason: 'TREND_PULLBACK_ENTRY',
    fillSide: 'buy',
    fillPrice: '100',
    fillStatus: 'filled',
    positionAmount: '1.00000000',
    equityUsd: '1000.00',
    cashUsd: '900.00',
    equityDrawdownPct: '0.00',
    ...overrides,
  };
}

describe('renderDiagnosticsCsv', () => {
  it('writes the fixed header and one row per diagnostic', () => {
    const text = renderDiagnosticsCsv([row(), row({ barIndex: 1 })]);
    const lines = text.trimEnd().split('\n');

    expect(lines[0]).toBe(DIAGNOSTIC_COLUMNS.join(','));
    expect(lines).toHaveLength(3);
    expect(lines[1]?.startsWith('0,tok,1h,2026-01-01T00:00:00.000Z')).toBe(true);
    expect(text.endsWith('\n')).toBe(true);
  });

  it('quotes commas, quotes and newlines', () => {
    const text = renderDiagnosticsCsv([
      row({ tokenId: 'tok,with"quote', riskChecks: 'line1\nline2' }),
    ]);
    const line = text.trimEnd().split('\n').slice(1).join('\n');

    expect(line).toContain('"tok,with""quote"');
    expect(line).toContain('"line1\nline2"');
  });
});

describe('renderAnnotationTemplate', () => {
  it('writes the exact annotation header', () => {
    expect(renderAnnotationTemplate()).toBe('timestamp,expected_action,reason_code,note\n');
  });
});

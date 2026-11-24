import type {
  SandboxEquityPointRecord,
  SandboxIntentRecord,
  SandboxPositionRecord,
  SandboxTradeRecord,
} from '@nexter/db';
import type { SandboxEvent as CoreSandboxEvent } from '@nexter/sandbox-core';
import { describe, expect, it } from 'vitest';
import {
  computeDrawdownPct,
  computeReturnPct,
  formatPercent,
  formatPercentFine,
  formatUnits,
  formatUsd,
  toSandboxEquityPoint,
  toSandboxEvent,
  toSandboxIntent,
  toSandboxPosition,
  toSandboxRunSummary,
  toSandboxTrade,
} from './sandbox-read.mapper';
import type { SandboxRunSummaryRow } from './sandbox.repository';

const at = new Date('2026-11-24T00:00:00.000Z');
const tokenId = 'bsc:0x1111111111111111111111111111111111111111';

describe('sandbox read mapper', () => {
  it('normalizes 18-decimal driver strings to display scales', () => {
    expect(formatUsd('200.000000000000000000')).toBe('200.00');
    expect(formatUsd('-0.000000000000000000')).toBe('0.00');
    expect(formatUnits('105.123456789012345678')).toBe('105.12345679');
    expect(formatUnits('0.000000000000000000')).toBe('0.00000000');
    expect(formatUnits('-0.000000000000000000')).toBe('0.00000000');
    expect(formatPercentFine('14.215000')).toBe('14.2150');
    expect(formatPercent('14.215')).toBe('14.22');
  });

  it('computes return and drawdown without NaN on padded values', () => {
    expect(computeReturnPct('1000.000000000000000000', '857.850000000000000000')).toBe('-14.22');
    expect(computeDrawdownPct('1000.000000000000000000', '857.850000000000000000')).toBe('14.2150');
    expect(computeDrawdownPct('1000.00', '1200.00')).toBe('0.0000');
    expect(computeReturnPct('0.00', '10.00')).toBe('0.00');
  });

  it('maps a run summary row', () => {
    const row: SandboxRunSummaryRow = {
      id: '11111111-1111-4111-8111-111111111111',
      name: 'Run',
      status: 'running',
      initialCapitalUsd: '1000.000000000000000000',
      cashUsd: '799.500000000000000000',
      equityUsd: '857.850000000000000000',
      peakEquityUsd: '1000.000000000000000000',
      lastBarClose: at,
      lastTickAt: at,
      error: null,
      createdAt: at,
      updatedAt: at,
      startedAt: at,
      stoppedAt: null,
      archivedAt: null,
      tokenCount: 1,
    };

    expect(toSandboxRunSummary(row)).toMatchObject({
      initialCapitalUsd: '1000.00',
      cashUsd: '799.50',
      equityUsd: '857.85',
      returnPct: '-14.22',
      drawdownPct: '14.2150',
      tokenCount: 1,
      lastTickAt: '2026-11-24T00:00:00.000Z',
    });
  });

  it('maps position, trade and intent rows to display scales', () => {
    const position: SandboxPositionRecord = {
      runId: 'run-1',
      tokenId,
      strategyKey: 'trend_pullback',
      strategyVersion: 1,
      amount: '1.995000000000000000',
      avgCostUsd: '100.250000000000000000',
      costBasisUsd: '200.000000000000000000',
      marketPriceUsd: '105.000000000000000000',
      marketValueUsd: '209.475000000000000000',
      openedAt: at,
      stopLossPct: '3.000000',
      takeProfitPct: null,
      entryIntentId: 'intent-1',
      feesPaidUsd: '0.500000000000000000',
      updatedAt: at,
    };
    expect(toSandboxPosition(position)).toMatchObject({
      amount: '1.99500000',
      avgCostUsd: '100.25000000',
      costBasisUsd: '200.00',
      marketPriceUsd: '105.00000000',
      marketValueUsd: '209.48',
      stopLossPct: '3.0000',
      takeProfitPct: null,
      feesPaidUsd: '0.50',
    });

    const trade: SandboxTradeRecord = {
      runId: 'run-1',
      tradeId: 'trade-1',
      tokenId,
      strategyKey: 'trend_pullback',
      strategyVersion: 1,
      entryAt: at,
      entryPriceUsd: '100.000000000000000000',
      entryAmount: '1.995000000000000000',
      entryNotionalUsd: '199.500000000000000000',
      entryFeeUsd: '0.500000000000000000',
      entryCostBasisUsd: '200.000000000000000000',
      entryIntentId: 'intent-1',
      exitAt: null,
      exitPriceUsd: null,
      exitAmount: '0.000000000000000000',
      exitNotionalUsd: '0.000000000000000000',
      exitFeeUsd: '0.000000000000000000',
      exitReasonCode: null,
      exitIntentId: null,
      realizedPnlUsd: '0.000000000000000000',
      status: 'open',
      createdAt: at,
      updatedAt: at,
    };
    expect(toSandboxTrade(trade)).toMatchObject({
      entryPriceUsd: '100.00000000',
      entryAmount: '1.99500000',
      entryNotionalUsd: '199.50',
      exitPriceUsd: null,
      exitAmount: '0.00000000',
      status: 'open',
    });

    const intent: SandboxIntentRecord = {
      runId: 'run-1',
      intentId: 'intent-1',
      tokenId,
      side: 'buy',
      strategyKey: 'trend_pullback',
      strategyVersion: 1,
      status: 'filled',
      requestedUsd: '200.000000000000000000',
      requestedAmount: null,
      filledUsd: '199.500000000000000000',
      filledAmount: '1.995000000000000000',
      priceUsd: '100.000000000000000000',
      stopLossPct: '3.000000',
      takeProfitPct: null,
      feeUsd: '0.500000000000000000',
      reasonCode: 'FILL_FILLED',
      strategyReasonCode: 'TREND_PULLBACK_ENTRY',
      reasonText: 'filled',
      decisionTime: at,
      fillTime: at,
      createdAt: at,
    };
    expect(toSandboxIntent(intent)).toMatchObject({
      status: 'filled',
      requestedUsd: '200.00',
      filledUsd: '199.50',
      filledAmount: '1.99500000',
      priceUsd: '100.00000000',
      stopLossPct: '3.0000',
      feeUsd: '0.50',
    });
  });

  it('maps equity points and rejects an unknown intent status', () => {
    const row: SandboxEquityPointRecord = {
      runId: 'run-1',
      clockTime: at,
      equityUsd: '857.850000000000000000',
      cashUsd: '799.500000000000000000',
      positionsValueUsd: '58.350000000000000000',
      drawdownPct: '14.215000',
    };
    expect(toSandboxEquityPoint(row)).toEqual({
      clockTime: '2026-11-24T00:00:00.000Z',
      equityUsd: '857.85',
      cashUsd: '799.50',
      positionsValueUsd: '58.35',
      drawdownPct: '14.2150',
    });

    expect(() =>
      toSandboxIntent({
        ...(row as unknown as SandboxIntentRecord),
        status: 'mystery',
      } as SandboxIntentRecord),
    ).toThrow(/Unknown sandbox intent status/);
  });

  it('maps events without exposing raw state/input blobs', () => {
    const event: CoreSandboxEvent = {
      runId: 'run-1',
      clockTime: '2026-11-24T00:00:00.000Z',
      module: 'strategy',
      eventType: 'strategy.decision',
      severity: 'decision',
      tokenId,
      strategyId: 'trend_pullback',
      regime: 'TREND_UP',
      stateBefore: { secret: true },
      stateAfter: { secret: true },
      inputs: { huge: 'blob' },
      timing: { ms: 1 },
      decision: { action: 'buy', sizeUsd: '200.00', reasonCode: 'ENTRY', reasonText: 'ok' },
      alternatives: [{ action: 'hold', reasonCode: 'NO', whyNot: 'exposure' }],
      riskChecks: [{ name: 'exposure', value: '1', limit: '20', passed: true }],
      dataSnapshotId: 'snapshot-1',
      configVersion: 'config-1',
      seed: 1,
      correlationId: null,
      reasonCode: 'ENTRY',
      reasonText: 'ok',
      seq: 0,
      recordedAt: '2026-11-24T00:00:00.000Z',
      prevHash: '0'.repeat(64),
      hash: 'a'.repeat(64),
    };

    const mapped = toSandboxEvent(event);
    expect(mapped).toMatchObject({
      seq: 0,
      module: 'strategy',
      severity: 'decision',
      decision: { action: 'buy' },
      alternatives: [{ whyNot: 'exposure' }],
      riskChecks: [{ passed: true }],
      hash: 'a'.repeat(64),
    });
    expect(Object.hasOwn(mapped, 'inputs')).toBe(false);
    expect(Object.hasOwn(mapped, 'stateBefore')).toBe(false);
  });
});

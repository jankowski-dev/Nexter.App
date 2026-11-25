import { describe, expect, it } from 'vitest';
import type { SandboxReplayReportResponse } from '@nexter/contracts';
import { SandboxReplayPdfService } from './sandbox-replay-pdf.service';

const response = {
  executionMode: 'historical-paper',
  notes: ['Historical-paper replay only.'],
  identity: {
    reportHash: 'a'.repeat(64),
    eventHash: 'b'.repeat(64),
    eventCount: 2,
    dataSnapshotId: 'c'.repeat(64),
    candleSnapshotHash: 'c'.repeat(64),
    configVersion: 'config-1',
    settingsVersion: 'settings-1',
    seed: 7,
  },
  report: {
    paperVersion: '1.0.0',
    runId: '00000000-0000-4000-8000-000000000001',
    seed: 7,
    configVersion: 'config-1',
    dataSnapshotId: 'c'.repeat(64),
    settingsVersion: 'settings-1',
    config: {
      runId: '00000000-0000-4000-8000-000000000001',
      seed: 7,
      timeframe: '1h',
      tokenIds: ['bsc:0x1111111111111111111111111111111111111111'],
      initialCapitalUsd: '1000.00',
      feeBps: 25,
      slippageBps: 10,
      liquidityCapPct: 1,
      maxPendingBars: 1,
      cooldownHoursAfterStop: 24,
      counterfactualHorizonHours: 24,
    },
    period: {
      firstBar: 1_760_000_000_000,
      lastBar: 1_760_003_600_000,
      bars: 2,
      tokens: ['bsc:0x1111111111111111111111111111111111111111'],
    },
    metrics: {
      initialCapitalUsd: '1000.00',
      finalEquityUsd: '1010.00',
      totalReturnPct: '1.00',
      maxDrawdownPct: '2.00',
      peakEquityUsd: '1010.00',
      finalCashUsd: '500.00',
      finalPositionsValueUsd: '510.00',
      realizedPnlUsd: '10.00',
      unrealizedPnlUsd: '0.00',
      feesPaidUsd: '1.00',
      tradeCount: 1,
      wins: 1,
      losses: 0,
      winRatePct: '100.00',
      profitFactor: '2.00',
      averageWinUsd: '10.00',
      averageLossUsd: null,
      timeInMarketPct: '10.00',
      averageExposurePct: '10.00',
      perStrategy: [
        {
          strategyKey: 'trend_pullback',
          tradeCount: 1,
          wins: 1,
          losses: 0,
          realizedPnlUsd: '10.00',
          winRatePct: '100.00',
        },
      ],
      perToken: [
        {
          tokenId: 'bsc:0x1111111111111111111111111111111111111111',
          tradeCount: 1,
          wins: 1,
          losses: 0,
          realizedPnlUsd: '10.00',
          winRatePct: '100.00',
        },
      ],
    },
    equityCurve: [
      {
        clockTime: 1_760_000_000_000,
        equityUsd: '1000.00',
        cashUsd: '1000.00',
        positionsValueUsd: '0.00',
        drawdownPct: '0.00',
      },
      {
        clockTime: 1_760_003_600_000,
        equityUsd: '1010.00',
        cashUsd: '500.00',
        positionsValueUsd: '510.00',
        drawdownPct: '2.00',
      },
    ],
    positions: [],
    trades: [
      {
        tradeId: 'trade-1',
        tokenId: 'bsc:0x1111111111111111111111111111111111111111',
        strategyKey: 'trend_pullback',
        strategyVersion: 1,
        entryAt: 1_760_000_000_000,
        entryPriceUsd: '10.00',
        entryAmount: '50.00',
        entryNotionalUsd: '500.00',
        entryFeeUsd: '0.50',
        entryCostBasisUsd: '500.50',
        entryIntentId: 'buy-1',
        exitAt: 1_760_003_600_000,
        exitPriceUsd: '10.20',
        exitAmount: '50.00',
        exitNotionalUsd: '510.00',
        exitFeeUsd: '0.50',
        exitReasonCode: 'TREND_PULLBACK_TRAIL',
        exitIntentId: 'sell-1',
        realizedPnlUsd: '9.00',
        status: 'closed',
      },
    ],
    intentJournal: [
      {
        intentId: 'buy-1',
        tokenId: 'bsc:0x1111111111111111111111111111111111111111',
        side: 'buy',
        strategyKey: 'trend_pullback',
        strategyVersion: 1,
        status: 'filled',
        requestedUsd: '500.00',
        requestedAmount: null,
        filledUsd: '500.00',
        filledAmount: '50.00',
        priceUsd: '10.00',
        feeUsd: '0.50',
        reasonCode: 'FILL_FILLED',
        strategyReasonCode: 'TREND_PULLBACK_ENTRY',
        reasonText: 'Entry',
        decisionTime: 1_760_000_000_000,
        fillTime: 1_760_000_000_000,
      },
    ],
    counterfactuals: [],
    eventCount: 2,
    eventHash: 'b'.repeat(64),
    ledgerEntries: 1,
    reconciliationOk: true,
    reconciliationChecks: ['cash'],
    reportHash: 'a'.repeat(64),
  },
} as unknown as SandboxReplayReportResponse;

describe('SandboxReplayPdfService', () => {
  it('builds a non-empty PDF with the replay identity', async () => {
    const service = new SandboxReplayPdfService();
    const result = await service.build(response, {
      id: '00000000-0000-4000-8000-000000000001',
      name: 'Q 180d',
      periodDays: 180,
      fromTime: new Date(1_760_000_000_000),
      toTime: new Date(1_760_003_600_000),
    });

    expect(result.filename).toContain('00000000');
    expect(result.buffer.subarray(0, 4).toString()).toBe('%PDF');
    expect(result.buffer.length).toBeGreaterThan(1000);
  });
});

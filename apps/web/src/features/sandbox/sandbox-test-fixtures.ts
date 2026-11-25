import type {
  SandboxEvent,
  SandboxIntent,
  SandboxOverview,
  SandboxPosition,
  SandboxReplayDetail,
  SandboxReplayPreflightResponse,
  SandboxReplayReportResponse,
  SandboxReplaySummary,
  SandboxReportResponse,
  SandboxRunDetail,
  SandboxRunSummary,
  SandboxTrade,
} from '@nexter/contracts';

export const sandboxRunId = '11111111-1111-4111-8111-111111111111';
export const sandboxReplayId = '22222222-2222-4222-8222-222222222222';
export const sandboxTokenId = 'bsc:0x1111111111111111111111111111111111111111';
export const sandboxCreatedAt = '2026-11-24T00:00:00.000Z';
export const sandboxReplayFromTime = '2026-05-28T00:00:00.000Z';
export const sandboxReplayToTime = '2026-11-24T00:00:00.000Z';

export function sandboxRunSummaryFixture(
  overrides: Partial<SandboxRunSummary> = {},
): SandboxRunSummary {
  return {
    id: sandboxRunId,
    name: 'Базовый 1h',
    status: 'running',
    initialCapitalUsd: '1000.00',
    cashUsd: '400.00',
    equityUsd: '1042.00',
    peakEquityUsd: '1080.00',
    returnPct: '4.20',
    drawdownPct: '3.5185',
    tokenCount: 1,
    lastBarClose: '2026-11-24T00:00:00.000Z',
    lastTickAt: '2026-11-24T00:01:00.000Z',
    startedAt: sandboxCreatedAt,
    stoppedAt: null,
    archivedAt: null,
    error: null,
    createdAt: sandboxCreatedAt,
    updatedAt: sandboxCreatedAt,
    ...overrides,
  };
}

export function sandboxRunDetailFixture(
  overrides: Partial<SandboxRunDetail> = {},
): SandboxRunDetail {
  const summary = sandboxRunSummaryFixture(overrides);
  return {
    ...summary,
    dayStartEquityUsd: '1030.00',
    tokenKeys: [sandboxTokenId],
    tokens: [
      {
        tokenKey: sandboxTokenId,
        symbol: 'AAA',
        chain: 'bsc',
        contractAddress: '0x1111111111111111111111111111111111111111',
        enabled: true,
      },
    ],
    settings: {
      timeframe: '1h',
      maxPositions: 5,
      maxTokenExposurePct: 20,
      maxStrategyExposurePct: 40,
      cashBufferPct: 10,
      dailyLossLimitPct: 2,
      maxDrawdownPct: 15,
      perTradeRiskPct: 1,
      minOrderUsd: '10',
      liquidityCapPct: 1,
      defaultStopPct: 3,
      regime: {
        fastHours: 24,
        slowHours: 168,
        longHours: 720,
        atrPeriod: 14,
        rangeWindowHours: 72,
        liquidityWindowHours: 24,
        trendSpreadPct: 0.5,
        trendMaxAtrPct: 8,
        rangeSpreadPct: 0.75,
        rangeMaxAtrPct: 3.5,
        crashDrawdownPct: 12,
        crashAtrPct: 10,
        recoveryConfirmBars: 3,
        regimeDwellBars: 3,
        minLiquidityUsd: '50000',
      },
      strategies: {
        trendPullback: {
          fastPeriod: 24,
          slowPeriod: 168,
          pullbackPct: 2,
          atrStopMult: 2.5,
          trailActivationPct: 5,
          trailPct: 5,
        },
        rangeReversion: { lookback: 72, bandAtrMult: 1.5, stopAtrMult: 2 },
        recovery: { fastPeriod: 24, confirmBars: 3, stopPct: 3, riskWeight: 0.5 },
      },
    },
    paper: {
      feeBps: 25,
      slippageBps: 10,
      liquidityCapPct: 1,
      maxPendingBars: 1,
      cooldownHoursAfterStop: 24,
      counterfactualHorizonHours: 24,
    },
    pausedAt: null,
    executionMode: 'live-paper',
    openPositions: 1,
    openTrades: 1,
    closedTrades: 2,
    intents: 4,
    pendingIntents: 0,
    equityPoints: 3,
    ledgerEntries: 6,
    eventCount: 12,
    eventHash: 'a'.repeat(64),
    ...overrides,
  };
}

export function sandboxPositionFixture(overrides: Partial<SandboxPosition> = {}): SandboxPosition {
  return {
    tokenId: sandboxTokenId,
    strategyKey: 'trend_pullback',
    strategyVersion: 1,
    amount: '146.31147619',
    avgCostUsd: '4.1000',
    costBasisUsd: '600.00',
    marketPriceUsd: '4.2100',
    marketValueUsd: '616.00',
    openedAt: sandboxCreatedAt,
    stopLossPct: '3.00',
    takeProfitPct: null,
    entryIntentId: 'intent-entry-1',
    feesPaidUsd: '1.50',
    updatedAt: sandboxCreatedAt,
    ...overrides,
  };
}

export function sandboxEventFixture(overrides: Partial<SandboxEvent> = {}): SandboxEvent {
  return {
    seq: 1,
    clockTime: '2026-11-24T00:00:00.000Z',
    module: 'risk',
    eventType: 'risk.passed',
    severity: 'decision',
    tokenId: sandboxTokenId,
    strategyId: 'trend_pullback',
    regime: 'TREND_UP',
    decision: {
      action: 'buy',
      sizeUsd: '200.00',
      reasonCode: 'RISK_PASSED',
      reasonText: 'Проверки риска пройдены.',
    },
    alternatives: [
      {
        action: 'hold',
        reasonCode: 'RANK_LOWER_PRIORITY',
        whyNot: 'Альтернатива с меньшим приоритетом.',
      },
    ],
    riskChecks: [
      { name: 'token exposure', value: '10%', limit: '20%', passed: true },
      { name: 'cash buffer', value: '5%', limit: '10%', passed: false },
    ],
    dataSnapshotId: 'snapshot-1',
    configVersion: 'config-1',
    seed: 7,
    correlationId: null,
    reasonCode: 'RISK_PASSED',
    reasonText: 'Проверки риска пройдены.',
    recordedAt: '2026-11-24T00:00:00.500Z',
    prevHash: 'b'.repeat(64),
    hash: 'c'.repeat(64),
    ...overrides,
  };
}

export function sandboxIntentFixture(overrides: Partial<SandboxIntent> = {}): SandboxIntent {
  return {
    intentId: 'intent-1',
    tokenId: sandboxTokenId,
    side: 'buy',
    strategyKey: 'trend_pullback',
    strategyVersion: 1,
    status: 'filled',
    requestedUsd: '200.00',
    requestedAmount: null,
    filledUsd: '200.00',
    filledAmount: '48.78048780',
    priceUsd: '4.1000',
    stopLossPct: '3.00',
    takeProfitPct: null,
    feeUsd: '0.50',
    reasonCode: 'RISK_PASSED',
    strategyReasonCode: 'TREND_PULLBACK_ENTRY',
    reasonText: 'Вход по откату в тренде.',
    decisionTime: sandboxCreatedAt,
    fillTime: '2026-11-24T01:00:00.000Z',
    ...overrides,
  };
}

export function sandboxTradeFixture(overrides: Partial<SandboxTrade> = {}): SandboxTrade {
  return {
    tradeId: 'trade-1',
    tokenId: sandboxTokenId,
    strategyKey: 'trend_pullback',
    strategyVersion: 1,
    entryAt: sandboxCreatedAt,
    entryPriceUsd: '4.1000',
    entryAmount: '48.78048780',
    entryNotionalUsd: '200.00',
    entryFeeUsd: '0.50',
    entryCostBasisUsd: '200.50',
    entryIntentId: 'intent-1',
    exitAt: '2026-11-24T05:00:00.000Z',
    exitPriceUsd: '4.3000',
    exitAmount: '48.78048780',
    exitNotionalUsd: '209.76',
    exitFeeUsd: '0.52',
    exitReasonCode: 'TREND_PULLBACK_TRAIL',
    exitIntentId: 'intent-2',
    realizedPnlUsd: '8.74',
    status: 'closed',
    updatedAt: sandboxCreatedAt,
    ...overrides,
  };
}

export function sandboxOverviewFixture(overrides: Partial<SandboxOverview> = {}): SandboxOverview {
  return {
    enabled: true,
    executionMode: 'live-paper',
    runs: {
      total: 3,
      draft: 1,
      running: 1,
      paused: 1,
      stopped: 0,
      failed: 0,
      archived: 0,
    },
    activeRuns: [sandboxRunSummaryFixture()],
    lastTickAt: '2026-11-24T00:01:00.000Z',
    universe: {
      tokens: 3,
      enabledTokens: 2,
      staleTokens: [],
      lastCandleAt: '2026-11-24T00:00:00.000Z',
    },
    ...overrides,
  };
}

export function sandboxReportResponseFixture(
  overrides: Partial<SandboxReportResponse> = {},
): SandboxReportResponse {
  const base: SandboxReportResponse = {
    executionMode: 'live-paper',
    report: {
      paperVersion: 'stage-1c',
      runId: sandboxRunId,
      seed: 7,
      configVersion: 'config-1',
      dataSnapshotId: 'snapshot-1',
      settingsVersion: 'settings-1',
      config: {
        runId: sandboxRunId,
        seed: 7,
        timeframe: '1h',
        tokenIds: [sandboxTokenId],
        initialCapitalUsd: '1000.00',
        feeBps: 25,
        slippageBps: 10,
        liquidityCapPct: 1,
        maxPendingBars: 1,
        cooldownHoursAfterStop: 24,
        counterfactualHorizonHours: 24,
      },
      period: {
        firstBar: Date.parse('2026-11-24T00:00:00.000Z'),
        lastBar: Date.parse('2026-11-24T05:00:00.000Z'),
        bars: 5,
        tokens: [sandboxTokenId],
      },
      metrics: {
        initialCapitalUsd: '1000.00',
        finalEquityUsd: '1042.00',
        totalReturnPct: '4.20',
        maxDrawdownPct: '3.52',
        peakEquityUsd: '1080.00',
        finalCashUsd: '426.00',
        finalPositionsValueUsd: '616.00',
        realizedPnlUsd: '8.74',
        unrealizedPnlUsd: '16.00',
        feesPaidUsd: '1.50',
        tradeCount: 2,
        wins: 1,
        losses: 1,
        winRatePct: '50.00',
        profitFactor: '2.10',
        averageWinUsd: '8.74',
        averageLossUsd: '-4.00',
        timeInMarketPct: '60.00',
        averageExposurePct: '35.00',
        perStrategy: [
          {
            strategyKey: 'trend_pullback',
            tradeCount: 2,
            wins: 1,
            losses: 1,
            realizedPnlUsd: '8.74',
            winRatePct: '50.00',
          },
        ],
        perToken: [
          {
            tokenId: sandboxTokenId,
            tradeCount: 2,
            wins: 1,
            losses: 1,
            realizedPnlUsd: '8.74',
            winRatePct: '50.00',
          },
        ],
      },
      equityCurve: [
        {
          clockTime: Date.parse('2026-11-24T00:00:00.000Z'),
          equityUsd: '1000.00',
          cashUsd: '1000.00',
          positionsValueUsd: '0.00',
          drawdownPct: '0.00',
        },
        {
          clockTime: Date.parse('2026-11-24T05:00:00.000Z'),
          equityUsd: '1042.00',
          cashUsd: '426.00',
          positionsValueUsd: '616.00',
          drawdownPct: '3.52',
        },
      ],
      positions: [
        {
          tokenId: sandboxTokenId,
          strategyKey: 'trend_pullback',
          strategyVersion: 1,
          amount: '146.31147619',
          avgCostUsd: '4.1000',
          marketPriceUsd: '4.2100',
          marketValueUsd: '616.00',
          openedAt: Date.parse(sandboxCreatedAt),
          stopLossPct: '3.00',
          takeProfitPct: null,
        },
      ],
      trades: [
        {
          tradeId: 'trade-1',
          tokenId: sandboxTokenId,
          strategyKey: 'trend_pullback',
          strategyVersion: 1,
          entryAt: Date.parse(sandboxCreatedAt),
          entryPriceUsd: '4.1000',
          entryAmount: '48.78048780',
          entryNotionalUsd: '200.00',
          entryFeeUsd: '0.50',
          entryCostBasisUsd: '200.50',
          entryIntentId: 'intent-1',
          exitAt: Date.parse('2026-11-24T05:00:00.000Z'),
          exitPriceUsd: '4.3000',
          exitAmount: '48.78048780',
          exitNotionalUsd: '209.76',
          exitFeeUsd: '0.52',
          exitReasonCode: 'TREND_PULLBACK_TRAIL',
          exitIntentId: 'intent-2',
          realizedPnlUsd: '8.74',
          status: 'closed',
        },
      ],
      intentJournal: [
        {
          intentId: 'intent-1',
          tokenId: sandboxTokenId,
          side: 'buy',
          strategyKey: 'trend_pullback',
          strategyVersion: 1,
          status: 'filled',
          requestedUsd: '200.00',
          requestedAmount: null,
          filledUsd: '200.00',
          filledAmount: '48.78048780',
          priceUsd: '4.1000',
          feeUsd: '0.50',
          reasonCode: 'RISK_PASSED',
          strategyReasonCode: 'TREND_PULLBACK_ENTRY',
          reasonText: 'Вход по откату.',
          decisionTime: Date.parse(sandboxCreatedAt),
          fillTime: Date.parse('2026-11-24T01:00:00.000Z'),
        },
      ],
      counterfactuals: [],
      eventCount: 12,
      eventHash: 'a'.repeat(64),
      ledgerEntries: 6,
      reconciliationOk: true,
      reconciliationChecks: ['event chain', 'ledger totals'],
      reportHash: 'd'.repeat(64),
    },
    pendingIntents: 1,
    notes: [
      'dataSnapshotId is the last persisted event snapshot (snapshot-1).',
      '1 pending intent(s) are excluded from report.intentJournal.',
    ],
  };

  return { ...base, ...overrides };
}

export function sandboxReplaySummaryFixture(
  overrides: Partial<SandboxReplaySummary> = {},
): SandboxReplaySummary {
  return {
    id: sandboxReplayId,
    name: 'Прогон 180 дней',
    status: 'completed',
    tokenKeys: [sandboxTokenId],
    periodDays: 180,
    fromTime: sandboxReplayFromTime,
    toTime: sandboxReplayToTime,
    initialCapitalUsd: '1000.00',
    finalEquityUsd: '1042.00',
    returnPct: '4.20',
    maxDrawdownPct: '3.5200',
    reportHash: 'd'.repeat(64),
    error: null,
    queuedAt: sandboxCreatedAt,
    startedAt: sandboxCreatedAt,
    finishedAt: '2026-11-24T00:02:00.000Z',
    archivedAt: null,
    createdAt: sandboxCreatedAt,
    updatedAt: sandboxCreatedAt,
    ...overrides,
  };
}

export function sandboxReplayDetailFixture(
  overrides: Partial<SandboxReplayDetail> = {},
): SandboxReplayDetail {
  const run = sandboxRunDetailFixture();
  return {
    ...sandboxReplaySummaryFixture(),
    settings: run.settings,
    paper: run.paper,
    seed: 7,
    eventCount: 120,
    eventHash: 'e'.repeat(64),
    dataSnapshotId: 'snapshot-replay-1',
    candleSnapshotHash: 'f'.repeat(64),
    ...overrides,
  };
}

export function sandboxReplayPreflightFixture(
  overrides: Partial<SandboxReplayPreflightResponse> = {},
): SandboxReplayPreflightResponse {
  return {
    fromTime: sandboxReplayFromTime,
    toTime: sandboxReplayToTime,
    status: 'ok',
    warnings: [],
    coverage: [
      {
        tokenKey: sandboxTokenId,
        fromTime: sandboxReplayFromTime,
        toTime: sandboxReplayToTime,
        available: 4320,
        required: 4320,
        prefixBars: 0,
        gaps: 0,
        synthetic: false,
        stale: false,
        status: 'ok',
        warning: null,
      },
    ],
    ...overrides,
  };
}

export function sandboxReplayReportResponseFixture(
  overrides: Partial<SandboxReplayReportResponse> = {},
): SandboxReplayReportResponse {
  const base = sandboxReportResponseFixture();
  return {
    executionMode: 'historical-paper',
    report: {
      ...base.report,
      runId: sandboxReplayId,
      dataSnapshotId: 'snapshot-replay-1',
      eventCount: 120,
      eventHash: 'e'.repeat(64),
      config: { ...base.report.config, runId: sandboxReplayId },
      counterfactuals: [
        {
          tokenId: sandboxTokenId,
          decisionTime: Date.parse(sandboxCreatedAt),
          reasonCode: 'STRATEGY_NO_SIGNAL',
          entryAt: null,
          entryPriceUsd: null,
          exitAt: null,
          exitPriceUsd: null,
          returnPct: null,
          outcome: 'neutral',
          hindsight: true,
          usedForDecisions: false,
        },
        {
          tokenId: sandboxTokenId,
          decisionTime: Date.parse('2026-11-24T01:00:00.000Z'),
          reasonCode: 'RISK_BLOCKED',
          entryAt: Date.parse('2026-11-24T01:00:00.000Z'),
          entryPriceUsd: '4.1000',
          exitAt: Date.parse('2026-11-24T03:00:00.000Z'),
          exitPriceUsd: '4.3050',
          returnPct: '5.00',
          outcome: 'missed_opportunity',
          hindsight: true,
          usedForDecisions: false,
        },
      ],
    },
    notes: [
      'Historical-paper replay over 1h closed candles only.',
      'The full hash-chained event journal is not persisted for replays.',
    ],
    ...overrides,
  };
}

import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../decision/defaults';
import { Reason } from '../decision/reason-codes';
import { GENESIS_HASH } from '../events/event-types';
import type { SandboxEvent } from '../events/event-types';
import { DEFAULT_PAPER_SETTINGS } from './defaults';
import { planBuyFill, planSellFill } from './execution';
import { makeCandle, makeIntent, makePaperConfig } from './fixtures.test-helpers';
import { applyBuyFill, applySellFill, createLedger, markPortfolio } from './ledger';
import { buildEquityCurve } from './metrics';
import { buildReport, renderMarkdown, reportHash } from './report';
import type {
  BuildReportInput,
  CounterfactualRecord,
  IntentRecord,
  PaperLedgerState,
  PaperRunResult,
} from './types';

const HOUR = 3_600_000;
const T0 = Date.UTC(2026, 0, 1);

/** Books a buy and a full sell for `token-a`, plus an open buy for `token-b`. */
function ledgerWithTrades(): PaperLedgerState {
  const settings = DEFAULT_PAPER_SETTINGS;
  let ledger = createLedger('1000.00');

  const buyA = makeIntent({
    intentId: 'buy-a',
    tokenId: 'token-a',
    sizeUsd: '100',
    clockTime: T0,
  });
  const buyAPlan = planBuyFill({
    intent: buyA,
    candle: makeCandle({ tokenId: 'token-a', openTime: T0, open: '100', close: '101' }),
    cashUsd: '1000.00',
    equityUsd: '1000.00',
    cashBufferPct: DEFAULT_SETTINGS.cashBufferPct,
    settings,
    hasPosition: false,
  });
  ledger = applyBuyFill(ledger, buyAPlan, buyA, T0 + HOUR).state;

  const positionAmount = ledger.positions['token-a']?.amount as string;
  const sellA = makeIntent({
    intentId: 'sell-a',
    tokenId: 'token-a',
    side: 'sell',
    amount: positionAmount,
    clockTime: T0 + HOUR,
  });
  const sellAPlan = planSellFill({
    intent: sellA,
    candle: makeCandle({ tokenId: 'token-a', openTime: T0 + HOUR, open: '110', close: '111' }),
    positionAmount,
    settings,
  });
  ledger = applySellFill(ledger, sellAPlan, sellA, T0 + 2 * HOUR).state;

  const buyB = makeIntent({
    intentId: 'buy-b',
    tokenId: 'token-b',
    sizeUsd: '200',
    clockTime: T0 + HOUR,
  });
  const buyBPlan = planBuyFill({
    intent: buyB,
    candle: makeCandle({ tokenId: 'token-b', openTime: T0 + HOUR, open: '50', close: '51' }),
    cashUsd: ledger.cashUsd,
    equityUsd: '1000.00',
    cashBufferPct: DEFAULT_SETTINGS.cashBufferPct,
    settings,
    hasPosition: false,
  });
  ledger = applyBuyFill(ledger, buyBPlan, buyB, T0 + 2 * HOUR).state;

  return ledger;
}

function makeIntentRecord(overrides: Partial<IntentRecord>): IntentRecord {
  return {
    intentId: 'intent-1',
    tokenId: 'token-a',
    side: 'buy',
    strategyKey: 'trend_pullback',
    strategyVersion: 1,
    status: 'filled',
    requestedUsd: '100.00',
    requestedAmount: null,
    filledUsd: '100.00',
    filledAmount: '0.99900100',
    priceUsd: '100.10000000',
    feeUsd: '0.25',
    reasonCode: Reason.FILL_FILLED,
    strategyReasonCode: Reason.TREND_PULLBACK_ENTRY,
    reasonText: 'Filled',
    decisionTime: T0,
    fillTime: T0 + HOUR,
    ...overrides,
  };
}

function makeCounterfactual(overrides: Partial<CounterfactualRecord>): CounterfactualRecord {
  return {
    tokenId: 'token-a',
    decisionTime: T0,
    reasonCode: Reason.RISK_MAX_POSITIONS,
    entryAt: T0 + HOUR,
    entryPriceUsd: '100.10000000',
    exitAt: T0 + 25 * HOUR,
    exitPriceUsd: '110.00000000',
    returnPct: '9.50',
    outcome: 'missed_opportunity',
    hindsight: true,
    usedForDecisions: false,
    ...overrides,
  };
}

/** Builds a realistic report input without running the decision engine. */
function makeInput(ledger: PaperLedgerState = ledgerWithTrades()): BuildReportInput {
  const marks: Record<string, string> =
    ledger.positions['token-b'] === undefined ? {} : { 'token-b': '55.00000000' };
  const finalMark = markPortfolio(ledger, marks);

  const equityCurve = buildEquityCurve({
    initialCapitalUsd: '1000.00',
    points: [
      {
        clockTime: T0 + HOUR,
        equityUsd: '1000.00',
        cashUsd: '1000.00',
        positionsValueUsd: '0.00',
      },
      {
        clockTime: T0 + 2 * HOUR,
        equityUsd: finalMark.equityUsd,
        cashUsd: ledger.cashUsd,
        positionsValueUsd: finalMark.positionsValueUsd,
      },
    ],
  });

  const events: SandboxEvent[] = [];
  const result: PaperRunResult = {
    config: makePaperConfig({ tokenIds: ['token-a', 'token-b'], initialCapitalUsd: '1000.00' }),
    configVersion: 'config-1',
    dataSnapshotId: 'snapshot-1',
    ledger,
    state: { tokens: {} },
    intents: [
      makeIntentRecord({ intentId: 'buy-a', status: 'filled' }),
      makeIntentRecord({
        intentId: 'sell-a',
        side: 'sell',
        status: 'filled',
        requestedUsd: null,
        requestedAmount: '0.99900100',
        reasonCode: Reason.FILL_FILLED,
        strategyReasonCode: Reason.TREND_PULLBACK_STOP,
      }),
      makeIntentRecord({
        intentId: 'buy-rejected',
        status: 'rejected',
        filledUsd: '0.00',
        filledAmount: '0.00000000',
        priceUsd: null,
        feeUsd: '0.00',
        reasonCode: Reason.FILL_LIQUIDITY,
      }),
    ],
    equityCurve,
    eventCount: events.length,
    eventHash: GENESIS_HASH,
  };

  return {
    result,
    finalMark,
    marks,
    events,
    counterfactuals: [
      makeCounterfactual({}),
      makeCounterfactual({
        tokenId: 'token-b',
        decisionTime: T0 + HOUR,
        reasonCode: Reason.RISK_COOLDOWN,
        returnPct: '-2.10',
        outcome: 'bad_save',
      }),
    ],
    settingsVersion: 'settings-1',
  };
}

/** Rebuilds an object with reversed key insertion order, recursively. */
function reverseKeys<T>(value: T): T {
  if (Array.isArray(value)) return value.map((item) => reverseKeys(item)) as T;
  if (value !== null && typeof value === 'object') {
    const source = value as Record<string, unknown>;
    const output: Record<string, unknown> = {};
    for (const key of Object.keys(source).reverse()) output[key] = reverseKeys(source[key]);
    return output as T;
  }
  return value;
}

describe('buildReport', () => {
  it('builds a JSON-safe report with identity, period, metrics and reconciliation', () => {
    const input = makeInput();
    const report = buildReport(input);

    expect(report.paperVersion).toBe('paper-run-v1');
    expect(report.runId).toBe('run-1');
    expect(report.configVersion).toBe('config-1');
    expect(report.dataSnapshotId).toBe('snapshot-1');
    expect(report.settingsVersion).toBe('settings-1');
    expect(report.period).toEqual({
      firstBar: T0 + HOUR,
      lastBar: T0 + 2 * HOUR,
      bars: 2,
      tokens: ['token-a', 'token-b'],
    });
    expect(report.trades).toHaveLength(2);
    expect(report.trades.filter((trade) => trade.status === 'closed')).toHaveLength(1);
    expect(report.trades.filter((trade) => trade.status === 'open')).toHaveLength(1);
    expect(report.intentJournal).toHaveLength(3);
    expect(report.counterfactuals).toHaveLength(2);
    expect(report.ledgerEntries).toBe(input.result.ledger.entries.length);
    expect(report.reconciliationOk).toBe(true);
    expect(report.reportHash).toMatch(/^[a-f0-9]{64}$/);
    expect(report).not.toHaveProperty('generatedAt');
    expect(JSON.parse(JSON.stringify(report))).toEqual(report);
  });

  it('keeps the hash stable across two builds and key-order perturbations', () => {
    const one = buildReport(makeInput());
    const two = buildReport(makeInput());

    expect(two.reportHash).toBe(one.reportHash);
    expect(reportHash(reverseKeys(one))).toBe(one.reportHash);
    expect(reportHash(one)).toBe(one.reportHash);
    expect(JSON.stringify(one)).not.toContain('generatedAt');
  });

  it('changes the report hash when a metric changes', () => {
    const base = makeInput();
    const changed = makeInput();
    const changedInput: BuildReportInput = {
      ...changed,
      finalMark: { ...changed.finalMark, equityUsd: '1010.00' },
    };

    expect(buildReport(changedInput).reportHash).not.toBe(buildReport(base).reportHash);
  });

  it('records a failed reconciliation when a position has no mark', () => {
    const report = buildReport({ ...makeInput(), marks: {} });
    expect(report.reconciliationOk).toBe(false);
    expect(renderMarkdown(report)).toContain('| Reconciliation ok | false |');
  });
});

describe('renderMarkdown', () => {
  it('renders every report section and the hindsight label', () => {
    const report = buildReport(makeInput());
    const markdown = renderMarkdown(report);

    for (const heading of [
      '# Paper run report',
      '## Summary',
      '## Configuration',
      '### Period',
      '## Open positions (1)',
      '## Closed trades (1)',
      '## Open trades (1)',
      '## Intent journal',
      '## Counterfactuals',
      '## Reconciliation',
      '## Hashes',
    ]) {
      expect(markdown).toContain(heading);
    }

    expect(markdown).toContain('Hindsight only');
    expect(markdown).toContain('hindsight: true');
    expect(markdown).toContain('usedForDecisions: false');
    expect(markdown).toContain(report.metrics.finalEquityUsd);
    expect(markdown).toContain(report.metrics.totalReturnPct);
    expect(markdown).toContain(report.metrics.maxDrawdownPct);
    expect(markdown).toContain(report.eventHash);
    expect(markdown).toContain(report.reportHash);
    expect(markdown).toContain('missed_opportunity');
    expect(markdown).toContain('bad_save');
    expect(markdown).toContain('token-b');
    expect(markdown).not.toContain('generatedAt');
  });
});

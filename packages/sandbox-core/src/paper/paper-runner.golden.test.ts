import Decimal from 'decimal.js';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runPaperFromFiles } from '../cli/paper';
import type { PaperFromFilesResult } from '../cli/paper';
import { makeCandlesFromCloses } from '../decision/fixtures.test-helpers';
import type { SandboxEvent } from '../events/event-types';
import type { Candle } from '../types';
import { stableStringify } from '../util/hash';
import { DEFAULT_PAPER_SETTINGS } from './defaults';
import type { IntentRecord, LedgerEntry } from './types';

/**
 * Golden 180-day paper run for Stage 1C.
 *
 * Three deterministic 1h tokens over 180 days (4,320 bars each), driven through
 * the full CLI orchestration (`runPaperFromFiles`): JSONL load, snapshot,
 * Stage 1B decision engine, next-open fills, ledger, metrics, hindsight
 * counterfactuals and the JSON/Markdown report. Two replays and a replay with the
 * input files in reverse order must produce the same report hash and event hash;
 * the report hash, event hash, event/intent/trade/ledger counts and final equity
 * are pinned literals below. A pin change is a contract change, not a test fix.
 *
 * No `Date.now`, `Math.random` or `localeCompare` reaches the run: bar times are
 * derived from the fixed start, prices from repeated multiplication and a fixed
 * sine table, and every sort inside the package is code-unit based.
 */

const START = Date.UTC(2026, 0, 1);
const RUN_ID = 'stage1c-golden-180d';
const SEED = 7;
const BAR_COUNT = 4320;
const STOP_REASONS: ReadonlySet<string> = new Set([
  'TREND_PULLBACK_STOP',
  'RANGE_REVERSION_STOP',
  'RECOVERY_STOP',
]);

interface Summary {
  readonly run: PaperFromFilesResult;
  readonly events: readonly SandboxEvent[];
  readonly durationMs: number;
  readonly reportBytes: number;
}

/** 24 samples of `sin(2*pi*i/24)` so the range fixture needs no Math.sin. */
const SINE_24 = [
  0, 0.2588190451, 0.5, 0.7071067812, 0.8660254038, 0.9659258263, 1, 0.9659258263, 0.8660254038,
  0.7071067812, 0.5, 0.2588190451, 0, -0.2588190451, -0.5, -0.7071067812, -0.8660254038,
  -0.9659258263, -1, -0.9659258263, -0.8660254038, -0.7071067812, -0.5, -0.2588190451,
] as const;

/** Appends `bars` compound-growth closes and returns the next starting price. */
function appendRise(closes: number[], startPrice: number, bars: number, stepPct = 0.1): number {
  let price = startPrice;
  for (let index = 0; index < bars; index += 1) {
    closes.push(price);
    price *= 1 + stepPct / 100;
  }
  return price;
}

/**
 * AAA: the Stage 1B trend/crash shape (175 up, 6 down, 80 up, one −13% crash,
 * 138 recovery bars) followed by repeated 120-bar rises and 4-bar pullbacks.
 */
function aaaCloses(): number[] {
  const closes: number[] = [];
  let price = appendRise(closes, 100, 175);
  for (let index = 0; index < 6; index += 1) {
    price *= 0.9932;
    closes.push(price);
  }
  price = appendRise(closes, price, 80);
  price *= 0.87;
  closes.push(price);
  price = appendRise(closes, price, 138);
  while (closes.length < BAR_COUNT) {
    price = appendRise(closes, price, 120, 0.08);
    for (let index = 0; index < 4; index += 1) {
      price *= 0.988;
      closes.push(price);
    }
  }
  return closes.slice(0, BAR_COUNT);
}

/**
 * BBB: a deterministic 24-bar sine around 50 with ±3% amplitude.
 *
 * A 24-bar period is deliberate: the fast SMA (24) equals the slow SMA (168 =
 * seven cycles), so the classifier sees a stable RANGE while price still trades
 * from the lower band to the midpoint.
 */
function bbbCloses(): number[] {
  const closes: number[] = [];
  for (let index = 0; index < BAR_COUNT; index += 1) {
    const sample = SINE_24[index % SINE_24.length] ?? 0;
    closes.push(50 * (1 + 0.03 * sample));
  }
  return closes;
}

/** CCC: repeated cycles of 180 up, 40 down ~25%, 180 recovery bars. */
function cccCloses(): number[] {
  const closes: number[] = [];
  let price = 100;
  while (closes.length < BAR_COUNT) {
    price = appendRise(closes, price, 180);
    for (let index = 0; index < 40; index += 1) {
      price *= 0.9928;
      closes.push(price);
    }
    price = appendRise(closes, price, 180);
  }
  return closes.slice(0, BAR_COUNT);
}

/**
 * Every other BBB bar carries a thin 15,000 USD volume, so the 1% bar cap is
 * 150 USD: a ~200 USD order partially fills and the remainder is not retried.
 * The 24-bar average (57,500 USD) stays above the 50,000 USD liquidity floor, so
 * the token is liquid and the range strategy keeps trading.
 */
function scenarioCandles(): Candle[] {
  const bbb = makeCandlesFromCloses(bbbCloses(), {
    tokenId: 'BBB',
    start: START,
    volumeUsd: 100_000,
  }).map((candle, index) => (index % 2 === 0 ? candle : { ...candle, volumeUsd: '15000' }));
  return [
    ...makeCandlesFromCloses(aaaCloses(), { tokenId: 'AAA', start: START, volumeUsd: 100_000 }),
    ...bbb,
    ...makeCandlesFromCloses(cccCloses(), { tokenId: 'CCC', start: START, volumeUsd: 100_000 }),
  ];
}

function paperArgs(files: readonly string[], outputDir: string) {
  return {
    files: [...files],
    outputDir,
    runId: RUN_ID,
    seed: SEED,
    initialCapitalUsd: '1000.00',
    feeBps: DEFAULT_PAPER_SETTINGS.feeBps,
    slippageBps: DEFAULT_PAPER_SETTINGS.slippageBps,
    liquidityCapPct: DEFAULT_PAPER_SETTINGS.liquidityCapPct,
    cooldownHoursAfterStop: DEFAULT_PAPER_SETTINGS.cooldownHoursAfterStop,
    counterfactualHorizonHours: DEFAULT_PAPER_SETTINGS.counterfactualHorizonHours,
  } as const;
}

async function writeCandles(
  dir: string,
  name: string,
  candles: readonly Candle[],
): Promise<string> {
  const path = join(dir, name);
  await writeFile(path, candles.map((candle) => JSON.stringify(candle)).join('\n'));
  return path;
}

/** Reads events.jsonl and (optionally) proves every line is canonical JSON. */
async function readEventJournal(path: string, verifyCanonical: boolean): Promise<SandboxEvent[]> {
  const raw = await readFile(path, 'utf8');
  const lines = raw.split('\n').filter((line) => line.length > 0);
  const events: SandboxEvent[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] as string;
    const event = JSON.parse(line) as SandboxEvent;
    if (verifyCanonical && stableStringify(event) !== line) {
      throw new Error(`events.jsonl line ${index + 1} is not canonical JSON`);
    }
    events.push(event);
  }
  return events;
}

async function runScenario(
  files: readonly string[],
  outputDir: string,
  verifyCanonical: boolean,
): Promise<Summary> {
  const started = performance.now();
  const run = await runPaperFromFiles(paperArgs(files, outputDir));
  const durationMs = performance.now() - started;
  const events = await readEventJournal(run.artifacts.eventsPath, verifyCanonical);
  const reportBytes = (await stat(run.artifacts.reportJsonPath)).size;
  return { run, events, durationMs, reportBytes };
}

function statusCounts(intents: readonly IntentRecord[]): Record<string, number> {
  const counts: Record<string, number> = { filled: 0, partial: 0, rejected: 0, expired: 0 };
  for (const intent of intents) counts[intent.status] = (counts[intent.status] ?? 0) + 1;
  return counts;
}

function decimal(value: string): Decimal {
  return new Decimal(value);
}

function withinCent(left: string, right: string): boolean {
  return decimal(left).minus(right).abs().lessThanOrEqualTo('0.01');
}

describe('golden 180-day paper run', () => {
  let dir = '';
  let scenario: Candle[] = [];
  let openByKey = new Map<string, string>();
  let first: Summary;
  let second: Summary;
  let reversed: Summary;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'sandbox-golden-180d-'));
    scenario = scenarioCandles();
    openByKey = new Map(
      scenario.map((candle) => [`${candle.tokenId}|${candle.openTime}`, candle.open] as const),
    );
    const files = [
      await writeCandles(
        dir,
        'aaa.jsonl',
        scenario.filter((candle) => candle.tokenId === 'AAA'),
      ),
      await writeCandles(
        dir,
        'bbb.jsonl',
        scenario.filter((candle) => candle.tokenId === 'BBB'),
      ),
      await writeCandles(
        dir,
        'ccc.jsonl',
        scenario.filter((candle) => candle.tokenId === 'CCC'),
      ),
    ];
    first = await runScenario(files, join(dir, 'out-one'), true);
    second = await runScenario(files, join(dir, 'out-two'), false);
    reversed = await runScenario([...files].reverse(), join(dir, 'out-reversed'), false);
  }, 180_000);

  afterAll(async () => {
    if (dir.length > 0) await rm(dir, { recursive: true, force: true });
  });

  it('replays deterministically and pins the report/event contract', () => {
    expect(first.run.report.period.bars).toBe(BAR_COUNT);
    expect(first.run.report.period.tokens).toEqual(['AAA', 'BBB', 'CCC']);

    // Two identical replays: same intents, ledger, report hash and event hash.
    expect(second.run.result.intents).toEqual(first.run.result.intents);
    expect(second.run.result.ledger).toEqual(first.run.result.ledger);
    expect(second.run.result.equityCurve).toEqual(first.run.result.equityCurve);
    expect(second.run.report.eventHash).toBe(first.run.report.eventHash);
    expect(second.run.report.reportHash).toBe(first.run.report.reportHash);

    // Reversing the input file order cannot change the snapshot or the report.
    expect(reversed.run.report.reportHash).toBe(first.run.report.reportHash);
    expect(reversed.run.report.eventHash).toBe(first.run.report.eventHash);
    expect(reversed.run.result.intents).toEqual(first.run.result.intents);

    const { report } = first.run;
    const counts = statusCounts(report.intentJournal);

    // Pinned contract values for this deterministic scenario.
    expect(report.reportHash).toBe(
      'ac2a0059068d3bb7bad49baeda1c563438f4217f650e0c1a89a548be6a4226f5',
    );
    expect(report.eventHash).toBe(
      'ef7da740575b165d1d712a76a17b894fdd2e9dc91cd848a52edf22df407cd8da',
    );
    expect(report.eventCount).toBe(49379);
    expect(report.dataSnapshotId).toBe(
      '3a4f68c5d927f8b5e45eeb96a8efe8538c1eabf2bf77d374f94cc88020ee8518',
    );
    expect(report.configVersion).toBe(
      'a8de9c5c875dad8ce46ffbffeeee5dd9ea7da91dd65d86aa70bcde3f6bd31513',
    );
    expect(report.settingsVersion).toBe(
      'cc3d30cf416f7fac9a96b96d40868050cce7e68cb300f47d17fc92b789f1a26c',
    );
    expect(report.intentJournal.length).toBe(454);
    expect(counts).toEqual({ filled: 281, partial: 173, rejected: 0, expired: 0 });
    expect(report.metrics.tradeCount).toBe(227);
    expect(report.ledgerEntries).toBe(454);
    expect(report.metrics.finalEquityUsd).toBe('1378.52');
    expect(report.metrics.totalReturnPct).toBe('37.85');
    expect(report.metrics.maxDrawdownPct).toBe('2.68');
    expect(report.positions.length).toBe(0);
    expect(report.counterfactuals.length).toBe(944);
    const cooldownEvents = first.events.filter((event) => event.eventType === 'paper.cooldown_set');
    expect(cooldownEvents.length).toBe(130);
  }, 180_000);

  it('accounts for every intent, fill, ledger entry and cent', () => {
    const { report, result } = first.run;
    const counts = statusCounts(report.intentJournal);

    // Coverage: buys, sells, partial fills, cooldowns and counterfactuals.
    expect(counts.filled).toBeGreaterThan(0);
    expect(counts.partial).toBeGreaterThan(0);
    expect(report.intentJournal.some((intent) => intent.side === 'buy')).toBe(true);
    expect(report.intentJournal.some((intent) => intent.side === 'sell')).toBe(true);
    expect(report.counterfactuals.length).toBeGreaterThan(0);

    // One terminal status per intent id, and one ledger entry per booked fill.
    const ids = report.intentJournal.map((intent) => intent.intentId);
    expect(new Set(ids).size).toBe(ids.length);
    const entriesByIntent = new Map<string, LedgerEntry[]>();
    for (const entry of result.ledger.entries) {
      const group = entriesByIntent.get(entry.intentId) ?? [];
      group.push(entry);
      entriesByIntent.set(entry.intentId, group);
    }
    for (const intent of report.intentJournal) {
      expect(['filled', 'partial', 'rejected', 'expired']).toContain(intent.status);
      const entries = entriesByIntent.get(intent.intentId) ?? [];
      if (intent.status === 'filled' || intent.status === 'partial') {
        expect(entries, intent.intentId).toHaveLength(1);
        expect(entries[0]).toMatchObject({
          tokenId: intent.tokenId,
          side: intent.side,
          intentId: intent.intentId,
          clockTime: intent.fillTime,
          amount: intent.filledAmount,
          notionalUsd: intent.filledUsd,
          feeUsd: intent.feeUsd,
          priceUsd: intent.priceUsd,
        });
      } else {
        expect(entries, intent.intentId).toHaveLength(0);
      }
    }
    expect(report.ledgerEntries).toBe(counts.filled + counts.partial);
    expect(result.ledger.entries.length).toBe(report.ledgerEntries);

    // Exactly one execution outcome event per intent, matching its status.
    const executionEvents = first.events.filter((event) =>
      event.eventType.startsWith('execution.'),
    );
    expect(executionEvents.length).toBe(report.intentJournal.length);
    for (const intent of report.intentJournal) {
      const matches = executionEvents.filter((event) => event.inputs.intentId === intent.intentId);
      expect(matches, intent.intentId).toHaveLength(1);
      expect(matches[0]?.eventType).toBe(
        intent.status === 'filled'
          ? 'execution.filled'
          : intent.status === 'partial'
            ? 'execution.partial'
            : intent.status === 'rejected'
              ? 'execution.rejected'
              : 'execution.expired',
      );
    }

    // Reconciliation and the cash/position/equity identity.
    expect(report.reconciliationOk).toBe(true);
    for (const point of report.equityCurve) {
      expect(
        withinCent(
          point.equityUsd,
          decimal(point.cashUsd).plus(point.positionsValueUsd).toFixed(2),
        ),
        point.clockTime.toString(),
      ).toBe(true);
    }
    const lastPoint = report.equityCurve[report.equityCurve.length - 1];
    expect(lastPoint?.equityUsd).toBe(report.metrics.finalEquityUsd);
    expect(
      withinCent(
        report.metrics.finalEquityUsd,
        decimal(report.metrics.finalCashUsd).plus(report.metrics.finalPositionsValueUsd).toFixed(2),
      ),
    ).toBe(true);
    expect(
      withinCent(
        decimal(report.metrics.finalEquityUsd).minus(report.metrics.initialCapitalUsd).toFixed(2),
        decimal(report.metrics.realizedPnlUsd).plus(report.metrics.unrealizedPnlUsd).toFixed(2),
      ),
    ).toBe(true);
  }, 180_000);

  it('fills at the next open with fees and slippage, and never re-enters during a cooldown', () => {
    const { report } = first.run;
    const slippage = new Decimal(DEFAULT_PAPER_SETTINGS.slippageBps).div(10_000);
    let checkedFills = 0;

    for (const intent of report.intentJournal) {
      if (intent.status !== 'filled' && intent.status !== 'partial') continue;
      if (intent.priceUsd === null || intent.fillTime === null) throw new Error('bad fill');
      // A decision at close T fills at the open of the bar that starts at T.
      expect(intent.fillTime).toBe(intent.decisionTime);
      const open = openByKey.get(`${intent.tokenId}|${intent.fillTime}`);
      if (open === undefined) throw new Error(`no candle opens at ${intent.fillTime}`);
      const multiplier =
        intent.side === 'buy' ? new Decimal(1).plus(slippage) : new Decimal(1).minus(slippage);
      expect(intent.priceUsd).toBe(new Decimal(open).times(multiplier).toFixed(8));
      // The fee is `feeBps` of the booked notional, rounded once to cents.
      expect(intent.feeUsd).toBe(
        new Decimal(intent.filledUsd).times(DEFAULT_PAPER_SETTINGS.feeBps).div(10_000).toFixed(2),
      );
      checkedFills += 1;
    }
    expect(checkedFills).toBe(report.ledgerEntries);

    // Every stop sell arms a cooldown, and no buy is emitted inside it.
    const cooldowns = first.events.filter((event) => event.eventType === 'paper.cooldown_set');
    expect(cooldowns.length).toBeGreaterThan(0);
    const stopSells = report.intentJournal.filter(
      (intent) =>
        intent.side === 'sell' &&
        STOP_REASONS.has(intent.strategyReasonCode) &&
        (intent.status === 'filled' || intent.status === 'partial'),
    );
    expect(cooldowns.length).toBe(stopSells.length);
    for (const event of cooldowns) {
      const tokenId = event.tokenId as string;
      const fillTime = Date.parse(event.clockTime);
      const until = Date.parse(event.inputs.cooldownUntil as string);
      const trigger = event.inputs.triggerReasonCode;
      expect(
        stopSells.some(
          (intent) =>
            intent.tokenId === tokenId &&
            intent.fillTime === fillTime &&
            intent.strategyReasonCode === trigger,
        ),
      ).toBe(true);
      const blocked = report.intentJournal.filter(
        (intent) =>
          intent.side === 'buy' &&
          intent.tokenId === tokenId &&
          intent.decisionTime >= fillTime &&
          intent.decisionTime < until,
      );
      expect(blocked, tokenId).toEqual([]);
    }
  }, 180_000);

  it('explains every decision and keeps hindsight counterfactuals out of the decisions', () => {
    const { report } = first.run;
    const bySeq = new Map(first.events.map((event) => [event.seq, event] as const));

    // Every decision-carrying event has a reason code and an alternative.
    let decisions = 0;
    for (const event of first.events) {
      if (event.decision === null) continue;
      decisions += 1;
      expect((event.reasonCode ?? '').length).toBeGreaterThan(0);
      expect(event.alternatives.length).toBeGreaterThanOrEqual(1);
    }
    expect(decisions).toBeGreaterThan(0);

    // Every order intent is immediately preceded by a fully passing risk check.
    const intentEvents = first.events.filter((event) => event.eventType === 'order.intent');
    expect(intentEvents.length).toBe(report.intentJournal.length);
    for (const event of intentEvents) {
      const risk = bySeq.get(event.seq - 1);
      expect(risk?.eventType, String(event.seq)).toBe('risk.checked');
      expect(risk?.clockTime).toBe(event.clockTime);
      expect(risk?.tokenId).toBe(event.tokenId);
      expect(risk?.decision?.action).toBe(event.decision?.action);
      expect(risk?.reasonCode).toBe('RISK_PASSED');
      expect((risk?.riskChecks ?? []).every((check) => check.passed)).toBe(true);
    }

    // Event/ledger/report audit trail.
    expect(first.events[0]?.eventType).toBe('paper.run_started');
    expect(first.events[first.events.length - 1]?.eventType).toBe('paper.run_completed');
    expect(first.events.length).toBe(report.eventCount);
    expect(first.events[first.events.length - 1]?.hash).toBe(report.eventHash);
    const ledgerEvents = first.events.filter((event) => event.eventType === 'ledger.entry');
    expect(ledgerEvents.map((event) => event.inputs.entryId)).toEqual(
      first.run.result.ledger.entries.map((entry) => entry.entryId),
    );
    const completed = first.events[first.events.length - 1];
    expect(completed?.inputs).toMatchObject({
      bars: BAR_COUNT,
      finalEquityUsd: report.metrics.finalEquityUsd,
      intents: report.intentJournal.length,
      trades: report.metrics.tradeCount,
      ledgerEntries: report.ledgerEntries,
    });

    // Counterfactuals are hindsight-only, labeled and deterministic.
    for (const record of report.counterfactuals) {
      expect(record.hindsight).toBe(true);
      expect(record.usedForDecisions).toBe(false);
      expect(['missed_opportunity', 'bad_save', 'neutral', 'insufficient_data']).toContain(
        record.outcome,
      );
      if (record.outcome === 'insufficient_data') {
        expect(record.returnPct).toBeNull();
      } else {
        expect(record.returnPct).toMatch(/^-?\d+\.\d{2}$/);
      }
    }
    const order = report.counterfactuals.map(
      (record) => `${record.decisionTime}|${record.tokenId}|${record.reasonCode}`,
    );
    expect(order).toEqual([...order].sort());
  }, 180_000);

  it('pins the report summary, metrics formulas and artifact contract', () => {
    const { report } = first.run;
    const { metrics } = report;
    const closed = report.trades.filter((trade) => trade.status === 'closed');

    expect(metrics.tradeCount).toBe(closed.length);
    expect(metrics.wins + metrics.losses).toBeLessThanOrEqual(metrics.tradeCount);
    expect(new Decimal(metrics.totalReturnPct).toFixed(2), 'return = final / initial - 1').toBe(
      new Decimal(metrics.finalEquityUsd)
        .div(metrics.initialCapitalUsd)
        .minus(1)
        .times(100)
        .toDecimalPlaces(2, Decimal.ROUND_HALF_UP)
        .toFixed(2),
    );
    expect(new Decimal(metrics.realizedPnlUsd).toFixed(2), 'realized = sum of closed trades').toBe(
      closed.reduce((sum, trade) => sum.plus(trade.realizedPnlUsd), new Decimal(0)).toFixed(2),
    );
    expect(new Decimal(metrics.feesPaidUsd).toFixed(2), 'fees = sum of ledger fees').toBe(
      report.intentJournal
        .reduce((sum, intent) => sum.plus(intent.feeUsd), new Decimal(0))
        .toFixed(2),
    );
    expect(new Decimal(metrics.peakEquityUsd).greaterThanOrEqualTo(metrics.finalEquityUsd)).toBe(
      true,
    );
    expect(new Decimal(metrics.maxDrawdownPct).isNegative()).toBe(false);
    expect(new Decimal(metrics.timeInMarketPct).greaterThan(0)).toBe(true);

    // Artifacts round-trip the same report and quote both hashes.
    expect(first.reportBytes).toBeGreaterThan(0);
    const at = first.run.artifacts;
    return Promise.all([
      readFile(at.reportJsonPath, 'utf8').then((raw) => {
        expect(JSON.parse(raw)).toEqual(report);
      }),
      readFile(at.reportMarkdownPath, 'utf8').then((markdown) => {
        expect(markdown).toContain('# Paper run report');
        expect(markdown).toContain(`| Event hash | ${report.eventHash} |`);
        expect(markdown).toContain(`| Report hash | ${report.reportHash} |`);
        expect(markdown).toContain('| Reconciliation ok | true |');
        expect(markdown).toContain('Hindsight only');
      }),
    ]);
  }, 180_000);
});

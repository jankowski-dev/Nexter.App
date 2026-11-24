import { mkdir, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { GENESIS_HASH } from '../events/event-types';
import type { SandboxEvent } from '../events/event-types';
import type { Timestamp } from '../types';
import { sha256Hex, stableStringify } from '../util/hash';
import { PAPER_VERSION } from './defaults';
import { reconcileLedger } from './ledger';
import { computeMetrics } from './metrics';
import type {
  BuildReportInput,
  PaperArtifactPaths,
  PaperTrade,
  RunReport,
  WritePaperArtifactsInput,
} from './types';

/**
 * Deterministic report, Markdown rendering and artifact writing.
 *
 * The report is a JSON-safe projection of one finished paper run: identity,
 * configuration, period, metrics, equity curve, final marked positions, trades,
 * the intent journal, hindsight counterfactuals and audit hashes. It contains no
 * wall clock, so the same run always produces the same `reportHash`; events are
 * persisted separately and only their count/final hash appear in the report.
 *
 * `reportHash = sha256Hex(stableStringify(report without reportHash))`. The
 * Markdown file is presentation only: it renders the same facts but is never
 * read back as a source of truth.
 */

const ZERO_EVENTS_HASH = GENESIS_HASH;

/** Typed report/artifact error reserved for caller or artifact-contract mistakes. */
export class PaperReportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PaperReportError';
  }
}

/** Locale-independent code-unit ordering used by every deterministic sort. */
function compareCodeUnits(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

/** ISO timestamp for display; deterministic and locale-independent. */
function iso(timestamp: Timestamp | null): string {
  return timestamp === null ? '-' : new Date(timestamp).toISOString();
}

/** Escapes a value for one Markdown table cell. */
function cell(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}

function table(headers: readonly string[], rows: readonly (readonly string[])[]): string {
  const head = `| ${headers.map(cell).join(' | ')} |`;
  const divider = `| ${headers.map(() => '---').join(' | ')} |`;
  const body = rows.map((row) => `| ${row.map(cell).join(' | ')} |`);
  return [head, divider, ...body].join('\n');
}

/** Final trades in a deterministic order: closed in ledger order, then open by trade id. */
function collectTrades(input: BuildReportInput): PaperTrade[] {
  const open = Object.values(input.result.ledger.openTrades)
    .slice()
    .sort((left, right) => compareCodeUnits(left.tradeId, right.tradeId));
  return [...input.result.ledger.closedTrades, ...open];
}

/**
 * Computes the report hash, excluding the `reportHash` field itself.
 *
 * The hash is order-independent for object keys because `stableStringify` sorts
 * them; array order is preserved and every array in the report is deterministically
 * sorted by its producer.
 */
export function reportHash(report: RunReport | Omit<RunReport, 'reportHash'>): string {
  const { reportHash: _ignored, ...hashable } = report as RunReport;
  return sha256Hex(stableStringify(hashable));
}

/**
 * Builds a `RunReport` from a finished run, its final marks and hindsight data.
 *
 * Metrics are derived from the ledger and the final marked projection unless the
 * caller already supplied them. Reconciliation compares the ledger with the same
 * final marks; its boolean result is recorded, while the detailed discrepancy
 * list stays out of the report so a corrupt run cannot bloat the artifact.
 */
export function buildReport(input: BuildReportInput): RunReport {
  const { result } = input;
  const equityCurve = result.equityCurve;
  const firstBar = equityCurve[0]?.clockTime ?? null;
  const lastBar = equityCurve[equityCurve.length - 1]?.clockTime ?? null;

  const metrics =
    input.metrics ??
    computeMetrics({
      initialCapitalUsd: result.ledger.initialCapitalUsd,
      finalEquityUsd: input.finalMark.equityUsd,
      finalPositionsValueUsd: input.finalMark.positionsValueUsd,
      unrealizedPnlUsd: input.finalMark.unrealizedPnlUsd,
      equityCurve,
      ledger: result.ledger,
      closedTrades: result.ledger.closedTrades,
    });

  const reconciliation = reconcileLedger(result.ledger, input.marks);
  const lastEventHash = input.events[input.events.length - 1]?.hash ?? ZERO_EVENTS_HASH;
  if (result.eventCount !== input.events.length || result.eventHash !== lastEventHash) {
    throw new PaperReportError(
      `Run event audit (${result.eventCount} / ${result.eventHash}) does not match the supplied journal (${input.events.length} / ${lastEventHash})`,
    );
  }

  const body: Omit<RunReport, 'reportHash'> = {
    paperVersion: PAPER_VERSION,
    runId: result.config.runId,
    seed: result.config.seed,
    configVersion: result.configVersion,
    dataSnapshotId: result.dataSnapshotId,
    settingsVersion: input.settingsVersion,
    config: result.config,
    period: {
      firstBar,
      lastBar,
      bars: equityCurve.length,
      tokens: [...result.config.tokenIds],
    },
    metrics,
    equityCurve: [...equityCurve],
    positions: [...input.finalMark.positions],
    trades: collectTrades(input),
    intentJournal: [...result.intents],
    counterfactuals: [...input.counterfactuals],
    eventCount: result.eventCount,
    eventHash: result.eventHash,
    ledgerEntries: result.ledger.entries.length,
    reconciliationOk: reconciliation.ok,
  };

  return { ...body, reportHash: reportHash(body) };
}

/**
 * Renders the report as Markdown tables and a short narrative.
 *
 * No locale formatting is used: every money/percent value is already a decimal
 * string and timestamps are ISO. Counterfactuals are explicitly labelled as
 * hindsight that never influenced a decision.
 */
export function renderMarkdown(report: RunReport): string {
  const lines: string[] = [];
  const { metrics, config } = report;

  lines.push('# Paper run report', '');
  lines.push(
    `Run \`${report.runId}\` · seed \`${report.seed}\` · timeframe \`${config.timeframe}\``,
  );
  lines.push('');

  lines.push('## Summary', '');
  lines.push(
    table(
      ['Metric', 'Value'],
      [
        ['Initial capital, USD', metrics.initialCapitalUsd],
        ['Final equity, USD', metrics.finalEquityUsd],
        ['Total return, %', metrics.totalReturnPct],
        ['Max drawdown, %', metrics.maxDrawdownPct],
        ['Peak equity, USD', metrics.peakEquityUsd],
        ['Final cash, USD', metrics.finalCashUsd],
        ['Final positions value, USD', metrics.finalPositionsValueUsd],
        ['Realized P&L, USD', metrics.realizedPnlUsd],
        ['Unrealized P&L, USD', metrics.unrealizedPnlUsd],
        ['Fees paid, USD', metrics.feesPaidUsd],
        ['Closed trades', String(metrics.tradeCount)],
        ['Wins / losses', `${metrics.wins} / ${metrics.losses}`],
        ['Win rate, %', metrics.winRatePct ?? '-'],
        ['Profit factor', metrics.profitFactor ?? '-'],
        ['Average win, USD', metrics.averageWinUsd ?? '-'],
        ['Average loss, USD', metrics.averageLossUsd ?? '-'],
        ['Time in market, %', metrics.timeInMarketPct],
        ['Average exposure, %', metrics.averageExposurePct],
      ],
    ),
    '',
  );

  lines.push('## Configuration', '');
  lines.push(
    table(
      ['Setting', 'Value'],
      [
        ['Paper version', report.paperVersion],
        ['Config version', report.configVersion],
        ['Data snapshot id', report.dataSnapshotId],
        ['Decision settings version', report.settingsVersion],
        ['Run id', config.runId],
        ['Seed', String(config.seed)],
        ['Timeframe', config.timeframe],
        ['Tokens', config.tokenIds.join(', ')],
        ['Initial capital, USD', config.initialCapitalUsd],
        ['Fee, bps', String(config.feeBps)],
        ['Slippage, bps', String(config.slippageBps)],
        ['Liquidity cap, %', String(config.liquidityCapPct)],
        ['Max pending bars', String(config.maxPendingBars)],
        ['Cooldown after stop, hours', String(config.cooldownHoursAfterStop)],
        ['Counterfactual horizon, hours', String(config.counterfactualHorizonHours)],
      ],
    ),
    '',
  );

  lines.push('### Period', '');
  lines.push(
    table(
      ['First bar', 'Last bar', 'Bars', 'Tokens'],
      [
        [
          iso(report.period.firstBar),
          iso(report.period.lastBar),
          String(report.period.bars),
          String(report.period.tokens.length),
        ],
      ],
    ),
    '',
  );

  lines.push(`## Open positions (${report.positions.length})`, '');
  if (report.positions.length === 0) {
    lines.push('No open positions.', '');
  } else {
    lines.push(
      table(
        ['Token', 'Strategy', 'Amount', 'Avg cost, USD', 'Mark, USD', 'Value, USD', 'Opened at'],
        report.positions.map((position) => [
          position.tokenId,
          `${position.strategyKey} v${position.strategyVersion}`,
          position.amount,
          position.avgCostUsd,
          position.marketPriceUsd,
          position.marketValueUsd,
          iso(position.openedAt),
        ]),
      ),
      '',
    );
  }

  const closed = report.trades.filter((trade) => trade.status === 'closed');
  const open = report.trades.filter((trade) => trade.status === 'open');

  lines.push(`## Closed trades (${closed.length})`, '');
  if (closed.length === 0) {
    lines.push('No closed trades.', '');
  } else {
    lines.push(
      table(
        [
          'Trade',
          'Token',
          'Entry at',
          'Exit at',
          'Amount',
          'Entry, USD',
          'Exit, USD',
          'Realized P&L, USD',
          'Exit reason',
        ],
        closed.map((trade) => [
          trade.tradeId,
          trade.tokenId,
          iso(trade.entryAt),
          iso(trade.exitAt),
          trade.entryAmount,
          trade.entryPriceUsd,
          trade.exitPriceUsd ?? '-',
          trade.realizedPnlUsd,
          trade.exitReasonCode ?? '-',
        ]),
      ),
      '',
    );
  }

  lines.push(`## Open trades (${open.length})`, '');
  if (open.length === 0) {
    lines.push('No open trades.', '');
  } else {
    lines.push(
      table(
        ['Trade', 'Token', 'Entry at', 'Amount', 'Entry, USD', 'Entry fee, USD'],
        open.map((trade) => [
          trade.tradeId,
          trade.tokenId,
          iso(trade.entryAt),
          trade.entryAmount,
          trade.entryPriceUsd,
          trade.entryFeeUsd,
        ]),
      ),
      '',
    );
  }

  lines.push('## Intent journal', '');
  const statusCounts = new Map<string, number>();
  const reasonCounts = new Map<string, number>();
  for (const intent of report.intentJournal) {
    statusCounts.set(intent.status, (statusCounts.get(intent.status) ?? 0) + 1);
    reasonCounts.set(intent.reasonCode, (reasonCounts.get(intent.reasonCode) ?? 0) + 1);
  }
  lines.push(
    table(
      ['Status', 'Count'],
      ['filled', 'partial', 'rejected', 'expired'].map((status) => [
        status,
        String(statusCounts.get(status) ?? 0),
      ]),
    ),
    '',
  );
  if (reasonCounts.size > 0) {
    lines.push(
      table(
        ['Reason', 'Count'],
        [...reasonCounts.entries()]
          .sort(([left], [right]) => compareCodeUnits(left, right))
          .map(([reason, count]) => [reason, String(count)]),
      ),
      '',
    );
  }

  lines.push('## Counterfactuals', '');
  lines.push(
    '> Hindsight only: these records are computed after the run with `hindsight: true` and `usedForDecisions: false`; they never influence a decision.',
    '',
  );
  const outcomeCounts = new Map<string, number>();
  for (const record of report.counterfactuals) {
    outcomeCounts.set(record.outcome, (outcomeCounts.get(record.outcome) ?? 0) + 1);
  }
  lines.push(
    table(
      ['Outcome', 'Count'],
      ['missed_opportunity', 'bad_save', 'neutral', 'insufficient_data'].map((outcome) => [
        outcome,
        String(outcomeCounts.get(outcome) ?? 0),
      ]),
    ),
    '',
  );
  if (report.counterfactuals.length === 0) {
    lines.push('No rejected buys to analyze.', '');
  } else {
    lines.push(
      table(
        ['Decision time', 'Token', 'Reason', 'Entry at', 'Exit at', 'Return, %', 'Outcome'],
        report.counterfactuals.map((record) => [
          iso(record.decisionTime),
          record.tokenId,
          record.reasonCode,
          iso(record.entryAt),
          iso(record.exitAt),
          record.returnPct ?? '-',
          record.outcome,
        ]),
      ),
      '',
    );
  }

  lines.push('## Reconciliation', '');
  lines.push(
    table(
      ['Check', 'Value'],
      [
        ['Reconciliation ok', String(report.reconciliationOk)],
        ['Ledger entries', String(report.ledgerEntries)],
        ['Equity points', String(report.equityCurve.length)],
      ],
    ),
    '',
  );

  lines.push('## Hashes', '');
  lines.push(
    table(
      ['Artifact', 'Value'],
      [
        ['Event count', String(report.eventCount)],
        ['Event hash', report.eventHash],
        ['Report hash', report.reportHash],
      ],
    ),
    '',
  );

  return `${lines.join('\n').trimEnd()}\n`;
}

/** Creates the output directory, refusing an existing one that already has entries. */
async function prepareOutputDirectory(outputDir: string): Promise<void> {
  try {
    const entries = await readdir(outputDir);
    if (entries.length > 0) {
      throw new PaperReportError(`Output directory is not empty: ${outputDir}`);
    }
    return;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  await mkdir(outputDir, { recursive: true });
}

/**
 * Writes `events.jsonl`, `report.json` and `report.md` into a fresh directory.
 *
 * One canonical `stableStringify(event)` per line makes a JSONL line re-hash to
 * the same chain value; the last row's `hash` must match the report's
 * `eventHash`, otherwise the artifacts could silently disagree.
 */
export async function writePaperArtifacts(
  input: WritePaperArtifactsInput,
): Promise<PaperArtifactPaths> {
  const { outputDir, report, events } = input;
  if (events.length !== report.eventCount) {
    throw new PaperReportError(
      `Report event count ${report.eventCount} does not match ${events.length} journal rows`,
    );
  }
  const lastHash = events[events.length - 1]?.hash ?? ZERO_EVENTS_HASH;
  if (lastHash !== report.eventHash) {
    throw new PaperReportError(
      `Report event hash ${report.eventHash} does not match the journal hash ${lastHash}`,
    );
  }

  await prepareOutputDirectory(outputDir);
  const eventsPath = join(outputDir, 'events.jsonl');
  const reportJsonPath = join(outputDir, 'report.json');
  const reportMarkdownPath = join(outputDir, 'report.md');

  await writeFile(
    eventsPath,
    events.map((event: SandboxEvent) => `${stableStringify(event)}\n`).join(''),
    'utf8',
  );
  await writeFile(reportJsonPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  await writeFile(reportMarkdownPath, renderMarkdown(report), 'utf8');

  return { outputDir, eventsPath, reportJsonPath, reportMarkdownPath };
}

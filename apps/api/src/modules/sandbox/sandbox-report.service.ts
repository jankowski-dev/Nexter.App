import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import Decimal from 'decimal.js';
import {
  SANDBOX_EXECUTION_MODE,
  type SandboxReportResponse,
  type SandboxRunReport,
} from '@nexter/contracts';
import {
  buildReport,
  markPortfolio,
  Reason,
  replayEventChain,
  renderMarkdown,
  settingsVersion,
  type EquityPoint,
  type IntentRecord,
  type PaperRunConfig,
  type PaperRunResult,
  type ReasonCode,
  type RunReport,
  type SandboxEvent,
  type StrategyKey,
} from '@nexter/sandbox-core';
import type { SandboxIntentRecord } from '@nexter/db';
import { formatPercent, formatUnits, formatUsd } from './sandbox-read.mapper';
import { SandboxRepository } from './sandbox.repository';
import {
  resolveSandboxRunConfig,
  SANDBOX_STRATEGY_KEYS,
  SandboxPersistenceError,
  type SandboxRunSnapshot,
  type SandboxRunnerConfig,
} from './sandbox.types';

/** Reasons a deterministic report cannot be produced from the persisted run. */
const REPORT_NOT_READY_MESSAGE = 'Отчёт пока недоступен: состояние запуска не прошло сверку';

const COUNTERFACTUAL_NOTE =
  'Counterfactuals are omitted for live-paper runs: hindsight diagnostics are not persisted and ' +
  'recomputing them later would make the report hash depend on backfilled market data. ' +
  'Rejected intents remain visible in the intent journal.';

/**
 * Raised when recomputing the final mark from persisted exact marks does not
 * reproduce the run/equity-point equity. The service maps it to a 409; a
 * contradicting report is never published.
 */
export class SandboxReportConsistencyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SandboxReportConsistencyError';
  }
}

export interface SandboxReportSource {
  readonly run: SandboxRunSnapshot;
  readonly config: SandboxRunnerConfig;
  readonly events: readonly SandboxEvent[];
  readonly equity: readonly EquityPoint[];
  readonly intents: readonly IntentRecord[];
  /** Final per-token marks from the persisted position projection. */
  readonly marks: Readonly<Record<string, string>>;
}

export interface SandboxGeneratedReport {
  readonly report: RunReport;
  readonly pendingIntents: number;
}

/**
 * Builds the deterministic Stage 1C report from persisted live-paper state.
 *
 * Pure and synchronous: the same source objects always produce the same
 * `RunReport` and `reportHash`. The report identity comes from the persisted
 * event chain: `configVersion` is the chain's version (all events must agree)
 * and `dataSnapshotId` is the **last** persisted event's tick snapshot, which is
 * the snapshot represented by the current run state/equity.
 *
 * Counterfactuals are passed as an empty list; they are hindsight diagnostics
 * that the live runner never persisted, and recomputing them from retained
 * candles would make the hash depend on data that can be backfilled after the
 * fact. The journal still exposes every rejected intent. The `live-paper` label
 * lives in the API wrapper so the core report type and its hash stay unchanged.
 */
export function buildSandboxReport(source: SandboxReportSource): RunReport {
  const { run, config, events, equity, intents, marks } = source;
  if (run.ledgerState === null || run.engineState === null) {
    throw new Error('A report requires an initialised ledger and engine state');
  }
  if (events.length === 0) {
    throw new Error('A report requires at least one persisted event');
  }
  if (equity.length === 0) {
    throw new Error('A report requires at least one equity point');
  }

  const configVersion = events[events.length - 1]?.configVersion as string;
  if (events.some((event) => event.configVersion !== configVersion)) {
    throw new SandboxReportConsistencyError(
      'Persisted events disagree about the run config version; refusing a mixed report',
    );
  }
  const dataSnapshotId = events[events.length - 1]?.dataSnapshotId as string;

  const tokenIds = [...config.tokenKeys].sort();
  const paperConfig: PaperRunConfig = {
    runId: run.id,
    seed: config.seed,
    timeframe: config.settings.timeframe,
    tokenIds,
    initialCapitalUsd: run.ledgerState.initialCapitalUsd,
    feeBps: config.paper.feeBps,
    slippageBps: config.paper.slippageBps,
    liquidityCapPct: config.paper.liquidityCapPct,
    maxPendingBars: config.paper.maxPendingBars,
    cooldownHoursAfterStop: config.paper.cooldownHoursAfterStop,
    counterfactualHorizonHours: config.paper.counterfactualHorizonHours,
  };

  const result: PaperRunResult = {
    config: paperConfig,
    configVersion,
    dataSnapshotId,
    ledger: run.ledgerState,
    state: run.engineState,
    intents,
    equityCurve: equity,
    eventCount: run.eventSeq,
    eventHash: run.eventHash,
  };
  // `marks` are the raw persisted numeric(30,18) strings, not the core 8-decimal
  // display price. Recomputing from them must reproduce the tick's exact cents.
  const finalMark = markPortfolio(run.ledgerState, marks);

  const report = buildReport({
    result,
    finalMark,
    marks,
    events,
    counterfactuals: [],
    settingsVersion: settingsVersion(config.settings),
  });

  const tolerance = new Decimal('0.01').times(
    Math.max(Object.keys(run.ledgerState.positions).length, 1),
  );
  const lastEquity = equity[equity.length - 1];
  if (lastEquity === undefined) {
    throw new SandboxReportConsistencyError('A report requires a last equity point');
  }
  assertSameValue('final equity', report.metrics.finalEquityUsd, run.equityUsd, tolerance);
  assertSameValue('final equity', report.metrics.finalEquityUsd, lastEquity.equityUsd, tolerance);
  assertSameValue(
    'final positions value',
    report.metrics.finalPositionsValueUsd,
    lastEquity.positionsValueUsd,
    tolerance,
  );

  return report;
}

function assertSameValue(
  label: string,
  recomputed: string,
  persisted: string,
  tolerance: Decimal,
): void {
  if (new Decimal(recomputed).minus(persisted).abs().greaterThan(tolerance)) {
    throw new SandboxReportConsistencyError(
      `Recomputed ${label} ${recomputed} does not match the persisted ${persisted} within ${tolerance.toFixed(2)} USD`,
    );
  }
}

/** Wraps the core report with the Stage 2 execution label and omission notes. */
export function toSandboxReportResponse(
  report: RunReport,
  pendingIntents: number,
  notes: readonly string[],
): SandboxReportResponse {
  // The contract mirrors `RunReport` field by field but its inferred arrays are
  // mutable, so this is a documented structural boundary cast, not `any`.
  return {
    executionMode: SANDBOX_EXECUTION_MODE,
    report: report as unknown as SandboxRunReport,
    pendingIntents,
    notes: [...notes],
  };
}

/**
 * Markdown rendering for owners. The core renderer remains presentation-only;
 * the host supplies a live-paper title/intro and an explicit counterfactual
 * omission note through renderer options, so no rendered text is patched.
 */
export function renderSandboxReportMarkdown(report: RunReport, notes: readonly string[]): string {
  return renderMarkdown(report, {
    title: 'Live paper run report',
    intro: [
      '> Execution mode: `live-paper`. Virtual money only: no wallet, key, signing or real ' +
        'order was involved.',
      ...notes.filter((note) => note !== COUNTERFACTUAL_NOTE).map((note) => `- ${note}`),
    ],
    counterfactualNote: COUNTERFACTUAL_NOTE,
  });
}

/** Notes that make JSON/Markdown omissions and report identity explicit. */
export function sandboxReportNotes(report: RunReport, pendingIntents: number): string[] {
  const notes = [
    `dataSnapshotId is the last persisted event snapshot (${report.dataSnapshotId}); ` +
      `configVersion comes from the persisted event chain.`,
  ];
  if (pendingIntents > 0) {
    notes.push(
      `${pendingIntents} pending intent(s) are excluded from report.intentJournal; ` +
        'use GET /runs/:id/intents to inspect them.',
    );
  }
  notes.push(COUNTERFACTUAL_NOTE);
  return notes;
}

/**
 * Owner read service for deterministic JSON/Markdown reports.
 *
 * Reports are generated on demand from the persisted run state, projections,
 * intents, equity and event chain. Nothing is written to `sandbox_reports`:
 * a GET must not mutate, and the deterministic hash makes repeated generation
 * idempotent. The table remains reserved for an explicit snapshot job later.
 */
@Injectable()
export class SandboxReportService {
  private readonly logger = new Logger(SandboxReportService.name);

  constructor(private readonly repository: SandboxRepository) {}

  async getReport(userId: string, runId: string): Promise<SandboxReportResponse> {
    const generated = await this.generate(userId, runId);
    return toSandboxReportResponse(
      generated.report,
      generated.pendingIntents,
      sandboxReportNotes(generated.report, generated.pendingIntents),
    );
  }

  async getReportMarkdown(userId: string, runId: string): Promise<string> {
    const generated = await this.generate(userId, runId);
    return renderSandboxReportMarkdown(
      generated.report,
      sandboxReportNotes(generated.report, generated.pendingIntents),
    );
  }

  private async generate(userId: string, runId: string): Promise<SandboxGeneratedReport> {
    try {
      return await this.generateReport(userId, runId);
    } catch (error) {
      // A corrupt persisted run/event/equity row must surface as the typed
      // 409 rather than an unhandled 500. NotFound/409 from the checks below
      // pass through unchanged.
      if (error instanceof SandboxPersistenceError) {
        this.logger.warn(
          `Sandbox report ${runId} could not read persisted state: ${error.message}`,
        );
        throw reportNotReady('Сохранённое состояние запуска не прошло проверку');
      }
      throw error;
    }
  }

  private async generateReport(userId: string, runId: string): Promise<SandboxGeneratedReport> {
    const run = await this.requireRun(userId, runId);
    if (run.ledgerState === null || run.engineState === null) {
      throw reportNotReady('Запуск ещё не инициализирован');
    }

    const [events, equityRows, intentRows, positionRows, pendingIntents] = await Promise.all([
      this.repository.listAllEvents(runId),
      this.repository.listAllEquityPoints(runId),
      this.repository.listTerminalIntents(runId),
      this.repository.listPositions(runId),
      this.repository.countIntents(runId, 'pending'),
    ]);

    if (events.length === 0 || equityRows.length === 0) {
      throw reportNotReady('Нет событий или точек эквити для отчёта');
    }

    // The report is a proof artifact: re-verify the persisted chain and match
    // it with the run head before deriving any number from it.
    let headHash: string;
    try {
      headHash = replayEventChain(events).headHash;
    } catch (error) {
      this.logger.warn(
        `Sandbox report ${runId} event chain failed replay: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      throw reportNotReady('Цепочка событий не прошла проверку целостности');
    }
    if (events.length !== run.eventSeq || headHash !== run.eventHash) {
      throw reportNotReady('Цепочка событий не совпадает с сохранённым состоянием запуска');
    }

    const marks: Record<string, string> = {};
    for (const row of positionRows) {
      if (new Decimal(row.amount).greaterThan(0)) {
        // Keep the exact numeric(30,18) tick mark for reconciliation.
        marks[row.tokenId] = row.marketPriceUsd;
      }
    }
    for (const tokenId of Object.keys(run.ledgerState.positions)) {
      if (marks[tokenId] === undefined) {
        throw reportNotReady(`Нет финальной отметки для позиции ${tokenId}`);
      }
    }

    const equity: EquityPoint[] = equityRows.map((row) => ({
      clockTime: row.clockTime.getTime(),
      equityUsd: formatUsd(row.equityUsd),
      cashUsd: formatUsd(row.cashUsd),
      positionsValueUsd: formatUsd(row.positionsValueUsd),
      // Stage 1C reports two decimals for percentages.
      drawdownPct: formatPercent(row.drawdownPct),
    }));
    const intents = intentRows.map((row) => toReportIntent(row, runId));
    const config = resolveSandboxRunConfig(
      run.settings,
      run.tokens.map((token) => token.tokenKey),
    );

    try {
      return {
        report: buildSandboxReport({ run, config, events, equity, intents, marks }),
        pendingIntents,
      };
    } catch (error) {
      this.logger.warn(
        `Sandbox report ${runId} could not be built: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      throw reportNotReady('Сверка отчёта не прошла');
    }
  }

  private async requireRun(userId: string, runId: string): Promise<SandboxRunSnapshot> {
    const run = await this.repository.loadRun(runId);
    // Archived runs stay readable; only lifecycle mutations are blocked.
    if (!run || run.userId !== userId) {
      throw new NotFoundException({
        code: 'SANDBOX_RUN_NOT_FOUND',
        message: 'Sandbox run not found',
      });
    }
    return run;
  }
}

function reportNotReady(message: string): ConflictException {
  return new ConflictException({
    code: 'SANDBOX_REPORT_NOT_READY',
    message: REPORT_NOT_READY_MESSAGE,
    details: { reason: message },
  });
}

function toReportIntent(row: SandboxIntentRecord, runId: string): IntentRecord {
  const status = row.status;
  if (
    status !== 'filled' &&
    status !== 'partial' &&
    status !== 'rejected' &&
    status !== 'expired'
  ) {
    throw reportNotReady(`Неизвестный статус терминального интента ${status}`);
  }

  return {
    intentId: row.intentId,
    tokenId: row.tokenId,
    side: asIntentSide(row.side),
    strategyKey: asStrategyKey(row.strategyKey, runId),
    strategyVersion: row.strategyVersion,
    status,
    requestedUsd: row.requestedUsd === null ? null : formatUsd(row.requestedUsd),
    requestedAmount: row.requestedAmount === null ? null : formatUnits(row.requestedAmount),
    filledUsd: formatUsd(row.filledUsd),
    filledAmount: formatUnits(row.filledAmount),
    priceUsd: row.priceUsd === null ? null : formatUnits(row.priceUsd),
    feeUsd: formatUsd(row.feeUsd),
    reasonCode: asReasonCode(row.reasonCode),
    strategyReasonCode: asReasonCode(row.strategyReasonCode ?? row.reasonCode),
    reasonText: row.reasonText,
    decisionTime: row.decisionTime.getTime(),
    fillTime: row.fillTime === null ? null : row.fillTime.getTime(),
  };
}

const REASON_CODES = new Set<string>(Object.values(Reason));
const STRATEGY_KEYS = new Set<string>(SANDBOX_STRATEGY_KEYS);

function asReasonCode(value: string): ReasonCode {
  if (!REASON_CODES.has(value)) {
    throw reportNotReady(`Неизвестный код причины ${value}`);
  }
  return value as ReasonCode;
}

function asStrategyKey(value: string, runId: string): StrategyKey {
  if (!STRATEGY_KEYS.has(value)) {
    throw reportNotReady(`Неизвестная стратегия ${value} в запуске ${runId}`);
  }
  return value as StrategyKey;
}

function asIntentSide(value: string): 'buy' | 'sell' {
  if (value !== 'buy' && value !== 'sell') {
    throw reportNotReady(`Неизвестная сторона интента ${value}`);
  }
  return value;
}

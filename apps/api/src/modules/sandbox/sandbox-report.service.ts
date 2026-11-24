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
  paperConfigVersion,
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
  type SandboxRunSnapshot,
  type SandboxRunnerConfig,
} from './sandbox.types';

/** Reasons a deterministic report cannot be produced from the persisted run. */
const REPORT_NOT_READY_MESSAGE = 'Отчёт пока недоступен: состояние запуска не прошло сверку';

export interface SandboxReportSource {
  readonly run: SandboxRunSnapshot;
  readonly config: SandboxRunnerConfig;
  readonly events: readonly SandboxEvent[];
  readonly equity: readonly EquityPoint[];
  readonly intents: readonly IntentRecord[];
  /** Final per-token marks from the persisted position projection. */
  readonly marks: Readonly<Record<string, string>>;
}

/**
 * Builds the deterministic Stage 1C report from persisted live-paper state.
 *
 * Pure and synchronous: the same source objects always produce the same
 * `RunReport` and `reportHash`. Counterfactuals are passed as an empty list;
 * they are hindsight diagnostics that the live runner never persisted, and
 * recomputing them from retained candles would make the hash depend on data
 * that can be backfilled after the fact. The journal still exposes every
 * rejected intent. The `live-paper` label lives in the API wrapper so the core
 * report type and its hash stay unchanged.
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
    configVersion: paperConfigVersion(paperConfig),
    dataSnapshotId: events[0]?.dataSnapshotId as string,
    ledger: run.ledgerState,
    state: run.engineState,
    intents,
    equityCurve: equity,
    eventCount: run.eventSeq,
    eventHash: run.eventHash,
  };
  const finalMark = markPortfolio(run.ledgerState, marks);

  return buildReport({
    result,
    finalMark,
    marks,
    events,
    counterfactuals: [],
    settingsVersion: settingsVersion(config.settings),
  });
}

/** Wraps the core report with the Stage 2 execution label. */
export function toSandboxReportResponse(report: RunReport): SandboxReportResponse {
  // The contract mirrors `RunReport` field by field but its inferred arrays are
  // mutable, so this is a documented structural boundary cast, not `any`.
  return {
    executionMode: SANDBOX_EXECUTION_MODE,
    report: report as unknown as SandboxRunReport,
  };
}

/**
 * Markdown rendering for owners. The core renderer is presentation-only; the
 * heading is relabelled so a downloaded report cannot be mistaken for a real
 * execution, and the hash table remains the core report's hash.
 */
export function renderSandboxReportMarkdown(report: RunReport): string {
  const rendered = renderMarkdown(report);
  const heading = '# Paper run report\n';
  const liveHeading =
    '# Live paper run report\n\n' +
    '> Execution mode: `live-paper`. Virtual money only: no wallet, key, signing or real order ' +
    'was involved.\n';

  const relabelled = rendered.startsWith(heading)
    ? `${liveHeading}${rendered.slice(heading.length)}`
    : `${liveHeading}\n${rendered}`;

  // The core renderer always prints the counterfactual section. Live runs do not
  // persist the hindsight candle window, so state the omission explicitly
  // instead of claiming that no rejected buys existed.
  return relabelled.replace(
    'No rejected buys to analyze.',
    'Counterfactuals are omitted for live-paper runs: hindsight diagnostics are not persisted ' +
      'and recomputing them later would make the report hash depend on backfilled market data. ' +
      'Rejected intents remain visible in the intent journal.',
  );
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
    return toSandboxReportResponse(await this.generate(userId, runId));
  }

  async getReportMarkdown(userId: string, runId: string): Promise<string> {
    return renderSandboxReportMarkdown(await this.generate(userId, runId));
  }

  private async generate(userId: string, runId: string): Promise<RunReport> {
    const run = await this.requireRun(userId, runId);
    if (run.ledgerState === null || run.engineState === null) {
      throw reportNotReady('Запуск ещё не инициализирован');
    }

    const [events, equityRows, intentRows, positionRows] = await Promise.all([
      this.repository.listAllEvents(runId),
      this.repository.listAllEquityPoints(runId),
      this.repository.listTerminalIntents(runId),
      this.repository.listPositions(runId),
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
        marks[row.tokenId] = formatUnits(row.marketPriceUsd);
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
      return buildSandboxReport({ run, config, events, equity, intents, marks });
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
    if (!run || run.userId !== userId || run.archivedAt !== null) {
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
  if (row.status === 'pending') {
    throw reportNotReady('В журнале остался незавершённый интент');
  }
  const status = row.status;
  if (
    status !== 'filled' &&
    status !== 'partial' &&
    status !== 'rejected' &&
    status !== 'expired'
  ) {
    throw reportNotReady(`Неизвестный статус интента ${status}`);
  }

  return {
    intentId: row.intentId,
    tokenId: row.tokenId,
    side: row.side === 'sell' ? 'sell' : 'buy',
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

import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import {
  SANDBOX_HISTORICAL_EXECUTION_MODE,
  sandboxRunReportSchema,
  type SandboxReplayReportResponse,
  type SandboxRunReport,
} from '@nexter/contracts';
import { SANDBOX_REPLAY_PREFIX_DAYS } from './sandbox-replay.coverage';
import {
  SandboxReplayRepository,
  type SandboxReplayReportRecord,
} from './sandbox-replay.repository';

const REPORT_NOT_COMPLETED_MESSAGE = 'Отчёт доступен только для завершённого прогона';
const REPORT_STATE_INVALID_MESSAGE = 'Сохранённый отчёт прогона повреждён';

interface SandboxReplayReportSource {
  readonly replay: SandboxReplayReportRecord;
  readonly report: SandboxRunReport;
}

/**
 * Owner read service for the persisted historical replay report.
 *
 * A replay GET never re-runs the engine: the worker already stored the complete
 * deterministic `RunReport` JSONB together with its hashes and the exact input
 * candle snapshot. This service only validates that stored artifact against its
 * row identity and wraps/renders it; it performs no writes and uses no wall
 * clock, so the JSON/Markdown are byte-stable for an unchanged row.
 */
@Injectable()
export class SandboxReplayReportService {
  constructor(private readonly replays: SandboxReplayRepository) {}

  async getReport(userId: string, id: string): Promise<SandboxReplayReportResponse> {
    const { replay, report } = await this.loadCompleted(userId, id);

    return {
      executionMode: SANDBOX_HISTORICAL_EXECUTION_MODE,
      report,
      notes: sandboxReplayReportNotes(replay, report),
      identity: {
        reportHash: report.reportHash,
        eventHash: report.eventHash,
        eventCount: report.eventCount,
        dataSnapshotId: report.dataSnapshotId,
        candleSnapshotHash: replay.candleSnapshotHash as string,
        configVersion: report.configVersion,
        settingsVersion: report.settingsVersion,
        seed: report.seed,
      },
    };
  }

  /**
   * Loads the stored report, owner-scoped, and fails closed unless the row is
   * completed and the report identity matches the columns written by the worker.
   */
  private async loadCompleted(userId: string, id: string): Promise<SandboxReplayReportSource> {
    const replay = await this.replays.findReplayReport(userId, id);
    if (!replay) {
      throw new NotFoundException({
        code: 'SANDBOX_REPLAY_NOT_FOUND',
        message: 'Sandbox replay not found',
      });
    }

    if (replay.status !== 'completed') {
      throw new ConflictException({
        code: 'SANDBOX_REPLAY_NOT_COMPLETED',
        message: REPORT_NOT_COMPLETED_MESSAGE,
        details: { status: replay.status },
      });
    }

    if (replay.report === null) {
      throw replayStateInvalid('Завершённый прогон не содержит отчёта');
    }
    const parsed = sandboxRunReportSchema.safeParse(replay.report);
    if (!parsed.success) {
      throw replayStateInvalid('Структура сохранённого отчёта не соответствует контракту');
    }
    const report = parsed.data;

    // The worker writes report, hashes and identities in one statement; a
    // mismatch means a corrupt/tampered row, so the report is not published.
    if (
      report.runId !== replay.id ||
      report.reportHash !== replay.reportHash ||
      report.dataSnapshotId !== replay.dataSnapshotId ||
      report.eventCount !== replay.eventCount ||
      report.eventHash !== replay.eventHash
    ) {
      throw replayStateInvalid('Идентичность отчёта не совпадает с сохранённым прогоном');
    }
    if (replay.candleSnapshotHash === null) {
      throw replayStateInvalid('Завершённый прогон не содержит хеша снимка свечей');
    }

    return { replay, report };
  }
}

/**
 * Explicit notes for the replay JSON/Markdown report.
 *
 * They state the simulated/next-open semantics, the evaluation window and the
 * stored report/snapshot identities, and disclose that the full event journal
 * is not persisted (the report plus the snapshot are re-derivable). All values
 * come from the row/report, so the notes are deterministic.
 */
export function sandboxReplayReportNotes(
  replay: SandboxReplayReportRecord,
  report: SandboxRunReport,
): string[] {
  const fromTime = replay.fromTime.toISOString();
  const toTime = replay.toTime.toISOString();

  return [
    'Historical-paper replay over 1h closed candles only: a decision at bar i sees ' +
      'candles up to and including bar i, and the next candle is never visible.',
    'Decisions taken on a closed bar fill at the next bar open with the frozen fee and ' +
      'slippage; these are simulated virtual-money paper fills, not live or exchange fills.',
    'This report is evidence of execution, accounting and determinism: it is not a ' +
      'performance claim, forecast or investment advice.',
    `${fromTime} → ${toTime} evaluation window (requested ${replay.periodDays} day(s), ` +
      `${report.period.bars} evaluated 1h bar(s), ${report.period.tokens.length} token(s)). ` +
      `The replay input spans up to ${SANDBOX_REPLAY_PREFIX_DAYS} days ending at ${toTime}; ` +
      'earlier candles are lookback prefix only and are not evaluated, traded or included ' +
      `in the period, and a full ${SANDBOX_REPLAY_PREFIX_DAYS}-day request has no prefix.`,
    `Report hash ${report.reportHash}; candle snapshot SHA-256 ${replay.candleSnapshotHash} ` +
      `(dataSnapshotId ${report.dataSnapshotId}). The stored gzip candle snapshot plus the ` +
      'frozen settings and seed re-derive this report.',
    'The full hash-chained event journal is not persisted for replays: only ' +
      `eventCount ${report.eventCount} and eventHash ${report.eventHash} are stored. ` +
      'Replaying the persisted snapshot reproduces the event rows; this report plus the ' +
      'snapshot is the evidence.',
  ];
}

function replayStateInvalid(reason: string): ConflictException {
  return new ConflictException({
    code: 'SANDBOX_REPLAY_STATE_INVALID',
    message: REPORT_STATE_INVALID_MESSAGE,
    details: { reason },
  });
}

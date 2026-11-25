import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import Decimal from 'decimal.js';
import {
  normalizeSandboxTokenKey,
  sandboxDecisionSettingsSchema,
  sandboxPaperSettingsSchema,
  SANDBOX_TIMEFRAME_MS,
  type SandboxReplayCreateRequest,
  type SandboxReplayDetail,
  type SandboxReplayListQuery,
  type SandboxReplayListResponse,
  type SandboxReplayPeriod,
  type SandboxReplayPreflightRequest,
  type SandboxReplayPreflightResponse,
  type SandboxReplaySummary,
} from '@nexter/contracts';
import { DEFAULT_PAPER_SETTINGS, DEFAULT_SETTINGS } from '@nexter/sandbox-core';
import { AuditService } from '../../shared/audit/audit.service';
import {
  replayWindow,
  SANDBOX_REPLAY_MIN_PARTIAL_BARS,
  SANDBOX_REPLAY_PREFIX_DAYS,
  type SandboxReplayWindow,
  type SandboxReplayWindowStats,
} from './sandbox-replay.coverage';
import {
  SandboxReplayRepository,
  type SandboxReplayDetailRecord,
  type SandboxReplaySummaryRecord,
} from './sandbox-replay.repository';
import { SandboxRepository, type SandboxCandleStats } from './sandbox.repository';
import type { SandboxAuditMeta } from './sandbox-tokens.service';

/** Frozen seed default of a historical replay (per the Stage 2.1 contract). */
export const SANDBOX_REPLAY_DEFAULT_SEED = 7;

const DAY_MS = 24 * SANDBOX_TIMEFRAME_MS;

const EMPTY_STATS: SandboxCandleStats = {
  available: 0,
  firstOpenTime: null,
  lastOpenTime: null,
  syntheticCandles: 0,
};

interface ResolvedReplayWindow {
  readonly window: SandboxReplayWindow;
  readonly tokenKeys: string[];
}

/**
 * Owner-facing historical replay lifecycle.
 *
 * Only `create`/`cancel`/`archive` mutate; none of them touches a live run, a
 * token or the candle store. A replay is queued only after the evaluation
 * window coverage passes; the worker (separate task) executes it.
 */
@Injectable()
export class SandboxReplayService {
  constructor(
    private readonly candles: SandboxRepository,
    private readonly replays: SandboxReplayRepository,
    private readonly audit: AuditService,
  ) {}

  async preflight(
    userId: string,
    input: SandboxReplayPreflightRequest,
    now: Date = new Date(),
  ): Promise<SandboxReplayPreflightResponse> {
    const resolved = await this.resolveWindow(
      userId,
      input.tokenKeys,
      input.periodDays,
      input.allowPartial,
      now,
    );

    return {
      fromTime: resolved.window.fromTime.toISOString(),
      toTime: resolved.window.toTime.toISOString(),
      status: resolved.window.status,
      warnings: resolved.window.warnings,
      coverage: resolved.window.coverage,
    };
  }

  async create(
    userId: string,
    input: SandboxReplayCreateRequest,
    meta: SandboxAuditMeta,
    now: Date = new Date(),
  ): Promise<SandboxReplayDetail> {
    const resolved = await this.resolveWindow(
      userId,
      input.tokenKeys,
      input.periodDays,
      input.allowPartial,
      now,
    );
    const window = resolved.window;

    this.assertWindowUsable(window, input.allowPartial);

    const initialCapitalUsd = normalizeCapital(input.initialCapitalUsd);
    const settings = (input.settings ?? DEFAULT_SETTINGS) as unknown as Record<string, unknown>;
    const paper = (input.paper ?? DEFAULT_PAPER_SETTINGS) as unknown as Record<string, unknown>;
    const seed = input.seed ?? SANDBOX_REPLAY_DEFAULT_SEED;

    const record = await this.replays.createReplay({
      userId,
      name: input.name,
      tokenKeys: resolved.tokenKeys,
      periodDays: input.periodDays,
      fromTime: window.fromTime,
      toTime: window.toTime,
      initialCapitalUsd,
      seed,
      settings,
      paper,
      queuedAt: now,
    });

    await this.audit.log({
      userId,
      action: 'sandbox.replay_created',
      entityType: 'sandbox_replay',
      entityId: record.id,
      after: {
        name: record.name,
        status: record.status,
        tokenKeys: resolved.tokenKeys,
        periodDays: input.periodDays,
        fromTime: window.fromTime.toISOString(),
        toTime: window.toTime.toISOString(),
        initialCapitalUsd,
        seed,
        coverageStatus: window.status,
        allowPartial: input.allowPartial,
        evaluationBars: window.evaluationBars,
      },
      ip: meta.ip,
      userAgent: meta.userAgent,
    });

    return toReplayDetail(record);
  }

  async list(userId: string, query: SandboxReplayListQuery): Promise<SandboxReplayListResponse> {
    const [rows, total] = await Promise.all([
      this.replays.listReplays(userId, {
        status: query.status,
        includeArchived: query.includeArchived,
        limit: query.limit,
        offset: query.offset,
      }),
      this.replays.countReplays(userId, {
        status: query.status,
        includeArchived: query.includeArchived,
      }),
    ]);

    return {
      replays: rows.map(toReplaySummary),
      total,
      limit: query.limit,
      offset: query.offset,
    };
  }

  async detail(userId: string, id: string): Promise<SandboxReplayDetail> {
    return toReplayDetail(await this.requireReplay(userId, id));
  }

  async cancel(
    userId: string,
    id: string,
    meta: SandboxAuditMeta,
    now: Date = new Date(),
  ): Promise<SandboxReplayDetail> {
    const replay = await this.requireReplay(userId, id);
    if (replay.status !== 'queued' || replay.archivedAt !== null) {
      throw invalidStatus('Только прогон в очереди можно отменить');
    }

    const cancelled = await this.replays.cancelQueuedReplay(userId, id, now);
    if (!cancelled) throw invalidStatus('Состояние прогона уже изменилось');

    const after = await this.requireReplay(userId, id);
    await this.audit.log({
      userId,
      action: 'sandbox.replay_cancelled',
      entityType: 'sandbox_replay',
      entityId: id,
      before: { status: replay.status },
      after: { status: after.status, finishedAt: after.finishedAt?.toISOString() ?? null },
      ip: meta.ip,
      userAgent: meta.userAgent,
    });

    return toReplayDetail(after);
  }

  async archive(
    userId: string,
    id: string,
    meta: SandboxAuditMeta,
    now: Date = new Date(),
  ): Promise<SandboxReplayDetail> {
    const replay = await this.requireReplay(userId, id);
    if (!isTerminal(replay) || replay.archivedAt !== null) {
      throw invalidStatus('Архивировать можно только завершённый прогон');
    }

    const archived = await this.replays.archiveReplay(userId, id, now);
    if (!archived) throw invalidStatus('Состояние прогона уже изменилось');

    const after = await this.requireReplay(userId, id);
    await this.audit.log({
      userId,
      action: 'sandbox.replay_archived',
      entityType: 'sandbox_replay',
      entityId: id,
      before: { status: replay.status, archivedAt: null },
      after: {
        status: after.status,
        archivedAt: after.archivedAt?.toISOString() ?? null,
      },
      ip: meta.ip,
      userAgent: meta.userAgent,
    });

    return toReplayDetail(after);
  }

  /**
   * Resolves `to_time` (earliest latest closed candle across the tokens),
   * `from_time` (first evaluation candle open) and per-token coverage.
   *
   * The requested window stats are always fetched; when `allowPartial` shortens
   * the window, the exact shortened stats are fetched again so `available`,
   * `gaps` and `prefixBars` reflect the actual window.
   */
  private async resolveWindow(
    userId: string,
    rawTokenKeys: readonly string[],
    periodDays: SandboxReplayPeriod,
    allowPartial: boolean,
    now: Date,
  ): Promise<ResolvedReplayWindow> {
    const tokenKeys = normalizeTokenKeys(rawTokenKeys);
    const tokens = await this.candles.listTokens(userId);
    const owned = new Set(tokens.map((token) => token.tokenKey));
    const missing = tokenKeys.filter((key) => !owned.has(key));
    if (missing.length > 0) {
      // Matches the live-run `requireUniverse` convention: an unknown/foreign
      // token key is an invalid request (400), not a hidden resource (404).
      throw new BadRequestException({
        code: 'SANDBOX_REPLAY_TOKEN_NOT_FOUND',
        message: 'Некоторые токены отсутствуют в песочнице',
        details: missing,
      });
    }

    const latestClosed = await this.candles.latestClosedOpenTimes(tokenKeys, now);

    const latestValues = tokenKeys
      .map((key) => latestClosed.get(key) ?? null)
      .filter((value): value is Date => value !== null);
    const earliestClosed =
      latestValues.length > 0
        ? latestValues.reduce((earliest, value) => (earliest <= value ? earliest : value))
        : null;
    const toTime = earliestClosed
      ? new Date(earliestClosed.getTime() + SANDBOX_TIMEFRAME_MS)
      : new Date(Math.floor(now.getTime() / SANDBOX_TIMEFRAME_MS) * SANDBOX_TIMEFRAME_MS);
    const requestedFrom = new Date(toTime.getTime() - periodDays * DAY_MS);
    const prefixStart = new Date(toTime.getTime() - SANDBOX_REPLAY_PREFIX_DAYS * DAY_MS);

    const [requested, requestedPrefix] = await Promise.all([
      this.candles.candleStatsBetween(tokenKeys, requestedFrom, toTime),
      this.candles.candleStatsBetween(tokenKeys, prefixStart, requestedFrom),
    ]);

    const buildMap = (
      partial?: ReadonlyMap<string, SandboxCandleStats>,
      partialPrefix?: ReadonlyMap<string, SandboxCandleStats>,
    ): Map<string, SandboxReplayWindowStats> =>
      new Map(
        tokenKeys.map((tokenKey) => {
          const entry: SandboxReplayWindowStats = {
            tokenKey,
            latestClosedOpenTime: latestClosed.get(tokenKey) ?? null,
            requested: requested.get(tokenKey) ?? EMPTY_STATS,
            requestedPrefix: requestedPrefix.get(tokenKey) ?? EMPTY_STATS,
            ...(partial === undefined ? {} : { partial: partial.get(tokenKey) ?? EMPTY_STATS }),
            ...(partialPrefix === undefined
              ? {}
              : { partialPrefix: partialPrefix.get(tokenKey) ?? EMPTY_STATS }),
          };
          return [tokenKey, entry];
        }),
      );

    let window = replayWindow(buildMap(), periodDays, allowPartial, now);

    if (allowPartial && window.shortened && window.fromTime.getTime() > requestedFrom.getTime()) {
      const movedFrom = window.fromTime;
      const [partial, partialPrefix] = await Promise.all([
        this.candles.candleStatsBetween(tokenKeys, movedFrom, toTime),
        this.candles.candleStatsBetween(tokenKeys, prefixStart, movedFrom),
      ]);
      window = replayWindow(buildMap(partial, partialPrefix), periodDays, true, now);
    }

    return { window, tokenKeys };
  }

  private assertWindowUsable(window: SandboxReplayWindow, allowPartial: boolean): void {
    if (window.status === 'missing') {
      throw new ConflictException({
        code: 'SANDBOX_REPLAY_COVERAGE_MISSING',
        message: 'Недостаточно данных для исторического прогона',
        details: window.warnings,
      });
    }

    if (!allowPartial && window.status === 'partial') {
      throw new ConflictException({
        code: 'SANDBOX_REPLAY_WINDOW_TOO_SHORT',
        message: 'Полное окно не покрыто; сокращённое окно требует подтверждения',
        details: window.warnings,
      });
    }

    if (window.shortened && window.evaluationBars < SANDBOX_REPLAY_MIN_PARTIAL_BARS) {
      throw new ConflictException({
        code: 'SANDBOX_REPLAY_WINDOW_TOO_SHORT',
        message: `Сокращённое окно короче ${SANDBOX_REPLAY_MIN_PARTIAL_BARS} часов`,
        details: window.warnings,
      });
    }

    // A hole inside the evaluation window is a block even with allowPartial;
    // allowPartial only accepts a shorter window, not a broken one.
    if (window.coverage.some((token) => token.gaps > 0 || token.status === 'missing')) {
      throw new ConflictException({
        code: 'SANDBOX_REPLAY_COVERAGE_MISSING',
        message: 'В окне прогона есть пропуски данных',
        details: window.warnings,
      });
    }
  }

  private async requireReplay(userId: string, id: string): Promise<SandboxReplayDetailRecord> {
    const replay = await this.replays.findReplay(userId, id);
    if (!replay) {
      throw new NotFoundException({
        code: 'SANDBOX_REPLAY_NOT_FOUND',
        message: 'Sandbox replay not found',
      });
    }
    return replay;
  }
}

function normalizeTokenKeys(tokenKeys: readonly string[]): string[] {
  const normalized = tokenKeys.map((key) => normalizeSandboxTokenKey(key) ?? key.trim());
  return [...new Set(normalized)];
}

function normalizeCapital(value: string): string {
  const parsed = new Decimal(value);
  if (!parsed.greaterThan(0)) {
    throw new ConflictException({
      code: 'SANDBOX_REPLAY_CAPITAL_INVALID',
      message: 'Initial capital must be positive',
    });
  }
  return parsed.toFixed(2);
}

function invalidStatus(message: string): ConflictException {
  return new ConflictException({
    code: 'SANDBOX_REPLAY_INVALID_STATUS',
    message,
  });
}

function isTerminal(record: SandboxReplayDetailRecord): boolean {
  return (
    record.status === 'completed' || record.status === 'failed' || record.status === 'cancelled'
  );
}

/** Converts a repository row to the owner-facing summary. */
export function toReplaySummary(record: SandboxReplaySummaryRecord): SandboxReplaySummary {
  return {
    id: record.id,
    name: record.name,
    status: record.status,
    tokenKeys: [...record.tokenKeys],
    periodDays: record.periodDays,
    fromTime: record.fromTime.toISOString(),
    toTime: record.toTime.toISOString(),
    initialCapitalUsd: new Decimal(record.initialCapitalUsd).toFixed(2),
    finalEquityUsd: record.finalEquityUsd,
    returnPct: record.returnPct,
    maxDrawdownPct: record.maxDrawdownPct,
    reportHash: record.reportHash,
    error: record.error,
    queuedAt: record.queuedAt.toISOString(),
    startedAt: record.startedAt ? record.startedAt.toISOString() : null,
    finishedAt: record.finishedAt ? record.finishedAt.toISOString() : null,
    archivedAt: record.archivedAt ? record.archivedAt.toISOString() : null,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}

/** Converts a repository row to the detail payload, validating frozen config. */
export function toReplayDetail(record: SandboxReplayDetailRecord): SandboxReplayDetail {
  const settings = sandboxDecisionSettingsSchema.safeParse(record.settings);
  const paper = sandboxPaperSettingsSchema.safeParse(record.paper);
  if (!settings.success || !paper.success) {
    // Frozen config is written from a validated request/defaults; a failure
    // here means the stored row is corrupt. Surface a typed 409 contract code
    // instead of a bare 500 path.
    throw new ConflictException({
      code: 'SANDBOX_REPLAY_STATE_INVALID',
      message: 'Сохранённая конфигурация прогона повреждена',
    });
  }

  return {
    ...toReplaySummary(record),
    settings: settings.data,
    paper: paper.data,
    seed: record.seed,
    eventCount: record.eventCount,
    eventHash: record.eventHash,
    dataSnapshotId: record.dataSnapshotId,
    candleSnapshotHash: record.candleSnapshotHash,
  };
}

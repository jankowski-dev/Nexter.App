import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import Decimal from 'decimal.js';
import {
  SANDBOX_EXECUTION_MODE,
  SANDBOX_STALE_AFTER_MS,
  SANDBOX_TIMEFRAME_MS,
  type SandboxEquityResponse,
  type SandboxEventsQuery,
  type SandboxEventsResponse,
  type SandboxEquityQuery,
  type SandboxIntentsResponse,
  type SandboxOverview,
  type SandboxPageQuery,
  type SandboxPositionsResponse,
  type SandboxReportResponse,
  type SandboxRunCounts,
  type SandboxRunDetail,
  type SandboxRunsQuery,
  type SandboxRunsResponse,
  type SandboxTradesResponse,
} from '@nexter/contracts';
import {
  toSandboxEquityPoint,
  toSandboxEvent,
  toSandboxIntent,
  toSandboxPosition,
  toSandboxRunDetail,
  toSandboxRunSummary,
  toSandboxTrade,
} from './sandbox-read.mapper';
import { SandboxReportService } from './sandbox-report.service';
import { SandboxRepository } from './sandbox.repository';
import { SANDBOX_ENABLED, type SandboxRunSnapshot } from './sandbox.types';

/** Largest active-run block returned by the overview. */
export const SANDBOX_OVERVIEW_ACTIVE_RUNS = 20;

/**
 * Owner read API for the sandbox.
 *
 * Every query is scoped to the authenticated owner; a run that belongs to
 * another owner (or is archived) is indistinguishable from a missing run and
 * returns 404. The service never mutates run state; lifecycle remains in
 * `SandboxRunService`.
 */
@Injectable()
export class SandboxReadService {
  constructor(
    @Inject(SANDBOX_ENABLED) private readonly enabled: boolean,
    private readonly repository: SandboxRepository,
    private readonly reports: SandboxReportService,
  ) {}

  async overview(userId: string, now: Date = new Date()): Promise<SandboxOverview> {
    const [statusCounts, activeRuns, lastTickAt, tokens] = await Promise.all([
      this.repository.runStatusCounts(userId),
      this.repository.listRuns(userId, {
        status: 'running',
        limit: SANDBOX_OVERVIEW_ACTIVE_RUNS,
      }),
      this.repository.lastTickAt(userId),
      this.repository.listTokens(userId),
    ]);

    const runs = emptyCounts();
    for (const row of statusCounts) {
      if (row.archived) {
        runs.archived += row.count;
        continue;
      }
      runs[row.status] += row.count;
      runs.total += row.count;
    }

    const enabledTokens = tokens.filter((token) => token.enabled).map((token) => token.tokenKey);
    const stats = await this.repository.candleStatsMany(enabledTokens);
    const staleTokens: string[] = [];
    let lastCandleAt: Date | null = null;
    for (const tokenKey of enabledTokens) {
      const lastOpenTime = stats.get(tokenKey)?.lastOpenTime ?? null;
      if (lastOpenTime !== null && (lastCandleAt === null || lastOpenTime > lastCandleAt)) {
        lastCandleAt = lastOpenTime;
      }
      const lastCloseTime = lastOpenTime ? lastOpenTime.getTime() + SANDBOX_TIMEFRAME_MS : null;
      if (lastCloseTime === null || now.getTime() - lastCloseTime > SANDBOX_STALE_AFTER_MS) {
        staleTokens.push(tokenKey);
      }
    }
    staleTokens.sort();

    return {
      enabled: this.enabled,
      executionMode: SANDBOX_EXECUTION_MODE,
      runs,
      activeRuns: activeRuns.map(toSandboxRunSummary),
      lastTickAt: lastTickAt ? lastTickAt.toISOString() : null,
      universe: {
        tokens: tokens.length,
        enabledTokens: enabledTokens.length,
        staleTokens,
        lastCandleAt: lastCandleAt ? lastCandleAt.toISOString() : null,
      },
    };
  }

  async listRuns(userId: string, query: SandboxRunsQuery): Promise<SandboxRunsResponse> {
    const [rows, total] = await Promise.all([
      this.repository.listRuns(userId, {
        status: query.status,
        includeArchived: query.includeArchived,
        limit: query.limit,
        offset: query.offset,
      }),
      this.repository.countRuns(userId, {
        status: query.status,
        includeArchived: query.includeArchived,
      }),
    ]);

    return {
      runs: rows.map(toSandboxRunSummary),
      total,
      limit: query.limit,
      offset: query.offset,
    };
  }

  async getRun(userId: string, runId: string): Promise<SandboxRunDetail> {
    const run = await this.requireRun(userId, runId);
    const [openPositions, openTrades, closedTrades, intents, pendingIntents, equityPoints, ledger] =
      await Promise.all([
        this.repository.countOpenPositions(runId),
        this.repository.countTrades(runId, 'open'),
        this.repository.countTrades(runId, 'closed'),
        this.repository.countIntents(runId),
        this.repository.countIntents(runId, 'pending'),
        this.repository.countEquityPoints(runId),
        this.repository.countLedgerEntries(runId),
      ]);

    return toSandboxRunDetail(run, {
      openPositions,
      openTrades,
      closedTrades,
      intents,
      pendingIntents,
      equityPoints,
      ledgerEntries: ledger,
    });
  }

  async positions(userId: string, runId: string): Promise<SandboxPositionsResponse> {
    await this.requireRun(userId, runId);
    const rows = await this.repository.listPositions(runId);

    return {
      positions: rows
        .filter((row) => new Decimal(row.amount).greaterThan(0))
        .map(toSandboxPosition),
    };
  }

  async trades(
    userId: string,
    runId: string,
    query: SandboxPageQuery,
  ): Promise<SandboxTradesResponse> {
    await this.requireRun(userId, runId);
    const [rows, total] = await Promise.all([
      this.repository.listTrades(runId, { limit: query.limit, offset: query.offset }),
      this.repository.countTrades(runId),
    ]);

    return {
      trades: rows.map(toSandboxTrade),
      total,
      limit: query.limit,
      offset: query.offset,
    };
  }

  async intents(
    userId: string,
    runId: string,
    query: SandboxPageQuery,
  ): Promise<SandboxIntentsResponse> {
    await this.requireRun(userId, runId);
    const [rows, total] = await Promise.all([
      this.repository.listIntents(runId, { limit: query.limit, offset: query.offset }),
      this.repository.countIntents(runId),
    ]);

    return {
      intents: rows.map(toSandboxIntent),
      total,
      limit: query.limit,
      offset: query.offset,
    };
  }

  async events(
    userId: string,
    runId: string,
    query: SandboxEventsQuery,
  ): Promise<SandboxEventsResponse> {
    await this.requireRun(userId, runId);
    const rows = await this.repository.listEvents(runId, {
      afterSeq: query.afterSeq,
      limit: query.limit + 1,
    });
    const hasMore = rows.length > query.limit;
    const page = hasMore ? rows.slice(0, query.limit) : rows;

    return {
      events: page.map(toSandboxEvent),
      hasMore,
      nextAfterSeq: page.at(-1)?.seq ?? null,
    };
  }

  async equity(
    userId: string,
    runId: string,
    query: SandboxEquityQuery,
  ): Promise<SandboxEquityResponse> {
    await this.requireRun(userId, runId);
    const [rows, total] = await Promise.all([
      this.repository.listEquityPoints(runId, { limit: query.limit, offset: query.offset }),
      this.repository.countEquityPoints(runId),
    ]);

    return {
      points: rows.map(toSandboxEquityPoint),
      total,
      limit: query.limit,
      offset: query.offset,
    };
  }

  report(userId: string, runId: string): Promise<SandboxReportResponse> {
    return this.reports.getReport(userId, runId);
  }

  reportMarkdown(userId: string, runId: string): Promise<string> {
    return this.reports.getReportMarkdown(userId, runId);
  }

  private async requireRun(userId: string, runId: string): Promise<SandboxRunSnapshot> {
    const run = await this.repository.loadRun(runId);
    // Archived runs remain readable; only lifecycle mutations are blocked.
    if (!run || run.userId !== userId) {
      throw new NotFoundException({
        code: 'SANDBOX_RUN_NOT_FOUND',
        message: 'Sandbox run not found',
      });
    }
    return run;
  }
}

function emptyCounts(): SandboxRunCounts {
  return {
    total: 0,
    draft: 0,
    running: 0,
    paused: 0,
    stopped: 0,
    failed: 0,
    archived: 0,
  };
}

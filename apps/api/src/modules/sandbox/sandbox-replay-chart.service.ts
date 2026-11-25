import { ConflictException, Injectable, NotFoundException, Optional } from '@nestjs/common';
import {
  sandboxReplayChartActionSchema,
  sandboxReplayChartResponseSchema,
  sandboxReplayDecisionSchema,
  sandboxReplayDecisionsResponseSchema,
  type SandboxReplayChartAction,
  type SandboxReplayChartResponse,
  type SandboxReplayDecisionsQuery,
  type SandboxReplayDecisionsResponse,
  type SandboxReplayDecision,
  type SandboxReplayReportResponse,
} from '@nexter/contracts';
import {
  runPaperFromCandles,
  type Candle,
  type RunPaperFromCandlesInput,
  type RunPaperFromCandlesResult,
  type SandboxEvent,
} from '@nexter/sandbox-core';
import {
  decodeReplaySnapshot,
  ReplayExecutionError,
  toCoreDecisionSettings,
  toCorePaperSettings,
} from './sandbox-replay.executor';
import {
  SandboxReplayRepository,
  type SandboxReplayChartSource,
} from './sandbox-replay.repository';
import { SandboxReplayReportService } from './sandbox-replay-report.service';

export type ReplayDecisionsRunner = (
  input: RunPaperFromCandlesInput,
) => Promise<RunPaperFromCandlesResult>;

const ACTION_ORDER: Record<SandboxReplayChartAction['kind'], number> = {
  buy: 0,
  sell: 1,
  reject: 2,
  expire: 3,
  counterfactual: 4,
};

const DECISION_CACHE_LIMIT = 3;

/**
 * Read-only chart/decision projection over a completed replay.
 *
 * The stored report is already deterministic; this service only reads its
 * intent/trade/counterfactual rows and the exact gzip candle snapshot. The
 * full decision journal is re-derived from that snapshot on demand (and cached
 * in memory), never persisted or fed back into the report hash.
 */
@Injectable()
export class SandboxReplayChartService {
  private readonly decisionCache = new Map<string, SandboxReplayDecision[]>();

  constructor(
    private readonly replays: SandboxReplayRepository,
    private readonly reports: SandboxReplayReportService,
    @Optional() private readonly runDecisions: ReplayDecisionsRunner = runPaperFromCandles,
  ) {}

  async getChart(userId: string, id: string): Promise<SandboxReplayChartResponse> {
    const { response, source, candles } = await this.loadSource(userId, id);
    const from = source.replay.fromTime.getTime();
    const to = source.replay.toTime.getTime();
    const windowCandles = candles.filter((item) => item.openTime >= from && item.openTime < to);
    const candlesByToken = new Map<string, Candle[]>();
    for (const item of windowCandles) {
      const list = candlesByToken.get(item.tokenId) ?? [];
      list.push(item);
      candlesByToken.set(item.tokenId, list);
    }

    const lastCloseAt = (tokenId: string, time: number): string | null => {
      const list = candlesByToken.get(tokenId) ?? [];
      let close: string | null = null;
      for (const item of list) {
        if (item.openTime > time) break;
        close = item.close;
      }
      return close;
    };

    const tradeByIntent = new Map<string, { tradeId: string; realizedPnlUsd: string }>();
    for (const trade of response.report.trades) {
      tradeByIntent.set(trade.entryIntentId, {
        tradeId: trade.tradeId,
        realizedPnlUsd: trade.realizedPnlUsd,
      });
      if (trade.exitIntentId) {
        tradeByIntent.set(trade.exitIntentId, {
          tradeId: trade.tradeId,
          realizedPnlUsd: trade.realizedPnlUsd,
        });
      }
    }

    const actions: SandboxReplayChartAction[] = response.report.intentJournal.map((intent) => {
      const trade = tradeByIntent.get(intent.intentId);
      const status =
        intent.status === 'filled' || intent.status === 'partial'
          ? intent.side
          : intent.status === 'rejected'
            ? 'reject'
            : 'expire';
      const time = intent.fillTime ?? intent.decisionTime;
      const price = intent.priceUsd ?? lastCloseAt(intent.tokenId, time) ?? null;
      return sandboxReplayChartActionSchema.parse({
        id: intent.intentId,
        tokenId: intent.tokenId,
        time,
        kind: status,
        priceUsd: price,
        amountUsd: intent.filledUsd || intent.requestedUsd || '0.00',
        pnlUsd: intent.side === 'sell' ? (trade?.realizedPnlUsd ?? null) : null,
        reasonCode: intent.reasonCode,
        reasonText: intent.reasonText,
        intentId: intent.intentId,
        tradeId: trade?.tradeId ?? null,
      });
    });

    response.report.counterfactuals.forEach((counterfactual, index) => {
      const time = counterfactual.decisionTime;
      actions.push(
        sandboxReplayChartActionSchema.parse({
          id: `counterfactual-${counterfactual.tokenId}-${time}-${index}`,
          tokenId: counterfactual.tokenId,
          time,
          kind: 'counterfactual',
          priceUsd:
            counterfactual.entryPriceUsd ??
            counterfactual.exitPriceUsd ??
            lastCloseAt(counterfactual.tokenId, time),
          amountUsd: '0.00',
          pnlUsd: null,
          reasonCode: counterfactual.reasonCode,
          reasonText: `Hindsight: ${counterfactual.outcome.replaceAll('_', ' ')}`,
          intentId: null,
          tradeId: null,
        }),
      );
    });

    actions.sort(
      (left, right) =>
        left.time - right.time ||
        ACTION_ORDER[left.kind] - ACTION_ORDER[right.kind] ||
        left.id.localeCompare(right.id),
    );

    return sandboxReplayChartResponseSchema.parse({
      replayId: response.report.runId,
      tokens: response.report.period.tokens.map((tokenId) => ({
        tokenId,
        candles: (candlesByToken.get(tokenId) ?? []).map((item) => ({
          time: item.openTime,
          openUsd: item.open,
          highUsd: item.high,
          lowUsd: item.low,
          closeUsd: item.close,
        })),
      })),
      actions,
      note:
        'Показаны только свечи окна оценки; prefix-история не торговалась. ' +
        'Исполнение — next-open paper, без реальных ордеров.',
    });
  }

  async getDecisions(
    userId: string,
    id: string,
    query: SandboxReplayDecisionsQuery,
  ): Promise<SandboxReplayDecisionsResponse> {
    const { response, source, candles } = await this.loadSource(userId, id);
    const key = `${id}:${response.report.reportHash}`;
    let rows = this.decisionCache.get(key);
    if (!rows) {
      try {
        const result = await this.runDecisions({
          runId: source.replay.id,
          seed: source.replay.seed,
          configVersion: response.report.configVersion,
          dataSnapshotId: response.report.dataSnapshotId,
          tokenIds: source.replay.tokenKeys,
          candles,
          settings: toCoreDecisionSettings(source.replay.settings),
          paper: toCorePaperSettings(source.replay.paper),
          initialCapitalUsd: source.replay.initialCapitalUsd,
          evaluateFrom: source.replay.fromTime.getTime(),
        });
        rows = mapDecisionEvents(result.events);
      } catch (error) {
        if (error instanceof ReplayExecutionError) {
          throw new ConflictException({
            code: 'SANDBOX_REPLAY_DECISIONS_UNAVAILABLE',
            message: 'Не удалось восстановить журнал решений прогона',
            details: { reason: error.message },
          });
        }
        throw error;
      }
      this.decisionCache.set(key, rows);
      if (this.decisionCache.size > DECISION_CACHE_LIMIT) {
        const oldest = this.decisionCache.keys().next().value;
        if (oldest) this.decisionCache.delete(oldest);
      }
    }

    const filtered = query.tokenId ? rows.filter((row) => row.tokenId === query.tokenId) : rows;
    return sandboxReplayDecisionsResponseSchema.parse({
      items: filtered.slice(query.offset, query.offset + query.limit),
      total: filtered.length,
      limit: query.limit,
      offset: query.offset,
    });
  }

  private async loadSource(
    userId: string,
    id: string,
  ): Promise<{
    response: SandboxReplayReportResponse;
    source: SandboxReplayChartSource;
    candles: Candle[];
  }> {
    const response = await this.reports.getReport(userId, id);
    const source = await this.replays.findReplayChartSource(userId, id);
    if (!source) {
      throw new NotFoundException({
        code: 'SANDBOX_REPLAY_NOT_FOUND',
        message: 'Sandbox replay not found',
      });
    }
    if (!source.candleSnapshot || !source.replay.candleSnapshotHash) {
      throw new ConflictException({
        code: 'SANDBOX_REPLAY_SNAPSHOT_MISSING',
        message: 'Снимок свечей прогона не найден',
      });
    }
    const snapshot = decodeReplaySnapshot(
      source.candleSnapshot,
      source.replay.candleSnapshotHash,
      response.report.dataSnapshotId,
    );
    return { response, source, candles: snapshot.candles };
  }
}

export function mapDecisionEvents(events: readonly SandboxEvent[]): SandboxReplayDecision[] {
  return events
    .filter(
      (event) => event.decision !== null && event.decision !== undefined && Boolean(event.tokenId),
    )
    .map((event) => sandboxReplayDecisionSchema.parse(sandboxReplayDecisionFromEvent(event)))
    .sort(
      (left, right) =>
        left.time - right.time ||
        left.tokenId.localeCompare(right.tokenId) ||
        left.reasonCode.localeCompare(right.reasonCode),
    );
}

function sandboxReplayDecisionFromEvent(event: SandboxEvent): SandboxReplayDecision {
  const decision = event.decision;
  if (!decision || !event.tokenId) throw new Error('decision event is incomplete');
  const time = Date.parse(event.clockTime);
  if (!Number.isFinite(time) || time < 0) {
    throw new Error(`decision event has an invalid clockTime: ${event.clockTime}`);
  }
  return {
    time,
    tokenId: event.tokenId,
    strategyKey: event.strategyId ?? '',
    action: decision.action,
    sizeUsd: decision.sizeUsd,
    reasonCode: decision.reasonCode,
    reasonText: decision.reasonText,
  };
}

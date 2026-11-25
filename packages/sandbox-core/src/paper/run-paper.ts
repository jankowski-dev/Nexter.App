import { settingsVersion } from '../decision/defaults';
import { Reason } from '../decision/reason-codes';
import type { ReasonCode } from '../decision/reason-codes';
import { MemoryEventLog } from '../events/memory-event-log';
import type { SandboxEvent } from '../events/event-types';
import { candleCloseTime } from '../timeframes';
import type { Candle, Timestamp } from '../types';
import { analyzeRejectedBuys } from './counterfactual';
import { markPortfolio } from './ledger';
import { computeMetrics } from './metrics';
import { PaperRunError, PaperRunner } from './paper-runner';
import { buildReport } from './report';
import type {
  PaperRunResult,
  RejectedBuy,
  RunPaperFromCandlesInput,
  RunPaperFromCandlesResult,
} from './types';

/**
 * Reusable candle-driven paper run.
 *
 * This is exactly the Stage 1C report pipeline without any file or artifact
 * handling: `PaperRunner` (Stage 1B decisions, next-open fills, ledger), final
 * marks at the last evaluated bar close, metrics, hindsight counterfactuals and
 * the deterministic `RunReport`. Callers such as the CLI and the historical
 * replay worker supply validated candles and the frozen run identity, so the
 * report/mark/counterfactual logic exists exactly once.
 *
 * The helper never mutates its input, reads the wall clock or uses randomness:
 * the same candles, config, seed and settings always produce the same
 * `reportHash`.
 */

/** Locale-independent code-unit ordering used by every deterministic sort. */
function compareCodeUnits(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

const REASON_CODES: ReadonlySet<string> = new Set<string>(Object.values(Reason));

/**
 * Blocked reasons that are structurally not missed buys.
 *
 * `ALLOC_EXISTING_POSITION` means the token is already held and the sandbox
 * never adds to a position, so there is no omitted entry to replay.
 */
const NON_COUNTERFACTUAL_REASONS: ReadonlySet<ReasonCode> = new Set<ReasonCode>([
  Reason.ALLOC_EXISTING_POSITION,
]);

function toReasonCode(value: unknown): ReasonCode | null {
  return typeof value === 'string' && REASON_CODES.has(value) ? (value as ReasonCode) : null;
}

/**
 * Last candle close for a token whose bar closed at or before `lastBar`.
 *
 * The scan is independent of the input order, so an unsorted caller (for
 * example a database read) resolves the same mark as a sorted snapshot.
 */
function lastMarkAtOrBefore(
  candles: readonly Candle[],
  tokenId: string,
  lastBar: Timestamp,
): string | null {
  let mark: string | null = null;
  let latestClose = Number.NEGATIVE_INFINITY;
  for (const candle of candles) {
    if (candle.tokenId !== tokenId) continue;
    const closeTime = candleCloseTime(candle);
    if (closeTime > lastBar || closeTime <= latestClose) continue;
    latestClose = closeTime;
    mark = candle.close;
  }
  return mark;
}

/**
 * Runs one paper simulation over the supplied candles and builds its report.
 *
 * Final marks use the last close for each open position at or before the last
 * evaluated bar, so the report's positions and reconciliation describe the same
 * instant as the final equity point. Rejected opportunities combine terminal
 * buy intents with blocked `opportunity.dropped`/`portfolio.dropped` and buy
 * `risk.checked` events; the analyzer deduplicates them.
 */
export async function runPaperFromCandles(
  input: RunPaperFromCandlesInput,
): Promise<RunPaperFromCandlesResult> {
  const log = new MemoryEventLog();
  const result = await new PaperRunner(log).run({
    runId: input.runId,
    seed: input.seed,
    configVersion: input.configVersion,
    dataSnapshotId: input.dataSnapshotId,
    tokenIds: input.tokenIds,
    candles: input.candles,
    settings: input.settings,
    paper: input.paper,
    ...(input.initialCapitalUsd === undefined
      ? {}
      : { initialCapitalUsd: input.initialCapitalUsd }),
    ...(input.evaluateFrom === undefined ? {} : { evaluateFrom: input.evaluateFrom }),
  });
  const events = log.events();

  const lastBar = result.equityCurve[result.equityCurve.length - 1]?.clockTime;
  if (lastBar === undefined) throw new Error('The paper run produced no bars');

  const marks: Record<string, string> = {};
  for (const tokenId of Object.keys(result.ledger.positions).sort(compareCodeUnits)) {
    const mark = lastMarkAtOrBefore(input.candles, tokenId, lastBar);
    if (mark === null) {
      throw new PaperRunError(
        'PAPER_NO_MARK',
        `No mark price is available for ${tokenId} at the last bar`,
      );
    }
    marks[tokenId] = mark;
  }

  const finalMark = markPortfolio(result.ledger, marks);
  const metrics = computeMetrics({
    initialCapitalUsd: result.ledger.initialCapitalUsd,
    finalEquityUsd: finalMark.equityUsd,
    finalPositionsValueUsd: finalMark.positionsValueUsd,
    unrealizedPnlUsd: finalMark.unrealizedPnlUsd,
    equityCurve: result.equityCurve,
    ledger: result.ledger,
    closedTrades: result.ledger.closedTrades,
  });

  const rejected = collectRejectedBuys(result, events);
  const counterfactuals = analyzeRejectedBuys({
    rejected,
    candles: input.candles,
    horizonHours: input.paper.counterfactualHorizonHours,
    feeBps: input.paper.feeBps,
    slippageBps: input.paper.slippageBps,
  });

  const report = buildReport({
    result,
    finalMark,
    marks,
    events,
    counterfactuals,
    settingsVersion: settingsVersion(input.settings),
    metrics,
  });

  return { report, result, events };
}

/**
 * Rejected buys for the hindsight analysis.
 *
 * Terminal rejected/expired buy intents carry the decision time directly. The
 * decision-engine drops and buy risk vetoes describe buys that never became
 * intents; their event clock is the decision bar close, matching the runner's
 * intent stamp. The analyzer deduplicates identical rows.
 */
export function collectRejectedBuys(
  result: Pick<PaperRunResult, 'intents'>,
  events: readonly SandboxEvent[],
): RejectedBuy[] {
  const rejected: RejectedBuy[] = [];

  for (const intent of result.intents) {
    if (intent.side === 'buy' && (intent.status === 'rejected' || intent.status === 'expired')) {
      rejected.push({
        tokenId: intent.tokenId,
        decisionTime: intent.decisionTime,
        reasonCode: intent.reasonCode,
      });
    }
  }

  for (const event of events) {
    if (event.decision?.action !== 'block') continue;
    const isDrop =
      event.eventType === 'opportunity.dropped' || event.eventType === 'portfolio.dropped';
    const isBuyRisk = event.eventType === 'risk.checked' && event.inputs?.kind === 'buy';
    if (!isDrop && !isBuyRisk) continue;

    const tokenId = event.tokenId;
    if (typeof tokenId !== 'string' || tokenId.length === 0) continue;
    const decisionTime = Date.parse(event.clockTime);
    if (!Number.isFinite(decisionTime)) {
      throw new Error(`Blocked ${event.eventType} event has an invalid clock: ${event.clockTime}`);
    }
    const reasonCode = toReasonCode(event.reasonCode ?? event.decision.reasonCode);
    if (reasonCode === null) {
      throw new Error(`Blocked ${event.eventType} event has an unknown reason code`);
    }
    if (NON_COUNTERFACTUAL_REASONS.has(reasonCode)) continue;
    rejected.push({ tokenId, decisionTime, reasonCode });
  }

  return rejected;
}

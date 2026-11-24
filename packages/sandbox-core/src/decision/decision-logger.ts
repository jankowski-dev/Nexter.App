import type { EventLog } from '../events/event-log';
import type {
  SandboxAlternative,
  SandboxDecision,
  SandboxEvent,
  SandboxEventInput,
} from '../events/event-types';
import type { Timestamp } from '../types';
import type { RankedOpportunity, RankingDrop } from './opportunity-ranker';
import type { Allocation, AllocationDrop } from './portfolio-allocator';
import { Reason } from './reason-codes';
import type { ReasonCode } from './reason-codes';
import type { RiskOutcome } from './risk-manager';
import type { StrategySignal } from './strategies';
import type { OrderIntent, Regime, RegimeState, StrategyKey, TokenPhase } from './types';

/**
 * Structured audit log for one decision cycle.
 *
 * The logger owns the Stage 1A base fields and the event-catalog shaping; the
 * engine passes domain values only. One method per `eventType`, so the audit
 * vocabulary cannot drift between callers. Every event that carries a
 * `decision` also carries a stable reason code and at least one alternative
 * (rule R4).
 */

export interface DecisionLogBase {
  readonly runId: string;
  readonly seed: number;
  readonly configVersion: string;
  readonly dataSnapshotId: string;
  /** ISO timestamp shared by every event of this cycle. */
  readonly clockTime: string;
}

type EventBody = Omit<
  SandboxEventInput,
  'runId' | 'seed' | 'configVersion' | 'dataSnapshotId' | 'clockTime'
>;

export interface RegimeLogInput {
  readonly tokenId: string;
  readonly regime: Regime;
  readonly reasonCode: ReasonCode;
  readonly reasonText: string;
  readonly rawRegime: Regime;
  readonly before: RegimeState | null;
  readonly after: RegimeState;
}

export interface StrategyLogInput {
  readonly tokenId: string;
  readonly strategyKey: StrategyKey;
  readonly strategyVersion: number;
}

export interface RiskLogInput {
  readonly kind: 'buy' | 'sell';
  readonly tokenId: string;
  readonly strategyKey: StrategyKey;
  readonly sizeUsd: string;
  readonly stopLossPct: string | null;
  readonly riskWeight: number;
  readonly outcome: RiskOutcome;
}

export interface CycleLogInput {
  /** The caller's requested universe, sorted by code unit. */
  readonly tokenIds: readonly string[];
  /** Requested universe plus position tokens, sorted by code unit. */
  readonly evaluatedTokenIds: readonly string[];
  readonly settingsVersion: string;
  readonly equityUsd: string;
  readonly cashUsd: string;
  readonly openPositions: readonly string[];
}

export interface CompletedLogInput {
  readonly intents: number;
  readonly buys: number;
  readonly sells: number;
  readonly dropped: number;
  readonly tokens: number;
}

function alternative(
  action: SandboxAlternative['action'],
  reasonCode: string,
  whyNot: string,
): SandboxAlternative {
  return { action, reasonCode, whyNot };
}

function decision(
  action: SandboxDecision['action'],
  sizeUsd: string | null,
  reasonCode: string,
  reasonText: string,
): SandboxDecision {
  return { action, sizeUsd, reasonCode, reasonText };
}

function iso(timestamp: Timestamp): string {
  return new Date(timestamp).toISOString();
}

/** Serializable regime state for `stateBefore`/`stateAfter` payloads. */
function regimeRecord(state: RegimeState | null): Record<string, unknown> | null {
  if (state === null) return null;
  return {
    regime: state.regime,
    reasonCode: state.reasonCode,
    candidate: state.candidate,
    candidateBars: state.candidateBars,
    since: iso(state.since),
  };
}

function regimeInputs(state: RegimeState, rawRegime: Regime): Record<string, unknown> {
  return {
    features: state.features,
    rawRegime,
    candidate: state.candidate,
    candidateBars: state.candidateBars,
    rulesVersion: state.rulesVersion,
  };
}

export class DecisionLogger {
  constructor(
    private readonly log: EventLog,
    private readonly base: DecisionLogBase,
  ) {}

  private append(body: EventBody): Promise<SandboxEvent> {
    return this.log.append({ ...body, ...this.base });
  }

  cycle(input: CycleLogInput): Promise<SandboxEvent> {
    return this.append({
      module: 'run',
      eventType: 'decision.cycle',
      severity: 'info',
      inputs: {
        tokenIds: [...input.tokenIds],
        evaluatedTokenIds: [...input.evaluatedTokenIds],
        settingsVersion: input.settingsVersion,
        equityUsd: input.equityUsd,
        cashUsd: input.cashUsd,
        openPositions: [...input.openPositions],
      },
      reasonCode: Reason.DECISION_CYCLE,
      reasonText: `Decision cycle started for ${input.evaluatedTokenIds.length} evaluated token(s)`,
    });
  }

  regimeEvaluated(input: RegimeLogInput): Promise<SandboxEvent> {
    return this.append({
      module: 'regime',
      eventType: 'regime.evaluated',
      severity: 'debug',
      tokenId: input.tokenId,
      regime: input.regime,
      stateBefore: regimeRecord(input.before),
      stateAfter: regimeRecord(input.after),
      inputs: regimeInputs(input.after, input.rawRegime),
      reasonCode: input.reasonCode,
      reasonText: input.reasonText,
    });
  }

  regimeChanged(input: RegimeLogInput): Promise<SandboxEvent> {
    return this.append({
      module: 'regime',
      eventType: 'regime.changed',
      severity: 'info',
      tokenId: input.tokenId,
      regime: input.regime,
      stateBefore: regimeRecord(input.before),
      stateAfter: regimeRecord(input.after),
      inputs: regimeInputs(input.after, input.rawRegime),
      reasonCode: Reason.REGIME_CHANGED,
      reasonText: `Regime for ${input.tokenId} changed from ${input.before?.regime ?? 'none'} to ${input.regime}`,
    });
  }

  strategySelected(
    input: StrategyLogInput & { readonly reasonCode: ReasonCode },
  ): Promise<SandboxEvent> {
    const reasonText =
      input.reasonCode === Reason.STRATEGY_ORIGINAL_POSITION
        ? `Open position keeps its original strategy ${input.strategyKey}`
        : `Strategy ${input.strategyKey} selected by the current regime`;
    return this.append({
      module: 'strategy',
      eventType: 'strategy.selected',
      severity: 'debug',
      tokenId: input.tokenId,
      strategyId: input.strategyKey,
      inputs: { strategyVersion: input.strategyVersion },
      reasonCode: input.reasonCode,
      reasonText,
    });
  }

  strategySkipped(input: {
    readonly tokenId: string;
    readonly regime: Regime;
  }): Promise<SandboxEvent> {
    return this.append({
      module: 'strategy',
      eventType: 'strategy.skipped',
      severity: 'debug',
      tokenId: input.tokenId,
      regime: input.regime,
      inputs: { regime: input.regime },
      reasonCode: Reason.STRATEGY_NOT_ELIGIBLE,
      reasonText: `No strategy is eligible in the ${input.regime} regime for ${input.tokenId}`,
    });
  }

  strategyEvaluated(
    input: StrategyLogInput & { readonly signal: StrategySignal },
  ): Promise<SandboxEvent> {
    return this.append({
      module: 'strategy',
      eventType: 'strategy.evaluated',
      severity: 'debug',
      tokenId: input.tokenId,
      strategyId: input.strategyKey,
      inputs: {
        strategyVersion: input.strategyVersion,
        action: input.signal.action,
        confidence: input.signal.confidence,
        riskWeight: input.signal.riskWeight,
        stopLossPct: input.signal.stopLossPct,
        takeProfitPct: input.signal.takeProfitPct,
      },
      reasonCode: input.signal.reasonCode,
      reasonText: input.signal.reasonText,
    });
  }

  strategyRejected(input: StrategyLogInput): Promise<SandboxEvent> {
    const reasonText = `Strategy ${input.strategyKey} proposed a buy while ${input.tokenId} already has an open position; adds are not allowed`;
    return this.append({
      module: 'strategy',
      eventType: 'strategy.rejected',
      severity: 'warn',
      tokenId: input.tokenId,
      strategyId: input.strategyKey,
      inputs: { strategyVersion: input.strategyVersion },
      decision: decision('block', null, Reason.STRATEGY_BUY_WITH_POSITION, reasonText),
      alternatives: [
        alternative(
          'hold',
          Reason.STRATEGY_BUY_WITH_POSITION,
          'Holding the existing position is the only permissible action',
        ),
      ],
      reasonCode: Reason.STRATEGY_BUY_WITH_POSITION,
      reasonText,
    });
  }

  opportunityRanked(input: {
    readonly ranked: RankedOpportunity;
    readonly next: RankedOpportunity | null;
  }): Promise<SandboxEvent> {
    const { ranked, next } = input;
    const reasonText = `${ranked.tokenId} ranked #${ranked.rank} with score ${ranked.score}`;
    const alternatives =
      next === null
        ? [
            alternative(
              'hold',
              Reason.RANK_NO_ALTERNATIVE,
              'No other ranked opportunity remains in this cycle',
            ),
          ]
        : [
            alternative(
              'buy',
              Reason.RANK_LOWER_PRIORITY,
              `Lower-ranked ${next.tokenId} (score ${next.score}) is the next candidate`,
            ),
          ];
    return this.append({
      module: 'strategy',
      eventType: 'opportunity.ranked',
      severity: 'decision',
      tokenId: ranked.tokenId,
      strategyId: ranked.strategyKey,
      inputs: {
        rank: ranked.rank,
        score: ranked.score,
        confidence: ranked.signal.confidence,
        atrPct: ranked.atrPct,
        avgVolumeUsd: ranked.avgVolumeUsd,
      },
      decision: decision('buy', null, Reason.RANK_SELECTED, reasonText),
      alternatives,
      reasonCode: Reason.RANK_SELECTED,
      reasonText,
    });
  }

  opportunityDropped(input: { readonly drop: RankingDrop }): Promise<SandboxEvent> {
    const { drop } = input;
    return this.append({
      module: 'strategy',
      eventType: 'opportunity.dropped',
      severity: 'decision',
      tokenId: drop.candidate.tokenId,
      strategyId: drop.candidate.strategyKey,
      inputs: {
        atrPct: drop.candidate.atrPct,
        avgVolumeUsd: drop.candidate.avgVolumeUsd,
      },
      decision: decision('block', null, drop.reasonCode, drop.reasonText),
      alternatives: [
        alternative(
          'hold',
          drop.reasonCode === Reason.RANK_NO_DATA ? Reason.RANK_NO_ALTERNATIVE : drop.reasonCode,
          `Holding avoids the dropped opportunity ${drop.candidate.tokenId}`,
        ),
      ],
      reasonCode: drop.reasonCode,
      reasonText: drop.reasonText,
    });
  }

  portfolioAllocated(input: {
    readonly allocation: Allocation;
    readonly nextUnallocated: {
      readonly tokenId: string;
      readonly strategyKey: StrategyKey;
    } | null;
  }): Promise<SandboxEvent> {
    const { allocation, nextUnallocated } = input;
    const candidate = allocation.candidate;
    const reasonText = `Allocated ${allocation.sizeUsd} USD to ${candidate.tokenId}`;
    const alternatives =
      nextUnallocated === null
        ? [
            alternative(
              'hold',
              Reason.ALLOC_NO_ALTERNATIVE,
              'No other ranked candidate remains unallocated in this cycle',
            ),
          ]
        : [
            alternative(
              'buy',
              Reason.ALLOC_NO_ALTERNATIVE,
              `Lower-ranked ${nextUnallocated.tokenId} did not receive an allocation`,
            ),
          ];
    return this.append({
      module: 'portfolio',
      eventType: 'portfolio.allocated',
      severity: 'decision',
      tokenId: candidate.tokenId,
      strategyId: candidate.strategyKey,
      inputs: {
        sizeUsd: allocation.sizeUsd,
        stopLossPct: allocation.stopLossPct,
        takeProfitPct: allocation.takeProfitPct,
        bindingConstraint: allocation.bindingConstraint,
        rank: candidate.rank,
      },
      decision: decision('buy', allocation.sizeUsd, Reason.ALLOC_SELECTED, reasonText),
      alternatives,
      reasonCode: Reason.ALLOC_SELECTED,
      reasonText,
    });
  }

  portfolioDropped(input: { readonly drop: AllocationDrop }): Promise<SandboxEvent> {
    const { drop } = input;
    return this.append({
      module: 'portfolio',
      eventType: 'portfolio.dropped',
      severity: 'decision',
      tokenId: drop.candidate.tokenId,
      strategyId: drop.candidate.strategyKey,
      inputs: { rank: drop.candidate.rank },
      decision: decision('block', null, drop.reasonCode, drop.reasonText),
      alternatives: [
        alternative('hold', drop.reasonCode, `Holding instead of buying ${drop.candidate.tokenId}`),
      ],
      reasonCode: drop.reasonCode,
      reasonText: drop.reasonText,
    });
  }

  riskChecked(input: RiskLogInput): Promise<SandboxEvent> {
    const { outcome } = input;
    const passed = outcome.passed;
    const failedCode = outcome.failedCode ?? Reason.RISK_PASSED;
    const reasonCode = passed ? Reason.RISK_PASSED : failedCode;
    const reasonText = passed
      ? `All ${outcome.checks.length} ${input.kind} risk checks passed for ${input.tokenId}`
      : `${input.kind} risk check failed for ${input.tokenId}: ${failedCode}`;
    const decisionBody = passed
      ? decision(input.kind, input.sizeUsd, reasonCode, reasonText)
      : decision('block', input.sizeUsd, reasonCode, reasonText);
    const whyNot = passed
      ? 'All limits passed; holding is a valid alternative that takes no new risk'
      : `Blocked by ${failedCode}; holding keeps the current exposure`;

    return this.append({
      module: 'risk',
      eventType: 'risk.checked',
      severity: 'decision',
      tokenId: input.tokenId,
      strategyId: input.strategyKey,
      inputs: {
        kind: input.kind,
        stopLossPct: input.stopLossPct,
        riskWeight: input.riskWeight,
      },
      decision: decisionBody,
      alternatives: [alternative('hold', Reason.RISK_HOLD, whyNot)],
      riskChecks: [...outcome.checks],
      reasonCode,
      reasonText,
    });
  }

  orderIntent(input: {
    readonly intent: OrderIntent;
    readonly reasonText: string;
    readonly bindingConstraint: ReasonCode | null;
  }): Promise<SandboxEvent> {
    const { intent } = input;
    return this.append({
      module: 'portfolio',
      eventType: 'order.intent',
      severity: 'decision',
      tokenId: intent.tokenId,
      strategyId: intent.strategyKey,
      inputs: {
        intentId: intent.intentId,
        amount: intent.amount,
        stopLossPct: intent.stopLossPct,
        takeProfitPct: intent.takeProfitPct,
        decisionPriceUsd: intent.decisionPriceUsd,
        bindingConstraint: input.bindingConstraint,
      },
      decision: decision(intent.side, intent.sizeUsd, intent.reasonCode, input.reasonText),
      alternatives: [
        alternative(
          'hold',
          Reason.INTENT_NO_ALTERNATIVE,
          `Holding instead of sending the ${intent.side} intent is always possible`,
        ),
      ],
      reasonCode: intent.reasonCode,
      reasonText: input.reasonText,
    });
  }

  tokenStateChanged(input: {
    readonly tokenId: string;
    readonly previous: TokenPhase | null;
    readonly phase: TokenPhase;
    readonly reasonCode: ReasonCode;
  }): Promise<SandboxEvent> {
    return this.append({
      module: 'portfolio',
      eventType: 'token.state_changed',
      severity: 'info',
      tokenId: input.tokenId,
      stateBefore: { phase: input.previous },
      stateAfter: { phase: input.phase },
      inputs: { reasonCode: input.reasonCode },
      reasonCode: input.reasonCode,
      reasonText: `Token ${input.tokenId} phase changed from ${input.previous ?? 'none'} to ${input.phase}`,
    });
  }

  completed(input: CompletedLogInput): Promise<SandboxEvent> {
    return this.append({
      module: 'run',
      eventType: 'decision.completed',
      severity: 'debug',
      inputs: {
        intents: input.intents,
        buys: input.buys,
        sells: input.sells,
        dropped: input.dropped,
        tokens: input.tokens,
      },
      reasonCode: Reason.DECISION_CYCLE_COMPLETED,
      reasonText: `Decision cycle completed with ${input.intents} intent(s)`,
    });
  }
}

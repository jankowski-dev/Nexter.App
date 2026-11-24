import { Reason } from '../decision/reason-codes';
import type { ReasonCode } from '../decision/reason-codes';
import type { OrderIntent } from '../decision/types';
import type { EventLog } from '../events/event-log';
import type {
  SandboxAlternative,
  SandboxDecision,
  SandboxEvent,
  SandboxEventInput,
} from '../events/event-types';
import type { Timestamp } from '../types';
import type { BuyFillPlan, LedgerEntry, SellFillPlan } from './types';

/**
 * Structured audit log for one paper run.
 *
 * The logger owns the Stage 1A base fields and the paper/execution event shapes;
 * the runner passes domain values only. Fill and rejection events carry a
 * `decision` object with a stable reason code and at least one alternative
 * (`hold`), matching the Stage 1B decision-logger rule. Ledger entries and the
 * run lifecycle carry a reason code but no decision, because they describe a
 * booked fact rather than a choice.
 */

export interface PaperLogBase {
  readonly runId: string;
  readonly seed: number;
  readonly configVersion: string;
  readonly dataSnapshotId: string;
}

export interface PaperRunStartedLogInput {
  /** First processed bar close. */
  readonly clockTime: Timestamp;
  readonly timeframe: string;
  readonly bars: number;
  readonly tokens: readonly string[];
  readonly initialCapitalUsd: string;
}

export interface PaperFillLogInput {
  /** Bar open where the fill executed. */
  readonly clockTime: Timestamp;
  readonly intent: OrderIntent;
  readonly plan: BuyFillPlan | SellFillPlan;
  readonly cashAfterUsd: string;
  readonly positionAmountAfter: string;
}

export interface PaperRejectionLogInput {
  /** Bar open where the fill attempt resolved, or the decision close for a queue-time duplicate. */
  readonly clockTime: Timestamp;
  readonly intent: OrderIntent;
  readonly reasonCode: ReasonCode;
  readonly reasonText: string;
  readonly requestedUsd: string | null;
  readonly requestedAmount: string | null;
  readonly priceUsd: string | null;
  readonly cashAfterUsd: string;
  readonly positionAmountAfter: string;
}

export interface PaperExpiryLogInput {
  /** Bar open (or final close) where the intent expired. */
  readonly clockTime: Timestamp;
  readonly intent: OrderIntent;
  readonly queuedAt: Timestamp;
  readonly barsPending: number;
}

export interface PaperCooldownLogInput {
  readonly clockTime: Timestamp;
  readonly tokenId: string;
  readonly cooldownUntil: Timestamp;
  readonly cooldownHours: number;
  /** Strategy reason of the stop sell that armed the cooldown. */
  readonly triggerReasonCode: ReasonCode;
}

export interface PaperRunCompletedLogInput {
  readonly clockTime: Timestamp;
  readonly bars: number;
  readonly finalEquityUsd: string;
  readonly intents: number;
  readonly fills: number;
  readonly partials: number;
  readonly rejections: number;
  readonly expirations: number;
  readonly trades: number;
  readonly ledgerEntries: number;
}

type EventBody = Omit<SandboxEventInput, 'runId' | 'seed' | 'configVersion' | 'dataSnapshotId'>;

function iso(timestamp: Timestamp): string {
  return new Date(timestamp).toISOString();
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

function isSellPlan(plan: BuyFillPlan | SellFillPlan): plan is SellFillPlan {
  return 'notionalUsd' in plan;
}

/** USD size carried by the decision object: booked fill for a buy, notional for a sell. */
function decisionSize(plan: BuyFillPlan | SellFillPlan): string {
  return isSellPlan(plan) ? plan.notionalUsd : plan.filledUsd;
}

function fillInputs(
  intent: OrderIntent,
  plan: BuyFillPlan | SellFillPlan,
  cashAfterUsd: string,
  positionAmountAfter: string,
): Record<string, unknown> {
  const common = {
    intentId: intent.intentId,
    side: intent.side,
    strategyKey: intent.strategyKey,
    strategyVersion: intent.strategyVersion,
    decisionPriceUsd: intent.decisionPriceUsd,
    decisionTime: iso(intent.clockTime),
    priceUsd: plan.priceUsd,
    feeUsd: plan.feeUsd,
    reasonCode: plan.reasonCode,
    cashAfterUsd,
    positionAmountAfter,
  };
  if (isSellPlan(plan)) {
    return {
      ...common,
      requestedAmount: plan.requestedAmount,
      filledAmount: plan.filledAmount,
      unfilledAmount: plan.unfilledAmount,
      notionalUsd: plan.notionalUsd,
      proceedsUsd: plan.proceedsUsd,
    };
  }
  return {
    ...common,
    requestedUsd: plan.requestedUsd,
    filledUsd: plan.filledUsd,
    unfilledUsd: plan.unfilledUsd,
    amount: plan.amount,
  };
}

export class PaperLogger {
  constructor(
    private readonly log: EventLog,
    private readonly base: PaperLogBase,
  ) {}

  private append(body: EventBody): Promise<SandboxEvent> {
    return this.log.append({ ...body, ...this.base });
  }

  runStarted(input: PaperRunStartedLogInput): Promise<SandboxEvent> {
    return this.append({
      clockTime: iso(input.clockTime),
      module: 'run',
      eventType: 'paper.run_started',
      severity: 'info',
      inputs: {
        seed: this.base.seed,
        timeframe: input.timeframe,
        bars: input.bars,
        tokens: [...input.tokens],
        initialCapitalUsd: input.initialCapitalUsd,
      },
      reasonCode: Reason.PAPER_RUN_STARTED,
      reasonText: `Paper run started for ${input.tokens.length} token(s) over ${input.bars} bar(s)`,
    });
  }

  filled(input: PaperFillLogInput): Promise<SandboxEvent> {
    return this.append({
      clockTime: iso(input.clockTime),
      module: 'execution',
      eventType: 'execution.filled',
      severity: 'decision',
      tokenId: input.intent.tokenId,
      strategyId: input.intent.strategyKey,
      inputs: fillInputs(input.intent, input.plan, input.cashAfterUsd, input.positionAmountAfter),
      decision: decision(
        input.intent.side,
        decisionSize(input.plan),
        input.plan.reasonCode,
        input.plan.reasonText,
      ),
      alternatives: [
        alternative(
          'hold',
          Reason.INTENT_NO_ALTERNATIVE,
          `Holding instead of filling the ${input.intent.side} intent would leave the book unchanged`,
        ),
      ],
      reasonCode: input.plan.reasonCode,
      reasonText: input.plan.reasonText,
    });
  }

  partial(input: PaperFillLogInput): Promise<SandboxEvent> {
    return this.append({
      clockTime: iso(input.clockTime),
      module: 'execution',
      eventType: 'execution.partial',
      severity: 'decision',
      tokenId: input.intent.tokenId,
      strategyId: input.intent.strategyKey,
      inputs: fillInputs(input.intent, input.plan, input.cashAfterUsd, input.positionAmountAfter),
      decision: decision(
        input.intent.side,
        decisionSize(input.plan),
        input.plan.reasonCode,
        input.plan.reasonText,
      ),
      alternatives: [
        alternative(
          'hold',
          Reason.INTENT_NO_ALTERNATIVE,
          `Holding instead of partially filling the ${input.intent.side} intent would leave the book unchanged`,
        ),
      ],
      reasonCode: input.plan.reasonCode,
      reasonText: input.plan.reasonText,
    });
  }

  rejected(input: PaperRejectionLogInput): Promise<SandboxEvent> {
    return this.append({
      clockTime: iso(input.clockTime),
      module: 'execution',
      eventType: 'execution.rejected',
      severity: 'warn',
      tokenId: input.intent.tokenId,
      strategyId: input.intent.strategyKey,
      inputs: {
        intentId: input.intent.intentId,
        side: input.intent.side,
        strategyKey: input.intent.strategyKey,
        strategyVersion: input.intent.strategyVersion,
        decisionPriceUsd: input.intent.decisionPriceUsd,
        decisionTime: iso(input.intent.clockTime),
        requestedUsd: input.requestedUsd,
        requestedAmount: input.requestedAmount,
        priceUsd: input.priceUsd,
        cashAfterUsd: input.cashAfterUsd,
        positionAmountAfter: input.positionAmountAfter,
        reasonCode: input.reasonCode,
      },
      decision: decision('block', input.requestedUsd, input.reasonCode, input.reasonText),
      alternatives: [
        alternative(
          'hold',
          input.reasonCode,
          `Holding instead of filling the ${input.intent.side} intent keeps the book unchanged`,
        ),
      ],
      reasonCode: input.reasonCode,
      reasonText: input.reasonText,
    });
  }

  expired(input: PaperExpiryLogInput): Promise<SandboxEvent> {
    const reasonText =
      input.intent.side === 'buy'
        ? `Buy intent ${input.intent.intentId} expired after ${input.barsPending} bar(s) without a tradable open`
        : `Sell intent ${input.intent.intentId} expired after ${input.barsPending} bar(s) without a tradable open`;
    return this.append({
      clockTime: iso(input.clockTime),
      module: 'execution',
      eventType: 'execution.expired',
      severity: 'warn',
      tokenId: input.intent.tokenId,
      strategyId: input.intent.strategyKey,
      inputs: {
        intentId: input.intent.intentId,
        side: input.intent.side,
        strategyKey: input.intent.strategyKey,
        strategyVersion: input.intent.strategyVersion,
        decisionPriceUsd: input.intent.decisionPriceUsd,
        decisionTime: iso(input.intent.clockTime),
        queuedAt: iso(input.queuedAt),
        barsPending: input.barsPending,
      },
      decision: decision(
        'noop',
        input.intent.side === 'buy' ? input.intent.sizeUsd : null,
        Reason.FILL_EXPIRED,
        reasonText,
      ),
      alternatives: [
        alternative(
          'hold',
          Reason.FILL_EXPIRED,
          `Holding is the outcome of not filling the expired ${input.intent.side} intent`,
        ),
      ],
      reasonCode: Reason.FILL_EXPIRED,
      reasonText,
    });
  }

  ledgerEntry(input: {
    readonly clockTime: Timestamp;
    readonly entry: LedgerEntry;
  }): Promise<SandboxEvent> {
    const { entry } = input;
    return this.append({
      clockTime: iso(input.clockTime),
      module: 'ledger',
      eventType: 'ledger.entry',
      severity: 'info',
      tokenId: entry.tokenId,
      inputs: {
        entryId: entry.entryId,
        sequence: entry.sequence,
        side: entry.side,
        intentId: entry.intentId,
        amount: entry.amount,
        priceUsd: entry.priceUsd,
        notionalUsd: entry.notionalUsd,
        feeUsd: entry.feeUsd,
        cashAfterUsd: entry.cashAfterUsd,
        positionAmountAfter: entry.positionAmountAfter,
        positionAvgCostAfter: entry.positionAvgCostAfter,
        realizedPnlUsd: entry.realizedPnlUsd,
        reasonCode: entry.reasonCode,
      },
      reasonCode: entry.reasonCode,
      reasonText: `Ledger entry ${entry.sequence} booked a ${entry.side} of ${entry.amount} ${entry.tokenId}`,
    });
  }

  cooldownSet(input: PaperCooldownLogInput): Promise<SandboxEvent> {
    return this.append({
      clockTime: iso(input.clockTime),
      module: 'run',
      eventType: 'paper.cooldown_set',
      severity: 'info',
      tokenId: input.tokenId,
      inputs: {
        cooldownUntil: iso(input.cooldownUntil),
        cooldownHours: input.cooldownHours,
        triggerReasonCode: input.triggerReasonCode,
      },
      reasonCode: Reason.COOLDOWN_AFTER_STOP,
      reasonText: `${input.tokenId} is cooling down for ${input.cooldownHours} hour(s) after a ${input.triggerReasonCode} stop`,
    });
  }

  runCompleted(input: PaperRunCompletedLogInput): Promise<SandboxEvent> {
    return this.append({
      clockTime: iso(input.clockTime),
      module: 'run',
      eventType: 'paper.run_completed',
      severity: 'info',
      inputs: {
        bars: input.bars,
        finalEquityUsd: input.finalEquityUsd,
        intents: input.intents,
        fills: input.fills,
        partials: input.partials,
        rejections: input.rejections,
        expirations: input.expirations,
        trades: input.trades,
        ledgerEntries: input.ledgerEntries,
      },
      reasonCode: Reason.PAPER_RUN_COMPLETED,
      reasonText: `Paper run completed with final equity ${input.finalEquityUsd} USD over ${input.bars} bar(s)`,
    });
  }
}

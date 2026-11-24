import { describe, expect, it } from 'vitest';
import { Reason } from '../decision/reason-codes';
import { MemoryEventLog } from '../events/memory-event-log';
import { planBuyFill, planSellFill } from './execution';
import { FIXTURE_START, makeCandle, makeIntent, makeSettings } from './fixtures.test-helpers';
import { applyBuyFill, applySellFill, createLedger } from './ledger';
import { PaperLogger } from './paper-logger';

const BASE = {
  runId: 'run-log',
  seed: 11,
  configVersion: 'config-log',
  dataSnapshotId: 'snapshot-log',
} as const;

const T0 = FIXTURE_START;
const T1 = FIXTURE_START + 3_600_000;

function logger(): { log: MemoryEventLog; paper: PaperLogger } {
  const log = new MemoryEventLog();
  return { log, paper: new PaperLogger(log, BASE) };
}

function filledBuy() {
  const plan = planBuyFill({
    intent: makeIntent({ sizeUsd: '200' }),
    candle: makeCandle({ open: '100', close: '100' }),
    cashUsd: '1000',
    equityUsd: '1000',
    cashBufferPct: 10,
    settings: makeSettings(),
    hasPosition: false,
  });
  if (plan.status === 'rejected') throw new Error('expected a filled buy plan');
  return plan;
}

function partialBuy() {
  const plan = planBuyFill({
    intent: makeIntent({ sizeUsd: '200' }),
    candle: makeCandle({ open: '100', close: '100', volumeUsd: '1000' }),
    cashUsd: '1000',
    equityUsd: '1000',
    cashBufferPct: 10,
    settings: makeSettings({ liquidityCapPct: 1 }),
    hasPosition: false,
  });
  if (plan.status !== 'partial') throw new Error('expected a partial buy plan');
  return plan;
}

function rejectedBuy() {
  const plan = planBuyFill({
    intent: makeIntent({ sizeUsd: '200' }),
    candle: makeCandle(),
    cashUsd: '1000',
    equityUsd: '1000',
    cashBufferPct: 10,
    settings: makeSettings(),
    hasPosition: true,
  });
  if (plan.status !== 'rejected') throw new Error('expected a rejected buy plan');
  return plan;
}

function sellPlan(amount = '2') {
  const plan = planSellFill({
    intent: makeIntent({
      intentId: 'intent-sell',
      side: 'sell',
      amount,
      sizeUsd: '0',
      reasonCode: Reason.TREND_PULLBACK_STOP,
    }),
    candle: makeCandle({ open: '120', close: '120' }),
    positionAmount: amount,
    settings: makeSettings({ slippageBps: 0 }),
  });
  if (plan.status === 'rejected') throw new Error('expected a filled sell plan');
  return plan;
}

describe('PaperLogger', () => {
  it('logs run lifecycle events with the full Stage 1A base fields', async () => {
    const { log, paper } = logger();
    await paper.runStarted({
      clockTime: T0,
      timeframe: '1h',
      bars: 3,
      tokens: ['token'],
      initialCapitalUsd: '1000.00',
    });
    await paper.runCompleted({
      clockTime: T1,
      bars: 3,
      finalEquityUsd: '1001.00',
      intents: 2,
      fills: 1,
      partials: 0,
      rejections: 1,
      expirations: 0,
      trades: 1,
      ledgerEntries: 1,
    });

    const [started, completed] = log.events();
    expect(started?.eventType).toBe('paper.run_started');
    expect(started?.module).toBe('run');
    expect(started?.reasonCode).toBe(Reason.PAPER_RUN_STARTED);
    expect(started?.clockTime).toBe(new Date(T0).toISOString());
    expect(started?.inputs).toMatchObject({
      timeframe: '1h',
      bars: 3,
      tokens: ['token'],
      initialCapitalUsd: '1000.00',
      seed: 11,
    });
    expect(completed?.eventType).toBe('paper.run_completed');
    expect(completed?.reasonCode).toBe(Reason.PAPER_RUN_COMPLETED);
    expect(completed?.inputs).toMatchObject({
      finalEquityUsd: '1001.00',
      fills: 1,
      trades: 1,
      ledgerEntries: 1,
    });
    expect(completed?.decision).toBeNull();
    expect(completed?.alternatives).toEqual([]);

    for (const event of log.events()) {
      expect(event.runId).toBe(BASE.runId);
      expect(event.seed).toBe(BASE.seed);
      expect(event.configVersion).toBe(BASE.configVersion);
      expect(event.dataSnapshotId).toBe(BASE.dataSnapshotId);
      expect(event.reasonCode?.length ?? 0).toBeGreaterThan(0);
    }
  });

  it('logs a filled buy as an execution decision with a hold alternative', async () => {
    const { log, paper } = logger();
    const intent = makeIntent({ sizeUsd: '200' });
    const plan = filledBuy();
    await paper.filled({
      clockTime: T0,
      intent,
      plan,
      cashAfterUsd: '799.50',
      positionAmountAfter: '1.99800200',
    });

    const event = log.events()[0];
    expect(event?.eventType).toBe('execution.filled');
    expect(event?.module).toBe('execution');
    expect(event?.severity).toBe('decision');
    expect(event?.tokenId).toBe('token');
    expect(event?.reasonCode).toBe(Reason.FILL_FILLED);
    expect(event?.inputs).toMatchObject({
      intentId: 'intent-1',
      side: 'buy',
      requestedUsd: '200.00',
      filledUsd: '200.00',
      amount: '1.99800200',
      priceUsd: '100.10000000',
      feeUsd: '0.50',
      cashAfterUsd: '799.50',
      positionAmountAfter: '1.99800200',
    });
    expect(event?.decision).toEqual({
      action: 'buy',
      sizeUsd: '200.00',
      reasonCode: Reason.FILL_FILLED,
      reasonText: expect.stringContaining('Bought 200.00 USD'),
    });
    expect(event?.alternatives).toHaveLength(1);
    expect(event?.alternatives[0]?.action).toBe('hold');
    expect(event?.alternatives[0]?.reasonCode).toBe(Reason.INTENT_NO_ALTERNATIVE);
  });

  it('logs a partial fill with the unfilled remainder', async () => {
    const { log, paper } = logger();
    const plan = partialBuy();
    await paper.partial({
      clockTime: T0,
      intent: makeIntent({ sizeUsd: '200' }),
      plan,
      cashAfterUsd: '990.00',
      positionAmountAfter: '0.09990010',
    });

    const event = log.events()[0];
    expect(event?.eventType).toBe('execution.partial');
    expect(event?.reasonCode).toBe(Reason.FILL_PARTIAL);
    expect(event?.inputs).toMatchObject({
      requestedUsd: '200.00',
      filledUsd: '10.00',
      unfilledUsd: '190.00',
    });
    expect(event?.decision?.action).toBe('buy');
    expect(event?.alternatives.length).toBeGreaterThanOrEqual(1);
  });

  it('logs a rejected fill as a blocked decision with a hold alternative', async () => {
    const { log, paper } = logger();
    const plan = rejectedBuy();
    await paper.rejected({
      clockTime: T0,
      intent: makeIntent({ sizeUsd: '200' }),
      reasonCode: plan.reasonCode,
      reasonText: plan.reasonText,
      requestedUsd: plan.requestedUsd,
      requestedAmount: null,
      priceUsd: null,
      cashAfterUsd: '1000.00',
      positionAmountAfter: '1.99800200',
    });

    const event = log.events()[0];
    expect(event?.eventType).toBe('execution.rejected');
    expect(event?.module).toBe('execution');
    expect(event?.severity).toBe('warn');
    expect(event?.reasonCode).toBe(Reason.FILL_POSITION_EXISTS);
    expect(event?.decision?.action).toBe('block');
    expect(event?.decision?.reasonCode).toBe(Reason.FILL_POSITION_EXISTS);
    expect(event?.alternatives).toHaveLength(1);
    expect(event?.alternatives[0]?.action).toBe('hold');
    expect(event?.alternatives[0]?.whyNot.length).toBeGreaterThan(0);
  });

  it('logs an expiry as a noop decision with a hold alternative', async () => {
    const { log, paper } = logger();
    await paper.expired({
      clockTime: T1,
      intent: makeIntent({ sizeUsd: '200' }),
      queuedAt: T0,
      barsPending: 3,
    });

    const event = log.events()[0];
    expect(event?.eventType).toBe('execution.expired');
    expect(event?.module).toBe('execution');
    expect(event?.reasonCode).toBe(Reason.FILL_EXPIRED);
    expect(event?.decision?.action).toBe('noop');
    expect(event?.decision?.reasonCode).toBe(Reason.FILL_EXPIRED);
    expect(event?.inputs).toMatchObject({
      intentId: 'intent-1',
      queuedAt: new Date(T0).toISOString(),
      barsPending: 3,
    });
    expect(event?.alternatives).toHaveLength(1);
    expect(event?.alternatives[0]?.action).toBe('hold');
  });

  it('logs a ledger entry from the booked ledger row', async () => {
    const { log, paper } = logger();
    const intent = makeIntent({ sizeUsd: '200' });
    const state = createLedger('1000.00');
    const applied = applyBuyFill(state, filledBuy(), intent, T0);

    await paper.ledgerEntry({ clockTime: T0, entry: applied.entry });

    const event = log.events()[0];
    expect(event?.eventType).toBe('ledger.entry');
    expect(event?.module).toBe('ledger');
    expect(event?.tokenId).toBe('token');
    expect(event?.reasonCode).toBe(Reason.LEDGER_BUY);
    expect(event?.decision).toBeNull();
    expect(event?.inputs).toMatchObject({
      entryId: 'intent-1:ledger',
      sequence: 1,
      side: 'buy',
      intentId: 'intent-1',
      notionalUsd: '200.00',
      feeUsd: '0.50',
      cashAfterUsd: '799.50',
      realizedPnlUsd: null,
    });
  });

  it('logs a sell ledger entry with the sell reason and realised P&L', async () => {
    const { log, paper } = logger();
    const buyIntent = makeIntent({ sizeUsd: '200' });
    const bought = applyBuyFill(createLedger('1000.00'), filledBuy(), buyIntent, T0);
    const sellIntent = makeIntent({
      intentId: 'intent-sell',
      side: 'sell',
      amount: bought.state.positions.token?.amount ?? '0',
      sizeUsd: '0',
      reasonCode: Reason.TREND_PULLBACK_STOP,
    });
    const sold = applySellFill(bought.state, sellPlan(sellIntent.amount as string), sellIntent, T1);

    await paper.ledgerEntry({ clockTime: T1, entry: sold.entry });

    const event = log.events()[0];
    expect(event?.reasonCode).toBe(Reason.LEDGER_SELL);
    expect(event?.inputs).toMatchObject({
      side: 'sell',
      realizedPnlUsd: sold.entry.realizedPnlUsd,
    });
    expect(event?.decision).toBeNull();
  });

  it('logs a post-stop cooldown with the deadline and trigger reason', async () => {
    const { log, paper } = logger();
    const cooldownUntil = T1 + 24 * 3_600_000;
    await paper.cooldownSet({
      clockTime: T1,
      tokenId: 'token',
      cooldownUntil,
      cooldownHours: 24,
      triggerReasonCode: Reason.TREND_PULLBACK_STOP,
    });

    const event = log.events()[0];
    expect(event?.eventType).toBe('paper.cooldown_set');
    expect(event?.module).toBe('run');
    expect(event?.tokenId).toBe('token');
    expect(event?.reasonCode).toBe(Reason.COOLDOWN_AFTER_STOP);
    expect(event?.inputs).toMatchObject({
      cooldownUntil: new Date(cooldownUntil).toISOString(),
      cooldownHours: 24,
      triggerReasonCode: Reason.TREND_PULLBACK_STOP,
    });
  });

  it('keeps the decision/alternative invariant on every decision event', async () => {
    const { log, paper } = logger();
    const intent = makeIntent({ sizeUsd: '200' });
    await paper.runStarted({
      clockTime: T0,
      timeframe: '1h',
      bars: 1,
      tokens: ['token'],
      initialCapitalUsd: '1000.00',
    });
    await paper.filled({
      clockTime: T0,
      intent,
      plan: filledBuy(),
      cashAfterUsd: '799.50',
      positionAmountAfter: '1.99800200',
    });
    await paper.rejected({
      clockTime: T0,
      intent,
      reasonCode: Reason.FILL_INSUFFICIENT_CASH,
      reasonText: 'not enough cash',
      requestedUsd: '200.00',
      requestedAmount: null,
      priceUsd: '100.10000000',
      cashAfterUsd: '1.00',
      positionAmountAfter: '0.00000000',
    });
    await paper.expired({ clockTime: T1, intent, queuedAt: T0, barsPending: 2 });

    const decisions = log.events().filter((event) => event.decision !== null);
    expect(decisions).toHaveLength(3);
    for (const event of decisions) {
      expect(event.reasonCode?.length ?? 0).toBeGreaterThan(0);
      expect(event.decision?.reasonCode).toBe(event.reasonCode);
      expect(event.decision?.reasonText.length ?? 0).toBeGreaterThan(0);
      expect(event.alternatives.length).toBeGreaterThanOrEqual(1);
      for (const alternative of event.alternatives) {
        expect(alternative.reasonCode.length).toBeGreaterThan(0);
        expect(alternative.whyNot.length).toBeGreaterThan(0);
      }
    }
  });
});

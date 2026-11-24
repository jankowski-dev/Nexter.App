import Decimal from 'decimal.js';
import { describe, expect, it } from 'vitest';
import { Reason } from '../decision/reason-codes';
import { planBuyFill, planSellFill, type BuyFillInput, type SellFillInput } from './execution';
import { FIXTURE_START, makeCandle, makeIntent, makeSettings } from './fixtures.test-helpers';
import {
  PaperLedgerError,
  applyBuyFill,
  applySellFill,
  createLedger,
  markPortfolio,
  reconcileLedger,
} from './ledger';
import type { BuyFillPlan, PaperLedgerState, SellFillPlan } from './types';

const T1 = FIXTURE_START + 3_600_000;
const T2 = FIXTURE_START + 7_200_000;

const USD = /^-?\d+\.\d{2}$/;
const UNITS = /^\d+\.\d{8}$/;

function buyPlan(overrides: Partial<BuyFillInput> = {}): BuyFillPlan {
  return planBuyFill({
    intent: makeIntent({ sizeUsd: '200' }),
    candle: makeCandle({ open: '100', close: '100' }),
    cashUsd: '1000',
    equityUsd: '1000',
    cashBufferPct: 10,
    settings: makeSettings(),
    hasPosition: false,
    ...overrides,
  });
}

function sellPlan(
  positionAmount: string,
  amount: string,
  overrides: Partial<SellFillInput> = {},
): SellFillPlan {
  return planSellFill({
    intent: makeIntent({
      intentId: 'intent-sell',
      side: 'sell',
      amount,
      sizeUsd: '0',
      reasonCode: Reason.TREND_PULLBACK_STOP,
    }),
    candle: makeCandle({ open: '120', close: '120' }),
    positionAmount,
    settings: makeSettings({ slippageBps: 0 }),
    ...overrides,
  });
}

/** Manual plans let the test pin the 1e-8 clamp edge exactly. */
function manualBuyPlan(overrides: Partial<BuyFillPlan> = {}): BuyFillPlan {
  return {
    status: 'filled',
    tokenId: 'token',
    intentId: 'intent-buy',
    requestedUsd: '100.00',
    filledUsd: '100.00',
    unfilledUsd: '0.00',
    amount: '1.00000000',
    priceUsd: '100.00000000',
    feeUsd: '0.00',
    reasonCode: Reason.FILL_FILLED,
    reasonText: 'fixture',
    ...overrides,
  };
}

function manualSellPlan(overrides: Partial<SellFillPlan> = {}): SellFillPlan {
  return {
    status: 'filled',
    tokenId: 'token',
    intentId: 'intent-sell',
    requestedAmount: '1.00000000',
    filledAmount: '1.00000000',
    unfilledAmount: '0.00000000',
    priceUsd: '110.00000000',
    notionalUsd: '110.00',
    feeUsd: '0.28',
    proceedsUsd: '109.72',
    reasonCode: Reason.FILL_FILLED,
    reasonText: 'fixture',
    ...overrides,
  };
}

/** Buys 200 USD at 100.10 with a 0.50 fee. */
function boughtLedger(): PaperLedgerState {
  return applyBuyFill(createLedger('1000.00'), buyPlan(), makeIntent({ sizeUsd: '200' }), T1).state;
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    for (const key of Object.keys(value)) {
      deepFreeze((value as Record<string, unknown>)[key]);
    }
    Object.freeze(value);
  }
  return value;
}

describe('createLedger', () => {
  it('opens with the initial capital and an empty book', () => {
    const state = createLedger('1000.00');
    expect(state).toEqual({
      cashUsd: '1000.00',
      initialCapitalUsd: '1000.00',
      positions: {},
      entries: [],
      realizedPnlUsd: '0.00',
      feesPaidUsd: '0.00',
      closedTrades: [],
      openTrades: {},
    });
  });

  it('normalises the initial capital to cents', () => {
    expect(createLedger('1000').cashUsd).toBe('1000.00');
  });

  it('rejects an invalid initial capital', () => {
    expect(() => createLedger('not money')).toThrow(PaperLedgerError);
    expect(() => createLedger('-1')).toThrow(PaperLedgerError);
  });
});

describe('applyBuyFill', () => {
  it('books cost basis including the fee, cash, an open trade and one entry', () => {
    const plan = buyPlan();
    expect(plan).toMatchObject({
      status: 'filled',
      filledUsd: '200.00',
      feeUsd: '0.50',
      amount: '1.99800200',
      priceUsd: '100.10000000',
    });

    const result = applyBuyFill(createLedger('1000.00'), plan, makeIntent({ sizeUsd: '200' }), T1);
    const { state, entry, trade } = result;

    expect(state.cashUsd).toBe('799.50');
    expect(state.positions.token).toMatchObject({
      tokenId: 'token',
      strategyKey: 'trend_pullback',
      strategyVersion: 1,
      amount: '1.99800200',
      // (200.00 + 0.50) / 1.99800200, rounded once to 8 decimals.
      avgCostUsd: '100.35024990',
      openedAt: T1,
      stopLossPct: '3',
      takeProfitPct: null,
      entryIntentId: 'intent-1',
      feesPaidUsd: '0.50',
    });
    expect(state.realizedPnlUsd).toBe('0.00');
    expect(state.feesPaidUsd).toBe('0.50');
    expect(state.entries).toHaveLength(1);
    expect(state.closedTrades).toHaveLength(0);

    expect(trade).toMatchObject({
      tradeId: 'intent-1:trade',
      tokenId: 'token',
      entryAt: T1,
      entryPriceUsd: '100.10000000',
      entryAmount: '1.99800200',
      entryNotionalUsd: '200.00',
      entryFeeUsd: '0.50',
      entryIntentId: 'intent-1',
      exitAt: null,
      exitPriceUsd: null,
      exitAmount: '0.00000000',
      exitNotionalUsd: '0.00',
      exitFeeUsd: '0.00',
      exitReasonCode: null,
      exitIntentId: null,
      realizedPnlUsd: '0.00',
      status: 'open',
    });
    expect(state.openTrades.token).toEqual(trade);

    expect(entry).toMatchObject({
      entryId: 'intent-1:ledger',
      sequence: 1,
      clockTime: T1,
      tokenId: 'token',
      side: 'buy',
      intentId: 'intent-1',
      amount: '1.99800200',
      priceUsd: '100.10000000',
      notionalUsd: '200.00',
      feeUsd: '0.50',
      cashAfterUsd: '799.50',
      positionAmountAfter: '1.99800200',
      positionAvgCostAfter: '100.35024990',
      realizedPnlUsd: null,
      reasonCode: Reason.LEDGER_BUY,
    });
  });

  it('books the filled portion of a partial buy', () => {
    const plan = buyPlan({
      intent: makeIntent({ sizeUsd: '2000' }),
      cashUsd: '100000',
      equityUsd: '100000',
    });
    expect(plan).toMatchObject({
      status: 'partial',
      requestedUsd: '2000.00',
      filledUsd: '1000.00',
      amount: '9.99000999',
      feeUsd: '2.50',
    });

    const result = applyBuyFill(
      createLedger('100000.00'),
      plan,
      makeIntent({ sizeUsd: '2000' }),
      T1,
    );
    expect(result.state.cashUsd).toBe('98997.50');
    expect(result.state.positions.token).toMatchObject({
      amount: '9.99000999',
      avgCostUsd: '100.35025000',
      feesPaidUsd: '2.50',
    });
    expect(result.entry.notionalUsd).toBe('1000.00');
  });

  it('refuses a second position for the same token', () => {
    const state = boughtLedger();
    expect(() =>
      applyBuyFill(
        state,
        buyPlan({ intent: makeIntent({ intentId: 'intent-2', sizeUsd: '200' }) }),
        makeIntent({ intentId: 'intent-2', sizeUsd: '200' }),
        T2,
      ),
    ).toThrow(/already has an open position/);
  });

  it('throws a typed error for rejected, zero and mismatched plans', () => {
    const ledger = createLedger('1000.00');
    const rejected = buyPlan({ intent: makeIntent({ sizeUsd: '899' }) });
    expect(rejected.status).toBe('rejected');
    expect(() => applyBuyFill(ledger, rejected, makeIntent({ sizeUsd: '899' }), T1)).toThrow(
      PaperLedgerError,
    );

    const zero = manualBuyPlan({ filledUsd: '0.00', amount: '0.00000000', feeUsd: '0.00' });
    expect(() => applyBuyFill(ledger, zero, makeIntent(), T1)).toThrow(PaperLedgerError);

    const sellIntentPlan = manualBuyPlan();
    expect(() =>
      applyBuyFill(
        ledger,
        sellIntentPlan,
        makeIntent({ side: 'sell', amount: '1', sizeUsd: '0' }),
        T1,
      ),
    ).toThrow(PaperLedgerError);

    expect(() =>
      applyBuyFill(ledger, manualBuyPlan(), makeIntent({ intentId: 'other-intent' }), T1),
    ).toThrow(/does not match/);
  });

  it('refuses to book a buy that the ledger cash cannot cover', () => {
    const ledger = createLedger('100.00');
    const plan = manualBuyPlan({ filledUsd: '100.00', feeUsd: '0.50' });
    expect(() => applyBuyFill(ledger, plan, makeIntent({ intentId: 'intent-buy' }), T1)).toThrow(
      /exceeds/,
    );
  });

  it('does not mutate the input state', () => {
    const ledger = deepFreeze(createLedger('1000.00'));
    const before = JSON.stringify(ledger);
    const result = applyBuyFill(ledger, buyPlan(), makeIntent({ sizeUsd: '200' }), T1);
    expect(JSON.stringify(ledger)).toBe(before);
    expect(result.state).not.toBe(ledger);
  });
});

describe('applySellFill', () => {
  it('realizes P&L, removes the position and closes the trade', () => {
    const opened = boughtLedger();
    const plan = sellPlan(opened.positions.token!.amount, opened.positions.token!.amount);

    expect(plan).toMatchObject({
      status: 'filled',
      filledAmount: '1.99800200',
      priceUsd: '120.00000000',
      notionalUsd: '239.76',
      feeUsd: '0.60',
      proceedsUsd: '239.16',
    });

    const result = applySellFill(
      opened,
      plan,
      makeIntent({
        intentId: 'intent-sell',
        side: 'sell',
        amount: '1.99800200',
        sizeUsd: '0',
        reasonCode: Reason.TREND_PULLBACK_STOP,
      }),
      T2,
    );
    const { state, entry, trade } = result;

    // 239.16 proceeds - 200.50 cost basis = 38.66 realized.
    expect(state.realizedPnlUsd).toBe('38.66');
    expect(state.feesPaidUsd).toBe('1.10');
    expect(state.cashUsd).toBe('1038.66');
    expect(state.positions.token).toBeUndefined();
    expect(state.openTrades.token).toBeUndefined();
    expect(state.closedTrades).toHaveLength(1);

    expect(trade).toMatchObject({
      tradeId: 'intent-1:trade',
      status: 'closed',
      exitAt: T2,
      exitPriceUsd: '120.00000000',
      exitAmount: '1.99800200',
      exitNotionalUsd: '239.76',
      exitFeeUsd: '0.60',
      exitReasonCode: Reason.TREND_PULLBACK_STOP,
      exitIntentId: 'intent-sell',
      realizedPnlUsd: '38.66',
    });
    expect(state.closedTrades[0]).toEqual(trade);

    expect(entry).toMatchObject({
      entryId: 'intent-sell:ledger',
      sequence: 2,
      side: 'sell',
      amount: '1.99800200',
      notionalUsd: '239.76',
      feeUsd: '0.60',
      cashAfterUsd: '1038.66',
      positionAmountAfter: '0.00000000',
      positionAvgCostAfter: null,
      realizedPnlUsd: '38.66',
      reasonCode: Reason.LEDGER_SELL,
    });
  });

  it('keeps the position and trade open through a partial sell, then closes on the rest', () => {
    const opened = boughtLedger();
    const half = '0.99900100';
    const firstPlan = sellPlan(opened.positions.token!.amount, half);

    const first = applySellFill(
      opened,
      firstPlan,
      makeIntent({
        intentId: 'intent-sell',
        side: 'sell',
        amount: half,
        sizeUsd: '0',
        reasonCode: Reason.TREND_PULLBACK_STOP,
      }),
      T1,
    );

    expect(first.state.cashUsd).toBe('919.08');
    expect(first.state.realizedPnlUsd).toBe('19.33');
    expect(first.state.positions.token).toMatchObject({
      amount: '0.99900100',
      avgCostUsd: '100.35024990',
    });
    expect(first.state.openTrades.token).toMatchObject({
      status: 'open',
      exitAt: T1,
      exitAmount: '0.99900100',
      exitNotionalUsd: '119.88',
      exitFeeUsd: '0.30',
      exitPriceUsd: '120.00000000',
      realizedPnlUsd: '19.33',
      exitIntentId: 'intent-sell',
    });
    expect(first.state.closedTrades).toHaveLength(0);
    expect(first.entry.positionAmountAfter).toBe('0.99900100');
    expect(first.entry.positionAvgCostAfter).toBe('100.35024990');

    const rest = '0.99900100';
    const second = applySellFill(
      first.state,
      sellPlan('0.99900100', rest, {
        intent: makeIntent({
          intentId: 'intent-sell-2',
          side: 'sell',
          amount: rest,
          sizeUsd: '0',
          reasonCode: Reason.TREND_PULLBACK_STOP,
        }),
      }),
      makeIntent({
        intentId: 'intent-sell-2',
        side: 'sell',
        amount: rest,
        sizeUsd: '0',
        reasonCode: Reason.TREND_PULLBACK_STOP,
      }),
      T2,
    );

    expect(second.state.cashUsd).toBe('1038.66');
    expect(second.state.realizedPnlUsd).toBe('38.66');
    expect(second.state.positions.token).toBeUndefined();
    expect(second.state.openTrades.token).toBeUndefined();
    expect(second.state.closedTrades).toHaveLength(1);
    expect(second.state.closedTrades[0]).toMatchObject({
      status: 'closed',
      exitAt: T2,
      exitAmount: '1.99800200',
      exitNotionalUsd: '239.76',
      exitFeeUsd: '0.60',
      exitPriceUsd: '120.00000000',
      exitIntentId: 'intent-sell-2',
      realizedPnlUsd: '38.66',
    });
    expect(second.state.entries.map((entry) => entry.sequence)).toEqual([1, 2, 3]);
  });

  it('clamps a plan amount that overshoots the position by the 8-decimal rounding edge', () => {
    const opened = applyBuyFill(
      createLedger('1000.00'),
      manualBuyPlan(),
      makeIntent({ intentId: 'intent-buy', sizeUsd: '100' }),
      T1,
    );

    const plan = manualSellPlan({ filledAmount: '1.00000001' });
    const result = applySellFill(
      opened.state,
      plan,
      makeIntent({
        intentId: 'intent-sell',
        side: 'sell',
        amount: '1.00000001',
        sizeUsd: '0',
      }),
      T2,
    );

    expect(result.entry.amount).toBe('1.00000000');
    expect(result.entry.positionAmountAfter).toBe('0.00000000');
    expect(result.state.positions.token).toBeUndefined();
    expect(result.state.realizedPnlUsd).toBe('9.72');
    expect(result.state.closedTrades[0]).toMatchObject({
      status: 'closed',
      exitAmount: '1.00000000',
      realizedPnlUsd: '9.72',
    });
  });

  it('throws when there is no position, a rejected/zero plan or a mismatched intent', () => {
    const empty = createLedger('1000.00');
    expect(() =>
      applySellFill(
        empty,
        manualSellPlan(),
        makeIntent({ intentId: 'intent-sell', side: 'sell', amount: '1', sizeUsd: '0' }),
        T1,
      ),
    ).toThrow(/no open position/);

    const opened = boughtLedger();
    const rejected = planSellFill({
      intent: makeIntent({ intentId: 'intent-sell', side: 'sell', amount: '1', sizeUsd: '0' }),
      candle: makeCandle({ open: '120', close: '120' }),
      positionAmount: '0',
      settings: makeSettings({ slippageBps: 0 }),
    });
    expect(rejected.status).toBe('rejected');
    expect(() =>
      applySellFill(
        opened,
        rejected,
        makeIntent({ intentId: 'intent-sell', side: 'sell', amount: '1', sizeUsd: '0' }),
        T1,
      ),
    ).toThrow(PaperLedgerError);

    expect(() =>
      applySellFill(
        opened,
        manualSellPlan({ filledAmount: '0.00000000' }),
        makeIntent({ intentId: 'intent-sell', side: 'sell', amount: '1', sizeUsd: '0' }),
        T1,
      ),
    ).toThrow(PaperLedgerError);

    expect(() =>
      applySellFill(
        opened,
        manualSellPlan({ proceedsUsd: '110.00' }),
        makeIntent({ intentId: 'intent-sell', side: 'sell', amount: '1', sizeUsd: '0' }),
        T1,
      ),
    ).toThrow(/notionalUsd - feeUsd/);

    expect(() =>
      applySellFill(
        opened,
        manualSellPlan(),
        makeIntent({ intentId: 'different', side: 'sell', amount: '1', sizeUsd: '0' }),
        T1,
      ),
    ).toThrow(/does not match/);
  });

  it('books losing exits and keeps a negative realized balance across later sells', () => {
    const opened = applyBuyFill(
      createLedger('1000.00'),
      manualBuyPlan({ filledUsd: '200.00', amount: '2.00000000' }),
      makeIntent({ intentId: 'intent-buy', sizeUsd: '200' }),
      T1,
    );

    const first = applySellFill(
      opened.state,
      manualSellPlan({
        filledAmount: '1.00000000',
        priceUsd: '90.00000000',
        notionalUsd: '90.00',
        feeUsd: '0.00',
        proceedsUsd: '90.00',
      }),
      makeIntent({
        intentId: 'intent-sell',
        side: 'sell',
        amount: '1.00000000',
        sizeUsd: '0',
      }),
      T1,
    );
    expect(first.state.realizedPnlUsd).toBe('-10.00');
    expect(first.state.openTrades.token?.realizedPnlUsd).toBe('-10.00');
    expect(reconcileLedger(first.state, { token: '95' })).toEqual({
      ok: true,
      discrepancies: [],
    });

    const second = applySellFill(
      first.state,
      manualSellPlan({
        intentId: 'intent-sell-2',
        filledAmount: '1.00000000',
        priceUsd: '95.00000000',
        notionalUsd: '95.00',
        feeUsd: '0.00',
        proceedsUsd: '95.00',
      }),
      makeIntent({
        intentId: 'intent-sell-2',
        side: 'sell',
        amount: '1.00000000',
        sizeUsd: '0',
      }),
      T2,
    );

    expect(second.state.cashUsd).toBe('985.00');
    expect(second.state.realizedPnlUsd).toBe('-15.00');
    expect(second.state.closedTrades[0]).toMatchObject({
      status: 'closed',
      exitAmount: '2.00000000',
      exitNotionalUsd: '185.00',
      realizedPnlUsd: '-15.00',
    });
    expect(reconcileLedger(second.state, {})).toEqual({ ok: true, discrepancies: [] });
  });

  it('does not mutate the input state', () => {
    const opened = deepFreeze(boughtLedger());
    const before = JSON.stringify(opened);
    const plan = sellPlan('1.99800200', '0.99900100');
    const result = applySellFill(
      opened,
      plan,
      makeIntent({
        intentId: 'intent-sell',
        side: 'sell',
        amount: '0.99900100',
        sizeUsd: '0',
      }),
      T1,
    );
    expect(JSON.stringify(opened)).toBe(before);
    expect(result.state).not.toBe(opened);
  });
});

describe('markPortfolio', () => {
  it('marks positions, equity and unrealized P&L at 2 decimals', () => {
    const opened = boughtLedger();
    const marked = markPortfolio(opened, { token: '110' });

    expect(marked).toEqual({
      equityUsd: '1019.28',
      positionsValueUsd: '219.78',
      unrealizedPnlUsd: '19.28',
      positions: [
        {
          tokenId: 'token',
          strategyKey: 'trend_pullback',
          strategyVersion: 1,
          amount: '1.99800200',
          avgCostUsd: '100.35024990',
          marketPriceUsd: '110.00000000',
          marketValueUsd: '219.78',
          openedAt: T1,
          stopLossPct: '3',
          takeProfitPct: null,
        },
      ],
    });
  });

  it('sorts positions by token id and sums the book', () => {
    let state = applyBuyFill(
      createLedger('1000.00'),
      manualBuyPlan({ tokenId: 'token-b', intentId: 'intent-b' }),
      makeIntent({ tokenId: 'token-b', intentId: 'intent-b', sizeUsd: '100' }),
      T1,
    ).state;
    state = applyBuyFill(
      state,
      manualBuyPlan({ intentId: 'intent-a' }),
      makeIntent({ tokenId: 'token', intentId: 'intent-a', sizeUsd: '100' }),
      T1,
    ).state;

    const marked = markPortfolio(state, { 'token-b': '120', token: '90' });
    expect(marked.positions.map((position) => position.tokenId)).toEqual(['token', 'token-b']);
    expect(marked.positionsValueUsd).toBe('210.00');
    expect(marked.unrealizedPnlUsd).toBe('10.00');
    expect(marked.equityUsd).toBe('1010.00');
  });

  it('throws when a position has no mark or the mark is malformed', () => {
    const opened = boughtLedger();
    expect(() => markPortfolio(opened, {})).toThrow(/mark/i);
    expect(() => markPortfolio(opened, { token: 'not a price' })).toThrow(PaperLedgerError);
    expect(() => markPortfolio(opened, { token: '-1' })).toThrow(PaperLedgerError);
  });
});

describe('reconcileLedger', () => {
  it('accepts a clean open ledger', () => {
    const result = reconcileLedger(boughtLedger(), { token: '110' });
    expect(result).toEqual({ ok: true, discrepancies: [] });
  });

  it('accepts a clean ledger after a partial sell and after a full round trip', () => {
    const opened = boughtLedger();
    const partial = applySellFill(
      opened,
      sellPlan('1.99800200', '0.99900100'),
      makeIntent({
        intentId: 'intent-sell',
        side: 'sell',
        amount: '0.99900100',
        sizeUsd: '0',
      }),
      T1,
    ).state;
    expect(reconcileLedger(partial, { token: '110' })).toEqual({ ok: true, discrepancies: [] });

    const closed = applySellFill(
      partial,
      sellPlan('0.99900100', '0.99900100', {
        intent: makeIntent({
          intentId: 'intent-sell-2',
          side: 'sell',
          amount: '0.99900100',
          sizeUsd: '0',
        }),
      }),
      makeIntent({
        intentId: 'intent-sell-2',
        side: 'sell',
        amount: '0.99900100',
        sizeUsd: '0',
      }),
      T2,
    ).state;
    expect(reconcileLedger(closed, {})).toEqual({ ok: true, discrepancies: [] });
  });

  it('reports tampered cash', () => {
    const state: PaperLedgerState = { ...boughtLedger(), cashUsd: '900.00' };
    const result = reconcileLedger(state, { token: '110' });
    expect(result.ok).toBe(false);
    expect(result.discrepancies.join('\n')).toMatch(/cash/i);
  });

  it('reports a tampered position amount', () => {
    const opened = boughtLedger();
    const state: PaperLedgerState = {
      ...opened,
      positions: {
        token: { ...opened.positions.token!, amount: '2.00000000' },
      },
    };
    const result = reconcileLedger(state, { token: '110' });
    expect(result.ok).toBe(false);
    expect(result.discrepancies.join('\n')).toMatch(/token/);
  });

  it('reports tampered realized P&L and fees', () => {
    const closed = applySellFill(
      boughtLedger(),
      sellPlan('1.99800200', '1.99800200'),
      makeIntent({
        intentId: 'intent-sell',
        side: 'sell',
        amount: '1.99800200',
        sizeUsd: '0',
      }),
      T2,
    ).state;

    const badRealized = reconcileLedger({ ...closed, realizedPnlUsd: '99.99' }, {});
    expect(badRealized.ok).toBe(false);
    expect(badRealized.discrepancies.join('\n')).toMatch(/realized|realized/i);

    const badFees = reconcileLedger({ ...closed, feesPaidUsd: '9.99' }, {});
    expect(badFees.ok).toBe(false);
    expect(badFees.discrepancies.join('\n')).toMatch(/fee/i);
  });

  it('reports a tampered entry cash trail and sequence', () => {
    const opened = boughtLedger();
    const badCash: PaperLedgerState = {
      ...opened,
      entries: [{ ...opened.entries[0]!, cashAfterUsd: '1000.00' }],
    };
    const cashResult = reconcileLedger(badCash, { token: '110' });
    expect(cashResult.ok).toBe(false);
    expect(cashResult.discrepancies.join('\n')).toMatch(/cashAfter/i);

    const badSequence: PaperLedgerState = {
      ...opened,
      entries: [{ ...opened.entries[0]!, sequence: 2 }],
    };
    const sequenceResult = reconcileLedger(badSequence, { token: '110' });
    expect(sequenceResult.ok).toBe(false);
    expect(sequenceResult.discrepancies.join('\n')).toMatch(/sequence/i);
  });

  it('accepts repeated round trips on the same token', () => {
    const opened = applyBuyFill(
      createLedger('1000.00'),
      manualBuyPlan({ intentId: 'intent-b1' }),
      makeIntent({ intentId: 'intent-b1', sizeUsd: '100' }),
      T1,
    ).state;
    const sold = applySellFill(
      opened,
      manualSellPlan({ intentId: 'intent-s1' }),
      makeIntent({ intentId: 'intent-s1', side: 'sell', amount: '1', sizeUsd: '0' }),
      T1,
    ).state;
    const reentered = applyBuyFill(
      sold,
      manualBuyPlan({ intentId: 'intent-b2' }),
      makeIntent({ intentId: 'intent-b2', sizeUsd: '100' }),
      T2,
    ).state;
    const closed = applySellFill(
      reentered,
      manualSellPlan({ intentId: 'intent-s2' }),
      makeIntent({ intentId: 'intent-s2', side: 'sell', amount: '1', sizeUsd: '0' }),
      T2,
    ).state;

    expect(closed.closedTrades).toHaveLength(2);
    expect(closed.realizedPnlUsd).toBe('19.44');
    expect(closed.cashUsd).toBe('1019.44');
    expect(reconcileLedger(closed, {})).toEqual({ ok: true, discrepancies: [] });
  });

  it('reports a position without its open trade', () => {
    const opened = boughtLedger();
    const state: PaperLedgerState = { ...opened, openTrades: {} };
    const result = reconcileLedger(state, { token: '110' });
    expect(result.ok).toBe(false);
    expect(result.discrepancies.join('\n')).toMatch(/open trade/);
  });

  it('reports a missing mark instead of throwing', () => {
    const result = reconcileLedger(boughtLedger(), {});
    expect(result.ok).toBe(false);
    expect(result.discrepancies.join('\n')).toMatch(/mark/i);
  });

  it('reports a negative cash balance', () => {
    const state: PaperLedgerState = { ...boughtLedger(), cashUsd: '-1.00' };
    const result = reconcileLedger(state, { token: '110' });
    expect(result.ok).toBe(false);
    expect(result.discrepancies.join('\n')).toMatch(/negative/i);
  });
});

describe('determinism and formatting', () => {
  it('uses deterministic entry ids and a sequence that starts at 1', () => {
    let state = applyBuyFill(
      createLedger('1000.00'),
      manualBuyPlan({ tokenId: 'token-b', intentId: 'intent-b' }),
      makeIntent({ tokenId: 'token-b', intentId: 'intent-b', sizeUsd: '100' }),
      T1,
    ).state;
    state = applyBuyFill(
      state,
      manualBuyPlan({ intentId: 'intent-a' }),
      makeIntent({ tokenId: 'token', intentId: 'intent-a', sizeUsd: '100' }),
      T1,
    ).state;

    expect(state.entries.map((entry) => entry.sequence)).toEqual([1, 2]);
    expect(state.entries.map((entry) => entry.entryId)).toEqual([
      'intent-b:ledger',
      'intent-a:ledger',
    ]);
    expect(state.entries).toHaveLength(2);
  });

  it('never emits NaN or negative money strings', () => {
    const opened = boughtLedger();
    const partial = applySellFill(
      opened,
      sellPlan('1.99800200', '0.99900100'),
      makeIntent({
        intentId: 'intent-sell',
        side: 'sell',
        amount: '0.99900100',
        sizeUsd: '0',
      }),
      T1,
    );
    const marked = markPortfolio(partial.state, { token: '110' });

    const moneyStrings = [
      partial.state.cashUsd,
      partial.state.initialCapitalUsd,
      partial.state.realizedPnlUsd,
      partial.state.feesPaidUsd,
      marked.equityUsd,
      marked.positionsValueUsd,
      marked.unrealizedPnlUsd,
      ...partial.state.entries.flatMap((entry) => [
        entry.notionalUsd,
        entry.feeUsd,
        entry.cashAfterUsd,
        ...(entry.realizedPnlUsd === null ? [] : [entry.realizedPnlUsd]),
      ]),
    ];
    for (const value of moneyStrings) {
      expect(value).toMatch(USD);
      expect(new Decimal(value).isFinite()).toBe(true);
      expect(new Decimal(value).isNegative()).toBe(false);
    }
    for (const entry of partial.state.entries) {
      expect(entry.amount).toMatch(UNITS);
      expect(entry.priceUsd).toMatch(UNITS);
    }
  });
});

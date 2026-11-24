import { describe, expect, it } from 'vitest';
import { Reason } from '../decision/reason-codes';
import {
  PaperExecutionInputError,
  planBuyFill,
  planSellFill,
  type BuyFillInput,
  type SellFillInput,
} from './execution';
import { makeCandle, makeIntent, makeSettings } from './fixtures.test-helpers';

function buyInput(overrides: Partial<BuyFillInput> = {}): BuyFillInput {
  return {
    intent: makeIntent({ sizeUsd: '200' }),
    candle: makeCandle({ open: '100', close: '50' }),
    cashUsd: '1000',
    equityUsd: '1000',
    cashBufferPct: 10,
    settings: makeSettings(),
    hasPosition: false,
    ...overrides,
  };
}

function sellInput(overrides: Partial<SellFillInput> = {}): SellFillInput {
  return {
    intent: makeIntent({ side: 'sell', amount: '2', sizeUsd: '0' }),
    candle: makeCandle({ open: '90', close: '50' }),
    positionAmount: '2',
    settings: makeSettings(),
    ...overrides,
  };
}

describe('planBuyFill', () => {
  it('fills at the next bar open with slippage and an exact fee', () => {
    const plan = planBuyFill(buyInput());
    expect(plan).toMatchObject({
      status: 'filled',
      tokenId: 'token',
      intentId: 'intent-1',
      requestedUsd: '200.00',
      filledUsd: '200.00',
      unfilledUsd: '0.00',
      amount: '1.99800200',
      priceUsd: '100.10000000',
      feeUsd: '0.50',
      reasonCode: Reason.FILL_FILLED,
    });
    expect(plan.reasonText.length).toBeGreaterThan(0);
  });

  it('uses the candle open, never the decision close or decision price', () => {
    const plan = planBuyFill(
      buyInput({
        intent: makeIntent({ sizeUsd: '200', decisionPriceUsd: '500.00000000' }),
        candle: makeCandle({ open: '100', close: '500' }),
      }),
    );
    expect(plan.priceUsd).toBe('100.10000000');
  });

  it('caps the fill at the liquidity percentage of the bar volume', () => {
    const plan = planBuyFill(
      buyInput({
        intent: makeIntent({ sizeUsd: '2000' }),
        cashUsd: '100000',
        equityUsd: '100000',
      }),
    );
    expect(plan).toMatchObject({
      status: 'partial',
      requestedUsd: '2000.00',
      filledUsd: '1000.00',
      unfilledUsd: '1000.00',
      amount: '9.99000999',
      priceUsd: '100.10000000',
      feeUsd: '2.50',
      reasonCode: Reason.FILL_PARTIAL,
    });
  });

  it('rejects when the fill plus fee would break the cash floor', () => {
    const plan = planBuyFill(buyInput({ intent: makeIntent({ sizeUsd: '899' }) }));
    expect(plan).toMatchObject({
      status: 'rejected',
      requestedUsd: '899.00',
      filledUsd: '0.00',
      unfilledUsd: '899.00',
      amount: '0.00000000',
      priceUsd: '100.10000000',
      feeUsd: '0.00',
      reasonCode: Reason.FILL_INSUFFICIENT_CASH,
    });
  });

  it('applies the cash check after the liquidity cap', () => {
    // The capped notional (1000) plus its fee exceeds the 900 USD available.
    const plan = planBuyFill(buyInput({ intent: makeIntent({ sizeUsd: '2000' }) }));
    expect(plan.status).toBe('rejected');
    expect(plan.reasonCode).toBe(Reason.FILL_INSUFFICIENT_CASH);
    expect(plan.filledUsd).toBe('0.00');
    expect(plan.unfilledUsd).toBe('2000.00');
  });

  it('rejects a buy while a position is open', () => {
    const plan = planBuyFill(buyInput({ hasPosition: true }));
    expect(plan).toMatchObject({
      status: 'rejected',
      filledUsd: '0.00',
      amount: '0.00000000',
      reasonCode: Reason.FILL_POSITION_EXISTS,
    });
  });

  it('checks the existing position before the candle data', () => {
    const plan = planBuyFill(
      buyInput({ hasPosition: true, candle: makeCandle({ volumeUsd: '0' }) }),
    );
    expect(plan.reasonCode).toBe(Reason.FILL_POSITION_EXISTS);
  });

  it('rejects a buy on zero volume or zero open without throwing', () => {
    const zeroVolume = planBuyFill(buyInput({ candle: makeCandle({ volumeUsd: '0' }) }));
    expect(zeroVolume).toMatchObject({
      status: 'rejected',
      filledUsd: '0.00',
      amount: '0.00000000',
      reasonCode: Reason.FILL_NO_DATA,
    });

    const zeroOpen = planBuyFill(buyInput({ candle: makeCandle({ open: '0' }) }));
    expect(zeroOpen.reasonCode).toBe(Reason.FILL_NO_DATA);
  });

  it('rejects malformed money input instead of producing NaN', () => {
    const badSize = planBuyFill(buyInput({ intent: makeIntent({ sizeUsd: 'NaN' }) }));
    expect(badSize.status).toBe('rejected');
    expect(badSize.reasonCode).toBe(Reason.FILL_NO_DATA);
    expect(badSize.requestedUsd).toBe('0.00');
    expect(badSize.amount).toBe('0.00000000');

    const badCash = planBuyFill(buyInput({ cashUsd: '1e3' }));
    expect(badCash.reasonCode).toBe(Reason.FILL_NO_DATA);

    const badOpen = planBuyFill(buyInput({ candle: makeCandle({ open: '-1' }) }));
    expect(badOpen.reasonCode).toBe(Reason.FILL_NO_DATA);
  });

  it('rejects a fill whose amount rounds to zero', () => {
    const plan = planBuyFill(buyInput({ candle: makeCandle({ volumeUsd: '0.00000001' }) }));
    expect(plan).toMatchObject({
      status: 'rejected',
      filledUsd: '0.00',
      unfilledUsd: '200.00',
      amount: '0.00000000',
      reasonCode: Reason.FILL_LIQUIDITY,
    });
  });

  it('is deterministic for identical inputs', () => {
    expect(planBuyFill(buyInput())).toEqual(planBuyFill(buyInput()));
  });

  it('does not mutate its inputs', () => {
    const intent = Object.freeze(makeIntent({ sizeUsd: '200' }));
    const candle = Object.freeze(makeCandle({ open: '100', close: '50' }));
    const settings = Object.freeze(makeSettings());
    const snapshot = structuredClone({ intent, candle, settings });

    planBuyFill({
      intent,
      candle,
      cashUsd: '1000',
      equityUsd: '1000',
      cashBufferPct: 10,
      settings,
      hasPosition: false,
    });

    expect({ intent, candle, settings }).toEqual(snapshot);
  });
});

describe('planSellFill', () => {
  it('fills at the next bar open with slippage, fee and net proceeds', () => {
    const plan = planSellFill(sellInput());
    expect(plan).toMatchObject({
      status: 'filled',
      tokenId: 'token',
      intentId: 'intent-1',
      requestedAmount: '2.00000000',
      filledAmount: '2.00000000',
      unfilledAmount: '0.00000000',
      priceUsd: '89.91000000',
      notionalUsd: '179.82',
      feeUsd: '0.45',
      proceedsUsd: '179.37',
      reasonCode: Reason.FILL_FILLED,
    });
    expect(plan.reasonText.length).toBeGreaterThan(0);
  });

  it('uses the candle open, never the decision close', () => {
    const plan = planSellFill(
      sellInput({
        intent: makeIntent({ side: 'sell', amount: '2', decisionPriceUsd: '10.00000000' }),
        candle: makeCandle({ open: '90', close: '10' }),
      }),
    );
    expect(plan.priceUsd).toBe('89.91000000');
  });

  it('caps a sell at the bar liquidity and reports the unfilled amount', () => {
    const plan = planSellFill(
      sellInput({
        intent: makeIntent({ side: 'sell', amount: '20', sizeUsd: '0' }),
        positionAmount: '20',
      }),
    );
    expect(plan).toMatchObject({
      status: 'partial',
      requestedAmount: '20.00000000',
      filledAmount: '11.12223334',
      unfilledAmount: '8.87776666',
      priceUsd: '89.91000000',
      notionalUsd: '1000.00',
      feeUsd: '2.50',
      proceedsUsd: '997.50',
      reasonCode: Reason.FILL_PARTIAL,
    });
  });

  it('caps a sell at the open position', () => {
    const plan = planSellFill(
      sellInput({
        intent: makeIntent({ side: 'sell', amount: '2', sizeUsd: '0' }),
        positionAmount: '1',
      }),
    );
    expect(plan).toMatchObject({
      status: 'partial',
      requestedAmount: '2.00000000',
      filledAmount: '1.00000000',
      unfilledAmount: '1.00000000',
      notionalUsd: '89.91',
      feeUsd: '0.22',
      proceedsUsd: '89.69',
      reasonCode: Reason.FILL_PARTIAL,
    });
  });

  it('rejects a sell without a position', () => {
    const plan = planSellFill(sellInput({ positionAmount: '0' }));
    expect(plan).toMatchObject({
      status: 'rejected',
      requestedAmount: '2.00000000',
      filledAmount: '0.00000000',
      unfilledAmount: '2.00000000',
      notionalUsd: '0.00',
      feeUsd: '0.00',
      proceedsUsd: '0.00',
      reasonCode: Reason.FILL_NO_POSITION,
    });
  });

  it('rejects a sell without a position before the candle data', () => {
    const plan = planSellFill(
      sellInput({ positionAmount: '0.00000000', candle: makeCandle({ volumeUsd: '0' }) }),
    );
    expect(plan.reasonCode).toBe(Reason.FILL_NO_POSITION);
  });

  it('rejects a sell with a null or malformed amount', () => {
    const missing = planSellFill(
      sellInput({ intent: makeIntent({ side: 'sell', amount: null, sizeUsd: '0' }) }),
    );
    expect(missing).toMatchObject({
      status: 'rejected',
      requestedAmount: '0.00000000',
      filledAmount: '0.00000000',
      reasonCode: Reason.FILL_NO_DATA,
    });

    const malformed = planSellFill(
      sellInput({ intent: makeIntent({ side: 'sell', amount: '2,5', sizeUsd: '0' }) }),
    );
    expect(malformed.reasonCode).toBe(Reason.FILL_NO_DATA);
  });

  it('rejects a sell when the candle has no tradable data', () => {
    const zeroVolume = planSellFill(sellInput({ candle: makeCandle({ volumeUsd: '0' }) }));
    expect(zeroVolume).toMatchObject({
      status: 'rejected',
      filledAmount: '0.00000000',
      unfilledAmount: '2.00000000',
      reasonCode: Reason.FILL_NO_DATA,
    });

    const zeroOpen = planSellFill(sellInput({ candle: makeCandle({ open: '0' }) }));
    expect(zeroOpen.reasonCode).toBe(Reason.FILL_NO_DATA);
  });

  it('rejects a sell whose amount rounds to zero', () => {
    const plan = planSellFill(sellInput({ candle: makeCandle({ volumeUsd: '0.00000001' }) }));
    expect(plan).toMatchObject({
      status: 'rejected',
      filledAmount: '0.00000000',
      unfilledAmount: '2.00000000',
      notionalUsd: '0.00',
      reasonCode: Reason.FILL_LIQUIDITY,
    });
  });

  it('ignores the buy size when selling', () => {
    const plan = planSellFill(
      sellInput({ intent: makeIntent({ side: 'sell', amount: '1', sizeUsd: '999999' }) }),
    );
    expect(plan.filledAmount).toBe('1.00000000');
  });

  it('is deterministic for identical inputs', () => {
    expect(planSellFill(sellInput())).toEqual(planSellFill(sellInput()));
  });

  it('does not mutate its inputs', () => {
    const intent = Object.freeze(makeIntent({ side: 'sell', amount: '2', sizeUsd: '0' }));
    const candle = Object.freeze(makeCandle({ open: '90', close: '50' }));
    const settings = Object.freeze(makeSettings());
    const snapshot = structuredClone({ intent, candle, settings });

    planSellFill({ intent, candle, positionAmount: '2', settings });

    expect({ intent, candle, settings }).toEqual(snapshot);
  });
});

describe('programmer misuse', () => {
  it('throws when the intent side does not match the planner', () => {
    expect(() =>
      planBuyFill(buyInput({ intent: makeIntent({ side: 'sell', amount: '2' }) })),
    ).toThrow(PaperExecutionInputError);
    expect(() => planSellFill(sellInput({ intent: makeIntent({ side: 'buy' }) }))).toThrow(
      PaperExecutionInputError,
    );
  });

  it('throws when the candle belongs to another token', () => {
    expect(() => planBuyFill(buyInput({ candle: makeCandle({ tokenId: 'other' }) }))).toThrow(
      PaperExecutionInputError,
    );
    expect(() => planSellFill(sellInput({ candle: makeCandle({ tokenId: 'other' }) }))).toThrow(
      PaperExecutionInputError,
    );
  });

  it('throws on invalid execution settings', () => {
    const cases = [
      { feeBps: -1 },
      { feeBps: 10_000 },
      { slippageBps: Number.NaN },
      { slippageBps: 10_000 },
      { liquidityCapPct: 0 },
      { liquidityCapPct: 101 },
    ];
    for (const overrides of cases) {
      expect(() => planBuyFill(buyInput({ settings: makeSettings(overrides) }))).toThrow(
        PaperExecutionInputError,
      );
      expect(() => planSellFill(sellInput({ settings: makeSettings(overrides) }))).toThrow(
        PaperExecutionInputError,
      );
    }
  });

  it('throws on an invalid cash buffer percentage', () => {
    expect(() => planBuyFill(buyInput({ cashBufferPct: Number.POSITIVE_INFINITY }))).toThrow(
      PaperExecutionInputError,
    );
    expect(() => planBuyFill(buyInput({ cashBufferPct: -1 }))).toThrow(PaperExecutionInputError);
    expect(() => planBuyFill(buyInput({ cashBufferPct: 101 }))).toThrow(PaperExecutionInputError);
  });
});

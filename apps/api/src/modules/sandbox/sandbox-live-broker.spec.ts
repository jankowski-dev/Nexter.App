import Decimal from 'decimal.js';
import { describe, expect, it } from 'vitest';
import {
  createLedger,
  DEFAULT_PAPER_SETTINGS,
  Reason,
  type OrderIntent,
  type PaperLedgerState,
} from '@nexter/sandbox-core';
import {
  buildLiveFillCandle,
  duplicateIntentRecord,
  expiredIntentRecord,
  fillLiveBuy,
  fillLiveSell,
  pendingBars,
  pendingIntentToOrderIntent,
  SANDBOX_LIVE_EXECUTION_MODE,
  type SandboxLiveQuote,
} from './sandbox-live-broker';
import type { SandboxPendingIntent } from './sandbox.repository';

const TOKEN = 'bsc:0x1111111111111111111111111111111111111111';
const AT = Date.UTC(2026, 0, 1, 1);
const HOUR = 3_600_000;

function quote(overrides: Partial<SandboxLiveQuote> = {}): SandboxLiveQuote {
  return {
    tokenId: TOKEN,
    priceUsd: '100.00000000',
    volumeUsd: '100000.00000000',
    asOf: new Date(AT),
    ...overrides,
  };
}

function intent(overrides: Partial<OrderIntent> = {}): OrderIntent {
  return {
    intentId: 'intent-1',
    tokenId: TOKEN,
    side: 'buy',
    strategyKey: 'trend_pullback',
    strategyVersion: 1,
    reasonCode: Reason.TREND_PULLBACK_ENTRY,
    sizeUsd: '200.00',
    amount: null,
    stopLossPct: '3.00',
    takeProfitPct: null,
    decisionPriceUsd: '99.00000000',
    clockTime: AT,
    ...overrides,
  };
}

function pending(overrides: Partial<SandboxPendingIntent> = {}): SandboxPendingIntent {
  return {
    runId: 'run-1',
    intentId: 'intent-1',
    tokenId: TOKEN,
    side: 'buy',
    strategyKey: 'trend_pullback',
    strategyVersion: 1,
    requestedUsd: '200.00',
    requestedAmount: null,
    priceUsd: '99.00000000',
    strategyReasonCode: Reason.TREND_PULLBACK_ENTRY,
    reasonText: 'queued',
    decisionTime: new Date(AT),
    ...overrides,
  };
}

function withPosition(): PaperLedgerState {
  const result = fillLiveBuy({
    intent: intent(),
    quote: quote(),
    ledger: createLedger('1000.00'),
    equityUsd: '1000.00',
    cashBufferPct: 0,
    settings: DEFAULT_PAPER_SETTINGS,
    fillTime: AT,
  });
  if (!result.filled) throw new Error('fixture buy did not fill');

  return result.ledger;
}

describe('sandbox live broker', () => {
  it('labels execution live-paper', () => {
    expect(SANDBOX_LIVE_EXECUTION_MODE).toBe('live-paper');
  });

  it('fills a buy at the quote with 10 bps slippage, 25 bps fee and a 1% liquidity cap', () => {
    const outcome = fillLiveBuy({
      intent: intent(),
      quote: quote(),
      ledger: createLedger('1000.00'),
      equityUsd: '1000.00',
      cashBufferPct: 0,
      settings: DEFAULT_PAPER_SETTINGS,
      fillTime: AT + HOUR,
    });

    expect(outcome.filled).toBe(true);
    expect(outcome.record).toMatchObject({
      status: 'filled',
      requestedUsd: '200.00',
      filledUsd: '200.00',
      feeUsd: '0.50',
      priceUsd: '100.10000000',
      reasonCode: Reason.FILL_FILLED,
      strategyReasonCode: Reason.TREND_PULLBACK_ENTRY,
      fillTime: AT + HOUR,
    });
    expect(new Decimal(outcome.record.filledAmount).toFixed(4)).toBe('1.9980');
    expect(outcome.ledger.cashUsd).toBe('799.50');
    expect(outcome.ledger.entries).toHaveLength(1);
    expect(outcome.ledger.positions[TOKEN]?.stopLossPct).toBe('3.00');
  });

  it('caps a buy at 1% of the last closed bar volume and reports a partial fill', () => {
    const outcome = fillLiveBuy({
      intent: intent({ sizeUsd: '200.00' }),
      quote: quote({ volumeUsd: '10000.00000000' }),
      ledger: createLedger('1000.00'),
      equityUsd: '1000.00',
      cashBufferPct: 0,
      settings: DEFAULT_PAPER_SETTINGS,
      fillTime: AT,
    });

    expect(outcome.record.status).toBe('partial');
    expect(outcome.record.filledUsd).toBe('100.00');
    expect(outcome.record.feeUsd).toBe('0.25');
    expect(outcome.record.reasonCode).toBe(Reason.FILL_PARTIAL);
    expect(outcome.ledger.cashUsd).toBe('899.75');
  });

  it('rejects a buy without cash above the buffer and never touches the ledger', () => {
    const ledger = createLedger('1000.00');
    const outcome = fillLiveBuy({
      intent: intent(),
      quote: quote(),
      ledger,
      equityUsd: '1000.00',
      cashBufferPct: 100,
      settings: DEFAULT_PAPER_SETTINGS,
      fillTime: AT,
    });

    expect(outcome.filled).toBe(false);
    expect(outcome.record.status).toBe('rejected');
    expect(outcome.record.reasonCode).toBe(Reason.FILL_INSUFFICIENT_CASH);
    expect(outcome.ledger).toBe(ledger);
    expect(outcome.entry).toBeNull();
  });

  it('rejects a buy when the token already has a position', () => {
    const outcome = fillLiveBuy({
      intent: intent({ intentId: 'intent-2' }),
      quote: quote(),
      ledger: withPosition(),
      equityUsd: '1000.00',
      cashBufferPct: 0,
      settings: DEFAULT_PAPER_SETTINGS,
      fillTime: AT,
    });

    expect(outcome.record.status).toBe('rejected');
    expect(outcome.record.reasonCode).toBe(Reason.FILL_POSITION_EXISTS);
  });

  it('fills a sell at the quote and closes the position and trade', () => {
    const opened = withPosition();
    const position = opened.positions[TOKEN];
    if (position === undefined) throw new Error('fixture has no position');

    const outcome = fillLiveSell({
      intent: intent({
        intentId: 'intent-sell',
        side: 'sell',
        reasonCode: Reason.TREND_PULLBACK_TREND_BREAK,
        sizeUsd: '0.00',
        amount: position.amount,
      }),
      quote: quote({ priceUsd: '110.00000000' }),
      ledger: opened,
      settings: DEFAULT_PAPER_SETTINGS,
      fillTime: AT + HOUR,
    });

    expect(outcome.filled).toBe(true);
    expect(outcome.record.status).toBe('filled');
    expect(outcome.record.priceUsd).toBe('109.89000000');
    expect(outcome.record.strategyReasonCode).toBe(Reason.TREND_PULLBACK_TREND_BREAK);
    expect(outcome.ledger.positions[TOKEN]).toBeUndefined();
    expect(outcome.ledger.closedTrades).toHaveLength(1);
    expect(new Decimal(outcome.ledger.cashUsd).greaterThan('1000')).toBe(true);
  });

  it('rejects a sell with no open position', () => {
    const outcome = fillLiveSell({
      intent: intent({ side: 'sell', amount: '1.00000000', sizeUsd: '0.00' }),
      quote: quote(),
      ledger: createLedger('1000.00'),
      settings: DEFAULT_PAPER_SETTINGS,
      fillTime: AT,
    });

    expect(outcome.record.status).toBe('rejected');
    expect(outcome.record.reasonCode).toBe(Reason.FILL_NO_POSITION);
  });

  it('builds the synthetic fill candle from the quote, not the historical close', () => {
    const candle = buildLiveFillCandle(intent(), quote({ priceUsd: '123.45678901' }));

    expect(candle).toMatchObject({
      tokenId: TOKEN,
      open: '123.45678901',
      close: '123.45678901',
      high: '123.45678901',
      low: '123.45678901',
      volumeUsd: '100000.00000000',
    });
  });

  it('reconstructs a pending intent and computes its pending bars', () => {
    const reconstructed = pendingIntentToOrderIntent(pending());

    expect(reconstructed).toMatchObject({
      intentId: 'intent-1',
      tokenId: TOKEN,
      side: 'buy',
      reasonCode: Reason.TREND_PULLBACK_ENTRY,
      sizeUsd: '200.00',
      decisionPriceUsd: '99.00000000',
      clockTime: AT,
    });
    expect(pendingBars(AT, AT + HOUR)).toBe(1);
    expect(pendingBars(AT, AT + 5 * HOUR)).toBe(5);
  });

  it('builds expired and duplicate terminal records', () => {
    expect(expiredIntentRecord(intent(), AT + HOUR, 2)).toMatchObject({
      status: 'expired',
      reasonCode: Reason.FILL_EXPIRED,
      fillTime: AT + HOUR,
    });
    expect(duplicateIntentRecord(intent())).toMatchObject({
      status: 'rejected',
      reasonCode: Reason.FILL_DUPLICATE,
      fillTime: null,
    });
  });
});

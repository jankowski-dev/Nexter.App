import { describe, expect, it } from 'vitest';
import Decimal from 'decimal.js';
import { Reason } from '../decision/reason-codes';
import type { Candle, Timestamp } from '../types';
import { CounterfactualInputError, analyzeRejectedBuys } from './counterfactual';
import { makeCandle } from './fixtures.test-helpers';
import type { CounterfactualInput, CounterfactualRecord, RejectedBuy } from './types';

/**
 * Counterfactual tests pin the exact numbers, not just the direction, so a
 * rounding, timing or fee mistake fails loudly.
 *
 * Every expected value below was computed by hand from the documented formula:
 * $100 notional, buy at `open * (1 + slippage)`, fee on the notional, sell at
 * `close * (1 - slippage)`, fee on the sale notional, `return = (proceeds -
 * cost) / cost * 100` at two decimals.
 */

const HOUR = 3_600_000;
const T0 = Date.UTC(2026, 0, 1);

function bar(index: number, open: string, close: string, tokenId = 'token-a'): Candle {
  const openValue = new Decimal(open);
  const closeValue = new Decimal(close);
  return makeCandle({
    tokenId,
    openTime: T0 + index * HOUR,
    open,
    close,
    high: Decimal.max(openValue, closeValue).toString(),
    low: Decimal.min(openValue, closeValue).toString(),
    volumeUsd: '100000',
  });
}

function rejection(
  tokenId: string,
  decisionTime: Timestamp,
  reasonCode: RejectedBuy['reasonCode'] = Reason.FILL_POSITION_EXISTS,
): RejectedBuy {
  return { tokenId, decisionTime, reasonCode };
}

function baseInput(overrides: Partial<CounterfactualInput> = {}): CounterfactualInput {
  return {
    rejected: [],
    candles: [],
    horizonHours: 2,
    feeBps: 25,
    slippageBps: 10,
    ...overrides,
  };
}

/** Four 1h bars for `token-a`: the first opens the decision bar, the rest follow. */
function fourBars(): Candle[] {
  return [bar(0, '100', '100.5'), bar(1, '101', '110'), bar(2, '111', '120'), bar(3, '121', '125')];
}

describe('analyzeRejectedBuys', () => {
  it('classifies a profitable rejected buy as a missed opportunity with exact fill math', () => {
    const records = analyzeRejectedBuys(
      baseInput({
        rejected: [rejection('token-a', T0)],
        candles: fourBars(),
        horizonHours: 2,
        feeBps: 25,
        slippageBps: 10,
      }),
    );

    expect(records).toEqual<CounterfactualRecord[]>([
      {
        tokenId: 'token-a',
        decisionTime: T0,
        reasonCode: Reason.FILL_POSITION_EXISTS,
        entryAt: T0,
        // 100 * 1.001
        entryPriceUsd: '100.10000000',
        // The 1h bar that opened at T0+1h closes at T0+2h, exactly the horizon.
        exitAt: T0 + 2 * HOUR,
        // 110 * 0.999
        exitPriceUsd: '109.89000000',
        // cost    = 100 + 100 * 0.0025                 = 100.25
        // amount  = 100 / 100.1                        = 0.99900100
        // sale    = 0.99900100 * 109.89                = 109.78
        // sell fee= 109.78 * 0.0025                    = 0.27
        // proceeds= 109.78 - 0.27                      = 109.51
        // return  = (109.51 - 100.25) / 100.25 * 100   = 9.2369... -> 9.24
        returnPct: '9.24',
        outcome: 'missed_opportunity',
        hindsight: true,
        usedForDecisions: false,
      },
    ]);
  });

  it('classifies a losing rejected buy as a bad save', () => {
    const candles = [bar(0, '100', '100.5'), bar(1, '101', '80'), bar(2, '81', '79')];
    const [record] = analyzeRejectedBuys(
      baseInput({ rejected: [rejection('token-a', T0)], candles }),
    );

    expect(record?.entryPriceUsd).toBe('100.10000000');
    expect(record?.exitPriceUsd).toBe('79.92000000');
    // cost = 100.25, sale = 0.99900100 * 79.92 = 79.84, fee = 0.20,
    // proceeds = 79.64, return = (79.64 - 100.25) / 100.25 * 100 = -20.5586 -> -20.56
    expect(record?.returnPct).toBe('-20.56');
    expect(record?.outcome).toBe('bad_save');
  });

  it('returns a neutral outcome when the round trip breaks exactly even', () => {
    const candles = [bar(0, '100', '100'), bar(1, '100', '100'), bar(2, '100', '100')];
    const [record] = analyzeRejectedBuys(
      baseInput({
        rejected: [rejection('token-a', T0)],
        candles,
        feeBps: 0,
        slippageBps: 0,
      }),
    );

    expect(record?.entryPriceUsd).toBe('100.00000000');
    expect(record?.exitPriceUsd).toBe('100.00000000');
    expect(record?.returnPct).toBe('0.00');
    expect(record?.outcome).toBe('neutral');
  });

  it('treats a fee-covered break-even as neutral, never as a miss', () => {
    // With 25 bps fees and 10 bps slippage the exit close 100.7025 yields
    // sale 100.50, fee 0.25 and proceeds 100.25, exactly the 100.25 cost.
    const candles = [bar(0, '100', '100.5'), bar(1, '101', '100.7025'), bar(2, '101', '101')];
    const [record] = analyzeRejectedBuys(
      baseInput({ rejected: [rejection('token-a', T0)], candles }),
    );

    expect(record?.returnPct).toBe('0.00');
    expect(record?.outcome).toBe('neutral');
  });

  it('applies slippage exactly on a low-priced token instead of rounding it away', () => {
    // Entry open 0.00000100 and exit close 0.000001001 cancel out, so the exact
    // round trip loses only the 10 bps buy + 10 bps sell slippage: -0.10%.
    // Deriving the size from the 8-decimal entry price (1e-6) would book a flat
    // 0.00 and misclassify this as neutral.
    const candles = [
      bar(0, '0.00000100', '0.00000100'),
      bar(1, '0.00000100', '0.000001001'),
      bar(2, '0.000001001', '0.000001001'),
    ];
    const [record] = analyzeRejectedBuys(
      baseInput({
        rejected: [rejection('token-a', T0)],
        candles,
        horizonHours: 2,
        feeBps: 0,
        slippageBps: 10,
      }),
    );

    expect(record?.entryPriceUsd).toBe('0.00000100');
    expect(record?.exitPriceUsd).toBe('0.00000100');
    expect(record?.returnPct).toBe('-0.10');
    expect(record?.outcome).toBe('bad_save');
  });

  it('reports a missed opportunity on a low-priced token when the exact move beats costs', () => {
    // close/open = 1.01 up, times the slippage ratio 0.999/1.001 = +0.7982%.
    const candles = [
      bar(0, '0.00000100', '0.00000100'),
      bar(1, '0.00000100', '0.00000101'),
      bar(2, '0.00000101', '0.00000101'),
    ];
    const [record] = analyzeRejectedBuys(
      baseInput({
        rejected: [rejection('token-a', T0)],
        candles,
        horizonHours: 2,
        feeBps: 0,
        slippageBps: 10,
      }),
    );

    expect(record?.entryPriceUsd).toBe('0.00000100');
    expect(record?.exitPriceUsd).toBe('0.00000101');
    expect(record?.returnPct).toBe('0.80');
    expect(record?.outcome).toBe('missed_opportunity');
  });

  it('reports insufficient_data when a positive price rounds to zero at 8 decimals', () => {
    // 1e-9 * 1.001 is positive but displays as 0.00000000; dividing the $100
    // notional by it would emit a zero price and a NaN return.
    const candles = [
      bar(0, '0.000000001', '0.000000001'),
      bar(1, '0.000000001', '0.000000001'),
      bar(2, '0.000000001', '0.000000001'),
    ];
    const [record] = analyzeRejectedBuys(
      baseInput({ rejected: [rejection('token-a', T0)], candles, horizonHours: 2 }),
    );

    expect(record).toEqual<CounterfactualRecord>({
      tokenId: 'token-a',
      decisionTime: T0,
      reasonCode: Reason.FILL_POSITION_EXISTS,
      entryAt: null,
      entryPriceUsd: null,
      exitAt: null,
      exitPriceUsd: null,
      returnPct: null,
      outcome: 'insufficient_data',
      hindsight: true,
      usedForDecisions: false,
    });
    expect(JSON.stringify(record)).not.toMatch(/NaN|Infinity/);
  });

  it('enters on the bar whose open equals the decision time, not the next one', () => {
    // A decision at the close of T0-1h is stamped T0; the paper fill convention
    // uses the first bar with openTime >= decisionTime, i.e. the T0 bar itself.
    const candles = [
      bar(0, '50', '55'),
      bar(1, '200', '210'),
      bar(2, '210', '220'),
      bar(3, '220', '230'),
    ];
    const [record] = analyzeRejectedBuys(
      baseInput({
        rejected: [rejection('token-a', T0 + HOUR)],
        candles,
        horizonHours: 2,
        feeBps: 0,
        slippageBps: 0,
      }),
    );

    expect(record?.entryAt).toBe(T0 + HOUR);
    expect(record?.entryPriceUsd).toBe('200.00000000');
    expect(record?.exitAt).toBe(T0 + 3 * HOUR);
    expect(record?.exitPriceUsd).toBe('220.00000000');
    expect(record?.returnPct).toBe('10.00');
  });

  it('enters on the first bar opening after a decision that falls between bars', () => {
    const candles = [bar(0, '10', '10'), bar(1, '20', '20'), bar(2, '30', '40')];
    const [record] = analyzeRejectedBuys(
      baseInput({
        rejected: [rejection('token-a', T0 + HOUR / 2)],
        candles,
        horizonHours: 2,
        feeBps: 0,
        slippageBps: 0,
      }),
    );

    expect(record?.entryAt).toBe(T0 + HOUR);
    expect(record?.entryPriceUsd).toBe('20.00000000');
    expect(record?.exitAt).toBe(T0 + 3 * HOUR);
    expect(record?.exitPriceUsd).toBe('40.00000000');
    expect(record?.returnPct).toBe('100.00');
  });

  it('exits on the first close at or after the horizon instead of the next open', () => {
    // Horizon 1.5h from the T0 entry. The T0 bar closes at T0+1h (too early),
    // the T0+1h bar closes at T0+2h (first close >= T0+1.5h) and prices 130.
    const candles = [bar(0, '100', '105'), bar(1, '106', '130'), bar(2, '131', '140')];
    const [record] = analyzeRejectedBuys(
      baseInput({
        rejected: [rejection('token-a', T0)],
        candles,
        horizonHours: 1.5,
        feeBps: 0,
        slippageBps: 0,
      }),
    );

    expect(record?.exitAt).toBe(T0 + 2 * HOUR);
    expect(record?.exitPriceUsd).toBe('130.00000000');
    expect(record?.returnPct).toBe('30.00');
  });

  it('sorts candles before resolving entry and exit', () => {
    const candles = fourBars();
    const shuffled = [candles[3]!, candles[1]!, candles[0]!, candles[2]!] as Candle[];
    const [record] = analyzeRejectedBuys(
      baseInput({ rejected: [rejection('token-a', T0)], candles: shuffled }),
    );

    expect(record?.entryAt).toBe(T0);
    expect(record?.exitAt).toBe(T0 + 2 * HOUR);
  });

  it('reports insufficient_data when no bar opens at or after the decision', () => {
    const [record] = analyzeRejectedBuys(
      baseInput({
        rejected: [rejection('token-a', T0 + 10 * HOUR)],
        candles: fourBars(),
        horizonHours: 1,
      }),
    );

    expect(record).toEqual<CounterfactualRecord>({
      tokenId: 'token-a',
      decisionTime: T0 + 10 * HOUR,
      reasonCode: Reason.FILL_POSITION_EXISTS,
      entryAt: null,
      entryPriceUsd: null,
      exitAt: null,
      exitPriceUsd: null,
      returnPct: null,
      outcome: 'insufficient_data',
      hindsight: true,
      usedForDecisions: false,
    });
  });

  it('keeps the entry but reports insufficient_data when the horizon has no close', () => {
    const [record] = analyzeRejectedBuys(
      baseInput({
        rejected: [rejection('token-a', T0)],
        candles: fourBars(),
        horizonHours: 100,
      }),
    );

    expect(record?.entryAt).toBe(T0);
    expect(record?.entryPriceUsd).toBe('100.10000000');
    expect(record?.exitAt).toBeNull();
    expect(record?.exitPriceUsd).toBeNull();
    expect(record?.returnPct).toBeNull();
    expect(record?.outcome).toBe('insufficient_data');
  });

  it('treats a non-positive entry price as missing data', () => {
    const candles = [bar(0, '0', '100'), bar(1, '100', '110'), bar(2, '110', '120')];
    const [record] = analyzeRejectedBuys(
      baseInput({ rejected: [rejection('token-a', T0)], candles }),
    );

    expect(record?.entryAt).toBeNull();
    expect(record?.entryPriceUsd).toBeNull();
    expect(record?.outcome).toBe('insufficient_data');
  });

  it('uses only the candles of the rejected token', () => {
    const candles = [
      bar(0, '100', '110', 'token-a'),
      bar(1, '111', '120', 'token-a'),
      bar(2, '121', '130', 'token-a'),
      bar(0, '1', '1000', 'token-b'),
      bar(1, '1001', '2000', 'token-b'),
      bar(2, '2001', '3000', 'token-b'),
    ];
    const [recordA, recordB] = analyzeRejectedBuys(
      baseInput({
        rejected: [rejection('token-a', T0), rejection('token-b', T0, Reason.FILL_LIQUIDITY)],
        candles,
        horizonHours: 1,
        feeBps: 0,
        slippageBps: 0,
      }),
    );

    expect(recordA?.entryPriceUsd).toBe('100.00000000');
    expect(recordA?.exitPriceUsd).toBe('110.00000000');
    expect(recordA?.returnPct).toBe('10.00');
    expect(recordB?.entryPriceUsd).toBe('1.00000000');
    expect(recordB?.exitPriceUsd).toBe('1000.00000000');
  });

  it('deduplicates identical rejections and keeps distinct reason codes', () => {
    const duplicate = rejection('token-a', T0, Reason.FILL_LIQUIDITY);
    const records = analyzeRejectedBuys(
      baseInput({
        rejected: [
          rejection('token-a', T0, Reason.FILL_POSITION_EXISTS),
          duplicate,
          { ...duplicate },
          rejection('token-a', T0, Reason.FILL_INSUFFICIENT_CASH),
        ],
        candles: fourBars(),
        horizonHours: 1,
      }),
    );

    expect(records).toHaveLength(3);
    expect(records.map((record) => record.reasonCode)).toEqual([
      Reason.FILL_INSUFFICIENT_CASH,
      Reason.FILL_LIQUIDITY,
      Reason.FILL_POSITION_EXISTS,
    ]);
  });

  it('sorts by decision time, then token id, then reason code', () => {
    const candles = [
      bar(0, '100', '101', 'token-b'),
      bar(1, '101', '102', 'token-b'),
      bar(2, '102', '103', 'token-b'),
      bar(0, '10', '11', 'token-a'),
      bar(1, '11', '12', 'token-a'),
      bar(2, '12', '13', 'token-a'),
    ];
    const records = analyzeRejectedBuys(
      baseInput({
        rejected: [
          rejection('token-b', T0),
          rejection('token-a', T0 + HOUR),
          rejection('token-a', T0, Reason.FILL_POSITION_EXISTS),
          rejection('token-a', T0, Reason.FILL_LIQUIDITY),
          rejection('token-b', T0, Reason.FILL_NO_DATA),
        ],
        candles,
        horizonHours: 1,
      }),
    );

    expect(
      records.map((record) => [record.decisionTime, record.tokenId, record.reasonCode]),
    ).toEqual([
      [T0, 'token-a', Reason.FILL_LIQUIDITY],
      [T0, 'token-a', Reason.FILL_POSITION_EXISTS],
      [T0, 'token-b', Reason.FILL_NO_DATA],
      [T0, 'token-b', Reason.FILL_POSITION_EXISTS],
      [T0 + HOUR, 'token-a', Reason.FILL_POSITION_EXISTS],
    ]);
  });

  it('marks every record as hindsight-only, including insufficient-data rows', () => {
    const records = analyzeRejectedBuys(
      baseInput({
        rejected: [
          rejection('token-a', T0),
          rejection('token-a', T0 + 10 * HOUR),
          rejection('token-b', T0),
        ],
        candles: fourBars(),
      }),
    );

    expect(records).toHaveLength(3);
    for (const record of records) {
      expect(record.hindsight).toBe(true);
      expect(record.usedForDecisions).toBe(false);
    }
    expect(records.map((record) => record.outcome)).toContain('insufficient_data');
  });

  it('returns an empty list when nothing was rejected', () => {
    expect(analyzeRejectedBuys(baseInput({ candles: fourBars() }))).toEqual([]);
  });

  it('rejects an invalid horizon', () => {
    for (const horizonHours of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => analyzeRejectedBuys(baseInput({ candles: fourBars(), horizonHours }))).toThrow(
        CounterfactualInputError,
      );
    }
  });

  it('rejects invalid fee and slippage settings', () => {
    const invalidBps = [-1, 10_000, Number.NaN, Number.POSITIVE_INFINITY];
    for (const feeBps of invalidBps) {
      expect(() => analyzeRejectedBuys(baseInput({ candles: fourBars(), feeBps }))).toThrow(
        CounterfactualInputError,
      );
    }
    for (const slippageBps of invalidBps) {
      expect(() => analyzeRejectedBuys(baseInput({ candles: fourBars(), slippageBps }))).toThrow(
        CounterfactualInputError,
      );
    }
  });

  it('rejects malformed rejection rows', () => {
    expect(() =>
      analyzeRejectedBuys(baseInput({ rejected: [rejection('', T0)], candles: fourBars() })),
    ).toThrow(CounterfactualInputError);
    expect(() =>
      analyzeRejectedBuys(
        baseInput({
          rejected: [rejection('token-a', Number.NaN)],
          candles: fourBars(),
        }),
      ),
    ).toThrow(CounterfactualInputError);
    expect(() =>
      analyzeRejectedBuys(baseInput({ rejected: [rejection('   ', T0)], candles: fourBars() })),
    ).toThrow(CounterfactualInputError);
    expect(() =>
      analyzeRejectedBuys(
        baseInput({
          rejected: [null as unknown as RejectedBuy],
          candles: fourBars(),
        }),
      ),
    ).toThrow(CounterfactualInputError);
  });

  it('rejects a candle series that mixes timeframes for one token', () => {
    const candles = [
      bar(0, '1', '1'),
      makeCandle({
        tokenId: 'token-a',
        timeframe: '4h',
        openTime: T0 + HOUR,
        open: '1',
        close: '1',
      }),
    ];
    expect(() =>
      analyzeRejectedBuys(baseInput({ rejected: [rejection('token-a', T0)], candles })),
    ).toThrow(CounterfactualInputError);
  });
});

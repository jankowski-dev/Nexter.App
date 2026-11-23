import { describe, expect, it } from 'vitest';
import type { Candle } from '../types';
import { SimulationClock } from '../clock';
import { ClockedMarketView } from './market-view';
import { sortAndValidateCandles } from './candles';

function candle(openTime: number, close: string): Candle {
  return {
    tokenId: 'btc',
    timeframe: '1h',
    openTime,
    open: close,
    high: close,
    low: close,
    close,
    volumeUsd: '10',
  };
}

describe('ClockedMarketView', () => {
  it('exposes a candle only after its close, never at its open', () => {
    const candles = sortAndValidateCandles([
      candle(1_000, '100'),
      candle(3_601_000, '101'),
      candle(7_201_000, '102'),
    ]);
    const clock = new SimulationClock(1_000);
    const view = new ClockedMarketView(candles, clock, 'snapshot-1');
    expect(view.latest('btc', '1h')).toBeNull();
    expect(view.candles('btc', '1h')).toHaveLength(0);

    clock.advanceTo(3_601_000);
    expect(view.latest('btc', '1h')?.openTime).toBe(1_000);
    expect(view.candles('btc', '1h')).toHaveLength(1);

    clock.advanceTo(3_601_001);
    expect(view.latest('btc', '1h')?.openTime).toBe(1_000);
    expect(view.candles('btc', '1h')).toHaveLength(1);

    clock.advanceTo(7_201_000);
    expect(view.latest('btc', '1h')?.openTime).toBe(3_601_000);
    expect(view.candles('btc', '1h')).toHaveLength(2);
  });

  it('respects the limit and never returns future candles', () => {
    const candles = sortAndValidateCandles([
      candle(1_000, '100'),
      candle(3_601_000, '101'),
      candle(7_201_000, '102'),
    ]);
    const clock = new SimulationClock(10_801_000);
    const view = new ClockedMarketView(candles, clock, 'snapshot-1');
    const visible = view.candles('btc', '1h', 2);
    expect(visible.map((item) => item.openTime)).toEqual([3_601_000, 7_201_000]);
    expect(view.snapshotId()).toBe('snapshot-1');
  });
});

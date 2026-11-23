import { candleCloseTime } from '../timeframes';
import type { Candle, Clock, Timestamp } from '../types';
import { sortAndValidateCandles } from './candles';

export interface MarketView {
  now(): Timestamp;
  candles(tokenId: string, timeframe: string, limit?: number): Candle[];
  latest(tokenId: string, timeframe: string): Candle | null;
  snapshotId(): string;
}

function keyOf(tokenId: string, timeframe: string): string {
  return `${tokenId}|${timeframe}`;
}

function upperBound(candles: readonly Candle[], now: Timestamp): number {
  let low = 0;
  let high = candles.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (candleCloseTime(candles[middle] as Candle) <= now) low = middle + 1;
    else high = middle;
  }
  return low;
}

export class ClockedMarketView implements MarketView {
  private readonly byKey = new Map<string, Candle[]>();

  constructor(
    candles: readonly Candle[],
    private readonly clock: Clock,
    private readonly snapshotIdValue: string,
  ) {
    for (const candle of sortAndValidateCandles(candles)) {
      const key = keyOf(candle.tokenId, candle.timeframe);
      const list = this.byKey.get(key);
      if (list) list.push(candle);
      else this.byKey.set(key, [candle]);
    }
  }

  now(): Timestamp {
    return this.clock.now();
  }

  candles(tokenId: string, timeframe: string, limit?: number): Candle[] {
    const list = this.byKey.get(keyOf(tokenId, timeframe));
    if (!list) return [];
    const end = upperBound(list, this.clock.now());
    if (limit === undefined) return list.slice(0, end);
    if (limit <= 0) return [];
    return list.slice(Math.max(0, end - limit), end);
  }

  latest(tokenId: string, timeframe: string): Candle | null {
    const list = this.byKey.get(keyOf(tokenId, timeframe));
    if (!list) return null;
    const end = upperBound(list, this.clock.now());
    return end === 0 ? null : (list[end - 1] as Candle);
  }

  snapshotId(): string {
    return this.snapshotIdValue;
  }
}

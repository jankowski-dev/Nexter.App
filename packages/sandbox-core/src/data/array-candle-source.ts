import type { Candle } from '../types';
import { sortAndValidateCandles } from './candles';

export interface CandleSource {
  next(): Candle | null;
}

export class ArrayCandleSource implements CandleSource {
  readonly candles: readonly Candle[];
  private index = 0;

  constructor(candles: readonly Candle[]) {
    this.candles = sortAndValidateCandles(candles);
  }

  next(): Candle | null {
    const candle = this.candles[this.index];
    this.index += candle ? 1 : 0;
    return candle ?? null;
  }
}

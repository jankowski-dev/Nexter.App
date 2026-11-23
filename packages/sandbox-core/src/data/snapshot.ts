import { sha256Hex, stableStringify } from '../util/hash';
import type { Candle } from '../types';
import { sortAndValidateCandles } from './candles';

export interface CandleSnapshot {
  id: string;
  candles: Candle[];
}

export function snapshotCandles(candles: readonly Candle[]): CandleSnapshot {
  const sorted = sortAndValidateCandles(candles);
  return { id: sha256Hex(stableStringify(sorted)), candles: sorted };
}

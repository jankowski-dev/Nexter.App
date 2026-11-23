import { TIMEFRAME_MS } from '../timeframes';
import type { Candle } from '../types';

export class CandleValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CandleValidationError';
  }
}

const NON_NEGATIVE_DECIMAL = /^\d+(\.\d+)?$/;

function assertPrice(value: string, field: string): void {
  if (!NON_NEGATIVE_DECIMAL.test(value) || Number(value) <= 0) {
    throw new CandleValidationError(`${field} must be a positive decimal string`);
  }
}

function assertVolume(value: string): void {
  if (!NON_NEGATIVE_DECIMAL.test(value)) {
    throw new CandleValidationError('volumeUsd must be a non-negative decimal string');
  }
}

/**
 * Locale-independent string comparison by UTF-16 code unit.
 *
 * `String.prototype.localeCompare` honours the host ICU locale, so equal-time
 * candles for different tokens could be ordered differently across
 * environments, changing the snapshot id, config version and event hash.
 */
function compareCodeUnits(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

export function sortAndValidateCandles(candles: readonly Candle[]): Candle[] {
  const sorted = [...candles].sort(
    (left, right) =>
      left.openTime - right.openTime ||
      compareCodeUnits(left.tokenId, right.tokenId) ||
      compareCodeUnits(left.timeframe, right.timeframe),
  );
  const seen = new Set<string>();
  const frozen: Candle[] = [];
  for (const candle of sorted) {
    if (!candle.tokenId) throw new CandleValidationError('tokenId is required');
    if (!candle.timeframe) throw new CandleValidationError('timeframe is required');
    if (!Object.hasOwn(TIMEFRAME_MS, candle.timeframe)) {
      throw new CandleValidationError(`unknown timeframe: ${candle.timeframe}`);
    }
    if (!Number.isSafeInteger(candle.openTime)) {
      throw new CandleValidationError('openTime must be a safe integer timestamp');
    }
    for (const field of ['open', 'high', 'low', 'close'] as const) {
      assertPrice(candle[field], field);
    }
    assertVolume(candle.volumeUsd);
    const open = Number(candle.open);
    const high = Number(candle.high);
    const low = Number(candle.low);
    const close = Number(candle.close);
    if (![open, high, low, close].every(Number.isFinite)) {
      throw new CandleValidationError('OHLC values must be finite');
    }
    if (high < Math.max(open, close) || low > Math.min(open, close) || high < low) {
      throw new CandleValidationError('OHLC values are inconsistent');
    }
    const key = `${candle.tokenId}|${candle.timeframe}|${candle.openTime}`;
    if (seen.has(key)) throw new CandleValidationError(`duplicate candle: ${key}`);
    seen.add(key);
    // Freeze a copy so callers cannot rewrite validated history.
    frozen.push(Object.freeze({ ...candle }));
  }
  return Object.freeze(frozen) as Candle[];
}

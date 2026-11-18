import type { AiLabFeatures, AiLabRegime, AiTimeframe } from '@nexter/contracts';
import { decimal, priceString } from '../../shared/money/decimal';

export interface FeatureCandle {
  openTime: Date;
  open: string;
  high: string;
  low: string;
  close: string;
  volumeUsd: string | null;
  quality: string;
}

export const TIMEFRAME_MS: Record<AiTimeframe, number> = {
  '1d': 86_400_000,
  '4h': 14_400_000,
  '1h': 3_600_000,
  '15m': 900_000,
  '5m': 300_000,
};

function pct(value: number): string {
  return value.toFixed(2);
}

function price(value: number): string {
  return priceString(decimal(String(value)));
}

function sma(values: number[], period: number): number | null {
  if (values.length < period) return null;
  const slice = values.slice(-period);
  return slice.reduce((total, value) => total + value, 0) / period;
}

function changePct(closes: number[], periods: number): string | null {
  if (periods <= 0 || closes.length <= periods) return null;
  const last = closes[closes.length - 1] as number;
  const previous = closes[closes.length - 1 - periods] as number;
  if (previous <= 0) return null;
  return pct((last / previous - 1) * 100);
}

export function computeFeatures(candles: FeatureCandle[], timeframe: AiTimeframe): AiLabFeatures {
  const closes = candles.map((candle) => Number(candle.close));
  const last = closes[closes.length - 1] as number;
  const periodsPerDay = Math.max(1, Math.round(86_400_000 / TIMEFRAME_MS[timeframe]));

  const returns: number[] = [];
  const slice = closes.slice(-Math.min(closes.length, 61));
  for (let index = 1; index < slice.length; index += 1) {
    const previous = slice[index - 1] as number;
    if (previous > 0) returns.push((slice[index] as number) / previous - 1);
  }
  const mean =
    returns.length > 0 ? returns.reduce((sum, value) => sum + value, 0) / returns.length : 0;
  const variance =
    returns.length > 1
      ? returns.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (returns.length - 1)
      : 0;
  const volatility = Math.sqrt(variance) * 100;

  let peak = closes[0] ?? last;
  let maxDrawdown = 0;
  for (const close of closes) {
    peak = Math.max(peak, close);
    if (peak > 0) maxDrawdown = Math.max(maxDrawdown, ((peak - close) / peak) * 100);
  }

  const sma20 = sma(closes, 20);
  const sma50 = sma(closes, 50);
  const trend: AiLabFeatures['trend'] =
    sma20 !== null && sma50 !== null
      ? last > sma20 * 1.01 && sma20 > sma50
        ? 'up'
        : last < sma20 * 0.99 && sma20 < sma50
          ? 'down'
          : 'flat'
      : 'flat';

  const volumeSlice = candles.slice(-Math.min(candles.length, periodsPerDay));
  const volumes = volumeSlice
    .map((candle) => (candle.volumeUsd === null ? null : Number(candle.volumeUsd)))
    .filter((value): value is number => value !== null && Number.isFinite(value));
  const volume24h =
    volumes.length > 0 ? decimal(String(volumes.reduce((sum, value) => sum + value, 0))) : null;

  const lastCandle = candles[candles.length - 1] as FeatureCandle;
  const stale = Date.now() - lastCandle.openTime.getTime() > 2 * TIMEFRAME_MS[timeframe];

  return {
    candles: candles.length,
    lastPriceUsd: price(last),
    change24hPct: changePct(closes, periodsPerDay),
    return30Pct: changePct(closes, periodsPerDay * 30),
    return90Pct: changePct(closes, periodsPerDay * 90),
    volatilityPct: pct(volatility),
    maxDrawdownPct: pct(maxDrawdown),
    sma20Usd: sma20 !== null ? price(sma20) : null,
    sma50Usd: sma50 !== null ? price(sma50) : null,
    trend,
    volume24hUsd: volume24h !== null ? volume24h.toFixed(2) : null,
    stale,
  };
}

export function detectRegime(features: AiLabFeatures, timeframe: AiTimeframe): AiLabRegime {
  const periodsPerDay = Math.max(1, Math.round(86_400_000 / TIMEFRAME_MS[timeframe]));
  const dailyVolatility = Number(features.volatilityPct) * Math.sqrt(periodsPerDay);
  if (dailyVolatility >= 8) return 'high_volatility';
  if (features.trend === 'up') return 'trend_up';
  if (features.trend === 'down') return 'trend_down';
  return 'range';
}

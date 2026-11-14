export interface HistoricalCandle {
  date: string;
  openUsd: string;
  highUsd: string;
  lowUsd: string;
  closeUsd: string;
  volumeUsd: string | null;
  /** True when the source only provides sampled daily points, not true OHLC. */
  synthetic?: boolean;
}

export interface HistoricalSeries {
  source: string;
  candles: HistoricalCandle[];
}

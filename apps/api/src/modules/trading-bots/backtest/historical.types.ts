export interface HistoricalCandle {
  date: string;
  openUsd: string;
  highUsd: string;
  lowUsd: string;
  closeUsd: string;
  volumeUsd: string | null;
}

export interface HistoricalSeries {
  source: string;
  candles: HistoricalCandle[];
}

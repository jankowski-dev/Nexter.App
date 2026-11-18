export type MarketTimeframe = '1d' | '4h' | '1h' | '15m' | '5m';

export interface RawCandle {
  openTime: Date;
  open: string;
  high: string;
  low: string;
  close: string;
  volumeUsd: string | null;
  source: string;
  quality: 'ok' | 'synthetic';
}

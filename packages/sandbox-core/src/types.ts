export type Timestamp = number;

export interface Candle {
  tokenId: string;
  timeframe: string;
  openTime: Timestamp;
  open: string;
  high: string;
  low: string;
  close: string;
  volumeUsd: string;
}

export interface RunConfig {
  runId: string;
  seed: number;
  timeframe: string;
  tokenIds: string[];
  initialCapitalUsd: string;
  feeBps: number;
  slippageBps: number;
}

export interface Clock {
  now(): Timestamp;
  advanceTo(timestamp: Timestamp): void;
}

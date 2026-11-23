export type Timestamp = number;

export interface Candle {
  readonly tokenId: string;
  readonly timeframe: string;
  readonly openTime: Timestamp;
  readonly open: string;
  readonly high: string;
  readonly low: string;
  readonly close: string;
  readonly volumeUsd: string;
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

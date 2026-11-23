import type { Clock, Timestamp } from '../types';
import type { EventLog } from '../events/event-log';
import type { MarketView } from '../data/market-view';

export interface SandboxContext {
  runId: string;
  // Handlers may read simulated time but must never advance it.
  clock: Pick<Clock, 'now'>;
  market: MarketView;
  log: EventLog;
  configVersion: string;
  seed: number;
}

export interface ReplaySummary {
  candles: number;
  firstTime: Timestamp | null;
  lastTime: Timestamp | null;
  gaps: number;
  eventCount: number;
  eventHash: string;
}

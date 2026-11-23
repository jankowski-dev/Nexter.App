import type { Clock, Timestamp } from './types';

export class ClockBackwardsError extends Error {
  constructor(current: Timestamp, next: Timestamp) {
    super(`Clock cannot move backwards: current=${current}, next=${next}`);
    this.name = 'ClockBackwardsError';
  }
}

function assertTimestamp(value: Timestamp, label: string): void {
  if (!Number.isFinite(value) || !Number.isInteger(value)) {
    throw new Error(`${label} must be a finite integer timestamp`);
  }
}

export class SimulationClock implements Clock {
  private current: Timestamp;

  constructor(start: Timestamp) {
    assertTimestamp(start, 'start');
    this.current = start;
  }

  now(): Timestamp {
    return this.current;
  }

  advanceTo(timestamp: Timestamp): void {
    assertTimestamp(timestamp, 'timestamp');
    if (timestamp < this.current) {
      throw new ClockBackwardsError(this.current, timestamp);
    }
    this.current = timestamp;
  }
}

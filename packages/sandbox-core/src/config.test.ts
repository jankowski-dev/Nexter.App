import { describe, expect, it } from 'vitest';
import { configVersion } from './config';
import type { RunConfig } from './types';

const base: RunConfig = {
  runId: 'run-1',
  seed: 7,
  timeframe: '1h',
  tokenIds: ['btc', 'eth'],
  initialCapitalUsd: '1000',
  feeBps: 25,
  slippageBps: 10,
};

describe('configVersion', () => {
  it('is stable for the same settings', () => {
    expect(configVersion(base)).toBe(configVersion({ ...base }));
  });

  it('ignores runId but changes with settings', () => {
    expect(configVersion({ ...base, runId: 'run-2' })).toBe(configVersion(base));
    expect(configVersion({ ...base, initialCapitalUsd: '2000' })).not.toBe(configVersion(base));
    expect(configVersion({ ...base, tokenIds: ['btc'] })).not.toBe(configVersion(base));
  });
});

import { describe, expect, it } from 'vitest';
import { configVersion } from '../config';
import type { RunConfig } from '../types';
import { DEFAULT_PAPER_SETTINGS, PAPER_VERSION, paperConfigVersion } from './defaults';
import { makePaperConfig } from './fixtures.test-helpers';

describe('paper execution defaults', () => {
  it('pins the approved Stage 1C defaults exactly', () => {
    expect(DEFAULT_PAPER_SETTINGS).toEqual({
      feeBps: 25,
      slippageBps: 10,
      liquidityCapPct: 1,
      maxPendingBars: 1,
      cooldownHoursAfterStop: 24,
      counterfactualHorizonHours: 24,
    });
  });

  it('keeps every default positive and finite', () => {
    for (const [key, value] of Object.entries(DEFAULT_PAPER_SETTINGS)) {
      expect(Number.isFinite(value), `${key} must be finite`).toBe(true);
      expect(value, `${key} must be positive`).toBeGreaterThan(0);
    }
  });

  it('keeps basis points and the liquidity cap inside sane bounds', () => {
    expect(DEFAULT_PAPER_SETTINGS.feeBps).toBeLessThan(10_000);
    expect(DEFAULT_PAPER_SETTINGS.slippageBps).toBeLessThan(10_000);
    expect(DEFAULT_PAPER_SETTINGS.liquidityCapPct).toBeLessThanOrEqual(100);
  });

  it('pins the paper run version', () => {
    expect(PAPER_VERSION).toBe('paper-run-v1');
  });
});

describe('paperConfigVersion', () => {
  it('keeps every Stage 1A RunConfig field compatible', () => {
    const config = makePaperConfig();
    const runConfig: RunConfig = { ...config, tokenIds: [...config.tokenIds] };
    expect(runConfig.initialCapitalUsd).toBe(config.initialCapitalUsd);
    expect(runConfig.feeBps).toBe(config.feeBps);
    expect(runConfig.slippageBps).toBe(config.slippageBps);
  });

  it('matches the Stage 1A version over the full paper config', () => {
    const config = makePaperConfig();
    expect(paperConfigVersion(config)).toBe(
      configVersion({ ...config, tokenIds: [...config.tokenIds] }),
    );
    expect(paperConfigVersion(config)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('ignores the run id and changes with paper settings', () => {
    const config = makePaperConfig();
    const version = paperConfigVersion(config);
    expect(paperConfigVersion({ ...config, runId: 'run-2' })).toBe(version);
    expect(paperConfigVersion({ ...config, feeBps: 30 })).not.toBe(version);
    expect(paperConfigVersion({ ...config, liquidityCapPct: 2 })).not.toBe(version);
    expect(paperConfigVersion({ ...config, counterfactualHorizonHours: 48 })).not.toBe(version);
  });

  it('is deterministic across calls', () => {
    expect(paperConfigVersion(makePaperConfig())).toBe(paperConfigVersion(makePaperConfig()));
  });
});

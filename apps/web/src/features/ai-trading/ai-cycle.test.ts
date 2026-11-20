import { describe, expect, it } from 'vitest';
import { aiCycleRequestSchema, aiCycleStatusSchema, aiCycleStepKeys } from '@nexter/contracts';

describe('AI cycle contracts', () => {
  it('applies defaults and validates limits', () => {
    const parsed = aiCycleRequestSchema.parse({
      assetId: '11111111-1111-4111-8111-111111111111',
      variants: 5000,
    });
    expect(parsed.timeframe).toBe('1h');
    expect(parsed.horizonDays).toBe(5);
    expect(parsed.maxDrafts).toBe(3);
    expect(() =>
      aiCycleRequestSchema.parse({
        assetId: '11111111-1111-4111-8111-111111111111',
        variants: 5001,
      }),
    ).toThrow();
    expect(() =>
      aiCycleRequestSchema.parse({
        assetId: '11111111-1111-4111-8111-111111111111',
        maxDrafts: 11,
      }),
    ).toThrow();
  });

  it('accepts the four ordered steps and rejects unknown keys', () => {
    const status = aiCycleStatusSchema.parse({
      cycleId: '11111111-1111-4111-8111-111111111111',
      status: 'running',
      steps: aiCycleStepKeys.map((key) => ({
        key,
        status: 'queued',
        message: null,
        error: null,
        startedAt: null,
        finishedAt: null,
      })),
      searchRunId: null,
      recommended: 0,
      draftsCreated: 0,
      error: null,
      createdAt: '2026-11-21T00:00:00.000Z',
      finishedAt: null,
    });
    expect(status.steps.map((step) => step.key)).toEqual([
      'data',
      'search',
      'recommendations',
      'drafts',
    ]);
    expect(() =>
      aiCycleStatusSchema.parse({
        ...status,
        steps: [{ ...status.steps[0], key: 'unknown' }],
      }),
    ).toThrow();
  });
});

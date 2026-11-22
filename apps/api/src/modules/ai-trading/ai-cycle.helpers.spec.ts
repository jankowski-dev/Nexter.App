import { describe, expect, it } from 'vitest';
import {
  normalizeCycle,
  searchPollTimeout,
  SEARCH_HARD_TIMEOUT_MS,
  SEARCH_IDLE_TIMEOUT_MS,
} from './ai-cycle.helpers';

const run = {
  id: '11111111-1111-4111-8111-111111111111',
  status: 'failed',
  createdAt: new Date('2026-11-21T09:00:00.000Z'),
  finishedAt: new Date('2026-11-21T09:05:00.000Z'),
};

const assetId = '22222222-2222-4222-8222-222222222222';
const searchId = '33333333-3333-4333-8333-333333333333';

describe('normalizeCycle', () => {
  it('sanitizes legacy raw SQL and fills missing counters', () => {
    const cycle = normalizeCycle(run, {
      kind: 'cycle',
      assetId,
      timeframe: '1h',
      error: 'Failed query: select * from ai_profiles\nparams: 1',
      steps: [
        {
          key: 'data',
          status: 'succeeded',
          message: 'ok',
          error: null,
          startedAt: '2026-11-21T09:00:00.000Z',
          finishedAt: '2026-11-21T09:01:00.000Z',
        },
        {
          key: 'search',
          status: 'failed',
          message: 'bad',
          error: 'Failed query: select 1',
          startedAt: null,
          finishedAt: null,
        },
        null,
        { key: 'unknown', status: 'failed' },
      ],
    });

    expect(cycle.error).toContain('База данных временно недоступна');
    expect(cycle.steps).toHaveLength(2);
    expect(cycle.steps[1]?.error).toContain('База данных временно недоступна');
    expect(cycle.recommended).toBe(0);
    expect(cycle.draftsCreated).toBe(0);
    expect(cycle.searchRunId).toBeNull();
    expect(cycle.assetId).toBe(assetId);
    expect(cycle.timeframe).toBe('1h');
  });

  it('survives a null summary and invalid asset ids', () => {
    const cycle = normalizeCycle(run, null);
    expect(cycle.assetId).toBeNull();
    expect(cycle.timeframe).toBeNull();
    expect(cycle.steps).toEqual([]);
    expect(cycle.status).toBe('failed');

    const invalidAsset = normalizeCycle(run, { assetId: 'not-a-uuid', timeframe: '1h' });
    expect(invalidAsset.assetId).toBeNull();
  });

  it('keeps valid metrics and near misses', () => {
    const cycle = normalizeCycle(run, {
      kind: 'cycle',
      assetId,
      timeframe: '4h',
      searchRunId: searchId,
      recommended: 2,
      draftsCreated: 1,
      rejectionReasons: { 'too few trades': 7, broken: 'many' },
      nearMisses: [
        {
          strategyKey: 'grid_range',
          strategyName: 'Сетка',
          params: {},
          oosMedianReturnPct: '1.50',
          oosMeanReturnPct: '0.80',
          oosWorstReturnPct: '-2.00',
          maxDrawdownPct: '9.00',
          trades: 12,
          positiveFolds: 5,
          stabilityPct: '62.50',
          holdoutReturnPct: null,
          policyScore: '0.5000',
          reasons: ['negative holdout'],
        },
      ],
    });

    expect(cycle.searchRunId).toBe(searchId);
    expect(cycle.recommended).toBe(2);
    expect(cycle.draftsCreated).toBe(1);
    expect(cycle.rejectionReasons).toEqual({ 'too few trades': 7 });
    expect(cycle.nearMisses).toHaveLength(1);
    expect(cycle.nearMisses[0]?.strategyKey).toBe('grid_range');
  });

  it('keeps a valid search stage and clears unknown stages', () => {
    const cycle = normalizeCycle(run, {
      kind: 'cycle',
      assetId,
      timeframe: '1h',
      steps: [
        {
          key: 'search',
          status: 'running',
          message: 'Проба: 5 / 10',
          error: null,
          stage: 'probe',
          startedAt: '2026-11-21T09:00:00.000Z',
          finishedAt: null,
        },
        {
          key: 'data',
          status: 'succeeded',
          message: 'ok',
          error: null,
          stage: 'unknown-stage',
          startedAt: '2026-11-21T09:00:00.000Z',
          finishedAt: '2026-11-21T09:01:00.000Z',
        },
      ],
    });

    expect(cycle.steps.find((step) => step.key === 'search')?.stage).toBe('probe');
    expect(cycle.steps.find((step) => step.key === 'data')?.stage).toBeNull();
  });
});

describe('searchPollTimeout', () => {
  const now = Date.parse('2026-11-21T17:40:00.000Z');
  const deadline = now + SEARCH_HARD_TIMEOUT_MS;

  it('keeps polling while progress is fresh', () => {
    expect(searchPollTimeout(now, now - 60_000, deadline)).toBeNull();
  });

  it('stops after the idle window without progress', () => {
    expect(searchPollTimeout(now, now - SEARCH_IDLE_TIMEOUT_MS - 1, deadline)).toBe('idle');
  });

  it('stops at the hard deadline even with recent progress', () => {
    expect(searchPollTimeout(deadline, now, deadline)).toBe('hard');
  });

  it('prefers the hard deadline when both apply', () => {
    expect(searchPollTimeout(deadline, deadline - SEARCH_IDLE_TIMEOUT_MS - 1, deadline)).toBe(
      'hard',
    );
  });
});

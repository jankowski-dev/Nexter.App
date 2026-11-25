import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  archiveSandboxRun,
  createSandboxRun,
  createSandboxToken,
  fetchSandboxRuns,
  fetchSandboxStatus,
  fetchSandboxTokenCandidates,
  fetchSandboxTokens,
  pauseSandboxRun,
  refreshSandboxToken,
  resumeSandboxRun,
  runSandboxLifecycle,
  sandboxQueryKeys,
  startSandboxRun,
  stopSandboxRun,
  updateSandboxRun,
  updateSandboxToken,
} from './sandbox-api';
import { invalidateSandboxQueries, invalidateSandboxUniverseQueries } from './sandbox-hooks';
import { sandboxRunFormDefaults } from './sandbox-run-form';
import { QueryClient } from '@tanstack/react-query';
import type { SandboxRun, SandboxRunSummary, SandboxToken } from '@nexter/contracts';

const runId = '11111111-1111-4111-8111-111111111111';
const tokenKey = 'bsc:0x1111111111111111111111111111111111111111';
const createdAt = '2026-11-24T00:00:00.000Z';

const summary: SandboxRunSummary = {
  id: runId,
  name: 'Базовый 1h',
  status: 'draft',
  initialCapitalUsd: '1000.00',
  cashUsd: '1000.00',
  equityUsd: '1000.00',
  peakEquityUsd: '1000.00',
  returnPct: '0.00',
  drawdownPct: '0.0000',
  tokenCount: 1,
  lastBarClose: null,
  lastTickAt: null,
  startedAt: null,
  stoppedAt: null,
  archivedAt: null,
  error: null,
  createdAt,
  updatedAt: createdAt,
};

const run: SandboxRun = {
  id: runId,
  name: 'Базовый 1h',
  status: 'draft',
  initialCapitalUsd: '1000.00',
  cashUsd: '1000.00',
  equityUsd: '1000.00',
  peakEquityUsd: '1000.00',
  dayStartEquityUsd: '1000.00',
  tokenKeys: [tokenKey],
  tokens: [
    {
      tokenKey,
      symbol: 'AAA',
      chain: 'bsc',
      contractAddress: '0x1111111111111111111111111111111111111111',
      enabled: true,
    },
  ],
  settings: {
    timeframe: '1h',
    maxPositions: 5,
    maxTokenExposurePct: 20,
    maxStrategyExposurePct: 40,
    cashBufferPct: 10,
    dailyLossLimitPct: 2,
    maxDrawdownPct: 15,
    perTradeRiskPct: 1,
    minOrderUsd: '10',
    liquidityCapPct: 1,
    defaultStopPct: 3,
    regime: {
      fastHours: 24,
      slowHours: 168,
      longHours: 720,
      atrPeriod: 14,
      rangeWindowHours: 72,
      liquidityWindowHours: 24,
      trendSpreadPct: 0.5,
      trendMaxAtrPct: 8,
      rangeSpreadPct: 0.75,
      rangeMaxAtrPct: 3.5,
      crashDrawdownPct: 12,
      crashAtrPct: 10,
      recoveryConfirmBars: 3,
      regimeDwellBars: 3,
      minLiquidityUsd: '50000',
    },
    strategies: {
      trendPullback: {
        fastPeriod: 24,
        slowPeriod: 168,
        pullbackPct: 2,
        atrStopMult: 2.5,
        trailActivationPct: 5,
        trailPct: 5,
      },
      rangeReversion: { lookback: 72, bandAtrMult: 1.5, stopAtrMult: 2 },
      recovery: { fastPeriod: 24, confirmBars: 3, stopPct: 3, riskWeight: 0.5 },
    },
  },
  paper: {
    feeBps: 25,
    slippageBps: 10,
    liquidityCapPct: 1,
    maxPendingBars: 1,
    cooldownHoursAfterStop: 24,
    counterfactualHorizonHours: 24,
  },
  lastBarClose: null,
  lastTickAt: null,
  error: null,
  createdAt,
  updatedAt: createdAt,
  startedAt: null,
  pausedAt: null,
  stoppedAt: null,
  archivedAt: null,
};

const token: SandboxToken = {
  id: '22222222-2222-4222-8222-222222222222',
  tokenKey,
  symbol: 'AAA',
  name: 'Alpha',
  chain: 'bsc',
  contractAddress: '0x1111111111111111111111111111111111111111',
  coingeckoId: null,
  enabled: true,
  createdAt,
  updatedAt: createdAt,
};

interface FetchCall {
  url: string;
  init: RequestInit;
}

const calls: FetchCall[] = [];
let payload: unknown = {};

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

beforeEach(() => {
  calls.length = 0;
  payload = {};
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return jsonResponse(payload);
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('sandbox api', () => {
  it('reads the feature status', async () => {
    payload = { enabled: true, version: 'sandbox-stage-2' };
    await expect(fetchSandboxStatus()).resolves.toEqual({
      enabled: true,
      version: 'sandbox-stage-2',
    });
    expect(calls[0]?.url).toBe('/api/v1/sandbox/status');
    expect(calls[0]?.init.method).toBe('GET');
  });

  it('lists runs with the archive flag', async () => {
    payload = { runs: [summary], total: 1, limit: 100, offset: 0 };
    const response = await fetchSandboxRuns(true);
    expect(response.runs).toHaveLength(1);
    expect(calls[0]?.url).toBe('/api/v1/sandbox/runs?includeArchived=true&limit=100');
  });

  it('reads the token universe', async () => {
    payload = { tokens: [] };
    await expect(fetchSandboxTokens()).resolves.toEqual({ tokens: [] });
    expect(calls[0]?.url).toBe('/api/v1/sandbox/tokens');
  });

  it('reads the favorites candidates for new tokens', async () => {
    payload = {
      candidates: [
        {
          assetId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          tokenKey,
          symbol: 'AAA',
          name: 'Alpha',
          chain: 'bsc',
          contractAddress: tokenKey.slice(4),
          eligible: true,
          reason: null,
        },
      ],
    };
    const response = await fetchSandboxTokenCandidates();
    expect(response.candidates[0]?.tokenKey).toBe(tokenKey);
    expect(calls[0]?.url).toBe('/api/v1/sandbox/tokens/candidates');
  });

  it('adds a token to the universe', async () => {
    payload = token;
    const created = await createSandboxToken({
      tokenKey,
      symbol: 'AAA',
      name: 'Alpha',
      enabled: true,
    });
    expect(created.id).toBe(token.id);
    expect(calls[0]?.url).toBe('/api/v1/sandbox/tokens');
    expect(calls[0]?.init.method).toBe('POST');
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual({
      tokenKey,
      symbol: 'AAA',
      name: 'Alpha',
      enabled: true,
    });
  });

  it('enables or disables a token with PATCH', async () => {
    payload = { ...token, enabled: false };
    const updated = await updateSandboxToken(token.id, { enabled: false });
    expect(updated.enabled).toBe(false);
    expect(calls[0]?.url).toBe(`/api/v1/sandbox/tokens/${token.id}`);
    expect(calls[0]?.init.method).toBe('PATCH');
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual({ enabled: false });
  });

  it('refreshes token history', async () => {
    payload = {
      token,
      coverage: {
        tokenKey,
        timeframe: '1h',
        available: 4320,
        required: 4320,
        firstOpenTime: createdAt,
        lastOpenTime: createdAt,
        gaps: 0,
        synthetic: false,
        stale: false,
        status: 'ok',
        warning: null,
      },
      fetched: 4320,
    };
    const refreshed = await refreshSandboxToken(token.id);
    expect(refreshed.fetched).toBe(4320);
    expect(calls[0]?.url).toBe(`/api/v1/sandbox/tokens/${token.id}/refresh`);
    expect(calls[0]?.init.method).toBe('POST');
  });

  it('creates a draft with the decimal payload', async () => {
    payload = run;
    const body = {
      ...sandboxRunFormDefaults(),
      name: 'Базовый 1h',
      tokenKeys: [tokenKey],
    };
    const created = await createSandboxRun({
      name: body.name,
      initialCapitalUsd: '1000.00',
      tokenKeys: body.tokenKeys,
    });
    expect(created.id).toBe(runId);
    expect(calls[0]?.url).toBe('/api/v1/sandbox/runs');
    expect(calls[0]?.init.method).toBe('POST');
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual({
      name: 'Базовый 1h',
      initialCapitalUsd: '1000.00',
      tokenKeys: [tokenKey],
    });
  });

  it('patches a draft', async () => {
    payload = run;
    await updateSandboxRun(runId, { name: 'Новый' });
    expect(calls[0]?.url).toBe(`/api/v1/sandbox/runs/${runId}`);
    expect(calls[0]?.init.method).toBe('PATCH');
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual({ name: 'Новый' });
  });

  it.each([
    ['start', startSandboxRun, `/api/v1/sandbox/runs/${runId}/start`],
    ['pause', pauseSandboxRun, `/api/v1/sandbox/runs/${runId}/pause`],
    ['resume', resumeSandboxRun, `/api/v1/sandbox/runs/${runId}/resume`],
    ['stop', stopSandboxRun, `/api/v1/sandbox/runs/${runId}/stop`],
    ['archive', archiveSandboxRun, `/api/v1/sandbox/runs/${runId}/archive`],
  ] as const)('posts the %s control', async (_action, call, path) => {
    payload = run;
    await call(runId);
    expect(calls[0]?.url).toBe(path);
    expect(calls[0]?.init.method).toBe('POST');
  });

  it('sends allowPartial only when the owner confirms reduced confidence', async () => {
    payload = run;
    await runSandboxLifecycle(runId, 'start', { allowPartial: true });
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual({ allowPartial: true });

    calls.length = 0;
    await runSandboxLifecycle(runId, 'start');
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual({});
  });
});

describe('sandbox cache invalidation', () => {
  it('invalidates every sandbox query after a mutation', async () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(sandboxQueryKeys.runs(false), { runs: [] });
    queryClient.setQueryData(sandboxQueryKeys.run(runId), run);
    queryClient.setQueryData(['portfolio-token-summaries'], { data: [] });

    await invalidateSandboxQueries(queryClient);

    expect(queryClient.getQueryState(sandboxQueryKeys.runs(false))?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(sandboxQueryKeys.run(runId))?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(['portfolio-token-summaries'])?.isInvalidated).toBeFalsy();
  });

  it('invalidates tokens and coverage after a universe mutation', async () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(sandboxQueryKeys.tokens, { tokens: [] });
    queryClient.setQueryData(sandboxQueryKeys.coverage, { tokens: [] });
    queryClient.setQueryData(sandboxQueryKeys.runs(false), { runs: [] });

    await invalidateSandboxUniverseQueries(queryClient);

    expect(queryClient.getQueryState(sandboxQueryKeys.tokens)?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(sandboxQueryKeys.coverage)?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(sandboxQueryKeys.runs(false))?.isInvalidated).toBeFalsy();
  });
});

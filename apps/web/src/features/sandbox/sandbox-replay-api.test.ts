import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api';
import {
  archiveSandboxReplay,
  cancelSandboxReplay,
  createSandboxReplay,
  downloadSandboxReplayReport,
  fetchSandboxReplay,
  fetchSandboxReplayChart,
  fetchSandboxReplayDecisions,
  fetchSandboxReplayReport,
  fetchSandboxReplays,
  preflightSandboxReplay,
  sandboxQueryKeys,
} from './sandbox-api';
import {
  SANDBOX_REPLAY_POLL_MS,
  invalidateSandboxReplayQueries,
  invalidateSandboxUniverseQueries,
  sandboxReplayListRefetchInterval,
  sandboxReplayRefetchInterval,
} from './sandbox-hooks';
import { QueryClient } from '@tanstack/react-query';
import {
  sandboxReplayDetailFixture,
  sandboxReplayId,
  sandboxReplayPreflightFixture,
  sandboxReplayReportResponseFixture,
  sandboxTokenId,
} from './sandbox-test-fixtures';

interface FetchCall {
  url: string;
  init: RequestInit;
}

const calls: FetchCall[] = [];
let nextResponse: () => Response;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

beforeEach(() => {
  calls.length = 0;
  nextResponse = () => jsonResponse({});
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return nextResponse();
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('sandbox replay api', () => {
  it('posts the preflight request', async () => {
    nextResponse = () => jsonResponse(sandboxReplayPreflightFixture());
    const preflight = await preflightSandboxReplay({
      tokenKeys: [sandboxTokenId],
      periodDays: 180,
      allowPartial: true,
    });

    expect(preflight.status).toBe('ok');
    expect(calls[0]?.url).toBe('/api/v1/sandbox/replays/preflight');
    expect(calls[0]?.init.method).toBe('POST');
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual({
      tokenKeys: [sandboxTokenId],
      periodDays: 180,
      allowPartial: true,
    });
  });

  it('creates a replay and parses the detail response', async () => {
    nextResponse = () => jsonResponse(sandboxReplayDetailFixture());
    const detail = await createSandboxReplay({
      name: 'Прогон',
      tokenKeys: [sandboxTokenId],
      periodDays: 90,
      initialCapitalUsd: '1000.00',
      allowPartial: true,
    });

    expect(detail.id).toBe(sandboxReplayId);
    expect(calls[0]?.url).toBe('/api/v1/sandbox/replays');
    expect(calls[0]?.init.method).toBe('POST');
    expect(JSON.parse(String(calls[0]?.init.body))).toMatchObject({
      periodDays: 90,
      allowPartial: true,
    });
  });

  it('lists replays with a status filter and pagination', async () => {
    nextResponse = () => jsonResponse({ replays: [], total: 0, limit: 50, offset: 0 });
    await fetchSandboxReplays({
      status: 'completed',
      includeArchived: false,
      limit: 20,
      offset: 40,
    });
    expect(calls[0]?.url).toBe(
      '/api/v1/sandbox/replays?status=completed&includeArchived=false&limit=20&offset=40',
    );

    calls.length = 0;
    await fetchSandboxReplays();
    expect(calls[0]?.url).toBe('/api/v1/sandbox/replays?includeArchived=false&limit=50&offset=0');
  });

  it('reads, cancels and archives one replay', async () => {
    nextResponse = () => jsonResponse(sandboxReplayDetailFixture());
    await fetchSandboxReplay(sandboxReplayId);
    expect(calls[0]?.url).toBe(`/api/v1/sandbox/replays/${sandboxReplayId}`);
    expect(calls[0]?.init.method).toBe('GET');

    calls.length = 0;
    await cancelSandboxReplay(sandboxReplayId);
    expect(calls[0]?.url).toBe(`/api/v1/sandbox/replays/${sandboxReplayId}/cancel`);
    expect(calls[0]?.init.method).toBe('POST');
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual({});

    calls.length = 0;
    await archiveSandboxReplay(sandboxReplayId);
    expect(calls[0]?.url).toBe(`/api/v1/sandbox/replays/${sandboxReplayId}/archive`);
    expect(calls[0]?.init.method).toBe('POST');
  });

  it('reads the JSON report with the historical-paper label', async () => {
    nextResponse = () => jsonResponse(sandboxReplayReportResponseFixture());
    const report = await fetchSandboxReplayReport(sandboxReplayId);
    expect(report.executionMode).toBe('historical-paper');
    expect(calls[0]?.url).toBe(`/api/v1/sandbox/replays/${sandboxReplayId}/report.json`);
  });

  it('reads the chart and decision timeline', async () => {
    nextResponse = () =>
      jsonResponse({
        replayId: sandboxReplayId,
        tokens: [
          {
            tokenId: sandboxTokenId,
            candles: [
              {
                time: 1_760_000_000_000,
                openUsd: '4.00',
                highUsd: '4.30',
                lowUsd: '3.90',
                closeUsd: '4.20',
              },
            ],
          },
        ],
        actions: [
          {
            id: 'buy-1',
            tokenId: sandboxTokenId,
            time: 1_760_000_000_000,
            kind: 'buy',
            priceUsd: '4.20',
            amountUsd: '100.00',
            pnlUsd: null,
            reasonCode: 'TREND_PULLBACK_ENTRY',
            reasonText: 'Вход',
            intentId: 'buy-1',
            tradeId: 'trade-1',
          },
        ],
        note: 'window only',
      });
    const chart = await fetchSandboxReplayChart(sandboxReplayId);
    expect(chart.actions[0]?.reasonCode).toBe('TREND_PULLBACK_ENTRY');
    expect(calls[0]?.url).toBe(`/api/v1/sandbox/replays/${sandboxReplayId}/chart`);

    calls.length = 0;
    nextResponse = () =>
      jsonResponse({
        items: [
          {
            time: 1_760_000_000_000,
            tokenId: sandboxTokenId,
            strategyKey: 'trend_pullback',
            action: 'hold',
            sizeUsd: null,
            reasonCode: 'TREND_PULLBACK_HOLD',
            reasonText: 'Hold',
          },
        ],
        total: 1,
        limit: 20,
        offset: 0,
      });
    const decisions = await fetchSandboxReplayDecisions(sandboxReplayId, {
      limit: 20,
      offset: 0,
      tokenId: sandboxTokenId,
    });
    expect(decisions.items[0]?.reasonCode).toBe('TREND_PULLBACK_HOLD');
    expect(calls[0]?.url).toContain(`/api/v1/sandbox/replays/${sandboxReplayId}/decisions?`);
    expect(calls[0]?.url).toContain('tokenId=');
  });

  it('downloads JSON and PDF artifacts', async () => {
    nextResponse = () => jsonResponse(sandboxReplayReportResponseFixture());
    await downloadSandboxReplayReport(sandboxReplayId, 'json');
    expect(calls[0]?.url).toBe(`/api/v1/sandbox/replays/${sandboxReplayId}/report.json`);

    calls.length = 0;
    nextResponse = () =>
      new Response(new Blob(['%PDF-1.7'], { type: 'application/pdf' }), {
        status: 200,
        headers: { 'content-type': 'application/pdf' },
      });
    await downloadSandboxReplayReport(sandboxReplayId, 'pdf');
    expect(calls[0]?.url).toBe(`/api/v1/sandbox/replays/${sandboxReplayId}/report.pdf`);
    expect(calls[0]?.init.headers).toEqual({ Accept: 'application/pdf' });
  });

  it('maps a not-completed report to the typed Russian error', async () => {
    nextResponse = () =>
      jsonResponse(
        {
          error: {
            code: 'SANDBOX_REPLAY_NOT_COMPLETED',
            message: 'Отчёт доступен только для завершённого прогона',
            requestId: 'req-1',
          },
        },
        409,
      );

    const error = await fetchSandboxReplayReport(sandboxReplayId).catch((value: unknown) => value);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).code).toBe('SANDBOX_REPLAY_NOT_COMPLETED');
  });

  it('keys replay queries under one invalidatable prefix', () => {
    expect(sandboxQueryKeys.replayRoot).toEqual(['sandbox', 'replay']);
    expect(sandboxQueryKeys.replays('completed', false, 50, 0)).toEqual([
      'sandbox',
      'replay',
      'list',
      'completed',
      false,
      50,
      0,
    ]);
    expect(sandboxQueryKeys.replay(sandboxReplayId)).toEqual([
      'sandbox',
      'replay',
      sandboxReplayId,
    ]);
    expect(sandboxQueryKeys.replayReport(sandboxReplayId)).toEqual([
      'sandbox',
      'replay',
      sandboxReplayId,
      'report',
    ]);
    expect(sandboxQueryKeys.replayPreflight([sandboxTokenId], 180, true)).toEqual([
      'sandbox',
      'replay',
      'preflight',
      sandboxTokenId,
      180,
      true,
    ]);
  });

  it('invalidates every replay query after a replay mutation', async () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(sandboxQueryKeys.replays('all', false, 50, 0), {
      replays: [],
      total: 0,
      limit: 50,
      offset: 0,
    });
    queryClient.setQueryData(
      sandboxQueryKeys.replay(sandboxReplayId),
      sandboxReplayDetailFixture(),
    );
    queryClient.setQueryData(
      sandboxQueryKeys.replayReport(sandboxReplayId),
      sandboxReplayReportResponseFixture(),
    );
    queryClient.setQueryData(sandboxQueryKeys.runs(false), { runs: [] });

    await invalidateSandboxReplayQueries(queryClient);

    expect(
      queryClient.getQueryState(sandboxQueryKeys.replays('all', false, 50, 0))?.isInvalidated,
    ).toBe(true);
    expect(queryClient.getQueryState(sandboxQueryKeys.replay(sandboxReplayId))?.isInvalidated).toBe(
      true,
    );
    expect(
      queryClient.getQueryState(sandboxQueryKeys.replayReport(sandboxReplayId))?.isInvalidated,
    ).toBe(true);
    expect(queryClient.getQueryState(sandboxQueryKeys.runs(false))?.isInvalidated).toBeFalsy();
  });

  it('re-checks replay coverage after a token universe mutation', async () => {
    const queryClient = new QueryClient();
    const preflightKey = sandboxQueryKeys.replayPreflight([sandboxTokenId], 180, true);
    queryClient.setQueryData(preflightKey, sandboxReplayPreflightFixture());

    await invalidateSandboxUniverseQueries(queryClient);

    expect(queryClient.getQueryState(preflightKey)?.isInvalidated).toBe(true);
  });

  it('polls only while queued or running', () => {
    expect(SANDBOX_REPLAY_POLL_MS).toBe(5_000);
    expect(sandboxReplayRefetchInterval('queued')).toBe(5_000);
    expect(sandboxReplayRefetchInterval('running')).toBe(5_000);
    expect(sandboxReplayRefetchInterval('completed')).toBe(false);
    expect(sandboxReplayRefetchInterval(undefined)).toBe(false);

    expect(sandboxReplayListRefetchInterval([{ status: 'running' }])).toBe(5_000);
    expect(sandboxReplayListRefetchInterval([{ status: 'failed' }, { status: 'completed' }])).toBe(
      false,
    );
    expect(sandboxReplayListRefetchInterval([])).toBe(false);
    expect(sandboxReplayListRefetchInterval(undefined)).toBe(false);
  });
});

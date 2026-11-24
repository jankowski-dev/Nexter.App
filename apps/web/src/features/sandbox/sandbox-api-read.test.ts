import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api';
import { toRussianError } from '@/lib/error-messages';
import type { SandboxEventsResponse } from '@nexter/contracts';
import {
  closeSandboxTrade,
  downloadSandboxReportJson,
  fetchSandboxEquity,
  fetchSandboxEvents,
  fetchSandboxIntents,
  fetchSandboxOverview,
  fetchSandboxPositions,
  fetchSandboxReport,
  fetchSandboxReportMarkdown,
  fetchSandboxTrades,
  sandboxQueryKeys,
} from './sandbox-api';
import {
  SANDBOX_POLL_MS,
  sandboxEventTailQueryOptions,
  sandboxLiveRefetchInterval,
  sandboxOverviewRefetchInterval,
} from './sandbox-hooks';
import {
  sandboxOverviewFixture,
  sandboxReportResponseFixture,
  sandboxRunDetailFixture,
  sandboxRunId,
  sandboxTokenId,
} from './sandbox-test-fixtures';

interface FetchCall {
  url: string;
  init: RequestInit;
}

const calls: FetchCall[] = [];
const runId = sandboxRunId;
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

describe('sandbox read api', () => {
  it('reads the overview', async () => {
    nextResponse = () => jsonResponse(sandboxOverviewFixture());
    const overview = await fetchSandboxOverview();
    expect(overview.runs.running).toBe(1);
    expect(calls[0]?.url).toBe('/api/v1/sandbox/overview');
    expect(calls[0]?.init.method).toBe('GET');
  });

  it('reads positions', async () => {
    nextResponse = () => jsonResponse({ positions: [] });
    await expect(fetchSandboxPositions(runId)).resolves.toEqual({ positions: [] });
    expect(calls[0]?.url).toBe(`/api/v1/sandbox/runs/${runId}/positions`);
  });

  it('reads paginated trades and intents', async () => {
    nextResponse = () => jsonResponse({ trades: [], total: 0, limit: 25, offset: 50 });
    await fetchSandboxTrades(runId, 25, 50);
    expect(calls[0]?.url).toBe(`/api/v1/sandbox/runs/${runId}/trades?limit=25&offset=50`);

    calls.length = 0;
    nextResponse = () => jsonResponse({ intents: [], total: 0, limit: 25, offset: 50 });
    await fetchSandboxIntents(runId, 25, 50);
    expect(calls[0]?.url).toBe(`/api/v1/sandbox/runs/${runId}/intents?limit=25&offset=50`);
  });

  it('reads events with and without an afterSeq cursor', async () => {
    nextResponse = () => jsonResponse({ events: [], hasMore: false, nextAfterSeq: null });
    await fetchSandboxEvents(runId);
    expect(calls[0]?.url).toBe(`/api/v1/sandbox/runs/${runId}/events?limit=200`);

    calls.length = 0;
    await fetchSandboxEvents(runId, { afterSeq: 42, limit: 50 });
    expect(calls[0]?.url).toBe(`/api/v1/sandbox/runs/${runId}/events?limit=50&afterSeq=42`);
  });

  it('reads equity and the JSON report', async () => {
    nextResponse = () => jsonResponse({ points: [], total: 0, limit: 500, offset: 0 });
    await fetchSandboxEquity(runId);
    expect(calls[0]?.url).toBe(`/api/v1/sandbox/runs/${runId}/equity?limit=500&offset=0`);

    calls.length = 0;
    nextResponse = () => jsonResponse(sandboxReportResponseFixture());
    const report = await fetchSandboxReport(runId);
    expect(report.executionMode).toBe('live-paper');
    expect(calls[0]?.url).toBe(`/api/v1/sandbox/runs/${runId}/report.json`);
  });

  it('downloads the JSON artifact through the parsed report endpoint', async () => {
    nextResponse = () => jsonResponse(sandboxReportResponseFixture());
    await downloadSandboxReportJson(runId);
    expect(calls[0]?.url).toBe(`/api/v1/sandbox/runs/${runId}/report.json`);
  });

  it('fetches the Markdown report as text with credentials', async () => {
    nextResponse = () => new Response('# Live paper run report\n', { status: 200 });
    const markdown = await fetchSandboxReportMarkdown(runId);
    expect(markdown).toContain('Live paper');
    expect(calls[0]?.url).toBe(`/api/v1/sandbox/runs/${runId}/report.md`);
    expect(calls[0]?.init.credentials).toBe('include');
  });

  it('maps a not-ready Markdown report to the typed Russian error', async () => {
    nextResponse = () =>
      jsonResponse(
        {
          error: {
            code: 'SANDBOX_REPORT_NOT_READY',
            message: 'Отчёт пока недоступен',
            requestId: 'req-1',
            details: { reason: 'chain mismatch' },
          },
        },
        409,
      );

    const error = await fetchSandboxReportMarkdown(runId).catch((value: unknown) => value);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).code).toBe('SANDBOX_REPORT_NOT_READY');
    expect(toRussianError(error, 'fallback')).toContain('Отчёт пока недоступен');
  });

  it('handles a non-JSON error response with a clear Russian message', async () => {
    nextResponse = () => new Response('gateway down', { status: 502 });
    const error = await fetchSandboxReportMarkdown(runId).catch((value: unknown) => value);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).message).toContain('Не удалось скачать отчёт');
  });

  it('posts the close request for one token', async () => {
    nextResponse = () => jsonResponse(sandboxRunDetailFixture());
    await closeSandboxTrade(runId, sandboxTokenId);
    expect(calls[0]?.url).toBe(
      `/api/v1/sandbox/runs/${runId}/close/${encodeURIComponent(sandboxTokenId)}`,
    );
    expect(calls[0]?.init.method).toBe('POST');
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual({});
  });

  it.each([
    ['SANDBOX_CLOSE_ALREADY_PENDING', 'уже запрошено'],
    ['SANDBOX_POSITION_NOT_FOUND', 'позиция по этому токену не найдена'],
    ['SANDBOX_RUN_NOT_RUNNING', 'Запуск не работает'],
  ] as const)('maps the close 409 %s to Russian', (code, message) => {
    const error = new ApiError(code, code);
    expect(toRussianError(error, 'fallback')).toContain(message);
  });

  it('keys paginated queries by limit and offset', () => {
    expect(sandboxQueryKeys.trades(runId, 50, 100)).toEqual(['sandbox', 'trades', runId, 50, 100]);
    expect(sandboxQueryKeys.events(runId, 200)).toEqual(['sandbox', 'events', runId, 200]);
    expect(sandboxQueryKeys.eventTail(runId, 200, 799)).toEqual([
      'sandbox',
      'events-tail',
      runId,
      200,
      799,
    ]);
    expect(sandboxQueryKeys.report(runId)).toEqual(['sandbox', 'report', runId]);
  });

  it('polls live queries every 30 s and the overview only with a running run', () => {
    expect(SANDBOX_POLL_MS).toBe(30_000);
    expect(sandboxLiveRefetchInterval(true)).toBe(30_000);
    expect(sandboxLiveRefetchInterval(false)).toBe(false);
    expect(sandboxOverviewRefetchInterval(1)).toBe(30_000);
    expect(sandboxOverviewRefetchInterval(0)).toBe(false);
    expect(sandboxOverviewRefetchInterval(undefined)).toBe(false);
  });

  it('keeps the previous event tail while a refetch is in flight', async () => {
    const previous: SandboxEventsResponse = { events: [], hasMore: false, nextAfterSeq: null };
    const fetchEvents = vi.fn(async () => previous) as unknown as typeof fetchSandboxEvents;
    const options = sandboxEventTailQueryOptions({
      runId,
      live: true,
      eventCount: 900,
      limit: 200,
      fetchEvents,
    });

    expect(options.queryKey).toEqual(['sandbox', 'events-tail', runId, 200, 699]);
    expect(options.refetchInterval).toBe(30_000);
    expect(typeof options.placeholderData).toBe('function');
    const placeholder = options.placeholderData as unknown as (
      value: SandboxEventsResponse,
    ) => SandboxEventsResponse;
    expect(placeholder(previous)).toBe(previous);

    await (options.queryFn as unknown as (context: unknown) => Promise<unknown>)({});
    expect(fetchEvents).toHaveBeenCalledWith(runId, { afterSeq: 699, limit: 200 });
  });
});

import { ApiError, apiFetch, apiPatch, apiPost } from '@/lib/api';
import { notifyUnauthorized } from '@/lib/auth-events';
import { sandboxReplayReportFileName } from './sandbox-replay-helpers';
import { sandboxReportFileName } from './sandbox-report-helpers';
import {
  errorEnvelopeSchema,
  sandboxCoverageResponseSchema,
  sandboxEquityResponseSchema,
  sandboxEventsResponseSchema,
  sandboxIntentsResponseSchema,
  sandboxOverviewSchema,
  sandboxPositionsResponseSchema,
  sandboxReplayChartResponseSchema,
  sandboxReplayCreateRequestSchema,
  sandboxReplayDecisionsResponseSchema,
  sandboxReplayDetailSchema,
  sandboxReplayListResponseSchema,
  sandboxReplayPreflightRequestSchema,
  sandboxReplayPreflightResponseSchema,
  sandboxReplayReportResponseSchema,
  sandboxReportResponseSchema,
  sandboxRunCreateRequestSchema,
  sandboxRunDetailSchema,
  sandboxRunSchema,
  sandboxRunsResponseSchema,
  sandboxStatusSchema,
  sandboxTokenCreateRequestSchema,
  sandboxTokenRefreshResponseSchema,
  sandboxTokenSchema,
  sandboxTokensResponseSchema,
  sandboxTradesResponseSchema,
  type SandboxCoverageResponse,
  type SandboxEquityResponse,
  type SandboxEventsResponse,
  type SandboxIntentsResponse,
  type SandboxOverview,
  type SandboxPositionsResponse,
  type SandboxReplayChartResponse,
  type SandboxReplayCreateRequest,
  type SandboxReplayDecisionsQuery,
  type SandboxReplayDecisionsResponse,
  type SandboxReplayDetail,
  type SandboxReplayListResponse,
  type SandboxReplayPreflightRequest,
  type SandboxReplayPreflightResponse,
  type SandboxReplayReportResponse,
  type SandboxReplayStatus,
  type SandboxReportResponse,
  type SandboxRun,
  type SandboxRunCreateRequest,
  type SandboxRunDetail,
  type SandboxRunStartRequest,
  type SandboxRunUpdateRequest,
  type SandboxRunsResponse,
  type SandboxStatus,
  type SandboxToken,
  type SandboxTokenCreateRequest,
  type SandboxTokenRefreshResponse,
  type SandboxTokensResponse,
  type SandboxTokenUpdateRequest,
  type SandboxTradesResponse,
} from '@nexter/contracts';

/** React Query keys for the sandbox section; one prefix invalidates the page. */
export const sandboxQueryKeys = {
  all: ['sandbox'] as const,
  status: ['sandbox', 'status'] as const,
  tokens: ['sandbox', 'tokens'] as const,
  coverage: ['sandbox', 'coverage'] as const,
  overview: ['sandbox', 'overview'] as const,
  runsRoot: ['sandbox', 'runs'] as const,
  runs: (includeArchived: boolean) => ['sandbox', 'runs', includeArchived] as const,
  run: (runId: string) => ['sandbox', 'run', runId] as const,
  positions: (runId: string) => ['sandbox', 'positions', runId] as const,
  trades: (runId: string, limit: number, offset: number) =>
    ['sandbox', 'trades', runId, limit, offset] as const,
  intents: (runId: string, limit: number, offset: number) =>
    ['sandbox', 'intents', runId, limit, offset] as const,
  events: (runId: string, limit: number) => ['sandbox', 'events', runId, limit] as const,
  eventTail: (runId: string, limit: number, afterSeq: number | null) =>
    ['sandbox', 'events-tail', runId, limit, afterSeq] as const,
  equity: (runId: string, limit: number, offset: number) =>
    ['sandbox', 'equity', runId, limit, offset] as const,
  report: (runId: string) => ['sandbox', 'report', runId] as const,
  /** Prefix shared by every replay query (list, detail, report, preflight). */
  replayRoot: ['sandbox', 'replay'] as const,
  replays: (
    status: SandboxReplayStatus | 'all',
    includeArchived: boolean,
    limit: number,
    offset: number,
  ) => ['sandbox', 'replay', 'list', status, includeArchived, limit, offset] as const,
  replay: (replayId: string) => ['sandbox', 'replay', replayId] as const,
  replayReport: (replayId: string) => ['sandbox', 'replay', replayId, 'report'] as const,
  replayChart: (replayId: string) => ['sandbox', 'replay', replayId, 'chart'] as const,
  replayDecisions: (replayId: string, tokenId: string | null) =>
    ['sandbox', 'replay', replayId, 'decisions', tokenId ?? 'all'] as const,
  replayPreflight: (tokenKeys: readonly string[], periodDays: number, allowPartial: boolean) =>
    ['sandbox', 'replay', 'preflight', tokenKeys.join('|'), periodDays, allowPartial] as const,
};

export function fetchSandboxStatus(): Promise<SandboxStatus> {
  return apiFetch('/api/v1/sandbox/status', {}, sandboxStatusSchema);
}

export function fetchSandboxTokens(): Promise<SandboxTokensResponse> {
  return apiFetch('/api/v1/sandbox/tokens', {}, sandboxTokensResponseSchema);
}

export function fetchSandboxCoverage(): Promise<SandboxCoverageResponse> {
  return apiFetch('/api/v1/sandbox/coverage', {}, sandboxCoverageResponseSchema);
}

export function createSandboxToken(body: SandboxTokenCreateRequest): Promise<SandboxToken> {
  return apiPost(
    '/api/v1/sandbox/tokens',
    sandboxTokenCreateRequestSchema.parse(body),
    sandboxTokenSchema,
  );
}

export function updateSandboxToken(
  tokenId: string,
  body: SandboxTokenUpdateRequest,
): Promise<SandboxToken> {
  return apiPatch(`/api/v1/sandbox/tokens/${tokenId}`, body, sandboxTokenSchema);
}

export function refreshSandboxToken(tokenId: string): Promise<SandboxTokenRefreshResponse> {
  return apiPost(
    `/api/v1/sandbox/tokens/${tokenId}/refresh`,
    {},
    sandboxTokenRefreshResponseSchema,
  );
}

export function fetchSandboxRuns(includeArchived = false): Promise<SandboxRunsResponse> {
  return apiFetch(
    `/api/v1/sandbox/runs?includeArchived=${includeArchived ? 'true' : 'false'}&limit=100`,
    {},
    sandboxRunsResponseSchema,
  );
}

export function fetchSandboxRun(runId: string): Promise<SandboxRunDetail> {
  return apiFetch(`/api/v1/sandbox/runs/${runId}`, {}, sandboxRunDetailSchema);
}

export function fetchSandboxOverview(): Promise<SandboxOverview> {
  return apiFetch('/api/v1/sandbox/overview', {}, sandboxOverviewSchema);
}

export function fetchSandboxPositions(runId: string): Promise<SandboxPositionsResponse> {
  return apiFetch(`/api/v1/sandbox/runs/${runId}/positions`, {}, sandboxPositionsResponseSchema);
}

export function fetchSandboxTrades(
  runId: string,
  limit = 50,
  offset = 0,
): Promise<SandboxTradesResponse> {
  return apiFetch(
    `/api/v1/sandbox/runs/${runId}/trades?limit=${limit}&offset=${offset}`,
    {},
    sandboxTradesResponseSchema,
  );
}

export function fetchSandboxIntents(
  runId: string,
  limit = 50,
  offset = 0,
): Promise<SandboxIntentsResponse> {
  return apiFetch(
    `/api/v1/sandbox/runs/${runId}/intents?limit=${limit}&offset=${offset}`,
    {},
    sandboxIntentsResponseSchema,
  );
}

export function fetchSandboxEvents(
  runId: string,
  options: { afterSeq?: number; limit?: number } = {},
): Promise<SandboxEventsResponse> {
  const limit = options.limit ?? 200;
  const afterSeq = options.afterSeq === undefined ? '' : `&afterSeq=${options.afterSeq}`;
  return apiFetch(
    `/api/v1/sandbox/runs/${runId}/events?limit=${limit}${afterSeq}`,
    {},
    sandboxEventsResponseSchema,
  );
}

export function fetchSandboxEquity(
  runId: string,
  limit = 500,
  offset = 0,
): Promise<SandboxEquityResponse> {
  const safeLimit = Math.min(2_000, Math.max(1, Math.trunc(limit)));
  return apiFetch(
    `/api/v1/sandbox/runs/${runId}/equity?limit=${safeLimit}&offset=${offset}`,
    {},
    sandboxEquityResponseSchema,
  );
}

export function fetchSandboxReport(runId: string): Promise<SandboxReportResponse> {
  return apiFetch(`/api/v1/sandbox/runs/${runId}/report.json`, {}, sandboxReportResponseSchema);
}

/** Raw Markdown report body; used by the downloadable artifact. */
export async function fetchSandboxReportMarkdown(runId: string): Promise<string> {
  const response = await fetch(`/api/v1/sandbox/runs/${runId}/report.md`, {
    credentials: 'include',
    headers: { Accept: 'text/markdown' },
  });

  if (!response.ok) {
    throw await sandboxDownloadError(response);
  }

  return response.text();
}

async function sandboxDownloadError(response: Response): Promise<ApiError> {
  let payload: unknown = null;
  try {
    payload = (await response.json()) as unknown;
  } catch {
    payload = null;
  }

  const parsed = errorEnvelopeSchema.safeParse(payload);
  if (parsed.success) {
    if (response.status === 401) notifyUnauthorized();
    return new ApiError(
      parsed.data.error.code,
      parsed.data.error.message,
      parsed.data.error.requestId,
      parsed.data.error.details,
    );
  }

  if (response.status === 401) notifyUnauthorized();
  return new ApiError('HTTP_ERROR', `Не удалось скачать отчёт (HTTP ${response.status})`);
}

function triggerSandboxDownload(content: Blob, fileName: string): void {
  if (typeof document === 'undefined' || typeof URL.createObjectURL !== 'function') return;
  const url = URL.createObjectURL(content);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

/**
 * Downloads the deterministic JSON report. The fetched response is already
 * schema-parsed, so the artifact cannot drift from the read API contract.
 */
export async function downloadSandboxReportJson(runId: string): Promise<void> {
  const response = await fetchSandboxReport(runId);
  triggerSandboxDownload(
    new Blob([`${JSON.stringify(response, null, 2)}\n`], { type: 'application/json' }),
    sandboxReportFileName(runId, 'json'),
  );
}

/** Downloads the Markdown report generated by the API. */
export async function downloadSandboxReportMarkdown(runId: string): Promise<void> {
  const markdown = await fetchSandboxReportMarkdown(runId);
  triggerSandboxDownload(
    new Blob([markdown], { type: 'text/markdown;charset=utf-8' }),
    sandboxReportFileName(runId, 'md'),
  );
}

export interface SandboxReplayListOptions {
  status?: SandboxReplayStatus;
  includeArchived?: boolean;
  limit?: number;
  offset?: number;
}

/** Read-only coverage gate for a historical replay; never mutates data. */
export function preflightSandboxReplay(
  body: SandboxReplayPreflightRequest,
): Promise<SandboxReplayPreflightResponse> {
  return apiPost(
    '/api/v1/sandbox/replays/preflight',
    sandboxReplayPreflightRequestSchema.parse(body),
    sandboxReplayPreflightResponseSchema,
  );
}

/** Queues a bounded historical replay (202); the worker executes it. */
export function createSandboxReplay(
  body: SandboxReplayCreateRequest,
): Promise<SandboxReplayDetail> {
  return apiPost(
    '/api/v1/sandbox/replays',
    sandboxReplayCreateRequestSchema.parse(body),
    sandboxReplayDetailSchema,
  );
}

export function fetchSandboxReplays(
  options: SandboxReplayListOptions = {},
): Promise<SandboxReplayListResponse> {
  const params = new URLSearchParams();
  if (options.status) params.set('status', options.status);
  params.set('includeArchived', options.includeArchived ? 'true' : 'false');
  params.set('limit', String(options.limit ?? 50));
  params.set('offset', String(options.offset ?? 0));
  return apiFetch(
    `/api/v1/sandbox/replays?${params.toString()}`,
    {},
    sandboxReplayListResponseSchema,
  );
}

export function fetchSandboxReplay(replayId: string): Promise<SandboxReplayDetail> {
  return apiFetch(`/api/v1/sandbox/replays/${replayId}`, {}, sandboxReplayDetailSchema);
}

export function cancelSandboxReplay(replayId: string): Promise<SandboxReplayDetail> {
  return apiPost(`/api/v1/sandbox/replays/${replayId}/cancel`, {}, sandboxReplayDetailSchema);
}

export function archiveSandboxReplay(replayId: string): Promise<SandboxReplayDetail> {
  return apiPost(`/api/v1/sandbox/replays/${replayId}/archive`, {}, sandboxReplayDetailSchema);
}

export function fetchSandboxReplayReport(replayId: string): Promise<SandboxReplayReportResponse> {
  return apiFetch(
    `/api/v1/sandbox/replays/${replayId}/report.json`,
    {},
    sandboxReplayReportResponseSchema,
  );
}

export function fetchSandboxReplayChart(replayId: string): Promise<SandboxReplayChartResponse> {
  return apiFetch(
    `/api/v1/sandbox/replays/${replayId}/chart`,
    {},
    sandboxReplayChartResponseSchema,
  );
}

export function fetchSandboxReplayDecisions(
  replayId: string,
  query: Partial<SandboxReplayDecisionsQuery> = {},
): Promise<SandboxReplayDecisionsResponse> {
  const params = new URLSearchParams();
  params.set('limit', String(query.limit ?? 100));
  params.set('offset', String(query.offset ?? 0));
  if (query.tokenId) params.set('tokenId', query.tokenId);
  return apiFetch(
    `/api/v1/sandbox/replays/${replayId}/decisions?${params.toString()}`,
    {},
    sandboxReplayDecisionsResponseSchema,
  );
}

/** Downloads the deterministic replay report as JSON or the detailed PDF. */
export async function downloadSandboxReplayReport(
  replayId: string,
  format: 'json' | 'pdf',
): Promise<void> {
  if (format === 'json') {
    const response = await fetchSandboxReplayReport(replayId);
    triggerSandboxDownload(
      new Blob([`${JSON.stringify(response, null, 2)}\n`], { type: 'application/json' }),
      sandboxReplayReportFileName(replayId, 'json'),
    );
    return;
  }

  const response = await fetch(`/api/v1/sandbox/replays/${replayId}/report.pdf`, {
    credentials: 'include',
    headers: { Accept: 'application/pdf' },
  });
  if (!response.ok) throw await sandboxDownloadError(response);
  triggerSandboxDownload(await response.blob(), sandboxReplayReportFileName(replayId, 'pdf'));
}

/** Queues a sell intent for one position; fills on the next closed 1h bar. */
export function closeSandboxTrade(runId: string, tokenId: string): Promise<SandboxRun> {
  return apiPost(
    `/api/v1/sandbox/runs/${runId}/close/${encodeURIComponent(tokenId)}`,
    {},
    sandboxRunSchema,
  );
}

export function createSandboxRun(body: SandboxRunCreateRequest): Promise<SandboxRun> {
  return apiPost(
    '/api/v1/sandbox/runs',
    sandboxRunCreateRequestSchema.parse(body),
    sandboxRunSchema,
  );
}

export function updateSandboxRun(
  runId: string,
  body: SandboxRunUpdateRequest,
): Promise<SandboxRun> {
  return apiPatch(`/api/v1/sandbox/runs/${runId}`, body, sandboxRunSchema);
}

export function startSandboxRun(
  runId: string,
  body: SandboxRunStartRequest = {},
): Promise<SandboxRun> {
  return apiPost(`/api/v1/sandbox/runs/${runId}/start`, body, sandboxRunSchema);
}

export function pauseSandboxRun(runId: string): Promise<SandboxRun> {
  return apiPost(`/api/v1/sandbox/runs/${runId}/pause`, {}, sandboxRunSchema);
}

export function resumeSandboxRun(runId: string): Promise<SandboxRun> {
  return apiPost(`/api/v1/sandbox/runs/${runId}/resume`, {}, sandboxRunSchema);
}

export function stopSandboxRun(runId: string): Promise<SandboxRun> {
  return apiPost(`/api/v1/sandbox/runs/${runId}/stop`, {}, sandboxRunSchema);
}

export function archiveSandboxRun(runId: string): Promise<SandboxRun> {
  return apiPost(`/api/v1/sandbox/runs/${runId}/archive`, {}, sandboxRunSchema);
}

export type SandboxLifecycleAction = 'start' | 'pause' | 'resume' | 'stop' | 'archive';

export function runSandboxLifecycle(
  runId: string,
  action: SandboxLifecycleAction,
  body: SandboxRunStartRequest = {},
): Promise<SandboxRun> {
  switch (action) {
    case 'start':
      return startSandboxRun(runId, body);
    case 'pause':
      return pauseSandboxRun(runId);
    case 'resume':
      return resumeSandboxRun(runId);
    case 'stop':
      return stopSandboxRun(runId);
    case 'archive':
      return archiveSandboxRun(runId);
  }
}

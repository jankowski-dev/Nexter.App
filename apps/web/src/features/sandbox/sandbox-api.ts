import { apiFetch, apiPatch, apiPost } from '@/lib/api';
import {
  sandboxCoverageResponseSchema,
  sandboxRunCreateRequestSchema,
  sandboxRunDetailSchema,
  sandboxRunSchema,
  sandboxRunsResponseSchema,
  sandboxStatusSchema,
  sandboxTokensResponseSchema,
  type SandboxCoverageResponse,
  type SandboxRun,
  type SandboxRunCreateRequest,
  type SandboxRunDetail,
  type SandboxRunStartRequest,
  type SandboxRunUpdateRequest,
  type SandboxRunsResponse,
  type SandboxStatus,
  type SandboxTokensResponse,
} from '@nexter/contracts';

/** React Query keys for the sandbox section; one prefix invalidates the page. */
export const sandboxQueryKeys = {
  all: ['sandbox'] as const,
  status: ['sandbox', 'status'] as const,
  tokens: ['sandbox', 'tokens'] as const,
  coverage: ['sandbox', 'coverage'] as const,
  runsRoot: ['sandbox', 'runs'] as const,
  runs: (includeArchived: boolean) => ['sandbox', 'runs', includeArchived] as const,
  run: (runId: string) => ['sandbox', 'run', runId] as const,
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

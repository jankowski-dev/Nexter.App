import {
  closeSandboxTrade,
  createSandboxRun,
  createSandboxToken,
  fetchSandboxCoverage,
  fetchSandboxEquity,
  fetchSandboxEvents,
  fetchSandboxIntents,
  fetchSandboxOverview,
  fetchSandboxPositions,
  fetchSandboxReport,
  fetchSandboxRun,
  fetchSandboxRuns,
  fetchSandboxStatus,
  fetchSandboxTokens,
  fetchSandboxTrades,
  refreshSandboxToken,
  runSandboxLifecycle,
  sandboxQueryKeys,
  updateSandboxRun,
  updateSandboxToken,
  type SandboxLifecycleAction,
} from './sandbox-api';
import { sandboxTailEventsAfterSeq } from './sandbox-dashboard-helpers';
import type {
  SandboxRunCreateRequest,
  SandboxRunUpdateRequest,
  SandboxTokenCreateRequest,
  SandboxTokenUpdateRequest,
} from '@nexter/contracts';
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from '@tanstack/react-query';

export const SANDBOX_POLL_MS = 30_000;

/** Live runs poll every 30 s; everything else never polls. */
export function sandboxLiveRefetchInterval(live: boolean): number | false {
  return live ? SANDBOX_POLL_MS : false;
}

/** The overview polls only while at least one run is running. */
export function sandboxOverviewRefetchInterval(runningRuns: number | undefined): number | false {
  return runningRuns !== undefined && runningRuns > 0 ? SANDBOX_POLL_MS : false;
}

/** Invalidates every sandbox query after a mutation (list, detail and counts). */
export function invalidateSandboxQueries(queryClient: QueryClient): Promise<void> {
  return queryClient.invalidateQueries({ queryKey: sandboxQueryKeys.all }).then(() => undefined);
}

/**
 * Invalidates the token universe and its coverage. Run setup reads both, so a
 * token add/patch/refresh updates the selection list without a page reload.
 */
export function invalidateSandboxUniverseQueries(queryClient: QueryClient): Promise<void> {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: sandboxQueryKeys.tokens }),
    queryClient.invalidateQueries({ queryKey: sandboxQueryKeys.coverage }),
  ]).then(() => undefined);
}

export function useSandboxStatus() {
  return useQuery({
    queryKey: sandboxQueryKeys.status,
    queryFn: fetchSandboxStatus,
    staleTime: 5 * 60_000,
    retry: false,
    refetchOnWindowFocus: false,
  });
}

export function useSandboxTokens(enabled = true) {
  return useQuery({
    queryKey: sandboxQueryKeys.tokens,
    queryFn: fetchSandboxTokens,
    enabled,
    staleTime: 60_000,
  });
}

export function useSandboxCoverage(enabled = true) {
  return useQuery({
    queryKey: sandboxQueryKeys.coverage,
    queryFn: fetchSandboxCoverage,
    enabled,
    staleTime: 60_000,
  });
}

export function useSandboxRuns(includeArchived: boolean, enabled = true) {
  return useQuery({
    queryKey: sandboxQueryKeys.runs(includeArchived),
    queryFn: () => fetchSandboxRuns(includeArchived),
    enabled,
  });
}

export function useSandboxRunDetail(runId: string | null, poll = true) {
  return useQuery({
    queryKey: sandboxQueryKeys.run(runId ?? 'none'),
    queryFn: () => fetchSandboxRun(runId as string),
    enabled: runId !== null,
    refetchOnWindowFocus: false,
    // Live runs refresh every 30 s unless the caller is a read-only artifact
    // view (reports) that must not poll; draft, paused, terminal and archived
    // runs never poll.
    refetchInterval: (query) => {
      if (!poll) return false;
      const run = query.state.data;
      return run && run.status === 'running' && run.archivedAt === null ? SANDBOX_POLL_MS : false;
    },
  });
}

export function useSandboxOverview(enabled = true) {
  return useQuery({
    queryKey: sandboxQueryKeys.overview,
    queryFn: fetchSandboxOverview,
    enabled,
    refetchInterval: (query) => sandboxOverviewRefetchInterval(query.state.data?.runs.running),
    refetchOnWindowFocus: false,
  });
}

export function useSandboxPositions(runId: string | null, live: boolean) {
  return useQuery({
    queryKey: sandboxQueryKeys.positions(runId ?? 'none'),
    queryFn: () => fetchSandboxPositions(runId as string),
    enabled: runId !== null,
    refetchOnWindowFocus: false,
    refetchInterval: sandboxLiveRefetchInterval(live),
  });
}

export function useSandboxEquity(runId: string | null, live: boolean, limit = 500, offset = 0) {
  return useQuery({
    queryKey: sandboxQueryKeys.equity(runId ?? 'none', limit, offset),
    queryFn: () => fetchSandboxEquity(runId as string, limit, offset),
    enabled: runId !== null,
    refetchOnWindowFocus: false,
    refetchInterval: sandboxLiveRefetchInterval(live),
  });
}

export function useSandboxTrades(runId: string | null, limit = 50, offset = 0, live = false) {
  return useQuery({
    queryKey: sandboxQueryKeys.trades(runId ?? 'none', limit, offset),
    queryFn: () => fetchSandboxTrades(runId as string, limit, offset),
    enabled: runId !== null,
    refetchOnWindowFocus: false,
    refetchInterval: sandboxLiveRefetchInterval(live),
  });
}

export function useSandboxIntents(runId: string | null, limit = 50, offset = 0, live = false) {
  return useQuery({
    queryKey: sandboxQueryKeys.intents(runId ?? 'none', limit, offset),
    queryFn: () => fetchSandboxIntents(runId as string, limit, offset),
    enabled: runId !== null,
    refetchOnWindowFocus: false,
    refetchInterval: sandboxLiveRefetchInterval(live),
  });
}

/**
 * Event pages append by `afterSeq`. The query key includes the page size so a
 * different limit never mixes pages; `refetchInterval` is disabled for
 * non-running runs.
 */
export function useSandboxEvents(runId: string | null, live: boolean, limit = 200) {
  return useInfiniteQuery({
    queryKey: sandboxQueryKeys.events(runId ?? 'none', limit),
    queryFn: ({ pageParam }) =>
      fetchSandboxEvents(runId as string, {
        afterSeq: pageParam ?? undefined,
        limit,
      }),
    initialPageParam: null as number | null,
    getNextPageParam: (last) => (last.hasMore ? (last.nextAfterSeq ?? undefined) : undefined),
    enabled: runId !== null,
    refetchOnWindowFocus: false,
    refetchInterval: live ? 30_000 : false,
  });
}

/**
 * Dashboard tail: the newest events of a run, seeded from the run detail's
 * persisted `eventCount`. This never reuses the journal's append pagination.
 */
export function useSandboxEventTail(
  runId: string | null,
  live: boolean,
  eventCount: number | null,
  limit = 200,
) {
  const afterSeq = eventCount === null ? null : sandboxTailEventsAfterSeq(eventCount, limit);
  return useQuery({
    queryKey: sandboxQueryKeys.eventTail(runId ?? 'none', limit, afterSeq),
    queryFn: () =>
      fetchSandboxEvents(runId as string, {
        afterSeq: afterSeq ?? undefined,
        limit,
      }),
    enabled: runId !== null && eventCount !== null,
    refetchOnWindowFocus: false,
    refetchInterval: sandboxLiveRefetchInterval(live),
  });
}

export function useSandboxReport(runId: string | null, enabled = true) {
  return useQuery({
    queryKey: sandboxQueryKeys.report(runId ?? 'none'),
    queryFn: () => fetchSandboxReport(runId as string),
    enabled: runId !== null && enabled,
    refetchOnWindowFocus: false,
    retry: false,
  });
}

export function useCloseSandboxTrade() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { runId: string; tokenId: string }) =>
      closeSandboxTrade(input.runId, input.tokenId),
    onSuccess: () => invalidateSandboxQueries(queryClient),
  });
}

export function useCreateSandboxRun() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: SandboxRunCreateRequest) => createSandboxRun(body),
    onSuccess: () => invalidateSandboxQueries(queryClient),
  });
}

export function useUpdateSandboxRun() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { runId: string; body: SandboxRunUpdateRequest }) =>
      updateSandboxRun(input.runId, input.body),
    onSuccess: () => invalidateSandboxQueries(queryClient),
  });
}

export interface SandboxLifecycleInput {
  runId: string;
  action: SandboxLifecycleAction;
  allowPartial?: boolean;
}

export function useSandboxLifecycle() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: SandboxLifecycleInput) =>
      runSandboxLifecycle(
        input.runId,
        input.action,
        input.allowPartial ? { allowPartial: true } : {},
      ),
    onSuccess: () => invalidateSandboxQueries(queryClient),
  });
}

export function useCreateSandboxToken() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: SandboxTokenCreateRequest) => createSandboxToken(body),
    onSuccess: () => invalidateSandboxUniverseQueries(queryClient),
  });
}

export function useUpdateSandboxToken() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { tokenId: string; body: SandboxTokenUpdateRequest }) =>
      updateSandboxToken(input.tokenId, input.body),
    onSuccess: () => invalidateSandboxUniverseQueries(queryClient),
  });
}

export function useRefreshSandboxToken() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (tokenId: string) => refreshSandboxToken(tokenId),
    onSuccess: () => invalidateSandboxUniverseQueries(queryClient),
  });
}

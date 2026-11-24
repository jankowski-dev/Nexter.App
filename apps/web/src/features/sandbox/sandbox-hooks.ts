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

export function useSandboxRunDetail(runId: string | null) {
  return useQuery({
    queryKey: sandboxQueryKeys.run(runId ?? 'none'),
    queryFn: () => fetchSandboxRun(runId as string),
    enabled: runId !== null,
    refetchOnWindowFocus: false,
    // Live runs refresh every 30 s; draft, paused, terminal and archived runs
    // never poll.
    refetchInterval: (query) => {
      const run = query.state.data;
      return run && run.status === 'running' && run.archivedAt === null ? 30_000 : false;
    },
  });
}

export function useSandboxOverview(enabled = true) {
  return useQuery({
    queryKey: sandboxQueryKeys.overview,
    queryFn: fetchSandboxOverview,
    enabled,
    refetchInterval: 30_000,
    refetchOnWindowFocus: false,
  });
}

export function useSandboxPositions(runId: string | null, live: boolean) {
  return useQuery({
    queryKey: sandboxQueryKeys.positions(runId ?? 'none'),
    queryFn: () => fetchSandboxPositions(runId as string),
    enabled: runId !== null,
    refetchOnWindowFocus: false,
    refetchInterval: live ? 30_000 : false,
  });
}

export function useSandboxEquity(runId: string | null, live: boolean, limit = 500, offset = 0) {
  return useQuery({
    queryKey: sandboxQueryKeys.equity(runId ?? 'none', limit, offset),
    queryFn: () => fetchSandboxEquity(runId as string, limit, offset),
    enabled: runId !== null,
    refetchOnWindowFocus: false,
    refetchInterval: live ? 30_000 : false,
  });
}

export function useSandboxTrades(runId: string | null, limit = 50, offset = 0) {
  return useQuery({
    queryKey: sandboxQueryKeys.trades(runId ?? 'none', limit, offset),
    queryFn: () => fetchSandboxTrades(runId as string, limit, offset),
    enabled: runId !== null,
    refetchOnWindowFocus: false,
  });
}

export function useSandboxIntents(runId: string | null, limit = 50, offset = 0) {
  return useQuery({
    queryKey: sandboxQueryKeys.intents(runId ?? 'none', limit, offset),
    queryFn: () => fetchSandboxIntents(runId as string, limit, offset),
    enabled: runId !== null,
    refetchOnWindowFocus: false,
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

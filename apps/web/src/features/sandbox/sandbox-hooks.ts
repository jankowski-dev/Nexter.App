import {
  archiveSandboxReplay,
  cancelSandboxReplay,
  closeSandboxTrade,
  createSandboxReplay,
  createSandboxRun,
  createSandboxToken,
  fetchSandboxCoverage,
  fetchSandboxEquity,
  fetchSandboxEvents,
  fetchSandboxIntents,
  fetchSandboxOverview,
  fetchSandboxPositions,
  fetchSandboxReplay,
  fetchSandboxReplayChart,
  fetchSandboxReplayDecisions,
  fetchSandboxReplayReport,
  fetchSandboxReplays,
  fetchSandboxReport,
  fetchSandboxRun,
  fetchSandboxRuns,
  fetchSandboxStatus,
  fetchSandboxTokenCandidates,
  fetchSandboxTokens,
  fetchSandboxTrades,
  preflightSandboxReplay,
  refreshSandboxToken,
  runSandboxLifecycle,
  sandboxQueryKeys,
  updateSandboxRun,
  updateSandboxToken,
  type SandboxLifecycleAction,
  type SandboxReplayListOptions,
} from './sandbox-api';
import { sandboxTailEventsAfterSeq } from './sandbox-dashboard-helpers';
import type {
  SandboxEventsResponse,
  SandboxReplayCreateRequest,
  SandboxReplayPreflightRequest,
  SandboxReplayStatus,
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
  type UseQueryOptions,
} from '@tanstack/react-query';

export const SANDBOX_POLL_MS = 30_000;
/** Historical replays are short; poll their progress every 5 s while active. */
export const SANDBOX_REPLAY_POLL_MS = 5_000;

/** Live runs poll every 30 s; everything else never polls. */
export function sandboxLiveRefetchInterval(live: boolean): number | false {
  return live ? SANDBOX_POLL_MS : false;
}

/** The overview polls only while at least one run is running. */
export function sandboxOverviewRefetchInterval(runningRuns: number | undefined): number | false {
  return runningRuns !== undefined && runningRuns > 0 ? SANDBOX_POLL_MS : false;
}

/** Replay detail/history poll only while a replay is queued or running. */
export function sandboxReplayRefetchInterval(
  status: SandboxReplayStatus | undefined,
): number | false {
  return status === 'queued' || status === 'running' ? SANDBOX_REPLAY_POLL_MS : false;
}

export function sandboxReplayListRefetchInterval(
  replays: readonly { status: SandboxReplayStatus }[] | undefined,
): number | false {
  return replays?.some((replay) => sandboxReplayRefetchInterval(replay.status) !== false)
    ? SANDBOX_REPLAY_POLL_MS
    : false;
}

/** Invalidates every sandbox query after a mutation (list, detail and counts). */
export function invalidateSandboxQueries(queryClient: QueryClient): Promise<void> {
  return queryClient.invalidateQueries({ queryKey: sandboxQueryKeys.all }).then(() => undefined);
}

/**
 * Invalidates the token universe and its coverage. Run setup reads both, so a
 * token add/patch/refresh updates the selection list without a page reload.
 * The replay preflight reads the same candles, so refreshing data must also
 * re-check the historical window.
 */
export function invalidateSandboxUniverseQueries(queryClient: QueryClient): Promise<void> {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: sandboxQueryKeys.tokens }),
    queryClient.invalidateQueries({ queryKey: sandboxQueryKeys.coverage }),
    queryClient.invalidateQueries({
      queryKey: [...sandboxQueryKeys.replayRoot, 'preflight'],
    }),
  ]).then(() => undefined);
}

/** Invalidates the whole replay prefix: list, detail, report and preflight. */
export function invalidateSandboxReplayQueries(queryClient: QueryClient): Promise<void> {
  return queryClient
    .invalidateQueries({ queryKey: sandboxQueryKeys.replayRoot })
    .then(() => undefined);
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

export function useSandboxTokenCandidates(enabled = true) {
  return useQuery({
    queryKey: sandboxQueryKeys.tokenCandidates,
    queryFn: fetchSandboxTokenCandidates,
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
 *
 * `placeholderData` keeps the previous tail visible while a refetch is in
 * flight, so a new event does not blank the dashboard cards for a frame.
 */
export function sandboxEventTailQueryOptions(input: {
  runId: string | null;
  live: boolean;
  eventCount: number | null;
  limit: number;
  fetchEvents: typeof fetchSandboxEvents;
}): UseQueryOptions<SandboxEventsResponse> {
  const afterSeq =
    input.eventCount === null ? null : sandboxTailEventsAfterSeq(input.eventCount, input.limit);
  return {
    queryKey: sandboxQueryKeys.eventTail(input.runId ?? 'none', input.limit, afterSeq),
    queryFn: () =>
      input.fetchEvents(input.runId as string, {
        afterSeq: afterSeq ?? undefined,
        limit: input.limit,
      }),
    enabled: input.runId !== null && input.eventCount !== null,
    refetchOnWindowFocus: false,
    refetchInterval: sandboxLiveRefetchInterval(input.live),
    placeholderData: (previous) => previous,
  };
}

export function useSandboxEventTail(
  runId: string | null,
  live: boolean,
  eventCount: number | null,
  limit = 200,
) {
  return useQuery(
    sandboxEventTailQueryOptions({
      runId,
      live,
      eventCount,
      limit,
      fetchEvents: fetchSandboxEvents,
    }),
  );
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

export function useSandboxReplays(options: SandboxReplayListOptions = {}, enabled = true) {
  const status = options.status;
  const includeArchived = options.includeArchived ?? false;
  const limit = options.limit ?? 50;
  const offset = options.offset ?? 0;

  return useQuery({
    queryKey: sandboxQueryKeys.replays(status ?? 'all', includeArchived, limit, offset),
    queryFn: () => fetchSandboxReplays({ status, includeArchived, limit, offset }),
    enabled,
    refetchOnWindowFocus: false,
    refetchInterval: (query) => sandboxReplayListRefetchInterval(query.state.data?.replays),
  });
}

export function useSandboxReplay(replayId: string | null, poll = true) {
  return useQuery({
    queryKey: sandboxQueryKeys.replay(replayId ?? 'none'),
    queryFn: () => fetchSandboxReplay(replayId as string),
    enabled: replayId !== null,
    refetchOnWindowFocus: false,
    refetchInterval: (query) =>
      poll ? sandboxReplayRefetchInterval(query.state.data?.status) : false,
  });
}

/**
 * Read-only coverage gate. The form asks with `allowPartial: true` so the
 * response shows the exact shortened window a confirmed run would use.
 */
export function useSandboxReplayPreflight(payload: SandboxReplayPreflightRequest | null) {
  return useQuery({
    queryKey: sandboxQueryKeys.replayPreflight(
      payload?.tokenKeys ?? [],
      payload?.periodDays ?? 0,
      payload?.allowPartial ?? false,
    ),
    queryFn: () => preflightSandboxReplay(payload as SandboxReplayPreflightRequest),
    enabled: payload !== null,
    staleTime: 30_000,
    retry: false,
    refetchOnWindowFocus: false,
  });
}

export function useSandboxReplayReport(replayId: string | null, enabled = true) {
  return useQuery({
    queryKey: sandboxQueryKeys.replayReport(replayId ?? 'none'),
    queryFn: () => fetchSandboxReplayReport(replayId as string),
    enabled: replayId !== null && enabled,
    retry: false,
    refetchOnWindowFocus: false,
  });
}

export function useSandboxReplayChart(replayId: string | null, enabled = true) {
  return useQuery({
    queryKey: sandboxQueryKeys.replayChart(replayId ?? 'none'),
    queryFn: () => fetchSandboxReplayChart(replayId as string),
    enabled: replayId !== null && enabled,
    retry: false,
    refetchOnWindowFocus: false,
  });
}

export function useSandboxReplayDecisions(
  replayId: string | null,
  tokenId: string | null,
  enabled = true,
) {
  return useInfiniteQuery({
    queryKey: sandboxQueryKeys.replayDecisions(replayId ?? 'none', tokenId),
    queryFn: ({ pageParam }) =>
      fetchSandboxReplayDecisions(replayId as string, {
        tokenId: tokenId ?? undefined,
        limit: 100,
        offset: pageParam,
      }),
    initialPageParam: 0,
    getNextPageParam: (last) =>
      last.offset + last.items.length < last.total ? last.offset + last.items.length : undefined,
    enabled: replayId !== null && enabled,
    retry: false,
    refetchOnWindowFocus: false,
  });
}

export function useCreateSandboxReplay() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: SandboxReplayCreateRequest) => createSandboxReplay(body),
    onSuccess: () => invalidateSandboxReplayQueries(queryClient),
  });
}

export function useCancelSandboxReplay() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (replayId: string) => cancelSandboxReplay(replayId),
    onSuccess: () => invalidateSandboxReplayQueries(queryClient),
  });
}

export function useArchiveSandboxReplay() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (replayId: string) => archiveSandboxReplay(replayId),
    onSuccess: () => invalidateSandboxReplayQueries(queryClient),
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

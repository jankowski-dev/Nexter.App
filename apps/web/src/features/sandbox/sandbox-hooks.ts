import {
  createSandboxRun,
  fetchSandboxCoverage,
  fetchSandboxRun,
  fetchSandboxRuns,
  fetchSandboxStatus,
  fetchSandboxTokens,
  runSandboxLifecycle,
  sandboxQueryKeys,
  updateSandboxRun,
  type SandboxLifecycleAction,
} from './sandbox-api';
import type { SandboxRunCreateRequest, SandboxRunUpdateRequest } from '@nexter/contracts';
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';

/** Invalidates every sandbox query after a mutation (list, detail and counts). */
export function invalidateSandboxQueries(queryClient: QueryClient): Promise<void> {
  return queryClient.invalidateQueries({ queryKey: sandboxQueryKeys.all }).then(() => undefined);
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

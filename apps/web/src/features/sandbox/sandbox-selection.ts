import type { SandboxRunStatus, SandboxRunSummary } from '@nexter/contracts';
import { SANDBOX_PATH, sandboxStatusLabels, type SandboxTab } from './sandbox-tabs';

/** Query parameter that keeps the selected run across tabs and reloads. */
export const SANDBOX_RUN_QUERY = 'run';

/**
 * Reads the selected run id from a location search string (`?run=<uuid>`).
 * An absent, blank or malformed value falls back to "no explicit selection" so
 * the page can pick the first active run itself.
 */
export function sandboxRunIdFromSearch(search: string | undefined): string | null {
  if (!search) return null;
  const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  const raw = params.get(SANDBOX_RUN_QUERY)?.trim();
  return raw ? raw : null;
}

/**
 * Canonical URL of a tab with an optional selected run. The tab stays in the
 * hash so the existing `#overview/#runs/#journal/#reports` deep links keep
 * working, while `?run=` keeps the run when the owner refreshes the page.
 */
export function sandboxUrlForSelection(tab: SandboxTab, runId: string | null): string {
  const search = runId ? `?${SANDBOX_RUN_QUERY}=${encodeURIComponent(runId)}` : '';
  return `${SANDBOX_PATH}${search}#${tab}`;
}

/** Runs that may be selected in a picker; archived runs stay read-only. */
export function sandboxSelectableRuns(runs: readonly SandboxRunSummary[]): SandboxRunSummary[] {
  return runs.filter((run) => run.archivedAt === null);
}

/**
 * Default selection for `Обзор` without an explicit `?run=`:
 * the first running run, otherwise the first paused run. Archived runs are
 * never picked automatically.
 */
export function sandboxDefaultRunId(runs: readonly SandboxRunSummary[]): string | null {
  const selectable = sandboxSelectableRuns(runs);
  return (
    selectable.find((run) => run.status === 'running')?.id ??
    selectable.find((run) => run.status === 'paused')?.id ??
    null
  );
}

/** Merges run lists (overview first) into one deduplicated list. */
export function sandboxMergeRuns(
  ...groups: ReadonlyArray<readonly SandboxRunSummary[]>
): SandboxRunSummary[] {
  const byId = new Map<string, SandboxRunSummary>();
  for (const group of groups) {
    for (const run of group) {
      if (!byId.has(run.id)) byId.set(run.id, run);
    }
  }
  return [...byId.values()];
}

export interface SandboxRunPickerOption {
  value: string;
  label: string;
  status: SandboxRunStatus;
  archived: boolean;
}

/**
 * Picker options over non-archived runs. The currently selected archived run is
 * kept as an extra read-only option so a deep link never renders a blank picker.
 */
export function sandboxRunPickerOptions(
  runs: readonly SandboxRunSummary[],
  selectedRunId: string | null,
): SandboxRunPickerOption[] {
  return runs
    .filter((run) => run.archivedAt === null || run.id === selectedRunId)
    .map((run) => ({
      value: run.id,
      label: `${run.name} · ${sandboxStatusLabels[run.status]}${run.archivedAt ? ' · Архив' : ''}`,
      status: run.status,
      archived: run.archivedAt !== null,
    }));
}

/** Finds the selected run in the merged list; null when it is unknown. */
export function sandboxSelectedRun(
  runs: readonly SandboxRunSummary[],
  runId: string | null,
): SandboxRunSummary | null {
  if (!runId) return null;
  return runs.find((run) => run.id === runId) ?? null;
}

import type { SandboxRunStatus, SandboxRunSummary } from '@nexter/contracts';
import { SANDBOX_PATH, sandboxStatusLabels, type SandboxTab } from './sandbox-tabs';

/** Query parameter that keeps the selected run across tabs and reloads. */
export const SANDBOX_RUN_QUERY = 'run';

const SANDBOX_RUN_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Reads the selected run id from a location search string (`?run=<uuid>`).
 * An absent, blank or malformed value falls back to "no explicit selection" so
 * the page never calls the API with an invalid id.
 */
export function sandboxRunIdFromSearch(search: string | undefined): string | null {
  if (!search) return null;
  const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  const raw = params.get(SANDBOX_RUN_QUERY)?.trim();
  return raw && SANDBOX_RUN_ID_PATTERN.test(raw) ? raw : null;
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
 * Default selection without an explicit `?run=`:
 * the first running run, otherwise the first paused run, otherwise the most
 * recently updated non-archived run. Archived runs are never picked
 * automatically.
 */
export function sandboxDefaultRunId(runs: readonly SandboxRunSummary[]): string | null {
  const selectable = sandboxSelectableRuns(runs);
  const running = selectable.find((run) => run.status === 'running');
  if (running) return running.id;
  const paused = selectable.find((run) => run.status === 'paused');
  if (paused) return paused.id;

  let latest: SandboxRunSummary | null = null;
  for (const run of selectable) {
    if (!latest || Date.parse(run.updatedAt) > Date.parse(latest.updatedAt)) latest = run;
  }
  return latest?.id ?? null;
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

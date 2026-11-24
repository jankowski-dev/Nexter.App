import { describe, expect, it } from 'vitest';
import {
  sandboxDefaultRunId,
  sandboxMergeRuns,
  sandboxRunIdFromSearch,
  sandboxRunPickerOptions,
  sandboxSelectableRuns,
  sandboxSelectedRun,
  sandboxUrlForSelection,
} from './sandbox-selection';
import { sandboxRunSummaryFixture } from './sandbox-test-fixtures';
import type { SandboxRunSummary } from '@nexter/contracts';

function run(overrides: Partial<SandboxRunSummary>): SandboxRunSummary {
  return sandboxRunSummaryFixture(overrides);
}

describe('sandbox run selection', () => {
  it('reads an explicit run from the query string', () => {
    expect(sandboxRunIdFromSearch('?run=abc-1')).toBe('abc-1');
    expect(sandboxRunIdFromSearch('run=abc-1')).toBe('abc-1');
    expect(sandboxRunIdFromSearch('?tab=journal&run=abc-2')).toBe('abc-2');
    expect(sandboxRunIdFromSearch('?run=%20%20')).toBeNull();
    expect(sandboxRunIdFromSearch('?run=')).toBeNull();
    expect(sandboxRunIdFromSearch(undefined)).toBeNull();
  });

  it('builds a canonical tab URL that keeps the run and the hash', () => {
    expect(sandboxUrlForSelection('overview', null)).toBe('/sandbox#overview');
    expect(sandboxUrlForSelection('journal', 'run-1')).toBe('/sandbox?run=run-1#journal');
    expect(sandboxUrlForSelection('reports', 'a b')).toBe('/sandbox?run=a%20b#reports');
  });

  it('defaults to the first running run, then the first paused run', () => {
    const runs = [
      run({ id: 'draft', status: 'draft' }),
      run({ id: 'paused', status: 'paused' }),
      run({ id: 'running', status: 'running' }),
    ];
    expect(sandboxDefaultRunId(runs)).toBe('running');
    expect(
      sandboxDefaultRunId([
        run({ id: 'draft', status: 'draft' }),
        run({ id: 'paused', status: 'paused' }),
      ]),
    ).toBe('paused');
    expect(sandboxDefaultRunId([run({ id: 'draft', status: 'draft' })])).toBeNull();
    expect(sandboxDefaultRunId([])).toBeNull();
  });

  it('never default-selects an archived run', () => {
    const runs = [
      run({ id: 'archived', status: 'running', archivedAt: '2026-11-24T01:00:00.000Z' }),
      run({ id: 'stopped', status: 'stopped' }),
    ];
    expect(sandboxDefaultRunId(runs)).toBeNull();
  });

  it('offers non-archived runs plus the selected archived run', () => {
    const runs = [
      run({ id: 'running', status: 'running' }),
      run({ id: 'archived', status: 'stopped', archivedAt: '2026-11-24T01:00:00.000Z' }),
    ];
    expect(sandboxRunPickerOptions(runs, null).map((option) => option.value)).toEqual(['running']);
    const withArchived = sandboxRunPickerOptions(runs, 'archived');
    expect(withArchived.map((option) => option.value)).toEqual(['running', 'archived']);
    expect(withArchived[1]?.label).toContain('Архив');
    expect(withArchived[0]?.label).toContain('Работает');
  });

  it('merges run lists without duplicates and keeps overview data first', () => {
    const merged = sandboxMergeRuns(
      [run({ id: 'a', status: 'running', equityUsd: '1010.00' })],
      [
        run({ id: 'a', status: 'paused', equityUsd: '1020.00' }),
        run({ id: 'b', status: 'stopped' }),
      ],
    );
    expect(merged.map((item) => item.id)).toEqual(['a', 'b']);
    expect(merged[0]?.status).toBe('running');
  });

  it('filters archived runs from selectable lists and finds the selected run', () => {
    const runs = [
      run({ id: 'visible' }),
      run({ id: 'archived', archivedAt: '2026-11-24T01:00:00.000Z' }),
    ];
    expect(sandboxSelectableRuns(runs).map((item) => item.id)).toEqual(['visible']);
    expect(sandboxSelectedRun(runs, 'archived')?.id).toBe('archived');
    expect(sandboxSelectedRun(runs, 'missing')).toBeNull();
    expect(sandboxSelectedRun(runs, null)).toBeNull();
  });
});

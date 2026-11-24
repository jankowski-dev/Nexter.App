import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { UseQueryResult } from '@tanstack/react-query';
import type { SandboxRunSummary, SandboxRunsResponse } from '@nexter/contracts';
import { ConfirmProvider } from '@/lib/confirm';

vi.mock('./sandbox-hooks', () => ({
  useSandboxRuns: vi.fn(),
  useSandboxLifecycle: vi.fn(),
}));

vi.mock('./sandbox-run-drawer', () => ({
  SandboxRunDrawer: () => null,
}));

import { SandboxRunsTab } from './sandbox-runs-tab';
import { useSandboxLifecycle, useSandboxRuns } from './sandbox-hooks';

const mockedRuns = vi.mocked(useSandboxRuns);
const mockedLifecycle = vi.mocked(useSandboxLifecycle);

const summary: SandboxRunSummary = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'Базовый 1h',
  status: 'draft',
  initialCapitalUsd: '1000.00',
  cashUsd: '1000.00',
  equityUsd: '1000.00',
  peakEquityUsd: '1000.00',
  returnPct: '0.00',
  drawdownPct: '0.0000',
  tokenCount: 1,
  lastBarClose: null,
  lastTickAt: null,
  startedAt: null,
  stoppedAt: null,
  archivedAt: null,
  error: null,
  createdAt: '2026-11-24T00:00:00.000Z',
  updatedAt: '2026-11-24T00:00:00.000Z',
};

function runsResult(
  state: Partial<UseQueryResult<SandboxRunsResponse, Error>>,
): UseQueryResult<SandboxRunsResponse, Error> {
  return {
    isPending: false,
    isError: false,
    data: { runs: [], total: 0, limit: 100, offset: 0 },
    error: null,
    refetch: vi.fn(),
    ...state,
  } as unknown as UseQueryResult<SandboxRunsResponse, Error>;
}

function renderTab(): string {
  return renderToStaticMarkup(
    <ConfirmProvider>
      <SandboxRunsTab />
    </ConfirmProvider>,
  );
}

beforeEach(() => {
  mockedLifecycle.mockReturnValue({
    isPending: false,
    variables: undefined,
    mutateAsync: vi.fn(),
  } as unknown as ReturnType<typeof useSandboxLifecycle>);
});

describe('sandbox runs tab', () => {
  it('shows a loading state while runs are fetched', () => {
    mockedRuns.mockReturnValue(runsResult({ isPending: true, data: undefined }));
    expect(renderTab()).toContain('Загрузка');
  });

  it('shows a Russian error state with retry', () => {
    mockedRuns.mockReturnValue(
      runsResult({
        isError: true,
        data: undefined,
        error: new Error('boom'),
      }),
    );
    const html = renderTab();
    expect(html).toContain('Ошибка');
    expect(html).toContain('Не удалось загрузить запуски песочницы');
    expect(html).toContain('Повторить');
  });

  it('shows the empty state with a create action', () => {
    mockedRuns.mockReturnValue(runsResult({}));
    const html = renderTab();
    expect(html).toContain('Запусков пока нет');
    expect(html).toContain('Новый запуск');
    expect(html).toContain('live-paper');
  });

  it('lists runs with lifecycle controls and no manual buy', () => {
    mockedRuns.mockReturnValue(
      runsResult({ data: { runs: [summary], total: 1, limit: 100, offset: 0 } }),
    );
    const html = renderTab();
    expect(html).toContain('Базовый 1h');
    expect(html).toContain('Черновик');
    expect(html).toContain('Изменить');
    expect(html).toContain('Запустить');
    expect(html).not.toContain('Купить');
    expect(html).not.toContain('Добавить');
  });
});

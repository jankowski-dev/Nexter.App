import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { UseQueryResult } from '@tanstack/react-query';
import type {
  SandboxEquityResponse,
  SandboxOverview,
  SandboxPositionsResponse,
  SandboxRunDetail,
} from '@nexter/contracts';
import { ConfirmProvider } from '@/lib/confirm';
import { formatUsd } from '@/lib/format';

vi.mock('./sandbox-hooks', () => ({
  useSandboxOverview: vi.fn(),
  useSandboxRunDetail: vi.fn(),
  useSandboxPositions: vi.fn(),
  useSandboxEquity: vi.fn(),
  useSandboxEvents: vi.fn(),
  useSandboxLifecycle: vi.fn(),
  useCloseSandboxTrade: vi.fn(),
}));

import { SandboxDashboard } from './sandbox-dashboard';
import {
  useCloseSandboxTrade,
  useSandboxEquity,
  useSandboxEvents,
  useSandboxLifecycle,
  useSandboxOverview,
  useSandboxPositions,
  useSandboxRunDetail,
} from './sandbox-hooks';
import {
  sandboxEventFixture,
  sandboxOverviewFixture,
  sandboxPositionFixture,
  sandboxRunDetailFixture,
  sandboxRunId,
  sandboxRunSummaryFixture,
} from './sandbox-test-fixtures';

const mockedOverview = vi.mocked(useSandboxOverview);
const mockedDetail = vi.mocked(useSandboxRunDetail);
const mockedPositions = vi.mocked(useSandboxPositions);
const mockedEquity = vi.mocked(useSandboxEquity);
const mockedEvents = vi.mocked(useSandboxEvents);
const mockedLifecycle = vi.mocked(useSandboxLifecycle);
const mockedClose = vi.mocked(useCloseSandboxTrade);

function queryResult<T>(data: T): UseQueryResult<T, Error> {
  return {
    isPending: false,
    isError: false,
    data,
    error: null,
    refetch: vi.fn(),
  } as unknown as UseQueryResult<T, Error>;
}

function eventsResult(events = [sandboxEventFixture()]): ReturnType<typeof useSandboxEvents> {
  return {
    isPending: false,
    isError: false,
    error: null,
    data: { pages: [{ events, hasMore: false, nextAfterSeq: null }], pageParams: [null] },
    hasNextPage: false,
    isFetchingNextPage: false,
    fetchNextPage: vi.fn(),
    refetch: vi.fn(),
  } as unknown as ReturnType<typeof useSandboxEvents>;
}

function renderDashboard(
  options: {
    selectedRunId?: string | null;
    runs?: ReturnType<typeof sandboxRunSummaryFixture>[];
  } = {},
): string {
  return renderToStaticMarkup(
    <ConfirmProvider>
      <SandboxDashboard
        runs={options.runs ?? [sandboxRunSummaryFixture()]}
        selectedRunId={options.selectedRunId === undefined ? sandboxRunId : options.selectedRunId}
        onSelectRun={() => undefined}
        onChangeTab={() => undefined}
      />
    </ConfirmProvider>,
  );
}

beforeEach(() => {
  mockedOverview.mockReturnValue(queryResult<SandboxOverview>(sandboxOverviewFixture()));
  mockedDetail.mockReturnValue(queryResult<SandboxRunDetail>(sandboxRunDetailFixture()));
  mockedPositions.mockReturnValue(
    queryResult<SandboxPositionsResponse>({ positions: [sandboxPositionFixture()] }),
  );
  mockedEquity.mockReturnValue(
    queryResult<SandboxEquityResponse>({
      points: [
        {
          clockTime: '2026-11-24T00:00:00.000Z',
          equityUsd: '1000.00',
          cashUsd: '1000.00',
          positionsValueUsd: '0.00',
          drawdownPct: '0.0000',
        },
        {
          clockTime: '2026-11-24T01:00:00.000Z',
          equityUsd: '1042.00',
          cashUsd: '400.00',
          positionsValueUsd: '642.00',
          drawdownPct: '3.5185',
        },
      ],
      total: 2,
      limit: 500,
      offset: 0,
    }),
  );
  mockedEvents.mockReturnValue(eventsResult());
  mockedLifecycle.mockReturnValue({
    isPending: false,
    variables: undefined,
    mutateAsync: vi.fn(),
  } as unknown as ReturnType<typeof useSandboxLifecycle>);
  mockedClose.mockReturnValue({
    isPending: false,
    variables: undefined,
    mutateAsync: vi.fn(),
  } as unknown as ReturnType<typeof useCloseSandboxTrade>);
});

describe('sandbox dashboard', () => {
  it('renders the run summary, equity chart, position and last decision', () => {
    const html = renderDashboard();
    expect(html).toContain('Базовый 1h');
    expect(html).toContain('Работает');
    expect(html).toContain(formatUsd('1042.00'));
    expect(html).toContain('+4,20%');
    expect(html).toContain('3,52%');
    expect(html).toContain(formatUsd('400.00'));
    expect(html).toContain('Кривая капитала');
    expect(html).toContain('Точек: 2 из 2');
    expect(html).toContain('AAA');
    expect(html).toContain('Закрыть сделку');
    expect(html).toContain('Проверки риска пройдены.');
    expect(html).toContain('Последнее решение');
    expect(html).toContain('Альтернатив: 1');
    expect(html).toContain('Восходящий тренд');
  });

  it('offers the close action only while the run is running', () => {
    const running = renderDashboard();
    expect(running).toContain('Закрыть сделку');
    expect(running).not.toContain('Закрытие доступно только у работающего запуска.');

    mockedDetail.mockReturnValue(
      queryResult<SandboxRunDetail>(
        sandboxRunDetailFixture({
          status: 'paused',
          equityUsd: '1042.00',
        }),
      ),
    );
    const paused = renderDashboard();
    expect(paused).toContain('Пауза');
    expect(paused).toContain('Закрытие доступно только у работающего запуска.');
    expect(paused).not.toContain('Закрыть сделку');
  });

  it('renders lifecycle controls and the run picker without manual buying', () => {
    const html = renderDashboard({
      runs: [
        sandboxRunSummaryFixture({ id: 'run-a', name: 'Первый', status: 'running' }),
        sandboxRunSummaryFixture({ id: 'run-b', name: 'Второй', status: 'paused' }),
      ],
      selectedRunId: 'run-a',
    });
    expect(html).toContain('Первый · Работает');
    expect(html).toContain('Второй · Пауза');
    expect(html).toContain('Пауза');
    expect(html).toContain('Остановить');
    expect(html).not.toContain('Купить');
    expect(html).not.toContain('Добавить');
    expect(html).not.toContain('Пополнить');
    expect(html).not.toContain('Переопределить');
  });

  it('shows an empty state without a selected run', () => {
    mockedDetail.mockReturnValue({
      isPending: false,
      isError: false,
      data: undefined,
      error: null,
      refetch: vi.fn(),
    } as unknown as UseQueryResult<SandboxRunDetail, Error>);
    const html = renderDashboard({ selectedRunId: null });
    expect(html).toContain('Нет выбранного запуска');
    expect(html).toContain('Перейти к запускам');
  });

  it('shows the failed-run error but keeps the journal readable', () => {
    mockedDetail.mockReturnValue(
      queryResult<SandboxRunDetail>(
        sandboxRunDetailFixture({
          status: 'failed',
          error: 'Ревизия не прошла сверку',
          archivedAt: null,
        }),
      ),
    );
    const html = renderDashboard();
    expect(html).toContain('Ревизия не прошла сверку');
    expect(html).toContain('Последнее решение');
  });

  it('shows loading and error states for the run detail', () => {
    mockedDetail.mockReturnValue({
      isPending: true,
      isError: false,
      data: undefined,
      error: null,
      refetch: vi.fn(),
    } as unknown as UseQueryResult<SandboxRunDetail, Error>);
    expect(renderDashboard()).toContain('Загрузка');

    mockedDetail.mockReturnValue({
      isPending: false,
      isError: true,
      data: undefined,
      error: new Error('boom'),
      refetch: vi.fn(),
    } as unknown as UseQueryResult<SandboxRunDetail, Error>);
    const html = renderDashboard();
    expect(html).toContain('Не удалось загрузить запуск песочницы');
    expect(html).toContain('Повторить');
  });

  it('shows the empty equity and position states', () => {
    mockedPositions.mockReturnValue(queryResult<SandboxPositionsResponse>({ positions: [] }));
    mockedEquity.mockReturnValue(
      queryResult<SandboxEquityResponse>({ points: [], total: 0, limit: 500, offset: 0 }),
    );
    mockedEvents.mockReturnValue(eventsResult([]));
    const html = renderDashboard();
    expect(html).toContain('Точек equity пока нет');
    expect(html).toContain('Открытых позиций нет');
    expect(html).toContain('Решений пока нет');
  });

  it('marks an archived run read-only', () => {
    mockedDetail.mockReturnValue(
      queryResult<SandboxRunDetail>(
        sandboxRunDetailFixture({
          status: 'running',
          archivedAt: '2026-11-24T06:00:00.000Z',
        }),
      ),
    );
    const html = renderDashboard();
    expect(html).toContain('Архив');
    expect(html).toContain('доступен только просмотр');
    expect(html).not.toContain('Закрыть сделку');
    expect(html).not.toContain('Остановить');
  });
});

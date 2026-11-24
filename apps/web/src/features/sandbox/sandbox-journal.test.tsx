import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { UseQueryResult } from '@tanstack/react-query';
import type {
  SandboxIntentsResponse,
  SandboxRunDetail,
  SandboxTradesResponse,
} from '@nexter/contracts';

vi.mock('./sandbox-hooks', () => ({
  useSandboxRunDetail: vi.fn(),
  useSandboxEvents: vi.fn(),
  useSandboxIntents: vi.fn(),
  useSandboxTrades: vi.fn(),
}));

import { SandboxJournal } from './sandbox-journal';
import {
  useSandboxEvents,
  useSandboxIntents,
  useSandboxRunDetail,
  useSandboxTrades,
} from './sandbox-hooks';
import {
  sandboxEventFixture,
  sandboxIntentFixture,
  sandboxRunDetailFixture,
  sandboxRunId,
  sandboxRunSummaryFixture,
  sandboxTradeFixture,
} from './sandbox-test-fixtures';

const mockedDetail = vi.mocked(useSandboxRunDetail);
const mockedEvents = vi.mocked(useSandboxEvents);
const mockedIntents = vi.mocked(useSandboxIntents);
const mockedTrades = vi.mocked(useSandboxTrades);

function queryResult<T>(data: T): UseQueryResult<T, Error> {
  return {
    isPending: false,
    isError: false,
    data,
    error: null,
    refetch: vi.fn(),
    isFetching: false,
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

function renderJournal(
  selectedRunId: string | null = sandboxRunId,
  options: {
    selectionPending?: boolean;
    initialSection?: 'events' | 'intents' | 'trades' | 'risk';
    initialIntentFilters?: {
      status: 'all' | 'pending' | 'filled' | 'partial' | 'rejected' | 'expired';
      side: 'all' | 'buy' | 'sell';
      tokenId: string | null;
    };
    initialTradeStatus?: 'all' | 'open' | 'closed';
  } = {},
): string {
  return renderToStaticMarkup(
    <SandboxJournal
      runs={[sandboxRunSummaryFixture()]}
      selectedRunId={selectedRunId}
      onSelectRun={() => undefined}
      onChangeTab={() => undefined}
      selectionPending={options.selectionPending}
      initialSection={options.initialSection}
      initialIntentFilters={options.initialIntentFilters}
      initialTradeStatus={options.initialTradeStatus}
    />,
  );
}

beforeEach(() => {
  mockedDetail.mockReturnValue(queryResult<SandboxRunDetail>(sandboxRunDetailFixture()));
  mockedEvents.mockReturnValue(eventsResult());
  mockedIntents.mockReturnValue(
    queryResult<SandboxIntentsResponse>({
      intents: [sandboxIntentFixture()],
      total: 1,
      limit: 50,
      offset: 0,
    }),
  );
  mockedTrades.mockReturnValue(
    queryResult<SandboxTradesResponse>({
      trades: [sandboxTradeFixture()],
      total: 1,
      limit: 50,
      offset: 0,
    }),
  );
});

describe('sandbox journal', () => {
  it('renders the event chain evidence and the events block', () => {
    const html = renderJournal();
    expect(html).toContain('События');
    expect(html).toContain('Интенты');
    expect(html).toContain('Сделки');
    expect(html).toContain('Проверки риска');
    expect(html).toContain('Хеш цепочки');
    expect(html).toContain('a'.repeat(64));
    expect(html).toContain('#1');
    expect(html).toContain('risk.passed');
    expect(html).toContain('Почему не (альтернативы)');
    expect(html).toContain('Альтернатива с меньшим приоритетом.');
    expect(html).toContain('seq 1');
    expect(html).toContain('Проверка');
    expect(html).toContain('Не пройдено');
  });

  it('explains that filters apply to the loaded page', () => {
    const html = renderJournal();
    expect(html).toContain('Фильтры применяются к загруженным событиям');
    expect(html).toContain('показано 1 из 1');
    expect(html).toContain('Тип события');
  });

  it('shows loading, error and empty states for events', () => {
    mockedEvents.mockReturnValue({
      isPending: true,
      isError: false,
      error: null,
      data: undefined,
      refetch: vi.fn(),
      hasNextPage: false,
      fetchNextPage: vi.fn(),
      isFetchingNextPage: false,
    } as unknown as ReturnType<typeof useSandboxEvents>);
    expect(renderJournal()).toContain('Загрузка');

    mockedEvents.mockReturnValue({
      isPending: false,
      isError: true,
      error: new Error('boom'),
      data: undefined,
      refetch: vi.fn(),
      hasNextPage: false,
      fetchNextPage: vi.fn(),
      isFetchingNextPage: false,
    } as unknown as ReturnType<typeof useSandboxEvents>);
    const error = renderJournal();
    expect(error).toContain('Не удалось загрузить события');
    expect(error).toContain('Повторить');

    mockedEvents.mockReturnValue(eventsResult([]));
    expect(renderJournal()).toContain('Событий пока нет');
  });

  it('keeps the journal readable for a failed run', () => {
    mockedDetail.mockReturnValue(
      queryResult<SandboxRunDetail>(
        sandboxRunDetailFixture({ status: 'failed', error: 'Сверка не прошла' }),
      ),
    );
    const html = renderJournal();
    expect(html).toContain('Сверка не прошла');
    expect(html).toContain('risk.passed');
  });

  it('shows an empty state without a selected run', () => {
    const html = renderJournal(null);
    expect(html).toContain('Нет выбранного запуска');
    expect(html).toContain('Перейти к запускам');
  });

  it('does not flash the empty state while the default run is resolving', () => {
    const html = renderJournal(null, { selectionPending: true });
    expect(html).toContain('Загрузка');
    expect(html).not.toContain('Нет выбранного запуска');
  });

  it('renders the intents section with a loaded-page filter caveat', () => {
    const html = renderJournal(sandboxRunId, {
      initialSection: 'intents',
      initialIntentFilters: { status: 'filled', side: 'all', tokenId: null },
    });
    expect(html).toContain('Фильтр интентов по статусу');
    expect(html).toContain('Фильтры применяются к загруженной странице');
    expect(html).toContain('показано 1 из 1 загруженных');
    expect(html).not.toContain('1–1 из 1');
  });

  it('renders the trades section with its filter and loaded-page caveat', () => {
    const html = renderJournal(sandboxRunId, {
      initialSection: 'trades',
      initialTradeStatus: 'closed',
    });
    expect(html).toContain('Фильтр сделок');
    expect(html).toContain('Фильтры применяются к загруженной странице');
    expect(html).toContain('показано 1 из 1 загруженных');
    expect(html).toContain('Закрыта');
  });

  it('renders the risk-check section with expanded evidence', () => {
    const html = renderJournal(sandboxRunId, { initialSection: 'risk' });
    expect(html).toContain('Проверки риска');
    expect(html).toContain('Проверка');
    expect(html).toContain('Не пройдено');
    expect(html).toContain('из загруженной части журнала');
  });

  it('offers a load-more control for older risk checks', () => {
    mockedEvents.mockReturnValue({
      isPending: false,
      isError: false,
      error: null,
      data: {
        pages: [{ events: [sandboxEventFixture()], hasMore: true, nextAfterSeq: 1 }],
        pageParams: [null],
      },
      hasNextPage: true,
      isFetchingNextPage: false,
      fetchNextPage: vi.fn(),
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof useSandboxEvents>);
    const html = renderJournal(sandboxRunId, { initialSection: 'risk' });
    expect(html).toContain('Загрузить ещё');
  });

  it('polls intents and trades only for a running run', () => {
    renderJournal();
    expect(mockedIntents).toHaveBeenCalledWith(sandboxRunId, 50, 0, true);
    expect(mockedTrades).toHaveBeenCalledWith(sandboxRunId, 50, 0, true);

    mockedDetail.mockReturnValue(
      queryResult<SandboxRunDetail>(sandboxRunDetailFixture({ status: 'stopped' })),
    );
    renderJournal();
    expect(mockedIntents).toHaveBeenLastCalledWith(sandboxRunId, 50, 0, false);
    expect(mockedTrades).toHaveBeenLastCalledWith(sandboxRunId, 50, 0, false);
  });

  it('appends multi-page events without duplicates', () => {
    mockedEvents.mockReturnValue({
      isPending: false,
      isError: false,
      error: null,
      data: {
        pages: [
          { events: [sandboxEventFixture({ seq: 1 })], hasMore: true, nextAfterSeq: 1 },
          {
            events: [
              sandboxEventFixture({ seq: 1 }),
              sandboxEventFixture({ seq: 2 }),
              sandboxEventFixture({ seq: 3 }),
            ],
            hasMore: false,
            nextAfterSeq: 3,
          },
        ],
        pageParams: [null, 1],
      },
      hasNextPage: false,
      isFetchingNextPage: false,
      fetchNextPage: vi.fn(),
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof useSandboxEvents>);
    const html = renderJournal();
    expect(html).toContain('Загружено 3; это весь журнал.');
  });

  it('never offers manual trading actions', () => {
    const html = renderJournal();
    expect(html).not.toContain('Купить');
    expect(html).not.toContain('Добавить');
    expect(html).not.toContain('Пополнить');
  });
});

import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { UseQueryResult } from '@tanstack/react-query';
import type { SandboxReplayDetail, SandboxReplayReportResponse } from '@nexter/contracts';

vi.mock('./sandbox-hooks', () => ({
  useSandboxReplay: vi.fn(),
  useSandboxReplayReport: vi.fn(),
}));

import { SandboxReplayDetail as SandboxReplayDetailView } from './sandbox-replay-detail';
import { useSandboxReplay, useSandboxReplayReport } from './sandbox-hooks';
import {
  sandboxReplayDetailFixture,
  sandboxReplayId,
  sandboxReplayReportResponseFixture,
  sandboxTokenId,
} from './sandbox-test-fixtures';

const mockedReplay = vi.mocked(useSandboxReplay);
const mockedReport = vi.mocked(useSandboxReplayReport);

function replayResult(
  state: Partial<UseQueryResult<SandboxReplayDetail, Error>>,
): UseQueryResult<SandboxReplayDetail, Error> {
  return {
    isPending: false,
    isError: false,
    data: undefined,
    error: null,
    refetch: vi.fn(),
    ...state,
  } as unknown as UseQueryResult<SandboxReplayDetail, Error>;
}

function reportResult(
  state: Partial<UseQueryResult<SandboxReplayReportResponse, Error>>,
): UseQueryResult<SandboxReplayReportResponse, Error> {
  return {
    isPending: false,
    isError: false,
    data: undefined,
    error: null,
    refetch: vi.fn(),
    ...state,
  } as unknown as UseQueryResult<SandboxReplayReportResponse, Error>;
}

function renderDetail(): string {
  return renderToStaticMarkup(
    <SandboxReplayDetailView
      replayId={sandboxReplayId}
      onClose={vi.fn()}
      onArchive={vi.fn()}
      onCancel={vi.fn()}
      busy={false}
      symbolByKey={new Map([[sandboxTokenId, 'AAA']])}
    />,
  );
}

beforeEach(() => {
  mockedReport.mockReturnValue(reportResult({ isPending: false, data: undefined }));
});

describe('sandbox replay detail', () => {
  it('shows a loading state while the replay is fetched', () => {
    mockedReplay.mockReturnValue(replayResult({ isPending: true }));
    expect(renderDetail()).toContain('Загрузка');
  });

  it('shows a Russian error with retry', () => {
    mockedReplay.mockReturnValue(
      replayResult({ isError: true, error: new Error('boom'), data: undefined }),
    );
    const html = renderDetail();
    expect(html).toContain('Ошибка');
    expect(html).toContain('Не удалось загрузить прогон песочницы');
    expect(html).toContain('Повторить');
  });

  it('shows queued progress and cancel, without report data', () => {
    mockedReplay.mockReturnValue(
      replayResult({
        data: sandboxReplayDetailFixture({
          status: 'queued',
          startedAt: null,
          finishedAt: null,
          finalEquityUsd: null,
          returnPct: null,
          maxDrawdownPct: null,
        }),
      }),
    );
    const html = renderDetail();
    expect(html).toContain('В очереди');
    expect(html).toContain('Прогон ещё не завершён');
    expect(html).toContain('Отменить');
    expect(html).not.toContain('Скачать JSON');
    expect(html).not.toContain('Купить');
    expect(html).not.toContain('Добавить');
  });

  it('shows running progress with elapsed time', () => {
    mockedReplay.mockReturnValue(
      replayResult({
        data: sandboxReplayDetailFixture({
          status: 'running',
          finishedAt: null,
          finalEquityUsd: null,
          returnPct: null,
          maxDrawdownPct: null,
        }),
      }),
    );
    const html = renderDetail();
    expect(html).toContain('Выполняется');
    expect(html).toContain('Идёт расчёт');
  });

  it('renders completed metrics, equity, trades, intents, counterfactuals and identity', () => {
    mockedReplay.mockReturnValue(
      replayResult({ data: sandboxReplayDetailFixture({ status: 'completed' }) }),
    );
    mockedReport.mockReturnValue(reportResult({ data: sandboxReplayReportResponseFixture() }));

    const html = renderDetail();
    expect(html).toContain('Итоговый капитал');
    expect(html).toContain('+4,20%');
    expect(html).toContain('Кривая капитала');
    expect(html).toContain('Сделки');
    expect(html).toContain('Журнал интентов');
    expect(html).toContain('RISK_PASSED');
    expect(html).toContain('Контрфактические');
    expect(html).toContain('Упущенная возможность');
    expect(html).toContain('Ретроспектива');
    expect(html).toContain('Historical-paper replay');
    expect(html).toContain('d'.repeat(64));
    expect(html).toContain('e'.repeat(64));
    expect(html).toContain('snapshot-replay-1');
    expect(html).toContain('Скачать JSON');
    expect(html).toContain('Скачать Markdown');
    expect(html).toContain('В архив');
    expect(html).not.toContain('Купить');
    expect(html).not.toContain('Добавить');
  });

  it('shows a report loading state for a completed replay', () => {
    mockedReplay.mockReturnValue(
      replayResult({ data: sandboxReplayDetailFixture({ status: 'completed' }) }),
    );
    mockedReport.mockReturnValue(reportResult({ isPending: true }));
    expect(renderDetail()).toContain('Загрузка');
  });

  it('shows a report error with retry for a completed replay', () => {
    mockedReplay.mockReturnValue(
      replayResult({ data: sandboxReplayDetailFixture({ status: 'completed' }) }),
    );
    mockedReport.mockReturnValue(
      reportResult({ isError: true, error: new Error('boom'), data: undefined }),
    );
    const html = renderDetail();
    expect(html).toContain('Не удалось загрузить отчёт прогона');
    expect(html).toContain('Повторить');
  });

  it('shows the failed error and archive action', () => {
    mockedReplay.mockReturnValue(
      replayResult({
        data: sandboxReplayDetailFixture({
          status: 'failed',
          error: 'Не удалось прочитать сохранённые свечи',
          finalEquityUsd: null,
          returnPct: null,
          maxDrawdownPct: null,
        }),
      }),
    );
    const html = renderDetail();
    expect(html).toContain('Не удалось прочитать сохранённые свечи');
    expect(html).toContain('В архив');
    expect(html).not.toContain('Скачать JSON');
  });

  it('shows the cancelled state and its archive action', () => {
    mockedReplay.mockReturnValue(
      replayResult({
        data: sandboxReplayDetailFixture({
          status: 'cancelled',
          finalEquityUsd: null,
          returnPct: null,
          maxDrawdownPct: null,
        }),
      }),
    );
    const html = renderDetail();
    expect(html).toContain('Прогон отменён');
    expect(html).toContain('В архив');
  });

  it('does not offer archive again for an archived replay', () => {
    mockedReplay.mockReturnValue(
      replayResult({
        data: sandboxReplayDetailFixture({
          status: 'completed',
          archivedAt: '2026-11-24T03:00:00.000Z',
        }),
      }),
    );
    mockedReport.mockReturnValue(reportResult({ data: sandboxReplayReportResponseFixture() }));
    const html = renderDetail();
    expect(html).toContain('Архив');
    expect(html).not.toContain('В архив');
  });
});

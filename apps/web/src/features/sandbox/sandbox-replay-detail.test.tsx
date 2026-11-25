import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { UseQueryResult } from '@tanstack/react-query';
import type { SandboxReplayDetail, SandboxReplayReportResponse } from '@nexter/contracts';

vi.mock('./sandbox-hooks', () => ({
  useSandboxReplay: vi.fn(),
  useSandboxReplayReport: vi.fn(),
  useSandboxReplayChart: vi.fn(),
  useSandboxReplayDecisions: vi.fn(),
}));

import { SandboxReplayDetail as SandboxReplayDetailView } from './sandbox-replay-detail';
import {
  useSandboxReplay,
  useSandboxReplayChart,
  useSandboxReplayDecisions,
  useSandboxReplayReport,
} from './sandbox-hooks';
import {
  sandboxReplayDetailFixture,
  sandboxReplayId,
  sandboxReplayReportResponseFixture,
  sandboxTokenId,
} from './sandbox-test-fixtures';

const mockedReplay = vi.mocked(useSandboxReplay);
const mockedReport = vi.mocked(useSandboxReplayReport);
const mockedChart = vi.mocked(useSandboxReplayChart);
const mockedDecisions = vi.mocked(useSandboxReplayDecisions);

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
  mockedChart.mockReturnValue({
    isPending: false,
    isError: false,
    data: {
      replayId: sandboxReplayId,
      tokens: [
        {
          tokenId: sandboxTokenId,
          candles: [
            {
              time: Date.parse('2026-11-24T00:00:00.000Z'),
              openUsd: '4.00',
              highUsd: '4.30',
              lowUsd: '3.90',
              closeUsd: '4.20',
            },
          ],
        },
      ],
      actions: [
        {
          id: 'buy-1',
          tokenId: sandboxTokenId,
          time: Date.parse('2026-11-24T00:00:00.000Z'),
          kind: 'buy',
          priceUsd: '4.20',
          amountUsd: '100.00',
          pnlUsd: null,
          reasonCode: 'TREND_PULLBACK_ENTRY',
          reasonText: 'Вход на откате',
          intentId: 'buy-1',
          tradeId: 'trade-1',
        },
      ],
      note: 'Показаны только свечи окна оценки.',
    },
    error: null,
    refetch: vi.fn(),
  } as never);
  mockedDecisions.mockReturnValue({
    isPending: false,
    isError: false,
    data: { pages: [{ items: [], total: 0, limit: 100, offset: 0 }], pageParams: [0] },
    hasNextPage: false,
    isFetchingNextPage: false,
    refetch: vi.fn(),
  } as never);
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
    expect(html).toContain('Карта действий');
    expect(html).toContain('TREND_PULLBACK_ENTRY');
    expect(html).toContain('Итоговый капитал');
    expect(html).toContain('+4,20%');
    expect(html).toContain('Кривая капитала');
    expect(html).toContain('Сделки');
    expect(html).toContain('Журнал интентов');
    expect(html).toContain('RISK_PASSED');
    expect(html).toContain('Контрфактические');
    expect(html).toContain('Упущенная возможность');
    expect(html).toContain('Ретроспектива');
    expect(html).toContain('Скачать JSON');
    expect(html).toContain('Скачать PDF');
    expect(html).toContain('В архив');
    expect(html).not.toContain('Скачать Markdown');
    expect(html).not.toContain('reportHash:');
    expect(html).not.toContain('eventHash:');
    expect(html).not.toContain('dataSnapshotId:');
    expect(html).not.toContain('candleSnapshotHash:');
    expect(html).not.toContain('configVersion:');
    expect(html).not.toContain('settingsVersion:');
    expect(html).not.toContain('seed:');
    expect(html).not.toContain('full hash-chained event journal');
    expect(html).not.toContain('Купить');
    expect(html).not.toContain('Добавить');
    expect(html.indexOf('Карта действий')).toBeLessThan(html.indexOf('Итоговый капитал'));
    expect(html).not.toContain('xl:grid-cols-2');
  });

  it('limits long journals to 20 rows and offers Ещё', () => {
    mockedReplay.mockReturnValue(
      replayResult({ data: sandboxReplayDetailFixture({ status: 'completed' }) }),
    );
    const base = sandboxReplayReportResponseFixture();
    const trade = base.report.trades[0];
    const counterfactual = base.report.counterfactuals[0];
    if (!trade || !counterfactual) throw new Error('fixture is missing report rows');
    mockedReport.mockReturnValue(
      reportResult({
        data: {
          ...base,
          report: {
            ...base.report,
            trades: Array.from({ length: 25 }, (_, index) => ({
              ...trade,
              tradeId: `trade-${index}`,
            })),
            counterfactuals: Array.from({ length: 25 }, (_, index) => ({
              ...counterfactual,
              decisionTime: counterfactual.decisionTime + index,
            })),
          },
        },
      }),
    );

    const html = renderDetail();
    expect((html.match(/Ещё/g) ?? []).length).toBeGreaterThanOrEqual(2);
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

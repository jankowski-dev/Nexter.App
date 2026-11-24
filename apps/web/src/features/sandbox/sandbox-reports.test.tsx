import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { UseQueryResult } from '@tanstack/react-query';
import type { SandboxReportResponse, SandboxRunDetail } from '@nexter/contracts';
import { ApiError } from '@/lib/api';

vi.mock('./sandbox-hooks', () => ({
  useSandboxReport: vi.fn(),
  useSandboxRunDetail: vi.fn(),
}));

import { SandboxReports } from './sandbox-reports';
import { useSandboxReport, useSandboxRunDetail } from './sandbox-hooks';
import {
  sandboxReportResponseFixture,
  sandboxRunDetailFixture,
  sandboxRunId,
  sandboxRunSummaryFixture,
} from './sandbox-test-fixtures';

const mockedReport = vi.mocked(useSandboxReport);
const mockedDetail = vi.mocked(useSandboxRunDetail);

function reportResult(
  state: Partial<UseQueryResult<SandboxReportResponse, Error>>,
): UseQueryResult<SandboxReportResponse, Error> {
  return {
    isPending: false,
    isError: false,
    data: sandboxReportResponseFixture(),
    error: null,
    refetch: vi.fn(),
    ...state,
  } as unknown as UseQueryResult<SandboxReportResponse, Error>;
}

function renderReports(
  selectedRunId: string | null = sandboxRunId,
  selectionPending = false,
): string {
  return renderToStaticMarkup(
    <SandboxReports
      runs={[sandboxRunSummaryFixture()]}
      selectedRunId={selectedRunId}
      onSelectRun={() => undefined}
      onChangeTab={() => undefined}
      selectionPending={selectionPending}
    />,
  );
}

beforeEach(() => {
  mockedReport.mockReturnValue(reportResult({}));
  mockedDetail.mockReturnValue({
    isPending: false,
    isError: false,
    data: sandboxRunDetailFixture(),
    error: null,
    refetch: vi.fn(),
  } as unknown as UseQueryResult<SandboxRunDetail, Error>);
});

describe('sandbox reports', () => {
  it('renders the live-paper report identity, summary and tables', () => {
    const html = renderReports();
    expect(html).toContain('Отчёт запуска');
    expect(html).toContain('live-paper');
    expect(html).toContain('Сверка пройдена');
    expect(html).toContain(sandboxRunId);
    expect(html).toContain('5 бар.');
    expect(html).toContain('Ожидающих интентов: 1');
    expect(html).toContain('configVersion');
    expect(html).toContain('config-1');
    expect(html).toContain('dataSnapshotId');
    expect(html).toContain('snapshot-1');
    expect(html).toContain('settingsVersion');
    expect(html).toContain('settings-1');
    expect(html).toContain('a'.repeat(64));
    expect(html).toContain('d'.repeat(64));
    expect(html).toContain('Начальный капитал');
    expect(html).toContain('Итоговый капитал');
    expect(html).toContain('+4,20%');
    expect(html).toContain('Максимальная просадка');
    expect(html).toContain('Win rate');
    expect(html).toContain('Кривая капитала');
    expect(html).toContain('По стратегиям');
    expect(html).toContain('Откат в тренде');
    expect(html).toContain('AAA');
    expect(html).toContain('Позиции отчёта');
    expect(html).toContain('Сделки отчёта');
    expect(html).toContain('Журнал интентов');
    expect(html).toContain('TREND_PULLBACK_TRAIL');
    expect(html).toContain('pending intent(s) are excluded');
    expect(html).toContain('50,00%');
    expect(html).not.toContain('+50,00%');
    expect(html).toContain('Скачать JSON');
    expect(html).toContain('Скачать Markdown');
    expect(mockedDetail).toHaveBeenCalledWith(sandboxRunId, false);
  });

  it('shows the typed not-ready message for a 409 report', () => {
    mockedReport.mockReturnValue(
      reportResult({
        isError: true,
        data: undefined,
        error: new ApiError('SANDBOX_REPORT_NOT_READY', 'Conflict'),
      }),
    );
    const html = renderReports();
    expect(html).toContain('Отчёт пока недоступен');
    expect(html).toContain('Повторить');
    expect(html).not.toContain('Скачать JSON');
  });

  it('shows loading and empty selection states', () => {
    mockedReport.mockReturnValue(reportResult({ isPending: true, data: undefined }));
    expect(renderReports()).toContain('Загрузка');

    mockedReport.mockReturnValue(reportResult({}));
    const empty = renderReports(null);
    expect(empty).toContain('Нет выбранного запуска');
    expect(empty).toContain('Перейти к запускам');

    const pending = renderReports(null, true);
    expect(pending).toContain('Загрузка');
    expect(pending).not.toContain('Нет выбранного запуска');
  });

  it('renders an empty report without crashing', () => {
    const fixture = sandboxReportResponseFixture();
    mockedReport.mockReturnValue(
      reportResult({
        data: {
          ...fixture,
          report: {
            ...fixture.report,
            equityCurve: [],
            positions: [],
            trades: [],
            intentJournal: [],
            metrics: {
              ...fixture.report.metrics,
              perStrategy: [],
              perToken: [],
            },
          },
        },
      }),
    );
    const html = renderReports();
    expect(html).toContain('Точек equity в отчёте нет');
    expect(html).toContain('Открытых позиций нет');
    expect(html).toContain('Сделок нет');
    expect(html).toContain('Терминальных интентов нет');
  });

  it('never offers manual trading actions', () => {
    const html = renderReports();
    expect(html).not.toContain('Купить');
    expect(html).not.toContain('Добавить');
    expect(html).not.toContain('Пополнить');
  });
});

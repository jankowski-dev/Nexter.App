import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { UseQueryResult } from '@tanstack/react-query';
import type { SandboxReportResponse } from '@nexter/contracts';
import { ApiError } from '@/lib/api';

vi.mock('./sandbox-hooks', () => ({
  useSandboxReport: vi.fn(),
}));

import { SandboxReports } from './sandbox-reports';
import { useSandboxReport } from './sandbox-hooks';
import {
  sandboxReportResponseFixture,
  sandboxRunId,
  sandboxRunSummaryFixture,
} from './sandbox-test-fixtures';

const mockedReport = vi.mocked(useSandboxReport);

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

function renderReports(selectedRunId: string | null = sandboxRunId): string {
  return renderToStaticMarkup(
    <SandboxReports
      runs={[sandboxRunSummaryFixture()]}
      selectedRunId={selectedRunId}
      onSelectRun={() => undefined}
      onChangeTab={() => undefined}
    />,
  );
}

beforeEach(() => {
  mockedReport.mockReturnValue(reportResult({}));
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
    expect(html).toContain('Начальный капитал');
    expect(html).toContain('Итоговый капитал');
    expect(html).toContain('+4,20%');
    expect(html).toContain('Максимальная просадка');
    expect(html).toContain('Win rate');
    expect(html).toContain('Кривая капитала');
    expect(html).toContain('По стратегиям');
    expect(html).toContain('Откат в тренде');
    expect(html).toContain('Позиции отчёта');
    expect(html).toContain('Сделки отчёта');
    expect(html).toContain('Журнал интентов');
    expect(html).toContain('TREND_PULLBACK_TRAIL');
    expect(html).toContain('pending intent(s) are excluded');
    expect(html).toContain('Скачать JSON');
    expect(html).toContain('Скачать Markdown');
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

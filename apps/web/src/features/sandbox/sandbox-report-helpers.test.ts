import { describe, expect, it } from 'vitest';
import { ApiError } from '@/lib/api';
import { formatUsd } from '@/lib/format';
import {
  formatSandboxPercentPlain,
  formatSandboxReportTimestamp,
  sandboxEquityCurveSummary,
  sandboxProfitFactorTone,
  sandboxReportDownloadError,
  sandboxReportError,
  sandboxReportFileName,
  sandboxReportPeriodLabel,
  sandboxReportSummaryCards,
} from './sandbox-report-helpers';
import { sandboxReportResponseFixture } from './sandbox-test-fixtures';

describe('sandbox report helpers', () => {
  it('builds stable JSON/Markdown download names', () => {
    expect(sandboxReportFileName('run-1', 'json')).toBe('sandbox-run-1-report.json');
    expect(sandboxReportFileName('run-1', 'md')).toBe('sandbox-run-1-report.md');
  });

  it('maps the report-not-ready 409 to the typed Russian message', () => {
    const error = new ApiError('SANDBOX_REPORT_NOT_READY', 'Conflict');
    expect(sandboxReportError(error)).toContain('Отчёт пока недоступен');
    expect(sandboxReportDownloadError(error)).toContain('Отчёт пока недоступен');
  });

  it('falls back to a clear Russian error for unknown failures', () => {
    expect(sandboxReportError(new Error('boom'))).toBe('Не удалось загрузить отчёт песочницы');
    expect(sandboxReportDownloadError(new Error('boom'))).toBe(
      'Не удалось скачать отчёт песочницы',
    );
  });

  it('formats report timestamps and percent magnitudes', () => {
    expect(formatSandboxReportTimestamp(null)).toBe('—');
    expect(formatSandboxReportTimestamp(Date.parse('2026-11-24T00:00:00.000Z'))).toContain('2026');
    expect(formatSandboxPercentPlain('3.52')).toBe('3,52%');
    expect(formatSandboxPercentPlain('-1.20')).toBe('-1,20%');
  });

  it('summarizes the equity curve', () => {
    const report = sandboxReportResponseFixture().report;
    expect(sandboxEquityCurveSummary(report.equityCurve)).toEqual({
      points: 2,
      firstEquityUsd: '1000.00',
      lastEquityUsd: '1042.00',
      minEquityUsd: '1000.00',
      maxEquityUsd: '1042.00',
    });
    expect(sandboxEquityCurveSummary([])).toMatchObject({ points: 0, firstEquityUsd: null });
  });

  it('labels the report period', () => {
    const report = sandboxReportResponseFixture().report;
    expect(sandboxReportPeriodLabel(report)).toContain('5 бар.');
    expect(sandboxReportPeriodLabel(report)).toContain('1 ток.');
  });

  it('builds summary cards from contract strings without re-rounding', () => {
    const metrics = sandboxReportResponseFixture().report.metrics;
    const cards = sandboxReportSummaryCards(metrics);
    const byTitle = new Map(cards.map((card) => [card.title, card]));

    expect(byTitle.get('Итоговый капитал')?.value).toBe(formatUsd('1042.00'));
    expect(byTitle.get('Доходность')?.value).toBe('+4,20%');
    expect(byTitle.get('Максимальная просадка')?.value).toBe('3,52%');
    expect(byTitle.get('Win rate')?.value).toBe('50,00%');
    expect(byTitle.get('Сделки')?.value).toBe('2');
    expect(byTitle.get('Profit factor')?.value).toBe('2,1');
    expect(byTitle.get('Время в рынке')?.value).toBe('60,00%');
    expect(byTitle.get('Средний убыток')?.value).toBe(formatUsd('-4.00'));
    expect(byTitle.get('Доходность')?.tone).toBe('emerald');
  });

  it('shows a dash for missing nullable report metrics', () => {
    const metrics = {
      ...sandboxReportResponseFixture().report.metrics,
      winRatePct: null,
      profitFactor: null,
      averageWinUsd: null,
      averageLossUsd: null,
    };
    const cards = sandboxReportSummaryCards(metrics);
    const byTitle = new Map(cards.map((card) => [card.title, card]));
    expect(byTitle.get('Win rate')?.value).toBe('—');
    expect(byTitle.get('Profit factor')?.value).toBe('—');
    expect(byTitle.get('Средняя прибыль')?.value).toBe('—');
    expect(byTitle.get('Средний убыток')?.value).toBe('—');
  });

  it('never paints a profit factor below 1 as positive', () => {
    expect(sandboxProfitFactorTone('0.80')).toBe('rose');
    expect(sandboxProfitFactorTone('1.50')).toBe('emerald');
    expect(sandboxProfitFactorTone('1')).toBe('sky');
    expect(sandboxProfitFactorTone(null)).toBe('sky');

    const losing = {
      ...sandboxReportResponseFixture().report.metrics,
      profitFactor: '0.80',
    };
    const card = sandboxReportSummaryCards(losing).find((item) => item.title === 'Profit factor');
    expect(card?.tone).toBe('rose');
  });
});

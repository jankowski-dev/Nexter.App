import { describe, expect, it } from 'vitest';
import { ApiError } from '@/lib/api';
import { formatPct, formatUsd } from '@/lib/format';
import {
  SANDBOX_REPLAY_MAX_TOKENS,
  sandboxReplayCanArchive,
  sandboxReplayCanCancel,
  sandboxReplayCanDownloadReport,
  sandboxReplayCounterfactualOutcomeLabels,
  sandboxReplayCreateError,
  sandboxReplayDetailError,
  sandboxReplayDownloadError,
  sandboxReplayElapsedLabel,
  sandboxReplayIsActive,
  sandboxReplayListError,
  sandboxReplayPartialConfirm,
  sandboxReplayPeriodLabel,
  sandboxReplayPreflightSummary,
  sandboxReplayReportFileName,
  sandboxReplayStatusLabels,
  sandboxReplayStatusOptions,
  sandboxReplayStatusTones,
  sandboxReplaySummaryCards,
  sandboxReplayTokenSymbols,
  sandboxReplayWindowLabel,
} from './sandbox-replay-helpers';
import {
  sandboxReplayFromTime,
  sandboxReplayPreflightFixture,
  sandboxReplayReportResponseFixture,
  sandboxReplayToTime,
  sandboxTokenId,
} from './sandbox-test-fixtures';

const otherTokenKey = 'binance:BTCUSDT';

describe('sandbox replay status helpers', () => {
  it('uses Russian status labels, tones and filter options', () => {
    expect(sandboxReplayStatusLabels).toEqual({
      queued: 'В очереди',
      running: 'Выполняется',
      completed: 'Завершён',
      failed: 'Ошибка',
      cancelled: 'Отменён',
    });
    expect(sandboxReplayStatusTones).toEqual({
      queued: 'warning',
      running: 'info',
      completed: 'success',
      failed: 'danger',
      cancelled: 'neutral',
    });
    expect(sandboxReplayStatusOptions.map((option) => option.value)).toEqual([
      'all',
      'queued',
      'running',
      'completed',
      'failed',
      'cancelled',
    ]);
  });

  it('polls only queued and running replays', () => {
    expect(sandboxReplayIsActive('queued')).toBe(true);
    expect(sandboxReplayIsActive('running')).toBe(true);
    expect(sandboxReplayIsActive('completed')).toBe(false);
    expect(sandboxReplayIsActive('failed')).toBe(false);
    expect(sandboxReplayIsActive('cancelled')).toBe(false);
  });

  it('allows cancel only for queued rows and archive only for terminal rows', () => {
    expect(sandboxReplayCanCancel({ status: 'queued', archivedAt: null })).toBe(true);
    expect(sandboxReplayCanCancel({ status: 'running', archivedAt: null })).toBe(false);
    expect(
      sandboxReplayCanCancel({ status: 'queued', archivedAt: '2026-11-24T00:00:00.000Z' }),
    ).toBe(false);

    for (const status of ['completed', 'failed', 'cancelled'] as const) {
      expect(sandboxReplayCanArchive({ status, archivedAt: null })).toBe(true);
    }
    expect(sandboxReplayCanArchive({ status: 'queued', archivedAt: null })).toBe(false);
    expect(
      sandboxReplayCanArchive({ status: 'completed', archivedAt: '2026-11-24T00:00:00.000Z' }),
    ).toBe(false);
  });

  it('offers a report download only for completed replays', () => {
    expect(sandboxReplayCanDownloadReport('completed')).toBe(true);
    expect(sandboxReplayCanDownloadReport('failed')).toBe(false);
    expect(sandboxReplayCanDownloadReport('queued')).toBe(false);
  });

  it('formats the period, token symbols and evaluation window', () => {
    expect(sandboxReplayPeriodLabel(30)).toBe('30 дней');
    expect(sandboxReplayPeriodLabel(90)).toBe('90 дней');
    expect(sandboxReplayPeriodLabel(180)).toBe('180 дней');

    const symbols = new Map([
      [sandboxTokenId, 'AAA'],
      [otherTokenKey, 'BTC'],
    ]);
    expect(sandboxReplayTokenSymbols([sandboxTokenId], symbols)).toBe('AAA');
    expect(sandboxReplayTokenSymbols([sandboxTokenId, otherTokenKey], symbols)).toBe('AAA, BTC');
    expect(sandboxReplayTokenSymbols([otherTokenKey], new Map())).toBe(otherTokenKey);

    const window = sandboxReplayWindowLabel(sandboxReplayFromTime, sandboxReplayToTime);
    expect(window).toContain('2026');
    expect(window).toContain('—');
  });

  it('formats elapsed time from queued/started/finished timestamps', () => {
    const start = Date.parse('2026-11-24T00:00:00.000Z');
    expect(
      sandboxReplayElapsedLabel({
        queuedAt: '2026-11-24T00:00:00.000Z',
        startedAt: null,
        finishedAt: null,
        nowMs: start + 90_000,
      }),
    ).toBe('1 мин');
    expect(
      sandboxReplayElapsedLabel({
        queuedAt: '2026-11-24T00:00:00.000Z',
        startedAt: '2026-11-24T00:00:00.000Z',
        finishedAt: '2026-11-24T02:00:00.000Z',
        nowMs: start,
      }),
    ).toBe('2 ч');
    expect(
      sandboxReplayElapsedLabel({
        queuedAt: null,
        startedAt: null,
        finishedAt: null,
        nowMs: start,
      }),
    ).toBe('—');
  });
});

describe('sandbox replay preflight summary', () => {
  it('blocks an empty or oversized selection', () => {
    const empty = sandboxReplayPreflightSummary({
      tokenKeys: [],
      preflight: undefined,
      pending: false,
      failed: false,
    });
    expect(empty.blocked).toBe(true);
    expect(empty.warnings.join(' ')).toContain('Не выбрано ни одного токена');

    const oversized = sandboxReplayPreflightSummary({
      tokenKeys: ['a', 'b', 'c', 'd'],
      preflight: undefined,
      pending: false,
      failed: false,
    });
    expect(oversized.blocked).toBe(true);
    expect(oversized.warnings.join(' ')).toContain(String(SANDBOX_REPLAY_MAX_TOKENS));
  });

  it('blocks while coverage is pending, failed or unavailable', () => {
    const pending = sandboxReplayPreflightSummary({
      tokenKeys: [sandboxTokenId],
      preflight: undefined,
      pending: true,
      failed: false,
    });
    expect(pending.blocked).toBe(true);
    expect(pending.label).toContain('Проверяю');

    const failed = sandboxReplayPreflightSummary({
      tokenKeys: [sandboxTokenId],
      preflight: undefined,
      pending: false,
      failed: true,
    });
    expect(failed.blocked).toBe(true);
    expect(failed.warnings.join(' ')).toContain('Не удалось проверить');
  });

  it('accepts full coverage without confirmation', () => {
    const summary = sandboxReplayPreflightSummary({
      tokenKeys: [sandboxTokenId],
      preflight: sandboxReplayPreflightFixture(),
      pending: false,
      failed: false,
    });
    expect(summary.status).toBe('ok');
    expect(summary.blocked).toBe(false);
    expect(summary.requiresConfirmation).toBe(false);
    expect(summary.label).toBe('Данные готовы');
    expect(summary.evaluationBars).toBe(4320);
    expect(summary.fromTime).toBe(sandboxReplayFromTime);
  });

  it('blocks a missing series', () => {
    const summary = sandboxReplayPreflightSummary({
      tokenKeys: [sandboxTokenId],
      preflight: sandboxReplayPreflightFixture({
        status: 'missing',
        warnings: ['Нет часовых свечей в окне прогона.'],
        coverage: [
          {
            ...sandboxReplayPreflightFixture().coverage[0]!,
            available: 0,
            gaps: 4320,
            status: 'missing',
          },
        ],
      }),
      pending: false,
      failed: false,
    });
    expect(summary.status).toBe('missing');
    expect(summary.blocked).toBe(true);
    expect(summary.label).toBe('Недостаточно истории для прогона');
  });

  it('requires confirmation for a shortened partial window without gaps', () => {
    const summary = sandboxReplayPreflightSummary({
      tokenKeys: [sandboxTokenId],
      preflight: sandboxReplayPreflightFixture({
        status: 'partial',
        fromTime: '2026-08-01T00:00:00.000Z',
        warnings: ['Окно прогона сокращено.'],
        coverage: [
          {
            ...sandboxReplayPreflightFixture().coverage[0]!,
            fromTime: '2026-08-01T00:00:00.000Z',
            available: 2760,
            required: 2760,
            gaps: 0,
            status: 'ok',
          },
        ],
      }),
      pending: false,
      failed: false,
    });
    expect(summary.status).toBe('partial');
    expect(summary.blocked).toBe(false);
    expect(summary.requiresConfirmation).toBe(true);
    expect(summary.evaluationBars).toBe(2760);
    expect(summary.label).toContain('потребуется подтверждение');
  });

  it('blocks a shortened window below the server minimum', () => {
    const summary = sandboxReplayPreflightSummary({
      tokenKeys: [sandboxTokenId],
      preflight: sandboxReplayPreflightFixture({
        status: 'partial',
        fromTime: '2026-11-19T00:00:00.000Z',
        coverage: [
          {
            ...sandboxReplayPreflightFixture().coverage[0]!,
            fromTime: '2026-11-19T00:00:00.000Z',
            available: 120,
            required: 120,
            gaps: 0,
            status: 'ok',
          },
        ],
      }),
      pending: false,
      failed: false,
    });
    expect(summary.blocked).toBe(true);
    expect(summary.label).toContain('слишком короткое');
    expect(summary.warnings.join(' ')).toContain('240');
  });

  it('blocks a partial window with holes inside the evaluation window', () => {
    const summary = sandboxReplayPreflightSummary({
      tokenKeys: [sandboxTokenId],
      preflight: sandboxReplayPreflightFixture({
        status: 'partial',
        coverage: [
          {
            ...sandboxReplayPreflightFixture().coverage[0]!,
            available: 4000,
            gaps: 320,
            status: 'partial',
          },
        ],
      }),
      pending: false,
      failed: false,
    });
    expect(summary.blocked).toBe(true);
    expect(summary.label).toContain('пропуски');
  });

  it('describes the actual shortened window in the partial confirmation', () => {
    const preflight = sandboxReplayPreflightFixture({
      status: 'partial',
      fromTime: '2026-08-01T00:00:00.000Z',
    });
    const copy = sandboxReplayPartialConfirm(preflight);
    expect(copy.title).toContain('сокращённом окне');
    expect(copy.description).toContain('2760');
    expect(copy.description).toContain('2026');
    expect(copy.confirmLabel).toContain('сокращённым окном');
    expect(copy.variant).toBe('primary');
  });
});

describe('sandbox replay report helpers', () => {
  it('builds the expected detail metric cards', () => {
    const metrics = sandboxReplayReportResponseFixture().report.metrics;
    const cards = sandboxReplaySummaryCards(metrics);
    const byTitle = new Map(cards.map((card) => [card.title, card]));

    expect(cards).toHaveLength(8);
    expect(byTitle.get('Итоговый капитал')?.value).toBe(formatUsd(metrics.finalEquityUsd));
    expect(byTitle.get('Доходность')?.value).toBe(formatPct('4.20'));
    expect(byTitle.get('Максимальная просадка')?.value).toBe('3,52%');
    expect(byTitle.get('Начальный капитал')?.value).toBe(formatUsd('1000.00'));
    expect(byTitle.get('Свободный капитал')?.value).toBe(formatUsd('426.00'));
    expect(byTitle.get('Сделки')?.value).toBe('2');
    expect(byTitle.get('Win rate')?.value).toBe('50,00%');
    expect(byTitle.get('Комиссии')?.value).toBe(formatUsd('1.50'));
    expect(byTitle.get('Доходность')?.tone).toBe('emerald');
  });

  it('labels hindsight counterfactual outcomes', () => {
    expect(sandboxReplayCounterfactualOutcomeLabels).toEqual({
      missed_opportunity: 'Упущенная возможность',
      bad_save: 'Пропуск оправдан',
      neutral: 'Нейтрально',
      insufficient_data: 'Недостаточно данных',
    });
  });

  it('uses a stable replay report download filename', () => {
    expect(sandboxReplayReportFileName('replay-1', 'json')).toBe(
      'sandbox-replay-replay-1-report.json',
    );
    expect(sandboxReplayReportFileName('replay-1', 'md')).toBe('sandbox-replay-replay-1-report.md');
  });

  it('maps replay contract errors to Russian messages', () => {
    const notCompleted = new ApiError('SANDBOX_REPLAY_NOT_COMPLETED', 'Conflict');
    expect(sandboxReplayDownloadError(notCompleted)).toContain('завершённого прогона');
    expect(sandboxReplayDetailError(new ApiError('SANDBOX_REPLAY_NOT_FOUND', '404'))).toContain(
      'не найден',
    );
    expect(
      sandboxReplayCreateError(new ApiError('SANDBOX_REPLAY_COVERAGE_MISSING', '409')),
    ).toContain('Недостаточно истории');

    expect(sandboxReplayListError(new Error('boom'))).toBe(
      'Не удалось загрузить прогоны песочницы',
    );
    expect(sandboxReplayDetailError(new Error('boom'))).toBe(
      'Не удалось загрузить прогон песочницы',
    );
    expect(sandboxReplayCreateError(new Error('boom'))).toBe(
      'Не удалось запустить исторический прогон',
    );
    expect(sandboxReplayDownloadError(new Error('boom'))).toBe('Не удалось скачать отчёт прогона');
  });
});

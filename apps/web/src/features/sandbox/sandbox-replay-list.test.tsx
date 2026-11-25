import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { SandboxReplayList } from './sandbox-replay-list';
import type { SandboxReplayStatusFilter } from './sandbox-replay-helpers';
import { sandboxReplaySummaryFixture, sandboxTokenId } from './sandbox-test-fixtures';
import type { SandboxReplayStatus, SandboxReplaySummary } from '@nexter/contracts';

function renderList(
  input: {
    replays?: SandboxReplaySummary[];
    status?: SandboxReplayStatusFilter;
    includeArchived?: boolean;
    pending?: boolean;
    error?: unknown;
    total?: number;
  } = {},
): string {
  return renderToStaticMarkup(
    <SandboxReplayList
      replays={input.replays ?? []}
      total={input.total ?? input.replays?.length ?? 0}
      status={input.status ?? 'all'}
      onStatusChange={vi.fn()}
      includeArchived={input.includeArchived ?? false}
      onIncludeArchivedChange={vi.fn()}
      pending={input.pending ?? false}
      error={input.error ?? null}
      onRetry={vi.fn()}
      onOpen={vi.fn()}
      onCancel={vi.fn()}
      onArchive={vi.fn()}
      busyId={null}
      symbolByKey={new Map([[sandboxTokenId, 'AAA']])}
    />,
  );
}

describe('sandbox replay list', () => {
  it('shows a loading state while the history is fetched', () => {
    expect(renderList({ pending: true })).toContain('Загрузка');
  });

  it('shows a Russian error with retry', () => {
    const html = renderList({ error: new Error('boom') });
    expect(html).toContain('Ошибка');
    expect(html).toContain('Не удалось загрузить прогоны песочницы');
    expect(html).toContain('Повторить');
  });

  it('shows the empty history state and its filters', () => {
    const html = renderList();
    expect(html).toContain('Прогонов пока нет');
    expect(html).toContain('Все статусы');
    expect(html).toContain('Архив');
  });

  it('renders a completed replay with period, tokens, return and drawdown', () => {
    const html = renderList({ replays: [sandboxReplaySummaryFixture()] });
    expect(html).toContain('Прогон 180 дней');
    expect(html).toContain('Завершён');
    expect(html).toContain('180 дней');
    expect(html).toContain('AAA');
    expect(html).toContain('4,20%');
    expect(html).toContain('3,52%');
    expect(html).toContain('Открыть');
    expect(html).toContain('В архив');
    expect(html).not.toContain('Отменить');
    expect(html).not.toContain('Купить');
    expect(html).not.toContain('Добавить');
  });

  it('offers cancel for a queued replay and no archive', () => {
    const queued = sandboxReplaySummaryFixture({
      status: 'queued',
      startedAt: null,
      finishedAt: null,
      finalEquityUsd: null,
      returnPct: null,
      maxDrawdownPct: null,
    });
    const html = renderList({ replays: [queued] });
    expect(html).toContain('В очереди');
    expect(html).toContain('Отменить');
    expect(html).not.toContain('В архив');
    expect(html).toContain('—');
  });

  it('hides actions for an archived replay and labels it', () => {
    const archived = sandboxReplaySummaryFixture({
      archivedAt: '2026-11-24T03:00:00.000Z',
    });
    const html = renderList({ replays: [archived], includeArchived: true });
    expect(html).toContain('Архив');
    expect(html).not.toContain('Отменить');
    expect(html).not.toContain('В архив');
  });

  it('shows a failed replay error message', () => {
    const failed = sandboxReplaySummaryFixture({
      status: 'failed' as SandboxReplayStatus,
      error: 'Не удалось прочитать сохранённые свечи',
      finalEquityUsd: null,
      returnPct: null,
      maxDrawdownPct: null,
    });
    const html = renderList({ replays: [failed] });
    expect(html).toContain('Ошибка');
    expect(html).toContain('Не удалось прочитать сохранённые свечи');
    expect(html).toContain('В архив');
  });
});

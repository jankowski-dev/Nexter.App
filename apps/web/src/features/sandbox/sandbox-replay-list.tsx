import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Select } from '@/components/ui/select';
import { EmptyState, ErrorState, LoadingRows } from '@/components/ui/states';
import { Switch } from '@/components/ui/switch';
import { formatDateTime, formatPct, formatUsd, pnlTone } from '@/lib/format';
import {
  sandboxReplayCanArchive,
  sandboxReplayCanCancel,
  sandboxReplayListError,
  sandboxReplayPeriodLabel,
  sandboxReplayStatusLabels,
  sandboxReplayStatusOptions,
  sandboxReplayStatusTones,
  sandboxReplayTokenSymbols,
  sandboxReplayWindowLabel,
  type SandboxReplayStatusFilter,
} from './sandbox-replay-helpers';
import type { SandboxReplaySummary } from '@nexter/contracts';

export interface SandboxReplayListProps {
  replays: readonly SandboxReplaySummary[];
  total: number;
  status: SandboxReplayStatusFilter;
  includeArchived: boolean;
  pending: boolean;
  error: unknown;
  busyId?: string | null;
  symbolByKey?: ReadonlyMap<string, string>;
  onStatusChange: (status: SandboxReplayStatusFilter) => void;
  onIncludeArchivedChange: (includeArchived: boolean) => void;
  onRetry: () => void;
  onOpen: (replay: SandboxReplaySummary) => void;
  onCancel: (replay: SandboxReplaySummary) => void;
  onArchive: (replay: SandboxReplaySummary) => void;
}

/**
 * `История прогонов`: read-only rows plus cancel (queued only) and archive
 * (terminal only). The component is pure so the empty/loading/error/loaded
 * states can be rendered without a DOM.
 */
export function SandboxReplayList({
  replays,
  total,
  status,
  includeArchived,
  pending,
  error,
  busyId = null,
  symbolByKey = new Map<string, string>(),
  onStatusChange,
  onIncludeArchivedChange,
  onRetry,
  onOpen,
  onCancel,
  onArchive,
}: SandboxReplayListProps) {
  if (pending) return <LoadingRows rows={4} />;

  if (error) {
    return <ErrorState message={sandboxReplayListError(error)} onRetry={onRetry} />;
  }

  const narrowed = status !== 'all' || (includeArchived && total > 0);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Select
          aria-label="Фильтр по статусу прогона"
          value={status}
          className="w-48"
          onChange={(event) => onStatusChange(event.target.value as SandboxReplayStatusFilter)}
        >
          {sandboxReplayStatusOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </Select>
        <label className="flex items-center gap-2 text-sm text-zinc-600">
          <Switch
            checked={includeArchived}
            onChange={onIncludeArchivedChange}
            label="Показывать архивные прогоны"
          />
          Архив
        </label>
        <span className="ml-auto text-xs text-zinc-500">
          Всего: {total} · показано {replays.length}
        </span>
      </div>

      {replays.length === 0 ? (
        <EmptyState
          title={narrowed ? 'Ничего не найдено' : 'Прогонов пока нет'}
          description={
            narrowed
              ? 'Измените фильтр по статусу или включите архив.'
              : 'Запустите исторический прогон: он посчитает paper-результат на сохранённых свечах 1h и оставит отчёт и снимок данных.'
          }
        />
      ) : (
        <div className="space-y-3">
          {replays.map((replay) => (
            <SandboxReplayRow
              key={replay.id}
              replay={replay}
              busy={busyId === replay.id}
              symbolByKey={symbolByKey}
              onOpen={onOpen}
              onCancel={onCancel}
              onArchive={onArchive}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function SandboxReplayRow({
  replay,
  busy,
  symbolByKey,
  onOpen,
  onCancel,
  onArchive,
}: {
  replay: SandboxReplaySummary;
  busy: boolean;
  symbolByKey: ReadonlyMap<string, string>;
  onOpen: (replay: SandboxReplaySummary) => void;
  onCancel: (replay: SandboxReplaySummary) => void;
  onArchive: (replay: SandboxReplaySummary) => void;
}) {
  return (
    <Card className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            className="truncate text-left text-base font-semibold text-zinc-900 hover:text-emerald-800"
            onClick={() => onOpen(replay)}
          >
            {replay.name}
          </button>
          <Badge tone={sandboxReplayStatusTones[replay.status]}>
            {sandboxReplayStatusLabels[replay.status]}
          </Badge>
          {replay.archivedAt ? <Badge tone="neutral">Архив</Badge> : null}
          <Badge tone="info">{sandboxReplayPeriodLabel(replay.periodDays)}</Badge>
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-zinc-500">
          <span>Токены: {sandboxReplayTokenSymbols(replay.tokenKeys, symbolByKey)}</span>
          <span>Старт {formatUsd(replay.initialCapitalUsd)}</span>
          <span>Окно: {sandboxReplayWindowLabel(replay.fromTime, replay.toTime)}</span>
          <span>Создан {formatDateTime(replay.createdAt)}</span>
          {replay.finishedAt ? <span>Завершён {formatDateTime(replay.finishedAt)}</span> : null}
        </div>
        {replay.status === 'failed' && replay.error ? (
          <p className="mt-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
            {replay.error}
          </p>
        ) : null}
      </div>

      <div className="flex shrink-0 flex-wrap items-end gap-5">
        <div className="text-right">
          <div className="text-[10px] font-medium uppercase tracking-wide text-zinc-500">
            Итоговый капитал
          </div>
          <div className="font-mono text-sm font-semibold tabular-nums text-zinc-900">
            {formatUsd(replay.finalEquityUsd)}
          </div>
        </div>
        <div className="text-right">
          <div className="text-[10px] font-medium uppercase tracking-wide text-zinc-500">
            Доходность
          </div>
          <div
            className={`font-mono text-sm font-semibold tabular-nums ${pnlTone(replay.returnPct)}`}
          >
            {formatPct(replay.returnPct)}
          </div>
        </div>
        <div className="text-right">
          <div className="text-[10px] font-medium uppercase tracking-wide text-zinc-500">
            Просадка
          </div>
          <div className="font-mono text-sm tabular-nums text-zinc-700">
            {replay.maxDrawdownPct === null
              ? '—'
              : formatPct(replay.maxDrawdownPct).replace(/^[-+]/, '')}
          </div>
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="secondary" onClick={() => onOpen(replay)}>
            Открыть
          </Button>
          {sandboxReplayCanCancel(replay) ? (
            <Button variant="danger" disabled={busy} onClick={() => onCancel(replay)}>
              Отменить
            </Button>
          ) : null}
          {sandboxReplayCanArchive(replay) ? (
            <Button variant="secondary" disabled={busy} onClick={() => onArchive(replay)}>
              В архив
            </Button>
          ) : null}
        </div>
      </div>
    </Card>
  );
}

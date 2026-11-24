import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import {
  formatDateTime,
  formatPct,
  formatRelativeTime,
  formatUsd,
  pluralizeRu,
  pnlTone,
} from '@/lib/format';
import { sandboxStatusLabels, sandboxStatusTones } from './sandbox-tabs';
import type { SandboxRunSummary } from '@nexter/contracts';

export type SandboxRunAction = 'open' | 'edit' | 'start' | 'pause' | 'resume' | 'stop' | 'archive';

const actionLabels: Record<SandboxRunAction, string> = {
  open: 'Открыть',
  edit: 'Изменить',
  start: 'Запустить',
  pause: 'Пауза',
  resume: 'Продолжить',
  stop: 'Остановить',
  archive: 'В архив',
};

const actionsByStatus: Record<SandboxRunSummary['status'], readonly SandboxRunAction[]> = {
  draft: ['edit', 'start'],
  running: ['pause', 'stop'],
  paused: ['resume', 'stop'],
  stopped: ['archive'],
  failed: ['archive'],
};

/**
 * One run row in `Запуски`.
 *
 * The only actions are the lifecycle controls from design §10: no manual buy,
 * add or override is rendered for any status.
 */
export function SandboxRunCard({
  run,
  busy = false,
  onAction,
}: {
  run: SandboxRunSummary;
  busy?: boolean;
  onAction: (run: SandboxRunSummary, action: SandboxRunAction) => void;
}) {
  const actions = run.archivedAt ? [] : actionsByStatus[run.status];

  return (
    <Card className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="truncate text-base font-semibold text-zinc-900">{run.name}</h2>
          <Badge tone={sandboxStatusTones[run.status]}>{sandboxStatusLabels[run.status]}</Badge>
          {run.archivedAt ? <Badge tone="neutral">Архив</Badge> : null}
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-zinc-500">
          <span>
            {run.tokenCount} {pluralizeRu(run.tokenCount, 'токен', 'токена', 'токенов')}
          </span>
          <span>Создан {formatDateTime(run.createdAt)}</span>
          <span>
            {run.lastTickAt ? `Тик ${formatRelativeTime(run.lastTickAt)}` : 'Тиков ещё не было'}
          </span>
          {run.lastBarClose ? <span>Бар {formatDateTime(run.lastBarClose)}</span> : null}
        </div>
        {run.status === 'failed' && run.error ? (
          <p className="mt-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
            {run.error}
          </p>
        ) : null}
      </div>

      <div className="flex shrink-0 items-end gap-5">
        <div className="text-right">
          <div className="text-[10px] font-medium uppercase tracking-wide text-zinc-500">
            Капитал
          </div>
          <div className="font-mono text-sm font-semibold tabular-nums text-zinc-900">
            {formatUsd(run.equityUsd)}
          </div>
        </div>
        <div className="text-right">
          <div className="text-[10px] font-medium uppercase tracking-wide text-zinc-500">
            Доходность
          </div>
          <div className={`font-mono text-sm font-semibold tabular-nums ${pnlTone(run.returnPct)}`}>
            {formatPct(run.returnPct)}
          </div>
        </div>
        <div className="text-right">
          <div className="text-[10px] font-medium uppercase tracking-wide text-zinc-500">
            Просадка
          </div>
          <div className="font-mono text-sm tabular-nums text-zinc-700">
            {formatPct(run.drawdownPct).replace(/^[-+]/, '')}
          </div>
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="secondary" onClick={() => onAction(run, 'open')}>
            {actionLabels.open}
          </Button>
          {actions.map((action) => (
            <Button
              key={action}
              variant={action === 'stop' || action === 'archive' ? 'danger' : 'secondary'}
              disabled={busy}
              onClick={() => onAction(run, action)}
            >
              {actionLabels[action]}
            </Button>
          ))}
        </div>
      </div>
    </Card>
  );
}

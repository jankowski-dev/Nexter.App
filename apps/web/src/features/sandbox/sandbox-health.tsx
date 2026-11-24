import { Badge } from '@/components/ui/badge';
import { Card, CardTitle } from '@/components/ui/card';
import { ErrorState, LoadingRows } from '@/components/ui/states';
import { formatDateTime, formatRelativeTime } from '@/lib/format';
import { toRussianError } from '@/lib/error-messages';
import { useSandboxOverview } from './sandbox-hooks';

function HealthMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-zinc-200 bg-white px-3 py-2">
      <div className="text-[10px] font-medium uppercase tracking-wide text-zinc-500">{label}</div>
      <div className="mt-0.5 font-mono text-lg font-semibold tabular-nums text-zinc-900">
        {value}
      </div>
    </div>
  );
}

/**
 * Sandbox health: run counts, the universe size and data freshness.
 *
 * It is read-only and never offers lifecycle or trade actions; those live on
 * the dashboard and in `Запуски`. A failed or pending overview is explicit.
 */
export function SandboxHealth() {
  const overview = useSandboxOverview();

  if (overview.isPending) {
    return (
      <Card>
        <CardTitle>Состояние песочницы</CardTitle>
        <div className="mt-3">
          <LoadingRows rows={2} />
        </div>
      </Card>
    );
  }

  if (overview.isError || !overview.data) {
    return (
      <ErrorState
        message={toRussianError(overview.error, 'Не удалось загрузить состояние песочницы')}
        onRetry={() => void overview.refetch()}
      />
    );
  }

  const data = overview.data;
  const counts = data.runs;
  const stale = data.universe.staleTokens.length;

  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <CardTitle>Состояние песочницы</CardTitle>
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone="info">{data.executionMode} · виртуальные деньги</Badge>
          <Badge tone={stale > 0 ? 'danger' : 'success'}>
            {stale > 0 ? `Устарело: ${stale}` : 'Данные свежие'}
          </Badge>
        </div>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6">
        <HealthMetric label="Всего запусков" value={String(counts.total)} />
        <HealthMetric label="Работают" value={String(counts.running)} />
        <HealthMetric label="Пауза" value={String(counts.paused)} />
        <HealthMetric label="Остановлены" value={String(counts.stopped)} />
        <HealthMetric label="Ошибка" value={String(counts.failed)} />
        <HealthMetric label="Архив" value={String(counts.archived)} />
      </div>

      <div className="mt-3 grid gap-2 text-xs text-zinc-600 sm:grid-cols-2">
        <div>
          Вселенная: {data.universe.tokens} ток. · включено {data.universe.enabledTokens}
        </div>
        <div>Последний тик: {formatDateTime(data.lastTickAt)}</div>
        <div>Последняя свеча 1h: {formatDateTime(data.universe.lastCandleAt)}</div>
        <div>Обновлено: {formatRelativeTime(data.lastTickAt ?? data.universe.lastCandleAt)}</div>
      </div>

      {stale > 0 ? (
        <p className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          Нет свежих данных 1h: {data.universe.staleTokens.slice(0, 5).join(', ')}
          {data.universe.staleTokens.length > 5 ? '…' : ''}. Запуски ждут закрытых баров.
        </p>
      ) : null}

      {counts.total === 0 ? (
        <p className="mt-2 text-xs text-zinc-500">
          Запусков пока нет. Создайте черновик в разделе «Запуски».
        </p>
      ) : null}
    </Card>
  );
}

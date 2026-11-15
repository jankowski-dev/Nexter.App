import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardDescription, CardTitle } from '@/components/ui/card';
import { PageHeader } from '@/components/ui/page-header';
import { ErrorState, LoadingRows } from '@/components/ui/states';
import { fetchSystemStatus } from '@/lib/api';
import { toRussianError } from '@/lib/error-messages';
import { formatDateTime, formatRelativeTime } from '@/lib/format';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import type { SystemStatus } from '@nexter/contracts';

function count(value: number): string {
  return value.toLocaleString('ru-RU');
}

function StatusTile({
  title,
  value,
  hint,
  tone = 'neutral',
}: {
  title: string;
  value: string;
  hint: string;
  tone?: 'neutral' | 'success' | 'warning' | 'danger' | 'info';
}) {
  return (
    <Card className="h-full">
      <div className="flex items-start justify-between gap-2">
        <CardTitle>{title}</CardTitle>
        <Badge tone={tone}>
          {tone === 'success'
            ? 'OK'
            : tone === 'danger'
              ? 'Ошибка'
              : tone === 'warning'
                ? 'Внимание'
                : 'Инфо'}
        </Badge>
      </div>
      <div className="mt-2 font-mono text-2xl font-semibold tabular-nums text-zinc-900">
        {value}
      </div>
      <CardDescription>{hint}</CardDescription>
    </Card>
  );
}

function severityTone(severity: SystemStatus['warnings'][number]['severity']) {
  return severity === 'error' ? 'danger' : severity === 'warning' ? 'warning' : 'info';
}

export function SystemStatusPage() {
  const status = useQuery({
    queryKey: ['system-status'],
    queryFn: fetchSystemStatus,
    refetchInterval: 30_000,
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Состояние системы"
        subtitle="Котировки, фоновые задачи, свопы и провайдеры. Только просмотр."
        actions={
          <Button variant="secondary" asChild>
            <Link to="/settings">Назад</Link>
          </Button>
        }
      />

      {status.isPending ? <LoadingRows rows={8} /> : null}
      {status.isError ? (
        <ErrorState
          message={toRussianError(status.error, 'Не удалось загрузить состояние системы')}
          onRetry={() => void status.refetch()}
        />
      ) : null}

      {status.data ? (
        <StatusBody
          data={status.data}
          onRefresh={() => void status.refetch()}
          refreshing={status.isFetching}
        />
      ) : null}
    </div>
  );
}

function StatusBody({
  data,
  onRefresh,
  refreshing,
}: {
  data: SystemStatus;
  onRefresh: () => void;
  refreshing: boolean;
}) {
  const quoteTone = data.quotes.missing > 0 || data.quotes.stale15m > 0 ? 'warning' : 'success';
  const botTone = data.bots.stale > 0 || data.bots.errors24h > 0 ? 'warning' : 'success';
  const swapTone = data.swaps.unaccounted > 0 || data.swaps.stuck > 0 ? 'danger' : 'success';
  const reconTone =
    data.reconciliation.lastStatus === 'FAILED'
      ? 'danger'
      : data.reconciliation.lastStatus
        ? 'success'
        : 'neutral';

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-zinc-500">
        <span>
          Обновлено {formatRelativeTime(data.generatedAt)} · версия {data.version} · {data.nodeEnv}
        </span>
        <Button variant="secondary" onClick={onRefresh} disabled={refreshing}>
          {refreshing ? 'Обновляю…' : 'Обновить'}
        </Button>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
        <StatusTile
          title="База данных"
          value={data.database.ok ? `${data.database.latencyMs} мс` : 'Ошибка'}
          hint="Health-check соединения"
          tone={data.database.ok ? 'success' : 'danger'}
        />
        <StatusTile
          title="Котировки"
          value={`${count(data.quotes.quoted)} / ${count(data.quotes.assets)}`}
          hint={
            data.quotes.lastFetchedAt
              ? `Последнее обновление ${formatRelativeTime(data.quotes.lastFetchedAt)}`
              : 'Обновлений ещё не было'
          }
          tone={quoteTone}
        />
        <StatusTile
          title="Роботы"
          value={`${count(data.bots.running)} запущено`}
          hint={
            data.bots.stale > 0
              ? `Без свежего тика: ${data.bots.stale}`
              : data.bots.lastTickAt
                ? `Последний тик ${formatRelativeTime(data.bots.lastTickAt)}`
                : 'Тиков ещё не было'
          }
          tone={botTone}
        />
        <StatusTile
          title="Свопы"
          value={`${count(data.swaps.active)} активных`}
          hint={`Без учёта: ${data.swaps.unaccounted} · зависло: ${data.swaps.stuck}`}
          tone={swapTone}
        />
        <StatusTile
          title="Снимки"
          value={data.snapshots.lastCapturedAt ? 'Есть' : 'Нет'}
          hint={
            data.snapshots.lastCapturedAt
              ? `Последний ${formatRelativeTime(data.snapshots.lastCapturedAt)}`
              : 'Ещё не создавались'
          }
          tone={data.snapshots.lastCapturedAt ? 'success' : 'neutral'}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardTitle>Возможности</CardTitle>
          <CardDescription>Флаги окружения без адресов и секретов.</CardDescription>
          <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
            <Flag label="Котировки" value={data.flags.marketQuotesEnabled} />
            <Flag label="Роботы" value={data.flags.botRunnerEnabled} />
            <Flag label="Снимки" value={data.flags.portfolioSnapshotsEnabled} />
            <Flag label="Сверка" value={data.flags.reconciliationEnabled} />
            <Flag label="Swap" value={data.flags.swapEnabled} />
            <Flag label="Исполнение" value={data.flags.swapExecutionEnabled} />
            <Flag label="Kill switch" value={data.flags.swapKillSwitch} goodWhenTrue={false} />
            <Flag label="RPC BSC" value={data.flags.rpcConfigured.bsc} />
            <Flag label="RPC Ethereum" value={data.flags.rpcConfigured.ethereum} />
          </div>
        </Card>

        <Card>
          <CardTitle>Интервалы</CardTitle>
          <CardDescription>Как часто запускаются фоновые процессы.</CardDescription>
          <div className="mt-3 space-y-1 text-sm text-zinc-700">
            <div className="flex justify-between gap-3">
              <span>Котировки</span>
              <span className="font-mono">{data.intervals.marketQuoteSeconds} с</span>
            </div>
            <div className="flex justify-between gap-3">
              <span>CoinGecko</span>
              <span className="font-mono">{data.intervals.marketQuoteCoinGeckoSeconds} с</span>
            </div>
            <div className="flex justify-between gap-3">
              <span>Роботы</span>
              <span className="font-mono">{data.intervals.botRunnerSeconds} с</span>
            </div>
            <div className="flex justify-between gap-3">
              <span>Снимки</span>
              <span className="font-mono">{data.intervals.portfolioSnapshotSeconds} с</span>
            </div>
            <div className="flex justify-between gap-3">
              <span>Индексер</span>
              <span className="font-mono">{data.intervals.reconciliationIndexSeconds} с</span>
            </div>
            <div className="flex justify-between gap-3">
              <span>Swap tracker</span>
              <span className="font-mono">{data.intervals.swapTrackSeconds} с</span>
            </div>
          </div>
        </Card>
      </div>

      <Card>
        <CardTitle>Котировки по источникам</CardTitle>
        <CardDescription>
          {count(data.quotes.missing)} без котировки · {count(data.quotes.stale15m)} старше 15 минут
        </CardDescription>
        <div className="mt-3 flex flex-wrap gap-2">
          {Object.entries(data.quotes.bySource).length === 0 ? (
            <span className="text-sm text-zinc-500">Источников пока нет.</span>
          ) : (
            Object.entries(data.quotes.bySource).map(([source, value]) => (
              <Badge key={source} tone="info">
                {source}: {count(value)}
              </Badge>
            ))
          )}
        </div>
      </Card>

      <Card>
        <CardTitle>Внешние провайдеры</CardTitle>
        <CardDescription>Запросы за последние 24 часа.</CardDescription>
        {data.externalApis.length === 0 ? (
          <p className="mt-3 text-sm text-zinc-500">Запросов не было.</p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-200 text-left text-xs text-zinc-500">
                  <th className="py-2 pr-3 font-medium">Провайдер</th>
                  <th className="py-2 pr-3 text-right font-medium">Запросы</th>
                  <th className="py-2 pr-3 text-right font-medium">Ошибки</th>
                  <th className="py-2 pr-3 text-right font-medium">Доля</th>
                  <th className="py-2 pr-3 text-right font-medium">p95</th>
                  <th className="py-2 text-right font-medium">Последний</th>
                </tr>
              </thead>
              <tbody>
                {data.externalApis.map((api) => (
                  <tr key={api.provider} className="border-b border-zinc-100 last:border-0">
                    <td className="py-2 pr-3 font-mono text-xs text-zinc-700">{api.provider}</td>
                    <td className="py-2 pr-3 text-right font-mono">{count(api.calls24h)}</td>
                    <td className="py-2 pr-3 text-right font-mono">{count(api.errors24h)}</td>
                    <td className="py-2 pr-3 text-right font-mono">{api.errorRatePct}%</td>
                    <td className="py-2 pr-3 text-right font-mono">
                      {api.p95LatencyMs === null ? '—' : `${api.p95LatencyMs} мс`}
                    </td>
                    <td className="py-2 text-right text-xs text-zinc-500">
                      {api.lastCallAt ? formatDateTime(api.lastCallAt) : '—'}
                      {api.lastStatus ? ` · ${api.lastStatus}` : ''}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card>
        <CardTitle>Индексер</CardTitle>
        <CardDescription>Watch-only адреса и последние проиндексированные блоки.</CardDescription>
        {data.indexer.length === 0 ? (
          <p className="mt-3 text-sm text-zinc-500">Адресов для индексации нет.</p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-200 text-left text-xs text-zinc-500">
                  <th className="py-2 pr-3 font-medium">Сеть</th>
                  <th className="py-2 pr-3 text-right font-medium">Адреса</th>
                  <th className="py-2 pr-3 text-right font-medium">Блок</th>
                  <th className="py-2 pr-3 text-right font-medium">Переводы</th>
                  <th className="py-2 text-right font-medium">Обновлено</th>
                </tr>
              </thead>
              <tbody>
                {data.indexer.map((row) => (
                  <tr key={row.chain} className="border-b border-zinc-100 last:border-0">
                    <td className="py-2 pr-3 font-mono text-xs text-zinc-700">{row.chain}</td>
                    <td className="py-2 pr-3 text-right font-mono">{count(row.addresses)}</td>
                    <td className="py-2 pr-3 text-right font-mono">
                      {row.lastIndexedBlock ?? '—'}
                    </td>
                    <td className="py-2 pr-3 text-right font-mono">{count(row.transfers)}</td>
                    <td className="py-2 text-right text-xs text-zinc-500">
                      {row.lastIndexedAt ? formatDateTime(row.lastIndexedAt) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card>
        <CardTitle>Сверка</CardTitle>
        <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
          <Badge tone={reconTone}>{data.reconciliation.lastStatus ?? 'Нет запусков'}</Badge>
          <span className="text-zinc-500">
            {data.reconciliation.lastRunAt
              ? formatDateTime(data.reconciliation.lastRunAt)
              : 'Сверка ещё не запускалась'}
          </span>
          {data.reconciliation.issues > 0 ? (
            <Badge tone="warning">Расхождений: {data.reconciliation.issues}</Badge>
          ) : null}
          {data.reconciliation.lastError ? (
            <span className="text-red-700">{data.reconciliation.lastError}</span>
          ) : null}
        </div>
      </Card>

      <Card>
        <CardTitle>Предупреждения</CardTitle>
        {data.warnings.length === 0 ? (
          <p className="mt-3 text-sm text-emerald-700">Критических предупреждений нет.</p>
        ) : (
          <div className="mt-3 space-y-2">
            {data.warnings.map((warning) => (
              <div
                key={warning.code}
                className="flex flex-wrap items-center gap-2 rounded-lg border border-zinc-200 p-2 text-sm"
              >
                <Badge tone={severityTone(warning.severity)}>{warning.severity}</Badge>
                <span className="text-zinc-700">{warning.message}</span>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

function Flag({
  label,
  value,
  goodWhenTrue = true,
}: {
  label: string;
  value: boolean;
  goodWhenTrue?: boolean;
}) {
  const ok = goodWhenTrue ? value : !value;
  return (
    <div className="flex items-center justify-between gap-2 rounded-lg border border-zinc-200 px-2 py-1.5">
      <span className="text-zinc-600">{label}</span>
      <Badge tone={ok ? 'success' : 'warning'}>{value ? 'ON' : 'OFF'}</Badge>
    </div>
  );
}

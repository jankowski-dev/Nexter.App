import { AllocationBar } from '@/components/charts/allocation-bar';
import { BarChart } from '@/components/charts/bar-chart';
import { LineChart } from '@/components/charts/line-chart';
import { Card, CardDescription, CardTitle } from '@/components/ui/card';
import { PageHeader } from '@/components/ui/page-header';
import { ErrorState, LoadingRows } from '@/components/ui/states';
import {
  fetchDashboardActivePositions,
  fetchDashboardAllocation,
  fetchDashboardPnl,
  fetchDashboardSummary,
  fetchEquityCurve,
} from '@/lib/api';
import { toRussianError } from '@/lib/error-messages';
import {
  formatCount,
  formatPct,
  formatSignedUsd,
  formatTokenAmount,
  formatUsd,
  pnlTone,
} from '@/lib/format';
import { useQuery } from '@tanstack/react-query';

function Metric({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: string;
}) {
  return (
    <Card>
      <CardTitle>{label}</CardTitle>
      <div
        className={`mt-1 font-mono text-2xl font-semibold tabular-nums ${tone ?? 'text-zinc-900'}`}
      >
        {value}
      </div>
      {hint ? <CardDescription>{hint}</CardDescription> : null}
    </Card>
  );
}

export function ReportsPage() {
  const summary = useQuery({ queryKey: ['dashboard-summary'], queryFn: fetchDashboardSummary });
  const pnl = useQuery({ queryKey: ['dashboard-pnl'], queryFn: fetchDashboardPnl });
  const allocation = useQuery({
    queryKey: ['dashboard-allocation'],
    queryFn: fetchDashboardAllocation,
  });
  const active = useQuery({
    queryKey: ['dashboard-active-positions'],
    queryFn: fetchDashboardActivePositions,
  });
  const curve = useQuery({ queryKey: ['dashboard-equity-curve'], queryFn: fetchEquityCurve });

  const isLoading =
    summary.isPending ||
    pnl.isPending ||
    allocation.isPending ||
    active.isPending ||
    curve.isPending;

  if (isLoading) {
    return (
      <div className="space-y-6">
        <PageHeader title="Отчёты" subtitle="Загружаю статистику…" />
        <LoadingRows rows={8} />
      </div>
    );
  }

  if (summary.isError || !summary.data) {
    return (
      <div className="space-y-6">
        <PageHeader title="Отчёты" />
        <ErrorState
          message={toRussianError(summary.error, 'Не удалось загрузить отчёты')}
          onRetry={() => void summary.refetch()}
        />
      </div>
    );
  }

  const data = summary.data;
  const pnlPoints = (pnl.data?.months ?? []).slice(-12).map((month) => ({
    label: month.month.slice(5),
    value: Number(month.totalUsd),
  }));
  const curvePoints = (curve.data?.points ?? []).map((point) => ({
    label: new Intl.DateTimeFormat('ru-RU', { month: 'short', year: '2-digit' }).format(
      new Date(point.date),
    ),
    value: Number(point.equityUsd),
  }));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Отчёты"
        subtitle="Статистика по портфелю, сделкам и издержкам. Налоги не рассчитываются."
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Metric label="Капитал" value={formatUsd(data.equityUsd)} hint="Кэш + позиции" />
        <Metric
          label="Net deposits"
          value={formatUsd(data.netDepositsUsd)}
          hint="Пополнения − выводы"
        />
        <Metric
          label="Реализованный P&L"
          value={formatSignedUsd(data.realizedPnlUsd)}
          tone={pnlTone(data.realizedPnlUsd)}
        />
        <Metric
          label="Нереализованный P&L"
          value={formatSignedUsd(data.unrealizedPnlUsd)}
          tone={pnlTone(data.unrealizedPnlUsd)}
        />
        <Metric
          label="Итого P&L"
          value={formatSignedUsd(data.totalPnlUsd)}
          tone={pnlTone(data.totalPnlUsd)}
        />
        <Metric label="Сборы" value={formatUsd(data.feesUsd)} hint="Все учтённые fees" />
        <Metric
          label="Активные позиции"
          value={formatCount(data.activePositionsCount)}
          hint={
            data.missingPrices.length > 0 ? `Без цен: ${data.missingPrices.length}` : 'Все оценены'
          }
        />
        <Metric
          label="ROI"
          value={data.roiPct ? formatPct(data.roiPct) : '—'}
          hint="Total P&L / Net deposits"
        />
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardTitle>P&L по месяцам</CardTitle>
          <CardDescription>Последние 12 месяцев.</CardDescription>
          <div className="mt-4">
            <BarChart points={pnlPoints} />
          </div>
        </Card>
        <Card>
          <CardTitle>Кривая капитала</CardTitle>
          <CardDescription>{curve.data?.note ?? 'Текущая оценка капитала.'}</CardDescription>
          <div className="mt-4">
            <LineChart points={curvePoints} />
          </div>
        </Card>
      </div>

      <Card>
        <CardTitle>Аллокация</CardTitle>
        <CardDescription>Доли кэша и активных позиций в капитале.</CardDescription>
        <div className="mt-4">
          <AllocationBar slices={allocation.data?.slices ?? []} />
        </div>
      </Card>

      <Card>
        <CardTitle>Активные позиции</CardTitle>
        <CardDescription>Текущие позиции и нереализованный P&L.</CardDescription>
        {!active.data || active.data.positions.length === 0 ? (
          <p className="mt-4 text-sm text-zinc-600">Активных позиций нет.</p>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-200 text-left text-xs text-zinc-500">
                  <th className="py-2 pr-3 font-medium">Актив</th>
                  <th className="py-2 pr-3 text-right font-medium">Количество</th>
                  <th className="py-2 pr-3 text-right font-medium">Стоимость</th>
                  <th className="py-2 pr-3 text-right font-medium">Себестоимость</th>
                  <th className="py-2 text-right font-medium">P&L</th>
                </tr>
              </thead>
              <tbody>
                {active.data.positions.map((position) => (
                  <tr
                    key={position.asset.id}
                    className="border-b border-zinc-100 last:border-0 hover:bg-zinc-50"
                  >
                    <td className="py-2 pr-3">
                      <div className="font-medium text-zinc-800">{position.asset.symbol}</div>
                      <div className="text-xs text-zinc-500">{position.asset.chainCode}</div>
                    </td>
                    <td className="py-2 pr-3 text-right font-mono tabular-nums text-zinc-700">
                      {formatTokenAmount(position.amount)}
                    </td>
                    <td className="py-2 pr-3 text-right font-mono tabular-nums text-zinc-700">
                      {formatUsd(position.valueUsd)}
                    </td>
                    <td className="py-2 pr-3 text-right font-mono tabular-nums text-zinc-600">
                      {formatUsd(position.costBasisUsd)}
                    </td>
                    <td
                      className={`py-2 text-right font-mono tabular-nums ${pnlTone(position.unrealizedPnlUsd)}`}
                    >
                      {formatSignedUsd(position.unrealizedPnlUsd)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card className="border-dashed">
        <CardTitle>Расширенная статистика</CardTitle>
        <CardDescription>
          Profit factor, win rate, gross profit/loss, gas по confirmed swaps, разбивка по активам и
          экспорт появятся в следующем обновлении.
        </CardDescription>
      </Card>
    </div>
  );
}

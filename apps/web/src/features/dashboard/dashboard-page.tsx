import { AllocationBar } from '@/components/charts/allocation-bar';
import { BarChart } from '@/components/charts/bar-chart';
import { LineChart } from '@/components/charts/line-chart';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { PageHeader } from '@/components/ui/page-header';
import { ErrorState, LoadingRows } from '@/components/ui/states';
import { toRussianError } from '@/lib/error-messages';
import {
  fetchDashboardActivePositions,
  fetchDashboardAllocation,
  fetchDashboardDataQuality,
  fetchDashboardPnl,
  fetchDashboardRecentTrades,
  fetchDashboardSummary,
  fetchEquityCurve,
} from '@/lib/api';
import {
  formatCount,
  formatDate,
  formatPct,
  formatSignedUsd,
  formatTokenAmount,
  formatUsd,
  pnlTone,
} from '@/lib/format';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useState, type ReactNode } from 'react';

const statusLabels: Record<string, string> = {
  open: 'Открыта',
  partial: 'Частично',
  closed: 'Закрыта',
  reserve: 'Резерв',
  for_sale: 'В продажу',
};

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

function Section({
  title,
  description,
  action,
  children,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>{title}</CardTitle>
          {description ? <CardDescription>{description}</CardDescription> : null}
        </div>
        {action}
      </CardHeader>
      {children}
    </Card>
  );
}

function DataQualityBanner() {
  const query = useQuery({
    queryKey: ['dashboard-data-quality'],
    queryFn: fetchDashboardDataQuality,
  });

  if (query.isPending) return null;
  if (query.isError || !query.data) {
    return (
      <Card className="border-amber-200 bg-amber-50">
        <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-amber-800">
          <span>Не удалось загрузить качество данных.</span>
          <Button variant="ghost" className="h-8 px-3 text-xs" onClick={() => void query.refetch()}>
            Повторить
          </Button>
        </div>
      </Card>
    );
  }
  if (query.data.issues.length === 0) {
    return (
      <Card className="border-emerald-200 bg-emerald-50">
        <div className="flex items-center gap-2 text-sm text-emerald-700">
          <Badge tone="success">OK</Badge>
          Качество данных: критичных предупреждений нет.
        </div>
      </Card>
    );
  }

  const errors = query.data.issues.filter((issue) => issue.severity === 'error');
  const warnings = query.data.issues.filter((issue) => issue.severity !== 'error');

  return (
    <Card className="border-amber-200 bg-amber-50">
      <CardHeader>
        <div>
          <CardTitle className="text-amber-800">Качество данных</CardTitle>
          <CardDescription className="text-amber-700">
            {errors.length > 0
              ? `Есть ${formatCount(errors.length)} критичных проблем.`
              : `Есть ${formatCount(warnings.length)} предупреждений.`}
          </CardDescription>
        </div>
        <Link
          to="/settings/data-quality"
          className="text-sm font-medium text-amber-700 hover:text-amber-800"
        >
          Подробнее →
        </Link>
      </CardHeader>
      <div className="flex flex-wrap gap-2">
        {query.data.issues.map((issue) => (
          <Badge key={issue.code} tone={issue.severity === 'error' ? 'danger' : 'warning'}>
            {issue.label}: {formatCount(issue.count)}
          </Badge>
        ))}
      </div>
    </Card>
  );
}

export function DashboardPage() {
  const [range, setRange] = useState<'30' | '90' | '365' | 'all'>('365');
  const summary = useQuery({ queryKey: ['dashboard-summary'], queryFn: fetchDashboardSummary });
  const allocation = useQuery({
    queryKey: ['dashboard-allocation'],
    queryFn: fetchDashboardAllocation,
  });
  const pnl = useQuery({ queryKey: ['dashboard-pnl'], queryFn: fetchDashboardPnl });
  const active = useQuery({
    queryKey: ['dashboard-active-positions'],
    queryFn: fetchDashboardActivePositions,
  });
  const recent = useQuery({
    queryKey: ['dashboard-recent-trades'],
    queryFn: fetchDashboardRecentTrades,
  });
  const curve = useQuery({ queryKey: ['dashboard-equity-curve'], queryFn: fetchEquityCurve });

  const isLoading =
    summary.isPending ||
    allocation.isPending ||
    pnl.isPending ||
    active.isPending ||
    recent.isPending ||
    curve.isPending;

  if (isLoading) {
    return (
      <div className="space-y-6">
        <PageHeader title="Дашборд" subtitle="Загружаю данные учёта…" />
        <LoadingRows rows={8} />
      </div>
    );
  }

  if (summary.isError || !summary.data) {
    return (
      <div className="space-y-6">
        <PageHeader title="Дашборд" />
        <ErrorState
          message={toRussianError(summary.error, 'Не удалось загрузить дашборд')}
          onRetry={() => void summary.refetch()}
        />
      </div>
    );
  }

  const data = summary.data;
  const failedAuxiliaryCount = [allocation, pnl, active, recent, curve].filter(
    (query) => query.isError,
  ).length;
  const rangeDays = range === '30' ? 30 : range === '90' ? 90 : range === '365' ? 365 : null;
  const cutoff = rangeDays ? Date.now() - rangeDays * 86_400_000 : null;
  const curvePoints = (curve.data?.points ?? [])
    .filter((point) => !cutoff || new Date(point.date).getTime() >= cutoff)
    .map((point) => ({
      label: new Intl.DateTimeFormat('ru-RU', { month: 'short', year: '2-digit' }).format(
        new Date(point.date),
      ),
      value: Number(point.equityUsd),
    }));
  const pnlMonths = range === '30' ? 1 : range === '90' ? 3 : range === '365' ? 12 : 24;
  const pnlPoints = (pnl.data?.months ?? []).slice(-pnlMonths).map((month) => ({
    label: month.month.slice(5),
    value: Number(month.totalUsd),
  }));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Дашборд"
        subtitle="Текущий портфель, P&L и качество данных."
        actions={
          <>
            <Button variant="secondary" asChild>
              <Link to="/portfolio">Портфель</Link>
            </Button>
            <Button asChild>
              <Link to="/portfolio" hash="trades">
                Сделки
              </Link>
            </Button>
          </>
        }
      />

      <div className="flex items-center gap-1 rounded-lg border border-zinc-200 bg-zinc-50 p-1">
        {(
          [
            ['30', '30D'],
            ['90', '90D'],
            ['365', '1Y'],
            ['all', 'All'],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            onClick={() => setRange(value)}
            className={`rounded-md px-3 py-1.5 text-xs ${range === value ? 'bg-white text-zinc-900 shadow-sm' : 'text-zinc-500 hover:text-zinc-900'}`}
            aria-pressed={range === value}
          >
            {label}
          </button>
        ))}
      </div>

      {failedAuxiliaryCount > 0 ? (
        <Card className="border-amber-200 bg-amber-50">
          <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-amber-800">
            <span>
              Часть данных дашборда недоступна ({failedAuxiliaryCount} из 5 блоков). Показаны
              доступные значения.
            </span>
            <Button
              variant="ghost"
              className="h-8 px-3 text-xs"
              onClick={() => {
                void allocation.refetch();
                void pnl.refetch();
                void active.refetch();
                void recent.refetch();
                void curve.refetch();
              }}
            >
              Повторить
            </Button>
          </div>
        </Card>
      ) : null}

      <DataQualityBanner />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Metric
          label="Капитал"
          value={formatUsd(data.equityUsd)}
          hint={`Кэш ${formatUsd(data.cashUsd)} · позиции ${formatUsd(data.positionsValueUsd)}`}
        />
        <Metric
          label="Итого P&L"
          value={formatSignedUsd(data.totalPnlUsd)}
          tone={pnlTone(data.totalPnlUsd)}
          hint={`ROI ${formatPct(data.roiPct)}`}
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
          hint={
            data.missingPrices.length > 0 ? `Без цен: ${data.missingPrices.join(', ')}` : undefined
          }
        />
        <Metric label="Net deposits" value={formatUsd(data.netDepositsUsd)} />
        <Metric label="Кэш" value={formatUsd(data.cashUsd)} />
        <Metric
          label="Активные позиции"
          value={formatCount(data.activePositionsCount)}
          hint={`Стоимость ${formatUsd(data.positionsValueUsd)}`}
        />
        <Metric
          label="Доход / корректировки"
          value={`${formatUsd(data.incomeUsd)} / ${formatUsd(data.adjustmentsUsd)}`}
          hint={`Сборы: ${formatUsd(data.feesUsd)}`}
        />
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.4fr_1fr]">
        <Section
          title="Кривая капитала"
          description="Исторические остатки, оцененные по текущим ценам."
        >
          <LineChart points={curvePoints} />
          <p className="mt-2 text-xs text-zinc-500">
            {curve.data?.note ?? 'Историческая переоценка по текущим ценам.'}
          </p>
        </Section>

        <Section title="Аллокация" description="Текущая структура капитала.">
          <AllocationBar slices={allocation.data?.slices ?? []} />
        </Section>
      </div>

      <Section
        title="P&L по месяцам"
        description="Реализованный P&L, доход, корректировки и сборы."
      >
        <BarChart points={pnlPoints} />
      </Section>

      <div className="grid gap-6 xl:grid-cols-2">
        <Section
          title="Активные позиции"
          description="Непогашенные лоты по текущим ценам."
          action={
            <Link to="/portfolio" className="text-sm text-emerald-700 hover:text-emerald-800">
              Все позиции →
            </Link>
          }
        >
          {active.data?.positions.length ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-zinc-200 text-left text-xs text-zinc-500">
                    <th className="py-2 pr-3 font-medium">Актив</th>
                    <th className="py-2 pr-3 text-right font-medium">Количество</th>
                    <th className="py-2 pr-3 text-right font-medium">Стоимость</th>
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
                        <Link
                          to="/portfolio/assets/$assetId"
                          params={{ assetId: position.asset.id }}
                          className="font-medium text-zinc-800 hover:text-emerald-800"
                        >
                          {position.asset.symbol}
                        </Link>
                        <div className="text-xs text-zinc-500">{position.asset.chainCode}</div>
                      </td>
                      <td className="py-2 pr-3 text-right font-mono tabular-nums text-zinc-700">
                        {formatTokenAmount(position.amount)}
                      </td>
                      <td className="py-2 pr-3 text-right font-mono tabular-nums text-zinc-700">
                        {formatUsd(position.valueUsd)}
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
          ) : (
            <p className="text-sm text-zinc-600">Активных позиций нет.</p>
          )}
        </Section>

        <Section
          title="Последние сделки"
          description="Последние торговые группы."
          action={
            <Link
              to="/portfolio"
              hash="trades"
              className="text-sm text-emerald-700 hover:text-emerald-800"
            >
              Все сделки →
            </Link>
          }
        >
          {recent.data?.data.length ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-zinc-200 text-left text-xs text-zinc-500">
                    <th className="py-2 pr-3 font-medium">Актив</th>
                    <th className="py-2 pr-3 font-medium">Статус</th>
                    <th className="py-2 pr-3 text-right font-medium">P&L</th>
                    <th className="py-2 text-right font-medium">Return</th>
                  </tr>
                </thead>
                <tbody>
                  {recent.data.data.map((group) => (
                    <tr
                      key={group.id}
                      className="border-b border-zinc-100 last:border-0 hover:bg-zinc-50"
                    >
                      <td className="py-2 pr-3">
                        <Link
                          to="/trades/$tradeId"
                          params={{ tradeId: group.id }}
                          className="font-medium text-zinc-800 hover:text-emerald-800"
                        >
                          {group.asset.symbol}
                        </Link>
                        <div className="text-xs text-zinc-500">{formatDate(group.openedAt)}</div>
                      </td>
                      <td className="py-2 pr-3">
                        <Badge
                          tone={
                            group.status === 'closed'
                              ? 'neutral'
                              : group.status === 'partial'
                                ? 'warning'
                                : 'info'
                          }
                        >
                          {statusLabels[group.status] ?? group.status}
                        </Badge>
                      </td>
                      <td
                        className={`py-2 pr-3 text-right font-mono tabular-nums ${pnlTone(group.totalPnlUsd)}`}
                      >
                        {formatSignedUsd(group.totalPnlUsd)}
                      </td>
                      <td
                        className={`py-2 text-right font-mono tabular-nums ${pnlTone(group.returnPct)}`}
                      >
                        {group.returnPct ? `${group.returnPct}%` : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-sm text-zinc-600">Сделок пока нет.</p>
          )}
        </Section>
      </div>
    </div>
  );
}

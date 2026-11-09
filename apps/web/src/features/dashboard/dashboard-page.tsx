import { BarChart } from '@/components/charts/bar-chart';
import { LineChart } from '@/components/charts/line-chart';
import { Button } from '@/components/ui/button';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { PageHeader } from '@/components/ui/page-header';
import { ErrorState, LoadingRows } from '@/components/ui/states';
import { toRussianError } from '@/lib/error-messages';
import {
  capturePortfolioSnapshot,
  fetchDashboardPnl,
  fetchDashboardSummary,
  fetchEquityCurve,
} from '@/lib/api';
import {
  formatCount,
  formatDate,
  formatPct,
  formatSignedUsd,
  formatUsd,
  pnlTone,
} from '@/lib/format';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import type { ReactNode } from 'react';

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

function monthLabel(month: string): string {
  return new Intl.DateTimeFormat('ru-RU', { month: 'short', year: '2-digit' }).format(
    new Date(`${month}-01T00:00:00.000Z`),
  );
}

function SignalBanner() {
  // Reserved for actionable signals. Render only when a real signal source is wired.
  return null;
}

export function DashboardPage() {
  const queryClient = useQueryClient();
  const summary = useQuery({ queryKey: ['dashboard-summary'], queryFn: fetchDashboardSummary });
  const snapshot = useMutation({
    mutationFn: capturePortfolioSnapshot,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['dashboard-summary'] });
      void queryClient.invalidateQueries({ queryKey: ['dashboard-equity-curve'] });
    },
  });
  const pnl = useQuery({ queryKey: ['dashboard-pnl'], queryFn: fetchDashboardPnl });
  const curve = useQuery({ queryKey: ['dashboard-equity-curve'], queryFn: fetchEquityCurve });

  const isLoading = summary.isPending || pnl.isPending || curve.isPending;

  if (isLoading) {
    return (
      <div className="space-y-6">
        <PageHeader title="Дашборд" subtitle="Загружаю данные учёта…" />
        <LoadingRows rows={8} />
      </div>
    );
  }

  if (summary.isError || pnl.isError || curve.isError || !summary.data) {
    return (
      <div className="space-y-6">
        <PageHeader title="Дашборд" />
        <ErrorState
          message={toRussianError(
            summary.error ?? pnl.error ?? curve.error,
            'Не удалось загрузить дашборд',
          )}
          onRetry={() => {
            void summary.refetch();
            void pnl.refetch();
            void curve.refetch();
          }}
        />
      </div>
    );
  }

  const data = summary.data;
  const dailyCurve = curve.data?.valuation === 'daily-snapshots';
  const curvePoints = (curve.data?.points ?? []).map((point) => ({
    label: dailyCurve
      ? formatDate(point.date)
      : new Intl.DateTimeFormat('ru-RU', { month: 'short', year: '2-digit' }).format(
          new Date(point.date),
        ),
    value: Number(point.equityUsd),
  }));
  const monthly = (pnl.data?.months ?? []).slice(-12);
  const monthlyPoints = monthly.map((month) => ({
    label: monthLabel(month.month),
    value: Number(month.totalUsd),
  }));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Дашборд"
        subtitle="Капитал, P&L, газ и доходность по месяцам."
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

      <SignalBanner />

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
        <Metric
          label="Чистые пополнения"
          value={formatUsd(data.netDepositsUsd)}
          hint="Пополнения − выводы"
        />
        <Metric label="Кэш" value={formatUsd(data.cashUsd)} />
        <Metric
          label="Плата за газ"
          value={formatUsd(data.gasUsd)}
          hint="Подтверждённые on-chain обмены"
        />
        <Metric label="Сборы" value={formatUsd(data.feesUsd)} hint="Учтённые комиссии" />
      </div>

      <div className="space-y-3">
        <div>
          <h2 className="text-lg font-semibold text-zinc-900">Качество торговли</h2>
          <p className="text-sm text-zinc-500">
            Реализованные сделки и нереализованные отклонения по открытым позициям.
          </p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          <Metric
            label="Профит-фактор"
            value={data.profitFactor ? Number(data.profitFactor).toFixed(2) : '—'}
            hint="Валовая прибыль / валовый убыток"
          />
          <Metric
            label="Валовая прибыль"
            value={formatUsd(data.grossProfitUsd)}
            hint="Сумма прибыльных закрытых сделок"
            tone="text-emerald-700"
          />
          <Metric
            label="Валовый убыток"
            value={formatUsd(data.grossLossUsd)}
            hint="Сумма убыточных закрытых сделок"
            tone={Number(data.grossLossUsd) > 0 ? 'text-red-700' : undefined}
          />
          <Metric
            label="Доля прибыльных"
            value={data.winRatePct ? `${data.winRatePct}%` : '—'}
            hint={`${formatCount(data.winningTrades)} прибыльных / ${formatCount(data.losingTrades)} убыточных`}
          />
          <Metric
            label="Плюс в нереализованном"
            value={formatUsd(data.positiveUnrealizedUsd)}
            hint="Сумма положительных открытых позиций"
            tone="text-emerald-700"
          />
          <Metric
            label="Минус в нереализованном"
            value={formatUsd(data.negativeUnrealizedUsd)}
            hint="Сумма отрицательных открытых позиций"
            tone={Number(data.negativeUnrealizedUsd) > 0 ? 'text-red-700' : undefined}
          />
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.15fr_0.85fr]">
        <Card>
          <CardTitle>Доходность по месяцам</CardTitle>
          <CardDescription>Последние 12 месяцев.</CardDescription>
          {monthly.length === 0 ? (
            <p className="mt-4 text-sm text-zinc-600">Данных за месяцы пока нет.</p>
          ) : (
            <div className="mt-4 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-zinc-200 text-left text-xs text-zinc-500">
                    <th className="py-2 pr-3 font-medium">Месяц</th>
                    <th className="py-2 pr-3 text-right font-medium">Реализовано</th>
                    <th className="py-2 pr-3 text-right font-medium">Доход</th>
                    <th className="py-2 pr-3 text-right font-medium">Корректировки</th>
                    <th className="py-2 pr-3 text-right font-medium">Сборы</th>
                    <th className="py-2 text-right font-medium">Итог</th>
                  </tr>
                </thead>
                <tbody>
                  {monthly.map((month) => (
                    <tr
                      key={month.month}
                      className="border-b border-zinc-100 last:border-0 hover:bg-zinc-50"
                    >
                      <td className="py-2 pr-3 text-zinc-700">{monthLabel(month.month)}</td>
                      <td
                        className={`py-2 pr-3 text-right font-mono tabular-nums ${pnlTone(
                          month.realizedUsd,
                        )}`}
                      >
                        {formatSignedUsd(month.realizedUsd)}
                      </td>
                      <td className="py-2 pr-3 text-right font-mono tabular-nums text-zinc-600">
                        {formatUsd(month.incomeUsd)}
                      </td>
                      <td className="py-2 pr-3 text-right font-mono tabular-nums text-zinc-600">
                        {formatSignedUsd(month.adjustmentsUsd)}
                      </td>
                      <td className="py-2 pr-3 text-right font-mono tabular-nums text-zinc-600">
                        {formatUsd(month.feesUsd)}
                      </td>
                      <td
                        className={`py-2 text-right font-mono tabular-nums ${pnlTone(
                          month.totalUsd,
                        )}`}
                      >
                        {formatSignedUsd(month.totalUsd)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
        <Card>
          <CardTitle>График доходности</CardTitle>
          <CardDescription>Net P&L по месяцам за последние 12 месяцев.</CardDescription>
          <div className="mt-4">
            <BarChart points={monthlyPoints} />
          </div>
        </Card>
      </div>

      <Section
        title="Кривая капитала"
        description={
          dailyCurve
            ? 'Ежедневные снимки капитала.'
            : 'Исторические остатки, оцененные по текущим ценам.'
        }
        action={
          <Button
            variant="secondary"
            className="h-8 px-3 text-xs"
            onClick={() => snapshot.mutate()}
            disabled={snapshot.isPending}
          >
            {snapshot.isPending ? 'Сохраняю…' : 'Сделать снимок'}
          </Button>
        }
      >
        <LineChart points={curvePoints} />
        <p className="mt-2 text-xs text-zinc-500">
          {curve.data?.note ?? 'Историческая переоценка по текущим ценам.'}
        </p>
        {snapshot.isError ? (
          <p className="mt-1 text-xs text-red-700">
            {toRussianError(snapshot.error, 'Не удалось сохранить снимок')}
          </p>
        ) : null}
      </Section>
    </div>
  );
}

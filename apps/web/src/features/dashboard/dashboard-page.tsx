import { BarChart } from '@/components/charts/bar-chart';
import { LineChart } from '@/components/charts/line-chart';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardDescription, CardTitle } from '@/components/ui/card';
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

type Accent = 'emerald' | 'sky' | 'amber' | 'violet' | 'neutral';

const accentClasses: Record<Accent, string> = {
  emerald: 'bg-emerald-50 text-emerald-700',
  sky: 'bg-sky-50 text-sky-700',
  amber: 'bg-amber-50 text-amber-700',
  violet: 'bg-indigo-50 text-indigo-700',
  neutral: 'bg-zinc-100 text-zinc-600',
};

function MetricIcon({ name }: { name: string }) {
  const common = {
    viewBox: '0 0 24 24',
    fill: 'none',
    'aria-hidden': true,
    className: 'h-5 w-5',
  } as const;

  if (name === 'wallet') {
    return (
      <svg {...common}>
        <rect x="3" y="6" width="18" height="13" rx="3" stroke="currentColor" strokeWidth="1.8" />
        <path d="M3 9h18M16 13h2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      </svg>
    );
  }
  if (name === 'trend') {
    return (
      <svg {...common}>
        <path
          d="m4 16 5-5 4 3 7-8"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path
          d="M15 6h5v5"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    );
  }
  if (name === 'check') {
    return (
      <svg {...common}>
        <circle cx="12" cy="12" r="8.5" stroke="currentColor" strokeWidth="1.8" />
        <path
          d="m8.5 12 2.4 2.4 4.6-4.8"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    );
  }
  if (name === 'spark') {
    return (
      <svg {...common}>
        <path
          d="M4 18V9M9 18V5M14 18v-6M19 18V8"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
        />
      </svg>
    );
  }
  if (name === 'down') {
    return (
      <svg {...common}>
        <path
          d="M12 4v16M6 14l6 6 6-6"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    );
  }
  if (name === 'coins') {
    return (
      <svg {...common}>
        <ellipse cx="9" cy="7" rx="5" ry="2.5" stroke="currentColor" strokeWidth="1.7" />
        <path
          d="M4 7v4c0 1.4 2.2 2.5 5 2.5s5-1.1 5-2.5V7"
          stroke="currentColor"
          strokeWidth="1.7"
        />
        <path
          d="M10 17.5c.9.3 2 .5 3 .5 2.8 0 5-1.1 5-2.5v-4"
          stroke="currentColor"
          strokeWidth="1.7"
          strokeLinecap="round"
        />
      </svg>
    );
  }
  if (name === 'fuel') {
    return (
      <svg {...common}>
        <path
          d="M6 21V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v16M5 21h10"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
        />
        <path
          d="M14 9h2a2 2 0 0 1 2 2v6a1.5 1.5 0 0 0 3 0v-5l-2-2"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    );
  }
  if (name === 'receipt') {
    return (
      <svg {...common}>
        <path
          d="M6 3h12v18l-3-2-3 2-3-2-3 2Z"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinejoin="round"
        />
        <path d="M9 8h6M9 12h6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      </svg>
    );
  }
  if (name === 'gauge') {
    return (
      <svg {...common}>
        <path
          d="M4 16a8 8 0 1 1 16 0"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
        />
        <path d="m12 14 4-4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      </svg>
    );
  }
  if (name === 'up') {
    return (
      <svg {...common}>
        <path
          d="M12 20V4M6 10l6-6 6 6"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    );
  }
  if (name === 'target') {
    return (
      <svg {...common}>
        <circle cx="12" cy="12" r="8.5" stroke="currentColor" strokeWidth="1.8" />
        <circle cx="12" cy="12" r="4" stroke="currentColor" strokeWidth="1.8" />
        <circle cx="12" cy="12" r="1" fill="currentColor" />
      </svg>
    );
  }
  return (
    <svg {...common}>
      <circle cx="12" cy="12" r="8.5" stroke="currentColor" strokeWidth="1.8" />
      <path d="M12 8v8M8 12h8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function MetricCard({
  label,
  value,
  hint,
  tone,
  accent = 'neutral',
  icon,
  badge,
  compact = false,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: string;
  accent?: Accent;
  icon: string;
  badge?: ReactNode;
  compact?: boolean;
}) {
  return (
    <Card className={compact ? 'p-4' : undefined}>
      <div className="flex items-start justify-between gap-3">
        <div
          className={`flex h-10 w-10 items-center justify-center rounded-2xl ${accentClasses[accent]}`}
        >
          <MetricIcon name={icon} />
        </div>
        {badge}
      </div>
      <div className="mt-3 text-[11px] font-medium uppercase tracking-[0.08em] text-zinc-500">
        {label}
      </div>
      <div
        className={`mt-1 font-mono font-semibold tabular-nums ${
          compact ? 'text-xl' : 'text-3xl'
        } ${tone ?? 'text-zinc-900'}`}
      >
        {value}
      </div>
      {hint ? <div className="mt-1 text-xs text-zinc-500">{hint}</div> : null}
    </Card>
  );
}

function SectionHeading({
  icon,
  title,
  description,
  action,
  accent = 'emerald',
}: {
  icon: string;
  title: string;
  description?: string;
  action?: ReactNode;
  accent?: Accent;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div className="flex items-center gap-3">
        <div
          className={`flex h-10 w-10 items-center justify-center rounded-2xl ${accentClasses[accent]}`}
        >
          <MetricIcon name={icon} />
        </div>
        <div>
          <h2 className="text-lg font-semibold tracking-tight text-zinc-900">{title}</h2>
          {description ? <p className="text-sm text-zinc-500">{description}</p> : null}
        </div>
      </div>
      {action}
    </div>
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
    <div className="space-y-8">
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
        <MetricCard
          label="Капитал"
          value={formatUsd(data.equityUsd)}
          hint={`Кэш ${formatUsd(data.cashUsd)} · позиции ${formatUsd(data.positionsValueUsd)}`}
          icon="wallet"
          accent="emerald"
          badge={<Badge tone="success">Портфель</Badge>}
        />
        <MetricCard
          label="Итого P&L"
          value={formatSignedUsd(data.totalPnlUsd)}
          tone={pnlTone(data.totalPnlUsd)}
          hint="Реализованный и нереализованный результат"
          icon="trend"
          accent={Number(data.totalPnlUsd) >= 0 ? 'emerald' : 'amber'}
          badge={<Badge tone="info">ROI {formatPct(data.roiPct)}</Badge>}
        />
        <MetricCard
          label="Реализованный P&L"
          value={formatSignedUsd(data.realizedPnlUsd)}
          tone={pnlTone(data.realizedPnlUsd)}
          hint="Закрытые позиции по FIFO"
          icon="check"
          accent="sky"
        />
        <MetricCard
          label="Нереализованный P&L"
          value={formatSignedUsd(data.unrealizedPnlUsd)}
          tone={pnlTone(data.unrealizedPnlUsd)}
          hint={
            data.missingPrices.length > 0
              ? `Без цен: ${data.missingPrices.join(', ')}`
              : 'Открытые позиции'
          }
          icon="spark"
          accent="violet"
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          label="Чистые пополнения"
          value={formatUsd(data.netDepositsUsd)}
          hint="Пополнения − выводы"
          icon="down"
          compact
        />
        <MetricCard
          label="Кэш"
          value={formatUsd(data.cashUsd)}
          hint="Свободные средства"
          icon="coins"
          compact
        />
        <MetricCard
          label="Плата за газ"
          value={formatUsd(data.gasUsd)}
          hint="Подтверждённые on-chain обмены"
          icon="fuel"
          compact
        />
        <MetricCard
          label="Сборы"
          value={formatUsd(data.feesUsd)}
          hint="Учтённые комиссии"
          icon="receipt"
          compact
        />
      </div>

      <div className="space-y-4">
        <SectionHeading
          icon="gauge"
          title="Качество торговли"
          description="Реализованные сделки и нереализованные отклонения по открытым позициям."
          accent="amber"
        />
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          <MetricCard
            label="Профит-фактор"
            value={data.profitFactor ? Number(data.profitFactor).toFixed(2) : '—'}
            hint="Валовая прибыль / валовый убыток"
            icon="gauge"
            compact
          />
          <MetricCard
            label="Валовая прибыль"
            value={formatUsd(data.grossProfitUsd)}
            hint="Сумма прибыльных закрытых сделок"
            tone="text-emerald-700"
            icon="up"
            accent="emerald"
            compact
          />
          <MetricCard
            label="Валовый убыток"
            value={formatUsd(data.grossLossUsd)}
            hint="Сумма убыточных закрытых сделок"
            tone={Number(data.grossLossUsd) > 0 ? 'text-red-700' : undefined}
            icon="down"
            accent="amber"
            compact
          />
          <MetricCard
            label="Доля прибыльных"
            value={data.winRatePct ? `${data.winRatePct}%` : '—'}
            hint={`${formatCount(data.winningTrades)} прибыльных / ${formatCount(data.losingTrades)} убыточных`}
            icon="target"
            accent="sky"
            compact
          />
          <MetricCard
            label="Плюс в нереализованном"
            value={formatUsd(data.positiveUnrealizedUsd)}
            hint="Сумма положительных открытых позиций"
            tone="text-emerald-700"
            icon="up"
            compact
          />
          <MetricCard
            label="Минус в нереализованном"
            value={formatUsd(data.negativeUnrealizedUsd)}
            hint="Сумма отрицательных открытых позиций"
            tone={Number(data.negativeUnrealizedUsd) > 0 ? 'text-red-700' : undefined}
            icon="down"
            compact
          />
        </div>
      </div>

      <Card className="hero-glow overflow-hidden">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-700">
                <MetricIcon name="trend" />
              </div>
              <div>
                <CardTitle>Кривая капитала</CardTitle>
                <CardDescription>
                  {dailyCurve
                    ? 'Ежедневные снимки капитала.'
                    : 'Исторические остатки, оцененные по текущим ценам.'}
                </CardDescription>
              </div>
            </div>
          </div>
          <Button
            variant="secondary"
            className="h-8 px-3 text-xs"
            onClick={() => snapshot.mutate()}
            disabled={snapshot.isPending}
          >
            {snapshot.isPending ? 'Сохраняю…' : 'Сделать снимок'}
          </Button>
        </div>
        <div className="mt-5">
          <LineChart points={curvePoints} height={320} />
        </div>
        <p className="mt-2 text-xs text-zinc-500">
          {curve.data?.note ?? 'Историческая переоценка по текущим ценам.'}
        </p>
        {snapshot.isError ? (
          <p className="mt-1 text-xs text-red-700">
            {toRussianError(snapshot.error, 'Не удалось сохранить снимок')}
          </p>
        ) : null}
      </Card>

      <div className="grid gap-6 xl:grid-cols-[1.15fr_0.85fr]">
        <Card>
          <div className="flex items-center gap-2">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-sky-50 text-sky-700">
              <MetricIcon name="receipt" />
            </div>
            <div>
              <CardTitle>Доходность по месяцам</CardTitle>
              <CardDescription>Последние 12 месяцев.</CardDescription>
            </div>
          </div>
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
          <div className="flex items-center gap-2">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-50 text-emerald-700">
              <MetricIcon name="spark" />
            </div>
            <div>
              <CardTitle>График доходности</CardTitle>
              <CardDescription>Net P&L по месяцам за последние 12 месяцев.</CardDescription>
            </div>
          </div>
          <div className="mt-4">
            <BarChart points={monthlyPoints} />
          </div>
        </Card>
      </div>
    </div>
  );
}

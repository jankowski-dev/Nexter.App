import { Card, CardDescription, CardTitle } from '@/components/ui/card';
import { LineChart } from '@/components/charts/line-chart';
import { ErrorState, LoadingRows } from '@/components/ui/states';
import { fetchEquitySeries } from '@/lib/api';
import { toRussianError } from '@/lib/error-messages';
import { formatSignedUsd, formatUsd } from '@/lib/format';
import type { EquityCurvePoint, EquitySeries, EquitySeriesRange } from '@nexter/contracts';
import { useQuery } from '@tanstack/react-query';
import { Decimal } from 'decimal.js';
import { useState } from 'react';

const MONTHS_RU = [
  'янв',
  'фев',
  'мар',
  'апр',
  'май',
  'июн',
  'июл',
  'авг',
  'сен',
  'окт',
  'ноя',
  'дек',
] as const;

const rangeLabels: Record<EquitySeriesRange, string> = {
  hour: 'Часы',
  day: 'Дни',
  month: 'Месяцы',
};

export function equitySeriesLabel(date: Date, range: EquitySeriesRange): string {
  if (range === 'hour') {
    return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
  }
  if (range === 'day') {
    return `${String(date.getDate()).padStart(2, '0')}.${String(date.getMonth() + 1).padStart(2, '0')}`;
  }
  return `${MONTHS_RU[date.getMonth()]} ${String(date.getFullYear()).slice(2)}`;
}

export function equitySeriesChange(
  points: EquityCurvePoint[],
): { absoluteUsd: string; percent: string } | null {
  if (points.length < 2) return null;
  const first = new Decimal(points[0]?.equityUsd ?? '0');
  const last = new Decimal(points.at(-1)?.equityUsd ?? '0');
  const absolute = last.minus(first);
  const percent = first.isZero()
    ? '—'
    : `${last.minus(first).div(first).mul(100).gt(0) ? '+' : ''}${last
        .minus(first)
        .div(first)
        .mul(100)
        .toFixed(2)}%`;
  return { absoluteUsd: absolute.toFixed(2), percent };
}

export function PortfolioEquityChart({ series }: { series?: EquitySeries }) {
  return <ChartBody series={series} />;
}

function ChartBody({ series }: { series?: EquitySeries }) {
  if (!series || series.points.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-zinc-200 bg-zinc-50/70 px-4 py-8 text-center">
        <p className="text-sm font-medium text-zinc-700">Данных для графика пока нет</p>
        <p className="mx-auto mt-1 max-w-md text-xs text-zinc-500">
          {series?.note ?? 'Почасовые точки появятся после ближайшего снимка капитала.'}
        </p>
      </div>
    );
  }

  const current = series.points.at(-1)?.equityUsd ?? '0';
  const change = equitySeriesChange(series.points);
  const chartPoints = series.points.map((point) => ({
    label: equitySeriesLabel(new Date(point.date), series.range),
    value: Number(point.equityUsd),
  }));

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="font-mono text-2xl font-semibold tracking-tight text-zinc-900">
            {formatUsd(current)}
          </div>
          <div className="mt-1 text-xs text-zinc-500">Текущий капитал</div>
        </div>
        {change ? (
          <div className="text-right">
            <div
              className={`font-mono text-sm font-medium ${
                Number(change.absoluteUsd) >= 0 ? 'text-emerald-700' : 'text-red-700'
              }`}
            >
              {formatSignedUsd(change.absoluteUsd)} · {change.percent}
            </div>
            <div className="mt-1 text-xs text-zinc-500">к первой точке</div>
          </div>
        ) : null}
      </div>
      <div className="mt-3">
        <LineChart points={chartPoints} height={260} />
      </div>
      <p className="mt-2 text-[11px] leading-4 text-zinc-500">{series.note}</p>
    </div>
  );
}

export function PortfolioEquityCard() {
  const [range, setRange] = useState<EquitySeriesRange>('day');
  const series = useQuery({
    queryKey: ['portfolio-equity-series', range],
    queryFn: () => fetchEquitySeries(range),
    refetchInterval: 60_000,
  });

  return (
    <Card className="h-full">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <CardTitle>Движение капитала</CardTitle>
          <CardDescription>Стоимость позиций и свободный капитал.</CardDescription>
        </div>
        <div
          className="flex flex-wrap gap-1 rounded-xl border border-zinc-200 bg-zinc-50 p-1"
          role="group"
          aria-label="Период графика капитала"
        >
          {(Object.keys(rangeLabels) as EquitySeriesRange[]).map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={range === value}
              onClick={() => setRange(value)}
              className={`rounded-lg px-3 py-1.5 text-xs transition-colors ${
                range === value
                  ? 'bg-white font-medium text-zinc-900 shadow-sm'
                  : 'text-zinc-500 hover:text-zinc-900'
              }`}
            >
              {rangeLabels[value]}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-4">
        {series.isPending ? <LoadingRows rows={3} /> : null}
        {series.isError ? (
          <ErrorState
            message={toRussianError(series.error, 'Не удалось загрузить график капитала')}
            onRetry={() => void series.refetch()}
          />
        ) : null}
        {!series.isPending && !series.isError ? <ChartBody series={series.data} /> : null}
      </div>
    </Card>
  );
}

import { BarChart } from '@/components/charts/bar-chart';
import { TokenIcon } from '@/components/token-icon';
import { Card, CardDescription, CardTitle } from '@/components/ui/card';
import { DatePicker } from '@/components/ui/date-picker';
import { PageHeader } from '@/components/ui/page-header';
import { ErrorState, LoadingRows } from '@/components/ui/states';
import { LiveValue } from '@/components/ui/live-value';
import { fetchReports } from '@/lib/api';
import { toRussianError } from '@/lib/error-messages';
import {
  formatCount,
  formatDate,
  formatSignedUsd,
  formatUsd,
  pluralizeRu,
  pnlTone,
} from '@/lib/format';
import { useQuery } from '@tanstack/react-query';
import { useRuntimeSettings, useSettings } from '../settings/use-settings';
import { useEffect, useMemo, useRef, useState } from 'react';

type PeriodPreset = '30d' | '90d' | '365d' | 'ytd' | 'all' | 'custom';

const presetLabels: Record<PeriodPreset, string> = {
  '30d': '30 дней',
  '90d': '90 дней',
  '365d': '12 месяцев',
  ytd: 'С начала года',
  all: 'Всё время',
  custom: 'Свой период',
};

function localDateString(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function shiftDays(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return localDateString(date);
}

function monthLabel(month: string): string {
  return new Intl.DateTimeFormat('ru-RU', { month: 'short', year: '2-digit' }).format(
    new Date(`${month}-01T00:00:00.000Z`),
  );
}

function formatRatio(value: string | null): string {
  if (!value) return '—';
  const number = Number(value);
  if (!Number.isFinite(number)) return '—';
  return new Intl.NumberFormat('ru-RU', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(number);
}

function formatRate(value: string | null): string {
  if (!value) return '—';
  const number = Number(value);
  if (!Number.isFinite(number)) return '—';
  return `${new Intl.NumberFormat('ru-RU', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(number)}%`;
}

const metricSurfaces = ['emerald', 'sky', 'amber', 'violet', 'rose'] as const;

function metricSurface(label: string): (typeof metricSurfaces)[number] {
  const hash = Array.from(label).reduce((sum, char) => sum + (char.codePointAt(0) ?? 0), 0);
  return metricSurfaces[hash % metricSurfaces.length] as (typeof metricSurfaces)[number];
}

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
    <Card className={`tone-surface tone-surface-${metricSurface(label)}`}>
      <CardTitle>{label}</CardTitle>
      <div
        className={`mt-1 font-mono text-2xl font-semibold tabular-nums ${tone ?? 'text-zinc-900'}`}
      >
        <LiveValue value={value}>{value}</LiveValue>
      </div>
      {hint ? <CardDescription>{hint}</CardDescription> : null}
    </Card>
  );
}

export function ReportsPage({ embedded = false }: { embedded?: boolean }) {
  const runtime = useRuntimeSettings();
  const settings = useSettings();
  const defaultApplied = useRef(false);
  const [preset, setPreset] = useState<PeriodPreset>('all');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');

  useEffect(() => {
    if (!settings.data || defaultApplied.current) return;
    setPreset(settings.data.defaultReportPeriod);
    defaultApplied.current = true;
  }, [settings.data]);

  const period = useMemo(() => {
    if (preset === 'custom') {
      return {
        from: customFrom || undefined,
        to: customTo || undefined,
      };
    }

    if (preset === 'all') return { from: undefined, to: undefined };
    if (preset === 'ytd') {
      return {
        from: `${new Date().getFullYear()}-01-01`,
        to: localDateString(new Date()),
      };
    }

    const days = preset === '30d' ? 29 : preset === '90d' ? 89 : 364;
    return { from: shiftDays(days), to: localDateString(new Date()) };
  }, [customFrom, customTo, preset]);

  const invalidPeriod = Boolean(
    preset === 'custom' && customFrom && customTo && customFrom > customTo,
  );

  const reports = useQuery({
    queryKey: ['reports', period.from ?? null, period.to ?? null],
    queryFn: () => fetchReports(period.from, period.to),
    enabled: !invalidPeriod,
    refetchInterval: runtime.reportsPollSeconds * 1000,
  });

  const report = reports.data;
  const monthly = report?.monthly.slice(-12) ?? [];
  const monthlyPoints = monthly.map((month) => ({
    label: monthLabel(month.month),
    value: Number(month.realizedPnlUsd),
  }));

  return (
    <div className="space-y-6">
      {embedded ? null : (
        <PageHeader
          title="Статистика"
          subtitle="Статистика по портфелю, сделкам и издержкам. Налоги не рассчитываются."
        />
      )}

      <Card>
        <div className="flex flex-wrap gap-1 rounded-lg border border-zinc-200 bg-zinc-50 p-1">
          {(Object.keys(presetLabels) as PeriodPreset[]).map((item) => (
            <button
              key={item}
              type="button"
              onClick={() => setPreset(item)}
              className={`rounded-md px-3 py-1.5 text-sm ${
                preset === item
                  ? 'bg-white text-zinc-900 shadow-sm'
                  : 'text-zinc-500 hover:text-zinc-900'
              }`}
              aria-pressed={preset === item}
            >
              {presetLabels[item]}
            </button>
          ))}
        </div>

        {preset === 'custom' ? (
          <div className="mt-3 flex flex-wrap items-end gap-3">
            <div className="block min-w-[180px] text-sm text-zinc-600">
              С
              <div className="mt-1">
                <DatePicker label="Начало периода" value={customFrom} onChange={setCustomFrom} />
              </div>
            </div>
            <div className="block min-w-[180px] text-sm text-zinc-600">
              По
              <div className="mt-1">
                <DatePicker label="Конец периода" value={customTo} onChange={setCustomTo} />
              </div>
            </div>
          </div>
        ) : null}

        {invalidPeriod ? (
          <p className="mt-3 text-sm text-red-700">Дата начала не может быть позже даты конца.</p>
        ) : null}
      </Card>

      {reports.isPending ? <LoadingRows rows={8} /> : null}

      {reports.isError ? (
        <ErrorState
          message={toRussianError(reports.error, 'Не удалось загрузить статистику за период')}
          onRetry={() => void reports.refetch()}
        />
      ) : null}

      {!reports.isPending && report ? (
        <>
          <Card>
            <CardTitle>Итоги за период</CardTitle>
            <CardDescription>
              Реализованный P&L по FIFO, сборы из транзакций и сетевой газ подтверждённых on-chain
              обменов. Газ показан справочно и не вычитается повторно из P&L.
            </CardDescription>
            <div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <Metric
                label="Реализованный P&L"
                value={formatSignedUsd(report.summary.realizedPnlUsd)}
                tone={pnlTone(report.summary.realizedPnlUsd)}
                hint={`${formatCount(report.summary.tradesCount)} ${pluralizeRu(
                  report.summary.tradesCount,
                  'сделка',
                  'сделки',
                  'сделок',
                )} с реализацией`}
              />
              <Metric
                label="Валовая прибыль"
                value={formatUsd(report.summary.grossProfitUsd)}
                tone={pnlTone(report.summary.grossProfitUsd)}
                hint={`${formatCount(report.summary.winningTrades)} ${pluralizeRu(
                  report.summary.winningTrades,
                  'прибыльная',
                  'прибыльные',
                  'прибыльных',
                )}`}
              />
              <Metric
                label="Валовый убыток"
                value={formatUsd(report.summary.grossLossUsd)}
                tone={Number(report.summary.grossLossUsd) > 0 ? 'text-red-700' : 'text-zinc-900'}
                hint={`${formatCount(report.summary.losingTrades)} ${pluralizeRu(
                  report.summary.losingTrades,
                  'убыточная',
                  'убыточные',
                  'убыточных',
                )}`}
              />
              <Metric
                label="Профит-фактор"
                value={formatRatio(report.summary.profitFactor)}
                hint="Валовая прибыль / валовый убыток"
              />
              <Metric
                label="Доля прибыльных"
                value={formatRate(report.summary.winRatePct)}
                hint={`${formatCount(report.summary.winningTrades)} ${pluralizeRu(
                  report.summary.winningTrades,
                  'победа',
                  'победы',
                  'побед',
                )} / ${formatCount(report.summary.losingTrades)} ${pluralizeRu(
                  report.summary.losingTrades,
                  'поражение',
                  'поражения',
                  'поражений',
                )}`}
              />
              <Metric
                label="Сборы"
                value={formatUsd(report.summary.feesUsd)}
                hint="Учтённые комиссии транзакций"
              />
              <Metric
                label="Сетевой газ"
                value={formatUsd(report.summary.gasUsd)}
                hint="Только подтверждённые обмены"
              />
              <Metric
                label="Чистые пополнения"
                value={formatUsd(report.summary.netDepositsUsd)}
                hint={`Пополнения ${formatUsd(
                  report.summary.depositsUsd,
                )} − выводы ${formatUsd(report.summary.withdrawalsUsd)}`}
              />
              <Metric
                label="Доход"
                value={formatUsd(report.summary.incomeUsd)}
                tone={pnlTone(report.summary.incomeUsd)}
                hint="Доходные операции"
              />
              <Metric
                label="Корректировки"
                value={formatSignedUsd(report.summary.adjustmentsUsd)}
                tone={pnlTone(report.summary.adjustmentsUsd)}
                hint="Ручные корректировки"
              />
              <Metric
                label="Транзакции"
                value={formatCount(report.summary.transactionsCount)}
                hint="Все записи за период"
              />
              <Metric
                label="Чистая прибыль за период"
                value={formatSignedUsd(report.summary.netPnlUsd)}
                tone={pnlTone(report.summary.netPnlUsd)}
                hint="Реализовано + доход + корректировки − сборы"
              />
            </div>
          </Card>

          <div className="grid gap-6 xl:grid-cols-2">
            <Card>
              <CardTitle>Реализованный P&L по месяцам</CardTitle>
              <CardDescription>Последние 12 месяцев выбранного периода.</CardDescription>
              <div className="mt-4">
                <BarChart points={monthlyPoints} />
              </div>
            </Card>
            <Card>
              <CardTitle>Помесячная детализация</CardTitle>
              <CardDescription>P&L, сборы, газ и количество операций.</CardDescription>
              {monthly.length === 0 ? (
                <p className="mt-4 text-sm text-zinc-600">За выбранный период данных нет.</p>
              ) : (
                <div className="mt-4 overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-zinc-200 text-left text-xs text-zinc-500">
                        <th className="py-2 pr-3 font-medium">Месяц</th>
                        <th className="py-2 pr-3 text-right font-medium">P&L</th>
                        <th className="py-2 pr-3 text-right font-medium">Сборы</th>
                        <th className="py-2 pr-3 text-right font-medium">Газ</th>
                        <th className="py-2 pr-3 text-right font-medium">Сальдо</th>
                        <th className="py-2 text-right font-medium">Операции</th>
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
                              month.realizedPnlUsd,
                            )}`}
                          >
                            {formatSignedUsd(month.realizedPnlUsd)}
                          </td>
                          <td className="py-2 pr-3 text-right font-mono tabular-nums text-zinc-600">
                            {formatUsd(month.feesUsd)}
                          </td>
                          <td className="py-2 pr-3 text-right font-mono tabular-nums text-zinc-600">
                            {formatUsd(month.gasUsd)}
                          </td>
                          <td
                            className={`py-2 pr-3 text-right font-mono tabular-nums ${pnlTone(
                              month.netPnlUsd,
                            )}`}
                          >
                            {formatSignedUsd(month.netPnlUsd)}
                          </td>
                          <td className="py-2 text-right font-mono tabular-nums text-zinc-600">
                            {formatCount(month.transactionsCount)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
          </div>

          <Card>
            <CardTitle>Разбивка по активам</CardTitle>
            <CardDescription>
              Реализованный результат по FIFO-списаниям за выбранный период.
            </CardDescription>
            {report.byAsset.length === 0 ? (
              <p className="mt-4 text-sm text-zinc-600">
                Нет реализованных сделок за выбранный период.
              </p>
            ) : (
              <div className="mt-4 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-zinc-200 text-left text-xs text-zinc-500">
                      <th className="py-2 pr-3 font-medium">Актив</th>
                      <th className="py-2 pr-3 text-right font-medium">P&L</th>
                      <th className="py-2 pr-3 text-right font-medium">Выручка</th>
                      <th className="py-2 pr-3 text-right font-medium">Себестоимость</th>
                      <th className="py-2 pr-3 text-right font-medium">Сделок</th>
                      <th className="py-2 text-right font-medium">Последнее списание</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.byAsset.map((row) => (
                      <tr
                        key={row.asset.id}
                        className="border-b border-zinc-100 last:border-0 hover:bg-zinc-50"
                      >
                        <td className="py-2 pr-3">
                          <div className="flex items-center gap-2">
                            <TokenIcon
                              logoUrl={row.asset.logoUrl}
                              symbol={row.asset.symbol}
                              className="h-7 w-7 text-[10px]"
                            />
                            <div className="min-w-0">
                              <span className="font-medium text-zinc-800">{row.asset.symbol}</span>
                              <div className="text-xs text-zinc-500">{row.asset.chainCode}</div>
                            </div>
                          </div>
                        </td>
                        <td
                          className={`py-2 pr-3 text-right font-mono tabular-nums ${pnlTone(
                            row.realizedPnlUsd,
                          )}`}
                        >
                          {formatSignedUsd(row.realizedPnlUsd)}
                        </td>
                        <td className="py-2 pr-3 text-right font-mono tabular-nums text-zinc-700">
                          {formatUsd(row.proceedsUsd)}
                        </td>
                        <td className="py-2 pr-3 text-right font-mono tabular-nums text-zinc-600">
                          {formatUsd(row.costBasisUsd)}
                        </td>
                        <td className="py-2 pr-3 text-right font-mono tabular-nums text-zinc-600">
                          {formatCount(row.tradesCount)}
                        </td>
                        <td className="py-2 text-right text-zinc-600">
                          {formatDate(row.lastDisposalAt)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </>
      ) : null}
    </div>
  );
}

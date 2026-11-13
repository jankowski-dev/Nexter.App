import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardDescription, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { TokenIcon } from '@/components/token-icon';
import {
  botBacktestReportUrl,
  clearBotBacktests,
  deleteBotBacktest,
  fetchBotBacktest,
  fetchBotBacktests,
  previewBotBacktest,
  runBotBacktest,
} from '@/lib/api';
import { toRussianError } from '@/lib/error-messages';
import { formatDateTime, formatPct, formatSignedUsd, formatUsd, pnlTone } from '@/lib/format';
import { filterBySearch } from '@/lib/search';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import type {
  BotBacktestPreviewResponse,
  BotBacktestRun,
  BotBacktestStats,
  BotStrategyTemplate,
  WatchlistEntry,
} from '@nexter/contracts';
import { BacktestChart } from './backtest-chart';
import { countMissingDays } from './backtest-utils';
import { StrategyParamInputs } from './strategy-param-inputs';
import { formToParams, paramsToForm } from './strategy-params';

const periodOptions = [
  { value: '30', label: '30 дней' },
  { value: '90', label: '90 дней' },
  { value: '180', label: '180 дней' },
  { value: '365', label: '1 год' },
];

export function BacktestPanel({
  template,
  tokenEntries,
  tokensPending,
  tokensError,
}: {
  template: BotStrategyTemplate;
  tokenEntries: WatchlistEntry[];
  tokensPending: boolean;
  tokensError: unknown;
}) {
  const queryClient = useQueryClient();
  const [tokenSearch, setTokenSearch] = useState('');
  const [selectedAssetId, setSelectedAssetId] = useState('');
  const [days, setDays] = useState('365');
  const [useStopLoss, setUseStopLoss] = useState(true);
  const [useTakeProfit, setUseTakeProfit] = useState(true);
  const [reinvestProfit, setReinvestProfit] = useState(false);
  const [paramValues, setParamValues] = useState<Record<string, string>>(() =>
    paramsToForm(template.defaultParams),
  );
  const [preview, setPreview] = useState<BotBacktestPreviewResponse | null>(null);
  const [run, setRun] = useState<BotBacktestRun | null>(null);
  const [visibleTrades, setVisibleTrades] = useState(0);
  const [animating, setAnimating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadingRunId, setLoadingRunId] = useState<string | null>(null);
  const [deletingRunId, setDeletingRunId] = useState<string | null>(null);
  const [clearing, setClearing] = useState(false);
  const [journalLimit, setJournalLimit] = useState(20);

  const filteredTokens = filterBySearch(tokenEntries, tokenSearch, (entry) => [
    entry.asset.symbol,
    entry.asset.name,
    entry.asset.chainCode,
  ]);
  const selectedToken = tokenEntries.find((entry) => entry.asset.id === selectedAssetId);
  const supportsStopLoss = template.paramFields.some((field) => field.key === 'stopLossPct');
  const supportsTakeProfit = template.paramFields.some((field) => field.key === 'takeProfitPct');
  const missingDays = preview ? countMissingDays(preview.candles) : 0;
  const periodChangePct =
    preview && preview.candles.length > 1
      ? (() => {
          const first = Number(preview.candles[0]?.closeUsd);
          const last = Number(preview.candles[preview.candles.length - 1]?.closeUsd);
          return first > 0 ? (((last - first) / first) * 100).toFixed(2) : null;
        })()
      : null;

  const journal = useQuery({
    queryKey: ['trading-bot-backtests', template.key, journalLimit],
    queryFn: () => fetchBotBacktests({ strategyKey: template.key, limit: journalLimit }),
  });

  const previewMutation = useMutation({
    mutationFn: previewBotBacktest,
    onSuccess: (data) => {
      setPreview(data);
      setRun(null);
      setVisibleTrades(0);
      setError(null);
    },
    onError: (err) => setError(toRussianError(err, 'Не удалось загрузить исторические данные')),
  });

  const runMutation = useMutation({
    mutationFn: runBotBacktest,
    onSuccess: (data) => {
      setRun(data);
      setVisibleTrades(0);
      setAnimating(data.trades.length > 0);
      setError(null);
      void queryClient.invalidateQueries({ queryKey: ['trading-bot-backtests'] });
    },
    onError: (err) => setError(toRussianError(err, 'Не удалось выполнить прогон')),
  });

  useEffect(() => {
    if (!run) {
      setVisibleTrades(0);
      setAnimating(false);
      return;
    }
    if (run.trades.length === 0) {
      setVisibleTrades(0);
      setAnimating(false);
      return;
    }

    let index = 0;
    const step = Math.max(1, Math.ceil(run.trades.length / 40));
    const timer = window.setInterval(() => {
      index = Math.min(index + step, run.trades.length);
      setVisibleTrades(index);
      if (index >= run.trades.length) {
        window.clearInterval(timer);
        setAnimating(false);
      }
    }, 70);
    return () => window.clearInterval(timer);
  }, [run]);

  function selectToken(assetId: string) {
    setSelectedAssetId(assetId);
    setPreview(null);
    setRun(null);
    setError(null);
  }

  function changeDays(value: string) {
    setDays(value);
    setPreview(null);
    setRun(null);
    setError(null);
  }

  function startPreview() {
    if (!selectedAssetId) {
      setError('Выберите токен.');
      return;
    }
    setError(null);
    previewMutation.mutate({ assetId: selectedAssetId, days: Number(days) });
  }

  function startRun() {
    if (!preview || !selectedAssetId) return;
    let strategyParams: Record<string, unknown>;
    try {
      strategyParams = formToParams(template.paramFields, paramValues);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Некорректные параметры прогона.');
      return;
    }
    setError(null);
    runMutation.mutate({
      assetId: selectedAssetId,
      days: Number(days),
      strategyKey: template.key,
      strategyParams,
      useStopLoss,
      useTakeProfit,
      reinvestProfit,
    });
  }

  async function openRun(id: string) {
    setLoadingRunId(id);
    setError(null);
    try {
      const data = await fetchBotBacktest(id);
      setSelectedAssetId(data.asset.id);
      setDays(String(data.days));
      setUseStopLoss(data.useStopLoss);
      setUseTakeProfit(data.useTakeProfit);
      setReinvestProfit(data.reinvestProfit);
      setParamValues(paramsToForm(data.strategyParams));
      setPreview({
        asset: data.asset,
        days: data.days,
        source: data.source,
        candles: data.candles,
      });
      setRun(data);
      setVisibleTrades(0);
      setAnimating(data.trades.length > 0);
    } catch (err) {
      setError(toRussianError(err, 'Не удалось загрузить прогон'));
    } finally {
      setLoadingRunId(null);
    }
  }

  async function removeRun(id: string) {
    if (!window.confirm('Удалить этот прогон из журнала?')) return;
    setDeletingRunId(id);
    setError(null);
    try {
      await deleteBotBacktest(id);
      if (run?.id === id) {
        setRun(null);
        setPreview(null);
      }
      void queryClient.invalidateQueries({ queryKey: ['trading-bot-backtests'] });
    } catch (err) {
      setError(toRussianError(err, 'Не удалось удалить прогон'));
    } finally {
      setDeletingRunId(null);
    }
  }

  async function clearRuns() {
    if (!window.confirm('Удалить все прогоны этой стратегии? Это действие необратимо.')) return;
    setClearing(true);
    setError(null);
    try {
      await clearBotBacktests(template.key);
      setPreview(null);
      setRun(null);
      setVisibleTrades(0);
      setJournalLimit(20);
      void queryClient.invalidateQueries({ queryKey: ['trading-bot-backtests'] });
    } catch (err) {
      setError(toRussianError(err, 'Не удалось очистить журнал'));
    } finally {
      setClearing(false);
    }
  }

  function resetRun() {
    setRun(null);
    setVisibleTrades(0);
    setAnimating(false);
  }

  const previewing = previewMutation.isPending;
  const running = runMutation.isPending || animating;
  const runDone = Boolean(run) && !animating && visibleTrades >= (run?.trades.length ?? 0);
  const primaryLabel = previewing
    ? 'Загрузка…'
    : running
      ? 'Прогон…'
      : preview
        ? 'Прогнать'
        : 'Начать';

  return (
    <Card>
      <CardTitle>Прогон по историческим данным</CardTitle>
      <CardDescription>
        Дневные свечи, комиссия 25 bps и проскальзывание 10 bps. Стоп-лосс и тейк-профит срабатывают
        внутри дня по high/low; открытая позиция закрывается в конце периода.
      </CardDescription>

      <div className="mt-4 grid gap-4 xl:grid-cols-[370px_1fr]">
        <div className="space-y-3">
          <div className="grid gap-2 sm:grid-cols-[1fr_auto_auto] xl:grid-cols-[1fr_auto]">
            <Input
              value={tokenSearch}
              onChange={(event) => setTokenSearch(event.target.value)}
              placeholder="Поиск токена: символ, название или сеть"
              aria-label="Поиск токена для бэктеста"
            />
            <Select
              value={days}
              onChange={(event) => changeDays(event.target.value)}
              aria-label="Период бэктеста"
            >
              {periodOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
            <Button
              className="xl:col-span-2"
              onClick={preview ? startRun : startPreview}
              disabled={previewing || running}
            >
              {primaryLabel}
            </Button>
          </div>

          {selectedToken ? (
            <div className="flex items-center gap-2 rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm">
              <TokenIcon
                logoUrl={selectedToken.logoUrl ?? selectedToken.asset.logoUrl}
                symbol={selectedToken.asset.symbol}
                className="h-5 w-5 text-[9px]"
              />
              <span className="font-medium">{selectedToken.asset.symbol}</span>
              <span className="truncate text-xs text-zinc-500">{selectedToken.asset.name}</span>
              <Badge tone="neutral" className="ml-auto">
                {selectedToken.asset.chainCode}
              </Badge>
            </div>
          ) : null}

          <div className="max-h-40 space-y-1 overflow-y-auto rounded-xl border border-zinc-200 p-2">
            {tokensPending ? (
              <p className="text-xs text-zinc-500">Загрузка токенов…</p>
            ) : tokensError ? (
              <p className="text-xs text-red-700">
                {toRussianError(tokensError, 'Не удалось загрузить Базу токенов')}
              </p>
            ) : tokenEntries.length === 0 ? (
              <p className="text-xs text-zinc-500">В базе нет активных токенов.</p>
            ) : filteredTokens.length === 0 ? (
              <p className="text-xs text-zinc-500">Ничего не найдено.</p>
            ) : (
              filteredTokens.map((entry) => {
                const selected = entry.asset.id === selectedAssetId;
                return (
                  <button
                    key={entry.asset.id}
                    type="button"
                    onClick={() => selectToken(entry.asset.id)}
                    className={`flex w-full items-center gap-2 rounded-lg px-2 py-1 text-left text-sm ${
                      selected ? 'bg-emerald-50 text-emerald-900' : 'hover:bg-zinc-50'
                    }`}
                  >
                    <TokenIcon
                      logoUrl={entry.logoUrl ?? entry.asset.logoUrl}
                      symbol={entry.asset.symbol}
                      className="h-5 w-5 text-[9px]"
                    />
                    <span className="font-medium">{entry.asset.symbol}</span>
                    <span className="truncate text-xs text-zinc-500">{entry.asset.name}</span>
                    <span className="ml-auto shrink-0 text-xs text-zinc-400">
                      {entry.asset.chainCode}
                    </span>
                  </button>
                );
              })
            )}
          </div>

          <details open className="rounded-xl border border-zinc-200 p-3">
            <summary className="cursor-pointer text-sm text-zinc-600">Параметры прогона</summary>
            <div className="mt-3">
              <StrategyParamInputs
                template={template}
                values={paramValues}
                onChange={(key, value) =>
                  setParamValues((current) => ({ ...current, [key]: value }))
                }
              />
              <div className="mt-4 grid gap-3 border-t border-zinc-200 pt-3 sm:grid-cols-3">
                {supportsStopLoss ? (
                  <OptionToggle
                    label="Стоп-лосс"
                    hint="Защитная продажа при просадке"
                    checked={useStopLoss}
                    onChange={(checked) => {
                      setUseStopLoss(checked);
                      resetRun();
                    }}
                  />
                ) : null}
                {supportsTakeProfit ? (
                  <OptionToggle
                    label="Тейк-профит"
                    hint="Фиксация прибыли по цели"
                    checked={useTakeProfit}
                    onChange={(checked) => {
                      setUseTakeProfit(checked);
                      resetRun();
                    }}
                  />
                ) : null}
                <OptionToggle
                  label="Реинвестирование"
                  hint="Следующие сделки от текущего капитала"
                  checked={reinvestProfit}
                  onChange={(checked) => {
                    setReinvestProfit(checked);
                    resetRun();
                  }}
                />
              </div>
            </div>
          </details>

          {error ? <p className="text-sm text-red-700">{error}</p> : null}
        </div>

        <div className="space-y-3">
          {previewing ? (
            <div className="flex h-64 flex-col items-center justify-center gap-3 rounded-xl border border-zinc-200 bg-zinc-50 text-sm text-zinc-500">
              <span className="h-8 w-8 animate-spin rounded-full border-2 border-emerald-600 border-t-transparent" />
              Собираю и обрабатываю исторические данные…
            </div>
          ) : preview ? (
            <div className="space-y-2">
              <BacktestChart
                candles={preview.candles}
                trades={run?.trades ?? []}
                visibleTrades={run ? visibleTrades : 0}
              />
              <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-500">
                <span>
                  {preview.candles.length} дневных свечей · источник {preview.source}
                  {periodChangePct ? ` · изменение цены ${formatPct(periodChangePct)}` : ''}
                </span>
                {run && animating ? (
                  <span className="ml-auto inline-flex items-center gap-2 text-emerald-700">
                    <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-emerald-600 border-t-transparent" />
                    Прогон: {visibleTrades} / {run.trades.length} сделок
                  </span>
                ) : null}
              </div>
              {missingDays > 0 ? (
                <p className="text-xs leading-5 text-amber-700">
                  В данных {missingDays} пропущенных дн. Для низколиквидных токенов источник может
                  отдавать неполный ряд: стоп/тейк могут сработать с задержкой, а гэп — исполниться
                  по цене открытия.
                </p>
              ) : null}
            </div>
          ) : (
            <div className="flex h-40 items-center justify-center rounded-xl border border-dashed border-zinc-200 text-sm text-zinc-500">
              Выберите токен и нажмите «Начать».
            </div>
          )}

          {runDone && run ? (
            <div className="space-y-3">
              <BacktestStatsView stats={run.stats} />
              <div className="flex flex-wrap items-center gap-2">
                <a
                  href={botBacktestReportUrl(run.id)}
                  className="inline-flex h-9 items-center justify-center rounded-xl border border-zinc-200 bg-white px-3 text-sm font-medium text-zinc-800 transition-colors hover:bg-zinc-50"
                >
                  Скачать PDF
                </a>
                <span className="text-xs text-zinc-500">Прогон сохранён в журнале ниже.</span>
              </div>
            </div>
          ) : null}

          <div>
            <div className="mb-2 flex items-center justify-between gap-2">
              <div className="text-sm font-medium text-zinc-800">Журнал прогонов</div>
              <div className="flex items-center gap-2">
                <div className="text-xs text-zinc-500">{journal.data?.data.length ?? 0}</div>
                {(journal.data?.data.length ?? 0) > 0 ? (
                  <Button
                    variant="ghost"
                    className="h-7 px-2 text-xs text-red-700"
                    onClick={() => void clearRuns()}
                    disabled={clearing}
                  >
                    {clearing ? 'Очищаю…' : 'Очистить'}
                  </Button>
                ) : null}
              </div>
            </div>
            {journal.isPending ? (
              <p className="text-xs text-zinc-500">Загрузка журнала…</p>
            ) : journal.isError ? (
              <p className="text-xs text-red-700">
                {toRussianError(journal.error, 'Не удалось загрузить журнал')}
              </p>
            ) : !journal.data || journal.data.data.length === 0 ? (
              <p className="text-xs text-zinc-500">Прогонов ещё не было.</p>
            ) : (
              <div className="overflow-x-auto rounded-xl border border-zinc-200">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-zinc-200 bg-zinc-50 text-left text-xs text-zinc-500">
                      <th className="px-3 py-2 font-medium">Дата</th>
                      <th className="px-3 py-2 font-medium">Токен</th>
                      <th className="px-3 py-2 font-medium">Период</th>
                      <th className="px-3 py-2 text-right font-medium">P&L</th>
                      <th className="px-3 py-2 text-right font-medium">PF</th>
                      <th className="px-3 py-2 text-right font-medium">Действия</th>
                    </tr>
                  </thead>
                  <tbody>
                    {journal.data.data.map((item) => (
                      <tr key={item.id} className="border-b border-zinc-100 last:border-0">
                        <td className="px-3 py-2 text-xs text-zinc-500">
                          {formatDateTime(item.createdAt)}
                        </td>
                        <td className="px-3 py-2">
                          <div className="flex items-center gap-2">
                            <TokenIcon
                              logoUrl={item.asset.logoUrl}
                              symbol={item.asset.symbol}
                              className="h-5 w-5 text-[9px]"
                            />
                            <span className="font-medium">{item.asset.symbol}</span>
                          </div>
                        </td>
                        <td className="px-3 py-2 text-xs text-zinc-500">{item.days} дн.</td>
                        <td
                          className={`px-3 py-2 text-right font-mono ${pnlTone(item.stats.totalPnlUsd)}`}
                        >
                          {formatSignedUsd(item.stats.totalPnlUsd)}
                        </td>
                        <td className="px-3 py-2 text-right font-mono">
                          {item.stats.profitFactor ?? '—'}
                        </td>
                        <td className="px-3 py-2 text-right">
                          <div className="flex justify-end gap-1">
                            <Button
                              variant="ghost"
                              className="h-7 px-2 text-xs"
                              onClick={() => void openRun(item.id)}
                              disabled={loadingRunId === item.id}
                            >
                              {loadingRunId === item.id ? 'Открываю…' : 'Открыть'}
                            </Button>
                            <a
                              href={botBacktestReportUrl(item.id)}
                              className="inline-flex h-7 items-center rounded-md px-2 text-xs font-medium text-emerald-700 hover:bg-emerald-50"
                            >
                              PDF
                            </a>
                            <button
                              type="button"
                              className="inline-flex h-7 items-center rounded-md px-2 text-xs font-medium text-red-700 hover:bg-red-50 disabled:opacity-50"
                              onClick={() => void removeRun(item.id)}
                              disabled={deletingRunId === item.id}
                            >
                              {deletingRunId === item.id ? '…' : 'Удалить'}
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {(journal.data?.data.length ?? 0) >= journalLimit && journalLimit < 100 ? (
                  <div className="flex justify-center border-t border-zinc-100 py-2">
                    <Button
                      variant="secondary"
                      className="h-8 px-3 text-xs"
                      onClick={() => setJournalLimit((current) => Math.min(current + 20, 100))}
                    >
                      Ещё
                    </Button>
                  </div>
                ) : null}
              </div>
            )}
          </div>
        </div>
      </div>
    </Card>
  );
}

function OptionToggle({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div>
        <div className="text-sm text-zinc-700">{label}</div>
        <div className="text-[11px] leading-4 text-zinc-500">{hint}</div>
      </div>
      <Switch checked={checked} onChange={onChange} label={label} />
    </div>
  );
}

function BacktestStatsView({ stats }: { stats: BotBacktestStats }) {
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
      <Metric
        label="P&L"
        value={formatSignedUsd(stats.totalPnlUsd)}
        tone={pnlTone(stats.totalPnlUsd)}
      />
      <Metric
        label="Доходность"
        value={formatPct(stats.totalReturnPct)}
        tone={pnlTone(stats.totalReturnPct)}
      />
      <Metric label="Итоговый капитал" value={formatUsd(stats.finalEquityUsd)} />
      <Metric label="Общий доход" value={formatUsd(stats.grossProfitUsd)} tone="text-emerald-700" />
      <Metric label="Общий убыток" value={formatUsd(stats.grossLossUsd)} tone="text-red-700" />
      <Metric label="Профит-фактор" value={stats.profitFactor ?? '—'} />
      <Metric label="Win rate" value={stats.winRate ? `${stats.winRate}%` : '—'} />
      <Metric label="Сделки" value={`${stats.tradesCount} · ${stats.wins}/${stats.losses}`} />
      <Metric label="Макс. просадка" value={`${stats.maxDrawdownPct}%`} tone="text-red-700" />
      <Metric label="Купить и держать" value={formatPct(stats.buyHoldReturnPct)} />
      <Metric label="Начальный капитал" value={formatUsd(stats.initialCapitalUsd)} />
    </div>
  );
}

function Metric({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="rounded-lg border border-zinc-200 px-2.5 py-2">
      <div className="text-[11px] text-zinc-500">{label}</div>
      <div className={`mt-0.5 font-mono text-sm ${tone ?? 'text-zinc-900'}`}>{value}</div>
    </div>
  );
}

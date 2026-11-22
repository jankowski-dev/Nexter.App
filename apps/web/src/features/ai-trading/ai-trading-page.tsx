import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardDescription, CardTitle } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Drawer } from '@/components/ui/drawer';
import { TrashIcon } from '@/components/ui/icons';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { ErrorState, LoadingRows } from '@/components/ui/states';
import { Switch } from '@/components/ui/switch';
import { TokenIcon } from '@/components/token-icon';
import {
  cancelAiCycle,
  cancelAiSearch,
  createTradingBot,
  deleteAiSearchRun,
  fetchAiSearchResults,
  fetchAiSearchRuns,
  fetchAiSearchStatus,
  startAiSearch,
  createAiToken,
  rejectAiRecommendation,
  fetchAiBotHealth,
  fetchAiRecommendations,
  fetchAiCoverage,
  fetchAiCycle,
  fetchAiCycles,
  startAiCycle,
  fetchAiDashboard,
  fetchAiTokens,
  fetchWatchlist,
  refreshAiData,
  removeAiToken,
  updateAiProfile,
  updateAiToken,
} from '@/lib/api';
import { toRussianError } from '@/lib/error-messages';
import { formatDateTime, formatPct, formatUsd } from '@/lib/format';
import {
  holdoutActiveLabel,
  holdoutBlockSummary,
  holdoutConsistencyLabel,
} from './ai-holdout-format';
import { aiSearchFunnelStageLabels } from '@nexter/contracts';
import type {
  AiBotHealth,
  AiBotHealthResponse,
  AiCoverage,
  AiCoverageStatus,
  AiCoverageTimeframe,
  AiCycleStatus,
  AiCycleStep,
  AiCycleSummary,
  AiProfile,
  AiRecommendation,
  AiProfileToken,
  AiProfileUpdateRequest,
  AiSearchCandidate,
  AiSearchExecution,
  AiSearchResults,
  AiSearchRunSummary,
  AiSearchTimeframe,
  AiTimeframe,
  BotCreateRequest,
  WatchlistEntry,
} from '@nexter/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';

const coverageLabels: Record<AiCoverageStatus, string> = {
  ok: 'OK',
  partial: 'Частично',
  stale: 'Устарело',
  missing: 'Нет данных',
};

const coverageTones: Record<AiCoverageStatus, 'success' | 'warning' | 'danger'> = {
  ok: 'success',
  partial: 'warning',
  stale: 'warning',
  missing: 'danger',
};

const executionLabels: Record<AiSearchExecution, string> = {
  'next-open': 'следующая свеча',
  'same-close': 'по закрытию',
};

function formatDurationMs(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '—';
  if (ms < 1000) return `${Math.round(ms)} мс`;
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)} с`;
  const minutes = Math.floor(seconds / 60);
  const rest = Math.round(seconds % 60);
  return `${minutes} мин ${rest} с`;
}

// 5m remains supported for legacy data but is not offered for the short-swing AI universe.
const timeframeOptions: AiTimeframe[] = ['1h', '1d', '4h', '15m'];

function invalidateAi(queryClient: ReturnType<typeof useQueryClient>): void {
  for (const key of [
    'ai-dashboard',
    'ai-cycle',
    'ai-cycles',
    'ai-tokens',
    'ai-coverage',
    'ai-search-status',
    'ai-search-results',
    'ai-search-runs',
    'ai-bot-health',
    'ai-recommendations',
  ]) {
    void queryClient.invalidateQueries({ queryKey: [key] });
  }
}

export function AiTradingPage() {
  const queryClient = useQueryClient();
  const [drawer, setDrawer] = useState<
    'universe' | 'data' | 'settings' | 'search' | 'history' | null
  >(null);
  const [assetId, setAssetId] = useState('');
  const [timeframe, setTimeframe] = useState<AiSearchTimeframe>('1h');
  const [horizon, setHorizon] = useState('5');
  const [variants, setVariants] = useState('5000');
  const [maxDrafts, setMaxDrafts] = useState('3');
  const [cycleId, setCycleId] = useState<string | null>(() => {
    try {
      return window.sessionStorage.getItem('ai-cycle-id');
    } catch {
      return null;
    }
  });

  function selectCycle(id: string | null) {
    setCycleId(id);
    try {
      if (id) window.sessionStorage.setItem('ai-cycle-id', id);
      else window.sessionStorage.removeItem('ai-cycle-id');
    } catch {
      // Storage may be unavailable; the in-memory id still works.
    }
  }
  const [cancelTarget, setCancelTarget] = useState<AiCycleStatus | null>(null);
  const [cancelError, setCancelError] = useState<string | null>(null);
  const [cycleExporting, setCycleExporting] = useState(false);
  const [cycleExportError, setCycleExportError] = useState<string | null>(null);

  const dashboard = useQuery({
    queryKey: ['ai-dashboard'],
    queryFn: fetchAiDashboard,
    refetchInterval: 30_000,
    retry: 1,
  });
  const tokens = useQuery({ queryKey: ['ai-tokens'], queryFn: fetchAiTokens, retry: 1 });
  const coverage = useQuery({
    queryKey: ['ai-coverage'],
    queryFn: fetchAiCoverage,
    enabled: drawer === 'data' || drawer === 'search',
    refetchInterval: 60_000,
  });
  const botHealth = useQuery({
    queryKey: ['ai-bot-health'],
    queryFn: fetchAiBotHealth,
    refetchInterval: 60_000,
    retry: 1,
  });
  const watchlist = useQuery({
    queryKey: ['ai-watchlist'],
    queryFn: () => fetchWatchlist(false, undefined, undefined, 100),
    enabled: drawer === 'universe',
    retry: 1,
  });
  const cycle = useQuery({
    queryKey: ['ai-cycle', cycleId],
    queryFn: () => fetchAiCycle(cycleId as string),
    enabled: Boolean(cycleId),
    refetchInterval: (query) => {
      const value = query.state.data?.status;
      return value === 'queued' || value === 'running' ? 1000 : false;
    },
  });

  async function exportCycleSearch() {
    const runId = cycle.data?.searchRunId;
    if (!runId || cycleExporting) return;
    setCycleExporting(true);
    setCycleExportError(null);
    try {
      const results = await fetchAiSearchResults(runId);
      downloadJson(`ai-search-${runId}.json`, results);
    } catch (error) {
      setCycleExportError(toRussianError(error, 'Не удалось экспортировать результаты поиска'));
    } finally {
      setCycleExporting(false);
    }
  }

  const tokenRows = tokens.data?.data ?? [];
  const searchable = tokenRows.filter(
    (token) => token.enabled && token.timeframes.some((item) => item === '1h' || item === '4h'),
  );
  const selected = searchable.find((token) => token.asset.id === assetId);
  const timeframes = (selected?.timeframes ?? []).filter(
    (item): item is AiSearchTimeframe => item === '1h' || item === '4h',
  );

  useEffect(() => {
    if (!assetId && searchable[0]) setAssetId(searchable[0].asset.id);
  }, [assetId, searchable]);

  useEffect(() => {
    if (selected && timeframes.length > 0 && !timeframes.includes(timeframe)) {
      setTimeframe(timeframes[0] as AiSearchTimeframe);
    }
  }, [selected, timeframe, timeframes]);

  const startCycle = useMutation({
    mutationFn: () =>
      startAiCycle({
        assetId,
        timeframe,
        horizonDays: Number(horizon) as 1 | 3 | 5 | 10,
        variants: Number(variants),
        maxDrafts: Number(maxDrafts),
        execution: 'next-open',
      }),
    onSuccess: (result) => {
      selectCycle(result.cycleId);
      invalidateAi(queryClient);
    },
  });

  const add4h = useMutation({
    mutationFn: (token: AiProfileToken) => {
      const timeframes: AiTimeframe[] = [...token.timeframes, '4h'];
      return updateAiToken(token.id, { timeframes });
    },
    onSuccess: () => invalidateAi(queryClient),
  });

  const cancelCycle = useMutation({
    mutationFn: (id: string) => cancelAiCycle(id),
    onSuccess: () => {
      setCancelTarget(null);
      setCancelError(null);
      selectCycle(null);
      invalidateAi(queryClient);
    },
    onError: (error) => setCancelError(toRussianError(error, 'Не удалось отменить цикл')),
  });

  useEffect(() => {
    const status = cycle.data?.status;
    if (status === 'succeeded' || status === 'failed') {
      invalidateAi(queryClient);
    }
  }, [cycle.data?.status, queryClient]);

  const profile = dashboard.data?.profile;
  const activeCycle =
    (Boolean(cycleId) && cycle.isPending) ||
    cycle.data?.status === 'queued' ||
    cycle.data?.status === 'running';
  const canStart = Boolean(assetId) && !activeCycle && !startCycle.isPending;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          {profile ? (
            <Badge tone={profile.enabled ? 'success' : 'neutral'}>
              {profile.enabled ? 'Профиль включён' : 'Профиль выключен'}
            </Badge>
          ) : (
            <Badge tone="warning">Профиль недоступен</Badge>
          )}
          <span className="text-xs text-zinc-500">
            {profile?.modelSettings.model ?? '—'} · {dashboard.data?.activeWorkers ?? '—'} /{' '}
            {dashboard.data?.workersCount ?? '—'} ИИ-роботов
          </span>
          <span className="text-xs text-zinc-400">
            {dashboard.data?.lastRunAt
              ? `Последний запуск: ${formatDateTime(dashboard.data.lastRunAt)}`
              : dashboard.isPending
                ? 'Загрузка профиля…'
                : 'Цикл ещё не запускался'}
          </span>
          {dashboard.isError ? (
            <button
              type="button"
              className="text-xs text-red-700 underline"
              onClick={() => void dashboard.refetch()}
            >
              Профиль не загрузился · Повторить
            </button>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-1.5">
          <Button
            variant="ghost"
            className="h-8 px-2.5 text-xs"
            onClick={() => setDrawer('universe')}
          >
            Вселенная
          </Button>
          <Button variant="ghost" className="h-8 px-2.5 text-xs" onClick={() => setDrawer('data')}>
            Данные
          </Button>
          <Button
            variant="ghost"
            className="h-8 px-2.5 text-xs"
            onClick={() => setDrawer('settings')}
          >
            Настройки
          </Button>
          <Button
            variant="ghost"
            className="h-8 px-2.5 text-xs"
            onClick={() => setDrawer('history')}
          >
            История
          </Button>
          <Button
            variant="ghost"
            className="h-8 px-2.5 text-xs"
            onClick={() => setDrawer('search')}
          >
            Ручной поиск
          </Button>
        </div>
      </div>

      <Card className="p-3">
        {tokens.isError ? (
          <p className="mb-2 text-xs text-red-700">
            Не удалось загрузить токены ИИ.{' '}
            <button type="button" className="underline" onClick={() => void tokens.refetch()}>
              Повторить
            </button>
          </p>
        ) : null}
        {!tokens.isPending && !tokens.isError && searchable.length === 0 ? (
          <p className="mb-2 text-xs text-amber-700">
            Нет включённых токенов с 1h/4h. Добавьте токен в «Вселенной».
          </p>
        ) : null}
        <div className="flex flex-wrap items-end gap-2">
          <label className="text-xs text-zinc-600">
            Токен
            <Select
              className="mt-1 h-9 min-w-40"
              value={assetId}
              onChange={(event) => setAssetId(event.target.value)}
              aria-label="Токен для цикла"
            >
              {searchable.map((token) => (
                <option key={token.asset.id} value={token.asset.id}>
                  {token.asset.symbol === token.asset.name
                    ? token.asset.name
                    : `${token.asset.symbol} · ${token.asset.name}`}
                </option>
              ))}
            </Select>
          </label>
          <label className="text-xs text-zinc-600">
            ТФ
            <Select
              className="mt-1 h-9 w-20"
              value={timeframe}
              onChange={(event) => setTimeframe(event.target.value as AiSearchTimeframe)}
              aria-label="Таймфрейм цикла"
            >
              {timeframes.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </Select>
          </label>
          <label className="text-xs text-zinc-600">
            Горизонт
            <Select
              className="mt-1 h-9 w-24"
              value={horizon}
              onChange={(event) => setHorizon(event.target.value)}
              aria-label="Горизонт цикла"
            >
              <option value="1">1 день</option>
              <option value="3">3 дня</option>
              <option value="5">5 дней</option>
              <option value="10">10 дней</option>
            </Select>
          </label>
          <label className="text-xs text-zinc-600">
            Вариантов
            <Select
              className="mt-1 h-9 w-24"
              value={variants}
              onChange={(event) => setVariants(event.target.value)}
              aria-label="Количество вариантов"
            >
              <option value="500">500</option>
              <option value="1000">1 000</option>
              <option value="5000">5 000</option>
              <option value="10000">10 000</option>
              <option value="20000">20 000</option>
              <option value="50000">50 000</option>
              <option value="100000">100 000</option>
              <option value="200000">200 000</option>
            </Select>
          </label>
          <label className="text-xs text-zinc-600">
            Черновиков
            <Select
              className="mt-1 h-9 w-20"
              value={maxDrafts}
              onChange={(event) => setMaxDrafts(event.target.value)}
              aria-label="Сколько черновиков создать"
            >
              <option value="0">0</option>
              <option value="1">1</option>
              <option value="3">3</option>
              <option value="5">5</option>
            </Select>
          </label>
          <Button disabled={!canStart} onClick={() => startCycle.mutate()}>
            {startCycle.isPending
              ? 'Запускаю…'
              : activeCycle
                ? 'Цикл выполняется…'
                : 'Запустить цикл'}
          </Button>
        </div>
        {startCycle.isError ? (
          <p className="mt-2 text-sm text-red-700">
            {toRussianError(startCycle.error, 'Не удалось запустить цикл')}
          </p>
        ) : null}
        <p className="mt-2 text-[11px] text-zinc-400">
          Один клик: данные → поиск → рекомендации → черновики. Роботы не запускаются автоматически.
          Для поиска доступны ТФ 1h и 4h; 4h включается в «Вселенной».
          {selected && !selected.timeframes.includes('4h') ? (
            <>
              {' '}
              У этого токена сейчас только 1h.{' '}
              <button
                type="button"
                className="underline"
                disabled={add4h.isPending}
                onClick={() => add4h.mutate(selected)}
              >
                {add4h.isPending ? 'Добавляю…' : 'Добавить 4h'}
              </button>
            </>
          ) : null}
        </p>
      </Card>

      {cycleId ? (
        <AiCycleCard
          cycle={cycle.data ?? null}
          loading={cycle.isPending && Boolean(cycleId)}
          errorText={
            cycle.isError
              ? toRussianError(cycle.error, 'Не удалось получить статус цикла ИИ')
              : null
          }
          onRetry={() => void cycle.refetch()}
          onClear={() => selectCycle(null)}
          onCancel={() => {
            setCancelError(null);
            if (cycle.data) setCancelTarget(cycle.data);
          }}
          onOpenBots={() => {
            window.location.href = '/portfolio#robots';
          }}
          onExport={cycle.data?.searchRunId ? exportCycleSearch : undefined}
          exporting={cycleExporting}
          exportError={cycleExportError}
        />
      ) : null}
      <ConfirmDialog
        open={Boolean(cancelTarget)}
        title="Отменить цикл ИИ?"
        description="Цикл остановится, незавершённые шаги будут пропущены. После этого можно запустить новый цикл."
        confirmLabel="Отменить цикл"
        busy={cancelCycle.isPending}
        error={cancelError}
        onConfirm={() => {
          if (cancelTarget) cancelCycle.mutate(cancelTarget.cycleId);
        }}
        onCancel={() => {
          if (!cancelCycle.isPending) {
            setCancelTarget(null);
            setCancelError(null);
          }
        }}
      />

      {cycle.data?.status === 'succeeded' && cycle.data.recommended > 0 ? (
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)]">
          <RecommendationsSection onChanged={() => invalidateAi(queryClient)} />
          <AiBotsSection
            health={botHealth.data}
            loading={botHealth.isPending}
            error={botHealth.isError}
            onRetry={() => void botHealth.refetch()}
            onOpenSearch={() => setDrawer('search')}
          />
        </div>
      ) : null}

      <Drawer
        open={drawer === 'universe'}
        onClose={() => setDrawer(null)}
        title="Вселенная ИИ"
        size="lg"
      >
        <UniverseSection
          tokens={tokenRows}
          watchlistEntries={watchlist.data?.data ?? []}
          onChanged={() => invalidateAi(queryClient)}
        />
      </Drawer>

      <Drawer
        open={drawer === 'data'}
        onClose={() => setDrawer(null)}
        title="Данные и покрытие"
        size="xl"
      >
        <DataSection
          coverage={coverage.data}
          loading={coverage.isPending}
          error={coverage.isError}
          onRetry={() => void coverage.refetch()}
          onChanged={() => invalidateAi(queryClient)}
        />
      </Drawer>

      <Drawer
        open={drawer === 'settings'}
        onClose={() => setDrawer(null)}
        title="Настройки ИИ"
        size="xl"
      >
        {profile ? (
          <SettingsSection profile={profile} onSaved={() => invalidateAi(queryClient)} />
        ) : (
          <ErrorState
            message={
              dashboard.isError
                ? toRussianError(dashboard.error, 'Не удалось загрузить профиль')
                : 'Профиль ещё загружается'
            }
            onRetry={() => void dashboard.refetch()}
          />
        )}
      </Drawer>

      <Drawer
        open={drawer === 'search'}
        onClose={() => setDrawer(null)}
        title="Ручной поиск"
        size="xl"
      >
        <SearchSection
          tokens={tokenRows}
          coverage={coverage.data}
          onChanged={() => invalidateAi(queryClient)}
        />
      </Drawer>

      <Drawer
        open={drawer === 'history'}
        onClose={() => setDrawer(null)}
        title="История циклов"
        size="lg"
      >
        <AiCycleHistory
          enabled={drawer === 'history'}
          onSelect={(id) => {
            selectCycle(id);
            setDrawer(null);
          }}
        />
      </Drawer>
    </div>
  );
}

const cycleStepLabels: Record<AiCycleStep['key'], string> = {
  data: 'Данные',
  search: 'Поиск',
  recommendations: 'Рекомендации',
  drafts: 'Черновики',
};

const rejectionLabels: Record<string, string> = {
  'too few trades': 'мало сделок',
  'too few entry signals': 'мало входных сигналов',
  'too few probe trades': 'мало сделок в пробе',
  'budget cap': 'отсечено бюджетом полного прогона',
  'non-positive OOS median': 'медиана OOS ≤ 0',
  'unstable folds': 'нестабильные фолды',
  'drawdown too high': 'просадка выше лимита',
  'worst fold too deep': 'худший фолд слишком глубокий',
  'negative holdout': 'отрицательный holdout',
  'holdout drawdown too high': 'просадка на holdout выше лимита',
  'holdout blocks unstable': 'меньше двух положительных блоков',
  'holdout too few active blocks': 'меньше двух активных блоков',
  'holdout recent block negative': 'последний 15-дневный блок отрицательный',
  'holdout blocks unavailable': 'блоки holdout недоступны',
  'non-positive policy score': 'policyScore ≤ 0',
  'holdout failed': 'ошибка holdout',
  'backtest failed': 'ошибка бэктеста',
};

function rejectionLabel(reason: string): string {
  return rejectionLabels[reason] ?? reason;
}

const cycleStepStatusLabels: Record<AiCycleStep['status'], string> = {
  queued: 'ожидает',
  running: 'идёт',
  succeeded: 'готово',
  failed: 'ошибка',
  skipped: 'пропущен',
};

const cycleStatusLabels: Record<AiCycleStatus['status'], string> = {
  queued: 'в очереди',
  running: 'выполняется',
  succeeded: 'готово',
  failed: 'ошибка',
  cancelled: 'отменён',
};

function stepProgressPct(step: AiCycleStep): number | null {
  if (step.status === 'skipped') return null;
  if (typeof step.progressPct === 'number') return step.progressPct;
  if (step.status === 'succeeded') return 100;
  if (step.status === 'running') return 0;
  return null;
}

function cycleStatusTone(
  status: AiCycleStatus['status'],
): 'neutral' | 'info' | 'success' | 'danger' {
  if (status === 'succeeded') return 'success';
  if (status === 'failed') return 'danger';
  if (status === 'running') return 'info';
  return 'neutral';
}

function cycleErrorText(error: string): string {
  if (error === 'AI_CYCLE_STALE') {
    return 'Цикл прерван: превышено время ожидания. Запустите новый цикл.';
  }
  if (error === 'AI_CYCLE_DB_UNAVAILABLE') {
    return 'База данных временно недоступна. Подождите минуту и запустите цикл ещё раз.';
  }
  if (/^Failed query/i.test(error) || /^params:/i.test(error)) {
    return 'Временная ошибка базы данных. Запустите цикл ещё раз.';
  }
  return error;
}

function cycleStepTone(
  status: AiCycleStep['status'],
): 'neutral' | 'info' | 'success' | 'danger' | 'warning' {
  if (status === 'succeeded') return 'success';
  if (status === 'failed') return 'danger';
  if (status === 'running') return 'info';
  if (status === 'skipped') return 'warning';
  return 'neutral';
}

function AiCycleCard({
  cycle,
  loading,
  errorText,
  onRetry,
  onClear,
  onCancel,
  onOpenBots,
  onExport,
  exporting,
  exportError,
}: {
  cycle: AiCycleStatus | null;
  loading: boolean;
  errorText: string | null;
  onRetry: () => void;
  onClear: () => void;
  onCancel: () => void;
  onOpenBots: () => void;
  onExport?: () => void;
  exporting?: boolean;
  exportError?: string | null;
}) {
  if (loading) return <LoadingRows rows={2} />;
  if (!cycle) {
    return (
      <Card className="p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <CardTitle>Цикл ИИ</CardTitle>
            <CardDescription>
              Запусти один раз: данные, поиск, рекомендации и черновики. Старт роботов — вручную.
            </CardDescription>
          </div>
          {errorText ? (
            <div className="flex items-center gap-3">
              <button type="button" className="text-xs text-red-700 underline" onClick={onRetry}>
                Статус цикла не загрузился · Повторить
              </button>
              <button type="button" className="text-xs text-zinc-500 underline" onClick={onClear}>
                Сбросить
              </button>
            </div>
          ) : (
            <Badge tone="neutral">Готов</Badge>
          )}
        </div>
        {errorText ? <p className="mt-2 text-xs text-red-700">{errorText}</p> : null}
      </Card>
    );
  }
  const succeeded = cycle.steps.filter((step) => step.status === 'succeeded').length;
  const tone = cycleStatusTone(cycle.status);
  return (
    <Card className="p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <CardTitle>Цикл ИИ</CardTitle>
          <Badge tone={tone}>{cycleStatusLabels[cycle.status]}</Badge>
          <span className="text-xs text-zinc-500">
            {succeeded} / {cycle.steps.length} шагов · {formatDateTime(cycle.createdAt)}
          </span>
        </div>
        <div className="flex items-center gap-3">
          {cycle.searchRunId && onExport ? (
            <button
              type="button"
              className="text-xs text-zinc-500 underline disabled:opacity-50"
              onClick={onExport}
              disabled={exporting}
            >
              {exporting ? 'Экспортирую…' : 'Экспорт JSON'}
            </button>
          ) : null}
          {cycle.status === 'queued' || cycle.status === 'running' ? (
            <button type="button" className="text-xs text-red-700 underline" onClick={onCancel}>
              Отменить
            </button>
          ) : null}
          {cycle.status === 'succeeded' ? (
            <button
              type="button"
              className="text-xs text-emerald-700 underline"
              onClick={onOpenBots}
            >
              Открыть черновики
            </button>
          ) : null}
          {cycle.status !== 'queued' && cycle.status !== 'running' ? (
            <button type="button" className="text-xs text-zinc-500 underline" onClick={onClear}>
              Сбросить
            </button>
          ) : null}
        </div>
      </div>
      {exportError ? <p className="mt-2 text-[11px] text-red-700">{exportError}</p> : null}
      {errorText ? (
        <p className="mt-2 text-[11px] text-amber-700">
          Статус не обновился: {errorText}{' '}
          <button type="button" className="underline" onClick={onRetry}>
            Повторить
          </button>
        </p>
      ) : null}
      <div className="mt-2 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        {cycle.steps.map((step) => {
          const progress = stepProgressPct(step);
          const active = step.status === 'running';
          const failed = step.status === 'failed';
          const searchStageLabel =
            step.key === 'search' && step.stage ? aiSearchFunnelStageLabels[step.stage] : null;
          return (
            <div
              key={step.key}
              className={`rounded-lg border px-2.5 py-2 ${
                active ? 'border-emerald-300 bg-emerald-50/40' : 'border-zinc-200'
              }`}
            >
              <div className="flex items-center gap-1.5">
                <Badge tone={cycleStepTone(step.status)}>
                  {cycleStepStatusLabels[step.status]}
                </Badge>
                <span
                  className={
                    active && searchStageLabel
                      ? 'text-sm font-semibold text-zinc-900'
                      : 'text-xs font-medium text-zinc-800'
                  }
                >
                  {active && searchStageLabel ? searchStageLabel : cycleStepLabels[step.key]}
                </span>
                {active && searchStageLabel ? (
                  <span className="text-[10px] uppercase tracking-wide text-zinc-400">Поиск</span>
                ) : null}
              </div>
              {step.message ? (
                <div className="mt-1 text-[11px] text-zinc-500">{step.message}</div>
              ) : null}
              {step.error ? (
                <div className="mt-1 text-[11px] text-red-700">{cycleErrorText(step.error)}</div>
              ) : null}
              {progress !== null ? (
                <div className="mt-2">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-[10px] uppercase tracking-wide text-zinc-400">
                      Прогресс
                    </span>
                    <span
                      className={`text-lg font-semibold ${
                        failed ? 'text-red-700' : 'text-emerald-700'
                      }`}
                    >
                      {progress}%
                    </span>
                  </div>
                  <div className="mt-1 h-1 overflow-hidden rounded-full bg-zinc-100">
                    <div
                      className={`h-full rounded-full transition-all ${
                        failed ? 'bg-red-500' : 'bg-emerald-500'
                      }`}
                      style={{ width: `${progress}%` }}
                    />
                  </div>
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
      {cycle.error ? (
        <p className="mt-2 rounded-lg border border-red-200 bg-red-50 px-2 py-1.5 text-xs text-red-700">
          {cycleErrorText(cycle.error)}
        </p>
      ) : null}
      {cycle.oosPassed > 0 ? (
        <div className="mt-2 text-[11px] text-zinc-500">
          Прошли OOS: {cycle.oosPassed} · допущено к holdout: {cycle.holdoutTested} · не
          тестировались: {Math.max(0, cycle.oosPassed - cycle.holdoutTested)}
          {cycle.settlementDays > 0
            ? ` · holdout ${cycle.holdoutCycles}×15 (10+${cycle.settlementDays})`
            : ''}
        </div>
      ) : null}
      {cycle.status === 'succeeded' ? (
        <p className="mt-2 text-xs text-zinc-500">
          Рекомендаций: {cycle.recommended} · создано черновиков: {cycle.draftsCreated}. Старт
          роботов остаётся за тобой.
        </p>
      ) : null}
      {cycle.recommended === 0 && Object.keys(cycle.rejectionReasons).length > 0 ? (
        <div className="mt-2 rounded-lg bg-zinc-50 px-2 py-1.5 text-[11px] text-zinc-600">
          <span className="font-medium text-zinc-700">Почему 0 рекомендаций:</span>{' '}
          {Object.entries(cycle.rejectionReasons)
            .sort((left, right) => right[1] - left[1])
            .map(([reason, count]) => `${rejectionLabel(reason)} — ${count}`)
            .join(' · ')}
        </div>
      ) : null}
      {(cycle.nearMisses ?? []).length > 0 ? (
        <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50/50 px-2 py-1.5 text-[11px] text-amber-900">
          <div className="font-medium">Почти прошли, но не рекомендации</div>
          <div className="mt-1 flex flex-col gap-0.5">
            {(cycle.nearMisses ?? []).slice(0, 3).map((item, index) => (
              <span key={`${item.strategyKey}-${index}`}>
                {item.strategyName}: OOS {formatPct(item.oosMedianReturnPct)} · holdout{' '}
                {item.holdoutReturnPct === null ? '—' : formatPct(item.holdoutReturnPct)}
                {item.holdoutDrawdownPct === null
                  ? ''
                  : ` · DD ${formatPct(item.holdoutDrawdownPct)}`}
                {item.holdoutBlocksTotal > 0
                  ? ` · блоки ${holdoutBlockSummary(item.holdoutBlockReturnsPct)} (${holdoutConsistencyLabel(item.holdoutBlocksPositive, item.holdoutBlocksTotal)} поз. / ${holdoutActiveLabel(item.holdoutBlocksTraded, item.holdoutBlocksTotal)} акт.)`
                  : ''}{' '}
                · {item.reasons.map(rejectionLabel).join(', ')}
              </span>
            ))}
          </div>
        </div>
      ) : null}
    </Card>
  );
}

function AiCycleHistory({
  enabled,
  onSelect,
}: {
  enabled: boolean;
  onSelect: (id: string) => void;
}) {
  const query = useQuery({
    queryKey: ['ai-cycles'],
    queryFn: fetchAiCycles,
    enabled,
    retry: 1,
    refetchInterval: 60_000,
  });
  const items = query.data?.data ?? [];

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-zinc-500">
          Последние циклы. Выбери запуск, чтобы открыть его шаги и ошибку.
        </p>
        <Button variant="ghost" className="h-8 px-2.5 text-xs" onClick={() => void query.refetch()}>
          Обновить
        </Button>
      </div>
      {query.isPending ? <LoadingRows rows={5} /> : null}
      {query.isError ? (
        <ErrorState
          message={toRussianError(query.error, 'Не удалось загрузить историю циклов')}
          onRetry={() => void query.refetch()}
        />
      ) : null}
      {!query.isPending && !query.isError && items.length === 0 ? (
        <p className="text-sm text-zinc-500">
          Циклов пока нет. Запусти первый цикл на странице ИИ-торговли.
        </p>
      ) : null}
      <div className="space-y-2">
        {items.map((item) => (
          <CycleHistoryRow key={item.cycleId} item={item} onSelect={onSelect} />
        ))}
      </div>
    </div>
  );
}

function CycleHistoryRow({
  item,
  onSelect,
}: {
  item: AiCycleSummary;
  onSelect: (id: string) => void;
}) {
  const succeeded = item.steps.filter((step) => step.status === 'succeeded').length;

  return (
    <button
      type="button"
      onClick={() => onSelect(item.cycleId)}
      className="w-full rounded-xl border border-zinc-200 px-3 py-2 text-left transition hover:border-emerald-300"
    >
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={cycleStatusTone(item.status)}>{cycleStatusLabels[item.status]}</Badge>
        <span className="text-sm font-medium text-zinc-800">
          {item.symbol} · {item.timeframe}
        </span>
        <span className="text-[11px] text-zinc-500">{formatDateTime(item.createdAt)}</span>
      </div>
      <div className="mt-1 text-[11px] text-zinc-500">
        Шагов: {succeeded} / {item.steps.length} · рекомендаций: {item.recommended} · черновиков:{' '}
        {item.draftsCreated}
      </div>
      {item.error ? (
        <div className="mt-1 text-[11px] text-red-700">{cycleErrorText(item.error)}</div>
      ) : null}
    </button>
  );
}

function UniverseSection({
  tokens,
  watchlistEntries,
  onChanged,
}: {
  tokens: AiProfileToken[];
  watchlistEntries: WatchlistEntry[];
  onChanged: () => void;
}) {
  const [assetId, setAssetId] = useState('');
  const [timeframes, setTimeframes] = useState<AiTimeframe[]>(['1h', '4h']);
  const [priority, setPriority] = useState('0');
  const [error, setError] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<AiProfileToken | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const existingIds = new Set(tokens.map((token) => token.asset.id));
  const options = watchlistEntries.filter((entry) => !existingIds.has(entry.asset.id));

  const add = useMutation({
    mutationFn: () =>
      createAiToken({
        assetId,
        timeframes,
        priority: Number(priority) || 0,
        enabled: true,
      }),
    onSuccess: () => {
      setAssetId('');
      setTimeframes(['1h', '4h']);
      setPriority('0');
      setError(null);
      onChanged();
    },
    onError: (err) => setError(toRussianError(err, 'Не удалось добавить токен')),
  });

  const update = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Parameters<typeof updateAiToken>[1] }) =>
      updateAiToken(id, body),
    onSuccess: onChanged,
  });

  const remove = useMutation({
    mutationFn: (id: string) => removeAiToken(id),
    onSuccess: () => {
      setDeleteTarget(null);
      setDeleteError(null);
      onChanged();
    },
    onError: (err) => setDeleteError(toRussianError(err, 'Не удалось удалить токен')),
  });

  return (
    <Card>
      <CardTitle>AI-вселенная</CardTitle>
      <CardDescription>
        Отдельный список токенов для ИИ. Не связан с группой «Основная». До 5 токенов на одного
        ИИ-бота.
      </CardDescription>

      <div className="mt-4 grid gap-3 md:grid-cols-[1fr_auto_auto]">
        <Select
          value={assetId}
          onChange={(event) => setAssetId(event.target.value)}
          aria-label="Токен"
        >
          <option value="">Выберите токен</option>
          {options.map((entry) => (
            <option key={entry.asset.id} value={entry.asset.id}>
              {entry.asset.symbol} · {entry.asset.name}
            </option>
          ))}
        </Select>
        <Input
          className="w-24"
          type="number"
          min={0}
          max={100}
          value={priority}
          onChange={(event) => setPriority(event.target.value)}
          aria-label="Приоритет токена"
        />
        <Button disabled={!assetId || add.isPending} onClick={() => add.mutate()}>
          {add.isPending ? 'Добавляю…' : 'Добавить'}
        </Button>
      </div>
      <div className="mt-2 flex flex-wrap gap-3">
        {timeframeOptions.map((timeframe) => (
          <label key={timeframe} className="flex items-center gap-1.5 text-xs text-zinc-600">
            <input
              type="checkbox"
              checked={timeframes.includes(timeframe)}
              onChange={(event) =>
                setTimeframes((current) =>
                  event.target.checked
                    ? [...current, timeframe]
                    : current.filter((item) => item !== timeframe),
                )
              }
            />
            {timeframe}
          </label>
        ))}
      </div>
      {error ? <p className="mt-2 text-sm text-red-700">{error}</p> : null}

      <div className="mt-4 space-y-2">
        {tokens.length === 0 ? (
          <p className="text-sm text-zinc-500">Список пока пуст.</p>
        ) : (
          tokens.map((token) => (
            <div
              key={token.id}
              className={`flex flex-wrap items-center gap-3 rounded-xl border border-zinc-200 px-3 py-2 ${
                token.enabled ? '' : 'opacity-55'
              }`}
            >
              <TokenIcon
                logoUrl={token.asset.logoUrl}
                symbol={token.asset.symbol}
                className="h-8 w-8 text-[9px]"
              />
              <div className="min-w-[150px] flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-semibold text-zinc-900">{token.asset.symbol}</span>
                  {token.timeframes.map((timeframe) => (
                    <Badge key={timeframe} tone="info">
                      {timeframe}
                    </Badge>
                  ))}
                </div>
                <div className="text-[11px] text-zinc-500">
                  {token.asset.name} · приоритет {token.priority}
                </div>
              </div>
              <Switch
                checked={token.enabled}
                onChange={(enabled) => update.mutate({ id: token.id, body: { enabled } })}
                label={`Включить ${token.asset.symbol}`}
              />
              <Button
                variant="ghost"
                className="h-8 w-8 px-0 text-zinc-500 hover:text-red-700"
                aria-label={`Удалить ${token.asset.symbol} из вселенной`}
                title="Удалить из вселенной"
                disabled={remove.isPending}
                onClick={() => {
                  setDeleteError(null);
                  setDeleteTarget(token);
                }}
              >
                <TrashIcon />
              </Button>
            </div>
          ))
        )}
      </div>
      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title="Удалить токен из вселенной?"
        description={
          deleteTarget
            ? `${deleteTarget.asset.symbol} будет удалён из AI-вселенной. История поисков, свечи, роботы и рекомендации сохранятся.`
            : ''
        }
        confirmLabel="Удалить токен"
        busy={remove.isPending}
        error={deleteError}
        onConfirm={() => {
          if (deleteTarget) remove.mutate(deleteTarget.id);
        }}
        onCancel={() => {
          if (!remove.isPending) {
            setDeleteTarget(null);
            setDeleteError(null);
          }
        }}
      />
    </Card>
  );
}

function percentMagnitude(value: string | null | undefined): string {
  if (value === null || value === undefined || value === '') return '—';
  const number = Number(value);
  return Number.isFinite(number) ? `${number.toFixed(2)}%` : '—';
}

function downloadJson(filename: string, value: unknown): void {
  const blob = new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function LabFeature({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-zinc-50 px-2.5 py-2">
      <div className="text-[10px] uppercase tracking-wide text-zinc-400">{label}</div>
      <div className="mt-0.5 text-sm font-medium text-zinc-800">{value}</div>
    </div>
  );
}

function AiBotsSection({
  health,
  loading,
  error,
  onRetry,
  onOpenSearch,
}: {
  health: AiBotHealthResponse | undefined;
  loading: boolean;
  error: boolean;
  onRetry: () => void;
  onOpenSearch: () => void;
}) {
  const [filter, setFilter] = useState<'all' | 'attention'>('all');
  const items = health?.data ?? [];
  const attention = items.filter((item) => item.level !== 'ok');
  const visible = filter === 'attention' ? attention : items;

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <CardTitle>Мои ИИ-роботы</CardTitle>
            <CardDescription>
              Роботы, созданные из рекомендаций. Health-монитор советует остановить или
              пересмотреть, но никогда не останавливает автоматически. Повторные уведомления по тем
              же причинам приходят не чаще раза в 6 часов.
            </CardDescription>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Select
              className="h-9 w-44"
              value={filter}
              onChange={(event) => setFilter(event.target.value as 'all' | 'attention')}
              aria-label="Фильтр здоровья ИИ-роботов"
            >
              <option value="all">Все ({items.length})</option>
              <option value="attention">Требуют внимания ({attention.length})</option>
            </Select>
            <Button variant="secondary" className="h-9 px-3 text-xs" onClick={onRetry}>
              Обновить
            </Button>
          </div>
        </div>
        <div className="mt-3 grid gap-2 sm:grid-cols-3">
          <LabFeature label="Всего" value={String(items.length)} />
          <LabFeature
            label="Пересмотр"
            value={String(items.filter((item) => item.level === 'review').length)}
          />
          <LabFeature
            label="Остановить"
            value={String(items.filter((item) => item.level === 'stop').length)}
          />
        </div>
      </Card>

      {loading ? (
        <LoadingRows rows={3} />
      ) : error ? (
        <Card>
          <ErrorState message="Не удалось загрузить здоровье ИИ-роботов" onRetry={onRetry} />
        </Card>
      ) : items.length === 0 ? (
        <Card>
          <CardTitle>Пока нет ИИ-роботов</CardTitle>
          <CardDescription>
            Создайте черновик из рекомендации в разделе «Поиск» и запустите его вручную.
          </CardDescription>
          <Button className="mt-3" onClick={onOpenSearch}>
            Перейти к поиску
          </Button>
        </Card>
      ) : visible.length === 0 ? (
        <Card>
          <p className="text-sm text-zinc-500">Нет роботов, требующих внимания.</p>
        </Card>
      ) : (
        <div className="space-y-2">
          {visible.map((item) => (
            <AiBotHealthRow key={item.botId} item={item} />
          ))}
        </div>
      )}
    </div>
  );
}

function AiBotHealthRow({ item }: { item: AiBotHealth }) {
  const tone = item.level === 'stop' ? 'danger' : item.level === 'review' ? 'warning' : 'success';
  const label =
    item.level === 'stop' ? 'Остановить' : item.level === 'review' ? 'Пересмотр' : 'Норма';
  return (
    <div className="rounded-xl border border-zinc-200 px-3 py-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-semibold text-zinc-900">{item.name}</span>
          <Badge tone={tone}>{label}</Badge>
          <span className="text-xs text-zinc-500">
            {item.status} · P&L {formatPct(item.totalPnlPct)}
            {item.horizonDays === null ? '' : ` · горизонт ${item.horizonDays} дн.`}
          </span>
        </div>
        <a className="text-xs text-emerald-700 underline" href="/portfolio#robots">
          Открыть
        </a>
      </div>
      {item.reasons.length === 0 ? (
        <p className="mt-1 text-xs text-zinc-500">Инвалидации не обнаружены.</p>
      ) : (
        <ul className="mt-1 space-y-0.5 text-xs text-zinc-600">
          {item.reasons.map((reason) => (
            <li key={reason.code}>
              <span className="font-medium text-zinc-700">{reason.label}:</span> {reason.detail}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

interface RecommendationTarget {
  id: string;
  strategyKey: string;
  strategyName: string;
  params: Record<string, unknown>;
  oosMedianReturnPct: string;
  stabilityPct: string;
  maxDrawdownPct: string;
  holdoutReturnPct: string | null;
  assetId: string;
  symbol: string;
  timeframe: string;
}

function RecommendationAcceptDrawer({
  target,
  onClose,
  onCreated,
}: {
  target: RecommendationTarget | null;
  onClose: () => void;
  onCreated: (bot: { id: string; name: string }) => void;
}) {
  const [name, setName] = useState('');
  const [budget, setBudget] = useState('1000');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!target) return;
    setName(`${target.symbol} · ${target.strategyName}`);
    setBudget('1000');
    setError(null);
  }, [target]);

  const accept = useMutation({
    mutationFn: () => {
      if (!target) throw new Error('No recommendation selected');
      return createTradingBot({
        name: name.trim(),
        description: `Рекомендация ИИ: ${target.strategyName}, OOS ${target.oosMedianReturnPct}%, стабильность ${target.stabilityPct}%.`,
        strategyKey: target.strategyKey as BotCreateRequest['strategyKey'],
        strategyParams: target.params,
        tokenAssetIds: [target.assetId],
        budgetUsd: budget,
        maxPositions: 5,
        positionSizePct: 20,
        feeBps: 25,
        slippageBps: 10,
        maxDailyLossPct: 10,
        cooldownMinutes: 15,
        aiCandidateId: target.id,
      });
    },
    onSuccess: (result) => {
      onCreated({ id: result.bot.id, name: result.bot.name });
      onClose();
    },
    onError: (err) => setError(toRussianError(err, 'Не удалось создать черновик')),
  });

  return (
    <Drawer
      open={Boolean(target)}
      onClose={() => {
        if (!accept.isPending) onClose();
      }}
      title="Создать черновик робота"
      description="Рекомендация предзаполнит стратегию, параметры и токен. Робот останется черновиком, пока вы не запустите его вручную."
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="secondary" disabled={accept.isPending} onClick={onClose}>
            Отмена
          </Button>
          <Button
            disabled={accept.isPending || name.trim().length === 0}
            onClick={() => accept.mutate()}
          >
            {accept.isPending ? 'Создаю…' : 'Создать черновик'}
          </Button>
        </div>
      }
    >
      {target ? (
        <div className="space-y-3">
          <label className="block text-xs text-zinc-600">
            Название
            <Input
              className="mt-1"
              value={name}
              maxLength={120}
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          <label className="block text-xs text-zinc-600">
            Бюджет, USD
            <Input
              className="mt-1"
              inputMode="decimal"
              value={budget}
              onChange={(event) => setBudget(event.target.value)}
            />
          </label>
          <div className="rounded-lg bg-zinc-50 px-3 py-2 text-xs text-zinc-600">
            <div>
              Стратегия: <span className="text-zinc-900">{target.strategyName}</span>
            </div>
            <div>Токен: {target.symbol}</div>
            <div>Таймфрейм: {target.timeframe}</div>
            <div>
              OOS: {formatPct(target.oosMedianReturnPct)} · DD{' '}
              {percentMagnitude(target.maxDrawdownPct)} · Holdout{' '}
              {target.holdoutReturnPct === null ? '—' : formatPct(target.holdoutReturnPct)}
            </div>
          </div>
          <p className="text-xs text-zinc-500">
            Минимальный бюджет — 100 USD. После создания робот появится в разделе «Роботы» в статусе
            «Черновик».
          </p>
          {error ? <p className="text-sm text-red-700">{error}</p> : null}
        </div>
      ) : null}
    </Drawer>
  );
}

function RecommendationsSection({ onChanged }: { onChanged: () => void }) {
  const query = useQuery({
    queryKey: ['ai-recommendations'],
    queryFn: fetchAiRecommendations,
    refetchInterval: 60_000,
    retry: 1,
  });
  const [filter, setFilter] = useState<'active' | 'accepted' | 'expired' | 'all'>('active');
  const [target, setTarget] = useState<RecommendationTarget | null>(null);
  const [createdBot, setCreatedBot] = useState<{ id: string; name: string } | null>(null);
  const [rejectTarget, setRejectTarget] = useState<AiRecommendation | null>(null);
  const [error, setError] = useState<string | null>(null);
  const reject = useMutation({
    mutationFn: (id: string) => rejectAiRecommendation(id),
    onSuccess: () => {
      setRejectTarget(null);
      setError(null);
      onChanged();
    },
    onError: (err) => setError(toRussianError(err, 'Не удалось отклонить рекомендацию')),
  });

  const items = query.data?.data ?? [];
  const active = items.filter((item) => item.status === 'recommended' && !item.expired);
  const accepted = items.filter((item) => item.status === 'accepted');
  const expired = items.filter((item) => item.status === 'recommended' && item.expired);
  const visible =
    filter === 'active'
      ? active
      : filter === 'accepted'
        ? accepted
        : filter === 'expired'
          ? expired
          : items;

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <CardTitle>Рекомендации</CardTitle>
            <CardDescription>
              Активные и принятые рекомендации. Принятие создаёт черновик робота и не запускает его.
            </CardDescription>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Select
              className="h-9 w-44"
              value={filter}
              onChange={(event) =>
                setFilter(event.target.value as 'active' | 'accepted' | 'expired' | 'all')
              }
              aria-label="Фильтр рекомендаций"
            >
              <option value="active">Активные ({active.length})</option>
              <option value="accepted">Принятые ({accepted.length})</option>
              <option value="expired">Истёкшие ({expired.length})</option>
              <option value="all">Все ({items.length})</option>
            </Select>
            <Button
              variant="secondary"
              className="h-9 px-3 text-xs"
              onClick={() => void query.refetch()}
            >
              Обновить
            </Button>
          </div>
        </div>
      </Card>

      {createdBot ? (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 px-3 py-2 text-sm text-emerald-800">
          Черновик «{createdBot.name}» создан и не запущен.{' '}
          <a className="underline" href="/portfolio#robots">
            Открыть роботов
          </a>{' '}
          и запустить вручную.
        </div>
      ) : null}

      {query.isPending ? (
        <LoadingRows rows={3} />
      ) : query.isError ? (
        <Card>
          <ErrorState
            message={toRussianError(query.error, 'Не удалось загрузить рекомендации')}
            onRetry={() => void query.refetch()}
          />
        </Card>
      ) : visible.length === 0 ? (
        <Card>
          <p className="text-sm text-zinc-500">
            {filter === 'active'
              ? 'Нет активных рекомендаций. Запустите поиск или дождитесь нового анализа.'
              : 'В этом фильтре пока нет рекомендаций.'}
          </p>
        </Card>
      ) : (
        <div className="space-y-2">
          {visible.map((item) => (
            <RecommendationCard
              key={item.id}
              item={item}
              onAccept={() =>
                setTarget({
                  id: item.id,
                  strategyKey: item.strategyKey,
                  strategyName: item.strategyName,
                  params: item.params,
                  oosMedianReturnPct: item.oosMedianReturnPct,
                  stabilityPct: item.stabilityPct,
                  maxDrawdownPct: item.maxDrawdownPct,
                  holdoutReturnPct: item.holdoutReturnPct,
                  assetId: item.assetId,
                  symbol: item.symbol,
                  timeframe: item.timeframe,
                })
              }
              onReject={() => {
                setError(null);
                setRejectTarget(item);
              }}
            />
          ))}
        </div>
      )}

      <RecommendationAcceptDrawer
        target={target}
        onClose={() => setTarget(null)}
        onCreated={(bot) => {
          setCreatedBot(bot);
          onChanged();
        }}
      />
      <ConfirmDialog
        open={Boolean(rejectTarget)}
        title="Отклонить рекомендацию?"
        description={
          rejectTarget
            ? `${rejectTarget.symbol} · ${rejectTarget.strategyName}. Она исчезнет из активных, создать робота из неё будет нельзя.`
            : ''
        }
        confirmLabel="Отклонить"
        busy={reject.isPending}
        error={error}
        onConfirm={() => {
          if (rejectTarget) reject.mutate(rejectTarget.id);
        }}
        onCancel={() => setRejectTarget(null)}
      />
    </div>
  );
}

function RecommendationCard({
  item,
  onAccept,
  onReject,
}: {
  item: AiRecommendation;
  onAccept: () => void;
  onReject: () => void;
}) {
  const tone =
    item.status === 'accepted'
      ? 'info'
      : item.status === 'recommended' && !item.expired
        ? 'success'
        : item.status === 'rejected'
          ? 'danger'
          : 'warning';
  const label =
    item.status === 'accepted'
      ? 'Принята'
      : item.status === 'recommended'
        ? item.expired
          ? 'Истекла'
          : 'Активна'
        : item.status === 'rejected'
          ? 'Отклонена'
          : item.status === 'proposed'
            ? 'Предложена'
            : item.status === 'backtested'
              ? 'Бэктест'
              : item.status;
  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold text-zinc-900">
              {item.symbol} · {item.name}
            </span>
            <Badge tone={tone}>{label}</Badge>
            {item.holdoutBlocksTotal > 0 ? (
              <Badge
                tone={
                  item.holdoutBlocksPositive === item.holdoutBlocksTotal &&
                  item.holdoutBlocksTraded === item.holdoutBlocksTotal
                    ? 'success'
                    : 'warning'
                }
              >
                holdout{' '}
                {holdoutConsistencyLabel(item.holdoutBlocksPositive, item.holdoutBlocksTotal)} ·{' '}
                {holdoutActiveLabel(item.holdoutBlocksTraded, item.holdoutBlocksTotal)} акт.
              </Badge>
            ) : null}
            <span className="text-xs text-zinc-500">
              {item.timeframe} · {item.strategyName}
            </span>
          </div>
          <div className="mt-0.5 text-[11px] text-zinc-500">
            Создана {formatDateTime(item.createdAt)} · действует до {formatDateTime(item.expiresAt)}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {item.linkedBotId ? (
            <a className="text-xs text-emerald-700 underline" href="/portfolio#robots">
              Открыть робота
            </a>
          ) : null}
          {item.status === 'recommended' && !item.expired ? (
            <>
              <Button variant="secondary" className="h-8 px-3 text-xs" onClick={onAccept}>
                Создать черновик
              </Button>
              <Button variant="ghost" className="h-8 px-2 text-xs" onClick={onReject}>
                Отклонить
              </Button>
            </>
          ) : null}
        </div>
      </div>
      <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        <LabFeature label="OOS медиана" value={formatPct(item.oosMedianReturnPct)} />
        <LabFeature label="Средний OOS" value={formatPct(item.oosMeanReturnPct)} />
        <LabFeature label="Худший OOS" value={formatPct(item.oosWorstReturnPct)} />
        <LabFeature label="Макс. DD" value={percentMagnitude(item.maxDrawdownPct)} />
        <LabFeature label="Сделок" value={String(item.trades)} />
        <LabFeature label="Стабильность" value={percentMagnitude(item.stabilityPct)} />
        <LabFeature
          label="Holdout"
          value={item.holdoutReturnPct === null ? '—' : formatPct(item.holdoutReturnPct)}
        />
        <LabFeature
          label="Блоки 15д"
          value={
            item.holdoutBlocksTotal > 0
              ? `${holdoutBlockSummary(item.holdoutBlockReturnsPct)} · ${holdoutConsistencyLabel(item.holdoutBlocksPositive, item.holdoutBlocksTotal)} поз. / ${holdoutActiveLabel(item.holdoutBlocksTraded, item.holdoutBlocksTotal)} акт.`
              : '—'
          }
        />
        <LabFeature label="Policy" value={item.policyScore} />
        <LabFeature label="Аллокация" value={formatUsd(item.suggestedAllocationUsd)} />
      </div>
      <details className="mt-2 text-xs text-zinc-600">
        <summary className="cursor-pointer text-zinc-500">Правила инвалидации</summary>
        <ul className="mt-1 space-y-1">
          {item.invalidationRules.map((rule) => (
            <li key={rule.code} className="flex flex-wrap gap-1.5">
              <Badge tone={rule.severity === 'stop' ? 'danger' : 'warning'}>
                {rule.severity === 'stop' ? 'стоп' : 'review'}
              </Badge>
              <span className="font-medium text-zinc-700">{rule.label}:</span>
              <span>{rule.detail}</span>
            </li>
          ))}
        </ul>
      </details>
    </Card>
  );
}

function SearchSection({
  tokens,
  coverage,
  onChanged,
}: {
  tokens: AiProfileToken[];
  coverage: AiCoverage | undefined;
  onChanged: () => void;
}) {
  const searchable = tokens.filter(
    (token) =>
      token.enabled &&
      token.timeframes.some((timeframe) => timeframe === '1h' || timeframe === '4h'),
  );
  const [assetId, setAssetId] = useState(searchable[0]?.asset.id ?? '');
  const selected = searchable.find((token) => token.asset.id === assetId);
  const timeframes = (selected?.timeframes ?? []).filter(
    (item): item is AiSearchTimeframe => item === '1h' || item === '4h',
  );
  const [timeframe, setTimeframe] = useState<AiSearchTimeframe>(timeframes[0] ?? '1h');
  const [variants, setVariants] = useState('5000');
  const [horizon, setHorizon] = useState('5');
  const [runId, setRunId] = useState<string | null>(null);
  const [deleteRun, setDeleteRun] = useState<AiSearchRunSummary | null>(null);
  const [deleteRunError, setDeleteRunError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dataNotice, setDataNotice] = useState<string | null>(null);
  const [loadAttempt, setLoadAttempt] = useState<{
    upserted: number;
    failed: number;
    details: string[];
  } | null>(null);
  const [acceptTarget, setAcceptTarget] = useState<RecommendationTarget | null>(null);
  const [createdBot, setCreatedBot] = useState<{ id: string; name: string } | null>(null);
  const timeframeCoverage = coverage?.tokens
    .find((token) => token.assetId === assetId)
    ?.timeframes.find((item) => item.timeframe === timeframe);
  const missingData = Boolean(timeframeCoverage && timeframeCoverage.status !== 'ok');
  const requiredCandles = timeframeCoverage?.expected ?? 0;
  const availableCandles = timeframeCoverage?.candles ?? 0;
  const availableDays =
    requiredCandles > 0 ? Math.floor((availableCandles / requiredCandles) * 180) : 0;

  useEffect(() => {
    if (selected && !timeframes.includes(timeframe)) {
      setTimeframe(timeframes[0] ?? '1h');
    }
  }, [selected, timeframe, timeframes]);

  const runs = useQuery({
    queryKey: ['ai-search-runs'],
    queryFn: fetchAiSearchRuns,
    refetchInterval: 30_000,
  });

  const start = useMutation({
    mutationFn: () =>
      startAiSearch({
        assetId,
        timeframe,
        horizonDays: Number(horizon) as 1 | 3 | 5 | 10,
        variants: Number(variants),
        execution: 'next-open',
      }),
    onMutate: () => {
      setError(null);
      setDataNotice(null);
    },
    onSuccess: (result) => {
      setRunId(result.runId);
      setError(null);
      onChanged();
    },
    onError: (err) => setError(toRussianError(err, 'Не удалось запустить поиск')),
  });

  const status = useQuery({
    queryKey: ['ai-search-status', runId],
    queryFn: () => fetchAiSearchStatus(runId as string),
    enabled: Boolean(runId),
    refetchInterval: (query) => {
      const value = query.state.data?.status;
      return value === 'queued' || value === 'running' ? 1000 : false;
    },
  });

  const results = useQuery({
    queryKey: ['ai-search-results', runId],
    queryFn: () => fetchAiSearchResults(runId as string),
    enabled: Boolean(runId) && status.data?.status === 'succeeded',
  });

  const cancel = useMutation({
    mutationFn: () => cancelAiSearch(runId as string),
    onError: (err) => setError(toRussianError(err, 'Не удалось остановить поиск')),
  });

  const removeRun = useMutation({
    mutationFn: (id: string) => deleteAiSearchRun(id),
    onSuccess: (_result, id) => {
      if (runId === id) setRunId(null);
      setDeleteRun(null);
      setDeleteRunError(null);
      onChanged();
    },
    onError: (err) =>
      setDeleteRunError(toRussianError(err, 'Не удалось удалить запуск из истории')),
  });

  const loadData = useMutation({
    mutationFn: () => refreshAiData({ assetId, timeframes: [timeframe], days: 180 }),
    onMutate: () => {
      setError(null);
      setDataNotice(null);
    },
    onSuccess: (result) => {
      setLoadAttempt({
        upserted: result.upserted,
        failed: result.failed.length,
        details: result.failed.map((item) => `${item.symbol} ${item.timeframe}: ${item.reason}`),
      });
      setDataNotice(`Загружено свечей: ${result.upserted}.`);
      onChanged();
    },
    onError: (err) => setError(toRussianError(err, 'Не удалось загрузить 180 дней')),
  });

  if (searchable.length === 0) {
    return (
      <Card>
        <CardTitle>Поиск стратегий</CardTitle>
        <CardDescription>
          Добавьте включённый токен с таймфреймом 1h или 4h на вкладке «Вселенная».
        </CardDescription>
      </Card>
    );
  }

  const currentStatus = status.data;
  const currentResults: AiSearchResults | undefined = results.data;
  const funnel = currentResults?.funnel ?? null;
  const execution = currentResults?.execution ?? currentStatus?.execution ?? 'next-open';
  const running = currentStatus?.status === 'queued' || currentStatus?.status === 'running';
  const stats = currentResults?.stats ?? currentStatus?.stats;

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <CardTitle>Поиск стратегий</CardTitle>
            <CardDescription>
              Массовый подбор параметров на purged walk-forward: 150 дней поиска, 8 фолдов и
              30-дневный holdout. Рекомендация не запускает робота.
            </CardDescription>
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <label className="text-xs text-zinc-600">
              Токен
              <Select
                className="mt-1 h-9 min-w-40"
                value={assetId}
                onChange={(event) => setAssetId(event.target.value)}
                aria-label="Токен для поиска"
              >
                {searchable.map((token) => (
                  <option key={token.asset.id} value={token.asset.id}>
                    {token.asset.symbol} · {token.asset.name}
                  </option>
                ))}
              </Select>
            </label>
            <label className="text-xs text-zinc-600">
              ТФ
              <Select
                className="mt-1 h-9 w-20"
                value={timeframe}
                onChange={(event) => setTimeframe(event.target.value as AiSearchTimeframe)}
                aria-label="Таймфрейм поиска"
              >
                {timeframes.map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </Select>
            </label>
            <label className="text-xs text-zinc-600">
              Горизонт
              <Select
                className="mt-1 h-9 w-24"
                value={horizon}
                onChange={(event) => setHorizon(event.target.value)}
                aria-label="Горизонт"
              >
                <option value="1">1 день</option>
                <option value="3">3 дня</option>
                <option value="5">5 дней</option>
                <option value="10">10 дней</option>
              </Select>
            </label>
            <label className="text-xs text-zinc-600">
              Вариантов
              <Select
                className="mt-1 h-9 w-24"
                value={variants}
                onChange={(event) => setVariants(event.target.value)}
                aria-label="Количество вариантов"
              >
                <option value="100">100</option>
                <option value="500">500</option>
                <option value="1000">1 000</option>
                <option value="5000">5 000</option>
                <option value="10000">10 000</option>
                <option value="20000">20 000</option>
                <option value="50000">50 000</option>
                <option value="100000">100 000</option>
                <option value="200000">200 000</option>
              </Select>
            </label>
            <Button
              disabled={!assetId || start.isPending || running || missingData}
              title={missingData ? 'Сначала загрузите 180 дней истории' : undefined}
              onClick={() => start.mutate()}
            >
              {start.isPending ? 'Запускаю…' : missingData ? 'Нужно 180 дней' : 'Запустить поиск'}
            </Button>
          </div>
        </div>
        {missingData ? (
          <div className="mt-2 space-y-1.5 rounded-lg border border-amber-200 bg-amber-50/60 px-2.5 py-2 text-xs text-amber-800">
            <div className="flex flex-wrap items-center gap-2">
              <span>
                Для поиска нужны 180 дней {timeframe} ({requiredCandles} свечей). Доступно{' '}
                {availableCandles}
                {requiredCandles > 0 ? ` (~${availableDays} дн.)` : ''}.
              </span>
              <Button
                variant="secondary"
                className="h-7 px-2 text-[11px]"
                disabled={loadData.isPending}
                onClick={() => loadData.mutate()}
              >
                {loadData.isPending
                  ? 'Загружаю…'
                  : loadAttempt
                    ? 'Повторить загрузку'
                    : 'Загрузить 180 дней'}
              </Button>
            </div>
            {loadAttempt ? (
              <div className="text-amber-700">
                Загрузка добавила {loadAttempt.upserted} свечей
                {loadAttempt.failed > 0 ? `, ошибок: ${loadAttempt.failed}` : ''}. Если история не
                выросла, источник не отдаёт 180 дней для этого токена — выберите другой токен или
                таймфрейм.
                {loadAttempt.details.length > 0 ? (
                  <div className="mt-1 text-[11px] text-amber-600">
                    {loadAttempt.details.slice(0, 3).join(' · ')}
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : null}
        {dataNotice ? <p className="mt-2 text-xs text-emerald-700">{dataNotice}</p> : null}
        {error ? <p className="mt-2 text-sm text-red-700">{error}</p> : null}
        {currentStatus?.error ? (
          <p className="mt-2 text-sm text-red-700">{currentStatus.error}</p>
        ) : null}
      </Card>

      {runs.data ? (
        <Card>
          <CardTitle>Последние запуски</CardTitle>
          <CardDescription>
            История поисков сохраняется: откройте запуск, чтобы увидеть прогресс, статистику и
            кандидатов после перезагрузки страницы. Анализы лаборатории в эту историю не входят.
          </CardDescription>
          {runs.data.data.length === 0 ? (
            <p className="mt-3 text-sm text-zinc-500">
              Пока нет запусков поиска. Запустите первый поиск после загрузки 180 дней истории.
            </p>
          ) : (
            <div className="mt-3 space-y-1.5">
              {runs.data.data.map((run) => {
                const terminal = run.status !== 'queued' && run.status !== 'running';
                return (
                  <div
                    key={run.runId}
                    className={`flex w-full items-center gap-1 rounded-lg border px-2.5 py-2 text-xs transition-colors hover:border-emerald-300 ${
                      run.runId === runId
                        ? 'border-emerald-300 bg-emerald-50/50'
                        : 'border-zinc-200 bg-white'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => setRunId(run.runId)}
                      className="flex min-w-0 flex-1 flex-wrap items-center justify-between gap-2 text-left"
                    >
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="font-medium text-zinc-900">
                          {run.symbol} · {run.timeframe}
                        </span>
                        <Badge
                          tone={
                            run.status === 'succeeded'
                              ? 'success'
                              : run.status === 'failed'
                                ? 'danger'
                                : run.status === 'cancelled'
                                  ? 'warning'
                                  : 'info'
                          }
                        >
                          {run.status}
                        </Badge>
                        <span className="text-zinc-500">
                          {run.variants} вариантов · {run.recommended} рекомендаций
                        </span>
                      </span>
                      <span className="text-zinc-400">{formatDateTime(run.createdAt)}</span>
                    </button>
                    {terminal ? (
                      <Button
                        variant="ghost"
                        className="h-7 w-7 shrink-0 px-0 text-zinc-400 hover:text-red-700"
                        aria-label={`Удалить запуск ${run.symbol} ${run.timeframe} из истории`}
                        title="Удалить из истории"
                        disabled={removeRun.isPending}
                        onClick={() => {
                          setDeleteRunError(null);
                          setDeleteRun(run);
                        }}
                      >
                        <TrashIcon />
                      </Button>
                    ) : null}
                  </div>
                );
              })}
            </div>
          )}
        </Card>
      ) : null}

      {currentStatus ? (
        <Card>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Badge
                tone={
                  currentStatus.status === 'succeeded'
                    ? 'success'
                    : currentStatus.status === 'failed'
                      ? 'danger'
                      : currentStatus.status === 'cancelled'
                        ? 'warning'
                        : 'info'
                }
              >
                {currentStatus.status}
              </Badge>
              <span className="text-xs text-zinc-500">
                {currentStatus.stage
                  ? `${aiSearchFunnelStageLabels[currentStatus.stage]}: ${currentStatus.stageEvaluated} / ${currentStatus.stageTotal}`
                  : `${currentStatus.evaluated} / ${currentStatus.total} вариантов`}
              </span>
              <span className="text-xs text-zinc-400">
                исполнение: {executionLabels[currentStatus.execution]}
              </span>
            </div>
            {running ? (
              <Button
                variant="secondary"
                className="h-8 px-3 text-xs"
                disabled={cancel.isPending}
                onClick={() => cancel.mutate()}
              >
                Остановить
              </Button>
            ) : null}
          </div>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-zinc-100">
            <div
              className="h-full rounded-full bg-emerald-500 transition-all"
              style={{ width: `${currentStatus.percent}%` }}
            />
          </div>
          {stats ? (
            <>
              <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
                <LabFeature label="Всего" value={String(stats.total)} />
                <LabFeature label="Оценено" value={String(stats.evaluated)} />
                <LabFeature label="Отсеяно сигналами" value={String(stats.screenedOut)} />
                <LabFeature label="Отсеяно пробой" value={String(stats.probeOut)} />
                <LabFeature label="Отсеяно бюджетом" value={String(stats.budgetOut)} />
                <LabFeature label="Прошли фильтры" value={String(stats.valid)} />
                <LabFeature label="Рекомендаций" value={String(stats.recommended)} />
                <LabFeature label="Лучший OOS" value={formatPct(stats.bestOosReturnPct)} />
                <LabFeature label="Медиана OOS" value={formatPct(stats.medianOosReturnPct)} />
                <LabFeature label="Худший OOS" value={formatPct(stats.worstOosReturnPct)} />
                <LabFeature label="Прибыльных" value={percentMagnitude(stats.profitablePct)} />
                <LabFeature label="Средняя DD" value={percentMagnitude(stats.averageDrawdownPct)} />
                <LabFeature label="Стабильность" value={percentMagnitude(stats.stabilityPct)} />
                <LabFeature
                  label="Holdout"
                  value={stats.holdoutReturnPct === null ? '—' : formatPct(stats.holdoutReturnPct)}
                />
              </div>
              <div className="mt-2 text-[11px] text-zinc-500">
                Прошли OOS: {stats.oosPassed} · допущено к holdout: {stats.holdoutTested} · не
                тестировались: {Math.max(0, stats.oosPassed - stats.holdoutTested)}
                {(currentResults?.settlementDays ?? 0) > 0
                  ? ` · holdout ${currentResults?.holdoutCycles ?? 0}×15 (10+${currentResults?.settlementDays ?? 0})`
                  : ''}
              </div>
            </>
          ) : null}
          {stats && stats.histogram.length > 0 ? (
            <div className="mt-3 rounded-lg bg-zinc-50 px-3 py-2">
              <div className="text-[10px] uppercase tracking-wide text-zinc-400">
                Распределение OOS-медиан
              </div>
              <div className="mt-2 flex items-end gap-1">
                {stats.histogram.map((bucket) => {
                  const max = Math.max(...stats.histogram.map((item) => item.count), 1);
                  return (
                    <div key={bucket.label} className="flex flex-1 flex-col items-center gap-1">
                      <div className="text-[10px] text-zinc-500">{bucket.count}</div>
                      <div
                        className="w-full rounded-t bg-emerald-400/70"
                        style={{ height: `${Math.max(3, (bucket.count / max) * 64)}px` }}
                      />
                      <div className="whitespace-nowrap text-[9px] text-zinc-400">
                        {bucket.label}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : null}
        </Card>
      ) : null}

      {funnel && funnel.stages.length > 0 ? (
        <Card>
          <CardTitle>Воронка поиска</CardTitle>
          <CardDescription>
            Дешёвые этапы отсекают варианты до полного бэктеста. Контрольная выборка проверяет, не
            потеряли ли фильтры сильных кандидатов. Исполнение: {executionLabels[execution]}.
          </CardDescription>
          <div className="mt-3 flex flex-wrap items-stretch gap-2">
            {funnel.stages.map((stage, index) => (
              <div key={stage.key} className="flex items-center gap-2">
                <div className="min-w-[104px] rounded-lg border border-zinc-200 bg-zinc-50 px-2.5 py-2">
                  <div className="text-[10px] uppercase tracking-wide text-zinc-400">
                    {aiSearchFunnelStageLabels[stage.key]}
                  </div>
                  <div className="mt-0.5 text-sm font-medium text-zinc-800">
                    {stage.input} → {stage.output}
                  </div>
                  <div className="text-[10px] text-zinc-500">
                    {stage.rejected > 0 ? `−${stage.rejected}` : 'без отсева'} ·{' '}
                    {formatDurationMs(stage.durationMs)}
                  </div>
                  {stage.controlSampled > 0 ? (
                    <div className="mt-0.5 text-[10px] text-amber-700">
                      контроль {stage.controlPassed}/{stage.controlSampled}
                    </div>
                  ) : null}
                </div>
                {index < funnel.stages.length - 1 ? (
                  <span className="text-xs text-zinc-300">→</span>
                ) : null}
              </div>
            ))}
          </div>
          {funnel.controlHits.length > 0 ? (
            <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50/70 px-3 py-2 text-xs text-amber-800">
              Контроль нашёл {funnel.controlHits.length} вариант(ов), которые прошли бы OOS после
              отсева. Это диагностика полноты, а не рекомендации.
            </div>
          ) : null}
          <div className="mt-2 text-xs text-zinc-500">
            {funnel.estimatedRecallPct === null
              ? 'Контрольная выборка не запускалась.'
              : `Оценка полноты: ${funnel.estimatedRecallPct}% (могло быть пропущено ~${funnel.estimatedMissed}).`}
          </div>
          <div className="mt-1 text-[11px] text-zinc-500">
            «Мало сделок» — меньше 8 сделок за 8 OOS-фолдов (≈80 дней); для короткой истории порог
            ниже. Это диагностика, не рекомендация.
          </div>
        </Card>
      ) : null}

      {createdBot ? (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 px-3 py-2 text-sm text-emerald-800">
          Черновик «{createdBot.name}» создан и не запущен.{' '}
          <a className="underline" href="/portfolio#robots">
            Открыть роботов
          </a>{' '}
          и запустить вручную.
        </div>
      ) : null}

      {currentResults ? (
        <Card>
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <CardTitle>Кандидаты</CardTitle>
              <CardDescription>
                Показаны варианты, прошедшие OOS, стабильность и финальный holdout. Создайте
                черновик робота и запустите его вручную в разделе «Роботы».
              </CardDescription>
            </div>
            <Button
              variant="secondary"
              className="h-8 px-3 text-xs"
              onClick={() => downloadJson(`ai-search-${runId ?? 'run'}.json`, currentResults)}
            >
              Экспорт JSON
            </Button>
          </div>
          {currentResults.candidates.length === 0 ? (
            <p className="mt-3 text-sm text-zinc-500">
              Ни один вариант не прошёл фильтры. Это нормальный результат: рынок не дал устойчивого
              преимущества.
            </p>
          ) : (
            <div className="mt-3 space-y-2">
              {currentResults.candidates.map((candidate) => (
                <SearchCandidateCard
                  key={candidate.id}
                  candidate={candidate}
                  onAccept={(item) =>
                    setAcceptTarget({
                      id: item.id,
                      strategyKey: item.strategyKey,
                      strategyName: item.strategyName,
                      params: item.params,
                      oosMedianReturnPct: item.oosMedianReturnPct,
                      stabilityPct: item.stabilityPct,
                      maxDrawdownPct: item.maxDrawdownPct,
                      holdoutReturnPct: item.holdoutReturnPct,
                      assetId,
                      symbol: selected?.asset.symbol ?? 'AI',
                      timeframe,
                    })
                  }
                />
              ))}
            </div>
          )}
          {Object.keys(currentResults.rejectionReasons).length > 0 ? (
            <div className="mt-4 rounded-lg bg-zinc-50 px-3 py-2 text-xs text-zinc-600">
              <div className="font-medium text-zinc-700">Причины отклонения</div>
              <div className="mt-1 flex flex-wrap gap-2">
                {Object.entries(currentResults.rejectionReasons)
                  .sort((left, right) => right[1] - left[1])
                  .map(([reason, count]) => (
                    <span key={reason} className="rounded bg-white px-2 py-1">
                      {rejectionLabel(reason)}: {count}
                    </span>
                  ))}
              </div>
            </div>
          ) : null}
        </Card>
      ) : null}

      {currentResults && (currentResults.nearMisses ?? []).length > 0 ? (
        <Card>
          <CardTitle>Почти прошли</CardTitle>
          <CardDescription>
            Прошли OOS, но не финальный holdout или другой фильтр. Это не рекомендации и не
            черновики роботов.
          </CardDescription>
          <div className="mt-3 space-y-2">
            {(currentResults.nearMisses ?? []).map((item, index) => (
              <div
                key={`${item.strategyKey}-${index}`}
                className="rounded-xl border border-amber-200 bg-amber-50/40 px-3 py-2"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-semibold text-zinc-900">{item.strategyName}</span>
                  <Badge tone="warning">не прошло</Badge>
                  <span className="text-[11px] text-zinc-500">{item.strategyKey}</span>
                </div>
                <div className="mt-1 grid gap-1 text-[11px] text-zinc-600 sm:grid-cols-4">
                  <span>OOS: {formatPct(item.oosMedianReturnPct)}</span>
                  <span>DD: {percentMagnitude(item.maxDrawdownPct)}</span>
                  <span>Сделок: {item.trades}</span>
                  <span>
                    Holdout:{' '}
                    {item.holdoutReturnPct === null ? '—' : formatPct(item.holdoutReturnPct)}
                    {item.holdoutDrawdownPct === null
                      ? ''
                      : ` · DD ${formatPct(item.holdoutDrawdownPct)}`}
                  </span>
                </div>
                {item.holdoutBlocksTotal > 0 ? (
                  <div className="mt-1 text-[11px] text-zinc-600">
                    Блоки 15 дней: {holdoutBlockSummary(item.holdoutBlockReturnsPct)} ·{' '}
                    {holdoutConsistencyLabel(item.holdoutBlocksPositive, item.holdoutBlocksTotal)}{' '}
                    поз. / {holdoutActiveLabel(item.holdoutBlocksTraded, item.holdoutBlocksTotal)}{' '}
                    акт.
                  </div>
                ) : null}
                <div className="mt-1 text-[11px] text-amber-800">
                  {item.reasons.map(rejectionLabel).join(' · ')}
                </div>
              </div>
            ))}
          </div>
        </Card>
      ) : null}

      <RecommendationAcceptDrawer
        target={acceptTarget}
        onClose={() => setAcceptTarget(null)}
        onCreated={(bot) => {
          setCreatedBot(bot);
          onChanged();
        }}
      />
      <ConfirmDialog
        open={Boolean(deleteRun)}
        title="Удалить запуск из истории?"
        description={
          deleteRun
            ? `Запуск ${deleteRun.symbol} · ${deleteRun.timeframe} будет скрыт из истории поисков. Результаты, свечи, рекомендации и аудит сохранятся.`
            : ''
        }
        confirmLabel="Удалить из истории"
        busy={removeRun.isPending}
        error={deleteRunError}
        onConfirm={() => {
          if (deleteRun) removeRun.mutate(deleteRun.runId);
        }}
        onCancel={() => {
          if (!removeRun.isPending) {
            setDeleteRun(null);
            setDeleteRunError(null);
          }
        }}
      />
    </div>
  );
}

function SearchCandidateCard({
  candidate,
  onAccept,
}: {
  candidate: AiSearchCandidate;
  onAccept: (candidate: AiSearchCandidate) => void;
}) {
  return (
    <div className="rounded-xl border border-zinc-200 px-3 py-2">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="text-sm font-semibold text-zinc-900">{candidate.strategyName}</div>
          <div className="text-[11px] text-zinc-500">{candidate.strategyKey}</div>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge tone="success">OOS {formatPct(candidate.oosMedianReturnPct)}</Badge>
          {candidate.holdoutBlocksTotal > 0 ? (
            <Badge
              tone={
                candidate.holdoutBlocksPositive === candidate.holdoutBlocksTotal &&
                candidate.holdoutBlocksTraded === candidate.holdoutBlocksTotal
                  ? 'success'
                  : 'warning'
              }
            >
              holdout{' '}
              {holdoutConsistencyLabel(
                candidate.holdoutBlocksPositive,
                candidate.holdoutBlocksTotal,
              )}{' '}
              · {holdoutActiveLabel(candidate.holdoutBlocksTraded, candidate.holdoutBlocksTotal)}{' '}
              акт.
            </Badge>
          ) : null}
        </div>
      </div>
      <div className="mt-2 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        <LabFeature label="Средний OOS" value={formatPct(candidate.oosMeanReturnPct)} />
        <LabFeature label="Худший OOS" value={formatPct(candidate.oosWorstReturnPct)} />
        <LabFeature label="Макс. DD" value={percentMagnitude(candidate.maxDrawdownPct)} />
        <LabFeature label="Сделок" value={String(candidate.trades)} />
        <LabFeature label="Стабильность" value={percentMagnitude(candidate.stabilityPct)} />
        <LabFeature
          label="Holdout"
          value={candidate.holdoutReturnPct === null ? '—' : formatPct(candidate.holdoutReturnPct)}
        />
        <LabFeature
          label="Блоки 15д"
          value={
            candidate.holdoutBlocksTotal > 0
              ? `${holdoutBlockSummary(candidate.holdoutBlockReturnsPct)} · ${holdoutConsistencyLabel(candidate.holdoutBlocksPositive, candidate.holdoutBlocksTotal)} поз. / ${holdoutActiveLabel(candidate.holdoutBlocksTraded, candidate.holdoutBlocksTotal)} акт.`
              : '—'
          }
        />
        <LabFeature label="Policy" value={candidate.policyScore} />
        <LabFeature label="Фолды" value={`${candidate.positiveFolds} / 8`} />
        <LabFeature label="Действует до" value={formatDateTime(candidate.expiresAt)} />
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {Object.entries(candidate.params).map(([key, value]) => (
          <span key={key} className="rounded bg-zinc-100 px-1.5 py-0.5 text-[11px] text-zinc-600">
            {key}: {String(value)}
          </span>
        ))}
      </div>
      <div className="mt-2 flex justify-end">
        {candidate.status === 'accepted' ? (
          <Badge tone="info">Черновик создан</Badge>
        ) : candidate.expired ? (
          <Badge tone="warning">Рекомендация истекла</Badge>
        ) : (
          <Button
            variant="secondary"
            className="h-8 px-3 text-xs"
            onClick={() => onAccept(candidate)}
          >
            Создать черновик
          </Button>
        )}
      </div>
    </div>
  );
}

function DataSection({
  coverage,
  loading,
  error,
  onRetry,
  onChanged,
}: {
  coverage: AiCoverage | undefined;
  loading: boolean;
  error: boolean;
  onRetry: () => void;
  onChanged: () => void;
}) {
  const [days, setDays] = useState('180');
  const [message, setMessage] = useState<string | null>(null);
  const [refreshError, setRefreshError] = useState<string | null>(null);

  const refresh = useMutation({
    mutationFn: () => refreshAiData({ days: Number(days) || 180 }),
    onMutate: () => {
      setMessage(null);
      setRefreshError(null);
    },
    onSuccess: (result) => {
      setRefreshError(null);
      const failed = result.failed
        .slice(0, 3)
        .map((item) => `${item.symbol} ${item.timeframe}: ${item.reason}`);
      setMessage(
        `Пар: ${result.pairs}, свечей: ${result.upserted}${
          result.failed.length > 0
            ? `, ошибок: ${result.failed.length}${failed.length > 0 ? ` (${failed.join('; ')})` : ''}`
            : ''
        }`,
      );
      onChanged();
    },
    onError: (err) => setRefreshError(toRussianError(err, 'Не удалось обновить данные')),
  });

  if (loading) return <LoadingRows rows={4} />;
  if (error || !coverage) {
    return <ErrorState message="Не удалось загрузить покрытие данных" onRetry={onRetry} />;
  }

  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <CardTitle>Покрытие данных</CardTitle>
          <CardDescription>
            OHLCV из GeckoTerminal, CoinGecko и Binance. Свечи хранятся в market_candles;
            синтетические дневные и часовые точки помечаются отдельно.
          </CardDescription>
        </div>
        <div className="flex items-end gap-2">
          <label className="text-xs text-zinc-600">
            Период
            <Select
              className="mt-1 h-9 w-28"
              value={days}
              onChange={(event) => setDays(event.target.value)}
              aria-label="Период истории"
            >
              <option value="30">30 дней</option>
              <option value="90">90 дней</option>
              <option value="180">180 дней</option>
              <option value="365">365 дней</option>
            </Select>
          </label>
          <Button disabled={refresh.isPending} onClick={() => refresh.mutate()}>
            {refresh.isPending ? 'Обновляю…' : 'Обновить данные'}
          </Button>
        </div>
      </div>

      <div className="mt-2 text-xs text-zinc-500">
        {message ? <span className="text-emerald-700">{message}</span> : null}
        {refreshError ? <span className="text-red-700">{refreshError}</span> : null}
      </div>

      {coverage.tokens.length === 0 ? (
        <p className="mt-4 text-sm text-zinc-500">
          Во вселенной пока нет включённых токенов. Добавьте токены на вкладке «Вселенная».
        </p>
      ) : (
        <div className="mt-4 space-y-2">
          {coverage.tokens.map((token) => (
            <div key={token.assetId} className="rounded-xl border border-zinc-200 px-3 py-2">
              <div className="flex flex-wrap items-center gap-2.5">
                <TokenIcon
                  logoUrl={token.logoUrl}
                  symbol={token.symbol}
                  className="h-8 w-8 text-[9px]"
                />
                <div className="min-w-[140px] flex-1">
                  <div className="text-sm font-semibold text-zinc-900">{token.symbol}</div>
                  <div className="text-[11px] text-zinc-500">{token.name}</div>
                </div>
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                {token.timeframes.map((item) => (
                  <CoverageChip key={item.timeframe} item={item} />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      <p className="mt-4 text-[11px] text-zinc-400">
        Обновлено: {formatDateTime(coverage.generatedAt)}. Данные реальные, деньги виртуальные.
      </p>
    </Card>
  );
}

function CoverageChip({ item }: { item: AiCoverageTimeframe }) {
  const tone = coverageTones[item.status];
  const border =
    item.status === 'ok'
      ? 'border-emerald-200 bg-emerald-50/50'
      : item.status === 'missing'
        ? 'border-red-200 bg-red-50/40'
        : 'border-amber-200 bg-amber-50/40';

  return (
    <div className={`min-w-[170px] rounded-lg border px-2.5 py-1.5 ${border}`}>
      <div className="flex items-center gap-1.5">
        <span className="text-xs font-semibold text-zinc-800">{item.timeframe}</span>
        <Badge tone={tone}>{coverageLabels[item.status]}</Badge>
      </div>
      <div className="mt-1 text-[11px] text-zinc-500">
        {item.candles} свечей
        {item.candles < item.expected ? ` · нужно ${item.expected}` : ''}
        {item.syntheticCandles > 0 ? ` · синт. ${item.syntheticCandles}` : ''}
        {item.maxGapCandles > 0 ? ` · макс. пропуск ${item.maxGapCandles}` : ''}
      </div>
      <div className="text-[11px] text-zinc-500">
        {item.lastOpenTime ? formatDateTime(item.lastOpenTime) : 'Нет данных'}
      </div>
    </div>
  );
}

function SettingsSection({ profile, onSaved }: { profile: AiProfile; onSaved: () => void }) {
  const [values, setValues] = useState({
    budgetUsd: profile.budgetUsd,
    maxWorkers: String(profile.maxWorkers),
    maxWorkerAllocationPct: String(profile.maxWorkerAllocationPct),
    maxTokenExposurePct: String(profile.maxTokenExposurePct),
    maxInvestedPct: String(profile.maxInvestedPct),
    riskPerTradePct: profile.riskPerTradePct,
    dailyLossLimitPct: profile.dailyLossLimitPct,
    maxDrawdownPct: profile.maxDrawdownPct,
    maxAiSpendUsd: profile.maxAiSpendUsd,
    maxBacktestsPerDay: String(profile.maxBacktestsPerDay),
    weeklyReview: profile.schedule.weeklyReview,
    events: profile.schedule.events,
    model: profile.modelSettings.model,
    temperature: String(profile.modelSettings.temperature),
    maxTokens: String(profile.modelSettings.maxTokens),
    timeoutSeconds: String(profile.modelSettings.timeoutSeconds),
  });
  const [error, setError] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const save = useMutation({
    mutationFn: () => {
      const body: AiProfileUpdateRequest = {
        budgetUsd: values.budgetUsd,
        maxWorkers: Number(values.maxWorkers),
        maxWorkerAllocationPct: Number(values.maxWorkerAllocationPct),
        maxTokenExposurePct: Number(values.maxTokenExposurePct),
        maxInvestedPct: Number(values.maxInvestedPct),
        riskPerTradePct: values.riskPerTradePct,
        dailyLossLimitPct: values.dailyLossLimitPct,
        maxDrawdownPct: values.maxDrawdownPct,
        maxAiSpendUsd: values.maxAiSpendUsd,
        maxBacktestsPerDay: Number(values.maxBacktestsPerDay),
        schedule: {
          weeklyReview: values.weeklyReview,
          weeklyDay: profile.schedule.weeklyDay,
          weeklyHour: profile.schedule.weeklyHour,
          events: values.events,
        },
        modelSettings: {
          model: values.model,
          temperature: Number(values.temperature),
          maxTokens: Number(values.maxTokens),
          timeoutSeconds: Number(values.timeoutSeconds),
        },
      };
      return updateAiProfile(body);
    },
    onSuccess: () => {
      setError(null);
      onSaved();
      void queryClient.invalidateQueries({ queryKey: ['ai-dashboard'] });
    },
    onError: (err) => setError(toRussianError(err, 'Не удалось сохранить настройки')),
  });

  const set = (key: keyof typeof values, value: string | boolean) =>
    setValues((current) => ({ ...current, [key]: value }));

  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <Card>
        <CardTitle>Бюджет и лимиты</CardTitle>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className="text-xs text-zinc-600">
            Бюджет, USD
            <Input
              className="mt-1"
              value={values.budgetUsd}
              onChange={(e) => set('budgetUsd', e.target.value)}
            />
          </label>
          <label className="text-xs text-zinc-600">
            Max ИИ-ботов
            <Input
              className="mt-1"
              type="number"
              value={values.maxWorkers}
              onChange={(e) => set('maxWorkers', e.target.value)}
            />
          </label>
          <label className="text-xs text-zinc-600">
            Max на ИИ-бота, %
            <Input
              className="mt-1"
              type="number"
              value={values.maxWorkerAllocationPct}
              onChange={(e) => set('maxWorkerAllocationPct', e.target.value)}
            />
          </label>
          <label className="text-xs text-zinc-600">
            Max на токен, %
            <Input
              className="mt-1"
              type="number"
              value={values.maxTokenExposurePct}
              onChange={(e) => set('maxTokenExposurePct', e.target.value)}
            />
          </label>
          <label className="text-xs text-zinc-600">
            Max invested, %
            <Input
              className="mt-1"
              type="number"
              value={values.maxInvestedPct}
              onChange={(e) => set('maxInvestedPct', e.target.value)}
            />
          </label>
          <label className="text-xs text-zinc-600">
            Risk per trade, %
            <Input
              className="mt-1"
              value={values.riskPerTradePct}
              onChange={(e) => set('riskPerTradePct', e.target.value)}
            />
          </label>
          <label className="text-xs text-zinc-600">
            Daily loss, %
            <Input
              className="mt-1"
              value={values.dailyLossLimitPct}
              onChange={(e) => set('dailyLossLimitPct', e.target.value)}
            />
          </label>
          <label className="text-xs text-zinc-600">
            Max DD, %
            <Input
              className="mt-1"
              value={values.maxDrawdownPct}
              onChange={(e) => set('maxDrawdownPct', e.target.value)}
            />
          </label>
          <label className="text-xs text-zinc-600">
            AI spend, USD/день
            <Input
              className="mt-1"
              value={values.maxAiSpendUsd}
              onChange={(e) => set('maxAiSpendUsd', e.target.value)}
            />
          </label>
          <label className="text-xs text-zinc-600">
            Backtests/день
            <Input
              className="mt-1"
              type="number"
              value={values.maxBacktestsPerDay}
              onChange={(e) => set('maxBacktestsPerDay', e.target.value)}
            />
          </label>
        </div>
      </Card>

      <Card>
        <CardTitle>ИИ и расписание</CardTitle>
        <div className="mt-3 space-y-2">
          {[
            ['weeklyReview', 'Еженедельный обзор'],
            ['events', 'Событийная ре-оптимизация'],
          ].map(([key, label]) => (
            <div key={key} className="flex items-center justify-between gap-3">
              <span className="text-xs text-zinc-600">{label}</span>
              <Switch
                checked={Boolean(values[key as keyof typeof values])}
                onChange={(checked) => set(key as keyof typeof values, checked)}
                label={label}
              />
            </div>
          ))}
        </div>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className="text-xs text-zinc-600">
            Модель
            <Select
              className="mt-1"
              value={values.model}
              onChange={(e) => set('model', e.target.value)}
            >
              <option value="deepseek-flash">deepseek-flash</option>
              <option value="deepseek-v4-pro">deepseek-v4-pro</option>
              <option value="deepseek-chat">deepseek-chat</option>
              <option value="deepseek-reasoner">deepseek-reasoner</option>
            </Select>
          </label>
          <label className="text-xs text-zinc-600">
            Temperature
            <Input
              className="mt-1"
              type="number"
              step="0.1"
              min={0}
              max={2}
              value={values.temperature}
              onChange={(e) => set('temperature', e.target.value)}
            />
          </label>
          <label className="text-xs text-zinc-600">
            Max tokens
            <Input
              className="mt-1"
              type="number"
              value={values.maxTokens}
              onChange={(e) => set('maxTokens', e.target.value)}
            />
          </label>
          <label className="text-xs text-zinc-600">
            Timeout, сек
            <Input
              className="mt-1"
              type="number"
              value={values.timeoutSeconds}
              onChange={(e) => set('timeoutSeconds', e.target.value)}
            />
          </label>
        </div>
      </Card>

      <div className="flex flex-wrap items-center justify-between gap-3 xl:col-span-2">
        <span className="text-sm text-red-700">{error}</span>
        <Button onClick={() => save.mutate()} disabled={save.isPending}>
          {save.isPending ? 'Сохраняю…' : 'Сохранить настройки'}
        </Button>
      </div>
    </div>
  );
}

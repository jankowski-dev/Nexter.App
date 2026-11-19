import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardDescription, CardTitle } from '@/components/ui/card';
import { Drawer } from '@/components/ui/drawer';
import { Input } from '@/components/ui/input';
import { TabGroup } from '@/components/ui/list-toolbar';
import { Select } from '@/components/ui/select';
import { ErrorState, LoadingRows } from '@/components/ui/states';
import { StatCard } from '@/components/ui/stat-card';
import { Switch } from '@/components/ui/switch';
import { TokenIcon } from '@/components/token-icon';
import {
  analyzeAiToken,
  backtestAiCandidate,
  cancelAiSearch,
  createTradingBot,
  fetchAiSearchResults,
  fetchAiSearchStatus,
  startAiSearch,
  createAiToken,
  fetchAiCoverage,
  fetchAiDashboard,
  fetchAiLab,
  fetchAiServices,
  fetchAiTokens,
  fetchWatchlist,
  refreshAiData,
  removeAiToken,
  updateAiProfile,
  updateAiService,
  updateAiToken,
} from '@/lib/api';
import { toRussianError } from '@/lib/error-messages';
import { formatDateTime, formatPct, formatPrice, formatUsd, formatUsdCompact } from '@/lib/format';
import type {
  AiCoverage,
  AiCoverageStatus,
  AiCoverageTimeframe,
  AiLabAnalysis,
  AiLabCandidate,
  AiLabRegime,
  AiProfile,
  AiProfileToken,
  AiProfileUpdateRequest,
  AiSearchCandidate,
  AiSearchResults,
  AiSearchTimeframe,
  AiServiceConfig,
  AiServiceKey,
  AiTimeframe,
  BotCreateRequest,
  WatchlistEntry,
} from '@nexter/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';

type Section = 'panel' | 'universe' | 'data' | 'lab' | 'search' | 'services' | 'settings';

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

const regimeLabels: Record<AiLabRegime, string> = {
  trend_up: 'Восходящий тренд',
  trend_down: 'Нисходящий тренд',
  range: 'Боковик',
  high_volatility: 'Высокая волатильность',
  unclear: 'Неопределённый режим',
};

const labStatusTones: Record<string, 'neutral' | 'success' | 'warning' | 'danger'> = {
  proposed: 'neutral',
  backtested: 'success',
  rejected: 'danger',
};

const serviceLabels: Record<AiServiceKey, string> = {
  data: 'Data Service',
  analyst: 'Analyst Service · ИИ',
  backtest: 'Backtest Service',
  risk: 'Risk Service',
  reporter: 'Reporter Service',
};

const serviceDescriptions: Record<AiServiceKey, string> = {
  data: 'Сбор OHLCV, качество данных, кэш и покрытие таймфреймов.',
  analyst: 'Признаки, режим рынка, кандидаты стратегий и оценка ИИ.',
  backtest: 'Walk-forward, OOS, метрики и ранжирование кандидатов.',
  risk: 'Лимиты, корреляция, распределение виртуального капитала.',
  reporter: 'Ежедневные и еженедельные отчёты, здоровье сервисов.',
};

// 5m remains supported for legacy data but is not offered for the short-swing AI universe.
const timeframeOptions: AiTimeframe[] = ['1h', '1d', '4h', '15m'];

function invalidateAi(queryClient: ReturnType<typeof useQueryClient>): void {
  for (const key of [
    'ai-dashboard',
    'ai-tokens',
    'ai-services',
    'ai-coverage',
    'ai-lab',
    'ai-search-status',
    'ai-search-results',
  ]) {
    void queryClient.invalidateQueries({ queryKey: [key] });
  }
}

export function AiTradingPage() {
  const queryClient = useQueryClient();
  const [section, setSection] = useState<Section>('panel');
  const dashboard = useQuery({
    queryKey: ['ai-dashboard'],
    queryFn: fetchAiDashboard,
    refetchInterval: 30_000,
  });
  const tokens = useQuery({ queryKey: ['ai-tokens'], queryFn: fetchAiTokens });
  const services = useQuery({ queryKey: ['ai-services'], queryFn: fetchAiServices });
  const coverage = useQuery({
    queryKey: ['ai-coverage'],
    queryFn: fetchAiCoverage,
    enabled: section === 'data' || section === 'lab' || section === 'search',
    refetchInterval: 60_000,
  });
  const watchlist = useQuery({
    queryKey: ['ai-watchlist'],
    queryFn: () => fetchWatchlist(false, undefined, undefined, 100),
  });

  if (dashboard.isPending || tokens.isPending || services.isPending) {
    return <LoadingRows rows={8} />;
  }
  if (dashboard.isError || tokens.isError || services.isError) {
    return (
      <ErrorState
        message={toRussianError(
          dashboard.error ?? tokens.error ?? services.error,
          'Не удалось загрузить ИИ-торговлю',
        )}
        onRetry={() => {
          void dashboard.refetch();
          void tokens.refetch();
          void services.refetch();
        }}
      />
    );
  }

  const profile = dashboard.data.profile;
  const tokenRows = tokens.data.data;
  const serviceRows = services.data.data;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={profile.enabled ? 'success' : 'neutral'}>
            {profile.enabled ? 'Профиль включён' : 'Профиль выключен'}
          </Badge>
          <span className="text-xs text-zinc-500">
            Sandbox: реальные данные и математика, виртуальные деньги. Реальные ордера не создаются.
          </span>
        </div>
        <span className="text-xs text-zinc-400">
          {dashboard.data.lastRunAt
            ? `Последний запуск: ${formatDateTime(dashboard.data.lastRunAt)}`
            : 'Пайплайн ещё не запускался'}
        </span>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          title="Бюджет"
          value={formatUsd(profile.budgetUsd)}
          description={`Свободно ${formatUsd(profile.cashUsd)}`}
          icon="wallet"
          tone="emerald"
        />
        <StatCard
          title="AI-токены"
          value={String(dashboard.data.tokensCount)}
          description="В отдельном списке ИИ"
          icon="watchlist"
          tone="sky"
        />
        <StatCard
          title="ИИ-роботы"
          value={`${dashboard.data.activeWorkers} / ${dashboard.data.workersCount}`}
          description="Активные / всего"
          icon="testing"
          tone="violet"
        />
        <StatCard
          title="Очередь"
          value={String(dashboard.data.queueCount)}
          description="Задач в ожидании"
          icon="operations"
          tone="amber"
        />
      </div>

      <TabGroup
        value={section}
        onChange={setSection}
        ariaLabel="Раздел ИИ-торговли"
        options={[
          { value: 'panel', label: 'Панель' },
          { value: 'universe', label: 'Вселенная' },
          { value: 'data', label: 'Данные' },
          { value: 'lab', label: 'Лаборатория' },
          { value: 'search', label: 'Поиск' },
          { value: 'services', label: 'Сервисы' },
          { value: 'settings', label: 'Настройки' },
        ]}
      />

      {section === 'panel' ? (
        <Card className="tone-surface tone-surface-sky">
          <CardTitle>Следующий этап</CardTitle>
          <CardDescription>
            Настройки, AI-вселенная, данные и лаборатория готовы. Следующий этап — поиск и
            рекомендации: Data → Analyst → Search/Backtest → Risk → Recommendation. Рекомендация
            открывает draft-робота, но не запускает его: старт остаётся за тобой.
          </CardDescription>
        </Card>
      ) : null}

      {section === 'universe' ? (
        <UniverseSection
          tokens={tokenRows}
          watchlistEntries={watchlist.data?.data ?? []}
          onChanged={() => invalidateAi(queryClient)}
        />
      ) : null}

      {section === 'data' ? (
        <DataSection
          coverage={coverage.data}
          loading={coverage.isPending}
          error={coverage.isError}
          onRetry={() => void coverage.refetch()}
          onChanged={() => invalidateAi(queryClient)}
        />
      ) : null}

      {section === 'lab' ? (
        <LabSection
          tokens={tokenRows}
          coverage={coverage.data}
          onOpenData={() => setSection('data')}
          onChanged={() => invalidateAi(queryClient)}
        />
      ) : null}

      {section === 'search' ? (
        <SearchSection
          tokens={tokenRows}
          coverage={coverage.data}
          onChanged={() => invalidateAi(queryClient)}
        />
      ) : null}

      {section === 'services' ? (
        <ServicesSection services={serviceRows} onChanged={() => invalidateAi(queryClient)} />
      ) : null}

      {section === 'settings' ? (
        <SettingsSection profile={profile} onSaved={() => invalidateAi(queryClient)} />
      ) : null}
    </div>
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
  const [timeframes, setTimeframes] = useState<AiTimeframe[]>(['1h', '1d']);
  const [priority, setPriority] = useState('0');
  const [error, setError] = useState<string | null>(null);
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
      setTimeframes(['1h', '1d']);
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
    onSuccess: onChanged,
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
                className="h-8 px-2 text-xs text-red-700 hover:text-red-800"
                onClick={() => remove.mutate(token.id)}
              >
                Убрать
              </Button>
            </div>
          ))
        )}
      </div>
    </Card>
  );
}

function percentMagnitude(value: string | null | undefined): string {
  if (value === null || value === undefined || value === '') return '—';
  const number = Number(value);
  return Number.isFinite(number) ? `${number.toFixed(2)}%` : '—';
}

function LabFeature({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-zinc-50 px-2.5 py-2">
      <div className="text-[10px] uppercase tracking-wide text-zinc-400">{label}</div>
      <div className="mt-0.5 text-sm font-medium text-zinc-800">{value}</div>
    </div>
  );
}

function LabSection({
  tokens,
  coverage,
  onOpenData,
  onChanged,
}: {
  tokens: AiProfileToken[];
  coverage: AiCoverage | undefined;
  onOpenData: () => void;
  onChanged: () => void;
}) {
  const enabled = tokens.filter((token) => token.enabled);
  const [assetId, setAssetId] = useState(enabled[0]?.asset.id ?? '');
  const [timeframe, setTimeframe] = useState<AiTimeframe>(enabled[0]?.timeframes[0] ?? '1d');
  const [error, setError] = useState<string | null>(null);
  const [dataNotice, setDataNotice] = useState<string | null>(null);
  const [dataError, setDataError] = useState<string | null>(null);
  const selected = enabled.find((token) => token.asset.id === assetId);
  const timeframeCoverage = coverage?.tokens
    .find((token) => token.assetId === assetId)
    ?.timeframes.find((item) => item.timeframe === timeframe);
  const missingData =
    timeframeCoverage?.status === 'missing' || timeframeCoverage?.status === 'stale';

  const labQuery = useQuery({
    queryKey: ['ai-lab', assetId, timeframe],
    queryFn: () => fetchAiLab({ assetId, timeframe }),
    enabled: Boolean(assetId),
  });

  const analyze = useMutation({
    mutationFn: () => analyzeAiToken({ assetId, timeframe, lookbackDays: 180 }),
    onSuccess: () => {
      setError(null);
      onChanged();
    },
    onError: (err) => setError(toRussianError(err, 'Не удалось выполнить анализ')),
  });

  const loadData = useMutation({
    mutationFn: () => refreshAiData({ assetId, timeframes: [timeframe], days: 90 }),
    onSuccess: (result) => {
      setDataError(null);
      setDataNotice(
        `Загружено свечей: ${result.upserted}${
          result.failed.length > 0 ? `, ошибок: ${result.failed.length}` : ''
        }. Теперь нажмите «Анализировать».`,
      );
      onChanged();
    },
    onError: (err) => setDataError(toRussianError(err, 'Не удалось загрузить данные')),
  });

  const backtest = useMutation({
    mutationFn: (candidateId: string) => backtestAiCandidate({ candidateId }),
    onSuccess: () => {
      setError(null);
      onChanged();
    },
    onError: (err) => setError(toRussianError(err, 'Не удалось выполнить бэктест')),
  });

  useEffect(() => {
    if (enabled.length > 0 && !enabled.some((token) => token.asset.id === assetId)) {
      setAssetId(enabled[0]?.asset.id ?? '');
    }
  }, [assetId, enabled]);

  useEffect(() => {
    if (selected && !selected.timeframes.includes(timeframe)) {
      setTimeframe(selected.timeframes[0] ?? '1d');
    }
  }, [selected, timeframe]);

  if (enabled.length === 0) {
    return (
      <Card>
        <CardTitle>Лаборатория стратегий</CardTitle>
        <CardDescription>
          Сначала добавьте включённые токены на вкладке «Вселенная».
        </CardDescription>
      </Card>
    );
  }

  const analysis: AiLabAnalysis | null = labQuery.data?.analysis ?? null;

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <CardTitle>Лаборатория стратегий</CardTitle>
            <CardDescription>
              ИИ анализирует режим рынка и предлагает стратегии из реестра. Бэктест проверяет
              кандидата на train и OOS; реальные ордера не создаются.
            </CardDescription>
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <label className="text-xs text-zinc-600">
              Токен
              <Select
                className="mt-1 h-9 min-w-44"
                value={assetId}
                onChange={(event) => setAssetId(event.target.value)}
                aria-label="Токен для лаборатории"
              >
                {enabled.map((token) => (
                  <option key={token.asset.id} value={token.asset.id}>
                    {token.asset.symbol} · {token.asset.name}
                  </option>
                ))}
              </Select>
            </label>
            <label className="text-xs text-zinc-600">
              Таймфрейм
              <Select
                className="mt-1 h-9 w-24"
                value={timeframe}
                onChange={(event) => setTimeframe(event.target.value as AiTimeframe)}
                aria-label="Таймфрейм анализа"
              >
                {selected?.timeframes.map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </Select>
            </label>
            <Button
              disabled={!assetId || analyze.isPending || missingData}
              onClick={() => analyze.mutate()}
            >
              {analyze.isPending ? 'Анализирую…' : 'Анализировать'}
            </Button>
          </div>
        </div>
        {missingData ? (
          <div className="mt-2 flex flex-wrap items-center gap-2 rounded-lg border border-amber-200 bg-amber-50/60 px-2.5 py-2 text-xs text-amber-800">
            <span>
              {timeframeCoverage?.status === 'stale' ? 'Данные устарели' : 'Нет свечей'} для{' '}
              {selected?.asset.symbol ?? 'токена'} {timeframe}. Загрузите историю перед анализом.
            </span>
            <Button
              variant="secondary"
              className="h-7 px-2 text-[11px]"
              disabled={loadData.isPending}
              onClick={() => loadData.mutate()}
            >
              {loadData.isPending ? 'Загружаю…' : 'Загрузить данные'}
            </Button>
            <button
              type="button"
              className="text-[11px] text-amber-800 underline"
              onClick={onOpenData}
            >
              Открыть «Данные»
            </button>
          </div>
        ) : null}
        {dataNotice ? <p className="mt-2 text-xs text-emerald-700">{dataNotice}</p> : null}
        {dataError ? <p className="mt-2 text-xs text-red-700">{dataError}</p> : null}
        {error ? <p className="mt-2 text-sm text-red-700">{error}</p> : null}
      </Card>

      {labQuery.isPending ? <LoadingRows rows={4} /> : null}
      {labQuery.isError ? (
        <ErrorState
          message={toRussianError(labQuery.error, 'Не удалось загрузить лабораторию')}
          onRetry={() => void labQuery.refetch()}
        />
      ) : null}

      {!labQuery.isPending && !labQuery.isError && !analysis ? (
        <Card>
          <CardDescription>
            Для выбранного токена и таймфрейма анализ ещё не запускался. Нажмите «Анализировать» —
            без ключа ИИ сработает детерминированный fallback.
          </CardDescription>
        </Card>
      ) : null}

      {analysis ? (
        <>
          <Card>
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={analysis.source === 'ai' ? 'info' : 'warning'}>
                {analysis.source === 'ai' ? 'ИИ' : 'Fallback'}
              </Badge>
              <Badge tone="neutral">{regimeLabels[analysis.regime]}</Badge>
              <Badge tone="info">Уверенность {(analysis.confidence * 100).toFixed(0)}%</Badge>
              {analysis.features.stale ? <Badge tone="danger">Данные устарели</Badge> : null}
              <span className="text-xs text-zinc-400">{formatDateTime(analysis.generatedAt)}</span>
            </div>
            <p className="mt-3 text-sm text-zinc-700">{analysis.summary}</p>
            <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
              <LabFeature label="Цена" value={formatPrice(analysis.features.lastPriceUsd)} />
              <LabFeature label="24 часа" value={formatPct(analysis.features.change24hPct)} />
              <LabFeature label="30 дней" value={formatPct(analysis.features.return30Pct)} />
              <LabFeature label="90 дней" value={formatPct(analysis.features.return90Pct)} />
              <LabFeature
                label="Волатильность"
                value={percentMagnitude(analysis.features.volatilityPct)}
              />
              <LabFeature
                label="Макс. просадка"
                value={percentMagnitude(analysis.features.maxDrawdownPct)}
              />
              <LabFeature label="Свечей" value={String(analysis.features.candles)} />
              <LabFeature
                label="Объём 24ч"
                value={formatUsdCompact(analysis.features.volume24hUsd)}
              />
            </div>
            {analysis.warnings.length > 0 ? (
              <ul className="mt-3 space-y-1 text-xs text-amber-700">
                {analysis.warnings.map((warning) => (
                  <li key={warning}>• {warning}</li>
                ))}
              </ul>
            ) : null}
          </Card>

          <div className="grid gap-3 xl:grid-cols-2">
            {analysis.candidates.map((candidate) => (
              <LabCandidateCard
                key={candidate.id}
                candidate={candidate}
                pending={backtest.isPending && backtest.variables === candidate.id}
                disabled={backtest.isPending}
                onBacktest={() => backtest.mutate(candidate.id)}
              />
            ))}
          </div>
        </>
      ) : null}
    </div>
  );
}

function LabCandidateCard({
  candidate,
  pending,
  disabled,
  onBacktest,
}: {
  candidate: AiLabCandidate;
  pending: boolean;
  disabled: boolean;
  onBacktest: () => void;
}) {
  const statusLabels: Record<string, string> = {
    proposed: 'Предложен',
    backtested: 'Прошёл бэктест',
    rejected: 'Отклонён',
  };
  const oos = candidate.metrics.oos;

  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="text-sm font-semibold text-zinc-900">{candidate.strategyName}</div>
          <div className="text-[11px] text-zinc-500">{candidate.strategyKey}</div>
        </div>
        <div className="flex items-center gap-2">
          {candidate.aiConfidence !== null ? (
            <span className="text-xs text-zinc-500">
              {(candidate.aiConfidence * 100).toFixed(0)}%
            </span>
          ) : null}
          <Badge tone={labStatusTones[candidate.status] ?? 'neutral'}>
            {statusLabels[candidate.status] ?? candidate.status}
          </Badge>
        </div>
      </div>
      {candidate.rationale ? (
        <p className="mt-2 text-sm text-zinc-600">{candidate.rationale}</p>
      ) : null}

      <div className="mt-2 flex flex-wrap gap-1.5">
        {Object.entries(candidate.params).map(([key, value]) => (
          <span key={key} className="rounded bg-zinc-100 px-1.5 py-0.5 text-[11px] text-zinc-600">
            {key}: {typeof value === 'object' ? JSON.stringify(value) : String(value)}
          </span>
        ))}
      </div>

      {candidate.risks.length > 0 ? (
        <ul className="mt-2 space-y-0.5 text-[11px] text-amber-700">
          {candidate.risks.map((risk) => (
            <li key={risk}>• {risk}</li>
          ))}
        </ul>
      ) : null}

      {oos ? (
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          <LabFeature label="OOS доходность" value={formatPct(oos.returnPct)} />
          <LabFeature label="OOS просадка" value={percentMagnitude(oos.maxDrawdownPct)} />
          <LabFeature label="OOS сделки" value={String(oos.trades)} />
          <LabFeature
            label="OOS profit factor"
            value={oos.profitFactor === null ? '—' : oos.profitFactor}
          />
        </div>
      ) : null}

      {candidate.metrics.reasons && candidate.metrics.reasons.length > 0 ? (
        <ul className="mt-2 space-y-0.5 text-[11px] text-red-700">
          {candidate.metrics.reasons.map((reason) => (
            <li key={reason}>• {reason}</li>
          ))}
        </ul>
      ) : null}

      <div className="mt-3 flex items-center justify-between gap-2">
        <span className="text-[11px] text-zinc-400">
          {candidate.policyScore === null
            ? 'Политика: —'
            : `Политика: ${candidate.policyScore.toFixed(2)}`}
        </span>
        <Button
          variant="secondary"
          className="h-8 px-3 text-xs"
          disabled={disabled}
          onClick={onBacktest}
        >
          {pending ? 'Считаю…' : 'Бэктест'}
        </Button>
      </div>
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
  const [error, setError] = useState<string | null>(null);
  const [dataNotice, setDataNotice] = useState<string | null>(null);
  const [acceptCandidate, setAcceptCandidate] = useState<AiSearchCandidate | null>(null);
  const [acceptName, setAcceptName] = useState('');
  const [acceptBudget, setAcceptBudget] = useState('1000');
  const [acceptError, setAcceptError] = useState<string | null>(null);
  const [createdBot, setCreatedBot] = useState<{ id: string; name: string } | null>(null);
  const timeframeCoverage = coverage?.tokens
    .find((token) => token.assetId === assetId)
    ?.timeframes.find((item) => item.timeframe === timeframe);
  const missingData = Boolean(timeframeCoverage && timeframeCoverage.status !== 'ok');

  useEffect(() => {
    if (selected && !timeframes.includes(timeframe)) {
      setTimeframe(timeframes[0] ?? '1h');
    }
  }, [selected, timeframe, timeframes]);

  const start = useMutation({
    mutationFn: () =>
      startAiSearch({
        assetId,
        timeframe,
        horizonDays: Number(horizon) as 1 | 3 | 5 | 10,
        variants: Number(variants),
      }),
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

  const loadData = useMutation({
    mutationFn: () => refreshAiData({ assetId, timeframes: [timeframe], days: 180 }),
    onSuccess: (result) => {
      setDataNotice(
        `Загружено свечей: ${result.upserted}${result.failed.length > 0 ? `, ошибок: ${result.failed.length}` : ''}.`,
      );
      onChanged();
    },
    onError: (err) => setError(toRussianError(err, 'Не удалось загрузить 180 дней')),
  });

  const accept = useMutation({
    mutationFn: () => {
      if (!acceptCandidate) throw new Error('No candidate selected');
      return createTradingBot({
        name: acceptName.trim(),
        description: `Рекомендация ИИ: ${acceptCandidate.strategyName}, OOS ${acceptCandidate.oosMedianReturnPct}%, стабильность ${acceptCandidate.stabilityPct}%.`,
        strategyKey: acceptCandidate.strategyKey as BotCreateRequest['strategyKey'],
        strategyParams: acceptCandidate.params,
        tokenAssetIds: [assetId],
        budgetUsd: acceptBudget,
        maxPositions: 5,
        positionSizePct: 20,
        feeBps: 25,
        slippageBps: 10,
        maxDailyLossPct: 10,
        cooldownMinutes: 15,
        aiCandidateId: acceptCandidate.id,
      });
    },
    onSuccess: (result) => {
      setCreatedBot({ id: result.bot.id, name: result.bot.name });
      setAcceptCandidate(null);
      setAcceptError(null);
      onChanged();
    },
    onError: (err) => setAcceptError(toRussianError(err, 'Не удалось создать черновик')),
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
              </Select>
            </label>
            <Button
              disabled={!assetId || start.isPending || running}
              onClick={() => start.mutate()}
            >
              {start.isPending ? 'Запускаю…' : 'Запустить поиск'}
            </Button>
          </div>
        </div>
        {missingData ? (
          <div className="mt-2 flex flex-wrap items-center gap-2 rounded-lg border border-amber-200 bg-amber-50/60 px-2.5 py-2 text-xs text-amber-800">
            <span>Для поиска нужны 180 дней {timeframe}. Загрузите историю перед запуском.</span>
            <Button
              variant="secondary"
              className="h-7 px-2 text-[11px]"
              disabled={loadData.isPending}
              onClick={() => loadData.mutate()}
            >
              {loadData.isPending ? 'Загружаю…' : 'Загрузить 180 дней'}
            </Button>
          </div>
        ) : null}
        {dataNotice ? <p className="mt-2 text-xs text-emerald-700">{dataNotice}</p> : null}
        {error ? <p className="mt-2 text-sm text-red-700">{error}</p> : null}
        {currentStatus?.error ? (
          <p className="mt-2 text-sm text-red-700">{currentStatus.error}</p>
        ) : null}
      </Card>

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
                {currentStatus.evaluated} / {currentStatus.total} вариантов
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
            <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
              <LabFeature label="Всего" value={String(stats.total)} />
              <LabFeature label="Оценено" value={String(stats.evaluated)} />
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
          ) : null}
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
          <CardTitle>Кандидаты</CardTitle>
          <CardDescription>
            Показаны варианты, прошедшие OOS, стабильность и финальный holdout. Создайте черновик
            робота и запустите его вручную в разделе «Роботы».
          </CardDescription>
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
                  onAccept={(item) => {
                    setAcceptCandidate(item);
                    setAcceptName(`${selected?.asset.symbol ?? 'AI'} · ${item.strategyName}`);
                    setAcceptBudget('1000');
                    setAcceptError(null);
                  }}
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
                      {reason}: {count}
                    </span>
                  ))}
              </div>
            </div>
          ) : null}
        </Card>
      ) : null}

      <Drawer
        open={Boolean(acceptCandidate)}
        onClose={() => {
          if (!accept.isPending) setAcceptCandidate(null);
        }}
        title="Создать черновик робота"
        description="Рекомендация предзаполнит стратегию, параметры и токен. Робот останется черновиком, пока вы не запустите его вручную."
        footer={
          <div className="flex justify-end gap-2">
            <Button
              variant="secondary"
              disabled={accept.isPending}
              onClick={() => setAcceptCandidate(null)}
            >
              Отмена
            </Button>
            <Button
              disabled={accept.isPending || acceptName.trim().length === 0}
              onClick={() => accept.mutate()}
            >
              {accept.isPending ? 'Создаю…' : 'Создать черновик'}
            </Button>
          </div>
        }
      >
        {acceptCandidate ? (
          <div className="space-y-3">
            <label className="block text-xs text-zinc-600">
              Название
              <Input
                className="mt-1"
                value={acceptName}
                maxLength={120}
                onChange={(event) => setAcceptName(event.target.value)}
              />
            </label>
            <label className="block text-xs text-zinc-600">
              Бюджет, USD
              <Input
                className="mt-1"
                inputMode="decimal"
                value={acceptBudget}
                onChange={(event) => setAcceptBudget(event.target.value)}
              />
            </label>
            <div className="rounded-lg bg-zinc-50 px-3 py-2 text-xs text-zinc-600">
              <div>
                Стратегия: <span className="text-zinc-900">{acceptCandidate.strategyName}</span>
              </div>
              <div>Токен: {selected?.asset.symbol ?? '—'}</div>
              <div>Таймфрейм: {timeframe}</div>
              <div>
                OOS: {formatPct(acceptCandidate.oosMedianReturnPct)} · DD{' '}
                {percentMagnitude(acceptCandidate.maxDrawdownPct)} · Holdout{' '}
                {acceptCandidate.holdoutReturnPct === null
                  ? '—'
                  : formatPct(acceptCandidate.holdoutReturnPct)}
              </div>
            </div>
            <p className="text-xs text-zinc-500">
              Минимальный бюджет — 100 USD. После создания робот появится в разделе «Роботы» в
              статусе «Черновик».
            </p>
            {acceptError ? <p className="text-sm text-red-700">{acceptError}</p> : null}
          </div>
        ) : null}
      </Drawer>
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
        <Badge tone="success">OOS {formatPct(candidate.oosMedianReturnPct)}</Badge>
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
        <LabFeature label="Policy" value={candidate.policyScore} />
        <LabFeature label="Фолды" value={`${candidate.positiveFolds} / 8`} />
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
  const [days, setDays] = useState('90');
  const [message, setMessage] = useState<string | null>(null);
  const [refreshError, setRefreshError] = useState<string | null>(null);

  const refresh = useMutation({
    mutationFn: () => refreshAiData({ days: Number(days) || 90 }),
    onSuccess: (result) => {
      setRefreshError(null);
      setMessage(
        `Пар: ${result.pairs}, свечей: ${result.upserted}${
          result.failed.length > 0 ? `, ошибок: ${result.failed.length}` : ''
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
            OHLCV из GeckoTerminal и CoinGecko. Свечи хранятся в market_candles; синтетические
            дневные и часовые точки помечаются отдельно.
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
        {item.candles} / {item.expected} свечей
      </div>
      <div className="text-[11px] text-zinc-500">
        {item.lastOpenTime ? formatDateTime(item.lastOpenTime) : 'Нет данных'}
      </div>
    </div>
  );
}

function ServicesSection({
  services,
  onChanged,
}: {
  services: AiServiceConfig[];
  onChanged: () => void;
}) {
  return (
    <div className="grid gap-4 xl:grid-cols-2">
      {services.map((service) => (
        <ServiceCard key={service.service} service={service} onChanged={onChanged} />
      ))}
    </div>
  );
}

function ServiceCard({ service, onChanged }: { service: AiServiceConfig; onChanged: () => void }) {
  const queryClient = useQueryClient();
  const [enabled, setEnabled] = useState(service.enabled);
  const [concurrency, setConcurrency] = useState(String(service.concurrency));
  const [config, setConfig] = useState<Record<string, string>>(() => {
    const result: Record<string, string> = {};
    for (const [key, value] of Object.entries(service.config)) {
      result[key] = typeof value === 'string' ? value : JSON.stringify(value);
    }
    return result;
  });
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setEnabled(service.enabled);
    setConcurrency(String(service.concurrency));
    const result: Record<string, string> = {};
    for (const [key, value] of Object.entries(service.config)) {
      result[key] = typeof value === 'string' ? value : JSON.stringify(value);
    }
    setConfig(result);
  }, [service]);

  const save = useMutation({
    mutationFn: () => {
      const nextConfig: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(config)) {
        if (key === 'timeframes') {
          try {
            nextConfig[key] = JSON.parse(value);
          } catch {
            nextConfig[key] = value;
          }
        } else if (key === 'daily' || key === 'weekly') {
          nextConfig[key] = value === 'true';
        } else if (key === 'minLiquidityUsd') {
          nextConfig[key] = value;
        } else {
          const parsed = Number(value);
          nextConfig[key] = Number.isFinite(parsed) ? parsed : value;
        }
      }
      return updateAiService(service.service, {
        enabled,
        concurrency: Number(concurrency),
        config: nextConfig,
      });
    },
    onSuccess: () => {
      setError(null);
      onChanged();
      void queryClient.invalidateQueries({ queryKey: ['ai-services'] });
    },
    onError: (err) => setError(toRussianError(err, 'Не удалось сохранить сервис')),
  });

  return (
    <Card>
      <div className="flex items-start justify-between gap-3">
        <div>
          <CardTitle>{serviceLabels[service.service]}</CardTitle>
          <CardDescription>{serviceDescriptions[service.service]}</CardDescription>
        </div>
        <Switch
          checked={enabled}
          onChange={setEnabled}
          label={`Включить ${serviceLabels[service.service]}`}
        />
      </div>
      <div className="mt-3 grid gap-2">
        <label className="text-xs text-zinc-600">
          Concurrency
          <Input
            className="mt-1 h-8 text-xs"
            type="number"
            min={1}
            max={4}
            value={concurrency}
            onChange={(event) => setConcurrency(event.target.value)}
          />
        </label>
        {Object.entries(config).map(([key, value]) => (
          <label key={key} className="text-xs text-zinc-600">
            {key}
            <Input
              className="mt-1 h-8 text-xs"
              value={value}
              onChange={(event) =>
                setConfig((current) => ({ ...current, [key]: event.target.value }))
              }
            />
          </label>
        ))}
      </div>
      {error ? <p className="mt-2 text-xs text-red-700">{error}</p> : null}
      <div className="mt-3 flex justify-end">
        <Button
          variant="secondary"
          className="h-8 px-3 text-xs"
          disabled={save.isPending}
          onClick={() => save.mutate()}
        >
          {save.isPending ? 'Сохраняю…' : 'Сохранить сервис'}
        </Button>
      </div>
    </Card>
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

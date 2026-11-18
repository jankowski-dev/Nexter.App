import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardDescription, CardTitle } from '@/components/ui/card';
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
  AiServiceConfig,
  AiServiceKey,
  AiTimeframe,
  WatchlistEntry,
} from '@nexter/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';

type Section = 'panel' | 'universe' | 'data' | 'lab' | 'services' | 'settings';

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

const timeframeOptions: AiTimeframe[] = ['1h', '1d', '4h', '15m', '5m'];

function invalidateAi(queryClient: ReturnType<typeof useQueryClient>): void {
  for (const key of ['ai-dashboard', 'ai-tokens', 'ai-services', 'ai-coverage', 'ai-lab']) {
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
    enabled: section === 'data',
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
          title="Воркеры"
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
          { value: 'services', label: 'Сервисы' },
          { value: 'settings', label: 'Настройки' },
        ]}
      />

      {section === 'panel' ? (
        <Card className="tone-surface tone-surface-sky">
          <CardTitle>Следующий этап</CardTitle>
          <CardDescription>
            Настройки, AI-вселенная и сервисные конфигурации готовы. Пайплайн Data → Analyst →
            Backtest → Risk → Workers будет подключён на следующем этапе. Сейчас профиль хранит
            бюджет, лимиты и расписание, но торговые задачи ещё не запускает.
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
        <LabSection tokens={tokenRows} onChanged={() => invalidateAi(queryClient)} />
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
        worker-а.
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

function LabSection({ tokens, onChanged }: { tokens: AiProfileToken[]; onChanged: () => void }) {
  const enabled = tokens.filter((token) => token.enabled);
  const [assetId, setAssetId] = useState(enabled[0]?.asset.id ?? '');
  const [timeframe, setTimeframe] = useState<AiTimeframe>(enabled[0]?.timeframes[0] ?? '1d');
  const [error, setError] = useState<string | null>(null);
  const selected = enabled.find((token) => token.asset.id === assetId);

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
            <Button disabled={!assetId || analyze.isPending} onClick={() => analyze.mutate()}>
              {analyze.isPending ? 'Анализирую…' : 'Анализировать'}
            </Button>
          </div>
        </div>
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
    autoApproveWorkerCreate: profile.autoApproveWorkerCreate,
    autoApproveParams: profile.autoApproveParams,
    autoApproveBudget: profile.autoApproveBudget,
    autoApprovePauseClose: profile.autoApprovePauseClose,
    autoApproveReoptimize: profile.autoApproveReoptimize,
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
        autoApproveWorkerCreate: values.autoApproveWorkerCreate,
        autoApproveParams: values.autoApproveParams,
        autoApproveBudget: values.autoApproveBudget,
        autoApprovePauseClose: values.autoApprovePauseClose,
        autoApproveReoptimize: values.autoApproveReoptimize,
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
            Max workers
            <Input
              className="mt-1"
              type="number"
              value={values.maxWorkers}
              onChange={(e) => set('maxWorkers', e.target.value)}
            />
          </label>
          <label className="text-xs text-zinc-600">
            Max на worker, %
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
        <CardTitle>Автоматизация и ИИ</CardTitle>
        <div className="mt-3 space-y-2">
          {[
            ['autoApproveWorkerCreate', 'Автосоздание worker'],
            ['autoApproveParams', 'Автоизменение параметров'],
            ['autoApproveBudget', 'Автоперераспределение бюджета'],
            ['autoApprovePauseClose', 'Авто-пауза/закрытие'],
            ['autoApproveReoptimize', 'Авто-ре-оптимизация'],
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

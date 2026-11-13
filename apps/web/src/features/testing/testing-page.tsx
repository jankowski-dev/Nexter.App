import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardDescription, CardTitle } from '@/components/ui/card';
import { Drawer } from '@/components/ui/drawer';
import { Input } from '@/components/ui/input';
import { PageHeader } from '@/components/ui/page-header';
import { Select } from '@/components/ui/select';
import { ErrorState, LoadingRows } from '@/components/ui/states';
import { Textarea } from '@/components/ui/textarea';
import { FanIcon } from '@/components/live-refresh-indicator';
import { NavIcon } from '@/components/nav-icon';
import { TokenIcon } from '@/components/token-icon';
import {
  archiveTradingBot,
  closeTradingBotPositions,
  createTradingBot,
  fetchBotStrategies,
  fetchTradingBot,
  fetchTradingBots,
  fetchWatchlist,
  resetTradingBot,
  startTradingBot,
  stopTradingBot,
  updateTradingBot,
} from '@/lib/api';
import { toRussianError } from '@/lib/error-messages';
import { formatDateTime, formatSignedUsd, formatUsd, pnlTone } from '@/lib/format';
import { filterBySearch } from '@/lib/search';
import { useAutoDismissNotice } from '@/lib/use-auto-dismiss-notice';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Decimal } from 'decimal.js';
import { useEffect, useState } from 'react';
import type {
  BotCreateRequest,
  BotStrategyTemplate,
  BotSummary,
  BotUpdateRequest,
} from '@nexter/contracts';
import { BacktestPanel } from './backtest-panel';
import { BotDetailDrawer } from './bot-detail-drawer';
import { StrategyIcon } from './strategy-icon';
import { StrategyParamInputs } from './strategy-param-inputs';
import { formToParams, paramsToForm } from './strategy-params';

type Tab = 'bots' | 'strategies';
type Sort = 'pnl' | 'equity' | 'profitFactor';

type BotFormState = {
  name: string;
  description: string;
  strategyKey: string;
  strategyParams: Record<string, string>;
  tokenAssetIds: string[];
  budgetUsd: string;
  maxPositions: string;
  positionSizePct: string;
  feeBps: string;
  slippageBps: string;
  maxDailyLossPct: string;
  cooldownMinutes: string;
};

const sortOptions: Array<{ value: Sort; label: string }> = [
  { value: 'pnl', label: 'По P&L' },
  { value: 'equity', label: 'По капиталу' },
  { value: 'profitFactor', label: 'По профит-фактору' },
];

const defaultParams: Record<string, unknown> = {};

function emptyBotForm(template?: BotStrategyTemplate): BotFormState {
  return {
    name: '',
    description: '',
    strategyKey: template?.key ?? 'momentum_breakout',
    strategyParams: paramsToForm(template?.defaultParams ?? defaultParams),
    tokenAssetIds: [],
    budgetUsd: '1000',
    maxPositions: '5',
    positionSizePct: '20',
    feeBps: '25',
    slippageBps: '10',
    maxDailyLossPct: '10',
    cooldownMinutes: '15',
  };
}

function compareBots(a: BotSummary, b: BotSummary, sort: Sort): number {
  if (sort === 'profitFactor') {
    const left = a.stats.profitFactor;
    const right = b.stats.profitFactor;
    if (left === null && right === null) return 0;
    if (left === null) return 1;
    if (right === null) return -1;
    return new Decimal(right).comparedTo(left);
  }
  const field = sort === 'pnl' ? 'totalPnlUsd' : 'equityUsd';
  return new Decimal(b.stats[field]).comparedTo(a.stats[field]);
}

function BotStats({ bot }: { bot: BotSummary }) {
  return (
    <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4 lg:grid-cols-8">
      <div>
        <div className="text-zinc-500">Капитал</div>
        <div className="font-mono text-sm text-zinc-900">{formatUsd(bot.stats.equityUsd)}</div>
      </div>
      <div>
        <div className="text-zinc-500">P&L</div>
        <div className={`font-mono text-sm ${pnlTone(bot.stats.totalPnlUsd)}`}>
          {formatSignedUsd(bot.stats.totalPnlUsd)}
        </div>
      </div>
      <div>
        <div className="text-zinc-500">Профит-фактор</div>
        <div className="font-mono text-sm text-zinc-900">{bot.stats.profitFactor ?? '—'}</div>
      </div>
      <div>
        <div className="text-zinc-500">Прибыль</div>
        <div className="font-mono text-sm text-emerald-700">
          {formatUsd(bot.stats.grossProfitUsd)}
        </div>
      </div>
      <div>
        <div className="text-zinc-500">Убыток</div>
        <div className="font-mono text-sm text-red-700">{formatUsd(bot.stats.grossLossUsd)}</div>
      </div>
      <div>
        <div className="text-zinc-500">Win rate</div>
        <div className="font-mono text-sm text-zinc-900">
          {bot.stats.winRate ? `${bot.stats.winRate}%` : '—'}
        </div>
      </div>
      <div>
        <div className="text-zinc-500">Сделки</div>
        <div className="font-mono text-sm text-zinc-900">{bot.stats.tradesCount}</div>
      </div>
      <div>
        <div className="text-zinc-500">Позиции</div>
        <div className="font-mono text-sm text-zinc-900">{bot.stats.openPositions}</div>
      </div>
    </div>
  );
}

export function TestingPage() {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<Tab>('bots');
  const [sort, setSort] = useState<Sort>('pnl');
  const [botDialogOpen, setBotDialogOpen] = useState(false);
  const [editingBot, setEditingBot] = useState<BotSummary | null>(null);
  const [botForm, setBotForm] = useState<BotFormState>(emptyBotForm());
  const [tokenSearch, setTokenSearch] = useState('');
  const [botError, setBotError] = useState<string | null>(null);
  const [strategyDetail, setStrategyDetail] = useState<BotStrategyTemplate | null>(null);
  const [detailBotId, setDetailBotId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  useAutoDismissNotice(actionError, () => setActionError(null), 8000);

  const strategies = useQuery({
    queryKey: ['trading-bot-strategies'],
    queryFn: fetchBotStrategies,
    staleTime: 5 * 60_000,
  });
  const bots = useQuery({
    queryKey: ['trading-bots'],
    queryFn: () => fetchTradingBots(false),
    refetchInterval: 15_000,
  });
  const watchlist = useQuery({
    queryKey: ['trading-bot-tokens'],
    queryFn: () => fetchWatchlist(false, undefined, undefined, 100),
    enabled: botDialogOpen || Boolean(strategyDetail),
  });

  const templates = strategies.data?.data ?? [];
  const tokenEntries = watchlist.data?.data ?? [];
  const visibleTokenEntries = filterBySearch(tokenEntries, tokenSearch, (entry) => [
    entry.asset.symbol,
    entry.asset.name,
    entry.asset.chainCode,
  ]);
  const selectedTemplate = templates.find((template) => template.key === botForm.strategyKey);
  const sortedBots = [...(bots.data?.data ?? [])].sort((a, b) => compareBots(a, b, sort));

  useEffect(() => {
    if (!botDialogOpen || templates.length === 0) return;
    if (templates.some((template) => template.key === botForm.strategyKey)) return;
    const first = templates[0];
    setBotForm((current) => ({
      ...current,
      strategyKey: first.key,
      strategyParams: paramsToForm(first.defaultParams),
    }));
  }, [botDialogOpen, templates, botForm.strategyKey]);

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['trading-bots'] });
    void queryClient.invalidateQueries({ queryKey: ['trading-bot'] });
    void queryClient.invalidateQueries({ queryKey: ['trading-bot-trades'] });
    void queryClient.invalidateQueries({ queryKey: ['trading-bot-events'] });
    void queryClient.invalidateQueries({ queryKey: ['trading-bot-equity'] });
    void queryClient.invalidateQueries({ queryKey: ['trading-bot-signals'] });
    void queryClient.invalidateQueries({ queryKey: ['notifications-unread-count'] });
  };

  const createBotMutation = useMutation({
    mutationFn: (body: BotCreateRequest) => createTradingBot(body),
    onSuccess: (created) => {
      setBotDialogOpen(false);
      setBotError(null);
      notify('Бот создан. Запустите его, чтобы начать бумажную торговлю.');
      setDetailBotId(created.bot.id);
      invalidate();
    },
    onError: (err) => setBotError(toRussianError(err, 'Не удалось создать бота')),
  });

  const updateBotMutation = useMutation({
    mutationFn: ({ id, body }: { id: string; body: BotUpdateRequest }) =>
      updateTradingBot(id, body),
    onSuccess: () => {
      setBotDialogOpen(false);
      setEditingBot(null);
      setBotError(null);
      notify('Настройки бота сохранены.');
      invalidate();
    },
    onError: (err) => setBotError(toRussianError(err, 'Не удалось сохранить бота')),
  });

  const startMutation = useMutation({
    mutationFn: startTradingBot,
    onSuccess: () => {
      notify('Бот запущен.');
      invalidate();
    },
    onError: (err) => notify(toRussianError(err, 'Не удалось запустить бота'), true),
  });
  const stopMutation = useMutation({
    mutationFn: stopTradingBot,
    onSuccess: () => {
      notify('Бот остановлен.');
      invalidate();
    },
    onError: (err) => notify(toRussianError(err, 'Не удалось остановить бота'), true),
  });
  const resetMutation = useMutation({
    mutationFn: resetTradingBot,
    onSuccess: () => {
      notify('Бумажное состояние сброшено.');
      invalidate();
    },
    onError: (err) => notify(toRussianError(err, 'Не удалось сбросить бота'), true),
  });
  const closePositionsMutation = useMutation({
    mutationFn: closeTradingBotPositions,
    onSuccess: () => {
      notify('Все позиции закрыты, бот остановлен.');
      invalidate();
    },
    onError: (err) => notify(toRussianError(err, 'Не удалось закрыть позиции'), true),
  });
  const archiveMutation = useMutation({
    mutationFn: archiveTradingBot,
    onSuccess: () => {
      setDetailBotId(null);
      notify('Бот удалён в архив.');
      invalidate();
    },
    onError: (err) => notify(toRussianError(err, 'Не удалось удалить бота'), true),
  });

  function notify(message: string, isError = false) {
    if (!isError) return;
    setActionError(message);
  }

  function openCreateBot() {
    if (strategies.isError) {
      notify(toRussianError(strategies.error, 'Не удалось загрузить стратегии'), true);
      return;
    }
    setEditingBot(null);
    setBotForm(emptyBotForm(templates[0]));
    setTokenSearch('');
    setBotError(null);
    setBotDialogOpen(true);
  }

  async function openEditBot(bot: BotSummary) {
    if (bot.status === 'running') {
      notify('Остановите робота, чтобы изменить настройки.', true);
      return;
    }
    let detail;
    try {
      detail = await fetchTradingBot(bot.id);
    } catch (error) {
      notify(toRussianError(error, 'Не удалось загрузить настройки бота'), true);
      return;
    }
    setEditingBot(detail.bot);
    setBotForm({
      name: detail.bot.name,
      description: detail.bot.description,
      strategyKey: detail.strategy.key,
      strategyParams: paramsToForm(detail.strategyParams),
      tokenAssetIds: detail.tokens.map((token) => token.assetId),
      budgetUsd: detail.bot.budgetUsd,
      maxPositions: String(detail.bot.maxPositions),
      positionSizePct: String(detail.bot.positionSizePct),
      feeBps: String(detail.bot.feeBps),
      slippageBps: String(detail.bot.slippageBps),
      maxDailyLossPct: String(detail.bot.maxDailyLossPct),
      cooldownMinutes: String(detail.bot.cooldownMinutes),
    });
    setTokenSearch('');
    setBotError(null);
    setBotDialogOpen(true);
  }

  function changeStrategy(key: string) {
    const template = templates.find((item) => item.key === key);
    setBotForm((current) => ({
      ...current,
      strategyKey: key,
      strategyParams: paramsToForm(template?.defaultParams ?? defaultParams),
    }));
  }

  function submitBot() {
    setBotError(null);
    if (!botForm.name.trim()) {
      setBotError('Укажите название робота.');
      return;
    }
    const template = templates.find((item) => item.key === botForm.strategyKey);
    if (!template) {
      setBotError('Выберите стратегию.');
      return;
    }
    if (botForm.tokenAssetIds.length === 0) {
      setBotError('Выберите хотя бы один токен.');
      return;
    }
    const budget = Number(botForm.budgetUsd);
    if (!editingBot && (!Number.isFinite(budget) || budget < 100 || budget % 100 !== 0)) {
      setBotError('Бюджет должен быть от $100 и кратен $100.');
      return;
    }

    let strategyParams: Record<string, unknown>;
    try {
      strategyParams = formToParams(template.paramFields, botForm.strategyParams);
    } catch (error) {
      setBotError(error instanceof Error ? error.message : 'Некорректные параметры стратегии');
      return;
    }

    const common = {
      name: botForm.name.trim(),
      description: botForm.description.trim(),
      strategyKey: template.key,
      strategyParams,
      tokenAssetIds: botForm.tokenAssetIds,
      maxPositions: Number(botForm.maxPositions),
      positionSizePct: Number(botForm.positionSizePct),
      feeBps: Number(botForm.feeBps),
      slippageBps: Number(botForm.slippageBps),
      maxDailyLossPct: Number(botForm.maxDailyLossPct),
      cooldownMinutes: Number(botForm.cooldownMinutes),
    };

    if (editingBot) {
      updateBotMutation.mutate({ id: editingBot.id, body: common });
      return;
    }

    createBotMutation.mutate({ ...common, budgetUsd: botForm.budgetUsd });
  }

  const busy =
    startMutation.isPending ||
    stopMutation.isPending ||
    resetMutation.isPending ||
    closePositionsMutation.isPending ||
    archiveMutation.isPending;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Тестирование"
        subtitle="Бумажные торговые боты. Реальные деньги и подписи не используются."
        actions={<Button onClick={openCreateBot}>Добавить робота</Button>}
      />

      {actionError ? (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          {actionError}
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <div
          role="tablist"
          aria-label="Раздел тестирования"
          className="flex flex-wrap gap-1 rounded-lg border border-zinc-200 bg-zinc-50 p-1"
        >
          {(
            [
              ['bots', 'Роботы'],
              ['strategies', 'Стратегии'],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={tab === value}
              onClick={() => setTab(value)}
              className={`rounded-md px-3 py-1.5 text-sm ${
                tab === value
                  ? 'bg-white text-zinc-900 shadow-sm'
                  : 'text-zinc-500 hover:text-zinc-900'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {tab === 'bots' ? (
          <div
            role="tablist"
            aria-label="Сортировка роботов"
            className="flex flex-wrap gap-1 rounded-lg border border-zinc-200 bg-zinc-50 p-1"
          >
            {sortOptions.map((option) => (
              <button
                key={option.value}
                type="button"
                role="tab"
                aria-selected={sort === option.value}
                onClick={() => setSort(option.value)}
                className={`rounded-md px-3 py-1.5 text-sm ${
                  sort === option.value
                    ? 'bg-white text-zinc-900 shadow-sm'
                    : 'text-zinc-500 hover:text-zinc-900'
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
        ) : null}
      </div>

      {tab === 'bots' ? (
        bots.isPending ? (
          <LoadingRows rows={6} />
        ) : bots.isError ? (
          <ErrorState
            message={toRussianError(bots.error, 'Не удалось загрузить роботов')}
            onRetry={() => void bots.refetch()}
          />
        ) : sortedBots.length === 0 ? (
          <Card>
            <CardTitle>Роботов пока нет</CardTitle>
            <CardDescription>
              Добавьте робота, выберите встроенную стратегию, токены и бюджет.
            </CardDescription>
            <Button className="mt-4" onClick={openCreateBot}>
              Добавить робота
            </Button>
          </Card>
        ) : (
          <div className="space-y-2">
            {sortedBots.map((bot) => (
              <Card
                key={bot.id}
                role="button"
                tabIndex={0}
                aria-label={`Открыть робота ${bot.name}`}
                className="cursor-pointer p-3 transition-colors hover:border-emerald-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/40"
                onClick={() => setDetailBotId(bot.id)}
                onKeyDown={(event) => {
                  if (event.target !== event.currentTarget) return;
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    setDetailBotId(bot.id);
                  }
                }}
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex min-w-0 flex-1 items-start gap-3 text-left">
                    <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-zinc-200 bg-zinc-50 text-zinc-700">
                      <NavIcon name="testing" className="h-5 w-5" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        {bot.status === 'running' ? <FanIcon spinning /> : null}
                        <span className="text-base font-semibold text-zinc-900">{bot.name}</span>
                        <Badge tone={bot.status === 'running' ? 'success' : 'neutral'}>
                          {bot.status === 'running'
                            ? 'Работает'
                            : bot.status === 'draft'
                              ? 'Черновик'
                              : 'Остановлен'}
                        </Badge>
                        <Badge tone="info">{bot.strategy.name}</Badge>
                      </div>
                      <div className="mt-1 text-xs text-zinc-500">
                        {bot.description || 'Без описания'} · бюджет {formatUsd(bot.budgetUsd)}
                        {bot.lastTickAt ? ` · тик ${formatDateTime(bot.lastTickAt)}` : ''}
                      </div>
                    </div>
                  </div>
                  <div
                    className="flex shrink-0 flex-wrap gap-1"
                    onClick={(event) => event.stopPropagation()}
                    onKeyDown={(event) => event.stopPropagation()}
                  >
                    <Button
                      variant="ghost"
                      className="h-8 px-2 text-xs"
                      onClick={() => void openEditBot(bot)}
                      disabled={bot.status === 'running'}
                      title={
                        bot.status === 'running'
                          ? 'Остановите робота, чтобы изменить настройки'
                          : undefined
                      }
                    >
                      Настройки
                    </Button>
                    {bot.status === 'running' ? (
                      <Button
                        variant="secondary"
                        className="h-8 px-2 text-xs"
                        onClick={() => stopMutation.mutate(bot.id)}
                        disabled={busy}
                      >
                        Остановить
                      </Button>
                    ) : (
                      <Button
                        className="h-8 px-2 text-xs"
                        onClick={() => startMutation.mutate(bot.id)}
                        disabled={busy}
                      >
                        Запустить
                      </Button>
                    )}
                  </div>
                </div>
                <div className="mt-3">
                  <BotStats bot={bot} />
                </div>
              </Card>
            ))}
          </div>
        )
      ) : strategies.isPending ? (
        <LoadingRows rows={5} />
      ) : strategies.isError ? (
        <ErrorState
          message={toRussianError(strategies.error, 'Не удалось загрузить стратегии')}
          onRetry={() => void strategies.refetch()}
        />
      ) : (
        <Card>
          <CardTitle>Стратегии</CardTitle>
          <CardDescription>
            Встроенные алгоритмы. Их нельзя изменить — параметры настраиваются в каждом роботе.
            Нажмите на карточку, чтобы прочитать описание и гайд.
          </CardDescription>
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            {templates.map((template) => (
              <button
                key={template.key}
                type="button"
                onClick={() => setStrategyDetail(template)}
                className="rounded-xl border border-zinc-200 p-3 text-left transition-colors hover:border-emerald-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/40"
              >
                <div className="flex items-start gap-3">
                  <StrategyIcon icon={template.icon} />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium text-zinc-900">{template.name}</span>
                      <Badge tone={template.kind === 'system' ? 'info' : 'warning'}>
                        {template.kind === 'system' ? 'Системная' : 'Кастомная'}
                      </Badge>
                    </div>
                    <p className="mt-1 text-xs text-zinc-500">{template.description}</p>
                    <p className="mt-2 text-[11px] text-zinc-400">
                      {template.paramFields.length} параметров · нажмите для подробностей
                    </p>
                  </div>
                </div>
              </button>
            ))}
          </div>
        </Card>
      )}

      <Drawer
        open={botDialogOpen}
        onClose={() => setBotDialogOpen(false)}
        title={editingBot ? 'Настройки робота' : 'Новый робот'}
        description="Бумажный портфель. Реальные свопы не выполняются."
        size="lg"
        footer={
          <>
            <Button variant="ghost" onClick={() => setBotDialogOpen(false)}>
              Отмена
            </Button>
            <Button
              onClick={submitBot}
              disabled={
                createBotMutation.isPending ||
                updateBotMutation.isPending ||
                !botForm.name.trim() ||
                botForm.tokenAssetIds.length === 0
              }
            >
              {editingBot ? 'Сохранить' : 'Создать'}
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-sm text-zinc-600">
              Название
              <Input
                className="mt-1"
                value={botForm.name}
                onChange={(event) => setBotForm({ ...botForm, name: event.target.value })}
                placeholder="Momentum BSC"
              />
            </label>
            <label className="block text-sm text-zinc-600">
              Стратегия
              <Select
                className="mt-1"
                value={botForm.strategyKey}
                onChange={(event) => changeStrategy(event.target.value)}
              >
                {templates.map((template) => (
                  <option key={template.key} value={template.key}>
                    {template.name}
                  </option>
                ))}
              </Select>
              {selectedTemplate ? (
                <p className="mt-1 text-[11px] leading-4 text-zinc-500">
                  {selectedTemplate.description}
                </p>
              ) : null}
            </label>
          </div>
          <label className="block text-sm text-zinc-600">
            Описание
            <Textarea
              className="mt-1"
              value={botForm.description}
              onChange={(event) => setBotForm({ ...botForm, description: event.target.value })}
              placeholder="Что тестируем и на каком рынке"
            />
          </label>

          {selectedTemplate ? (
            <div className="rounded-xl border border-zinc-200 bg-zinc-50/60 p-3">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <div className="text-sm font-medium text-zinc-800">
                  Параметры стратегии · {selectedTemplate.name}
                </div>
                <button
                  type="button"
                  className="text-xs text-emerald-700 hover:underline"
                  onClick={() => setStrategyDetail(selectedTemplate)}
                >
                  Что это за стратегия?
                </button>
              </div>
              <StrategyParamInputs
                template={selectedTemplate}
                values={botForm.strategyParams}
                onChange={(key, value) =>
                  setBotForm((current) => ({
                    ...current,
                    strategyParams: { ...current.strategyParams, [key]: value },
                  }))
                }
              />
            </div>
          ) : null}

          <div>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-sm text-zinc-600">Токены из Базы токенов</div>
              <div className="text-xs text-zinc-500">Выбрано: {botForm.tokenAssetIds.length}</div>
            </div>
            <Input
              className="mt-2"
              value={tokenSearch}
              onChange={(event) => setTokenSearch(event.target.value)}
              placeholder="Поиск: символ, название или сеть"
              aria-label="Поиск токена"
            />
            <div className="mt-2 max-h-56 space-y-1 overflow-y-auto rounded-xl border border-zinc-200 p-2">
              {watchlist.isPending ? (
                <p className="text-xs text-zinc-500">Загрузка токенов…</p>
              ) : watchlist.isError ? (
                <p className="text-xs text-red-700">
                  {toRussianError(watchlist.error, 'Не удалось загрузить Базу токенов')}
                </p>
              ) : tokenEntries.length === 0 ? (
                <p className="text-xs text-zinc-500">В базе нет активных токенов.</p>
              ) : visibleTokenEntries.length === 0 ? (
                <p className="text-xs text-zinc-500">Ничего не найдено.</p>
              ) : (
                visibleTokenEntries.map((entry) => {
                  const checked = botForm.tokenAssetIds.includes(entry.asset.id);
                  return (
                    <label
                      key={entry.asset.id}
                      className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1 text-sm hover:bg-zinc-50"
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() =>
                          setBotForm((current) => ({
                            ...current,
                            tokenAssetIds: checked
                              ? current.tokenAssetIds.filter((id) => id !== entry.asset.id)
                              : [...current.tokenAssetIds, entry.asset.id],
                          }))
                        }
                      />
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
                    </label>
                  );
                })
              )}
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <label className="block text-sm text-zinc-600">
              Бюджет, USD
              <Input
                className="mt-1"
                type="number"
                min={100}
                step={100}
                value={botForm.budgetUsd}
                onChange={(event) => setBotForm({ ...botForm, budgetUsd: event.target.value })}
                disabled={Boolean(editingBot)}
              />
            </label>
            <label className="block text-sm text-zinc-600">
              Макс. позиций
              <Input
                className="mt-1"
                type="number"
                min={1}
                max={20}
                value={botForm.maxPositions}
                onChange={(event) => setBotForm({ ...botForm, maxPositions: event.target.value })}
              />
            </label>
            <label className="block text-sm text-zinc-600">
              Размер позиции, %
              <Input
                className="mt-1"
                type="number"
                min={1}
                max={100}
                value={botForm.positionSizePct}
                onChange={(event) =>
                  setBotForm({ ...botForm, positionSizePct: event.target.value })
                }
              />
            </label>
            <label className="block text-sm text-zinc-600">
              Пауза после покупки, мин
              <Input
                className="mt-1"
                type="number"
                min={0}
                max={1440}
                value={botForm.cooldownMinutes}
                onChange={(event) =>
                  setBotForm({ ...botForm, cooldownMinutes: event.target.value })
                }
              />
              <p className="mt-1 text-[11px] leading-4 text-zinc-500">
                Не даёт докупать токен чаще указанного времени. Продажи не блокирует.
              </p>
            </label>
            <label className="block text-sm text-zinc-600">
              Комиссия, bps
              <Input
                className="mt-1"
                type="number"
                min={0}
                max={500}
                value={botForm.feeBps}
                onChange={(event) => setBotForm({ ...botForm, feeBps: event.target.value })}
              />
            </label>
            <label className="block text-sm text-zinc-600">
              Проскальзывание, bps
              <Input
                className="mt-1"
                type="number"
                min={0}
                max={500}
                value={botForm.slippageBps}
                onChange={(event) => setBotForm({ ...botForm, slippageBps: event.target.value })}
              />
            </label>
            <label className="block text-sm text-zinc-600">
              Дневной лимит убытка, %
              <Input
                className="mt-1"
                type="number"
                min={0}
                max={100}
                value={botForm.maxDailyLossPct}
                onChange={(event) =>
                  setBotForm({ ...botForm, maxDailyLossPct: event.target.value })
                }
              />
            </label>
          </div>
          {botError ? <p className="text-sm text-red-700">{botError}</p> : null}
        </div>
      </Drawer>

      <Drawer
        open={Boolean(strategyDetail)}
        onClose={() => setStrategyDetail(null)}
        title={strategyDetail?.name ?? 'Стратегия'}
        titleIcon={
          strategyDetail ? (
            <StrategyIcon icon={strategyDetail.icon} className="h-8 w-8" />
          ) : undefined
        }
        size="lg"
        footer={
          <Button variant="ghost" onClick={() => setStrategyDetail(null)}>
            Закрыть
          </Button>
        }
      >
        {strategyDetail ? (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={strategyDetail.kind === 'system' ? 'info' : 'warning'}>
                {strategyDetail.kind === 'system' ? 'Системная' : 'Кастомная'}
              </Badge>
              <span className="font-mono text-xs text-zinc-500">{strategyDetail.key}</span>
            </div>
            <Card>
              <CardTitle>Что это</CardTitle>
              <p className="mt-1 text-sm text-zinc-700">{strategyDetail.description}</p>
            </Card>
            <Card>
              <CardTitle>Как работает</CardTitle>
              <p className="mt-1 text-sm leading-6 text-zinc-700">{strategyDetail.guide}</p>
            </Card>
            <Card>
              <CardTitle>Параметры по умолчанию</CardTitle>
              <div className="mt-2 space-y-2">
                {strategyDetail.paramFields.map((field) => {
                  const value = strategyDetail.defaultParams[field.key];
                  return (
                    <div
                      key={field.key}
                      className="flex items-start justify-between gap-3 border-b border-zinc-100 pb-2 last:border-0 last:pb-0"
                    >
                      <div className="text-sm text-zinc-700">
                        {field.label}
                        {field.hint ? (
                          <div className="text-[11px] text-zinc-500">{field.hint}</div>
                        ) : null}
                      </div>
                      <div className="shrink-0 font-mono text-sm text-zinc-900">
                        {value === undefined ? '—' : String(value)}
                        {field.unit ? ` ${field.unit}` : ''}
                      </div>
                    </div>
                  );
                })}
              </div>
            </Card>
            <p className="text-xs leading-5 text-zinc-500">
              Стратегия встроена в приложение и не редактируется. Все числовые параметры задаются
              отдельно для каждого робота при создании или в настройках.
            </p>
            <BacktestPanel
              key={strategyDetail.key}
              template={strategyDetail}
              tokenEntries={tokenEntries}
              tokensPending={watchlist.isPending}
              tokensError={watchlist.error}
            />
          </div>
        ) : null}
      </Drawer>

      <BotDetailDrawer
        botId={detailBotId}
        onClose={() => setDetailBotId(null)}
        onEdit={(bot) => void openEditBot(bot)}
        onStart={(id) => startMutation.mutate(id)}
        onStop={(id) => stopMutation.mutate(id)}
        onReset={(id) => {
          if (window.confirm('Сбросить бумажное состояние бота? Сделки и позиции будут удалены.')) {
            resetMutation.mutate(id);
          }
        }}
        onClosePositions={(id) => {
          if (
            window.confirm(
              'Закрыть все открытые позиции по текущим котировкам? Бот будет остановлен, сделки сохранятся.',
            )
          ) {
            closePositionsMutation.mutate(id);
          }
        }}
        onArchive={(id) => {
          if (window.confirm('Удалить бота в архив? История сохранится.')) {
            archiveMutation.mutate(id);
          }
        }}
        busy={busy}
      />
    </div>
  );
}

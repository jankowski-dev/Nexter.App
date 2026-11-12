import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardDescription, CardTitle } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { PageHeader } from '@/components/ui/page-header';
import { Select } from '@/components/ui/select';
import { ErrorState, LoadingRows } from '@/components/ui/states';
import { Textarea } from '@/components/ui/textarea';
import { FanIcon } from '@/components/live-refresh-indicator';
import { TokenIcon } from '@/components/token-icon';
import {
  archiveTradingBot,
  createBotStrategy,
  createTradingBot,
  fetchBotStrategies,
  fetchTradingBot,
  fetchTradingBots,
  fetchWatchlist,
  resetTradingBot,
  startTradingBot,
  stopTradingBot,
  updateBotStrategy,
  updateTradingBot,
} from '@/lib/api';
import { toRussianError } from '@/lib/error-messages';
import { formatDateTime, formatSignedUsd, formatUsd, pnlTone } from '@/lib/format';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import type {
  BotCreateRequest,
  BotStrategy,
  BotStrategyTemplate,
  BotSummary,
  BotUpdateRequest,
} from '@nexter/contracts';
import { BotDetailDrawer } from './bot-detail-drawer';

type Tab = 'bots' | 'strategies';
type BotFormState = {
  name: string;
  description: string;
  strategyId: string;
  tokenAssetIds: string[];
  budgetUsd: string;
  maxPositions: string;
  positionSizePct: string;
  feeBps: string;
  slippageBps: string;
  maxDailyLossPct: string;
  cooldownMinutes: string;
};

function emptyBotForm(strategyId = ''): BotFormState {
  return {
    name: '',
    description: '',
    strategyId,
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

function jsonParams(value: Record<string, unknown>): string {
  return JSON.stringify(value, null, 2);
}

function parseParams(value: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(value);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Параметры должны быть JSON-объектом');
  }
  return parsed as Record<string, unknown>;
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
  const [botDialogOpen, setBotDialogOpen] = useState(false);
  const [editingBot, setEditingBot] = useState<BotSummary | null>(null);
  const [botForm, setBotForm] = useState<BotFormState>(emptyBotForm());
  const [strategyDialogOpen, setStrategyDialogOpen] = useState(false);
  const [editingStrategy, setEditingStrategy] = useState<BotStrategy | null>(null);
  const [strategyKey, setStrategyKey] = useState('momentum_breakout');
  const [strategyName, setStrategyName] = useState('');
  const [strategyDescription, setStrategyDescription] = useState('');
  const [strategyParams, setStrategyParams] = useState('{}');
  const [strategyError, setStrategyError] = useState<string | null>(null);
  const [botError, setBotError] = useState<string | null>(null);
  const [detailBotId, setDetailBotId] = useState<string | null>(null);
  const [pendingBotAfterStrategy, setPendingBotAfterStrategy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [noticeError, setNoticeError] = useState(false);

  const strategies = useQuery({
    queryKey: ['trading-bot-strategies'],
    queryFn: fetchBotStrategies,
    refetchInterval: 30_000,
  });
  const bots = useQuery({
    queryKey: ['trading-bots'],
    queryFn: () => fetchTradingBots(false),
    refetchInterval: 15_000,
  });
  const watchlist = useQuery({
    queryKey: ['trading-bot-tokens'],
    queryFn: () => fetchWatchlist(false, undefined, undefined, 100),
    enabled: botDialogOpen,
  });

  const templates = strategies.data?.templates ?? [];
  const strategyInstances = strategies.data?.data ?? [];
  const tokenEntries = watchlist.data?.data ?? [];
  const runningBots = (bots.data?.data ?? []).filter((bot) => bot.status === 'running').length;

  useEffect(() => {
    if (!botForm.strategyId && strategyInstances[0]) {
      setBotForm((current) => ({ ...current, strategyId: strategyInstances[0].id }));
    }
  }, [botForm.strategyId, strategyInstances]);

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['trading-bots'] });
    void queryClient.invalidateQueries({ queryKey: ['trading-bot'] });
    void queryClient.invalidateQueries({ queryKey: ['trading-bot-trades'] });
    void queryClient.invalidateQueries({ queryKey: ['trading-bot-events'] });
    void queryClient.invalidateQueries({ queryKey: ['trading-bot-equity'] });
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
  const archiveMutation = useMutation({
    mutationFn: archiveTradingBot,
    onSuccess: () => {
      setDetailBotId(null);
      notify('Бот удалён в архив.');
      invalidate();
    },
    onError: (err) => notify(toRussianError(err, 'Не удалось удалить бота'), true),
  });

  const createStrategyMutation = useMutation({
    mutationFn: createBotStrategy,
    onSuccess: async (created) => {
      setStrategyDialogOpen(false);
      setStrategyError(null);
      await queryClient.refetchQueries({ queryKey: ['trading-bot-strategies'] });
      notify('Стратегия создана.');
      if (pendingBotAfterStrategy) {
        setPendingBotAfterStrategy(false);
        setEditingBot(null);
        setBotForm(emptyBotForm(created.id));
        setBotError(null);
        setBotDialogOpen(true);
      }
    },
    onError: (err) => {
      const message = toRussianError(err, 'Не удалось создать стратегию');
      setStrategyError(message);
      notify(message, true);
    },
  });

  const updateStrategyMutation = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Parameters<typeof updateBotStrategy>[1] }) =>
      updateBotStrategy(id, body),
    onSuccess: () => {
      setStrategyDialogOpen(false);
      setEditingStrategy(null);
      setStrategyError(null);
      notify('Стратегия сохранена.');
      void queryClient.invalidateQueries({ queryKey: ['trading-bot-strategies'] });
    },
    onError: (err) => {
      const message = toRussianError(err, 'Не удалось сохранить стратегию');
      setStrategyError(message);
      notify(message, true);
    },
  });

  function notify(message: string, isError = false) {
    setNotice(message);
    setNoticeError(isError);
  }

  function openCreateBot() {
    if (strategies.isPending) {
      notify('Загружаю стратегии…');
      return;
    }
    if (strategies.isError) {
      notify(toRussianError(strategies.error, 'Не удалось загрузить стратегии'), true);
      return;
    }
    if (strategyInstances.length === 0) {
      notify(
        'Сначала создайте стратегию: выберите шаблон и задайте название. После сохранения откроется форма робота.',
      );
      openCreateStrategy(undefined, true);
      return;
    }
    setEditingBot(null);
    setBotForm(emptyBotForm(strategyInstances[0]?.id ?? ''));
    setBotError(null);
    setBotDialogOpen(true);
  }

  async function openEditBot(bot: BotSummary) {
    let tokenAssetIds: string[] = [];
    try {
      const detail = await fetchTradingBot(bot.id);
      tokenAssetIds = detail.tokens.map((token) => token.assetId);
    } catch (error) {
      notify(toRussianError(error, 'Не удалось загрузить настройки бота'), true);
      return;
    }
    setEditingBot(bot);
    setBotForm({
      name: bot.name,
      description: bot.description,
      strategyId: bot.strategy.id,
      tokenAssetIds,
      budgetUsd: bot.budgetUsd,
      maxPositions: String(bot.maxPositions),
      positionSizePct: String(bot.positionSizePct),
      feeBps: String(bot.feeBps),
      slippageBps: String(bot.slippageBps),
      maxDailyLossPct: String(bot.maxDailyLossPct),
      cooldownMinutes: String(bot.cooldownMinutes),
    });
    setBotError(null);
    setBotDialogOpen(true);
  }

  function openCreateStrategy(template?: BotStrategyTemplate, continueToBot = false) {
    setPendingBotAfterStrategy(continueToBot);
    const selected = template ?? templates[0];
    setEditingStrategy(null);
    setStrategyKey(selected?.key ?? 'momentum_breakout');
    setStrategyName(continueToBot ? (selected?.name ?? '') : '');
    setStrategyDescription(selected?.description ?? '');
    setStrategyParams(jsonParams(selected?.defaultParams ?? {}));
    setStrategyError(null);
    setStrategyDialogOpen(true);
  }

  function closeStrategyDialog() {
    setStrategyDialogOpen(false);
    setPendingBotAfterStrategy(false);
  }

  function openEditStrategy(strategy: BotStrategy) {
    setEditingStrategy(strategy);
    setStrategyKey(strategy.key);
    setStrategyName(strategy.name);
    setStrategyDescription(strategy.description);
    setStrategyParams(jsonParams(strategy.params));
    setStrategyError(null);
    setStrategyDialogOpen(true);
  }

  function submitBot() {
    setBotError(null);
    const strategyId = botForm.strategyId;
    if (!strategyId) {
      setBotError('Сначала создайте стратегию.');
      return;
    }
    if (!strategyInstances.some((strategy) => strategy.id === strategyId)) {
      setBotError('Выберите активную стратегию.');
      return;
    }
    if (botForm.tokenAssetIds.length === 0) {
      setBotError('Выберите хотя бы один токен.');
      return;
    }
    const budget = Number(botForm.budgetUsd);
    if (!Number.isFinite(budget) || budget < 100 || budget % 100 !== 0) {
      setBotError('Бюджет должен быть от $100 и кратен $100.');
      return;
    }

    if (editingBot) {
      updateBotMutation.mutate({
        id: editingBot.id,
        body: {
          name: botForm.name.trim(),
          description: botForm.description.trim(),
          strategyId,
          ...(botForm.tokenAssetIds.length > 0 ? { tokenAssetIds: botForm.tokenAssetIds } : {}),
          maxPositions: Number(botForm.maxPositions),
          positionSizePct: Number(botForm.positionSizePct),
          feeBps: Number(botForm.feeBps),
          slippageBps: Number(botForm.slippageBps),
          maxDailyLossPct: Number(botForm.maxDailyLossPct),
          cooldownMinutes: Number(botForm.cooldownMinutes),
        },
      });
      return;
    }

    createBotMutation.mutate({
      name: botForm.name.trim(),
      description: botForm.description.trim(),
      strategyId,
      tokenAssetIds: botForm.tokenAssetIds,
      budgetUsd: botForm.budgetUsd,
      maxPositions: Number(botForm.maxPositions),
      positionSizePct: Number(botForm.positionSizePct),
      feeBps: Number(botForm.feeBps),
      slippageBps: Number(botForm.slippageBps),
      maxDailyLossPct: Number(botForm.maxDailyLossPct),
      cooldownMinutes: Number(botForm.cooldownMinutes),
    });
  }

  function submitStrategy() {
    setStrategyError(null);
    try {
      const params = parseParams(strategyParams);
      if (editingStrategy) {
        updateStrategyMutation.mutate({
          id: editingStrategy.id,
          body: {
            name: strategyName.trim(),
            description: strategyDescription.trim(),
            params,
          },
        });
      } else {
        createStrategyMutation.mutate({
          key: strategyKey as BotStrategy['key'],
          name: strategyName.trim(),
          description: strategyDescription.trim(),
          params,
        });
      }
    } catch (error) {
      setStrategyError(error instanceof Error ? error.message : 'Некорректные параметры');
    }
  }

  const busy =
    startMutation.isPending ||
    stopMutation.isPending ||
    resetMutation.isPending ||
    archiveMutation.isPending;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Тестирование"
        subtitle="Бумажные торговые боты. Реальные деньги и подписи не используются."
        actions={
          <>
            <Button variant="secondary" onClick={() => openCreateStrategy()}>
              Новая стратегия
            </Button>
            <Button onClick={openCreateBot}>Добавить робота</Button>
          </>
        }
      />

      {notice ? (
        <div
          className={`rounded-lg border p-3 text-sm ${
            noticeError
              ? 'border-red-200 bg-red-50 text-red-800'
              : 'border-emerald-200 bg-emerald-50 text-emerald-800'
          }`}
        >
          {notice}
        </div>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div
          role="tablist"
          aria-label="Раздел тестирования"
          className="flex flex-wrap gap-1 rounded-lg border border-zinc-200 bg-zinc-50 p-1"
        >
          {(
            [
              ['bots', `Роботы${runningBots > 0 ? ` · ${runningBots} работает` : ''}`],
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
        <div className="flex items-center gap-2 text-xs text-zinc-500">
          <FanIcon spinning={runningBots > 0} />
          {runningBots > 0 ? 'Роботы работают' : 'Нет запущенных роботов'}
        </div>
      </div>

      {tab === 'bots' ? (
        bots.isPending ? (
          <LoadingRows rows={6} />
        ) : bots.isError ? (
          <ErrorState
            message={toRussianError(bots.error, 'Не удалось загрузить роботов')}
            onRetry={() => void bots.refetch()}
          />
        ) : (bots.data?.data.length ?? 0) === 0 ? (
          <Card>
            <CardTitle>Роботов пока нет</CardTitle>
            <CardDescription>
              Создайте стратегию, затем добавьте робота, выберите токены и бюджет.
            </CardDescription>
            <Button className="mt-4" onClick={openCreateBot}>
              {strategyInstances.length === 0 ? 'Создать стратегию' : 'Добавить робота'}
            </Button>
          </Card>
        ) : (
          <div className="space-y-2">
            {(bots.data?.data ?? []).map((bot) => (
              <Card key={bot.id} className="p-3 transition-colors hover:border-emerald-300">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <button
                    type="button"
                    className="min-w-0 flex-1 text-left"
                    onClick={() => setDetailBotId(bot.id)}
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-base font-semibold text-zinc-900">{bot.name}</span>
                      <Badge tone={bot.status === 'running' ? 'success' : 'neutral'}>
                        {bot.status === 'running'
                          ? 'Работает'
                          : bot.status === 'draft'
                            ? 'Черновик'
                            : 'Остановлен'}
                      </Badge>
                      <Badge tone="info">{bot.strategy.name}</Badge>
                      {bot.status === 'running' ? <FanIcon spinning /> : null}
                    </div>
                    <div className="mt-1 text-xs text-zinc-500">
                      {bot.description || 'Без описания'} · бюджет {formatUsd(bot.budgetUsd)}
                      {bot.lastTickAt ? ` · тик ${formatDateTime(bot.lastTickAt)}` : ''}
                    </div>
                  </button>
                  <div className="flex shrink-0 flex-wrap gap-1">
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
        <div className="space-y-4">
          <Card className="border-sky-200 bg-sky-50/60">
            <CardTitle>Шаблон и стратегия — в чём разница</CardTitle>
            <CardDescription>
              Шаблон — это встроенный в код алгоритм, например «Импульсный пробой». Стратегия —
              сохранённый экземпляр шаблона с названием и параметрами. Робот использует стратегию,
              поэтому один алгоритм можно запускать в нескольких ботах с разными параметрами,
              бюджетами и списками токенов.
            </CardDescription>
          </Card>

          <Card>
            <CardTitle>Шаблоны стратегий</CardTitle>
            <CardDescription>
              Алгоритмы встроены в приложение. Новые шаблоны добавляются кодом и деплоем.
            </CardDescription>
            <div className="mt-3 grid gap-3 md:grid-cols-2">
              {templates.map((template) => (
                <div key={template.key} className="rounded-xl border border-zinc-200 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium text-zinc-900">{template.name}</span>
                    <Badge tone="info">{template.key}</Badge>
                  </div>
                  <p className="mt-1 text-xs text-zinc-500">{template.description}</p>
                  <Button
                    variant="secondary"
                    className="mt-3 h-8 px-2 text-xs"
                    onClick={() => openCreateStrategy(template)}
                  >
                    Создать экземпляр
                  </Button>
                </div>
              ))}
            </div>
          </Card>

          <Card>
            <CardTitle>Мои стратегии (экземпляры)</CardTitle>
            {strategyInstances.length === 0 ? (
              <CardDescription>Создайте экземпляр стратегии из шаблона.</CardDescription>
            ) : (
              <div className="mt-3 grid gap-3 md:grid-cols-2">
                {strategyInstances.map((strategy) => (
                  <div key={strategy.id} className="rounded-xl border border-zinc-200 p-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium text-zinc-900">{strategy.name}</span>
                      <Badge tone="neutral">{strategy.key}</Badge>
                    </div>
                    <p className="mt-1 text-xs text-zinc-500">
                      {strategy.description || 'Без описания'}
                    </p>
                    <div className="mt-3 flex gap-1">
                      <Button
                        variant="secondary"
                        className="h-8 px-2 text-xs"
                        onClick={() => openEditStrategy(strategy)}
                      >
                        Изменить
                      </Button>
                      <Button
                        variant="ghost"
                        className="h-8 px-2 text-xs text-red-700"
                        onClick={() => {
                          if (
                            window.confirm(
                              'Архивировать стратегию? Роботы на ней должны быть остановлены.',
                            )
                          ) {
                            updateStrategyMutation.mutate({
                              id: strategy.id,
                              body: { archived: true },
                            });
                          }
                        }}
                      >
                        В архив
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>
      )}

      <Dialog
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
                value={botForm.strategyId}
                onChange={(event) => setBotForm({ ...botForm, strategyId: event.target.value })}
              >
                {strategyInstances.length === 0 ? (
                  <option value="">Сначала создайте стратегию</option>
                ) : (
                  strategyInstances.map((strategy) => (
                    <option key={strategy.id} value={strategy.id}>
                      {strategy.name} · {strategy.key}
                    </option>
                  ))
                )}
              </Select>
              {strategyInstances.length === 0 ? (
                <p className="mt-1 text-xs text-amber-700">
                  Без стратегии робот не сможет торговать.
                </p>
              ) : (
                <p className="mt-1 text-xs text-zinc-500">
                  Стратегия — это шаблон с сохранёнными параметрами.
                </p>
              )}
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
          <div>
            <div className="text-sm text-zinc-600">Токены из Базы токенов</div>
            <div className="mt-2 max-h-48 space-y-1 overflow-y-auto rounded-xl border border-zinc-200 p-2">
              {watchlist.isPending ? (
                <p className="text-xs text-zinc-500">Загрузка токенов…</p>
              ) : watchlist.isError ? (
                <p className="text-xs text-red-700">
                  {toRussianError(watchlist.error, 'Не удалось загрузить Базу токенов')}
                </p>
              ) : tokenEntries.length === 0 ? (
                <p className="text-xs text-zinc-500">В базе нет активных токенов.</p>
              ) : (
                tokenEntries.map((entry) => {
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
                          setBotForm({
                            ...botForm,
                            tokenAssetIds: checked
                              ? botForm.tokenAssetIds.filter((id) => id !== entry.asset.id)
                              : [...botForm.tokenAssetIds, entry.asset.id],
                          })
                        }
                      />
                      <TokenIcon
                        logoUrl={entry.logoUrl ?? entry.asset.logoUrl}
                        symbol={entry.asset.symbol}
                        className="h-5 w-5 text-[9px]"
                      />
                      <span className="font-medium">{entry.asset.symbol}</span>
                      <span className="text-xs text-zinc-500">{entry.asset.chainCode}</span>
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
              Кулдаун, мин
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
      </Dialog>

      <Dialog
        open={strategyDialogOpen}
        onClose={closeStrategyDialog}
        title={editingStrategy ? 'Изменить стратегию' : 'Новая стратегия'}
        description="Стратегия — это экземпляр встроенного шаблона с сохранёнными параметрами."
        size="lg"
        footer={
          <>
            <Button variant="ghost" onClick={closeStrategyDialog}>
              Отмена
            </Button>
            <Button
              onClick={submitStrategy}
              disabled={
                createStrategyMutation.isPending ||
                updateStrategyMutation.isPending ||
                !strategyName.trim()
              }
            >
              {editingStrategy ? 'Сохранить' : 'Создать'}
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          {pendingBotAfterStrategy ? (
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
              Сначала создайте стратегию. После сохранения сразу откроется форма нового робота.
            </div>
          ) : null}
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-sm text-zinc-600">
              Название
              <Input
                className="mt-1"
                value={strategyName}
                onChange={(event) => setStrategyName(event.target.value)}
              />
            </label>
            <label className="block text-sm text-zinc-600">
              Шаблон
              <Select
                className="mt-1"
                value={strategyKey}
                disabled={Boolean(editingStrategy)}
                onChange={(event) => {
                  const key = event.target.value;
                  const template = templates.find((item) => item.key === key);
                  setStrategyKey(key);
                  if (template) setStrategyParams(jsonParams(template.defaultParams));
                }}
              >
                {templates.map((template) => (
                  <option key={template.key} value={template.key}>
                    {template.name}
                  </option>
                ))}
              </Select>
            </label>
          </div>
          <label className="block text-sm text-zinc-600">
            Описание
            <Textarea
              className="mt-1"
              value={strategyDescription}
              onChange={(event) => setStrategyDescription(event.target.value)}
            />
          </label>
          <label className="block text-sm text-zinc-600">
            Параметры (JSON)
            <Textarea
              className="mt-1 min-h-48 font-mono text-xs"
              value={strategyParams}
              onChange={(event) => setStrategyParams(event.target.value)}
            />
          </label>
          {strategyError ? <p className="text-sm text-red-700">{strategyError}</p> : null}
        </div>
      </Dialog>

      <BotDetailDrawer
        botId={detailBotId}
        onClose={() => setDetailBotId(null)}
        onStart={(id) => startMutation.mutate(id)}
        onStop={(id) => stopMutation.mutate(id)}
        onReset={(id) => {
          if (window.confirm('Сбросить бумажное состояние бота? Сделки и позиции будут удалены.')) {
            resetMutation.mutate(id);
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

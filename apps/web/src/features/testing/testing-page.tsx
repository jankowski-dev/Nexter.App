import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardDescription, CardTitle } from '@/components/ui/card';
import { Drawer } from '@/components/ui/drawer';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { ErrorState, LoadingRows } from '@/components/ui/states';
import { Textarea } from '@/components/ui/textarea';
import { FanIcon } from '@/components/live-refresh-indicator';
import { TokenIcon } from '@/components/token-icon';
import {
  deleteTradingBot,
  closeTradingBotPositions,
  createTradingBot,
  fetchBotStrategies,
  fetchTradingBot,
  fetchTradingBots,
  fetchWatchlist,
  fetchWatchlistGroups,
  startTradingBot,
  stopTradingBot,
  updateTradingBot,
} from '@/lib/api';
import { toRussianError } from '@/lib/error-messages';
import { formatDateTime, formatPrice, formatSignedUsd, formatUsd, pnlTone } from '@/lib/format';
import { useConfirm } from '@/lib/confirm';
import { useRuntimeSettings } from '../settings/use-settings';
import { filterBySearch } from '@/lib/search';
import { useAutoDismissNotice } from '@/lib/use-auto-dismiss-notice';
import { compressTokenIcon } from '@/lib/image';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Decimal } from 'decimal.js';
import { useEffect, useRef, useState } from 'react';
import type {
  BotCreateRequest,
  BotStrategyTemplate,
  BotSummary,
  BotToken,
  BotUpdateRequest,
} from '@nexter/contracts';
import { BacktestPanel } from './backtest-panel';
import { BotDetailDrawer } from './bot-detail-drawer';
import { BotIcon } from './bot-icon';
import { BotUptimeText } from './bot-uptime';
import { StrategyIcon } from './strategy-icon';
import { StrategyParamInputs } from './strategy-param-inputs';
import { formatStrategyParamValue, formToParams, paramsToForm } from './strategy-params';

export type TestingMode = 'bots' | 'strategies';
type Sort = 'pnl' | 'equity' | 'profitFactor';

type TestConfig = {
  strategyKey: string;
  assetId?: string;
  params?: Record<string, string>;
  useStopLoss?: boolean;
  useTakeProfit?: boolean;
};

type BotFormState = {
  name: string;
  description: string;
  icon: string | null;
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

function emptyBotForm(
  template?: BotStrategyTemplate,
  defaults?: {
    botDefaultBudgetUsd: string;
    botDefaultMaxPositions: number;
    botDefaultPositionSizePct: number;
    botDefaultFeeBps: number;
    botDefaultSlippageBps: number;
    botDefaultDailyLossPct: number;
    botDefaultCooldownMinutes: number;
  },
): BotFormState {
  return {
    name: '',
    description: '',
    icon: null,
    strategyKey: template?.key ?? 'momentum_breakout',
    strategyParams: paramsToForm(template?.defaultParams ?? defaultParams),
    tokenAssetIds: [],
    budgetUsd: defaults?.botDefaultBudgetUsd ?? '1000',
    maxPositions: String(defaults?.botDefaultMaxPositions ?? 5),
    positionSizePct: String(defaults?.botDefaultPositionSizePct ?? 20),
    feeBps: String(defaults?.botDefaultFeeBps ?? 25),
    slippageBps: String(defaults?.botDefaultSlippageBps ?? 10),
    maxDailyLossPct: String(defaults?.botDefaultDailyLossPct ?? 10),
    cooldownMinutes: String(defaults?.botDefaultCooldownMinutes ?? 15),
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

function botPnlTone(bot: BotSummary): string {
  const pnl = Number(bot.stats.totalPnlUsd);
  if (!Number.isFinite(pnl) || pnl === 0) return '';
  return pnl > 0 ? 'border-emerald-200 bg-emerald-50/40' : 'border-red-200 bg-red-50/40';
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

export function TestingPage({ mode = 'bots' }: { mode?: TestingMode }) {
  const runtime = useRuntimeSettings();
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const [sort, setSort] = useState<Sort>('pnl');
  const [testConfig, setTestConfig] = useState<TestConfig | null>(null);
  const [botDialogOpen, setBotDialogOpen] = useState(false);
  const [editingBot, setEditingBot] = useState<BotSummary | null>(null);
  const [botForm, setBotForm] = useState<BotFormState>(emptyBotForm());
  const [editingTokens, setEditingTokens] = useState<BotToken[]>([]);
  const [tokenSearch, setTokenSearch] = useState('');
  const [iconUploading, setIconUploading] = useState(false);
  const botIconInputRef = useRef<HTMLInputElement>(null);
  const [botError, setBotError] = useState<string | null>(null);
  const [strategyDetail, setStrategyDetail] = useState<BotStrategyTemplate | null>(null);
  const [detailBotId, setDetailBotId] = useState<string | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [returnToDetailBotId, setReturnToDetailBotId] = useState<string | null>(null);
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
    enabled: mode === 'bots',
    refetchInterval: 15_000,
  });
  const watchlistGroups = useQuery({
    queryKey: ['watchlist-groups'],
    queryFn: fetchWatchlistGroups,
    staleTime: 60_000,
    enabled: botDialogOpen || Boolean(testConfig),
  });
  const defaultGroup =
    watchlistGroups.data?.groups.find((group) => group.isDefault) ??
    watchlistGroups.data?.groups[0] ??
    null;
  const watchlist = useQuery({
    queryKey: ['trading-bot-tokens', defaultGroup?.id ?? null],
    queryFn: () => fetchWatchlist(false, undefined, defaultGroup?.id, 100),
    enabled: Boolean(defaultGroup?.id) && (botDialogOpen || Boolean(testConfig)),
  });

  const templates = strategies.data?.data ?? [];
  const tokenEntries = watchlist.data?.data ?? [];
  const tokenOptions = [
    ...tokenEntries.map((entry) => ({
      assetId: entry.asset.id,
      symbol: entry.asset.symbol,
      name: entry.asset.name,
      chainCode: entry.asset.chainCode,
      logoUrl: entry.logoUrl ?? entry.asset.logoUrl,
    })),
    ...editingTokens
      .filter((token) => !tokenEntries.some((entry) => entry.asset.id === token.assetId))
      .map((token) => ({
        assetId: token.assetId,
        symbol: token.symbol,
        name: token.name,
        chainCode: token.chainCode,
        logoUrl: token.logoUrl,
      })),
  ];
  const visibleTokenEntries = filterBySearch(tokenOptions, tokenSearch, (entry) => [
    entry.symbol,
    entry.name,
    entry.chainCode,
  ]);
  const selectedTemplate = templates.find((template) => template.key === botForm.strategyKey);
  const staticProjection = (() => {
    if (selectedTemplate?.key !== 'static_limit') return null;
    const buy = Number(botForm.strategyParams.buyPriceUsd);
    const stop = Number(botForm.strategyParams.stopPriceUsd);
    const take = Number(botForm.strategyParams.takeProfitPriceUsd);
    const budget = Number(botForm.budgetUsd);
    const sizePct = Number(botForm.positionSizePct);
    if (
      !Number.isFinite(buy) ||
      !Number.isFinite(stop) ||
      !Number.isFinite(take) ||
      !Number.isFinite(budget) ||
      !Number.isFinite(sizePct) ||
      buy <= 0 ||
      stop <= 0 ||
      take <= 0 ||
      budget <= 0 ||
      sizePct <= 0 ||
      stop >= buy ||
      take <= buy
    ) {
      return null;
    }
    const allocation = (budget * sizePct) / 100;
    const quantity = allocation / buy;
    const loss = quantity * (buy - stop);
    const profit = quantity * (take - buy);
    return {
      allocation,
      loss,
      profit,
      lossPct: (loss / allocation) * 100,
      profitPct: (profit / allocation) * 100,
    };
  })();
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

  const testTemplate = testConfig
    ? (templates.find((template) => template.key === testConfig.strategyKey) ?? null)
    : null;

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
      setDetailOpen(true);
      setReturnToDetailBotId(null);
      invalidate();
    },
    onError: (err) => setBotError(toRussianError(err, 'Не удалось создать бота')),
  });

  const updateBotMutation = useMutation({
    mutationFn: ({ id, body }: { id: string; body: BotUpdateRequest }) =>
      updateTradingBot(id, body),
    onSuccess: () => {
      closeBotDialog();
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
  const closePositionsMutation = useMutation({
    mutationFn: closeTradingBotPositions,
    onSuccess: () => {
      notify('Все позиции закрыты, бот остановлен.');
      invalidate();
    },
    onError: (err) => notify(toRussianError(err, 'Не удалось закрыть позиции'), true),
  });
  const archiveMutation = useMutation({
    mutationFn: deleteTradingBot,
    onSuccess: () => {
      setDetailOpen(false);
      setReturnToDetailBotId(null);
      notify('Бот и его телеметрия удалены.');
      invalidate();
    },
    onError: (err) => notify(toRussianError(err, 'Не удалось удалить бота'), true),
  });

  function notify(message: string, isError = false) {
    if (!isError) return;
    setActionError(message);
  }

  function openCreateBot() {
    setReturnToDetailBotId(null);
    if (strategies.isError) {
      notify(toRussianError(strategies.error, 'Не удалось загрузить стратегии'), true);
      return;
    }
    setEditingBot(null);
    setEditingTokens([]);
    setBotForm(emptyBotForm(templates[0], runtime));
    setTokenSearch('');
    setBotError(null);
    setBotDialogOpen(true);
  }

  function openBotTest() {
    setTestConfig({
      strategyKey: botForm.strategyKey,
      assetId: botForm.tokenAssetIds[0],
      params: { ...botForm.strategyParams },
      useStopLoss: true,
      useTakeProfit: true,
    });
  }

  function openStrategyTest(strategyKey: string) {
    setStrategyDetail(null);
    setTestConfig({ strategyKey });
  }

  async function openEditBot(bot: BotSummary): Promise<boolean> {
    if (bot.status === 'running') {
      if (
        !(await confirm({
          title: 'Остановить робота?',
          description:
            'Чтобы открыть настройки, робота нужно остановить. Открытые позиции и история сохранятся.',
          confirmLabel: 'Остановить и открыть',
          variant: 'primary',
        }))
      ) {
        return false;
      }
      try {
        await stopMutation.mutateAsync(bot.id);
      } catch {
        return false;
      }
    }
    let detail;
    try {
      detail = await fetchTradingBot(bot.id);
    } catch (error) {
      notify(toRussianError(error, 'Не удалось загрузить настройки бота'), true);
      return false;
    }
    setEditingBot(detail.bot);
    setEditingTokens(detail.tokens);
    setBotForm({
      name: detail.bot.name,
      description: detail.bot.description,
      icon: detail.bot.icon,
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
    return true;
  }

  function openBotDetail(id: string) {
    setDetailBotId(id);
    setDetailOpen(true);
  }

  function closeBotDetail() {
    setDetailOpen(false);
    setReturnToDetailBotId(null);
  }

  function closeBotDialog() {
    setBotDialogOpen(false);
    setBotError(null);
    const id = returnToDetailBotId;
    if (id) {
      setReturnToDetailBotId(null);
      window.setTimeout(() => {
        setDetailBotId(id);
        setDetailOpen(true);
      }, 250);
    }
  }

  function openEditBotFromDetail(bot: BotSummary) {
    const id = bot.id;
    setDetailOpen(false);
    setReturnToDetailBotId(id);
    window.setTimeout(() => {
      void openEditBot(bot).then((opened) => {
        if (opened) return;
        setReturnToDetailBotId(null);
        setDetailBotId(id);
        setDetailOpen(true);
      });
    }, 250);
  }

  function changeStrategy(key: string) {
    const template = templates.find((item) => item.key === key);
    setBotForm((current) => ({
      ...current,
      strategyKey: key,
      strategyParams: paramsToForm(template?.defaultParams ?? defaultParams),
    }));
  }

  async function handleBotIconFile(file: File | undefined): Promise<void> {
    if (!file) return;
    setIconUploading(true);
    setBotError(null);
    try {
      const icon = await compressTokenIcon(file);
      setBotForm((current) => ({ ...current, icon }));
    } catch (error) {
      setBotError(error instanceof Error ? error.message : 'Не удалось загрузить иконку');
    } finally {
      setIconUploading(false);
      if (botIconInputRef.current) botIconInputRef.current.value = '';
    }
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
      icon: botForm.icon,
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
    closePositionsMutation.isPending ||
    archiveMutation.isPending;

  return (
    <div className="space-y-6">
      {actionError ? (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          {actionError}
        </div>
      ) : null}

      {mode === 'bots' ? (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
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
            <Button onClick={openCreateBot}>Добавить робота</Button>
          </div>
          {bots.isPending ? (
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
                  className={`cursor-pointer p-3 transition-colors hover:border-emerald-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/40 ${botPnlTone(bot)}`}
                  onClick={() => openBotDetail(bot.id)}
                  onKeyDown={(event) => {
                    if (event.target !== event.currentTarget) return;
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      openBotDetail(bot.id);
                    }
                  }}
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="flex min-w-0 flex-1 items-start gap-3 text-left">
                      <BotIcon
                        icon={bot.icon}
                        strategyIcon={bot.strategy.icon}
                        className="h-10 w-10"
                        alt=""
                      />
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
                          {bot.origin === 'ai' ? (
                            <Badge tone="warning">
                              ИИ{bot.evaluationTimeframe ? ` · ${bot.evaluationTimeframe}` : ''}
                            </Badge>
                          ) : null}
                        </div>
                        <div className="mt-1 text-xs text-zinc-500">
                          {bot.description || 'Без описания'} · бюджет {formatUsd(bot.budgetUsd)}
                          {bot.lastTickAt ? ` · тик ${formatDateTime(bot.lastTickAt)}` : ''}
                          {bot.status === 'running' ? (
                            <>
                              {' · в работе '}
                              <BotUptimeText
                                startedAt={bot.startedAt}
                                running
                                className="font-mono text-zinc-700"
                              />
                            </>
                          ) : null}
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
                        disabled={busy}
                        title={
                          bot.status === 'running'
                            ? 'Остановить робота и изменить настройки'
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
          )}
        </>
      ) : null}

      {mode === 'strategies' ? (
        <>
          {strategies.isPending ? (
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
                Встроенные алгоритмы. Их нельзя изменить — параметры настраиваются в каждом роботе и
                на тестовом стенде. Нажмите на карточку, чтобы прочитать подробное описание и гайд.
              </CardDescription>
              <div className="mt-3 grid gap-3 md:grid-cols-2">
                {templates.map((template) => (
                  <div
                    key={template.key}
                    role="button"
                    tabIndex={0}
                    onClick={() => setStrategyDetail(template)}
                    onKeyDown={(event) => {
                      if (event.target !== event.currentTarget) return;
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        setStrategyDetail(template);
                      }
                    }}
                    className="cursor-pointer rounded-xl border border-zinc-200 p-3 text-left transition-colors hover:border-emerald-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/40"
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
                    <div className="mt-3 flex justify-end">
                      <Button
                        variant="secondary"
                        className="h-8 px-3 text-xs"
                        onClick={(event) => {
                          event.stopPropagation();
                          openStrategyTest(template.key);
                        }}
                      >
                        Тестировать
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          )}
        </>
      ) : null}

      <Drawer
        open={botDialogOpen}
        onClose={closeBotDialog}
        title={editingBot ? 'Настройки робота' : 'Новый робот'}
        description="Бумажный портфель. Реальные свопы не выполняются."
        size="lg"
        footer={
          <>
            <Button variant="secondary" onClick={openBotTest} disabled={!selectedTemplate}>
              Тестировать
            </Button>
            <Button variant="ghost" onClick={closeBotDialog}>
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
              {selectedTemplate?.key === 'static_limit' ? (
                <p className="mt-1 text-[11px] leading-4 text-amber-700">
                  Для «Статичного лимита» нужен ровно один токен. Цены покупки, стопа и тейка
                  задаются в USD.
                </p>
              ) : null}
            </label>
          </div>
          <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-3">
            <div className="flex flex-wrap items-center gap-3">
              <BotIcon
                icon={botForm.icon}
                strategyIcon={selectedTemplate?.icon ?? 'beaker'}
                className="h-12 w-12"
                alt=""
              />
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium text-zinc-800">Иконка робота</div>
                <div className="text-xs text-zinc-500">
                  По умолчанию используется иконка стратегии. Можно загрузить свою.
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  className="h-8 px-3 text-xs"
                  onClick={() => botIconInputRef.current?.click()}
                  disabled={iconUploading}
                >
                  {iconUploading ? 'Загружаю…' : 'Загрузить иконку'}
                </Button>
                {botForm.icon ? (
                  <Button
                    type="button"
                    variant="ghost"
                    className="h-8 px-3 text-xs"
                    onClick={() => setBotForm((current) => ({ ...current, icon: null }))}
                  >
                    Сбросить
                  </Button>
                ) : null}
              </div>
            </div>
            <input
              ref={botIconInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="hidden"
              aria-label="Файл иконки робота"
              onChange={(event) => void handleBotIconFile(event.target.files?.[0])}
            />
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
              {staticProjection ? (
                <div className="mt-3 rounded-lg border border-zinc-200 bg-white px-3 py-2">
                  <div className="text-[10px] font-medium uppercase tracking-wide text-zinc-400">
                    Расчёт одной позиции
                  </div>
                  <div className="mt-1 grid gap-1 text-xs sm:grid-cols-3">
                    <div className="text-zinc-600">
                      В позиции:{' '}
                      <span className="font-medium text-zinc-900">
                        {formatUsd(staticProjection.allocation.toFixed(2))}
                      </span>
                    </div>
                    <div className="text-red-700">
                      Стоп: −{formatUsd(staticProjection.loss.toFixed(2))} (−
                      {staticProjection.lossPct.toFixed(2)}%)
                    </div>
                    <div className="text-emerald-700">
                      Тейк: +{formatUsd(staticProjection.profit.toFixed(2))} (+
                      {staticProjection.profitPct.toFixed(2)}%)
                    </div>
                  </div>
                  <div className="mt-1 text-[11px] text-zinc-400">
                    Без комиссии и проскальзывания. Цена покупки —{' '}
                    {formatPrice(String(Number(botForm.strategyParams.buyPriceUsd)))}.
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}

          <div>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-sm text-zinc-600">
                Токены из группы «{defaultGroup?.name ?? 'Избранное'}»
              </div>
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
              {watchlistGroups.isPending || watchlist.isPending ? (
                <p className="text-xs text-zinc-500">Загрузка токенов…</p>
              ) : watchlistGroups.isError || watchlist.isError ? (
                <p className="text-xs text-red-700">
                  {toRussianError(
                    watchlist.error ?? watchlistGroups.error,
                    'Не удалось загрузить Базу токенов',
                  )}
                </p>
              ) : tokenOptions.length === 0 ? (
                <p className="text-xs text-zinc-500">
                  В группе «{defaultGroup?.name ?? 'Избранное'}» нет активных токенов.
                </p>
              ) : visibleTokenEntries.length === 0 ? (
                <p className="text-xs text-zinc-500">Ничего не найдено.</p>
              ) : (
                visibleTokenEntries.map((entry) => {
                  const checked = botForm.tokenAssetIds.includes(entry.assetId);
                  return (
                    <label
                      key={entry.assetId}
                      className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1 text-sm hover:bg-zinc-50"
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() =>
                          setBotForm((current) => ({
                            ...current,
                            tokenAssetIds: checked
                              ? current.tokenAssetIds.filter((id) => id !== entry.assetId)
                              : [...current.tokenAssetIds, entry.assetId],
                          }))
                        }
                      />
                      <TokenIcon
                        logoUrl={entry.logoUrl}
                        symbol={entry.symbol}
                        className="h-5 w-5 text-[9px]"
                      />
                      <span className="font-medium">{entry.symbol}</span>
                      <span className="truncate text-xs text-zinc-500">{entry.name}</span>
                      <span className="ml-auto shrink-0 text-xs text-zinc-400">
                        {entry.chainCode}
                      </span>
                    </label>
                  );
                })
              )}
            </div>
            <p className="mt-1 text-[11px] leading-4 text-zinc-500">
              Если у токена есть открытая позиция, после удаления из робота она останется до
              закрытия, но новые позиции по нему открываться не будут.
            </p>
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
              Пауза после сделки, мин
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
          <>
            <Button variant="secondary" onClick={() => setStrategyDetail(null)}>
              Готово
            </Button>
            {strategyDetail ? (
              <Button onClick={() => openStrategyTest(strategyDetail.key)}>Тестировать</Button>
            ) : null}
          </>
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
              <CardTitle>Когда лучше использовать</CardTitle>
              <p className="mt-1 text-sm leading-6 text-zinc-700">{strategyDetail.bestFor}</p>
            </Card>
            <Card className="border-amber-200/80 bg-amber-50/50">
              <CardTitle>Риски</CardTitle>
              <p className="mt-1 text-sm leading-6 text-zinc-700">{strategyDetail.risks}</p>
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
                        {formatStrategyParamValue(field, value)}
                      </div>
                    </div>
                  );
                })}
              </div>
            </Card>
            <p className="text-xs leading-5 text-zinc-500">
              Стратегия встроена в приложение и не редактируется. Все числовые параметры задаются
              отдельно для каждого робота и для прогона на тестовом стенде.
            </p>
          </div>
        ) : null}
      </Drawer>

      <Drawer
        open={Boolean(testConfig && testTemplate)}
        onClose={() => setTestConfig(null)}
        title={testTemplate ? `Тестирование · ${testTemplate.name}` : 'Тестирование'}
        description="Параметры и токен взяты из формы робота. Изменения в этом окне не меняют робота."
        size="lg"
        placement="beside"
      >
        {testTemplate && testConfig ? (
          <BacktestPanel
            key={`${testConfig.strategyKey}:${testConfig.assetId ?? 'none'}`}
            template={testTemplate}
            tokenEntries={tokenEntries}
            tokensPending={watchlist.isPending}
            tokensError={watchlist.error}
            initialAssetId={testConfig.assetId}
            initialParams={testConfig.params}
            initialUseStopLoss={testConfig.useStopLoss}
            initialUseTakeProfit={testConfig.useTakeProfit}
            stacked
          />
        ) : null}
      </Drawer>

      <BotDetailDrawer
        botId={detailBotId}
        open={detailOpen}
        onClose={closeBotDetail}
        onEdit={openEditBotFromDetail}
        onStart={(id) => startMutation.mutate(id)}
        onStop={(id) => stopMutation.mutate(id)}
        onClosePositions={async (id) => {
          if (
            await confirm({
              title: 'Закрыть все позиции?',
              description:
                'Позиции будут закрыты по текущим котировкам. Бот остановится, сделки сохранятся.',
              confirmLabel: 'Закрыть позиции',
              variant: 'danger',
            })
          ) {
            closePositionsMutation.mutate(id);
          }
        }}
        onArchive={async (id) => {
          if (
            await confirm({
              title: 'Удалить робота?',
              description:
                'Бот будет удалён вместе с историей сделок, событий и телеметрией. Восстановить его нельзя.',
              confirmLabel: 'Удалить',
              variant: 'danger',
            })
          ) {
            archiveMutation.mutate(id);
          }
        }}
        busy={busy}
      />
    </div>
  );
}

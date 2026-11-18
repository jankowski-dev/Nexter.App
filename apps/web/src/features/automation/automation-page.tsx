import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardDescription, CardTitle } from '@/components/ui/card';
import { Drawer } from '@/components/ui/drawer';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { ErrorState, LoadingRows } from '@/components/ui/states';
import { useConfirm } from '@/lib/confirm';
import {
  createAutomationRule,
  fetchAutomationRules,
  fetchAutomationRuns,
  fetchTradeGroups,
  fetchWatchlist,
  pauseAllAutomation,
  testAutomationRule,
  updateAutomationRule,
} from '@/lib/api';
import { toRussianError } from '@/lib/error-messages';
import { formatDateTime, formatPrice, formatUsd } from '@/lib/format';
import {
  settingsInputDefaults,
  type AutomationRule,
  type AutomationRuleCreateRequest,
  type AutomationRuleKind,
  type AutomationRuleStatus,
  type AutomationTestResponse,
  type Settings,
  type TradeGroupSummary,
  type WatchlistEntry,
} from '@nexter/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useSettings } from '../settings/use-settings';

const kindLabels: Record<AutomationRuleKind, string> = {
  buy: 'Авто-покупка',
  stop_loss: 'Стоп-лосс',
  take_profit: 'Тейк-профит',
  trailing_stop: 'Трейлинг',
};

const statusLabels: Record<AutomationRuleStatus, string> = {
  draft: 'Черновик',
  armed: 'Взведено',
  paused: 'Пауза',
  done: 'Завершено',
};

const statusTones: Record<AutomationRuleStatus, 'neutral' | 'success' | 'warning' | 'info'> = {
  draft: 'neutral',
  armed: 'success',
  paused: 'warning',
  done: 'neutral',
};

interface RuleFormState {
  id: string | null;
  name: string;
  kind: AutomationRuleKind;
  assetId: string;
  tradeGroupId: string;
  executionMode: 'dry_run' | 'proposal';
  maxOrderUsd: string;
  cooldownMinutes: string;
  target: 'price_below' | 'drop_from_high';
  thresholdUsd: string;
  dropPct: string;
  amountUsd: string;
  maxPriceUsd: string;
  stopLossPct: string;
  takeProfitPct: string;
  partialPct: string;
  trailPct: string;
  activationPct: string;
  arm: boolean;
}

function formFromRule(rule: AutomationRule): RuleFormState {
  const params = rule.params as Record<string, unknown>;
  return {
    id: rule.id,
    name: rule.name,
    kind: rule.kind,
    assetId: rule.asset.id,
    tradeGroupId: rule.tradeGroupId ?? '',
    executionMode: rule.executionMode,
    maxOrderUsd: rule.maxOrderUsd ?? '',
    cooldownMinutes: String(rule.cooldownMinutes),
    target: params.target === 'price_below' ? 'price_below' : 'drop_from_high',
    thresholdUsd: typeof params.thresholdUsd === 'string' ? params.thresholdUsd : '',
    dropPct: typeof params.dropPct === 'number' ? String(params.dropPct) : '',
    amountUsd: typeof params.amountUsd === 'string' ? params.amountUsd : '',
    maxPriceUsd: typeof params.maxPriceUsd === 'string' ? params.maxPriceUsd : '',
    stopLossPct: typeof params.stopLossPct === 'number' ? String(params.stopLossPct) : '',
    takeProfitPct: typeof params.takeProfitPct === 'number' ? String(params.takeProfitPct) : '',
    partialPct: typeof params.partialPct === 'number' ? String(params.partialPct) : '',
    trailPct: typeof params.trailPct === 'number' ? String(params.trailPct) : '',
    activationPct: typeof params.activationPct === 'number' ? String(params.activationPct) : '',
    arm: rule.status === 'armed',
  };
}

function newForm(settings: Settings | undefined): RuleFormState {
  const defaults = settings ?? settingsInputDefaults;
  return {
    id: null,
    name: '',
    kind: 'buy',
    assetId: '',
    tradeGroupId: '',
    executionMode: defaults.automationMode,
    maxOrderUsd: defaults.automationMaxOrderUsd,
    cooldownMinutes: String(defaults.automationCooldownMinutes),
    target: 'drop_from_high',
    thresholdUsd: '',
    dropPct: String(defaults.automationDefaultBuyDropPct),
    amountUsd: defaults.automationDefaultBuyAmountUsd,
    maxPriceUsd: '',
    stopLossPct: String(defaults.automationDefaultStopLossPct),
    takeProfitPct: String(defaults.automationDefaultTakeProfitPct),
    partialPct: '',
    trailPct: String(defaults.automationDefaultTrailingPct),
    activationPct: '10',
    arm: false,
  };
}

function conditionLabel(rule: AutomationRule): string {
  const params = rule.params as Record<string, unknown>;
  if (rule.kind === 'buy') {
    if (params.target === 'price_below' && typeof params.thresholdUsd === 'string') {
      return `Цена ≤ ${formatPrice(params.thresholdUsd)}`;
    }
    if (typeof params.dropPct === 'number') {
      return `Падение ≥ ${params.dropPct}% от максимума`;
    }
    return 'Условие покупки';
  }
  if (rule.kind === 'stop_loss') return `Стоп-лосс ${params.stopLossPct ?? '—'}%`;
  if (rule.kind === 'take_profit') {
    return `Тейк-профит ${params.takeProfitPct ?? '—'}%${
      typeof params.partialPct === 'number' ? ` · ${params.partialPct}% позиции` : ''
    }`;
  }
  return `Трейлинг ${params.trailPct ?? '—'}%${
    typeof params.activationPct === 'number' ? ` · активация +${params.activationPct}%` : ''
  }`;
}

function runStatusTone(status: string): 'neutral' | 'success' | 'warning' | 'info' | 'danger' {
  if (status === 'proposed') return 'info';
  if (status === 'would_execute') return 'success';
  if (status === 'failed') return 'danger';
  return 'neutral';
}

function runStatusLabel(status: string): string {
  if (status === 'proposed') return 'Предложение';
  if (status === 'would_execute') return 'Сработало бы';
  if (status === 'failed') return 'Ошибка';
  return 'Пропущено';
}

export function AutomationPage() {
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const settings = useSettings();
  const rules = useQuery({
    queryKey: ['automation-rules'],
    queryFn: fetchAutomationRules,
    refetchInterval: 30_000,
  });
  const runs = useQuery({
    queryKey: ['automation-runs'],
    queryFn: () => fetchAutomationRuns(30),
    refetchInterval: 30_000,
  });
  const watchlist = useQuery({
    queryKey: ['automation-watchlist'],
    queryFn: () => fetchWatchlist(false, undefined, undefined, 100),
  });
  const groups = useQuery({
    queryKey: ['automation-groups'],
    queryFn: () => fetchTradeGroups({ view: 'active', limit: 100 }),
  });
  const [form, setForm] = useState<RuleFormState | null>(null);
  const [testResult, setTestResult] = useState<{
    rule: AutomationRule;
    result: AutomationTestResponse;
  } | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['automation-rules'] });
    void queryClient.invalidateQueries({ queryKey: ['automation-runs'] });
  };

  const createMutation = useMutation({
    mutationFn: createAutomationRule,
    onSuccess: () => invalidate(),
  });
  const updateMutation = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Parameters<typeof updateAutomationRule>[1] }) =>
      updateAutomationRule(id, body),
    onSuccess: () => invalidate(),
  });
  const testMutation = useMutation({
    mutationFn: testAutomationRule,
    onSuccess: (result, id) => {
      const rule = rules.data?.rules.find((item) => item.id === id);
      if (rule) setTestResult({ rule, result });
      else setTestResult(null);
    },
  });
  const pauseAllMutation = useMutation({
    mutationFn: pauseAllAutomation,
    onSuccess: () => invalidate(),
  });

  if (rules.isPending || runs.isPending || settings.isPending) {
    return <LoadingRows rows={8} />;
  }
  if (rules.isError || runs.isError || settings.isError) {
    return (
      <ErrorState
        message={toRussianError(
          rules.error ?? runs.error ?? settings.error,
          'Не удалось загрузить автоматизацию',
        )}
        onRetry={() => {
          void rules.refetch();
          void runs.refetch();
          void settings.refetch();
        }}
      />
    );
  }

  const settingsData = settings.data;
  const rulesData = rules.data;
  const runsData = runs.data;
  if (!settingsData || !rulesData || !runsData) return <LoadingRows rows={8} />;

  const watchlistEntries: WatchlistEntry[] = watchlist.data?.data ?? [];
  const activeGroups: TradeGroupSummary[] = groups.data?.data ?? [];
  const enabled = settingsData.automationEnabled;

  async function saveRule(): Promise<void> {
    if (!form) return;
    setFormError(null);
    try {
      if (form.id) {
        const params = buildParams(form);
        await updateMutation.mutateAsync({
          id: form.id,
          body: {
            name: form.name,
            executionMode: form.executionMode,
            params,
            maxOrderUsd: form.kind === 'buy' ? form.maxOrderUsd || null : null,
            cooldownMinutes: Number(form.cooldownMinutes),
            status: form.arm ? 'armed' : undefined,
          },
        });
      } else {
        const payload = buildCreatePayload(form);
        const created = await createMutation.mutateAsync(payload);
        if (form.arm) {
          await updateMutation.mutateAsync({ id: created.id, body: { status: 'armed' } });
        }
      }
      setForm(null);
    } catch (error) {
      setFormError(toRussianError(error, 'Не удалось сохранить правило'));
    }
  }

  async function toggleRule(rule: AutomationRule): Promise<void> {
    await updateMutation.mutateAsync({
      id: rule.id,
      body: { status: rule.status === 'armed' ? 'paused' : 'armed' },
    });
  }

  async function finishRule(rule: AutomationRule): Promise<void> {
    if (
      await confirm({
        title: 'Завершить правило?',
        description: `Правило «${rule.name}» больше не будет срабатывать. История сохранится.`,
        confirmLabel: 'Завершить',
        variant: 'danger',
      })
    ) {
      await updateMutation.mutateAsync({ id: rule.id, body: { status: 'done' } });
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={enabled ? 'success' : 'neutral'}>
            {enabled ? 'Автоматизация включена' : 'Автоматизация выключена'}
          </Badge>
          <span className="text-xs text-zinc-500">
            {settingsData.automationMode === 'proposal'
              ? 'Режим предложений: действие подтверждает владелец.'
              : 'Dry-run: только сигналы и уведомления.'}
          </span>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="secondary"
            disabled={pauseAllMutation.isPending}
            onClick={async () => {
              if (
                await confirm({
                  title: 'Остановить всю автоматизацию?',
                  description: 'Все взведённые правила перейдут в паузу.',
                  confirmLabel: 'Остановить',
                  variant: 'danger',
                })
              ) {
                pauseAllMutation.mutate();
              }
            }}
          >
            Остановить всё
          </Button>
          <Button onClick={() => setForm(newForm(settingsData))}>Новое правило</Button>
        </div>
      </div>

      {testResult ? (
        <Card className="tone-surface tone-surface-sky">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <div className="text-sm font-medium text-sky-900">
                Тест: {testResult.rule.name} · {runStatusLabel(testResult.result.status)}
              </div>
              <div className="mt-1 text-xs text-sky-900/80">{testResult.result.reason}</div>
              {testResult.result.triggerPriceUsd ? (
                <div className="mt-1 text-xs text-sky-900/70">
                  Цена {formatPrice(testResult.result.triggerPriceUsd)}
                  {testResult.result.usdValue
                    ? ` · сумма ${formatUsd(testResult.result.usdValue)}`
                    : ''}
                </div>
              ) : null}
            </div>
            <Button
              variant="ghost"
              className="h-8 px-2 text-xs"
              onClick={() => setTestResult(null)}
            >
              Скрыть
            </Button>
          </div>
        </Card>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-[1.35fr_0.65fr]">
        <Card>
          <CardTitle>Правила</CardTitle>
          <CardDescription>
            Правила оцениваются раз в минуту. Стоп-лосс и тейк-профит считаются от средней цены
            открытой сделки.
          </CardDescription>
          <div className="mt-4 space-y-2">
            {rulesData.rules.length === 0 ? (
              <p className="text-sm text-zinc-500">Правил пока нет.</p>
            ) : (
              rulesData.rules.map((rule) => (
                <div
                  key={rule.id}
                  className={`rounded-xl border border-zinc-200 p-3 ${
                    rule.status === 'done' ? 'opacity-60' : ''
                  }`}
                >
                  <div className="flex flex-wrap items-center gap-3">
                    <div className="min-w-[180px] flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-semibold text-zinc-900">{rule.name}</span>
                        <Badge tone="info">{kindLabels[rule.kind]}</Badge>
                        <Badge tone={statusTones[rule.status]}>{statusLabels[rule.status]}</Badge>
                        <Badge tone="neutral">
                          {rule.executionMode === 'proposal' ? 'предложение' : 'dry-run'}
                        </Badge>
                      </div>
                      <div className="mt-0.5 text-[11px] text-zinc-500">
                        {rule.asset.symbol} · {conditionLabel(rule)}
                        {rule.tradeGroupId ? ' · привязано к сделке' : ''}
                      </div>
                    </div>
                    <div className="text-right text-[11px] text-zinc-500">
                      <div>Срабатываний: {rule.triggerCount}</div>
                      <div>
                        {rule.lastTriggeredAt
                          ? formatDateTime(rule.lastTriggeredAt)
                          : 'ещё не срабатывало'}
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {rule.status !== 'done' ? (
                        <Button
                          variant="secondary"
                          className="h-8 px-2.5 text-xs"
                          onClick={() => void toggleRule(rule)}
                          disabled={updateMutation.isPending}
                        >
                          {rule.status === 'armed' ? 'Пауза' : 'Взвести'}
                        </Button>
                      ) : null}
                      <Button
                        variant="ghost"
                        className="h-8 px-2.5 text-xs"
                        onClick={() => testMutation.mutate(rule.id)}
                        disabled={testMutation.isPending}
                      >
                        Тест
                      </Button>
                      {rule.status !== 'done' ? (
                        <>
                          <Button
                            variant="ghost"
                            className="h-8 px-2.5 text-xs"
                            onClick={() => setForm(formFromRule(rule))}
                          >
                            Изменить
                          </Button>
                          <Button
                            variant="ghost"
                            className="h-8 px-2.5 text-xs text-red-700 hover:text-red-800"
                            onClick={() => void finishRule(rule)}
                          >
                            Завершить
                          </Button>
                        </>
                      ) : null}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </Card>

        <Card>
          <CardTitle>Журнал</CardTitle>
          <CardDescription>Последние срабатывания и предложения.</CardDescription>
          <div className="mt-4 space-y-2">
            {runsData.runs.length === 0 ? (
              <p className="text-sm text-zinc-500">Срабатываний пока нет.</p>
            ) : (
              runsData.runs.map((run) => (
                <div key={run.id} className="rounded-lg border border-zinc-200 p-2 text-[11px]">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate font-medium text-zinc-800">{run.ruleName}</span>
                    <Badge tone={runStatusTone(run.status)}>{runStatusLabel(run.status)}</Badge>
                  </div>
                  <div className="mt-1 text-zinc-600">{run.reason}</div>
                  <div className="mt-0.5 flex flex-wrap justify-between gap-2 text-zinc-400">
                    <span>{formatDateTime(run.createdAt)}</span>
                    <span>
                      {run.triggerPriceUsd ? formatPrice(run.triggerPriceUsd) : '—'}
                      {run.usdValue ? ` · ${formatUsd(run.usdValue)}` : ''}
                    </span>
                  </div>
                </div>
              ))
            )}
          </div>
        </Card>
      </div>

      <Drawer
        open={Boolean(form)}
        onClose={() => setForm(null)}
        title={form?.id ? 'Изменить правило' : 'Новое правило'}
        description="Dry-run или предложение. Сервер не подписывает транзакции."
        size="third"
        footer={
          <div className="flex w-full flex-wrap items-center justify-between gap-2">
            <span className="text-xs text-red-700">{formError}</span>
            <div className="flex gap-2">
              <Button variant="secondary" onClick={() => setForm(null)}>
                Отмена
              </Button>
              <Button
                onClick={() => void saveRule()}
                disabled={createMutation.isPending || updateMutation.isPending}
              >
                Сохранить
              </Button>
            </div>
          </div>
        }
      >
        {form ? (
          <div className="space-y-4">
            <label className="block text-sm text-zinc-600">
              Название
              <Input
                className="mt-1"
                value={form.name}
                onChange={(event) => setForm({ ...form, name: event.target.value })}
                placeholder="Стоп-лосс BASED"
              />
            </label>

            <label className="block text-sm text-zinc-600">
              Тип правила
              <Select
                className="mt-1"
                value={form.kind}
                disabled={Boolean(form.id)}
                onChange={(event) =>
                  setForm({ ...form, kind: event.target.value as AutomationRuleKind })
                }
              >
                {(Object.keys(kindLabels) as AutomationRuleKind[]).map((kind) => (
                  <option key={kind} value={kind}>
                    {kindLabels[kind]}
                  </option>
                ))}
              </Select>
            </label>

            {form.kind === 'buy' ? (
              <label className="block text-sm text-zinc-600">
                Токен
                <Select
                  className="mt-1"
                  value={form.assetId}
                  disabled={Boolean(form.id)}
                  onChange={(event) => setForm({ ...form, assetId: event.target.value })}
                >
                  <option value="">Выберите токен</option>
                  {watchlistEntries.map((entry) => (
                    <option key={entry.id} value={entry.asset.id}>
                      {entry.asset.symbol} · {entry.asset.name}
                    </option>
                  ))}
                </Select>
              </label>
            ) : (
              <label className="block text-sm text-zinc-600">
                Сделка
                <Select
                  className="mt-1"
                  value={form.tradeGroupId}
                  disabled={Boolean(form.id)}
                  onChange={(event) => {
                    const group = activeGroups.find((item) => item.id === event.target.value);
                    setForm({
                      ...form,
                      tradeGroupId: event.target.value,
                      assetId: group?.asset.id ?? form.assetId,
                    });
                  }}
                >
                  <option value="">Выберите сделку</option>
                  {activeGroups.map((group) => (
                    <option key={group.id} value={group.id}>
                      {group.asset.symbol} · остаток {group.remainingAmount}
                    </option>
                  ))}
                </Select>
              </label>
            )}

            {form.kind === 'buy' ? (
              <>
                <label className="block text-sm text-zinc-600">
                  Условие
                  <Select
                    className="mt-1"
                    value={form.target}
                    onChange={(event) =>
                      setForm({
                        ...form,
                        target: event.target.value as 'price_below' | 'drop_from_high',
                      })
                    }
                  >
                    <option value="drop_from_high">Падение от максимума</option>
                    <option value="price_below">Цена ниже порога</option>
                  </Select>
                </label>
                {form.target === 'price_below' ? (
                  <label className="block text-sm text-zinc-600">
                    Порог цены, USD
                    <Input
                      className="mt-1"
                      value={form.thresholdUsd}
                      onChange={(event) => setForm({ ...form, thresholdUsd: event.target.value })}
                    />
                  </label>
                ) : (
                  <label className="block text-sm text-zinc-600">
                    Падение, %
                    <Input
                      className="mt-1"
                      type="number"
                      value={form.dropPct}
                      onChange={(event) => setForm({ ...form, dropPct: event.target.value })}
                    />
                  </label>
                )}
                <label className="block text-sm text-zinc-600">
                  Сумма покупки, USD
                  <Input
                    className="mt-1"
                    value={form.amountUsd}
                    onChange={(event) => setForm({ ...form, amountUsd: event.target.value })}
                  />
                </label>
                <label className="block text-sm text-zinc-600">
                  Максимальная цена, USD (необязательно)
                  <Input
                    className="mt-1"
                    value={form.maxPriceUsd}
                    onChange={(event) => setForm({ ...form, maxPriceUsd: event.target.value })}
                  />
                </label>
              </>
            ) : null}

            {form.kind === 'stop_loss' ? (
              <label className="block text-sm text-zinc-600">
                Стоп-лосс, %
                <Input
                  className="mt-1"
                  type="number"
                  value={form.stopLossPct}
                  onChange={(event) => setForm({ ...form, stopLossPct: event.target.value })}
                />
              </label>
            ) : null}

            {form.kind === 'take_profit' ? (
              <>
                <label className="block text-sm text-zinc-600">
                  Тейк-профит, %
                  <Input
                    className="mt-1"
                    type="number"
                    value={form.takeProfitPct}
                    onChange={(event) => setForm({ ...form, takeProfitPct: event.target.value })}
                  />
                </label>
                <label className="block text-sm text-zinc-600">
                  Закрыть, % позиции (пусто = 100%)
                  <Input
                    className="mt-1"
                    type="number"
                    value={form.partialPct}
                    onChange={(event) => setForm({ ...form, partialPct: event.target.value })}
                  />
                </label>
              </>
            ) : null}

            {form.kind === 'trailing_stop' ? (
              <>
                <label className="block text-sm text-zinc-600">
                  Откат от максимума, %
                  <Input
                    className="mt-1"
                    type="number"
                    value={form.trailPct}
                    onChange={(event) => setForm({ ...form, trailPct: event.target.value })}
                  />
                </label>
                <label className="block text-sm text-zinc-600">
                  Активация после роста, % (необязательно)
                  <Input
                    className="mt-1"
                    type="number"
                    value={form.activationPct}
                    onChange={(event) => setForm({ ...form, activationPct: event.target.value })}
                  />
                </label>
              </>
            ) : null}

            <label className="block text-sm text-zinc-600">
              Режим
              <Select
                className="mt-1"
                value={form.executionMode}
                onChange={(event) =>
                  setForm({
                    ...form,
                    executionMode: event.target.value as 'dry_run' | 'proposal',
                  })
                }
              >
                <option value="dry_run">Dry-run: только сигнал</option>
                <option value="proposal">Предложение: уведомление + карточка</option>
              </Select>
            </label>

            {form.kind === 'buy' ? (
              <label className="block text-sm text-zinc-600">
                Максимум на покупку, USD
                <Input
                  className="mt-1"
                  value={form.maxOrderUsd}
                  onChange={(event) => setForm({ ...form, maxOrderUsd: event.target.value })}
                />
              </label>
            ) : null}

            <label className="block text-sm text-zinc-600">
              Пауза между срабатываниями, мин
              <Input
                className="mt-1"
                type="number"
                value={form.cooldownMinutes}
                onChange={(event) => setForm({ ...form, cooldownMinutes: event.target.value })}
              />
            </label>

            <label className="flex items-center gap-2 text-sm text-zinc-700">
              <input
                type="checkbox"
                checked={form.arm}
                onChange={(event) => setForm({ ...form, arm: event.target.checked })}
              />
              Сразу взвести после сохранения
            </label>
          </div>
        ) : null}
      </Drawer>
    </div>
  );
}

function buildParams(form: RuleFormState): Record<string, unknown> {
  if (form.kind === 'buy') {
    return {
      target: form.target,
      ...(form.target === 'price_below' ? { thresholdUsd: form.thresholdUsd } : {}),
      ...(form.target === 'drop_from_high' ? { dropPct: Number(form.dropPct) } : {}),
      amountUsd: form.amountUsd,
      ...(form.maxPriceUsd ? { maxPriceUsd: form.maxPriceUsd } : {}),
    };
  }
  if (form.kind === 'stop_loss') {
    return { stopLossPct: Number(form.stopLossPct) };
  }
  if (form.kind === 'take_profit') {
    return {
      takeProfitPct: Number(form.takeProfitPct),
      ...(form.partialPct ? { partialPct: Number(form.partialPct) } : {}),
    };
  }
  return {
    trailPct: Number(form.trailPct),
    ...(form.activationPct ? { activationPct: Number(form.activationPct) } : {}),
  };
}

function buildCreatePayload(form: RuleFormState): AutomationRuleCreateRequest {
  const base = {
    name: form.name,
    executionMode: form.executionMode,
    maxOrderUsd: form.kind === 'buy' ? form.maxOrderUsd || null : null,
    cooldownMinutes: Number(form.cooldownMinutes),
  };
  const params = buildParams(form);
  if (form.kind === 'buy') {
    return {
      ...base,
      kind: 'buy',
      assetId: form.assetId,
      tradeGroupId: null,
      params: params as never,
    };
  }
  return {
    ...base,
    kind: form.kind as 'stop_loss' | 'take_profit' | 'trailing_stop',
    assetId: form.assetId,
    tradeGroupId: form.tradeGroupId,
    params: params as never,
  };
}

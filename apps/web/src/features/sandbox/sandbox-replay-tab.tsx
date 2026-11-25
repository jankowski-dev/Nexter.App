import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardTitle } from '@/components/ui/card';
import { Drawer } from '@/components/ui/drawer';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { useConfirm } from '@/lib/confirm';
import { toRussianError } from '@/lib/error-messages';
import { useAutoDismissNotice } from '@/lib/use-auto-dismiss-notice';
import {
  useArchiveSandboxReplay,
  useCancelSandboxReplay,
  useCreateSandboxReplay,
  useSandboxReplayPreflight,
  useSandboxReplays,
  useSandboxTokens,
} from './sandbox-hooks';
import {
  sandboxReplayCreatePayload,
  sandboxReplayFormDefaults,
  sandboxReplayPreflightPayload,
  sandboxReplayToggleToken,
  validateSandboxReplayForm,
  type SandboxReplayFormValues,
} from './sandbox-replay-form';
import {
  SANDBOX_REPLAY_PERIODS,
  sandboxReplayActionError,
  sandboxReplayCreateError,
  sandboxReplayPartialConfirm,
  sandboxReplayPeriodLabel,
  sandboxReplayPreflightSummary,
  type SandboxReplayStatusFilter,
} from './sandbox-replay-helpers';
import { SandboxReplayDetail } from './sandbox-replay-detail';
import { SandboxReplayList } from './sandbox-replay-list';
import { SandboxTokensDrawer } from './sandbox-tokens-drawer';
import {
  resetSandboxRunSettings,
  sandboxSettingFields,
  type SandboxSettingKey,
} from './sandbox-run-form';
import { useMemo, useState } from 'react';
import type {
  SandboxReplayDetail as SandboxReplayDetailData,
  SandboxReplayPeriod,
  SandboxReplaySummary,
  SandboxToken,
} from '@nexter/contracts';

const chainLabels: Record<SandboxToken['chain'], string> = {
  bsc: 'BSC',
  ethereum: 'Ethereum',
  binance: 'Binance',
};

function SettingField({
  label,
  hint,
  suffix,
  value,
  onChange,
  integer,
  min,
  max,
  step,
}: {
  label: string;
  hint: string;
  suffix?: string;
  value: string;
  onChange: (value: string) => void;
  integer?: boolean;
  min: number;
  max: number;
  step?: number;
}) {
  return (
    <label className="block text-sm text-zinc-600">
      {label}
      <div className="mt-1 flex items-center gap-2">
        <Input
          type="number"
          inputMode={integer ? 'numeric' : 'decimal'}
          value={value}
          min={min}
          max={max}
          step={step ?? (integer ? 1 : 'any')}
          onChange={(event) => onChange(event.target.value)}
        />
        {suffix ? <span className="shrink-0 text-xs text-zinc-500">{suffix}</span> : null}
      </div>
      <span className="mt-1 block text-[11px] text-zinc-500">{hint}</span>
    </label>
  );
}

/**
 * `Прогон`: a bounded historical paper replay over the owner's stored 1h
 * candles. It is independent of `Запуски` and never mutates a live run.
 */
export function SandboxReplayTab() {
  const confirm = useConfirm();
  const tokens = useSandboxTokens(true);
  const [values, setValues] = useState<SandboxReplayFormValues>(sandboxReplayFormDefaults);
  const [errors, setErrors] = useState<string[]>([]);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [statusFilter, setStatusFilter] = useState<SandboxReplayStatusFilter>('all');
  const [includeArchived, setIncludeArchived] = useState(false);
  const [tokensOpen, setTokensOpen] = useState(false);
  const [selectedReplayId, setSelectedReplayId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useAutoDismissNotice(notice, () => setNotice(null), 8000);

  const preflightPayload = sandboxReplayPreflightPayload(values, true);
  const preflight = useSandboxReplayPreflight(preflightPayload);
  const replays = useSandboxReplays({
    status: statusFilter === 'all' ? undefined : statusFilter,
    includeArchived,
    limit: 50,
    offset: 0,
  });
  const createReplay = useCreateSandboxReplay();
  const cancelReplay = useCancelSandboxReplay();
  const archiveReplay = useArchiveSandboxReplay();

  const tokenList = tokens.data?.tokens ?? [];
  const symbolByKey = useMemo(
    () => new Map(tokenList.map((token) => [token.tokenKey, token.symbol])),
    [tokenList],
  );
  const summary = sandboxReplayPreflightSummary({
    tokenKeys: values.tokenKeys,
    preflight: preflight.data,
    pending: preflight.isPending,
    failed: preflight.isError,
  });
  const createDisabled =
    createReplay.isPending ||
    preflightPayload === null ||
    preflight.isPending ||
    preflight.isError ||
    summary.blocked;
  const busyId = cancelReplay.isPending
    ? (cancelReplay.variables ?? null)
    : archiveReplay.isPending
      ? (archiveReplay.variables ?? null)
      : null;

  function update<K extends keyof SandboxReplayFormValues>(
    key: K,
    value: SandboxReplayFormValues[K],
  ): void {
    setValues((current) => ({ ...current, [key]: value }));
  }

  function toggleToken(tokenKey: string): void {
    const token = tokenList.find((item) => item.tokenKey === tokenKey);
    const selected = values.tokenKeys.includes(tokenKey);
    if (token && !token.enabled && !selected) return;
    setValues((current) => ({
      ...current,
      tokenKeys: sandboxReplayToggleToken(current.tokenKeys, tokenKey),
    }));
  }

  async function submit(): Promise<void> {
    const validationErrors = validateSandboxReplayForm(values);
    setErrors(validationErrors);
    setSubmitError(null);
    setNotice(null);
    if (validationErrors.length > 0 || summary.blocked || preflightPayload === null) return;

    let allowPartial = false;
    if (summary.requiresConfirmation) {
      const accepted = await confirm({
        ...sandboxReplayPartialConfirm(preflight.data),
        cancelLabel: 'Отмена',
      });
      if (!accepted) return;
      allowPartial = true;
    }

    try {
      const created = await createReplay.mutateAsync(
        sandboxReplayCreatePayload(values, { allowPartial }),
      );
      setNotice('Прогон поставлен в очередь. Отчёт появится после завершения.');
      setSelectedReplayId(created.id);
    } catch (error) {
      setSubmitError(sandboxReplayCreateError(error));
    }
  }

  async function cancel(replay: SandboxReplaySummary | SandboxReplayDetailData): Promise<void> {
    const accepted = await confirm({
      title: 'Отменить прогон?',
      description: `«${replay.name}» ещё в очереди. Отмена освободит место для нового прогона, отчёт создан не будет.`,
      confirmLabel: 'Отменить прогон',
      cancelLabel: 'Оставить',
      variant: 'danger',
    });
    if (!accepted) return;

    setNotice(null);
    try {
      await cancelReplay.mutateAsync(replay.id);
      setNotice('Прогон отменён.');
    } catch (error) {
      setNotice(sandboxReplayActionError(error));
    }
  }

  async function archive(replay: SandboxReplaySummary | SandboxReplayDetailData): Promise<void> {
    const accepted = await confirm({
      title: 'Отправить прогон в архив?',
      description:
        'Прогон скроется из истории. Отчёт, снимок свечей и идентичность сохранятся и останутся доступными.',
      confirmLabel: 'В архив',
      cancelLabel: 'Отмена',
      variant: 'danger',
    });
    if (!accepted) return;

    setNotice(null);
    try {
      await archiveReplay.mutateAsync(replay.id);
      setNotice('Прогон отправлен в архив.');
      if (selectedReplayId === replay.id) setSelectedReplayId(null);
    } catch (error) {
      setNotice(sandboxReplayActionError(error));
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-zinc-900">Исторический прогон</h2>
        <p className="mt-1 text-xs text-zinc-500">
          Ограниченный paper-прогон на сохранённых свечах 1h. Виртуальные деньги, без кошелька,
          подписи и реальных ордеров.
        </p>
      </div>

      <Card>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <CardTitle className="text-base font-semibold text-zinc-900">Новый прогон</CardTitle>
              <Badge tone="info">historical-paper</Badge>
            </div>
            <p className="mt-1 text-xs text-zinc-500">
              Решение на закрытом баре i исполняется на открытии i+1. Отчёт и снимок свечей
              сохраняются для повторной проверки.
            </p>
          </div>
          <Button variant="secondary" onClick={() => setTokensOpen(true)}>
            Токены песочницы
          </Button>
        </div>

        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <label className="block text-sm text-zinc-600">
            Название
            <Input
              className="mt-1"
              value={values.name}
              maxLength={80}
              placeholder="Например, BTC и ETH за 90 дней"
              onChange={(event) => update('name', event.target.value)}
            />
            <span className="mt-1 block text-[11px] text-zinc-500">До 80 символов.</span>
          </label>

          <label className="block text-sm text-zinc-600">
            Начальный капитал
            <div className="mt-1 flex items-center gap-2">
              <Input
                type="number"
                inputMode="decimal"
                min={0}
                step="0.01"
                value={values.initialCapitalUsd}
                onChange={(event) => update('initialCapitalUsd', event.target.value)}
              />
              <span className="shrink-0 text-xs text-zinc-500">USD</span>
            </div>
            <span className="mt-1 block text-[11px] text-zinc-500">
              Виртуальный капитал, по умолчанию $1 000.
            </span>
          </label>

          <label className="block text-sm text-zinc-600">
            Период прогона
            <Select
              className="mt-1"
              aria-label="Период прогона"
              value={String(values.periodDays)}
              onChange={(event) =>
                update('periodDays', Number(event.target.value) as SandboxReplayPeriod)
              }
            >
              {SANDBOX_REPLAY_PERIODS.map((period) => (
                <option key={period} value={period}>
                  {sandboxReplayPeriodLabel(period)}
                </option>
              ))}
            </Select>
            <span className="mt-1 block text-[11px] text-zinc-500">
              Окно оценки; свечи до него используются только как прогрев.
            </span>
          </label>
        </div>

        <div className="mt-5">
          <div className="mb-2 flex items-center justify-between gap-3">
            <h3 className="text-sm font-medium text-zinc-700">Токены прогона</h3>
            <span className="text-xs text-zinc-500">Выбрано: {values.tokenKeys.length} из 3</span>
          </div>
          {tokens.isPending ? (
            <div
              className="h-16 animate-pulse rounded-xl bg-zinc-100"
              aria-label="Загрузка токенов"
            />
          ) : tokens.isError ? (
            <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {toRussianError(tokens.error, 'Не удалось загрузить токены песочницы')}
            </div>
          ) : tokenList.length === 0 ? (
            <div className="rounded-xl border border-dashed border-zinc-300 bg-zinc-50 px-4 py-3 text-sm text-zinc-600">
              <p>В песочнице пока нет токенов.</p>
              <Button className="mt-2" variant="secondary" onClick={() => setTokensOpen(true)}>
                Добавить токены
              </Button>
            </div>
          ) : (
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {tokenList.map((token) => {
                const checked = values.tokenKeys.includes(token.tokenKey);
                const atLimit = values.tokenKeys.length >= 3 && !checked;
                return (
                  <label
                    key={token.id}
                    className={`flex cursor-pointer items-start gap-2 rounded-xl border px-3 py-2 text-sm ${
                      checked
                        ? 'border-emerald-300 bg-emerald-50 text-emerald-900'
                        : 'border-zinc-200 bg-white text-zinc-700'
                    } ${!token.enabled || atLimit ? 'opacity-60' : ''}`}
                  >
                    <input
                      type="checkbox"
                      className="mt-0.5 h-4 w-4 accent-emerald-600"
                      checked={checked}
                      disabled={(!token.enabled && !checked) || atLimit}
                      onChange={() => toggleToken(token.tokenKey)}
                    />
                    <span className="min-w-0">
                      <span className="block truncate font-medium">{token.symbol}</span>
                      <span className="block truncate text-[11px] text-zinc-500">
                        {chainLabels[token.chain]} · {token.name}
                      </span>
                      {!token.enabled ? (
                        <span className="text-[11px] text-amber-700">Отключён</span>
                      ) : null}
                    </span>
                  </label>
                );
              })}
            </div>
          )}
        </div>

        <div
          className={`mt-5 rounded-xl border px-4 py-3 text-sm ${
            summary.blocked
              ? 'border-red-200 bg-red-50 text-red-700'
              : summary.requiresConfirmation
                ? 'border-amber-200 bg-amber-50 text-amber-800'
                : 'border-emerald-200 bg-emerald-50 text-emerald-800'
          }`}
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="font-medium">{summary.label}</div>
            <Button variant="ghost" onClick={() => setTokensOpen(true)}>
              Обновить данные
            </Button>
          </div>

          {preflight.isPending && values.tokenKeys.length > 0 ? (
            <div className="mt-1 text-xs">Проверяю историю 1h…</div>
          ) : null}
          {preflight.isError ? (
            <div className="mt-1">
              <Button variant="secondary" onClick={() => void preflight.refetch()}>
                Повторить проверку
              </Button>
            </div>
          ) : null}
          {summary.evaluationBars !== null ? (
            <div className="mt-1 text-xs">
              Окно оценки: {summary.evaluationBars} часовых свечей
              {summary.status === 'partial' ? ' · сокращённое окно' : ''}
            </div>
          ) : null}
          {summary.warnings.length > 0 ? (
            <ul className="mt-1 list-disc space-y-1 pl-4 text-xs">
              {summary.warnings.slice(0, 6).map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          ) : null}

          {preflight.data && preflight.data.coverage.length > 0 ? (
            <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {preflight.data.coverage.map((entry) => (
                <div
                  key={entry.tokenKey}
                  className="rounded-lg border border-white/60 bg-white/70 px-3 py-2 text-xs text-zinc-700"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-medium text-zinc-900">
                      {symbolByKey.get(entry.tokenKey) ?? entry.tokenKey}
                    </span>
                    <span className="text-zinc-500">
                      {entry.available} / {entry.required}
                    </span>
                  </div>
                  <div className="mt-1 grid grid-cols-2 gap-x-2 gap-y-0.5 text-[11px] text-zinc-500">
                    <span>Пропуски: {entry.gaps}</span>
                    <span>Прогрев: {entry.prefixBars}</span>
                  </div>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {entry.stale ? <Badge tone="warning">stale</Badge> : null}
                    {entry.synthetic ? <Badge tone="warning">synthetic</Badge> : null}
                    {!entry.stale && !entry.synthetic ? <Badge tone="success">1h</Badge> : null}
                  </div>
                </div>
              ))}
            </div>
          ) : null}
        </div>

        <div className="mt-4 rounded-xl border border-zinc-200 p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-medium text-zinc-700">Дополнительные настройки</h3>
              <p className="mt-1 text-[11px] text-zinc-500">
                Лимиты риска, комиссия и слиппедж. Значения замораживаются при постановке в очередь.
              </p>
            </div>
            <Button variant="ghost" onClick={() => setAdvancedOpen((open) => !open)}>
              {advancedOpen ? 'Скрыть' : 'Показать'}
            </Button>
          </div>
          {advancedOpen ? (
            <>
              <div className="mt-3 flex justify-end">
                <Button
                  variant="ghost"
                  onClick={() =>
                    setValues((current) => ({
                      ...resetSandboxRunSettings(current),
                      periodDays: current.periodDays,
                    }))
                  }
                >
                  Сбросить настройки
                </Button>
              </div>
              <div className="mt-2 grid gap-3 sm:grid-cols-2">
                {sandboxSettingFields.map((field) => (
                  <SettingField
                    key={field.key}
                    label={field.label}
                    hint={field.hint}
                    suffix={field.suffix}
                    value={values[field.key as SandboxSettingKey]}
                    integer={field.integer}
                    min={field.min}
                    max={field.max}
                    step={field.step}
                    onChange={(value) => update(field.key as SandboxSettingKey, value)}
                  />
                ))}
              </div>
            </>
          ) : null}
        </div>

        {errors.length > 0 ? (
          <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            <ul className="list-disc space-y-1 pl-4">
              {errors.map((error) => (
                <li key={error}>{error}</li>
              ))}
            </ul>
          </div>
        ) : null}

        {submitError ? (
          <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {submitError}
          </div>
        ) : null}

        <div className="mt-4 flex flex-wrap items-center justify-end gap-2">
          <Button
            onClick={() => void submit()}
            disabled={createDisabled}
            title={summary.blocked ? summary.label : undefined}
          >
            {createReplay.isPending ? 'Ставлю в очередь…' : 'Запустить прогон'}
          </Button>
        </div>
      </Card>

      {notice ? (
        <div
          role="status"
          className="rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-3 text-sm text-zinc-700"
        >
          {notice}
        </div>
      ) : null}

      <section className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2 className="text-base font-semibold text-zinc-900">История прогонов</h2>
            <p className="text-xs text-zinc-500">
              Прогоны не меняют живые запуски и не создают реальных ордеров.
            </p>
          </div>
        </div>

        <SandboxReplayList
          replays={replays.data?.replays ?? []}
          total={replays.data?.total ?? 0}
          status={statusFilter}
          includeArchived={includeArchived}
          pending={replays.isPending}
          error={replays.isError ? replays.error : null}
          busyId={busyId}
          symbolByKey={symbolByKey}
          onStatusChange={setStatusFilter}
          onIncludeArchivedChange={setIncludeArchived}
          onRetry={() => void replays.refetch()}
          onOpen={(replay) => setSelectedReplayId(replay.id)}
          onCancel={(replay) => void cancel(replay)}
          onArchive={(replay) => void archive(replay)}
        />
      </section>

      <Drawer
        open={selectedReplayId !== null}
        onClose={() => setSelectedReplayId(null)}
        title="Исторический прогон"
        description="Paper-прогон на сохранённых свечах 1h: отчёт, идентичность и контрафактические наблюдения."
        size="xl"
      >
        {selectedReplayId ? (
          <SandboxReplayDetail
            replayId={selectedReplayId}
            onClose={() => setSelectedReplayId(null)}
            onCancel={(replay) => void cancel(replay)}
            onArchive={(replay) => void archive(replay)}
            busy={busyId === selectedReplayId}
            symbolByKey={symbolByKey}
          />
        ) : null}
      </Drawer>

      <SandboxTokensDrawer open={tokensOpen} onClose={() => setTokensOpen(false)} />
    </div>
  );
}

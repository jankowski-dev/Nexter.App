import { Button } from '@/components/ui/button';
import { Drawer } from '@/components/ui/drawer';
import { Input } from '@/components/ui/input';
import { toRussianError } from '@/lib/error-messages';
import {
  useCreateSandboxRun,
  useSandboxCoverage,
  useSandboxRunDetail,
  useSandboxTokens,
  useUpdateSandboxRun,
} from './sandbox-hooks';
import {
  resetSandboxRunSettings,
  sandboxRunCreatePayload,
  sandboxRunFormDefaults,
  sandboxRunFormFromRun,
  sandboxRunFormShouldHydrate,
  sandboxRunSaveDisabled,
  sandboxRunUpdatePayload,
  sandboxSettingFields,
  validateSandboxRunForm,
  type SandboxRunFormValues,
} from './sandbox-run-form';
import { sandboxCoverageWarnings, sandboxStatusLabels } from './sandbox-tabs';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { SandboxToken } from '@nexter/contracts';

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
 * Empty-universe prompt of the run setup. Extracted so the owner-facing
 * instruction and its "Добавить токены" action can be rendered in tests without
 * a DOM (the drawer itself portals).
 */
export function SandboxRunTokenEmptyPrompt({ onManageTokens }: { onManageTokens: () => void }) {
  return (
    <div className="rounded-xl border border-dashed border-zinc-300 bg-zinc-50 px-4 py-3 text-sm text-zinc-600">
      <p>В песочнице пока нет токенов.</p>
      <Button className="mt-2" variant="secondary" onClick={onManageTokens}>
        Добавить токены
      </Button>
    </div>
  );
}

export function SandboxRunDrawer({
  open,
  runId,
  onClose,
  onSaved,
  onManageTokens,
}: {
  open: boolean;
  runId: string | null;
  onClose: () => void;
  onSaved: () => void;
  onManageTokens: () => void;
}) {
  const editing = runId !== null;
  const tokens = useSandboxTokens(open);
  const coverage = useSandboxCoverage(open);
  const detail = useSandboxRunDetail(open ? runId : null);
  const createRun = useCreateSandboxRun();
  const updateRun = useUpdateSandboxRun();
  const [values, setValues] = useState<SandboxRunFormValues>(sandboxRunFormDefaults);
  const [errors, setErrors] = useState<string[]>([]);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const hydratedRunId = useRef<string | null>(null);

  useEffect(() => {
    if (!open) {
      hydratedRunId.current = null;
      return;
    }
    setErrors([]);
    setSubmitError(null);
  }, [open, runId]);

  useEffect(() => {
    if (!open) return;
    if (
      !sandboxRunFormShouldHydrate({
        editing,
        hydratedRunId: hydratedRunId.current,
        detailRunId: detail.data?.id ?? null,
      })
    ) {
      return;
    }
    if (detail.data) {
      setValues(sandboxRunFormFromRun(detail.data));
      hydratedRunId.current = detail.data.id;
      return;
    }
    if (!editing) {
      setValues(sandboxRunFormDefaults());
      hydratedRunId.current = 'new';
    }
  }, [open, editing, detail.data]);

  const tokenList = tokens.data?.tokens ?? [];
  const symbolByKey = useMemo(
    () => new Map(tokenList.map((token) => [token.tokenKey, token.symbol])),
    [tokenList],
  );
  const preflight = sandboxCoverageWarnings(
    coverage.data?.tokens ?? [],
    values.tokenKeys,
    symbolByKey,
    { coverageAvailable: !coverage.isError },
  );
  const busy = createRun.isPending || updateRun.isPending;
  const notDraft = detail.data !== undefined && detail.data.status !== 'draft';
  const saveDisabled = sandboxRunSaveDisabled({
    busy,
    editing,
    detailPending: detail.isPending,
    detailError: detail.isError,
    notDraft,
    tokensPending: tokens.isPending,
  });

  function update<K extends keyof SandboxRunFormValues>(
    key: K,
    value: SandboxRunFormValues[K],
  ): void {
    setValues((current) => ({ ...current, [key]: value }));
  }

  function toggleToken(tokenKey: string): void {
    const token = tokenList.find((item) => item.tokenKey === tokenKey);
    const selected = values.tokenKeys.includes(tokenKey);
    if (token && !token.enabled && !selected) return;
    setValues((current) => ({
      ...current,
      tokenKeys: current.tokenKeys.includes(tokenKey)
        ? current.tokenKeys.filter((key) => key !== tokenKey)
        : [...current.tokenKeys, tokenKey],
    }));
  }

  async function save(): Promise<void> {
    if (detail.isError) {
      setSubmitError('Не удалось загрузить запуск. Закройте окно и попробуйте снова.');
      return;
    }
    if (saveDisabled) return;
    const validationErrors = validateSandboxRunForm(values);
    setErrors(validationErrors);
    setSubmitError(null);
    if (validationErrors.length > 0) return;

    try {
      if (editing && detail.data) {
        await updateRun.mutateAsync({
          runId: detail.data.id,
          body: sandboxRunUpdatePayload(values, detail.data),
        });
      } else {
        await createRun.mutateAsync(sandboxRunCreatePayload(values));
      }
      onSaved();
    } catch (error) {
      setSubmitError(toRussianError(error, 'Не удалось сохранить черновик запуска'));
    }
  }

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={editing ? 'Настройки запуска' : 'Новый запуск'}
      description="Виртуальные деньги и реальные рыночные данные 1h. Реальные ордера, кошелёк и подпись не используются."
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Отмена
          </Button>
          <Button onClick={() => void save()} disabled={saveDisabled}>
            {busy ? 'Сохраняю…' : editing ? 'Сохранить' : 'Создать черновик'}
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        {detail.isPending && editing ? (
          <div
            className="h-24 animate-pulse rounded-xl bg-zinc-100"
            aria-label="Загрузка запуска"
          />
        ) : null}

        {editing && detail.isError ? (
          <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {toRussianError(detail.error, 'Не удалось загрузить запуск')}
          </div>
        ) : null}

        {notDraft ? (
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            Настройки можно менять только у черновика. Этот запуск уже{' '}
            {detail.data ? sandboxStatusLabels[detail.data.status].toLowerCase() : ''}.
          </div>
        ) : null}

        <label className="block text-sm text-zinc-600">
          Название
          <Input
            className="mt-1"
            value={values.name}
            maxLength={80}
            placeholder="Например, Базовый 1h"
            disabled={notDraft}
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
              disabled={notDraft}
              onChange={(event) => update('initialCapitalUsd', event.target.value)}
            />
            <span className="shrink-0 text-xs text-zinc-500">USD</span>
          </div>
          <span className="mt-1 block text-[11px] text-zinc-500">
            Виртуальный капитал, по умолчанию $1 000. Комиссия и слиппедж учитываются в сделках.
          </span>
        </label>

        <div>
          <div className="mb-2 flex items-center justify-between gap-3">
            <h3 className="text-sm font-medium text-zinc-700">Токены запуска</h3>
            <span className="text-xs text-zinc-500">Выбрано: {values.tokenKeys.length}</span>
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
            <SandboxRunTokenEmptyPrompt onManageTokens={onManageTokens} />
          ) : (
            <div className="grid gap-2 sm:grid-cols-2">
              {tokenList.map((token) => {
                const checked = values.tokenKeys.includes(token.tokenKey);
                return (
                  <label
                    key={token.id}
                    className={`flex cursor-pointer items-start gap-2 rounded-xl border px-3 py-2 text-sm ${
                      checked
                        ? 'border-emerald-300 bg-emerald-50 text-emerald-900'
                        : 'border-zinc-200 bg-white text-zinc-700'
                    } ${!token.enabled ? 'opacity-60' : ''}`}
                  >
                    <input
                      type="checkbox"
                      className="mt-0.5 h-4 w-4 accent-emerald-600"
                      checked={checked}
                      disabled={notDraft}
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
          className={`rounded-xl border px-4 py-3 text-sm ${
            preflight.status === 'missing'
              ? 'border-red-200 bg-red-50 text-red-700'
              : preflight.status === 'partial'
                ? 'border-amber-200 bg-amber-50 text-amber-800'
                : 'border-emerald-200 bg-emerald-50 text-emerald-800'
          }`}
        >
          <div className="font-medium">{preflight.label}</div>
          {coverage.isPending && values.tokenKeys.length > 0 ? (
            <div className="mt-1 text-xs">Проверяю историю 1h…</div>
          ) : null}
          {coverage.isError ? (
            <div className="mt-1 text-xs font-medium">
              Не удалось проверить покрытие истории 1h. Запуск потребует подтверждения.
            </div>
          ) : null}
          {preflight.warnings.length > 0 ? (
            <ul className="mt-1 list-disc space-y-1 pl-4 text-xs">
              {preflight.warnings.slice(0, 6).map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          ) : (
            <div className="mt-1 text-xs">
              Все выбранные токены имеют 180 дней истории 1h; запуск возможен без подтверждений.
            </div>
          )}
        </div>

        <div className="rounded-xl border border-zinc-200 p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-medium text-zinc-700">Настройки Stage 1B/1C</h3>
              <p className="mt-1 text-[11px] text-zinc-500">
                Лимиты риска, комиссия и слиппедж. Значения замораживаются при запуске.
              </p>
            </div>
            <Button
              variant="ghost"
              disabled={busy || notDraft}
              onClick={() => setValues((current) => resetSandboxRunSettings(current))}
            >
              Сбросить
            </Button>
          </div>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            {sandboxSettingFields.map((field) => (
              <SettingField
                key={field.key}
                label={field.label}
                hint={field.hint}
                suffix={field.suffix}
                value={values[field.key]}
                integer={field.integer}
                min={field.min}
                max={field.max}
                step={field.step}
                onChange={(value) => update(field.key, value)}
              />
            ))}
          </div>
        </div>

        {errors.length > 0 ? (
          <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            <ul className="list-disc space-y-1 pl-4">
              {errors.map((error) => (
                <li key={error}>{error}</li>
              ))}
            </ul>
          </div>
        ) : null}

        {submitError ? (
          <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {submitError}
          </div>
        ) : null}
      </div>
    </Drawer>
  );
}

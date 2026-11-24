import {
  SANDBOX_DEFAULT_INITIAL_CAPITAL_USD,
  SANDBOX_DEFAULT_PAPER_SETTINGS,
  SANDBOX_DEFAULT_SETTINGS,
} from './sandbox-defaults';
import type {
  SandboxDecisionSettings,
  SandboxPaperSettings,
  SandboxRun,
  SandboxRunCreateRequest,
  SandboxRunDetail,
  SandboxRunUpdateRequest,
} from '@nexter/contracts';
import { Decimal } from 'decimal.js';

/** Editable subset of the frozen Stage 1B/1C configuration. */
export const SANDBOX_SETTING_KEYS = [
  'maxPositions',
  'maxTokenExposurePct',
  'maxStrategyExposurePct',
  'cashBufferPct',
  'dailyLossLimitPct',
  'maxDrawdownPct',
  'perTradeRiskPct',
  'defaultStopPct',
  'minOrderUsd',
  'liquidityCapPct',
  'feeBps',
  'slippageBps',
  'cooldownHoursAfterStop',
] as const;

export type SandboxSettingKey = (typeof SANDBOX_SETTING_KEYS)[number];

export interface SandboxRunFormValues {
  name: string;
  initialCapitalUsd: string;
  tokenKeys: string[];
  maxPositions: string;
  maxTokenExposurePct: string;
  maxStrategyExposurePct: string;
  cashBufferPct: string;
  dailyLossLimitPct: string;
  maxDrawdownPct: string;
  perTradeRiskPct: string;
  defaultStopPct: string;
  minOrderUsd: string;
  liquidityCapPct: string;
  feeBps: string;
  slippageBps: string;
  cooldownHoursAfterStop: string;
}

export interface SandboxSettingField {
  key: SandboxSettingKey;
  label: string;
  hint: string;
  suffix?: string;
  min: number;
  max: number;
  step?: number;
  integer?: boolean;
  decimalString?: boolean;
}

export const sandboxSettingFields: readonly SandboxSettingField[] = [
  {
    key: 'maxPositions',
    label: 'Максимум позиций',
    hint: 'Сколько токенов может быть открыто одновременно.',
    min: 0,
    max: 50,
    integer: true,
  },
  {
    key: 'maxTokenExposurePct',
    label: 'Экспозиция на токен',
    hint: 'Доля капитала на один токен.',
    suffix: '%',
    min: 0,
    max: 100,
    step: 1,
  },
  {
    key: 'maxStrategyExposurePct',
    label: 'Экспозиция на стратегию',
    hint: 'Доля капитала на одну стратегию.',
    suffix: '%',
    min: 0,
    max: 100,
    step: 1,
  },
  {
    key: 'cashBufferPct',
    label: 'Резерв кэша',
    hint: 'Доля капитала, которая всегда остаётся в кэше.',
    suffix: '%',
    min: 0,
    max: 100,
    step: 1,
  },
  {
    key: 'dailyLossLimitPct',
    label: 'Дневной лимит убытка',
    hint: 'После этого убытка за день новые покупки блокируются.',
    suffix: '%',
    min: 0,
    max: 100,
    step: 0.5,
  },
  {
    key: 'maxDrawdownPct',
    label: 'Максимальная просадка',
    hint: 'После этой просадки от пика новые решения не принимаются.',
    suffix: '%',
    min: 0,
    max: 100,
    step: 0.5,
  },
  {
    key: 'perTradeRiskPct',
    label: 'Риск на сделку',
    hint: 'Риск капитала на одну сделку при расчёте размера.',
    suffix: '%',
    min: 0,
    max: 100,
    step: 0.5,
  },
  {
    key: 'defaultStopPct',
    label: 'Стоп по умолчанию',
    hint: 'Защитный стоп, если стратегия не задала свой.',
    suffix: '%',
    min: 0,
    max: 100,
    step: 0.5,
  },
  {
    key: 'minOrderUsd',
    label: 'Минимальный ордер',
    hint: 'Меньшие суммы не отправляются на исполнение.',
    suffix: 'USD',
    min: 0,
    max: 1_000_000,
    decimalString: true,
  },
  {
    key: 'liquidityCapPct',
    label: 'Лимит ликвидности',
    hint: 'Доля объёма последнего закрытого бара 1h.',
    suffix: '%',
    min: 0,
    max: 100,
    step: 0.5,
  },
  {
    key: 'feeBps',
    label: 'Комиссия',
    hint: 'За каждую сторону сделки.',
    suffix: 'bps',
    min: 0,
    max: 9_999,
    integer: true,
  },
  {
    key: 'slippageBps',
    label: 'Слиппедж',
    hint: 'За каждую сторону сделки.',
    suffix: 'bps',
    min: 0,
    max: 9_999,
    integer: true,
  },
  {
    key: 'cooldownHoursAfterStop',
    label: 'Пауза после стопа',
    hint: 'Сколько часов токен не покупается после стопа.',
    suffix: 'ч',
    min: 0,
    max: 720,
  },
];

export function formNumber(value: string | number): string {
  return typeof value === 'number' ? String(value) : value;
}

export function sandboxRunFormDefaults(): SandboxRunFormValues {
  return {
    name: '',
    initialCapitalUsd: SANDBOX_DEFAULT_INITIAL_CAPITAL_USD,
    tokenKeys: [],
    maxPositions: formNumber(SANDBOX_DEFAULT_SETTINGS.maxPositions),
    maxTokenExposurePct: formNumber(SANDBOX_DEFAULT_SETTINGS.maxTokenExposurePct),
    maxStrategyExposurePct: formNumber(SANDBOX_DEFAULT_SETTINGS.maxStrategyExposurePct),
    cashBufferPct: formNumber(SANDBOX_DEFAULT_SETTINGS.cashBufferPct),
    dailyLossLimitPct: formNumber(SANDBOX_DEFAULT_SETTINGS.dailyLossLimitPct),
    maxDrawdownPct: formNumber(SANDBOX_DEFAULT_SETTINGS.maxDrawdownPct),
    perTradeRiskPct: formNumber(SANDBOX_DEFAULT_SETTINGS.perTradeRiskPct),
    defaultStopPct: formNumber(SANDBOX_DEFAULT_SETTINGS.defaultStopPct),
    minOrderUsd: SANDBOX_DEFAULT_SETTINGS.minOrderUsd,
    liquidityCapPct: formNumber(SANDBOX_DEFAULT_PAPER_SETTINGS.liquidityCapPct),
    feeBps: formNumber(SANDBOX_DEFAULT_PAPER_SETTINGS.feeBps),
    slippageBps: formNumber(SANDBOX_DEFAULT_PAPER_SETTINGS.slippageBps),
    cooldownHoursAfterStop: formNumber(SANDBOX_DEFAULT_PAPER_SETTINGS.cooldownHoursAfterStop),
  };
}

export function sandboxRunFormFromRun(run: SandboxRun | SandboxRunDetail): SandboxRunFormValues {
  return {
    name: run.name,
    initialCapitalUsd: run.initialCapitalUsd,
    tokenKeys: [...run.tokenKeys],
    maxPositions: formNumber(run.settings.maxPositions),
    maxTokenExposurePct: formNumber(run.settings.maxTokenExposurePct),
    maxStrategyExposurePct: formNumber(run.settings.maxStrategyExposurePct),
    cashBufferPct: formNumber(run.settings.cashBufferPct),
    dailyLossLimitPct: formNumber(run.settings.dailyLossLimitPct),
    maxDrawdownPct: formNumber(run.settings.maxDrawdownPct),
    perTradeRiskPct: formNumber(run.settings.perTradeRiskPct),
    defaultStopPct: formNumber(run.settings.defaultStopPct),
    minOrderUsd: run.settings.minOrderUsd,
    liquidityCapPct: formNumber(run.paper.liquidityCapPct),
    feeBps: formNumber(run.paper.feeBps),
    slippageBps: formNumber(run.paper.slippageBps),
    cooldownHoursAfterStop: formNumber(run.paper.cooldownHoursAfterStop),
  };
}

/** Resets the Stage 1B/1C settings, keeping the run identity and universe. */
export function resetSandboxRunSettings(
  values: SandboxRunFormValues,
  defaults: SandboxRunFormValues = sandboxRunFormDefaults(),
): SandboxRunFormValues {
  return {
    ...values,
    maxPositions: defaults.maxPositions,
    maxTokenExposurePct: defaults.maxTokenExposurePct,
    maxStrategyExposurePct: defaults.maxStrategyExposurePct,
    cashBufferPct: defaults.cashBufferPct,
    dailyLossLimitPct: defaults.dailyLossLimitPct,
    maxDrawdownPct: defaults.maxDrawdownPct,
    perTradeRiskPct: defaults.perTradeRiskPct,
    defaultStopPct: defaults.defaultStopPct,
    minOrderUsd: defaults.minOrderUsd,
    liquidityCapPct: defaults.liquidityCapPct,
    feeBps: defaults.feeBps,
    slippageBps: defaults.slippageBps,
    cooldownHoursAfterStop: defaults.cooldownHoursAfterStop,
  };
}

function parseFinite(value: string): number | null {
  const trimmed = value.trim();
  if (trimmed === '') return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

function decimalEquals(left: string, right: string): boolean {
  try {
    return new Decimal(left.trim() || '0').equals(new Decimal(right.trim() || '0'));
  } catch {
    return false;
  }
}

/**
 * True when every editable Stage 1B/1C field still equals the approved
 * defaults. An untouched create request omits `settings`/`paper` entirely so
 * the server, not the UI mirror, applies the engine defaults.
 */
export function sandboxRunSettingsMatchDefaults(
  values: SandboxRunFormValues,
  defaults: SandboxRunFormValues = sandboxRunFormDefaults(),
): boolean {
  return sandboxSettingFields.every((field) =>
    field.decimalString
      ? decimalEquals(values[field.key], defaults[field.key])
      : parseFinite(values[field.key]) === parseFinite(defaults[field.key]),
  );
}

export interface SandboxRunSaveState {
  busy: boolean;
  editing: boolean;
  detailPending: boolean;
  detailError: boolean;
  notDraft: boolean;
  tokensPending: boolean;
}

/** Save is blocked while detail/tokens load, on detail error, and for non-drafts. */
export function sandboxRunSaveDisabled(state: SandboxRunSaveState): boolean {
  if (state.busy || state.notDraft || state.tokensPending) return true;
  if (!state.editing) return false;
  return state.detailPending || state.detailError;
}

/**
 * The drawer seeds the form once per opened run. A refetch of `detail` (focus,
 * invalidation) must not overwrite what the owner is typing.
 */
export function sandboxRunFormShouldHydrate(input: {
  editing: boolean;
  hydratedRunId: string | null;
  detailRunId: string | null;
}): boolean {
  if (!input.editing) return input.hydratedRunId !== 'new';
  return input.detailRunId !== null && input.hydratedRunId !== input.detailRunId;
}

/** Validates the setup form; returns Russian messages, empty when valid. */
export function validateSandboxRunForm(values: SandboxRunFormValues): string[] {
  const errors: string[] = [];
  const name = values.name.trim();

  if (name.length === 0) errors.push('Укажите название запуска.');
  else if (name.length > 80) errors.push('Название запуска не длиннее 80 символов.');

  const capital = values.initialCapitalUsd.trim();
  if (!/^(?:0|[1-9]\d{0,15})(?:\.\d{1,2})?$/.test(capital)) {
    errors.push('Капитал — положительная сумма USD с не более чем двумя знаками после запятой.');
  } else if (!new Decimal(capital).greaterThan(0)) {
    errors.push('Начальный капитал должен быть больше нуля.');
  }

  if (values.tokenKeys.length === 0) errors.push('Выберите хотя бы один токен.');
  if (new Set(values.tokenKeys).size !== values.tokenKeys.length) {
    errors.push('Токены не должны повторяться.');
  }

  for (const field of sandboxSettingFields) {
    const raw = values[field.key].trim();
    if (field.decimalString) {
      if (!/^\d+(\.\d+)?$/.test(raw)) {
        errors.push(`${field.label}: укажите неотрицательную сумму USD.`);
        continue;
      }
      if (new Decimal(raw).greaterThan(field.max)) {
        errors.push(`${field.label}: не больше ${field.max}.`);
      }
      continue;
    }

    const parsed = parseFinite(raw);
    if (parsed === null) {
      errors.push(`${field.label}: укажите число.`);
      continue;
    }
    if (field.integer && !Number.isInteger(parsed)) {
      errors.push(`${field.label}: нужно целое число.`);
      continue;
    }
    if (parsed < field.min || parsed > field.max) {
      errors.push(`${field.label}: допустимо от ${field.min} до ${field.max}.`);
    } else if (!field.integer && field.key === 'defaultStopPct' && parsed <= 0) {
      errors.push(`${field.label}: значение должно быть больше нуля.`);
    } else if (!field.integer && field.key === 'liquidityCapPct' && parsed <= 0) {
      errors.push(`${field.label}: значение должно быть больше нуля.`);
    }
  }

  return errors;
}

export function sandboxSettingsFromForm(
  values: SandboxRunFormValues,
  base: SandboxDecisionSettings = SANDBOX_DEFAULT_SETTINGS,
): SandboxDecisionSettings {
  return {
    ...base,
    timeframe: '1h',
    maxPositions: parseFinite(values.maxPositions) ?? base.maxPositions,
    maxTokenExposurePct: parseFinite(values.maxTokenExposurePct) ?? base.maxTokenExposurePct,
    maxStrategyExposurePct:
      parseFinite(values.maxStrategyExposurePct) ?? base.maxStrategyExposurePct,
    cashBufferPct: parseFinite(values.cashBufferPct) ?? base.cashBufferPct,
    dailyLossLimitPct: parseFinite(values.dailyLossLimitPct) ?? base.dailyLossLimitPct,
    maxDrawdownPct: parseFinite(values.maxDrawdownPct) ?? base.maxDrawdownPct,
    perTradeRiskPct: parseFinite(values.perTradeRiskPct) ?? base.perTradeRiskPct,
    defaultStopPct: parseFinite(values.defaultStopPct) ?? base.defaultStopPct,
    minOrderUsd: values.minOrderUsd.trim() || base.minOrderUsd,
    liquidityCapPct: parseFinite(values.liquidityCapPct) ?? base.liquidityCapPct,
  };
}

export function sandboxPaperFromForm(
  values: SandboxRunFormValues,
  base: SandboxPaperSettings = SANDBOX_DEFAULT_PAPER_SETTINGS,
): SandboxPaperSettings {
  return {
    ...base,
    feeBps: parseFinite(values.feeBps) ?? base.feeBps,
    slippageBps: parseFinite(values.slippageBps) ?? base.slippageBps,
    liquidityCapPct: parseFinite(values.liquidityCapPct) ?? base.liquidityCapPct,
    cooldownHoursAfterStop:
      parseFinite(values.cooldownHoursAfterStop) ?? base.cooldownHoursAfterStop,
  };
}

export function sandboxRunCreatePayload(
  values: SandboxRunFormValues,
  defaults: SandboxRunFormValues = sandboxRunFormDefaults(),
): SandboxRunCreateRequest {
  const base: SandboxRunCreateRequest = {
    name: values.name.trim(),
    initialCapitalUsd: new Decimal(values.initialCapitalUsd.trim()).toFixed(2),
    tokenKeys: [...values.tokenKeys],
  };

  if (sandboxRunSettingsMatchDefaults(values, defaults)) return base;

  return {
    ...base,
    settings: sandboxSettingsFromForm(values),
    paper: sandboxPaperFromForm(values),
  };
}

/**
 * Draft edits always send the full settings: the run snapshot may contain
 * Stage 1B/1C fields (regime/strategy tuning) the owner did not see, so they are
 * merged forward from the persisted run instead of being reset to UI defaults.
 */
export function sandboxRunUpdatePayload(
  values: SandboxRunFormValues,
  run: SandboxRun | SandboxRunDetail,
): SandboxRunUpdateRequest {
  return {
    name: values.name.trim(),
    initialCapitalUsd: new Decimal(values.initialCapitalUsd.trim()).toFixed(2),
    tokenKeys: [...values.tokenKeys],
    settings: sandboxSettingsFromForm(values, run.settings),
    paper: sandboxPaperFromForm(values, run.paper),
  };
}

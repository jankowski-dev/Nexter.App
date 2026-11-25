import { SANDBOX_REPLAY_MAX_TOKENS, SANDBOX_REPLAY_PERIODS } from './sandbox-replay-helpers';
import {
  sandboxPaperFromForm,
  sandboxRunFormDefaults,
  sandboxRunSettingsMatchDefaults,
  sandboxSettingsFromForm,
  validateSandboxRunForm,
  type SandboxRunFormValues,
} from './sandbox-run-form';
import { Decimal } from 'decimal.js';
import type {
  SandboxReplayCreateRequest,
  SandboxReplayPeriod,
  SandboxReplayPreflightRequest,
} from '@nexter/contracts';

/**
 * Replay setup form: the live-run identity plus a period preset.
 *
 * The Stage 1B/1C fields and their builders are reused verbatim so a replay and
 * a live run freeze the same settings; only `periodDays` is replay-specific.
 */
export interface SandboxReplayFormValues extends SandboxRunFormValues {
  periodDays: SandboxReplayPeriod;
}

export function sandboxReplayFormDefaults(): SandboxReplayFormValues {
  return { ...sandboxRunFormDefaults(), periodDays: 180 };
}

/** Adds/removes one token and never grows the selection past three. */
export function sandboxReplayToggleToken(tokenKeys: readonly string[], tokenKey: string): string[] {
  if (tokenKeys.includes(tokenKey)) {
    return tokenKeys.filter((key) => key !== tokenKey);
  }
  if (tokenKeys.length >= SANDBOX_REPLAY_MAX_TOKENS) return [...tokenKeys];
  return [...tokenKeys, tokenKey];
}

/** Russian validation messages; empty when the form can be submitted. */
export function validateSandboxReplayForm(values: SandboxReplayFormValues): string[] {
  const errors = validateSandboxRunForm(values);

  if (values.tokenKeys.length > SANDBOX_REPLAY_MAX_TOKENS) {
    errors.push(`Для прогона выберите не больше ${SANDBOX_REPLAY_MAX_TOKENS} токенов.`);
  }
  if (!(SANDBOX_REPLAY_PERIODS as readonly number[]).includes(values.periodDays)) {
    errors.push('Период прогона: 30, 90 или 180 дней.');
  }

  return errors;
}

/**
 * Preflight payload for a valid selection. `allowPartial` is true by default so
 * the UI shows the exact shortened window the owner would run; the create
 * request still needs the explicit confirmation flag.
 */
export function sandboxReplayPreflightPayload(
  values: SandboxReplayFormValues,
  allowPartial = true,
): SandboxReplayPreflightRequest | null {
  if (values.tokenKeys.length < 1 || values.tokenKeys.length > SANDBOX_REPLAY_MAX_TOKENS) {
    return null;
  }

  return {
    tokenKeys: [...values.tokenKeys],
    periodDays: values.periodDays,
    allowPartial,
  };
}

/** Create payload; an untouched settings block is omitted for the server defaults. */
export function sandboxReplayCreatePayload(
  values: SandboxReplayFormValues,
  options: { allowPartial?: boolean } = {},
): SandboxReplayCreateRequest {
  const base: SandboxReplayCreateRequest = {
    name: values.name.trim(),
    tokenKeys: [...values.tokenKeys],
    periodDays: values.periodDays,
    initialCapitalUsd: new Decimal(values.initialCapitalUsd.trim()).toFixed(2),
    allowPartial: options.allowPartial ?? false,
  };

  if (sandboxRunSettingsMatchDefaults(values)) return base;

  return {
    ...base,
    settings: sandboxSettingsFromForm(values),
    paper: sandboxPaperFromForm(values),
  };
}

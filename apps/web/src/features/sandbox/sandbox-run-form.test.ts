import { describe, expect, it } from 'vitest';
import {
  resetSandboxRunSettings,
  sandboxRunCreatePayload,
  sandboxRunFormDefaults,
  sandboxRunFormFromRun,
  sandboxRunUpdatePayload,
  sandboxSettingsFromForm,
  validateSandboxRunForm,
} from './sandbox-run-form';
import { SANDBOX_DEFAULT_SETTINGS } from './sandbox-defaults';
import type { SandboxRun } from '@nexter/contracts';

const tokenKey = 'bsc:0x1111111111111111111111111111111111111111';

function validForm() {
  return {
    ...sandboxRunFormDefaults(),
    name: 'Базовый 1h',
    tokenKeys: [tokenKey],
  };
}

function runFixture(): SandboxRun {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    name: 'Старый запуск',
    status: 'draft',
    initialCapitalUsd: '2500.00',
    cashUsd: '2500.00',
    equityUsd: '2500.00',
    peakEquityUsd: '2500.00',
    dayStartEquityUsd: '2500.00',
    tokenKeys: [tokenKey],
    tokens: [
      {
        tokenKey,
        symbol: 'AAA',
        chain: 'bsc',
        contractAddress: '0x1111111111111111111111111111111111111111',
        enabled: true,
      },
    ],
    settings: {
      ...SANDBOX_DEFAULT_SETTINGS,
      maxPositions: 3,
      maxTokenExposurePct: 15,
      minOrderUsd: '25',
    },
    paper: {
      feeBps: 40,
      slippageBps: 5,
      liquidityCapPct: 2,
      maxPendingBars: 1,
      cooldownHoursAfterStop: 6,
      counterfactualHorizonHours: 24,
    },
    lastBarClose: null,
    lastTickAt: null,
    error: null,
    createdAt: '2026-11-24T00:00:00.000Z',
    updatedAt: '2026-11-24T00:00:00.000Z',
    startedAt: null,
    pausedAt: null,
    stoppedAt: null,
    archivedAt: null,
  };
}

describe('sandbox run setup form', () => {
  it('starts from the approved Stage 1B/1C defaults', () => {
    const defaults = sandboxRunFormDefaults();
    expect(defaults.initialCapitalUsd).toBe('1000');
    expect(defaults.maxPositions).toBe('5');
    expect(defaults.maxTokenExposurePct).toBe('20');
    expect(defaults.maxStrategyExposurePct).toBe('40');
    expect(defaults.cashBufferPct).toBe('10');
    expect(defaults.dailyLossLimitPct).toBe('2');
    expect(defaults.maxDrawdownPct).toBe('15');
    expect(defaults.perTradeRiskPct).toBe('1');
    expect(defaults.feeBps).toBe('25');
    expect(defaults.slippageBps).toBe('10');
    expect(defaults.cooldownHoursAfterStop).toBe('24');
    expect(defaults.liquidityCapPct).toBe('1');
    expect(defaults.tokenKeys).toEqual([]);
  });

  it('accepts a complete valid form', () => {
    expect(validateSandboxRunForm(validForm())).toEqual([]);
  });

  it('requires a name and at least one token', () => {
    const errors = validateSandboxRunForm({
      ...sandboxRunFormDefaults(),
      name: '   ',
    });
    expect(errors).toContain('Укажите название запуска.');
    expect(errors).toContain('Выберите хотя бы один токен.');
  });

  it.each(['', '0', '-5', '10.123', '01', 'abc', '1e3'])(
    'rejects an invalid capital %s',
    (capital) => {
      const errors = validateSandboxRunForm({ ...validForm(), initialCapitalUsd: capital });
      expect(errors.length).toBeGreaterThan(0);
    },
  );

  it('accepts two-decimal capital and rejects duplicates', () => {
    expect(validateSandboxRunForm({ ...validForm(), initialCapitalUsd: '1000.50' })).toEqual([]);
    expect(validateSandboxRunForm({ ...validForm(), tokenKeys: [tokenKey, tokenKey] })).toContain(
      'Токены не должны повторяться.',
    );
  });

  it('validates the risk limits and paper settings', () => {
    expect(validateSandboxRunForm({ ...validForm(), maxPositions: '51' })).toContain(
      'Максимум позиций: допустимо от 0 до 50.',
    );
    expect(validateSandboxRunForm({ ...validForm(), maxTokenExposurePct: '120' })).toContain(
      'Экспозиция на токен: допустимо от 0 до 100.',
    );
    expect(validateSandboxRunForm({ ...validForm(), feeBps: '10000' })).toContain(
      'Комиссия: допустимо от 0 до 9999.',
    );
    expect(validateSandboxRunForm({ ...validForm(), feeBps: '12.5' })).toContain(
      'Комиссия: нужно целое число.',
    );
    expect(validateSandboxRunForm({ ...validForm(), defaultStopPct: '0' })).toContain(
      'Стоп по умолчанию: значение должно быть больше нуля.',
    );
    expect(validateSandboxRunForm({ ...validForm(), liquidityCapPct: '0' })).toContain(
      'Лимит ликвидности: значение должно быть больше нуля.',
    );
    expect(validateSandboxRunForm({ ...validForm(), minOrderUsd: '-1' })).toContain(
      'Минимальный ордер: укажите неотрицательную сумму USD.',
    );
    expect(validateSandboxRunForm({ ...validForm(), cooldownHoursAfterStop: '721' })).toContain(
      'Пауза после стопа: допустимо от 0 до 720.',
    );
  });

  it('builds a decimal-string create payload with the frozen defaults', () => {
    const payload = sandboxRunCreatePayload(validForm());
    expect(payload.name).toBe('Базовый 1h');
    expect(payload.initialCapitalUsd).toBe('1000.00');
    expect(payload.tokenKeys).toEqual([tokenKey]);
    expect(payload.settings?.timeframe).toBe('1h');
    expect(payload.settings?.maxPositions).toBe(5);
    expect(payload.settings?.strategies).toEqual(SANDBOX_DEFAULT_SETTINGS.strategies);
    expect(payload.paper?.feeBps).toBe(25);
    expect(payload.paper?.maxPendingBars).toBe(1);
  });

  it('keeps hidden Stage 1B/1C fields from the edited run', () => {
    const run = runFixture();
    const form = sandboxRunFormFromRun(run);
    expect(form.name).toBe('Старый запуск');
    expect(form.initialCapitalUsd).toBe('2500.00');
    expect(form.maxPositions).toBe('3');
    expect(form.minOrderUsd).toBe('25');
    expect(form.feeBps).toBe('40');

    const payload = sandboxRunUpdatePayload(form, run);
    expect(payload.settings?.regime).toEqual(run.settings.regime);
    expect(payload.settings?.strategies).toEqual(run.settings.strategies);
    expect(payload.paper?.counterfactualHorizonHours).toBe(24);
    expect(payload.paper?.maxPendingBars).toBe(1);
  });

  it('resets only the settings, keeping identity and universe', () => {
    const form = {
      ...validForm(),
      maxPositions: '2',
      feeBps: '99',
      cooldownHoursAfterStop: '1',
    };
    const reset = resetSandboxRunSettings(form);
    expect(reset.name).toBe('Базовый 1h');
    expect(reset.tokenKeys).toEqual([tokenKey]);
    expect(reset.maxPositions).toBe('5');
    expect(reset.feeBps).toBe('25');
    expect(reset.cooldownHoursAfterStop).toBe('24');
  });

  it('mirrors editable settings into both the decision and paper configs', () => {
    const settings = sandboxSettingsFromForm({ ...validForm(), liquidityCapPct: '3' });
    expect(settings.liquidityCapPct).toBe(3);
    expect(settings.regime).toEqual(SANDBOX_DEFAULT_SETTINGS.regime);
  });
});

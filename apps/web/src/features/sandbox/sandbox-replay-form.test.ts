import { describe, expect, it } from 'vitest';
import {
  sandboxReplayCreatePayload,
  sandboxReplayFormDefaults,
  sandboxReplayPreflightPayload,
  sandboxReplayToggleToken,
  validateSandboxReplayForm,
  type SandboxReplayFormValues,
} from './sandbox-replay-form';
import { sandboxTokenId } from './sandbox-test-fixtures';

const btcKey = 'binance:BTCUSDT';
const ethKey = 'ethereum:0x2222222222222222222222222222222222222222';
const fourthKey = 'binance:ETHUSDT';

function values(overrides: Partial<SandboxReplayFormValues> = {}): SandboxReplayFormValues {
  return {
    ...sandboxReplayFormDefaults(),
    name: 'Исторический прогон',
    tokenKeys: [sandboxTokenId],
    ...overrides,
  };
}

describe('sandbox replay form', () => {
  it('defaults to 180 days, $1000 and the frozen Stage 1B/1C settings', () => {
    const defaults = sandboxReplayFormDefaults();
    expect(defaults.periodDays).toBe(180);
    expect(defaults.initialCapitalUsd).toBe('1000');
    expect(defaults.tokenKeys).toEqual([]);
    expect(defaults.name).toBe('');
    expect(defaults.feeBps).toBe('25');
    expect(defaults.slippageBps).toBe('10');
  });

  it('limits the selection to three unique tokens', () => {
    let selection = sandboxReplayToggleToken([], sandboxTokenId);
    expect(selection).toEqual([sandboxTokenId]);
    selection = sandboxReplayToggleToken(selection, btcKey);
    selection = sandboxReplayToggleToken(selection, ethKey);
    expect(selection).toHaveLength(3);

    const fourth = sandboxReplayToggleToken(selection, fourthKey);
    expect(fourth).toEqual(selection);
    expect(fourth).toHaveLength(3);

    expect(sandboxReplayToggleToken(selection, btcKey)).toEqual([sandboxTokenId, ethKey]);
  });

  it('validates identity, capital, tokens and period', () => {
    const errors = validateSandboxReplayForm(sandboxReplayFormDefaults());
    expect(errors.join(' ')).toContain('Укажите название');
    expect(errors.join(' ')).toContain('Выберите хотя бы один токен');

    expect(validateSandboxReplayForm(values({ periodDays: 90 }))).toEqual([]);

    const tooMany = validateSandboxReplayForm(
      values({ tokenKeys: [sandboxTokenId, btcKey, ethKey, fourthKey] }),
    );
    expect(tooMany.join(' ')).toContain('не больше 3');

    const badCapital = validateSandboxReplayForm(values({ initialCapitalUsd: '0' }));
    expect(badCapital.join(' ')).toContain('больше нуля');

    const badPeriod = validateSandboxReplayForm(
      values({ periodDays: 45 as unknown as SandboxReplayFormValues['periodDays'] }),
    );
    expect(badPeriod.join(' ')).toContain('30, 90 или 180');
  });

  it('builds the preflight request only for 1–3 tokens', () => {
    expect(sandboxReplayPreflightPayload(values({ tokenKeys: [] }))).toBeNull();
    expect(
      sandboxReplayPreflightPayload(
        values({ tokenKeys: [sandboxTokenId, btcKey, ethKey, fourthKey] }),
      ),
    ).toBeNull();

    expect(sandboxReplayPreflightPayload(values({ periodDays: 90 }))).toEqual({
      tokenKeys: [sandboxTokenId],
      periodDays: 90,
      allowPartial: true,
    });
  });

  it('builds a create request with the period and an explicit partial flag', () => {
    const payload = sandboxReplayCreatePayload(values(), { allowPartial: false });
    expect(payload).toEqual({
      name: 'Исторический прогон',
      tokenKeys: [sandboxTokenId],
      periodDays: 180,
      initialCapitalUsd: '1000.00',
      allowPartial: false,
    });

    const partial = sandboxReplayCreatePayload(values(), { allowPartial: true });
    expect(partial.allowPartial).toBe(true);
  });

  it('sends advanced settings only when they differ from the frozen defaults', () => {
    const defaults = sandboxReplayCreatePayload(values());
    expect(defaults.settings).toBeUndefined();
    expect(defaults.paper).toBeUndefined();

    const tuned = sandboxReplayCreatePayload(values({ feeBps: '40', maxPositions: '3' }));
    expect(tuned.settings?.maxPositions).toBe(3);
    expect(tuned.paper?.feeBps).toBe(40);
  });
});

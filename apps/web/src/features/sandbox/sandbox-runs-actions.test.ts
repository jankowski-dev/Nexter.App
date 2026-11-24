import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api';
import {
  isSandboxPartialCoverageError,
  planSandboxRunAction,
  startSandboxRunWithCoverage,
} from './sandbox-runs-actions';

describe('sandbox run action planning', () => {
  it('opens the run on Обзор', () => {
    expect(planSandboxRunAction('open')).toEqual({ kind: 'open' });
  });

  it('opens the draft drawer for edit', () => {
    expect(planSandboxRunAction('edit')).toEqual({ kind: 'edit' });
  });

  it.each(['start', 'pause', 'resume'] as const)('runs %s without a confirmation', (action) => {
    const plan = planSandboxRunAction(action);
    expect(plan).toEqual({ kind: 'control', action });
    expect('confirmation' in plan ? plan.confirmation : undefined).toBeUndefined();
  });

  it('confirms stop with a destructive dialog', () => {
    const plan = planSandboxRunAction('stop');
    expect(plan.kind).toBe('control');
    if (plan.kind !== 'control') throw new Error('unexpected plan');
    expect(plan.action).toBe('stop');
    expect(plan.confirmation).toMatchObject({
      title: 'Остановить запуск?',
      confirmLabel: 'Остановить',
      variant: 'danger',
    });
    expect(plan.confirmation?.description).toContain('последнему закрытому бару');
  });

  it('confirms archive with a destructive dialog', () => {
    const plan = planSandboxRunAction('archive');
    if (plan.kind !== 'control') throw new Error('unexpected plan');
    expect(plan.action).toBe('archive');
    expect(plan.confirmation).toMatchObject({
      title: 'Отправить запуск в архив?',
      confirmLabel: 'В архив',
      variant: 'danger',
    });
  });

  it('detects only the partial-coverage conflict for the allowPartial retry', () => {
    expect(isSandboxPartialCoverageError(new ApiError('SANDBOX_COVERAGE_PARTIAL', 'partial'))).toBe(
      true,
    );
    expect(isSandboxPartialCoverageError(new ApiError('SANDBOX_COVERAGE_MISSING', 'missing'))).toBe(
      false,
    );
    expect(isSandboxPartialCoverageError(new Error('boom'))).toBe(false);
    expect(isSandboxPartialCoverageError(null)).toBe(false);
  });
});

describe('sandbox start with coverage confirmation', () => {
  it('starts directly when the warmup is complete', async () => {
    const start = vi.fn().mockResolvedValue(undefined);
    const startAllowPartial = vi.fn().mockResolvedValue(undefined);
    const confirm = vi.fn().mockResolvedValue(true);
    await expect(startSandboxRunWithCoverage({ start, startAllowPartial, confirm })).resolves.toBe(
      true,
    );
    expect(confirm).not.toHaveBeenCalled();
    expect(startAllowPartial).not.toHaveBeenCalled();
  });

  it('retries with allowPartial after an explicit confirmation', async () => {
    const start = vi.fn().mockRejectedValue(new ApiError('SANDBOX_COVERAGE_PARTIAL', 'partial'));
    const startAllowPartial = vi.fn().mockResolvedValue(undefined);
    const confirm = vi.fn().mockResolvedValue(true);
    await expect(startSandboxRunWithCoverage({ start, startAllowPartial, confirm })).resolves.toBe(
      true,
    );
    expect(confirm).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'История неполная', variant: 'primary' }),
    );
    expect(startAllowPartial).toHaveBeenCalledTimes(1);
  });

  it('does not retry when the owner declines the reduced confidence', async () => {
    const start = vi.fn().mockRejectedValue(new ApiError('SANDBOX_COVERAGE_PARTIAL', 'partial'));
    const startAllowPartial = vi.fn().mockResolvedValue(undefined);
    const confirm = vi.fn().mockResolvedValue(false);
    await expect(startSandboxRunWithCoverage({ start, startAllowPartial, confirm })).resolves.toBe(
      false,
    );
    expect(startAllowPartial).not.toHaveBeenCalled();
  });

  it('rethrows other failures', async () => {
    const failure = new ApiError('SANDBOX_RUN_STATE_CHANGED', 'changed');
    const start = vi.fn().mockRejectedValue(failure);
    const startAllowPartial = vi.fn();
    const confirm = vi.fn();
    await expect(startSandboxRunWithCoverage({ start, startAllowPartial, confirm })).rejects.toBe(
      failure,
    );
  });
});

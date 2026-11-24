import { describe, expect, it } from 'vitest';
import { ApiError } from '@/lib/api';
import { isSandboxPartialCoverageError, planSandboxRunAction } from './sandbox-runs-actions';

describe('sandbox run action planning', () => {
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

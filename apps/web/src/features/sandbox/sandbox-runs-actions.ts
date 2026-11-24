import { ApiError } from '@/lib/api';
import type { SandboxRunAction } from './sandbox-run-card';

export interface SandboxConfirmCopy {
  title: string;
  description: string;
  confirmLabel: string;
  variant: 'danger' | 'primary';
}

export type SandboxRunActionPlan =
  | { kind: 'edit' }
  | { kind: 'open' }
  | {
      kind: 'control';
      action: 'start' | 'pause' | 'resume';
      confirmation?: undefined;
    }
  | {
      kind: 'control';
      action: 'stop' | 'archive';
      confirmation: SandboxConfirmCopy;
    };

/**
 * Pure decision table for the `Запуски` controls.
 *
 * Only stop and archive are destructive and require a ConfirmDialog; start,
 * pause and resume run directly. This keeps the confirm copy and the lifecycle
 * wiring testable without a DOM.
 */
export function planSandboxRunAction(action: SandboxRunAction): SandboxRunActionPlan {
  switch (action) {
    case 'open':
      return { kind: 'open' };
    case 'edit':
      return { kind: 'edit' };
    case 'start':
    case 'pause':
    case 'resume':
      return { kind: 'control', action };
    case 'stop':
      return {
        kind: 'control',
        action: 'stop',
        confirmation: {
          title: 'Остановить запуск?',
          description:
            'Решения и сделки прекратятся, открытые позиции будут отмечены по последнему закрытому бару, состояние запуска зафиксируется.',
          confirmLabel: 'Остановить',
          variant: 'danger',
        },
      };
    case 'archive':
      return {
        kind: 'control',
        action: 'archive',
        confirmation: {
          title: 'Отправить запуск в архив?',
          description:
            'Запуск скроется из списка. Данные, журнал и отчёты сохранятся и останутся доступными.',
          confirmLabel: 'В архив',
          variant: 'danger',
        },
      };
  }
}

/** A partial-coverage start needs an explicit owner confirmation before retry. */
export function isSandboxPartialCoverageError(error: unknown): boolean {
  return error instanceof ApiError && error.code === 'SANDBOX_COVERAGE_PARTIAL';
}

export type SandboxConfirm = (
  options: SandboxConfirmCopy & { cancelLabel?: string },
) => Promise<boolean>;

/**
 * Starts a run, offering the explicit reduced-confidence confirmation when the
 * API rejects a partial 1h warmup. Shared by `Запуски` and the dashboard so both
 * control surfaces behave identically.
 */
export async function startSandboxRunWithCoverage(input: {
  start: () => Promise<unknown>;
  startAllowPartial: () => Promise<unknown>;
  confirm: SandboxConfirm;
}): Promise<boolean> {
  try {
    await input.start();
    return true;
  } catch (error) {
    if (!isSandboxPartialCoverageError(error)) throw error;
  }

  const accepted = await input.confirm({
    title: 'История неполная',
    description:
      'Для выбранных токенов доступна не вся история 1h. Запуск начнётся с предупреждением и сниженной уверенностью режима.',
    confirmLabel: 'Всё равно запустить',
    cancelLabel: 'Отмена',
    variant: 'primary',
  });
  if (!accepted) return false;

  await input.startAllowPartial();
  return true;
}

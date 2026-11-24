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

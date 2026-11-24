import type { NavIconName } from '@/components/nav-icon';
import { messages } from '@/lib/i18n';
import type { SandboxCoverage, SandboxRunStatus, SandboxStatus } from '@nexter/contracts';

export type SandboxTab = 'overview' | 'runs' | 'journal' | 'reports';

export const sandboxTabs: ReadonlyArray<{
  value: SandboxTab;
  label: string;
  icon: NavIconName;
}> = [
  { value: 'overview', label: 'Обзор', icon: 'dashboard' },
  { value: 'runs', label: 'Запуски', icon: 'sandbox' },
  { value: 'journal', label: 'Журнал', icon: 'notes' },
  { value: 'reports', label: 'Отчёты', icon: 'statistics' },
];

export const SANDBOX_PATH = '/sandbox' as const;

export const sandboxNavItem = {
  to: SANDBOX_PATH,
  label: messages.nav.sandbox,
  icon: 'sandbox' as NavIconName,
};

/**
 * The sandbox navigation is owner-facing only while the feature flag reports
 * `enabled: true`. A failed or pending status query keeps it hidden; the page
 * at `/sandbox` still explains the disabled/unavailable state.
 */
export function isSandboxVisible(status: SandboxStatus | undefined): boolean {
  return status?.enabled === true;
}

/**
 * `Запуски` is the working tab while the dashboard, journal and reports arrive
 * in the next step, so an unhashed `/sandbox` opens it directly.
 */
export function sandboxTabFromHash(hash: string | undefined): SandboxTab {
  switch (hash) {
    case '#overview':
      return 'overview';
    case '#journal':
      return 'journal';
    case '#reports':
      return 'reports';
    default:
      return 'runs';
  }
}

export function sandboxHashForTab(tab: SandboxTab): string {
  return `#${tab}`;
}

export const sandboxStatusLabels: Record<SandboxRunStatus, string> = {
  draft: 'Черновик',
  running: 'Работает',
  paused: 'Пауза',
  stopped: 'Остановлен',
  failed: 'Ошибка',
};

export const sandboxStatusTones: Record<
  SandboxRunStatus,
  'neutral' | 'success' | 'warning' | 'danger' | 'info'
> = {
  draft: 'neutral',
  running: 'success',
  paused: 'warning',
  stopped: 'info',
  failed: 'danger',
};

const coverageStatusLabels: Record<SandboxCoverage['status'], string> = {
  ok: 'История полная',
  partial: 'История неполная',
  missing: 'Истории нет',
};

/**
 * Human-readable preflight notes for the selected universe.
 *
 * A run can start with `ok` or (after explicit confirmation) `partial`; a
 * missing series blocks the start. The notes mirror the server warnings so the
 * owner sees the same reason in the setup drawer.
 */
export function sandboxCoverageWarnings(
  coverage: readonly SandboxCoverage[],
  tokenKeys: readonly string[],
  symbolByKey: ReadonlyMap<string, string>,
): { status: 'ok' | 'partial' | 'missing'; warnings: string[]; label: string } {
  const selected = new Set(tokenKeys);
  const entries = coverage.filter((entry) => selected.has(entry.tokenKey));

  if (selected.size === 0) {
    return {
      status: 'missing',
      warnings: ['Не выбрано ни одного токена.'],
      label: 'Не выбран токен',
    };
  }

  const coveredKeys = new Set(entries.map((entry) => entry.tokenKey));
  const missingMembership = tokenKeys.filter((key) => !coveredKeys.has(key));
  const warnings: string[] = missingMembership.map(
    (key) => `Токен ${symbolByKey.get(key) ?? key} не проверен: нет данных о покрытии.`,
  );

  let status: 'ok' | 'partial' | 'missing' = 'ok';
  for (const entry of entries) {
    if (entry.status === 'missing') status = 'missing';
    else if (entry.status === 'partial' && status === 'ok') status = 'partial';

    if (entry.warning) {
      warnings.push(`${symbolByKey.get(entry.tokenKey) ?? entry.tokenKey}: ${entry.warning}`);
    } else if (entry.status === 'missing') {
      warnings.push(
        `${symbolByKey.get(entry.tokenKey) ?? entry.tokenKey}: нет истории 1h, запуск невозможен.`,
      );
    } else if (entry.status === 'partial') {
      warnings.push(
        `${symbolByKey.get(entry.tokenKey) ?? entry.tokenKey}: доступно ${entry.available} из ${entry.required} свечей 1h.`,
      );
    }
  }

  if (status === 'missing' && warnings.length === 0) {
    warnings.push('Недостаточно истории 1h для запуска.');
  }

  const label =
    status === 'ok'
      ? 'Данные готовы'
      : status === 'partial'
        ? 'История неполная — запуск потребует подтверждения'
        : coverageStatusLabels.missing;

  return { status, warnings, label };
}

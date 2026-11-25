import type { NavIconName } from '@/components/nav-icon';
import type { StatTone } from '@/components/ui/stat-card';
import { toRussianError } from '@/lib/error-messages';
import { formatDateTime, formatPct, formatUsd, pluralizeRu } from '@/lib/format';
import type {
  SandboxReplayPreflightResponse,
  SandboxReplayStatus,
  SandboxReplaySummary,
  SandboxReportMetrics,
} from '@nexter/contracts';

/** A historical replay evaluates at most three tokens (design §8). */
export const SANDBOX_REPLAY_MAX_TOKENS = 3;
/** Owner-facing evaluation period presets, in days. */
export const SANDBOX_REPLAY_PERIODS = [30, 90, 180] as const;
/** Server-side minimum for a shortened (`allowPartial`) window. */
export const SANDBOX_REPLAY_MIN_PARTIAL_BARS = 240;

export type SandboxReplayStatusFilter = 'all' | SandboxReplayStatus;

export const sandboxReplayStatusLabels: Record<SandboxReplayStatus, string> = {
  queued: 'В очереди',
  running: 'Выполняется',
  completed: 'Завершён',
  failed: 'Ошибка',
  cancelled: 'Отменён',
};

export const sandboxReplayStatusTones: Record<
  SandboxReplayStatus,
  'neutral' | 'success' | 'warning' | 'danger' | 'info'
> = {
  queued: 'warning',
  running: 'info',
  completed: 'success',
  failed: 'danger',
  cancelled: 'neutral',
};

export const sandboxReplayStatusOptions: ReadonlyArray<{
  value: SandboxReplayStatusFilter;
  label: string;
}> = [
  { value: 'all', label: 'Все статусы' },
  { value: 'queued', label: sandboxReplayStatusLabels.queued },
  { value: 'running', label: sandboxReplayStatusLabels.running },
  { value: 'completed', label: sandboxReplayStatusLabels.completed },
  { value: 'failed', label: sandboxReplayStatusLabels.failed },
  { value: 'cancelled', label: sandboxReplayStatusLabels.cancelled },
];

/** `queued`/`running` are the only states that can still change on their own. */
export function sandboxReplayIsActive(status: SandboxReplayStatus): boolean {
  return status === 'queued' || status === 'running';
}

export function sandboxReplayIsTerminal(status: SandboxReplayStatus): boolean {
  return status === 'completed' || status === 'failed' || status === 'cancelled';
}

/** Only a queued, non-archived replay can be cancelled (design §7). */
export function sandboxReplayCanCancel(
  replay: Pick<SandboxReplaySummary, 'status' | 'archivedAt'>,
): boolean {
  return replay.status === 'queued' && replay.archivedAt === null;
}

/** Only a terminal, non-archived replay can be archived. */
export function sandboxReplayCanArchive(
  replay: Pick<SandboxReplaySummary, 'status' | 'archivedAt'>,
): boolean {
  return sandboxReplayIsTerminal(replay.status) && replay.archivedAt === null;
}

export function sandboxReplayCanDownloadReport(status: SandboxReplayStatus): boolean {
  return status === 'completed';
}

export function sandboxReplayPeriodLabel(periodDays: number): string {
  return `${periodDays} ${pluralizeRu(periodDays, 'день', 'дня', 'дней')}`;
}

/** Token symbols for a compact row; unknown keys fall back to the raw key. */
export function sandboxReplayTokenSymbols(
  tokenKeys: readonly string[],
  symbolByKey: ReadonlyMap<string, string> = new Map(),
): string {
  return tokenKeys.map((key) => symbolByKey.get(key) ?? key).join(', ');
}

export function sandboxReplayWindowLabel(fromTime: string, toTime: string): string {
  return `${formatDateTime(fromTime)} — ${formatDateTime(toTime)}`;
}

/**
 * Elapsed wall time of a replay for the queued/running progress block.
 * Deterministic in `nowMs` so the UI and tests share one formatter.
 */
export function sandboxReplayElapsedLabel(input: {
  queuedAt: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  nowMs: number;
}): string {
  const startRaw = input.startedAt ?? input.queuedAt;
  if (!startRaw) return '—';
  const start = Date.parse(startRaw);
  if (!Number.isFinite(start)) return '—';
  const end = input.finishedAt ? Date.parse(input.finishedAt) : input.nowMs;
  if (!Number.isFinite(end) || end <= start) return 'только что';

  const totalMinutes = Math.floor((end - start) / 60_000);
  if (totalMinutes < 1) {
    return `${Math.max(1, Math.floor((end - start) / 1_000))} с`;
  }
  if (totalMinutes < 60) return `${totalMinutes} мин`;

  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return minutes === 0 ? `${hours} ч` : `${hours} ч ${minutes} мин`;
}

export interface SandboxReplayPreflightSummary {
  status: 'ok' | 'partial' | 'missing' | 'unknown';
  label: string;
  warnings: string[];
  /** A missing series or a hole inside the evaluation window never starts. */
  blocked: boolean;
  /** A shortened evaluation window needs an explicit owner confirmation. */
  requiresConfirmation: boolean;
  fromTime: string | null;
  toTime: string | null;
  evaluationBars: number | null;
}

/**
 * Turns the replay preflight into the form gate.
 *
 * The UI always asks for `allowPartial: true`, so a `partial` response already
 * describes the shortened window the owner would actually run. A gap inside
 * that window is therefore a real block; only a shorter-but-contiguous window
 * is allowed after confirmation. `missing` (no usable window) always blocks.
 */
export function sandboxReplayPreflightSummary(input: {
  tokenKeys: readonly string[];
  preflight: SandboxReplayPreflightResponse | undefined;
  pending: boolean;
  failed: boolean;
}): SandboxReplayPreflightSummary {
  if (input.tokenKeys.length === 0) {
    return {
      status: 'missing',
      label: 'Выберите токены для прогона',
      warnings: ['Не выбрано ни одного токена.'],
      blocked: true,
      requiresConfirmation: false,
      fromTime: null,
      toTime: null,
      evaluationBars: null,
    };
  }

  if (input.tokenKeys.length > SANDBOX_REPLAY_MAX_TOKENS) {
    return {
      status: 'missing',
      label: 'Слишком много токенов',
      warnings: [`Для прогона доступно не больше ${SANDBOX_REPLAY_MAX_TOKENS} токенов.`],
      blocked: true,
      requiresConfirmation: false,
      fromTime: null,
      toTime: null,
      evaluationBars: null,
    };
  }

  if (!input.preflight) {
    if (input.failed) {
      return {
        status: 'unknown',
        label: 'Не удалось проверить покрытие истории',
        warnings: ['Не удалось проверить покрытие истории 1h. Обновите данные и повторите.'],
        blocked: true,
        requiresConfirmation: false,
        fromTime: null,
        toTime: null,
        evaluationBars: null,
      };
    }
    return {
      status: 'unknown',
      label: 'Проверяю историю 1h…',
      warnings: [],
      blocked: true,
      requiresConfirmation: false,
      fromTime: null,
      toTime: null,
      evaluationBars: null,
    };
  }

  const preflight = input.preflight;
  const evaluationBars = Math.max(
    0,
    Math.round((Date.parse(preflight.toTime) - Date.parse(preflight.fromTime)) / 3_600_000),
  );
  const hasGaps = preflight.coverage.some((entry) => entry.gaps > 0);
  const warnings = [...preflight.warnings];

  if (preflight.status === 'missing') {
    return {
      status: 'missing',
      label: 'Недостаточно истории для прогона',
      warnings: warnings.length > 0 ? warnings : ['Недостаточно истории 1h для выбранных токенов.'],
      blocked: true,
      requiresConfirmation: false,
      fromTime: preflight.fromTime,
      toTime: preflight.toTime,
      evaluationBars,
    };
  }

  if (hasGaps) {
    if (!warnings.some((warning) => warning.includes('пропуск'))) {
      warnings.push('В окне прогона есть пропуски данных: прогон заблокирован.');
    }
    return {
      status: preflight.status,
      label: 'В окне прогона есть пропуски данных',
      warnings,
      blocked: true,
      requiresConfirmation: false,
      fromTime: preflight.fromTime,
      toTime: preflight.toTime,
      evaluationBars,
    };
  }

  if (preflight.status === 'partial' && evaluationBars < SANDBOX_REPLAY_MIN_PARTIAL_BARS) {
    warnings.push(
      `Для сокращённого окна нужно минимум ${SANDBOX_REPLAY_MIN_PARTIAL_BARS} часовых свечей; доступно ${evaluationBars}.`,
    );
    return {
      status: 'partial',
      label: 'Сокращённое окно слишком короткое',
      warnings,
      blocked: true,
      requiresConfirmation: false,
      fromTime: preflight.fromTime,
      toTime: preflight.toTime,
      evaluationBars,
    };
  }

  if (preflight.status === 'partial') {
    return {
      status: 'partial',
      label: 'История неполная — потребуется подтверждение',
      warnings,
      blocked: false,
      requiresConfirmation: true,
      fromTime: preflight.fromTime,
      toTime: preflight.toTime,
      evaluationBars,
    };
  }

  return {
    status: 'ok',
    label: 'Данные готовы',
    warnings,
    blocked: false,
    requiresConfirmation: false,
    fromTime: preflight.fromTime,
    toTime: preflight.toTime,
    evaluationBars,
  };
}

export interface SandboxReplayConfirmCopy {
  title: string;
  description: string;
  confirmLabel: string;
  variant: 'primary';
}

/**
 * Explicit acceptance of a shortened evaluation window. The actual window from
 * the `allowPartial` preflight is shown so the owner knows what will run.
 */
export function sandboxReplayPartialConfirm(
  preflight: SandboxReplayPreflightResponse | undefined,
): SandboxReplayConfirmCopy {
  const window =
    preflight === undefined
      ? 'сокращённом доступном окне'
      : sandboxReplayWindowLabel(preflight.fromTime, preflight.toTime);
  const bars =
    preflight === undefined
      ? null
      : Math.max(
          0,
          Math.round((Date.parse(preflight.toTime) - Date.parse(preflight.fromTime)) / 3_600_000),
        );

  return {
    title: 'Запустить прогон на сокращённом окне?',
    description: `Полное окно не покрыто. Прогон пройдёт ${window}${
      bars === null ? '' : ` (${bars} ч)`
    }. Уверенность режима будет снижена, а свечи до начала окна пойдут только на прогрев.`,
    confirmLabel: 'Запустить с сокращённым окном',
    variant: 'primary',
  };
}

export interface SandboxReplayMetricCard {
  title: string;
  value: string;
  description: string;
  tone: StatTone;
  icon: NavIconName;
}

function pnlTone(value: string): StatTone {
  const number = Number(value);
  if (!Number.isFinite(number) || number === 0) return 'sky';
  return number > 0 ? 'emerald' : 'rose';
}

/** The eight detail cards required by design §8. */
export function sandboxReplaySummaryCards(
  metrics: SandboxReportMetrics,
): SandboxReplayMetricCard[] {
  return [
    {
      title: 'Итоговый капитал',
      value: formatUsd(metrics.finalEquityUsd),
      description: 'По последнему бару окна',
      tone: 'emerald',
      icon: 'statistics',
    },
    {
      title: 'Доходность',
      value: formatPct(metrics.totalReturnPct),
      description: 'К начальному капиталу',
      tone: pnlTone(metrics.totalReturnPct),
      icon: 'dashboard',
    },
    {
      title: 'Максимальная просадка',
      value: formatPct(metrics.maxDrawdownPct).replace(/^[-+]/, ''),
      description: 'От пика капитала',
      tone: 'amber',
      icon: 'statistics',
    },
    {
      title: 'Начальный капитал',
      value: formatUsd(metrics.initialCapitalUsd),
      description: 'Виртуальные деньги на старте',
      tone: 'sky',
      icon: 'finance',
    },
    {
      title: 'Свободный капитал',
      value: formatUsd(metrics.finalCashUsd),
      description: 'Вне позиций на конце окна',
      tone: 'sky',
      icon: 'finance',
    },
    {
      title: 'Сделки',
      value: String(metrics.tradeCount),
      description: `${metrics.wins} прибыльных · ${metrics.losses} убыточных`,
      tone: 'violet',
      icon: 'notes',
    },
    {
      title: 'Win rate',
      value: metrics.winRatePct === null ? '—' : formatPct(metrics.winRatePct).replace(/^\+/, ''),
      description: 'Доля прибыльных сделок',
      tone: 'sky',
      icon: 'statistics',
    },
    {
      title: 'Комиссии',
      value: formatUsd(metrics.feesPaidUsd),
      description: 'Бумажные издержки',
      tone: 'amber',
      icon: 'operations',
    },
  ];
}

export const sandboxReplayCounterfactualOutcomeLabels: Record<
  'missed_opportunity' | 'bad_save' | 'neutral' | 'insufficient_data',
  string
> = {
  missed_opportunity: 'Упущенная возможность',
  bad_save: 'Пропуск оправдан',
  neutral: 'Нейтрально',
  insufficient_data: 'Недостаточно данных',
};

export const sandboxReplayCounterfactualOutcomeTones: Record<
  'missed_opportunity' | 'bad_save' | 'neutral' | 'insufficient_data',
  'neutral' | 'success' | 'warning' | 'danger' | 'info'
> = {
  missed_opportunity: 'warning',
  bad_save: 'success',
  neutral: 'neutral',
  insufficient_data: 'neutral',
};

/** Stable artifact names for the replay JSON/Markdown downloads. */
export function sandboxReplayReportFileName(replayId: string, format: 'json' | 'md'): string {
  return `sandbox-replay-${replayId}-report.${format}`;
}

export function sandboxReplayListError(error: unknown): string {
  return toRussianError(error, 'Не удалось загрузить прогоны песочницы');
}

export function sandboxReplayDetailError(error: unknown): string {
  return toRussianError(error, 'Не удалось загрузить прогон песочницы');
}

export function sandboxReplayCreateError(error: unknown): string {
  return toRussianError(error, 'Не удалось запустить исторический прогон');
}

export function sandboxReplayActionError(error: unknown): string {
  return toRussianError(error, 'Не удалось выполнить действие с прогоном');
}

export function sandboxReplayReportError(error: unknown): string {
  return toRussianError(error, 'Не удалось загрузить отчёт прогона');
}

export function sandboxReplayDownloadError(error: unknown): string {
  return toRussianError(error, 'Не удалось скачать отчёт прогона');
}

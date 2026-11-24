import type { NavIconName } from '@/components/nav-icon';
import type { StatTone } from '@/components/ui/stat-card';
import Decimal from 'decimal.js';
import { formatDateTime, formatPct, formatPrice, formatTokenAmount, formatUsd } from '@/lib/format';
import { toRussianError } from '@/lib/error-messages';
import type { SandboxReportMetrics, SandboxRunReport } from '@nexter/contracts';

/** Stable download name required by the owner workflow. */
export function sandboxReportFileName(runId: string, format: 'json' | 'md'): string {
  return `sandbox-${runId}-report.${format}`;
}

export function sandboxReportError(error: unknown): string {
  return toRussianError(error, 'Не удалось загрузить отчёт песочницы');
}

export function sandboxReportDownloadError(error: unknown): string {
  return toRussianError(error, 'Не удалось скачать отчёт песочницы');
}

/** Formats the numeric epoch-ms timestamps of the core report contract. */
export function formatSandboxReportTimestamp(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return '—';
  return formatDateTime(new Date(ms).toISOString());
}

export function sandboxReportPeriodLabel(report: SandboxRunReport): string {
  const first = formatSandboxReportTimestamp(report.period.firstBar);
  const last = formatSandboxReportTimestamp(report.period.lastBar);
  return `${first} — ${last} · ${report.period.bars} бар. · ${report.period.tokens.length} ток.`;
}

function pnlTone(value: string): StatTone {
  const number = Number(value);
  if (!Number.isFinite(number) || number === 0) return 'sky';
  return number > 0 ? 'emerald' : 'rose';
}

/**
 * A profit factor below 1 means gross losses exceed gross profits; it must not
 * look positive. `null` (no closed trades) stays neutral.
 */
export function sandboxProfitFactorTone(value: string | null): StatTone {
  if (value === null) return 'sky';
  const factor = new Decimal(value);
  if (factor.lessThan(1)) return 'rose';
  if (factor.greaterThan(1)) return 'emerald';
  return 'sky';
}

/** Percent without the positive sign, for rates/exposure magnitudes. */
export function formatSandboxPercentPlain(value: string): string {
  return formatPct(value).replace(/^\+/, '');
}

function usdOrDash(value: string | null): string {
  return value === null ? '—' : formatUsd(value);
}

export interface SandboxReportCard {
  title: string;
  value: string;
  description: string;
  tone: StatTone;
  icon: NavIconName;
}

/**
 * Summary cards of the deterministic report. Every money/percent value comes
 * from the contract strings; only the layout lives here.
 */
export function sandboxReportSummaryCards(metrics: SandboxReportMetrics): SandboxReportCard[] {
  return [
    {
      title: 'Начальный капитал',
      value: formatUsd(metrics.initialCapitalUsd),
      description: 'Виртуальные деньги на старте',
      tone: 'sky',
      icon: 'finance',
    },
    {
      title: 'Итоговый капитал',
      value: formatUsd(metrics.finalEquityUsd),
      description: 'По последнему закрытому бару',
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
      value: formatSandboxPercentPlain(metrics.maxDrawdownPct),
      description: 'От пика капитала',
      tone: 'amber',
      icon: 'statistics',
    },
    {
      title: 'Пик капитала',
      value: formatUsd(metrics.peakEquityUsd),
      description: 'Максимум equity',
      tone: 'violet',
      icon: 'statistics',
    },
    {
      title: 'Свободный капитал',
      value: formatUsd(metrics.finalCashUsd),
      description: 'Вне позиций',
      tone: 'sky',
      icon: 'finance',
    },
    {
      title: 'Стоимость позиций',
      value: formatUsd(metrics.finalPositionsValueUsd),
      description: 'По последним отметкам',
      tone: 'emerald',
      icon: 'portfolio',
    },
    {
      title: 'Реализованный P&L',
      value: formatUsd(metrics.realizedPnlUsd),
      description: 'Закрытые сделки',
      tone: pnlTone(metrics.realizedPnlUsd),
      icon: 'operations',
    },
    {
      title: 'Нереализованный P&L',
      value: formatUsd(metrics.unrealizedPnlUsd),
      description: 'Открытые позиции',
      tone: pnlTone(metrics.unrealizedPnlUsd),
      icon: 'operations',
    },
    {
      title: 'Комиссии',
      value: formatUsd(metrics.feesPaidUsd),
      description: 'Бумажные издержки',
      tone: 'amber',
      icon: 'operations',
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
      value: metrics.winRatePct === null ? '—' : formatSandboxPercentPlain(metrics.winRatePct),
      description: 'Доля прибыльных сделок',
      tone: 'sky',
      icon: 'statistics',
    },
    {
      title: 'Profit factor',
      value: metrics.profitFactor === null ? '—' : formatTokenAmount(metrics.profitFactor, 2),
      description: 'Валовая прибыль / убыток',
      tone: sandboxProfitFactorTone(metrics.profitFactor),
      icon: 'statistics',
    },
    {
      title: 'Средняя прибыль',
      value: usdOrDash(metrics.averageWinUsd),
      description: 'На прибыльную сделку',
      tone: 'emerald',
      icon: 'operations',
    },
    {
      title: 'Средний убыток',
      value: usdOrDash(metrics.averageLossUsd),
      description: 'На убыточную сделку',
      tone: 'rose',
      icon: 'operations',
    },
    {
      title: 'Время в рынке',
      value: formatSandboxPercentPlain(metrics.timeInMarketPct),
      description: 'Доля периода с позициями',
      tone: 'amber',
      icon: 'statistics',
    },
    {
      title: 'Средняя экспозиция',
      value: formatSandboxPercentPlain(metrics.averageExposurePct),
      description: 'Средняя доля капитала в позициях',
      tone: 'sky',
      icon: 'statistics',
    },
  ];
}

export interface SandboxEquityCurveSummary {
  points: number;
  firstEquityUsd: string | null;
  lastEquityUsd: string | null;
  minEquityUsd: string | null;
  maxEquityUsd: string | null;
}

/** Compact summary of the report equity curve (no rounding of the strings). */
export function sandboxEquityCurveSummary(
  points: readonly { equityUsd: string }[],
): SandboxEquityCurveSummary {
  if (points.length === 0) {
    return {
      points: 0,
      firstEquityUsd: null,
      lastEquityUsd: null,
      minEquityUsd: null,
      maxEquityUsd: null,
    };
  }
  const values = points.map((point) => point.equityUsd);
  let min = values[0] as string;
  let max = values[0] as string;
  for (const value of values) {
    if (new Decimal(value).lessThan(min)) min = value;
    if (new Decimal(value).greaterThan(max)) max = value;
  }
  return {
    points: points.length,
    firstEquityUsd: points[0]?.equityUsd ?? null,
    lastEquityUsd: points[points.length - 1]?.equityUsd ?? null,
    minEquityUsd: min,
    maxEquityUsd: max,
  };
}

/** Position price/units formatting for the report tables. */
export function sandboxReportPrice(value: string | null): string {
  return value === null ? '—' : formatPrice(value);
}

export function sandboxReportUnits(value: string): string {
  return formatTokenAmount(value, 8);
}

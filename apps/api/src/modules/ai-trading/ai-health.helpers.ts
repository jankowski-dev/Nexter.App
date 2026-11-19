import type { AiBotHealthLevel, AiBotHealthReason } from '@nexter/contracts';

export interface AiHealthCandidate {
  status: string;
  metrics: Record<string, unknown>;
}

export interface AiHealthInput {
  status: 'draft' | 'running' | 'stopped';
  startedAt: Date | null;
  lastTickAt: Date | null;
  maxDrawdownPct: string;
  maxDailyLossPct: number;
  budgetUsd: string;
  equityUsd: string;
  dailyOpenEquityUsd: string | null;
  candidate: AiHealthCandidate | null;
  recentError: boolean;
  now: Date;
}

export interface AiHealthResult {
  level: AiBotHealthLevel;
  reasons: AiBotHealthReason[];
  totalPnlPct: string;
  horizonDays: number | null;
}

const DAY_MS = 86_400_000;
const STALE_TICK_MS = 10 * 60_000;
const MIN_DRAWDOWN_STOP_PCT = 15;
const MIN_NEGATIVE_PNL_PCT = -5;

function numberMetric(metrics: Record<string, unknown>, key: string): number | null {
  const value = metrics[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function pct(value: number): string {
  return value.toFixed(2);
}

export function evaluateAiBotHealth(input: AiHealthInput): AiHealthResult {
  const reasons: AiBotHealthReason[] = [];
  const budget = Number(input.budgetUsd);
  const equity = Number(input.equityUsd);
  const totalPnlPct =
    Number.isFinite(budget) && budget > 0 && Number.isFinite(equity)
      ? ((equity - budget) / budget) * 100
      : 0;
  const candidateMetrics = input.candidate?.metrics ?? {};
  const horizonDays = numberMetric(candidateMetrics, 'horizonDays');
  const candidateMaxDrawdown = numberMetric(candidateMetrics, 'maxDrawdownPct');
  const candidateWorstOos = numberMetric(candidateMetrics, 'oosWorstReturnPct');

  const active =
    input.status === 'running' || (input.status === 'stopped' && input.startedAt !== null);

  if (active) {
    if (!input.candidate || input.candidate.status === 'rejected') {
      reasons.push({
        code: 'RECOMMENDATION_MISSING',
        severity: 'review',
        label: 'Рекомендация недоступна',
        detail: 'Связанный кандидат ИИ не найден или отклонён — проверьте настройки робота.',
      });
    }

    const drawdown = Number(input.maxDrawdownPct);
    const drawdownThreshold = Math.max(MIN_DRAWDOWN_STOP_PCT, (candidateMaxDrawdown ?? 10) * 1.5);
    if (Number.isFinite(drawdown) && drawdown > drawdownThreshold) {
      reasons.push({
        code: 'DRAWDOWN',
        severity: 'stop',
        label: 'Просадка выше лимита',
        detail: `Текущая просадка ${pct(drawdown)}% при пороге ${pct(drawdownThreshold)}%.`,
      });
    }

    const dailyOpen = input.dailyOpenEquityUsd === null ? null : Number(input.dailyOpenEquityUsd);
    if (
      dailyOpen !== null &&
      Number.isFinite(dailyOpen) &&
      dailyOpen > 0 &&
      Number.isFinite(equity)
    ) {
      const dailyLossPct = ((dailyOpen - equity) / dailyOpen) * 100;
      if (dailyLossPct > input.maxDailyLossPct) {
        reasons.push({
          code: 'DAILY_LOSS',
          severity: 'stop',
          label: 'Дневной убыток выше лимита',
          detail: `С начала дня ${pct(dailyLossPct)}% при лимите ${pct(input.maxDailyLossPct)}%.`,
        });
      }
    }

    if (
      input.status === 'running' &&
      (input.lastTickAt === null ||
        input.now.getTime() - input.lastTickAt.getTime() > STALE_TICK_MS)
    ) {
      reasons.push({
        code: 'STALE_DATA',
        severity: 'review',
        label: 'Нет свежих тиков',
        detail: 'Робот не получал свежие данные более 10 минут — проверьте котировки и цикл.',
      });
    }

    if (
      input.startedAt !== null &&
      horizonDays !== null &&
      horizonDays > 0 &&
      input.now.getTime() - input.startedAt.getTime() > horizonDays * DAY_MS
    ) {
      reasons.push({
        code: 'HORIZON_EXPIRED',
        severity: 'review',
        label: 'Горизонт рекомендации истёк',
        detail: `Прошло больше ${horizonDays} дн. с запуска — пересмотрите сценарий или остановите робота.`,
      });
    }

    const negativeThreshold = Math.min(
      MIN_NEGATIVE_PNL_PCT,
      candidateWorstOos ?? MIN_NEGATIVE_PNL_PCT,
    );
    if (totalPnlPct < negativeThreshold) {
      reasons.push({
        code: 'NEGATIVE_PNL',
        severity: 'review',
        label: 'Доходность ниже ожидаемого худшего фолда',
        detail: `Текущий P&L ${pct(totalPnlPct)}% при пороге ${pct(negativeThreshold)}%.`,
      });
    }

    if (input.recentError) {
      reasons.push({
        code: 'BOT_ERROR',
        severity: 'review',
        label: 'Ошибки в журнале робота',
        detail: 'За последние 24 часа в журнале робота есть ошибки — проверьте события.',
      });
    }
  }

  const level: AiBotHealthLevel = reasons.some((reason) => reason.severity === 'stop')
    ? 'stop'
    : reasons.length > 0
      ? 'review'
      : 'ok';

  return { level, reasons, totalPnlPct: pct(totalPnlPct), horizonDays };
}

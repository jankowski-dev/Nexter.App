import type { SandboxEvent, SandboxIntentStatus, SandboxTrade } from '@nexter/contracts';

type BadgeTone = 'neutral' | 'success' | 'warning' | 'danger' | 'info';

export const sandboxEventModuleLabels: Record<SandboxEvent['module'], string> = {
  run: 'Запуск',
  data: 'Данные',
  clock: 'Часы',
  regime: 'Режим',
  strategy: 'Стратегия',
  portfolio: 'Портфель',
  risk: 'Риск',
  execution: 'Исполнение',
  ledger: 'Учёт',
  manual: 'Вручную',
};

export const sandboxEventSeverityLabels: Record<SandboxEvent['severity'], string> = {
  debug: 'Отладка',
  info: 'Инфо',
  warn: 'Предупреждение',
  error: 'Ошибка',
  decision: 'Решение',
};

export const sandboxEventSeverityTones: Record<SandboxEvent['severity'], BadgeTone> = {
  debug: 'neutral',
  info: 'info',
  warn: 'warning',
  error: 'danger',
  decision: 'success',
};

export const sandboxDecisionActionLabels: Record<
  NonNullable<SandboxEvent['decision']>['action'],
  string
> = {
  buy: 'Покупка',
  sell: 'Продажа',
  hold: 'Удержание',
  block: 'Блок',
  noop: 'Без действия',
};

export const sandboxDecisionActionTones: Record<
  NonNullable<SandboxEvent['decision']>['action'],
  BadgeTone
> = {
  buy: 'success',
  sell: 'info',
  hold: 'neutral',
  block: 'danger',
  noop: 'neutral',
};

export const sandboxIntentStatusLabels: Record<SandboxIntentStatus, string> = {
  pending: 'Ожидает',
  filled: 'Исполнен',
  partial: 'Частично',
  rejected: 'Отклонён',
  expired: 'Истёк',
};

export const sandboxIntentStatusTones: Record<SandboxIntentStatus, BadgeTone> = {
  pending: 'warning',
  filled: 'success',
  partial: 'warning',
  rejected: 'danger',
  expired: 'neutral',
};

export const sandboxIntentSideLabels: Record<'buy' | 'sell', string> = {
  buy: 'Покупка',
  sell: 'Продажа',
};

/** Trade state only; kept separate from the intent side helper. */
export const sandboxTradeStatusLabels: Record<SandboxTrade['status'], string> = {
  open: 'Открыта',
  closed: 'Закрыта',
};

const sandboxRegimeLabels: Record<string, string> = {
  TREND_UP: 'Восходящий тренд',
  TREND_DOWN: 'Нисходящий тренд',
  RANGE: 'Боковик',
  CRASH: 'Обвал',
  RECOVERY: 'Восстановление',
  ILLIQUID: 'Низкая ликвидность',
  UNKNOWN: 'Неизвестно',
};

const sandboxStrategyLabels: Record<string, string> = {
  trend_pullback: 'Откат в тренде',
  range_reversion: 'Возврат к диапазону',
  recovery: 'Восстановление',
};

export function sandboxRegimeLabel(value: string | null | undefined): string {
  if (!value) return '—';
  return sandboxRegimeLabels[value] ?? value;
}

export function sandboxStrategyLabel(value: string | null | undefined): string {
  if (!value) return '—';
  return sandboxStrategyLabels[value] ?? value;
}

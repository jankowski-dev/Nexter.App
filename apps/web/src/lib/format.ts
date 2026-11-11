const usdFormatter = new Intl.NumberFormat('ru-RU', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const compactUsdFormatter = new Intl.NumberFormat('ru-RU', {
  style: 'currency',
  currency: 'USD',
  notation: 'compact',
  maximumFractionDigits: 1,
});

const countFormatter = new Intl.NumberFormat('ru-RU');

export function formatUsd(value: string | null | undefined, digits = 2): string {
  if (value === null || value === undefined || value === '') return '—';
  const number = Number(value);
  if (!Number.isFinite(number)) return '—';
  if (digits === 2) return usdFormatter.format(number);

  return new Intl.NumberFormat('ru-RU', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(number);
}

export function formatUsdCompact(value: string | null | undefined): string {
  if (value === null || value === undefined || value === '') return '—';
  const number = Number(value);
  return Number.isFinite(number) ? compactUsdFormatter.format(number) : '—';
}

export function formatSignedUsd(value: string | null | undefined): string {
  if (value === null || value === undefined || value === '') return '—';
  const number = Number(value);
  if (!Number.isFinite(number)) return '—';
  if (number === 0) return formatUsd('0');

  return `${number > 0 ? '+' : ''}${formatUsd(value)}`;
}

export function formatPct(value: string | null | undefined): string {
  if (value === null || value === undefined || value === '') return '—';
  const number = Number(value);
  if (!Number.isFinite(number)) return '—';

  return `${number > 0 ? '+' : ''}${new Intl.NumberFormat('ru-RU', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(number)}%`;
}

export function formatCount(value: number): string {
  return countFormatter.format(value);
}

export function pluralizeRu(count: number, one: string, few: string, many: string): string {
  const mod10 = Math.abs(count) % 10;
  const mod100 = Math.abs(count) % 100;

  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

export function formatTokenAmount(value: string, maxDigits = 6): string {
  const number = Number(value);
  if (!Number.isFinite(number)) return value;

  return new Intl.NumberFormat('ru-RU', {
    maximumFractionDigits: maxDigits,
  }).format(number);
}

export function formatDate(value: string | null | undefined): string {
  if (!value) return '—';
  return new Intl.DateTimeFormat('ru-RU', { dateStyle: 'short' }).format(new Date(value));
}

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return '—';
  return new Intl.DateTimeFormat('ru-RU', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date(value));
}

export function formatRelativeTime(value: string | Date | null | undefined): string {
  if (!value) return '—';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '—';

  const seconds = Math.max(0, Math.floor((Date.now() - date.getTime()) / 1000));
  if (seconds < 10) return 'только что';
  if (seconds < 60) return `${seconds} с назад`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)} мин назад`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)} ч назад`;
  return `${Math.floor(seconds / 86_400)} дн назад`;
}

export function pnlTone(value: string | null | undefined): string {
  if (value === null || value === undefined || value === '') return 'text-zinc-500';
  const number = Number(value);
  if (!Number.isFinite(number) || number === 0) return 'text-zinc-500';
  return number > 0 ? 'text-emerald-700' : 'text-red-700';
}

export function formatPrice(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === '') return '—';
  const number = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(number)) return '—';
  if (number === 0) return '0';

  const absolute = Math.abs(number);
  const maximumFractionDigits =
    absolute >= 1
      ? 2
      : absolute >= 0.01
        ? 3
        : Math.min(12, Math.max(8, Math.ceil(-Math.log10(absolute)) + 2));

  return new Intl.NumberFormat('ru-RU', {
    minimumFractionDigits: 0,
    maximumFractionDigits,
  }).format(number);
}

export function formatByn(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === '') return '—';
  const number = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(number)) return '—';
  return new Intl.NumberFormat('ru-RU', {
    style: 'currency',
    currency: 'BYN',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(number);
}

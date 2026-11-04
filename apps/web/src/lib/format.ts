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

export function pnlTone(value: string | null | undefined): string {
  if (value === null || value === undefined || value === '') return 'text-zinc-500';
  const number = Number(value);
  if (!Number.isFinite(number) || number === 0) return 'text-zinc-500';
  return number > 0 ? 'text-emerald-700' : 'text-red-700';
}

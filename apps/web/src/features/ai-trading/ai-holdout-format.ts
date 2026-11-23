export function holdoutConsistencyLabel(positive: number, total: number): string {
  if (!Number.isFinite(positive) || !Number.isFinite(total) || total <= 0) return '—';
  return `${positive}/${total}`;
}

export function holdoutActiveLabel(traded: number, total: number): string {
  if (!Number.isFinite(traded) || !Number.isFinite(total) || total <= 0) return '—';
  return `${traded}/${total}`;
}

export function holdoutBlockSummary(returnsPct: string[]): string {
  if (!Array.isArray(returnsPct) || returnsPct.length === 0) return '—';
  return returnsPct.map((value) => `${Number(value) > 0 ? '+' : ''}${value}%`).join(' / ');
}

export function holdoutConsistencyLabel(positive: number, total: number): string {
  if (total <= 0) return '—';
  return `${positive}/${total}`;
}

export function holdoutActiveLabel(traded: number, total: number): string {
  if (total <= 0) return '—';
  return `${traded}/${total}`;
}

export function holdoutBlockSummary(returnsPct: string[]): string {
  if (returnsPct.length === 0) return '—';
  return returnsPct.map((value) => `${Number(value) > 0 ? '+' : ''}${value}%`).join(' / ');
}

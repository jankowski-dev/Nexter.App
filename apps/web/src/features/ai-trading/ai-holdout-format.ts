export function holdoutConsistencyLabel(nonNegative: number, total: number): string {
  if (total <= 0) return '—';
  return `${nonNegative}/${total}`;
}

export function holdoutBlockSummary(returnsPct: string[]): string {
  if (returnsPct.length === 0) return '—';
  return returnsPct.map((value) => `${Number(value) > 0 ? '+' : ''}${value}%`).join(' / ');
}

import type { BarDiagnostic } from './types';

export const DIAGNOSTIC_COLUMNS = [
  'barIndex',
  'tokenId',
  'timeframe',
  'openTime',
  'closeTime',
  'open',
  'high',
  'low',
  'close',
  'volumeUsd',
  'regime',
  'regimeReason',
  'fastSma',
  'slowSma',
  'longSma',
  'atrPct',
  'recentHigh',
  'recentLow',
  'drawdownPct',
  'avgVolumeUsd',
  'staleBars',
  'strategyKey',
  'signalAction',
  'signalReason',
  'confidence',
  'riskWeight',
  'riskDecision',
  'riskReason',
  'riskChecks',
  'intentSide',
  'intentStatus',
  'intentReason',
  'fillSide',
  'fillPrice',
  'fillStatus',
  'positionAmount',
  'equityUsd',
  'cashUsd',
  'equityDrawdownPct',
] as const satisfies readonly (keyof BarDiagnostic)[];

export const ANNOTATION_HEADER = 'timestamp,expected_action,reason_code,note';

function cell(value: unknown): string {
  if (value === null || value === undefined) return '';
  const text = String(value);
  if (!/[",\n\r]/.test(text)) return text;
  return `"${text.replaceAll('"', '""')}"`;
}

export function renderDiagnosticsCsv(rows: readonly BarDiagnostic[]): string {
  const lines = [DIAGNOSTIC_COLUMNS.join(',')];
  for (const row of rows) {
    lines.push(DIAGNOSTIC_COLUMNS.map((column) => cell(row[column])).join(','));
  }
  return `${lines.join('\n')}\n`;
}

export function renderAnnotationTemplate(): string {
  return `${ANNOTATION_HEADER}\n`;
}

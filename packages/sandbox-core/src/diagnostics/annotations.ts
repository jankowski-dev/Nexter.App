import type { BarDiagnostic } from './types';

export const ANNOTATION_ACTIONS = ['entry', 'exit', 'hold', 'no-trade'] as const;
export type AnnotationAction = (typeof ANNOTATION_ACTIONS)[number];

export interface Annotation {
  readonly timestamp: string;
  readonly expectedAction: AnnotationAction;
  readonly reasonCode: string;
  readonly note: string;
}

export interface JoinedAnnotation {
  readonly annotation: Annotation;
  readonly bar: BarDiagnostic | null;
  readonly deltaMs: number | null;
}

const HEADER = ['timestamp', 'expected_action', 'reason_code', 'note'] as const;
const DEFAULT_TOLERANCE_MS = 2 * 3_600_000;
const ACTION_SET = new Set<string>(ANNOTATION_ACTIONS);

/** Minimal RFC-4180 reader for the annotation template. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char === '"') {
        if (text[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      quoted = true;
    } else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[index + 1] === '\n') index += 1;
      row.push(field);
      field = '';
      if (row.some((value) => value.trim() !== '')) rows.push(row);
      row = [];
    } else {
      field += char;
    }
  }

  row.push(field);
  if (row.some((value) => value.trim() !== '')) rows.push(row);
  return rows;
}

function normalizeTimestamp(value: string): string {
  const trimmed = value.trim();
  if (trimmed === '') throw new Error('annotation timestamp is required');
  const numeric = /^\d+$/.test(trimmed) ? Number(trimmed) : null;
  const parsed = numeric === null ? Date.parse(trimmed) : numeric;
  if (!Number.isFinite(parsed)) throw new Error(`invalid annotation timestamp: ${value}`);
  return new Date(parsed).toISOString();
}

export function parseAnnotationsCsv(text: string): Annotation[] {
  const rows = parseCsv(text.replace(/^\uFEFF/, ''));
  const header = rows[0];
  if (!header || header.length !== HEADER.length) {
    throw new Error('annotation header must be timestamp,expected_action,reason_code,note');
  }
  for (let index = 0; index < HEADER.length; index += 1) {
    if (header[index]?.trim() !== HEADER[index]) {
      throw new Error('annotation header must be timestamp,expected_action,reason_code,note');
    }
  }

  return rows.slice(1).map((row, index) => {
    const expectedAction = (row[1] ?? '').trim();
    if (!ACTION_SET.has(expectedAction)) {
      throw new Error(
        `annotation row ${index + 2}: expected_action must be one of ${ANNOTATION_ACTIONS.join(', ')}`,
      );
    }
    return {
      timestamp: normalizeTimestamp(row[0] ?? ''),
      expectedAction: expectedAction as AnnotationAction,
      reasonCode: (row[2] ?? '').trim(),
      note: row[3] ?? '',
    };
  });
}

export function joinAnnotations(
  annotations: readonly Annotation[],
  rows: readonly BarDiagnostic[],
  toleranceMs = DEFAULT_TOLERANCE_MS,
): JoinedAnnotation[] {
  const times = rows.map((row) => Date.parse(row.closeTime));
  return annotations.map((annotation) => {
    const target = Date.parse(annotation.timestamp);
    let bestIndex = -1;
    let bestDelta = Number.POSITIVE_INFINITY;
    for (let index = 0; index < times.length; index += 1) {
      const delta = Math.abs((times[index] as number) - target);
      if (delta < bestDelta) {
        bestDelta = delta;
        bestIndex = index;
      }
    }

    if (bestIndex < 0 || bestDelta > toleranceMs) {
      return { annotation, bar: null, deltaMs: Number.isFinite(bestDelta) ? bestDelta : null };
    }
    return { annotation, bar: rows[bestIndex] as BarDiagnostic, deltaMs: bestDelta };
  });
}

function escapeCell(value: string | null): string {
  return (value ?? '—').replaceAll('|', '\\|').replaceAll('\n', ' ');
}

function countBy(values: readonly string[]): Array<{ key: string; count: number }> {
  const counts = new Map<string, number>();
  for (const value of values) {
    if (!value) continue;
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([key, count]) => ({ key, count }))
    .sort((left, right) => right.count - left.count || left.key.localeCompare(right.key));
}

function failedRiskChecks(
  joined: readonly JoinedAnnotation[],
): Array<{ key: string; count: number }> {
  const values: string[] = [];
  for (const item of joined) {
    for (const check of item.bar?.riskChecks?.split('|') ?? []) {
      const [name, passed] = check.split(':');
      if (name && passed === 'false') values.push(name);
    }
  }
  return countBy(values);
}

export function renderAnnotationReport(joined: readonly JoinedAnnotation[]): string {
  const matched = joined.filter((item) => item.bar !== null);
  const unmatched = joined.filter((item) => item.bar === null);
  const reasons = countBy(joined.map((item) => item.annotation.reasonCode));
  const blockers = failedRiskChecks(joined);

  const lines = [
    '# Разметка диагностического прогона',
    '',
    `Всего меток: ${joined.length}. Сопоставлено: ${matched.length}. Вне окна: ${unmatched.length}.`,
    '',
    '## Причины',
    '',
    '| Причина | Количество |',
    '| --- | ---: |',
    ...reasons.map((item) => `| ${escapeCell(item.key)} | ${item.count} |`),
    '',
    '## Блокировавшие риск-проверки',
    '',
    '| Проверка | Количество |',
    '| --- | ---: |',
    ...blockers.map((item) => `| ${escapeCell(item.key)} | ${item.count} |`),
    '',
    '## Метки',
    '',
    '| Время | Действие | Причина | Бар | Режим | Сигнал | Риск | Close | Заметка |',
    '| --- | --- | --- | ---: | --- | --- | --- | ---: | --- |',
  ];

  for (const item of joined) {
    const bar = item.bar;
    lines.push(
      `| ${escapeCell(item.annotation.timestamp)} | ${item.annotation.expectedAction} | ${escapeCell(
        item.annotation.reasonCode,
      )} | ${bar ? bar.barIndex : '—'} | ${escapeCell(bar?.regime ?? null)} | ${escapeCell(
        bar?.signalReason ?? null,
      )} | ${escapeCell(bar?.riskReason ?? null)} | ${escapeCell(bar?.close ?? null)} | ${escapeCell(
        item.annotation.note,
      )} |`,
    );
  }

  if (unmatched.length > 0) {
    lines.push('', '## Не сопоставлены', '');
    for (const item of unmatched) {
      lines.push(`- ${item.annotation.timestamp}: ${item.annotation.reasonCode}`);
    }
  }

  return `${lines.join('\n')}\n`;
}

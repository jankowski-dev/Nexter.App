import type { Task } from '@nexter/contracts';

export function localDateKey(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
    date.getDate(),
  ).padStart(2, '0')}`;
}

export function isTaskOverdue(
  task: Pick<Task, 'status' | 'dueAt'>,
  now: Date = new Date(),
): boolean {
  if (task.status !== 'open' || !task.dueAt) return false;
  const due = new Date(task.dueAt);
  // 12:00 is the legacy all-day marker; only explicit times are time-aware.
  if (due.getHours() === 12 && due.getMinutes() === 0) {
    return localDateKey(task.dueAt) < localDateKey(now);
  }
  return due.getTime() < now.getTime();
}

export function formatTaskDue(value: string | null): string {
  if (!value) return 'Без срока';
  const date = new Date(value);
  const dateText = new Intl.DateTimeFormat('ru-RU', { dateStyle: 'short' }).format(date);
  const hours = date.getHours();
  const minutes = date.getMinutes();
  if (hours === 12 && minutes === 0) return dateText;
  return `${dateText}, ${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

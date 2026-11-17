import type { Task } from '@nexter/contracts';

export function localDateKey(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
    date.getDate(),
  ).padStart(2, '0')}`;
}

export function isTaskOverdue(
  task: Pick<Task, 'status' | 'dueAt' | 'dueHasTime'>,
  now: Date = new Date(),
): boolean {
  if (task.status !== 'open' || !task.dueAt) return false;
  const due = new Date(task.dueAt);
  if (!task.dueHasTime) {
    return localDateKey(task.dueAt) < localDateKey(now);
  }
  return due.getTime() < now.getTime();
}

export function taskTimeLabel(value: string | null, hasTime = true): string | null {
  if (!value || !hasTime) return null;
  const date = new Date(value);
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

export function formatTaskDue(value: string | null, hasTime = true): string {
  if (!value) return 'Без срока';
  const date = new Date(value);
  const dateText = new Intl.DateTimeFormat('ru-RU', { dateStyle: 'short' }).format(date);
  const time = taskTimeLabel(value, hasTime);
  return time ? `${dateText}, ${time}` : dateText;
}

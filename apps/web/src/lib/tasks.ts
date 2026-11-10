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
  return localDateKey(task.dueAt) < localDateKey(now);
}

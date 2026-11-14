import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import {
  CalendarIcon,
  CheckIcon,
  ClipboardIcon,
  ImageIcon,
  TagIcon,
  TrashIcon,
  UndoIcon,
} from '@/components/ui/icons';
import { formatTaskDue, isTaskOverdue } from '@/lib/tasks';
import type { Task, TaskStatus } from '@nexter/contracts';

export const taskStatusLabels: Record<TaskStatus, string> = {
  open: 'Открыта',
  done: 'Выполнена',
  cancelled: 'Отменена',
};

export const taskStatusTones: Record<TaskStatus, 'neutral' | 'success' | 'info'> = {
  open: 'info',
  done: 'success',
  cancelled: 'neutral',
};

export const taskPriorityLabels: Record<number, string> = {
  0: 'Низкий',
  1: 'Обычный',
  2: 'Высокий',
  3: 'Критичный',
};

export function TaskCompactRow({
  task,
  now,
  onOpen,
  onToggleStatus,
  onDelete,
  busy = false,
}: {
  task: Task;
  now: Date;
  onOpen?: () => void;
  onToggleStatus?: () => void;
  onDelete?: () => void;
  busy?: boolean;
}) {
  const overdue = isTaskOverdue(task, now);
  const done = task.status === 'done';

  return (
    <Card
      data-task-id={task.id}
      className="flex items-center justify-between gap-3 p-3 transition-colors hover:border-emerald-300"
    >
      <button
        type="button"
        onClick={onOpen}
        className="flex min-w-0 flex-1 items-center gap-3 text-left"
        aria-label={`Открыть задачу ${task.title}`}
      >
        <span
          className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${
            done
              ? 'bg-emerald-50 text-emerald-700'
              : overdue
                ? 'bg-red-50 text-red-700'
                : 'bg-sky-50 text-sky-700'
          }`}
        >
          <ClipboardIcon />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-2">
            <span
              className={`truncate text-sm font-semibold ${
                done ? 'text-zinc-500' : 'text-zinc-900'
              }`}
            >
              {task.title}
            </span>
            <Badge tone={taskStatusTones[task.status]}>{taskStatusLabels[task.status]}</Badge>
            {overdue ? <Badge tone="danger">Просрочена</Badge> : null}
          </span>
          <span className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-zinc-500">
            <span className="flex items-center gap-1">
              <CalendarIcon className="h-3.5 w-3.5" />
              {formatTaskDue(task.dueAt)}
            </span>
            <span>{taskPriorityLabels[task.priority] ?? 'Обычный'}</span>
            {task.recurrence ? <span>↻ Повтор</span> : null}
            {task.tags.length > 0 ? (
              <span className="flex min-w-0 items-center gap-1">
                <TagIcon />
                <span className="truncate">{task.tags.join(', ')}</span>
              </span>
            ) : null}
            {task.images.length > 0 ? (
              <span className="flex items-center gap-1">
                <ImageIcon />
                {task.images.length}
              </span>
            ) : null}
          </span>
        </span>
      </button>

      {onToggleStatus || onDelete ? (
        <div className="flex shrink-0 items-center gap-1">
          {onToggleStatus ? (
            <Button
              variant="ghost"
              className={`h-8 w-8 p-0 ${done ? 'text-zinc-500' : 'text-emerald-700'}`}
              aria-label={done ? 'Вернуть в работу' : 'Завершить задачу'}
              title={done ? 'Вернуть в работу' : 'Завершить'}
              onClick={onToggleStatus}
              disabled={busy}
            >
              {done ? <UndoIcon /> : <CheckIcon />}
            </Button>
          ) : null}
          {onDelete ? (
            <Button
              variant="ghost"
              className="h-8 w-8 p-0 text-zinc-500 hover:text-red-700"
              aria-label="Удалить задачу"
              title="Удалить"
              onClick={onDelete}
              disabled={busy}
            >
              <TrashIcon />
            </Button>
          ) : null}
        </div>
      ) : null}
    </Card>
  );
}

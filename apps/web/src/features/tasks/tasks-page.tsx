import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardDescription, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { PageHeader } from '@/components/ui/page-header';
import { ErrorState, LoadingRows } from '@/components/ui/states';
import { fetchTasks, updateTask } from '@/lib/api';
import { toRussianError } from '@/lib/error-messages';
import { formatDate } from '@/lib/format';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import type { Task, TaskStatus } from '@nexter/contracts';
import { TaskCalendar } from './task-calendar';
import { TaskDialog } from './task-dialog';

type TaskFilter = 'all' | 'open' | 'done';
type TaskView = 'list' | 'calendar';

const filterLabels: Record<TaskFilter, string> = {
  all: 'Все',
  open: 'Открытые',
  done: 'Выполненные',
};

const priorityLabels: Record<number, string> = {
  0: 'Низкий',
  1: 'Обычный',
  2: 'Высокий',
  3: 'Критичный',
};

function dateInputValue(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function monthRange(month: Date): { from: string; to: string } {
  const start = new Date(month.getFullYear(), month.getMonth(), 1);
  const end = new Date(month.getFullYear(), month.getMonth() + 1, 0, 23, 59, 59, 999);

  return { from: start.toISOString(), to: end.toISOString() };
}

export function TasksPage() {
  const queryClient = useQueryClient();
  const [view, setView] = useState<TaskView>('list');
  const [month, setMonth] = useState(
    () => new Date(new Date().getFullYear(), new Date().getMonth(), 1),
  );
  const [filter, setFilter] = useState<TaskFilter>('open');
  const [search, setSearch] = useState('');
  const [includeArchived, setIncludeArchived] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Task | null>(null);
  const [initialDue, setInitialDue] = useState<string | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);

  const range = view === 'calendar' ? monthRange(month) : null;
  const tasks = useQuery({
    queryKey: [
      'tasks',
      view,
      filter,
      search,
      includeArchived,
      range?.from ?? null,
      range?.to ?? null,
    ],
    queryFn: () =>
      fetchTasks({
        status: filter === 'all' ? undefined : filter,
        search: search || undefined,
        includeArchived,
        ...(range ?? {}),
        limit: view === 'calendar' ? 500 : 200,
      }),
  });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['tasks'] });
  };

  const statusMutation = useMutation({
    mutationFn: ({ task, status }: { task: Task; status: TaskStatus }) =>
      updateTask(task.id, { status }),
    onSuccess: () => {
      setError(null);
      invalidate();
    },
    onError: (err) => setError(toRussianError(err, 'Не удалось изменить задачу')),
  });

  const archiveMutation = useMutation({
    mutationFn: (task: Task) => updateTask(task.id, { archived: true }),
    onSuccess: () => {
      setError(null);
      invalidate();
    },
    onError: (err) => setError(toRussianError(err, 'Не удалось архивировать задачу')),
  });

  const restoreMutation = useMutation({
    mutationFn: (task: Task) => updateTask(task.id, { archived: false }),
    onSuccess: () => {
      setError(null);
      invalidate();
    },
    onError: (err) => setError(toRussianError(err, 'Не удалось вернуть задачу')),
  });

  const moveMutation = useMutation({
    mutationFn: ({ task, date }: { task: Task; date: string }) =>
      updateTask(task.id, { dueAt: new Date(`${date}T12:00:00`).toISOString() }),
    onSuccess: () => {
      setError(null);
      invalidate();
    },
    onError: (err) => setError(toRussianError(err, 'Не удалось перенести задачу')),
  });

  function openCreate(date?: string) {
    setEditing(null);
    setInitialDue(date);
    setDialogOpen(true);
  }

  function openEdit(task: Task) {
    setEditing(task);
    setInitialDue(undefined);
    setDialogOpen(true);
  }

  function closeDialog() {
    setDialogOpen(false);
    setEditing(null);
    setInitialDue(undefined);
  }

  const rows = tasks.data?.data ?? [];
  const now = Date.now();

  return (
    <div className="space-y-6">
      <PageHeader
        title="Задачи"
        subtitle="Личные задачи и напоминания. Не связаны с бухгалтерским учётом."
        actions={
          <>
            <div
              className="flex flex-wrap gap-1 rounded-lg border border-zinc-200 bg-zinc-50 p-1"
              role="tablist"
              aria-label="Вид задач"
            >
              {(
                [
                  ['list', 'Список'],
                  ['calendar', 'Календарь'],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  role="tab"
                  aria-selected={view === value}
                  onClick={() => setView(value)}
                  className={`rounded-md px-3 py-1.5 text-sm ${
                    view === value
                      ? 'bg-white text-zinc-900 shadow-sm'
                      : 'text-zinc-500 hover:text-zinc-900'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            <label className="flex items-center gap-2 text-sm text-zinc-600">
              <input
                type="checkbox"
                checked={includeArchived}
                onChange={(event) => setIncludeArchived(event.target.checked)}
                className="h-4 w-4 rounded border-zinc-300 bg-white"
              />
              Архив
            </label>
            <Button
              onClick={() =>
                openCreate(view === 'calendar' ? dateInputValue(new Date()) : undefined)
              }
            >
              Новая задача
            </Button>
          </>
        }
      />

      <div className="flex flex-wrap items-center gap-3">
        <div className="flex flex-wrap gap-1 rounded-lg border border-zinc-200 bg-zinc-50 p-1">
          {(Object.keys(filterLabels) as TaskFilter[]).map((item) => (
            <button
              key={item}
              type="button"
              onClick={() => setFilter(item)}
              className={`rounded-md px-3 py-1.5 text-sm ${
                filter === item
                  ? 'bg-white text-zinc-900 shadow-sm'
                  : 'text-zinc-500 hover:text-zinc-900'
              }`}
              aria-selected={filter === item}
              role="tab"
            >
              {filterLabels[item]}
            </button>
          ))}
        </div>
        <Input
          className="max-w-xs"
          placeholder="Поиск по задачам"
          aria-label="Поиск по задачам"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
      </div>

      {error ? (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      ) : null}

      {tasks.isPending ? <LoadingRows rows={6} /> : null}
      {tasks.isError ? (
        <ErrorState
          message={toRussianError(tasks.error, 'Не удалось загрузить задачи')}
          onRetry={() => void tasks.refetch()}
        />
      ) : null}

      {!tasks.isPending && !tasks.isError ? (
        view === 'calendar' ? (
          <TaskCalendar
            month={month}
            tasks={rows}
            onPrev={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}
            onNext={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}
            onToday={() => setMonth(new Date(new Date().getFullYear(), new Date().getMonth(), 1))}
            onEdit={openEdit}
            onCreate={(date) => openCreate(date)}
            onMove={(task, date) => moveMutation.mutate({ task, date })}
            busy={moveMutation.isPending}
          />
        ) : rows.length === 0 ? (
          <Card>
            <CardTitle>Задач нет</CardTitle>
            <CardDescription>Создайте задачу, чтобы не забыть важное действие.</CardDescription>
            <Button className="mt-4" onClick={() => openCreate()}>
              Новая задача
            </Button>
          </Card>
        ) : (
          <div className="grid gap-3">
            {rows.map((task) => {
              const overdue =
                task.status === 'open' &&
                Boolean(task.dueAt) &&
                new Date(task.dueAt as string).getTime() < now;
              return (
                <Card
                  key={task.id}
                  className={`flex min-h-[150px] flex-col ${task.archivedAt ? 'opacity-60' : ''}`}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge
                      tone={
                        task.status === 'done'
                          ? 'success'
                          : task.status === 'cancelled'
                            ? 'neutral'
                            : 'info'
                      }
                    >
                      {task.status === 'done'
                        ? 'Выполнена'
                        : task.status === 'cancelled'
                          ? 'Отменена'
                          : 'Открыта'}
                    </Badge>
                    <Badge tone={task.priority >= 2 ? 'warning' : 'neutral'}>
                      {priorityLabels[task.priority] ?? 'Обычный'}
                    </Badge>
                    {task.recurrence ? <Badge tone="info">↻</Badge> : null}
                    {task.tags.slice(0, 3).map((tag) => (
                      <Badge key={tag} tone="neutral">
                        {tag}
                      </Badge>
                    ))}
                    {task.tags.length > 3 ? (
                      <span className="text-xs text-zinc-500">+{task.tags.length - 3}</span>
                    ) : null}
                    {task.archivedAt ? <Badge tone="neutral">Архив</Badge> : null}
                    {overdue ? <Badge tone="danger">Просрочена</Badge> : null}
                  </div>

                  <h3 className="mt-2 line-clamp-2 min-h-12 text-base font-semibold text-zinc-900">
                    {task.title}
                  </h3>
                  <p className="mt-1 line-clamp-1 min-h-5 text-sm text-zinc-600">
                    {task.description ?? ' '}
                  </p>

                  <div className="mt-auto flex flex-wrap items-end justify-between gap-3 pt-3">
                    <div className="flex flex-wrap items-center gap-3 text-xs text-zinc-500">
                      <span>Создана {formatDate(task.createdAt)}</span>
                      {task.dueAt ? <span>Срок {formatDate(task.dueAt)}</span> : null}
                      {task.completedAt ? (
                        <span>Выполнена {formatDate(task.completedAt)}</span>
                      ) : null}
                      {task.images.slice(0, 3).map((image) => (
                        <img
                          key={image.id}
                          src={image.dataUrl}
                          alt={image.name}
                          className="h-6 w-6 rounded border border-zinc-200 object-cover"
                        />
                      ))}
                      {task.images.length > 3 ? <span>+{task.images.length - 3}</span> : null}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        variant="secondary"
                        className="h-8 px-3 text-xs"
                        onClick={() => openEdit(task)}
                      >
                        Изменить
                      </Button>
                      <Button
                        variant={task.status === 'done' ? 'ghost' : 'secondary'}
                        className="h-8 px-3 text-xs"
                        onClick={() =>
                          statusMutation.mutate({
                            task,
                            status: task.status === 'done' ? 'open' : 'done',
                          })
                        }
                        disabled={statusMutation.isPending}
                      >
                        {task.status === 'done' ? 'В работу' : 'Завершить'}
                      </Button>
                      {task.archivedAt ? (
                        <Button
                          variant="secondary"
                          className="h-8 px-3 text-xs"
                          onClick={() => restoreMutation.mutate(task)}
                          disabled={restoreMutation.isPending}
                        >
                          Вернуть
                        </Button>
                      ) : (
                        <Button
                          variant="ghost"
                          className="h-8 px-3 text-xs"
                          onClick={() => {
                            if (window.confirm(`Архивировать задачу «${task.title}»?`)) {
                              archiveMutation.mutate(task);
                            }
                          }}
                          disabled={archiveMutation.isPending}
                        >
                          В архив
                        </Button>
                      )}
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>
        )
      ) : null}

      {dialogOpen ? (
        <TaskDialog
          task={editing}
          initialDue={initialDue}
          onClose={closeDialog}
          onSaved={invalidate}
        />
      ) : null}
    </div>
  );
}

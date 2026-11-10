import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardDescription, CardTitle } from '@/components/ui/card';
import {
  CalendarIcon,
  CheckIcon,
  ClipboardIcon,
  ImageIcon,
  TagIcon,
  TrashIcon,
  UndoIcon,
} from '@/components/ui/icons';
import { Input } from '@/components/ui/input';
import { PageHeader } from '@/components/ui/page-header';
import { ErrorState, LoadingRows } from '@/components/ui/states';
import { fetchTasks, updateTask } from '@/lib/api';
import { toRussianError } from '@/lib/error-messages';
import { formatDate } from '@/lib/format';
import { isTaskOverdue } from '@/lib/tasks';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import type { Task, TaskStatus } from '@nexter/contracts';
import { TaskCalendar } from './task-calendar';
import { TaskDialog } from './task-dialog';

type TaskFilter = 'all' | 'open' | 'done';
type TaskView = 'list' | 'calendar';

interface TaskDrawerState {
  task: Task | null;
  initialDue?: string;
  startInEdit?: boolean;
  startWithDelete?: boolean;
}

const filterLabels: Record<TaskFilter, string> = {
  all: 'Все',
  open: 'Открытые',
  done: 'Выполненные',
};

const statusLabels: Record<TaskStatus, string> = {
  open: 'Открыта',
  done: 'Выполнена',
  cancelled: 'Отменена',
};

const statusTones: Record<TaskStatus, 'neutral' | 'success' | 'info'> = {
  open: 'info',
  done: 'success',
  cancelled: 'neutral',
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
  const [view, setView] = useState<TaskView>('calendar');
  const [month, setMonth] = useState(
    () => new Date(new Date().getFullYear(), new Date().getMonth(), 1),
  );
  const [filter, setFilter] = useState<TaskFilter>('open');
  const [archivedOnly, setArchivedOnly] = useState(false);
  const [search, setSearch] = useState('');
  const [drawer, setDrawer] = useState<TaskDrawerState | null>(null);
  const [error, setError] = useState<string | null>(null);

  const range = view === 'calendar' ? monthRange(month) : null;
  const tasks = useQuery({
    queryKey: ['tasks', view, filter, archivedOnly, search, range?.from ?? null, range?.to ?? null],
    queryFn: () =>
      fetchTasks({
        status: view === 'list' && !archivedOnly && filter !== 'all' ? filter : undefined,
        search: search || undefined,
        archivedOnly,
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
    setDrawer({ task: null, initialDue: date, startInEdit: true });
  }

  function openView(task: Task) {
    setDrawer({ task });
  }

  function closeDrawer() {
    setDrawer(null);
  }

  const rows = tasks.data?.data ?? [];
  const now = new Date();

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
                  ['calendar', 'Календарь'],
                  ['list', 'Список'],
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
        {view === 'list' && !archivedOnly ? (
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
        ) : null}
        <Input
          className="max-w-xs"
          placeholder="Поиск по задачам"
          aria-label="Поиск по задачам"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        <div className="ml-auto flex gap-1 rounded-xl border border-zinc-200 bg-zinc-50 p-1">
          <button
            type="button"
            onClick={() => setArchivedOnly(false)}
            className={`rounded-lg px-3 py-1.5 text-sm ${
              !archivedOnly
                ? 'bg-white text-zinc-900 shadow-sm'
                : 'text-zinc-500 hover:text-zinc-900'
            }`}
            aria-pressed={!archivedOnly}
          >
            Актуальные
          </button>
          <button
            type="button"
            onClick={() => setArchivedOnly(true)}
            className={`rounded-lg px-3 py-1.5 text-sm ${
              archivedOnly
                ? 'bg-white text-zinc-900 shadow-sm'
                : 'text-zinc-500 hover:text-zinc-900'
            }`}
            aria-pressed={archivedOnly}
          >
            Архивные
          </button>
        </div>
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
            onOpen={openView}
            onCreate={(date) => openCreate(date)}
            onMove={(task, date) => moveMutation.mutate({ task, date })}
            busy={moveMutation.isPending}
          />
        ) : rows.length === 0 ? (
          <Card>
            <CardTitle>{archivedOnly ? 'Архив пуст' : 'Задач нет'}</CardTitle>
            <CardDescription>
              {archivedOnly
                ? 'Удалённые задачи появятся здесь.'
                : 'Создайте задачу, чтобы не забыть важное действие.'}
            </CardDescription>
            {!archivedOnly ? (
              <Button className="mt-4" onClick={() => openCreate()}>
                Новая задача
              </Button>
            ) : null}
          </Card>
        ) : (
          <div className="space-y-2">
            {rows.map((task) => {
              const overdue = isTaskOverdue(task, now);
              const done = task.status === 'done';
              return (
                <Card
                  key={task.id}
                  data-task-id={task.id}
                  className={`flex items-center justify-between gap-3 p-3 transition-colors hover:border-emerald-300 ${
                    task.archivedAt ? 'opacity-60' : ''
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => openView(task)}
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
                        <Badge tone={statusTones[task.status]}>{statusLabels[task.status]}</Badge>
                        {overdue ? <Badge tone="danger">Просрочена</Badge> : null}
                        {task.archivedAt ? <Badge tone="neutral">Архив</Badge> : null}
                      </span>
                      <span className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-zinc-500">
                        <span className="flex items-center gap-1">
                          <CalendarIcon className="h-3.5 w-3.5" />
                          {task.dueAt ? formatDate(task.dueAt) : 'Без срока'}
                        </span>
                        <span>{priorityLabels[task.priority] ?? 'Обычный'}</span>
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

                  <div className="flex shrink-0 items-center gap-1">
                    {task.archivedAt ? (
                      <Button
                        variant="ghost"
                        className="h-8 w-8 p-0"
                        aria-label="Вернуть задачу"
                        title="Вернуть"
                        onClick={() => restoreMutation.mutate(task)}
                        disabled={restoreMutation.isPending}
                      >
                        <UndoIcon />
                      </Button>
                    ) : (
                      <>
                        <Button
                          variant="ghost"
                          className={`h-8 w-8 p-0 ${done ? 'text-zinc-500' : 'text-emerald-700'}`}
                          aria-label={done ? 'Вернуть в работу' : 'Завершить задачу'}
                          title={done ? 'Вернуть в работу' : 'Завершить'}
                          onClick={() =>
                            statusMutation.mutate({
                              task,
                              status: done ? 'open' : 'done',
                            })
                          }
                          disabled={statusMutation.isPending}
                        >
                          {done ? <UndoIcon /> : <CheckIcon />}
                        </Button>
                        <Button
                          variant="ghost"
                          className="h-8 w-8 p-0 text-zinc-500 hover:text-red-700"
                          aria-label="Удалить задачу"
                          title="Удалить"
                          onClick={() => setDrawer({ task, startWithDelete: true })}
                        >
                          <TrashIcon />
                        </Button>
                      </>
                    )}
                  </div>
                </Card>
              );
            })}
          </div>
        )
      ) : null}

      {drawer ? (
        <TaskDialog
          task={drawer.task}
          initialDue={drawer.initialDue}
          startInEdit={drawer.startInEdit}
          startWithDelete={drawer.startWithDelete}
          onClose={closeDrawer}
          onSaved={invalidate}
          onDeleted={() => {
            invalidate();
            closeDrawer();
          }}
        />
      ) : null}
    </div>
  );
}

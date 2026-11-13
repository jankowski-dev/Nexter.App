import { Button } from '@/components/ui/button';
import { Card, CardDescription, CardTitle } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { ListToolbar, TabGroup } from '@/components/ui/list-toolbar';
import { PageHeader } from '@/components/ui/page-header';
import { ErrorState, LoadingRows } from '@/components/ui/states';
import { fetchTasks, updateTask } from '@/lib/api';
import { toRussianError } from '@/lib/error-messages';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import type { Task, TaskStatus } from '@nexter/contracts';
import { TaskCalendar } from './task-calendar';
import { TaskDialog } from './task-dialog';
import { TaskCompactRow } from './task-row';

type TaskFilter = 'all' | 'open' | 'done';
type TaskView = 'list' | 'calendar';

interface TaskDrawerState {
  task: Task | null;
  initialDue?: string;
  startInEdit?: boolean;
  startWithDelete?: boolean;
}

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
  const [drawer, setDrawer] = useState<TaskDrawerState | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Task | null>(null);
  const [error, setError] = useState<string | null>(null);

  const range = view === 'calendar' ? monthRange(month) : null;
  const tasks = useQuery({
    queryKey: ['tasks', view, filter, search, range?.from ?? null, range?.to ?? null],
    queryFn: () =>
      fetchTasks({
        status: view === 'list' && filter !== 'all' ? filter : undefined,
        search: search || undefined,
        ...(range ?? {}),
        limit: view === 'calendar' ? 500 : 200,
      }),
  });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['tasks'] });
    void queryClient.invalidateQueries({ queryKey: ['dashboard-tasks'] });
  };

  const statusMutation = useMutation({
    mutationFn: ({ task, status }: { task: Task; status: TaskStatus }) =>
      updateTask(task.id, { status, applyToSeries: false }),
    onSuccess: () => {
      setError(null);
      invalidate();
    },
    onError: (err) => setError(toRussianError(err, 'Не удалось изменить задачу')),
  });

  const moveMutation = useMutation({
    mutationFn: ({ task, date }: { task: Task; date: string }) =>
      updateTask(task.id, {
        dueAt: new Date(`${date}T12:00:00`).toISOString(),
        applyToSeries: false,
      }),
    onSuccess: () => {
      setError(null);
      invalidate();
    },
    onError: (err) => setError(toRussianError(err, 'Не удалось перенести задачу')),
  });

  const deleteMutation = useMutation({
    mutationFn: (task: Task) => updateTask(task.id, { archived: true }),
    onSuccess: () => {
      setError(null);
      setDeleteTarget(null);
      invalidate();
    },
    onError: (err) => setError(toRussianError(err, 'Не удалось удалить задачу')),
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
                  ['list', 'Список'],
                  ['calendar', 'Календарь'],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  role="tab"
                  aria-selected={view === value}
                  onClick={() => {
                    setView(value);
                    if (value === 'calendar') setFilter('all');
                  }}
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

      <ListToolbar
        search={search}
        onSearch={setSearch}
        searchPlaceholder="Поиск по задачам"
        searchAriaLabel="Поиск по задачам"
      >
        {view === 'list' ? (
          <TabGroup
            value={filter}
            onChange={setFilter}
            ariaLabel="Статус задач"
            options={[
              { value: 'open', label: 'Открытые' },
              { value: 'done', label: 'Выполненные' },
              { value: 'all', label: 'Все' },
            ]}
          />
        ) : null}
      </ListToolbar>

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
            <CardTitle>Задач нет</CardTitle>
            <CardDescription>Создайте задачу, чтобы не забыть важное действие.</CardDescription>
            <Button className="mt-4" onClick={() => openCreate()}>
              Новая задача
            </Button>
          </Card>
        ) : (
          <div className="space-y-2">
            {rows.map((task) => (
              <TaskCompactRow
                key={task.id}
                task={task}
                now={now}
                onOpen={() => openView(task)}
                onToggleStatus={() =>
                  statusMutation.mutate({
                    task,
                    status: task.status === 'done' ? 'open' : 'done',
                  })
                }
                onDelete={() => setDeleteTarget(task)}
                busy={statusMutation.isPending}
              />
            ))}
          </div>
        )
      ) : null}

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title="Удалить задачу?"
        description={
          deleteTarget?.seriesId
            ? 'Все задачи этой серии переместятся в архив; вернуть можно будет всю серию.'
            : 'Задача переместится в архив, откуда её можно вернуть.'
        }
        confirmAriaLabel="Подтвердить удаление задачи"
        cancelAriaLabel="Отменить удаление задачи"
        busy={deleteMutation.isPending}
        error={error}
        onConfirm={() => {
          if (deleteTarget) deleteMutation.mutate(deleteTarget);
        }}
        onCancel={() => setDeleteTarget(null)}
      />

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

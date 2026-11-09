import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardDescription, CardTitle } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { PageHeader } from '@/components/ui/page-header';
import { Select } from '@/components/ui/select';
import { ErrorState, LoadingRows } from '@/components/ui/states';
import { Textarea } from '@/components/ui/textarea';
import { createTask, fetchTasks, updateTask } from '@/lib/api';
import { toRussianError } from '@/lib/error-messages';
import { formatDate } from '@/lib/format';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import type { Task, TaskStatus } from '@nexter/contracts';

type TaskFilter = 'all' | 'open' | 'done';

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

function dueDate(value: string | null): string {
  return value ? value.slice(0, 10) : '';
}

function toIsoDate(value: string): string | null {
  return value ? new Date(`${value}T12:00:00`).toISOString() : null;
}

export function TasksPage() {
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<TaskFilter>('all');
  const [search, setSearch] = useState('');
  const [includeArchived, setIncludeArchived] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Task | null>(null);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState('1');
  const [due, setDue] = useState('');
  const [error, setError] = useState<string | null>(null);

  const tasks = useQuery({
    queryKey: ['tasks', filter, search, includeArchived],
    queryFn: () =>
      fetchTasks({
        status: filter === 'all' ? undefined : filter,
        search: search || undefined,
        includeArchived,
      }),
  });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['tasks'] });
  };

  const saveMutation = useMutation({
    mutationFn: () => {
      const payload = {
        title: title.trim(),
        description: description.trim() || null,
        priority: Number.parseInt(priority, 10) || 0,
        dueAt: toIsoDate(due),
      };

      return editing ? updateTask(editing.id, payload) : createTask(payload);
    },
    onSuccess: () => {
      setDialogOpen(false);
      setEditing(null);
      setError(null);
      invalidate();
    },
    onError: (err) => setError(toRussianError(err, 'Не удалось сохранить задачу')),
  });

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

  function openCreate() {
    setEditing(null);
    setTitle('');
    setDescription('');
    setPriority('1');
    setDue('');
    setError(null);
    setDialogOpen(true);
  }

  function openEdit(task: Task) {
    setEditing(task);
    setTitle(task.title);
    setDescription(task.description ?? '');
    setPriority(String(task.priority));
    setDue(dueDate(task.dueAt));
    setError(null);
    setDialogOpen(true);
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
            <label className="flex items-center gap-2 text-sm text-zinc-600">
              <input
                type="checkbox"
                checked={includeArchived}
                onChange={(event) => setIncludeArchived(event.target.checked)}
                className="h-4 w-4 rounded border-zinc-300 bg-white"
              />
              Архив
            </label>
            <Button onClick={openCreate}>Новая задача</Button>
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

      {error && !dialogOpen ? (
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
        rows.length === 0 ? (
          <Card>
            <CardTitle>Задач нет</CardTitle>
            <CardDescription>Создайте задачу, чтобы не забыть важное действие.</CardDescription>
            <Button className="mt-4" onClick={openCreate}>
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
                <Card key={task.id} className={task.archivedAt ? 'opacity-60' : undefined}>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-base font-semibold text-zinc-900">{task.title}</span>
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
                        {task.archivedAt ? <Badge tone="neutral">Архив</Badge> : null}
                        {overdue ? <Badge tone="danger">Просрочена</Badge> : null}
                      </div>
                      {task.description ? (
                        <p className="mt-2 whitespace-pre-wrap text-sm text-zinc-600">
                          {task.description}
                        </p>
                      ) : null}
                      <div className="mt-2 flex flex-wrap gap-3 text-xs text-zinc-500">
                        <span>Создана {formatDate(task.createdAt)}</span>
                        {task.dueAt ? <span>Срок {formatDate(task.dueAt)}</span> : null}
                        {task.completedAt ? (
                          <span>Выполнена {formatDate(task.completedAt)}</span>
                        ) : null}
                      </div>
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

      <Dialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        title={editing ? 'Изменить задачу' : 'Новая задача'}
        description="Задачи хранятся на сервере и доступны только владельцу."
        footer={
          <>
            <Button variant="ghost" onClick={() => setDialogOpen(false)}>
              Отмена
            </Button>
            <Button
              onClick={() => saveMutation.mutate()}
              disabled={saveMutation.isPending || !title.trim()}
            >
              {saveMutation.isPending ? 'Сохраняю…' : 'Сохранить'}
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <label className="block text-sm text-zinc-600">
            Название
            <Input
              className="mt-1"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Проверить позицию BASED"
            />
          </label>
          <label className="block text-sm text-zinc-600">
            Описание
            <Textarea
              className="mt-1"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="Детали, ссылки, следующий шаг"
            />
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-sm text-zinc-600">
              Приоритет
              <Select
                className="mt-1"
                value={priority}
                onChange={(event) => setPriority(event.target.value)}
              >
                {Object.entries(priorityLabels).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </Select>
            </label>
            <label className="block text-sm text-zinc-600">
              Срок
              <Input
                className="mt-1"
                type="date"
                value={due}
                onChange={(event) => setDue(event.target.value)}
              />
            </label>
          </div>
          {error ? <p className="text-sm text-red-700">{error}</p> : null}
        </div>
      </Dialog>
    </div>
  );
}

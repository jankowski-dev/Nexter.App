import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardDescription, CardTitle } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Dialog } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { PageHeader } from '@/components/ui/page-header';
import { ErrorState, LoadingRows } from '@/components/ui/states';
import {
  createHabit,
  fetchDashboardPnl,
  fetchDashboardSummary,
  fetchFinanceSummary,
  fetchHabits,
  fetchTasks,
  updateHabit,
  updateTask,
} from '@/lib/api';
import { toRussianError } from '@/lib/error-messages';
import { formatByn, formatSignedUsd, formatUsd, pnlTone } from '@/lib/format';
import { useLiveFlash } from '@/lib/use-live-flash';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { Decimal } from 'decimal.js';
import { useState } from 'react';
import type { Habit, Task } from '@nexter/contracts';
import { TaskCompactRow } from '../tasks/task-row';
import { TaskDialog } from '../tasks/task-dialog';

function currentMonthKey(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

function localDateKey(date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
    date.getDate(),
  ).padStart(2, '0')}`;
}

function endOfTodayIso(): string {
  const date = new Date();
  date.setHours(23, 59, 59, 999);
  return date.toISOString();
}

function habitDays(startedOn: string): number {
  const start = new Date(`${startedOn}T12:00:00`);
  const today = new Date();
  const startDay = new Date(start.getFullYear(), start.getMonth(), start.getDate()).getTime();
  const todayDay = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  return Math.max(1, Math.floor((todayDay - startDay) / 86_400_000) + 1);
}

function SummaryMetric({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: string;
}) {
  return (
    <div className="rounded-xl border border-zinc-200 bg-zinc-50/70 p-3">
      <div className="text-xs font-medium uppercase tracking-wide text-zinc-500">{label}</div>
      <div
        className={`mt-1 font-mono text-xl font-semibold tabular-nums ${tone ?? 'text-zinc-900'}`}
      >
        {value}
      </div>
      {hint ? <div className="mt-1 text-xs text-zinc-500">{hint}</div> : null}
    </div>
  );
}

export function DashboardPage() {
  const queryClient = useQueryClient();
  const [taskDrawer, setTaskDrawer] = useState<{
    task: Task;
    startWithDelete?: boolean;
  } | null>(null);
  const [habitForm, setHabitForm] = useState<{ habit?: Habit } | null>(null);
  const [habitName, setHabitName] = useState('');
  const [habitStartedOn, setHabitStartedOn] = useState(localDateKey);
  const [habitToDelete, setHabitToDelete] = useState<Habit | null>(null);
  const [showArchivedHabits, setShowArchivedHabits] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const monthKey = currentMonthKey();
  const summary = useQuery({
    queryKey: ['dashboard-summary'],
    queryFn: fetchDashboardSummary,
    refetchInterval: 10_000,
  });
  const pnl = useQuery({
    queryKey: ['dashboard-pnl'],
    queryFn: fetchDashboardPnl,
    refetchInterval: 30_000,
  });
  const finance = useQuery({
    queryKey: ['dashboard-finance', monthKey],
    queryFn: () => fetchFinanceSummary({ month: monthKey, months: 1 }),
    refetchInterval: 60_000,
  });
  const tasks = useQuery({
    queryKey: ['dashboard-tasks'],
    queryFn: () => fetchTasks({ status: 'open', to: endOfTodayIso(), limit: 50 }),
    refetchInterval: 30_000,
  });
  const habits = useQuery({
    queryKey: ['habits', showArchivedHabits],
    queryFn: () => fetchHabits(showArchivedHabits),
    refetchInterval: 60_000,
  });
  const cryptoFlash = useLiveFlash(Math.max(summary.dataUpdatedAt, pnl.dataUpdatedAt));
  const financeFlash = useLiveFlash(finance.dataUpdatedAt);
  const tasksFlash = useLiveFlash(tasks.dataUpdatedAt);
  const habitsFlash = useLiveFlash(habits.dataUpdatedAt);

  const invalidateTasks = () => {
    void queryClient.invalidateQueries({ queryKey: ['tasks'] });
    void queryClient.invalidateQueries({ queryKey: ['dashboard-tasks'] });
  };
  const invalidateHabits = () => {
    void queryClient.invalidateQueries({ queryKey: ['habits'] });
  };

  const statusMutation = useMutation({
    mutationFn: (task: Task) =>
      updateTask(task.id, { status: task.status === 'done' ? 'open' : 'done' }),
    onSuccess: () => {
      setError(null);
      invalidateTasks();
    },
    onError: (err) => setError(toRussianError(err, 'Не удалось изменить задачу')),
  });
  const saveHabit = useMutation({
    mutationFn: () => {
      const name = habitName.trim();
      if (!name || !habitStartedOn) throw new Error('Заполните название и дату');
      if (habitForm?.habit) {
        return updateHabit(habitForm.habit.id, { name, startedOn: habitStartedOn });
      }
      return createHabit({ name, startedOn: habitStartedOn });
    },
    onSuccess: () => {
      setHabitForm(null);
      setError(null);
      invalidateHabits();
    },
    onError: (err) => setError(toRussianError(err, 'Не удалось сохранить привычку')),
  });
  const resetHabit = useMutation({
    mutationFn: (habit: Habit) => updateHabit(habit.id, { startedOn: localDateKey() }),
    onSuccess: () => {
      setError(null);
      invalidateHabits();
    },
    onError: (err) => setError(toRussianError(err, 'Не удалось сбросить привычку')),
  });
  const archiveHabit = useMutation({
    mutationFn: (habit: Habit) => updateHabit(habit.id, { archived: true }),
    onSuccess: () => {
      setHabitToDelete(null);
      setError(null);
      invalidateHabits();
    },
    onError: (err) => setError(toRussianError(err, 'Не удалось удалить привычку')),
  });
  const restoreHabit = useMutation({
    mutationFn: (habit: Habit) => updateHabit(habit.id, { archived: false }),
    onSuccess: () => {
      setError(null);
      invalidateHabits();
    },
    onError: (err) => setError(toRussianError(err, 'Не удалось восстановить привычку')),
  });

  function openHabit(habit?: Habit) {
    setHabitForm({ habit });
    setHabitName(habit?.name ?? '');
    setHabitStartedOn(habit?.startedOn ?? localDateKey());
    setError(null);
  }

  const monthPnl = pnl.data?.months.find((month) => month.month === monthKey)?.totalUsd ?? '0.00';
  const elapsedDays = Math.max(1, new Date().getDate());
  const avgIncome = finance.data
    ? new Decimal(finance.data.incomeBase).div(elapsedDays).toFixed(2)
    : null;
  const avgExpense = finance.data
    ? new Decimal(finance.data.expenseBase).div(elapsedDays).toFixed(2)
    : null;
  const taskRows = tasks.data?.data ?? [];
  const habitRows = habits.data?.data ?? [];
  const visibleHabits = habitRows.filter((habit) =>
    showArchivedHabits ? Boolean(habit.archivedAt) : !habit.archivedAt,
  );
  const hasCriticalError =
    summary.isError || pnl.isError || finance.isError || habits.isError || tasks.isError;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Дашборд"
        subtitle="Крипта, финансы, задачи и привычки в одном месте."
        actions={
          <Button variant="secondary" asChild>
            <Link to="/statistics">Статистика</Link>
          </Button>
        }
      />

      {hasCriticalError ? (
        <ErrorState
          message={toRussianError(
            summary.error ?? pnl.error ?? finance.error ?? habits.error ?? tasks.error,
            'Не удалось загрузить дашборд',
          )}
          onRetry={() => {
            void summary.refetch();
            void pnl.refetch();
            void finance.refetch();
            void tasks.refetch();
            void habits.refetch();
          }}
        />
      ) : null}

      {summary.isPending ? <LoadingRows rows={4} /> : null}

      <div className="grid gap-4 xl:grid-cols-2">
        <Card className={cryptoFlash ? 'live-flash' : ''}>
          <div className="flex items-start justify-between gap-3">
            <div>
              <CardTitle>Крипта</CardTitle>
              <CardDescription>Ключевые показатели портфеля.</CardDescription>
            </div>
            <Button variant="ghost" className="h-8 px-3 text-xs" asChild>
              <Link to="/portfolio">Портфель</Link>
            </Button>
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <SummaryMetric
              label="Чистая прибыль за месяц"
              value={pnl.isPending ? '—' : formatSignedUsd(monthPnl)}
              hint="Net P&L из Статистики"
              tone={pnl.isPending ? undefined : pnlTone(monthPnl)}
            />
            <SummaryMetric
              label="Плюс в нереализованном"
              value={formatUsd(summary.data?.positiveUnrealizedUsd)}
              hint="Положительные открытые позиции"
              tone="text-emerald-700"
            />
            <SummaryMetric
              label="Минус в нереализованном"
              value={formatUsd(summary.data?.negativeUnrealizedUsd)}
              hint="Отрицательные открытые позиции"
              tone="text-red-700"
            />
            <SummaryMetric
              label="Капитал"
              value={formatUsd(summary.data?.equityUsd)}
              hint={`Кэш ${formatUsd(summary.data?.cashUsd)}`}
            />
          </div>
        </Card>

        <Card className={financeFlash ? 'live-flash' : ''}>
          <div className="flex items-start justify-between gap-3">
            <div>
              <CardTitle>Финансы</CardTitle>
              <CardDescription>Текущий месяц в BYN.</CardDescription>
            </div>
            <Button variant="ghost" className="h-8 px-3 text-xs" asChild>
              <Link to="/finance">Финансы</Link>
            </Button>
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <SummaryMetric
              label="Средний расход в день"
              value={finance.data ? formatByn(avgExpense) : '—'}
              hint={`${elapsedDays} дн. месяца`}
              tone="text-red-700"
            />
            <SummaryMetric
              label="Средний доход в день"
              value={finance.data ? formatByn(avgIncome) : '—'}
              hint={`${elapsedDays} дн. месяца`}
              tone="text-emerald-700"
            />
            <SummaryMetric
              label="Доходы за месяц"
              value={formatByn(finance.data?.incomeBase)}
              hint={monthKey}
              tone="text-emerald-700"
            />
            <SummaryMetric
              label="Расходы за месяц"
              value={formatByn(finance.data?.expenseBase)}
              hint={monthKey}
              tone="text-red-700"
            />
          </div>
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.25fr_0.75fr]">
        <Card className={tasksFlash ? 'live-flash' : ''}>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <CardTitle>Задачи на сегодня</CardTitle>
              <CardDescription>
                Открытые задачи со сроком до конца сегодняшнего дня, включая просроченные.
              </CardDescription>
            </div>
            <Button variant="ghost" className="h-8 px-3 text-xs" asChild>
              <Link to="/tasks">Все задачи</Link>
            </Button>
          </div>
          <div className="mt-4 space-y-2">
            {tasks.isPending ? (
              <div className="h-16 animate-pulse rounded-xl bg-zinc-100" />
            ) : taskRows.length === 0 ? (
              <p className="rounded-xl border border-dashed border-zinc-200 p-4 text-sm text-zinc-500">
                На сегодня задач нет.
              </p>
            ) : (
              taskRows.map((task) => (
                <TaskCompactRow
                  key={task.id}
                  task={task}
                  now={new Date()}
                  onOpen={() => setTaskDrawer({ task })}
                  onToggleStatus={() => statusMutation.mutate(task)}
                  onDelete={() => setTaskDrawer({ task, startWithDelete: true })}
                  busy={statusMutation.isPending}
                />
              ))
            )}
          </div>
        </Card>

        <Card className={habitsFlash ? 'live-flash' : ''}>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <CardTitle>Без вредных привычек</CardTitle>
              <CardDescription>
                {showArchivedHabits
                  ? 'Архивные привычки. Восстановление возвращает счётчик.'
                  : 'Дни с указанной даты. Дата меняется при сбросе.'}
              </CardDescription>
            </div>
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                className="h-8 px-2 text-xs"
                onClick={() => setShowArchivedHabits((value) => !value)}
              >
                {showArchivedHabits ? 'Активные' : 'Архив'}
              </Button>
              {showArchivedHabits ? null : (
                <Button className="h-8 px-3 text-xs" onClick={() => openHabit()}>
                  Добавить
                </Button>
              )}
            </div>
          </div>
          <div className="mt-4 space-y-2">
            {habits.isPending ? (
              <div className="h-16 animate-pulse rounded-xl bg-zinc-100" />
            ) : visibleHabits.length === 0 ? (
              <p className="rounded-xl border border-dashed border-zinc-200 p-4 text-sm text-zinc-500">
                {showArchivedHabits
                  ? 'Архив пуст.'
                  : 'Добавьте привычку и дату начала воздержания.'}
              </p>
            ) : (
              visibleHabits.map((habit) => (
                <div
                  key={habit.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-zinc-200 bg-zinc-50/70 p-3"
                >
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold text-zinc-900">{habit.name}</div>
                    <div className="mt-1 flex items-center gap-2 text-xs text-zinc-500">
                      {habit.archivedAt ? (
                        <Badge tone="neutral">Архив</Badge>
                      ) : (
                        <Badge tone="success">{habitDays(habit.startedOn)} дн.</Badge>
                      )}
                      <span>с {habit.startedOn.split('-').reverse().join('.')}</span>
                    </div>
                  </div>
                  {habit.archivedAt ? (
                    <div className="flex items-center gap-1">
                      <Button
                        variant="ghost"
                        className="h-8 px-2 text-xs"
                        onClick={() => openHabit(habit)}
                      >
                        Изменить
                      </Button>
                      <Button
                        variant="secondary"
                        className="h-8 px-3 text-xs"
                        onClick={() => restoreHabit.mutate(habit)}
                        disabled={restoreHabit.isPending}
                      >
                        Вернуть
                      </Button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-1">
                      <Button
                        variant="ghost"
                        className="h-8 px-2 text-xs"
                        onClick={() => resetHabit.mutate(habit)}
                        disabled={resetHabit.isPending}
                      >
                        Сбросить
                      </Button>
                      <Button
                        variant="ghost"
                        className="h-8 px-2 text-xs"
                        onClick={() => openHabit(habit)}
                      >
                        Изменить
                      </Button>
                      <Button
                        variant="ghost"
                        className="h-8 w-8 p-0 text-zinc-400 hover:text-red-700"
                        aria-label={`Удалить привычку ${habit.name}`}
                        onClick={() => setHabitToDelete(habit)}
                      >
                        ✕
                      </Button>
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        </Card>
      </div>

      {error ? (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      ) : null}

      <Dialog
        open={Boolean(habitForm)}
        onClose={() => setHabitForm(null)}
        title={habitForm?.habit ? 'Изменить привычку' : 'Новая привычка'}
        description="Название и дата начала воздержания. Изменение даты сбрасывает счётчик."
        footer={
          <>
            <Button variant="ghost" onClick={() => setHabitForm(null)}>
              Отмена
            </Button>
            <Button
              onClick={() => saveHabit.mutate()}
              disabled={saveHabit.isPending || !habitName.trim() || !habitStartedOn}
            >
              {saveHabit.isPending ? 'Сохраняю…' : 'Сохранить'}
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <label className="block text-sm text-zinc-600">
            Название
            <Input
              className="mt-1"
              value={habitName}
              onChange={(event) => setHabitName(event.target.value)}
              placeholder="Без сахара, без алкоголя…"
            />
          </label>
          <label className="block text-sm text-zinc-600">
            Дата начала воздержания
            <Input
              className="mt-1"
              type="date"
              value={habitStartedOn}
              max={localDateKey()}
              onChange={(event) => setHabitStartedOn(event.target.value)}
            />
          </label>
        </div>
      </Dialog>

      <ConfirmDialog
        open={Boolean(habitToDelete)}
        title="Удалить привычку?"
        description="Привычка переместится в архив и не будет отображаться на дашборде."
        busy={archiveHabit.isPending}
        onConfirm={() => {
          if (habitToDelete) archiveHabit.mutate(habitToDelete);
        }}
        onCancel={() => setHabitToDelete(null)}
      />

      {taskDrawer ? (
        <TaskDialog
          task={taskDrawer.task}
          startWithDelete={taskDrawer.startWithDelete}
          onClose={() => setTaskDrawer(null)}
          onSaved={invalidateTasks}
          onDeleted={() => {
            invalidateTasks();
            setTaskDrawer(null);
          }}
        />
      ) : null}
    </div>
  );
}

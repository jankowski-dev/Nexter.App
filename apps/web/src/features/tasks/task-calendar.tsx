import { Button } from '@/components/ui/button';
import type { Task } from '@nexter/contracts';
import { isTaskOverdue } from '@/lib/tasks';
import { useState } from 'react';

const WEEKDAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
const MAX_VISIBLE = 4;

function dateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function monthTitle(date: Date): string {
  return date.toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' });
}

function taskTone(task: Task, now: Date): string {
  if (task.status === 'done') return 'border-emerald-300 bg-emerald-50 text-emerald-800';
  if (task.status === 'cancelled') return 'border-zinc-200 bg-zinc-50 text-zinc-500';
  if (isTaskOverdue(task, now)) return 'border-red-300 bg-red-50 text-red-800';
  return 'border-sky-300 bg-sky-50 text-sky-800';
}

export function TaskCalendar({
  month,
  tasks,
  onPrev,
  onNext,
  onToday,
  onOpen,
  onCreate,
  onMove,
  busy,
}: {
  month: Date;
  tasks: Task[];
  onPrev: () => void;
  onNext: () => void;
  onToday: () => void;
  onOpen: (task: Task) => void;
  onCreate: (date: string) => void;
  onMove: (task: Task, date: string) => void;
  busy: boolean;
}) {
  const [dragOver, setDragOver] = useState<string | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);

  const year = month.getFullYear();
  const monthIndex = month.getMonth();
  const firstDay = new Date(year, monthIndex, 1);
  const offset = (firstDay.getDay() + 6) % 7;
  const daysInMonth = new Date(year, monthIndex + 1, 0).getDate();
  const cells = Math.ceil((offset + daysInMonth) / 7) * 7;
  const todayKey = dateKey(new Date());
  const now = new Date();

  const byDate = new Map<string, Task[]>();
  for (const task of tasks) {
    if (!task.dueAt) continue;
    const key = dateKey(new Date(task.dueAt));
    const list = byDate.get(key) ?? [];
    list.push(task);
    byDate.set(key, list);
  }

  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Button variant="secondary" onClick={onPrev} aria-label="Предыдущий месяц">
            ←
          </Button>
          <Button variant="secondary" onClick={onToday}>
            Сегодня
          </Button>
          <Button variant="secondary" onClick={onNext} aria-label="Следующий месяц">
            →
          </Button>
        </div>
        <div className="text-lg font-semibold capitalize text-zinc-900">{monthTitle(month)}</div>
      </div>

      <div className="mt-3 flex flex-wrap gap-3 text-xs text-zinc-500">
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-sky-400" />
          Активные
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-emerald-500" />
          Выполненные
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-red-500" />
          Просроченные
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-zinc-400" />
          Отменённые
        </span>
      </div>

      <div className="mt-4 grid grid-cols-7 border-l border-t border-zinc-200">
        {WEEKDAYS.map((day) => (
          <div
            key={day}
            className="border-b border-r border-zinc-200 bg-zinc-50 px-2 py-1.5 text-center text-xs font-medium text-zinc-500"
          >
            {day}
          </div>
        ))}
        {Array.from({ length: cells }, (_, index) => {
          const dayNumber = index - offset + 1;
          const inMonth = dayNumber >= 1 && dayNumber <= daysInMonth;
          const date = inMonth ? new Date(year, monthIndex, dayNumber) : null;
          const key = date ? dateKey(date) : null;
          const dayTasks = key ? (byDate.get(key) ?? []) : [];
          const isToday = key === todayKey;

          return (
            <div
              key={index}
              data-date={key ?? undefined}
              className={`min-h-28 border-b border-r border-zinc-200 p-1.5 align-top ${
                inMonth ? 'bg-white' : 'bg-zinc-50/60'
              } ${dragOver === key ? 'bg-emerald-50' : ''}`}
              onDragOver={(event) => {
                if (!key || !inMonth) return;
                event.preventDefault();
                setDragOver(key);
              }}
              onDragLeave={() => setDragOver(null)}
              onDrop={(event) => {
                if (!key || !inMonth) return;
                event.preventDefault();
                setDragOver(null);
                const taskId = event.dataTransfer.getData('text/task-id');
                const task = tasks.find((item) => item.id === taskId);
                if (task) onMove(task, key);
              }}
            >
              {inMonth && key ? (
                <>
                  <div className="flex items-center justify-between gap-1">
                    <span
                      className={`flex h-6 min-w-6 items-center justify-center rounded-full px-1 text-xs ${
                        isToday ? 'bg-emerald-700 font-semibold text-white' : 'text-zinc-500'
                      }`}
                    >
                      {dayNumber}
                    </span>
                    <button
                      type="button"
                      aria-label={`Создать задачу на ${key}`}
                      className="rounded px-1 text-sm text-zinc-400 hover:bg-zinc-100 hover:text-zinc-800"
                      onClick={() => onCreate(key)}
                    >
                      +
                    </button>
                  </div>
                  <div className="mt-1 space-y-1">
                    {dayTasks.slice(0, MAX_VISIBLE).map((task) => (
                      <button
                        key={task.id}
                        type="button"
                        draggable
                        data-task-id={task.id}
                        title={`${task.title}${task.recurrence ? ' · повтор' : ''}`}
                        className={`w-full truncate rounded border px-1.5 py-1 text-left text-xs ${taskTone(
                          task,
                          now,
                        )} ${draggingId === task.id ? 'opacity-50' : ''} ${
                          busy ? 'cursor-wait' : 'cursor-grab'
                        }`}
                        onClick={() => onOpen(task)}
                        onDragStart={(event) => {
                          event.dataTransfer.setData('text/task-id', task.id);
                          event.dataTransfer.effectAllowed = 'move';
                          setDraggingId(task.id);
                        }}
                        onDragEnd={() => setDraggingId(null)}
                      >
                        {task.status === 'done' ? '✓ ' : task.recurrence ? '↻ ' : ''}
                        {task.recurrence && task.status === 'done' ? '↻ ' : ''}
                        {task.title}
                      </button>
                    ))}
                    {dayTasks.length > MAX_VISIBLE ? (
                      <div className="px-1 text-xs text-zinc-500">
                        +{dayTasks.length - MAX_VISIBLE} ещё
                      </div>
                    ) : null}
                  </div>
                </>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

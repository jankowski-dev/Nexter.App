import { useEffect, useMemo, useState } from 'react';
import { CalendarIcon } from './icons';

const WEEKDAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];

export function dateKey(year: number, month: number, day: number): string {
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function parseDateKey(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Monday-first month matrix; null marks a leading/trailing empty cell. */
export function monthMatrix(year: number, month: number): Array<Array<number | null>> {
  const first = new Date(year, month, 1);
  const offset = (first.getDay() + 6) % 7;
  const days = new Date(year, month + 1, 0).getDate();
  const cells: Array<number | null> = [
    ...Array.from({ length: offset }, () => null),
    ...Array.from({ length: days }, (_, index) => index + 1),
  ];
  while (cells.length % 7 !== 0) cells.push(null);
  const weeks: Array<Array<number | null>> = [];
  for (let index = 0; index < cells.length; index += 7) {
    weeks.push(cells.slice(index, index + 7));
  }
  return weeks;
}

export function monthKey(year: number, month: number): string {
  return `${year}-${String(month + 1).padStart(2, '0')}`;
}

export function parseMonthKey(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})$/.exec(value);
  if (!match) return null;
  const month = Number(match[2]);
  if (month < 1 || month > 12) return null;
  return new Date(Number(match[1]), month - 1, 1);
}

export function MonthPicker({
  value,
  onChange,
  label = 'Месяц',
  disabled = false,
}: {
  value: string;
  onChange: (value: string) => void;
  label?: string;
  disabled?: boolean;
}) {
  const selected = parseMonthKey(value);
  const [open, setOpen] = useState(false);
  const [year, setYear] = useState(() => selected?.getFullYear() ?? new Date().getFullYear());

  useEffect(() => {
    if (selected) setYear(selected.getFullYear());
  }, [value]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open]);

  const months = Array.from({ length: 12 }, (_, index) =>
    new Intl.DateTimeFormat('ru-RU', { month: 'short' }).format(new Date(year, index, 1)),
  );
  const display = selected
    ? new Intl.DateTimeFormat('ru-RU', { month: 'long', year: 'numeric' }).format(selected)
    : 'Выберите месяц';

  return (
    <div className="relative">
      <button
        type="button"
        aria-label={label}
        aria-haspopup="dialog"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen((current) => !current)}
        className="flex h-10 w-full items-center justify-between rounded-xl border border-zinc-200 bg-white px-3 text-left text-sm capitalize text-zinc-800 transition hover:border-zinc-300 disabled:cursor-not-allowed disabled:bg-zinc-50 disabled:text-zinc-400"
      >
        <span className={value ? 'capitalize' : 'text-zinc-400'}>{display}</span>
        <CalendarIcon className="h-4 w-4 text-zinc-500" />
      </button>

      {open ? (
        <div
          role="dialog"
          aria-label="Выбор месяца"
          className="absolute left-0 top-full z-50 mt-2 w-[280px] rounded-xl border border-zinc-200 bg-white p-3 shadow-xl"
        >
          <div className="mb-2 flex items-center justify-between gap-2">
            <button
              type="button"
              aria-label="Предыдущий год"
              onClick={() => setYear((current) => current - 1)}
              className="flex h-7 w-7 items-center justify-center rounded-lg text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900"
            >
              ‹
            </button>
            <div className="text-sm font-medium text-zinc-800">{year}</div>
            <button
              type="button"
              aria-label="Следующий год"
              onClick={() => setYear((current) => current + 1)}
              className="flex h-7 w-7 items-center justify-center rounded-lg text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900"
            >
              ›
            </button>
          </div>

          <div className="grid grid-cols-3 gap-1">
            {months.map((month, index) => {
              const key = monthKey(year, index);
              const isSelected = key === value;
              return (
                <button
                  key={key}
                  type="button"
                  aria-label={key}
                  aria-pressed={isSelected}
                  onClick={() => {
                    onChange(key);
                    setOpen(false);
                  }}
                  className={`flex h-9 items-center justify-center rounded-lg text-xs capitalize transition ${
                    isSelected
                      ? 'bg-emerald-600 font-semibold text-white'
                      : 'text-zinc-700 hover:bg-zinc-100'
                  }`}
                >
                  {month}
                </button>
              );
            })}
          </div>

          <div className="mt-3 flex items-center justify-between border-t border-zinc-100 pt-2">
            <button
              type="button"
              onClick={() => {
                const now = new Date();
                onChange(monthKey(now.getFullYear(), now.getMonth()));
                setOpen(false);
              }}
              className="text-xs font-medium text-emerald-700 hover:text-emerald-800"
            >
              Текущий месяц
            </button>
            {value ? (
              <button
                type="button"
                onClick={() => {
                  onChange('');
                  setOpen(false);
                }}
                className="text-xs text-zinc-500 hover:text-zinc-800"
              >
                Очистить
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function DatePicker({
  value,
  onChange,
  label = 'Срок',
  disabled = false,
}: {
  value: string;
  onChange: (value: string) => void;
  label?: string;
  disabled?: boolean;
}) {
  const selected = parseDateKey(value);
  const [open, setOpen] = useState(false);
  const [view, setView] = useState(() => selected ?? new Date());

  useEffect(() => {
    if (selected) setView(selected);
  }, [value]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open]);

  const weeks = useMemo(() => monthMatrix(view.getFullYear(), view.getMonth()), [view]);
  const todayKey = dateKey(new Date().getFullYear(), new Date().getMonth(), new Date().getDate());
  const monthLabel = new Intl.DateTimeFormat('ru-RU', {
    month: 'long',
    year: 'numeric',
  }).format(view);
  const display = selected
    ? new Intl.DateTimeFormat('ru-RU', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
      }).format(selected)
    : 'Выберите дату';

  return (
    <div className="relative">
      <button
        type="button"
        aria-label={label}
        aria-haspopup="dialog"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen((current) => !current)}
        className="flex h-10 w-full items-center justify-between rounded-xl border border-zinc-200 bg-white px-3 text-left text-sm text-zinc-800 transition hover:border-zinc-300 disabled:cursor-not-allowed disabled:bg-zinc-50 disabled:text-zinc-400"
      >
        <span className={value ? '' : 'text-zinc-400'}>{display}</span>
        <CalendarIcon className="h-4 w-4 text-zinc-500" />
      </button>

      {open ? (
        <div
          role="dialog"
          aria-label="Календарь"
          className="absolute left-0 top-full z-50 mt-2 w-[280px] rounded-xl border border-zinc-200 bg-white p-3 shadow-xl"
        >
          <div className="mb-2 flex items-center justify-between gap-2">
            <button
              type="button"
              aria-label="Предыдущий месяц"
              onClick={() => setView(new Date(view.getFullYear(), view.getMonth() - 1, 1))}
              className="flex h-7 w-7 items-center justify-center rounded-lg text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900"
            >
              ‹
            </button>
            <div className="text-sm font-medium capitalize text-zinc-800">{monthLabel}</div>
            <button
              type="button"
              aria-label="Следующий месяц"
              onClick={() => setView(new Date(view.getFullYear(), view.getMonth() + 1, 1))}
              className="flex h-7 w-7 items-center justify-center rounded-lg text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900"
            >
              ›
            </button>
          </div>

          <div className="grid grid-cols-7 gap-1 text-center text-[10px] font-medium uppercase text-zinc-400">
            {WEEKDAYS.map((day) => (
              <div key={day} className="py-1">
                {day}
              </div>
            ))}
          </div>
          <div className="mt-1 space-y-1">
            {weeks.map((week, weekIndex) => (
              <div key={weekIndex} className="grid grid-cols-7 gap-1">
                {week.map((day, dayIndex) => {
                  if (day === null) return <div key={`empty-${dayIndex}`} />;
                  const key = dateKey(view.getFullYear(), view.getMonth(), day);
                  const isSelected = key === value;
                  const isToday = key === todayKey;
                  return (
                    <button
                      key={key}
                      type="button"
                      aria-label={key}
                      aria-pressed={isSelected}
                      onClick={() => {
                        onChange(key);
                        setOpen(false);
                      }}
                      className={`flex h-8 items-center justify-center rounded-lg text-xs transition ${
                        isSelected
                          ? 'bg-emerald-600 font-semibold text-white'
                          : isToday
                            ? 'bg-emerald-50 font-semibold text-emerald-700 ring-1 ring-emerald-300'
                            : 'text-zinc-700 hover:bg-zinc-100'
                      }`}
                    >
                      {day}
                    </button>
                  );
                })}
              </div>
            ))}
          </div>

          <div className="mt-3 flex items-center justify-between border-t border-zinc-100 pt-2">
            <button
              type="button"
              onClick={() => {
                const now = new Date();
                onChange(dateKey(now.getFullYear(), now.getMonth(), now.getDate()));
                setOpen(false);
              }}
              className="text-xs font-medium text-emerald-700 hover:text-emerald-800"
            >
              Сегодня
            </button>
            {value ? (
              <button
                type="button"
                onClick={() => {
                  onChange('');
                  setOpen(false);
                }}
                className="text-xs text-zinc-500 hover:text-zinc-800"
              >
                Очистить
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

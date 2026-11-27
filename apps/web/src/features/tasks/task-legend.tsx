export function TaskStatusLegend() {
  return (
    <div className="flex flex-wrap items-center gap-3 text-xs text-zinc-500">
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
  );
}

import type { AllocationSlice } from '@nexter/contracts';
import { formatUsd } from '@/lib/format';

const colors = [
  'bg-emerald-500',
  'bg-sky-500',
  'bg-violet-500',
  'bg-amber-500',
  'bg-rose-500',
  'bg-teal-500',
  'bg-indigo-500',
  'bg-orange-500',
];

export function AllocationBar({ slices }: { slices: AllocationSlice[] }) {
  if (slices.length === 0) {
    return <div className="py-8 text-center text-sm text-zinc-500">Нет данных</div>;
  }

  return (
    <div className="space-y-3">
      <div className="flex h-4 overflow-hidden rounded-full bg-zinc-200">
        {slices.map((slice, index) => (
          <div
            key={slice.key}
            className={colors[index % colors.length]}
            style={{ width: `${Math.max(Number(slice.percent), 0)}%` }}
            title={`${slice.label}: ${slice.percent}%`}
          />
        ))}
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        {slices.map((slice, index) => (
          <div key={slice.key} className="flex items-center gap-2 text-sm">
            <span className={`h-2.5 w-2.5 rounded-full ${colors[index % colors.length]}`} />
            <span className="min-w-0 flex-1 truncate text-zinc-700">{slice.label}</span>
            <span className="font-mono tabular-nums text-zinc-500">
              {formatUsd(slice.valueUsd)}
            </span>
            <span className="w-14 text-right font-mono tabular-nums text-zinc-500">
              {slice.percent}%
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

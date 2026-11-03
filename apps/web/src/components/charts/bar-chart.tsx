import { formatUsdCompact } from '@/lib/format';

export interface BarPoint {
  label: string;
  value: number;
}

export function BarChart({ points, height = 200 }: { points: BarPoint[]; height?: number }) {
  if (points.length === 0) {
    return <div className="py-12 text-center text-sm text-zinc-500">Нет данных</div>;
  }

  const maxAbs = Math.max(...points.map((point) => Math.abs(point.value)), 1);
  const zeroLine = height / 2;

  return (
    <div className="flex items-end gap-2 overflow-x-auto pt-2" style={{ minHeight: height }}>
      {points.map((point) => {
        const ratio = Math.abs(point.value) / maxAbs;
        const barHeight = Math.max(2, ratio * (height / 2 - 20));
        const positive = point.value >= 0;
        return (
          <div
            key={point.label}
            className="flex min-w-10 flex-1 flex-col items-center justify-end gap-1"
            style={{ height }}
          >
            <span className="text-[10px] text-zinc-500">
              {formatUsdCompact(String(point.value))}
            </span>
            <div
              className={
                positive ? 'w-full rounded-t bg-emerald-500/70' : 'w-full rounded-b bg-red-500/70'
              }
              style={{ height: barHeight, marginTop: positive ? zeroLine - barHeight : 0 }}
            />
            <span className="text-[10px] text-zinc-500">{point.label}</span>
          </div>
        );
      })}
    </div>
  );
}

import { formatUsd, formatUsdCompact } from '@/lib/format';
import { useState } from 'react';

export interface BarPoint {
  label: string;
  value: number;
}

export function BarChart({ points, height = 200 }: { points: BarPoint[]; height?: number }) {
  const [hovered, setHovered] = useState<number | null>(null);

  if (points.length === 0) {
    return <div className="py-12 text-center text-sm text-zinc-500">Нет данных</div>;
  }

  const maxAbs = Math.max(...points.map((point) => Math.abs(point.value)), 1);
  const zeroLine = height / 2;

  return (
    <div className="overflow-x-auto pt-2" style={{ minHeight: height }}>
      <div className="mb-1 h-4 text-center text-xs text-zinc-500">
        {hovered === null
          ? 'Наведите на бар'
          : `${points[hovered]?.label}: ${formatUsd(String(points[hovered]?.value ?? 0))}`}
      </div>
      <div className="mx-auto flex w-full items-end justify-center gap-2">
        {points.map((point, index) => {
          const ratio = Math.abs(point.value) / maxAbs;
          const barHeight = Math.max(2, ratio * (height / 2 - 20));
          const positive = point.value >= 0;
          return (
            <div
              key={point.label}
              className="flex w-12 shrink-0 cursor-default flex-col items-center justify-end gap-1"
              style={{ height }}
              title={`${point.label}: ${formatUsdCompact(String(point.value))}`}
              onMouseEnter={() => setHovered(index)}
              onMouseLeave={() => setHovered(null)}
            >
              <span className="text-[10px] text-zinc-500">
                {formatUsdCompact(String(point.value))}
              </span>
              <div
                className={
                  positive ? 'w-full rounded-t bg-emerald-400' : 'w-full rounded-b bg-red-400'
                }
                style={{ height: barHeight, marginTop: positive ? zeroLine - barHeight : 0 }}
              />
              <span className="text-[10px] text-zinc-500">{point.label}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

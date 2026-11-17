import { formatPrice } from '@/lib/format';
import { useId, useState, type MouseEvent } from 'react';

export interface MiniLinePoint {
  label: string;
  value: number;
}

export function MiniLineChart({
  points,
  height = 80,
  color = '#059669',
}: {
  points: MiniLinePoint[];
  height?: number;
  color?: string;
}) {
  const [hovered, setHovered] = useState<number | null>(null);
  const gradientId = useId().replace(/:/g, '');

  if (points.length === 0) {
    return (
      <div className="flex h-20 items-center justify-center text-[11px] text-zinc-400">
        Нет данных
      </div>
    );
  }

  const width = 260;
  const padding = 6;
  const values = points.map((point) => point.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const step = points.length > 1 ? (width - padding * 2) / (points.length - 1) : 0;
  const coordinates = points.map((point, index) => {
    const x = padding + index * step;
    const y =
      max === min
        ? height / 2
        : height - padding - ((point.value - min) / span) * (height - padding * 2);
    return { x, y };
  });
  const path = coordinates.map((point) => `${point.x},${point.y}`).join(' ');
  const area = `${padding},${height - padding} ${path} ${width - padding},${height - padding}`;
  const hoveredPoint = hovered === null ? null : coordinates[hovered];

  function handleMove(event: MouseEvent<SVGSVGElement>): void {
    const rect = event.currentTarget.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * width;
    let nearest = 0;
    let distance = Number.POSITIVE_INFINITY;

    for (const [index, point] of coordinates.entries()) {
      const candidate = Math.abs(point.x - x);
      if (candidate < distance) {
        nearest = index;
        distance = candidate;
      }
    }

    setHovered(nearest);
  }

  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="h-20 w-full"
        role="img"
        aria-label="График цены за три месяца"
        onMouseMove={handleMove}
        onMouseLeave={() => setHovered(null)}
      >
        <defs>
          <linearGradient id={gradientId} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.22" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
        <polygon points={area} fill={`url(#${gradientId})`} />
        <polyline
          points={path}
          fill="none"
          stroke={color}
          strokeWidth="1.8"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        {hoveredPoint ? (
          <line
            x1={hoveredPoint.x}
            x2={hoveredPoint.x}
            y1={padding}
            y2={height - padding}
            stroke="var(--text-soft)"
            strokeWidth="1"
            strokeDasharray="3 3"
          />
        ) : null}
        {coordinates.map((point, index) => (
          <circle
            key={points[index]?.label ?? index}
            cx={point.x}
            cy={point.y}
            r={hovered === index ? 4 : 2}
            fill={color}
          />
        ))}
      </svg>
      {hovered !== null && points[hovered] && hoveredPoint ? (
        <div
          className="pointer-events-none absolute -top-1 z-10 -translate-x-1/2 rounded-md border border-zinc-200 bg-white px-1.5 py-1 text-[10px] shadow-sm"
          style={{ left: `${(hoveredPoint.x / width) * 100}%` }}
        >
          <div className="font-medium text-zinc-700">{points[hovered]?.label}</div>
          <div className="font-mono text-zinc-600">{formatPrice(points[hovered]?.value ?? 0)}</div>
        </div>
      ) : null}
    </div>
  );
}

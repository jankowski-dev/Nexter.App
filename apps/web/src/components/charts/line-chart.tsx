import { formatUsd, formatUsdCompact } from '@/lib/format';
import { useState, type MouseEvent } from 'react';

export interface LinePoint {
  label: string;
  value: number;
}

export function LineChart({
  points,
  height = 220,
  color = '#059669',
}: {
  points: LinePoint[];
  height?: number;
  color?: string;
}) {
  const [hovered, setHovered] = useState<number | null>(null);

  if (points.length === 0) {
    return <div className="py-12 text-center text-sm text-zinc-500">Нет данных</div>;
  }

  const width = 720;
  const padding = 24;
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
    <div className="space-y-2">
      <div className="relative">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          className="h-auto w-full"
          role="img"
          aria-label="График"
          onMouseMove={handleMove}
          onMouseLeave={() => setHovered(null)}
        >
          <defs>
            <linearGradient id="line-fill" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity="0.24" />
              <stop offset="100%" stopColor={color} stopOpacity="0" />
            </linearGradient>
          </defs>
          {[0, 0.25, 0.5, 0.75, 1].map((ratio) => (
            <line
              key={ratio}
              x1={padding}
              x2={width - padding}
              y1={padding + (height - padding * 2) * ratio}
              y2={padding + (height - padding * 2) * ratio}
              stroke="var(--border)"
              strokeWidth="1"
            />
          ))}
          <polygon points={area} fill="url(#line-fill)" />
          <polyline
            points={path}
            fill="none"
            stroke={color}
            strokeWidth="4"
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
              strokeDasharray="4 4"
            />
          ) : null}
          {coordinates.map((point, index) => (
            <circle
              key={points[index]?.label ?? index}
              cx={point.x}
              cy={point.y}
              r={hovered === index ? 5 : 2.5}
              fill={color}
            >
              <title>
                {points[index]?.label}: {formatUsdCompact(String(points[index]?.value ?? 0))}
              </title>
            </circle>
          ))}
        </svg>
        {hovered !== null && points[hovered] && hoveredPoint ? (
          <div
            className="pointer-events-none absolute top-0 z-10 -translate-x-1/2 rounded-md border border-zinc-200 bg-white px-2 py-1 text-xs shadow-sm"
            style={{ left: `${(hoveredPoint.x / width) * 100}%` }}
          >
            <div className="font-medium text-zinc-800">{points[hovered]?.label}</div>
            <div className="font-mono text-zinc-600">
              {formatUsd(String(points[hovered]?.value ?? 0))}
            </div>
          </div>
        ) : null}
      </div>
      <div className="flex justify-between text-xs text-zinc-500">
        <span>{points[0]?.label}</span>
        <span>{formatUsdCompact(String(max))}</span>
        <span>{points.at(-1)?.label}</span>
      </div>
    </div>
  );
}

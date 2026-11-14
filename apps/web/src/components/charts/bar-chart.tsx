import { formatSignedUsd, formatUsdCompact } from '@/lib/format';
import { useState } from 'react';

export interface BarPoint {
  label: string;
  value: number;
}

const WIDTH = 760;
const HEIGHT = 280;
const PADDING = { top: 24, right: 18, bottom: 42, left: 64 };

function shortLabel(label: string): string {
  return (label.split(' ')[0] ?? label).slice(0, 3);
}

function tickLabel(value: number): string {
  return formatUsdCompact(String(value));
}

export function BarChart({ points, height = HEIGHT }: { points: BarPoint[]; height?: number }) {
  const [hovered, setHovered] = useState<number | null>(null);

  if (points.length === 0) {
    return <div className="py-12 text-center text-sm text-zinc-500">Нет данных</div>;
  }

  const values = points.map((point) => point.value);
  const min = Math.min(0, ...values);
  const max = Math.max(0, ...values);
  const span = max - min || 1;
  const plotWidth = WIDTH - PADDING.left - PADDING.right;
  const plotHeight = height - PADDING.top - PADDING.bottom;
  const zeroY = PADDING.top + ((max - 0) / span) * plotHeight;
  const slot = plotWidth / points.length;
  const barWidth = Math.min(42, slot * 0.54);
  const y = (value: number) => PADDING.top + ((max - value) / span) * plotHeight;

  const ticks = Array.from({ length: 5 }, (_, index) => min + (span * index) / 4);
  const hoveredPoint = hovered === null ? null : points[hovered];

  return (
    <div className="relative">
      <div className="mb-2 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 text-[11px] text-zinc-500">
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-emerald-500" />
            прибыль
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-rose-500" />
            убыток
          </span>
        </div>
        {hoveredPoint ? (
          <div className="rounded-lg border border-zinc-200 bg-white px-2.5 py-1 text-xs shadow-sm">
            <span className="text-zinc-500">{hoveredPoint.label}: </span>
            <span className={hoveredPoint.value >= 0 ? 'text-emerald-700' : 'text-rose-700'}>
              {formatSignedUsd(String(hoveredPoint.value))}
            </span>
          </div>
        ) : (
          <span className="text-[11px] text-zinc-400">Наведите на бар</span>
        )}
      </div>

      <svg
        viewBox={`0 0 ${WIDTH} ${height}`}
        className="h-auto w-full"
        role="img"
        aria-label="Реализованный P&L по месяцам"
        onMouseLeave={() => setHovered(null)}
      >
        <defs>
          <linearGradient id="bar-positive" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="#10b981" stopOpacity="0.95" />
            <stop offset="100%" stopColor="#34d399" stopOpacity="0.35" />
          </linearGradient>
          <linearGradient id="bar-negative" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="#fb7185" stopOpacity="0.35" />
            <stop offset="100%" stopColor="#e11d48" stopOpacity="0.95" />
          </linearGradient>
        </defs>

        {ticks.map((tick) => (
          <g key={tick}>
            <line
              x1={PADDING.left}
              x2={WIDTH - PADDING.right}
              y1={y(tick)}
              y2={y(tick)}
              stroke="var(--border)"
              strokeDasharray="3 5"
              strokeWidth="1"
            />
            <text
              x={PADDING.left - 10}
              y={y(tick) + 3}
              textAnchor="end"
              fontSize="10"
              fill="var(--text-soft)"
            >
              {tickLabel(tick)}
            </text>
          </g>
        ))}

        <line
          x1={PADDING.left}
          x2={WIDTH - PADDING.right}
          y1={zeroY}
          y2={zeroY}
          stroke="var(--text-soft)"
          strokeOpacity="0.55"
          strokeWidth="1"
        />

        {points.map((point, index) => {
          const center = PADDING.left + slot * (index + 0.5);
          const valueY = y(point.value);
          const barY = point.value >= 0 ? valueY : zeroY;
          const barHeight = Math.max(2, Math.abs(zeroY - valueY));
          const active = hovered === index;

          return (
            <g
              key={`${point.label}-${index}`}
              onMouseEnter={() => setHovered(index)}
              onFocus={() => setHovered(index)}
              tabIndex={0}
              role="button"
              aria-label={`${point.label}: ${formatSignedUsd(String(point.value))}`}
              className="outline-none"
            >
              {active ? (
                <rect
                  x={center - slot / 2}
                  y={PADDING.top}
                  width={slot}
                  height={plotHeight}
                  fill="var(--surface-hover)"
                  opacity="0.35"
                  rx="8"
                />
              ) : null}
              <rect
                x={center - barWidth / 2}
                y={barY}
                width={barWidth}
                height={barHeight}
                rx="6"
                fill={point.value >= 0 ? 'url(#bar-positive)' : 'url(#bar-negative)'}
                opacity={hovered === null || active ? 1 : 0.55}
              />
              <text
                x={center}
                y={height - 16}
                textAnchor="middle"
                fontSize="10"
                fill="var(--text-soft)"
              >
                {shortLabel(point.label)}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

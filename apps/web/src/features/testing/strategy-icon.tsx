import type { ReactNode } from 'react';

type Visual = { tile: string; icon: ReactNode };

const visuals: Record<string, Visual> = {
  rocket: {
    tile: 'border-emerald-200 bg-emerald-50 text-emerald-700',
    icon: (
      <>
        <path d="M13.5 5.5c2.8-2.4 5.2-2 5.2-2s.4 2.4-2 5.2l-4.3 4.9-4.8-4.8 4.9-4.3Z" />
        <path d="m8.4 9.4-2.9.7-1.7 2.9 3.1.4M14.6 15.6l-.7 2.9-2.9 1.7-.4-3.1" />
        <circle cx="15.2" cy="7.7" r="1.2" />
      </>
    ),
  },
  refresh: {
    tile: 'border-sky-200 bg-sky-50 text-sky-700',
    icon: (
      <>
        <path d="M4 10a8 8 0 0 1 13.4-4.4L20 8" />
        <path d="M20 4v4h-4M20 14a8 8 0 0 1-13.4 4.4L4 16" />
        <path d="M4 20v-4h4" />
      </>
    ),
  },
  grid: {
    tile: 'border-amber-200 bg-amber-50 text-amber-700',
    icon: (
      <>
        <rect x="3.5" y="3.5" width="7" height="7" rx="1.5" />
        <rect x="13.5" y="3.5" width="7" height="7" rx="1.5" />
        <rect x="3.5" y="13.5" width="7" height="7" rx="1.5" />
        <rect x="13.5" y="13.5" width="7" height="7" rx="1.5" />
      </>
    ),
  },
  trend: {
    tile: 'border-indigo-200 bg-indigo-50 text-indigo-700',
    icon: (
      <>
        <path d="M3.5 17.5 9 12l3.5 3.5L20 7.5" />
        <path d="M15.5 7.5H20v4.5" />
      </>
    ),
  },
  layers: {
    tile: 'border-red-200 bg-red-50 text-red-700',
    icon: (
      <>
        <path d="m12 3.5 8 4.5-8 4.5-8-4.5 8-4.5Z" />
        <path d="m4 12 8 4.5 8-4.5M4 16l8 4.5 8-4.5" />
      </>
    ),
  },
  shield: {
    tile: 'border-violet-200 bg-violet-50 text-violet-700',
    icon: (
      <>
        <path d="M12 3.5 19 6v5.2c0 4.4-2.8 7.6-7 9.3-4.2-1.7-7-4.9-7-9.3V6l7-2.5Z" />
        <path d="m9 12 2 2 4-4.5" />
      </>
    ),
  },
  limit: {
    tile: 'border-lime-200 bg-lime-50 text-lime-700',
    icon: (
      <>
        <path d="M4 12h16" />
        <path d="M7 9v6M17 9v6" />
        <path d="M12 4v5M12 15v5" />
        <circle cx="12" cy="12" r="2.2" />
      </>
    ),
  },
  channel: {
    tile: 'border-teal-200 bg-teal-50 text-teal-700',
    icon: (
      <>
        <path d="M4 7.5h16M4 16.5h16" />
        <path d="M6 12h9M15 12l-2.5-2.5M15 12l-2.5 2.5" />
        <path d="M18.5 9.5 21 12l-2.5 2.5" />
      </>
    ),
  },
  bands: {
    tile: 'border-cyan-200 bg-cyan-50 text-cyan-700',
    icon: (
      <>
        <path d="M4 5c4 2 12 2 16 0M4 19c4-2 12-2 16 0" />
        <path d="M4 12h16" />
        <path d="m8 14.5-2-2 2-2M16 9.5l2 2-2 2" />
      </>
    ),
  },
  squeeze: {
    tile: 'border-fuchsia-200 bg-fuchsia-50 text-fuchsia-700',
    icon: (
      <>
        <path d="M4 6h5M15 6h5M4 18h5M15 18h5" />
        <path d="m10 9 2 3-2 3M14 9l-2 3 2 3" />
        <path d="M12 3v3M12 18v3" />
      </>
    ),
  },
  reversal: {
    tile: 'border-orange-200 bg-orange-50 text-orange-700',
    icon: (
      <>
        <path d="M6 5v7a4 4 0 0 0 4 4h9" />
        <path d="m15.5 12.5 3.5 3.5-3.5 3.5" />
        <path d="M4.5 8.5 6 12l3.5-1.5" />
      </>
    ),
  },
  beaker: {
    tile: 'border-zinc-200 bg-zinc-100 text-zinc-700',
    icon: (
      <>
        <path d="M9 3.5h6M10 3.5v5l-5.2 8.1A2.5 2.5 0 0 0 6.9 20h10.2a2.5 2.5 0 0 0 2.1-3.4L14 8.5v-5" />
        <path d="M7.5 15.5h9" />
      </>
    ),
  },
};

export function StrategyIcon({
  icon,
  className = 'h-10 w-10',
}: {
  icon: string;
  className?: string;
}) {
  const visual = visuals[icon] ?? visuals.beaker;
  return (
    <span
      aria-hidden="true"
      className={`inline-flex shrink-0 items-center justify-center rounded-xl border ${visual.tile} ${className}`}
    >
      <svg
        viewBox="0 0 24 24"
        className="h-[55%] w-[55%]"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {visual.icon}
      </svg>
    </span>
  );
}

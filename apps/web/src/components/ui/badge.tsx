import { clsx } from 'clsx';
import type { ReactNode } from 'react';

type Tone = 'neutral' | 'success' | 'warning' | 'danger' | 'info';

const tones: Record<Tone, string> = {
  neutral: 'border-zinc-700 bg-zinc-800/60 text-zinc-300',
  success: 'border-emerald-800/60 bg-emerald-950/30 text-emerald-200',
  warning: 'border-amber-800/60 bg-amber-950/30 text-amber-200',
  danger: 'border-red-800/60 bg-red-950/30 text-red-200',
  info: 'border-sky-800/60 bg-sky-950/30 text-sky-200',
};

export function Badge({
  tone = 'neutral',
  children,
  className,
}: {
  tone?: Tone;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={clsx(
        'inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium',
        tones[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

import { Card, CardDescription, CardTitle } from '@/components/ui/card';
import { LiveValue } from '@/components/ui/live-value';
import { NavIcon, type NavIconName } from '@/components/nav-icon';

export type StatTone = 'emerald' | 'sky' | 'amber' | 'violet' | 'rose';

export const statTones: Record<
  StatTone,
  { card: string; title: string; icon: string; value: string; description: string }
> = {
  emerald: {
    card: 'tone-surface tone-surface-emerald',
    title: 'text-emerald-800',
    icon: 'bg-emerald-100 text-emerald-700',
    value: 'text-emerald-950',
    description: 'text-emerald-800/60',
  },
  sky: {
    card: 'tone-surface tone-surface-sky',
    title: 'text-sky-800',
    icon: 'bg-sky-100 text-sky-700',
    value: 'text-sky-950',
    description: 'text-sky-800/60',
  },
  amber: {
    card: 'tone-surface tone-surface-amber',
    title: 'text-amber-800',
    icon: 'bg-amber-100 text-amber-700',
    value: 'text-amber-950',
    description: 'text-amber-800/60',
  },
  violet: {
    card: 'tone-surface tone-surface-violet',
    title: 'text-violet-800',
    icon: 'bg-violet-100 text-violet-700',
    value: 'text-violet-950',
    description: 'text-violet-800/60',
  },
  rose: {
    card: 'tone-surface tone-surface-rose',
    title: 'text-rose-800',
    icon: 'bg-rose-100 text-rose-700',
    value: 'text-rose-950',
    description: 'text-rose-800/60',
  },
};

export function StatCard({
  title,
  value,
  description,
  icon,
  tone = 'emerald',
  live = false,
  size = 'default',
  className,
}: {
  title: string;
  value: string;
  description?: string;
  icon: NavIconName;
  tone?: StatTone;
  live?: boolean;
  size?: 'default' | 'compact';
  className?: string;
}) {
  const styles = statTones[tone];
  const compact = size === 'compact';

  return (
    <Card
      className={`relative overflow-hidden ${compact ? 'p-4' : ''} ${styles.card} ${className ?? ''}`}
    >
      <div className="flex items-start justify-between gap-3">
        <CardTitle className={`${styles.title} ${compact ? 'text-xs' : ''}`}>{title}</CardTitle>
        <span
          className={`inline-flex shrink-0 items-center justify-center rounded-xl ${
            compact ? 'h-7 w-7' : 'h-8 w-8'
          } ${styles.icon}`}
        >
          <NavIcon name={icon} className={compact ? 'h-3.5 w-3.5' : 'h-4 w-4'} />
        </span>
      </div>
      <div
        className={`mt-1 font-mono font-semibold tracking-tight tabular-nums ${
          compact ? 'text-2xl' : 'text-3xl'
        } ${styles.value}`}
      >
        {live ? <LiveValue value={value}>{value}</LiveValue> : value}
      </div>
      {description ? (
        <CardDescription
          className={`${styles.description} ${compact ? 'mt-1 text-[11px] leading-4' : ''}`}
        >
          {description}
        </CardDescription>
      ) : null}
    </Card>
  );
}

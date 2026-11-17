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
  className,
}: {
  title: string;
  value: string;
  description?: string;
  icon: NavIconName;
  tone?: StatTone;
  live?: boolean;
  className?: string;
}) {
  const styles = statTones[tone];

  return (
    <Card className={`relative overflow-hidden ${styles.card} ${className ?? ''}`}>
      <div className="flex items-start justify-between gap-3">
        <CardTitle className={styles.title}>{title}</CardTitle>
        <span
          className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-xl ${styles.icon}`}
        >
          <NavIcon name={icon} className="h-4 w-4" />
        </span>
      </div>
      <div
        className={`mt-1 font-mono text-3xl font-semibold tracking-tight tabular-nums ${styles.value}`}
      >
        {live ? <LiveValue value={value}>{value}</LiveValue> : value}
      </div>
      {description ? (
        <CardDescription className={styles.description}>{description}</CardDescription>
      ) : null}
    </Card>
  );
}

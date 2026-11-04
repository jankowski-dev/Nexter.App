import { cn } from '@/lib/utils';
import type { HTMLAttributes } from 'react';

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('rounded-xl border border-zinc-200 bg-white p-5 shadow-sm', className)}
      {...props}
    />
  );
}

export function CardHeader({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn('mb-3 flex items-start justify-between gap-3', className)} {...props} />
  );
}

export function CardTitle({ className, ...props }: HTMLAttributes<HTMLHeadingElement>) {
  return <h2 className={cn('text-sm font-medium text-zinc-600', className)} {...props} />;
}

export function CardValue({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('font-mono text-2xl font-semibold tabular-nums text-zinc-900', className)}
      {...props}
    />
  );
}

export function CardDescription({ className, ...props }: HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn('mt-2 text-sm text-zinc-500', className)} {...props} />;
}

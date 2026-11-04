import { cn } from '@/lib/utils';
import type { SelectHTMLAttributes } from 'react';

export function Select({ className, children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={cn(
        'h-10 w-full rounded-md border border-zinc-300 bg-white px-3 text-sm text-zinc-900 outline-none transition-colors focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 disabled:cursor-not-allowed disabled:bg-zinc-50 disabled:opacity-60',
        className,
      )}
      {...props}
    >
      {children}
    </select>
  );
}

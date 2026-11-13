import { cn } from '@/lib/utils';
import { Input } from './input';
import type { ReactNode } from 'react';

export function TabGroup<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
}: {
  value: T;
  options: ReadonlyArray<{ value: T; label: string }>;
  onChange: (value: T) => void;
  ariaLabel: string;
}) {
  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className="flex flex-wrap gap-1 rounded-lg border border-zinc-200 bg-zinc-50 p-1"
    >
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="tab"
          aria-selected={value === option.value}
          onClick={() => onChange(option.value)}
          className={`rounded-md px-3 py-1.5 text-sm ${
            value === option.value
              ? 'bg-white text-zinc-900 shadow-sm'
              : 'text-zinc-500 hover:text-zinc-900'
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function ListToolbar({
  search,
  onSearch,
  searchPlaceholder,
  searchAriaLabel,
  children,
  className,
}: {
  search: string;
  onSearch: (value: string) => void;
  searchPlaceholder: string;
  searchAriaLabel?: string;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-wrap items-center gap-3', className)}>
      <Input
        type="search"
        value={search}
        onChange={(event) => onSearch(event.target.value)}
        placeholder={searchPlaceholder}
        aria-label={searchAriaLabel ?? searchPlaceholder}
        className="max-w-sm"
      />
      <div className="ml-auto flex flex-wrap items-center gap-2">{children}</div>
    </div>
  );
}

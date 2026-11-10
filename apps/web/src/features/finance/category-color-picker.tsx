import { cn } from '@/lib/utils';
import { useState } from 'react';
import {
  categoryColorLabel,
  categoryColorOptions,
  type CategoryColorOption,
} from './category-colors';

function selectedOption(value: string): CategoryColorOption {
  return (
    categoryColorOptions.find((option) => option.value === value) ??
    categoryColorOptions[categoryColorOptions.length - 1]!
  );
}

export function CategoryColorPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const selected = selectedOption(value);

  return (
    <div
      className="relative"
      onKeyDown={(event) => {
        if (event.key === 'Escape' && open) {
          event.stopPropagation();
          setOpen(false);
        }
      }}
    >
      <span className="block text-sm text-zinc-600">Цвет</span>
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`Цвет категории: ${categoryColorLabel(value)}`}
        onClick={() => setOpen((current) => !current)}
        className="mt-1 flex h-9 w-full items-center justify-between gap-2 rounded-md border border-zinc-200 bg-white px-3 text-left text-sm text-zinc-800 shadow-sm outline-none focus-visible:border-emerald-500 focus-visible:ring-2 focus-visible:ring-emerald-500/20"
      >
        <span className="flex items-center gap-2">
          <span className={cn('h-3 w-3 rounded-full', selected.dotClassName)} />
          {selected.label}
        </span>
        <span aria-hidden="true" className="text-xs text-zinc-400">
          {open ? '▴' : '▾'}
        </span>
      </button>

      {open ? (
        <div
          role="listbox"
          aria-label="Цвета категорий"
          className="mt-1 grid w-full grid-cols-2 gap-1 rounded-xl border border-zinc-200 bg-white p-2 shadow-lg"
        >
          {categoryColorOptions.map((option) => (
            <button
              key={option.value}
              type="button"
              role="option"
              aria-selected={option.value === selected.value}
              aria-label={option.label}
              onClick={() => {
                onChange(option.value);
                setOpen(false);
              }}
              className={cn(
                'flex items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm text-zinc-700 hover:bg-zinc-50',
                option.value === selected.value && 'bg-emerald-50 text-emerald-800',
              )}
            >
              <span className={cn('h-3.5 w-3.5 rounded-full', option.dotClassName)} />
              {option.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

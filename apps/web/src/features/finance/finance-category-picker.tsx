import { Input } from '@/components/ui/input';
import { filterBySearch } from '@/lib/search';
import { useEffect, useRef, useState } from 'react';
import type { FinanceCategory } from '@nexter/contracts';
import { categoryColorClass } from './category-colors';

export function filterFinanceCategories(
  categories: readonly FinanceCategory[],
  query: string,
): FinanceCategory[] {
  return filterBySearch(categories, query, (category) => [category.name]);
}

export function FinanceCategoryPicker({
  categories,
  value,
  onChange,
}: {
  categories: readonly FinanceCategory[];
  value: string;
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const rootRef = useRef<HTMLDivElement>(null);
  const selected = categories.find((category) => category.id === value) ?? null;
  const filtered = filterFinanceCategories(categories, query);
  const showUncategorized =
    !query.trim() ||
    filterBySearch([{ name: 'Без категории' }], query, (item) => [item.name]).length > 0;

  useEffect(() => {
    if (!open) {
      setQuery('');
      return;
    }
    const onPointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  function choose(next: string) {
    onChange(next);
    setQuery('');
    setOpen(false);
  }

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        aria-label="Все категории"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
        className="flex h-10 w-full items-center justify-between gap-2 rounded-xl border border-zinc-200 bg-white px-3 text-left text-sm text-zinc-900 transition hover:border-zinc-300"
      >
        <span className="flex min-w-0 items-center gap-2">
          {selected ? (
            <span
              className={`h-2.5 w-2.5 shrink-0 rounded-full ${
                categoryColorClass[selected.color ?? 'default'] ?? categoryColorClass.default
              }`}
            />
          ) : (
            <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-zinc-300" />
          )}
          <span className="truncate">{selected?.name ?? 'Без категории'}</span>
        </span>
        <span className="shrink-0 text-xs text-zinc-500">▾</span>
      </button>

      {open ? (
        <div className="absolute left-0 right-0 top-full z-30 mt-1 max-h-72 overflow-y-auto rounded-xl border border-zinc-200 bg-white p-1 shadow-xl">
          <div className="p-1">
            <Input
              autoFocus
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Поиск категории"
              aria-label="Поиск категории"
              className="h-8 text-xs"
            />
          </div>
          <div role="listbox" aria-label="Категории">
            {showUncategorized ? (
              <button
                type="button"
                role="option"
                aria-selected={value === ''}
                onClick={() => choose('')}
                className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm transition ${
                  value === ''
                    ? 'bg-emerald-50 font-medium text-emerald-900'
                    : 'text-zinc-800 hover:bg-zinc-50'
                }`}
              >
                <span className="h-2.5 w-2.5 rounded-full bg-zinc-300" />
                <span>Без категории</span>
                {value === '' ? <span className="ml-auto text-emerald-700">✓</span> : null}
              </button>
            ) : null}
            {filtered.map((category) => (
              <button
                key={category.id}
                type="button"
                role="option"
                aria-selected={value === category.id}
                onClick={() => choose(category.id)}
                className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm transition ${
                  value === category.id
                    ? 'bg-emerald-50 font-medium text-emerald-900'
                    : 'text-zinc-800 hover:bg-zinc-50'
                }`}
              >
                <span
                  className={`h-2.5 w-2.5 shrink-0 rounded-full ${
                    categoryColorClass[category.color ?? 'default'] ?? categoryColorClass.default
                  }`}
                />
                <span className="min-w-0 flex-1 truncate">{category.name}</span>
                {value === category.id ? <span className="ml-auto text-emerald-700">✓</span> : null}
              </button>
            ))}
            {filtered.length === 0 && !showUncategorized ? (
              <p className="px-2 py-3 text-center text-xs text-zinc-500">Ничего не найдено</p>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

import { Input } from '@/components/ui/input';
import { filterBySearch } from '@/lib/search';
import {
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import type { FinanceCategory } from '@nexter/contracts';
import { categoryColorClass } from './category-colors';

export function filterFinanceCategories(
  categories: readonly FinanceCategory[],
  query: string,
): FinanceCategory[] {
  return filterBySearch(categories, query, (category) => [category.name]);
}

type PickerOption = {
  id: string;
  name: string;
  color: string | null;
};

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
  const [activeIndex, setActiveIndex] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listboxId = useId();
  const selected = categories.find((category) => category.id === value) ?? null;
  const filtered = filterFinanceCategories(categories, query);
  const showUncategorized =
    !query.trim() ||
    filterBySearch([{ name: 'Без категории' }], query, (item) => [item.name]).length > 0;
  const options: PickerOption[] = [
    ...(showUncategorized ? [{ id: '', name: 'Без категории', color: null }] : []),
    ...filtered.map((category) => ({
      id: category.id,
      name: category.name,
      color: category.color,
    })),
  ];

  useEffect(() => {
    if (!open) {
      setQuery('');
      setActiveIndex(0);
      return;
    }

    const onPointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
      triggerRef.current?.focus();
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown, true);
    };
  }, [open]);

  function choose(next: string) {
    onChange(next);
    setQuery('');
    setOpen(false);
    triggerRef.current?.focus();
  }

  function onSearchKeyDown(event: ReactKeyboardEvent<HTMLInputElement>) {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActiveIndex((current) => Math.min(options.length - 1, current + 1));
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveIndex((current) => Math.max(0, current - 1));
      return;
    }
    if (event.key === 'Home') {
      event.preventDefault();
      setActiveIndex(0);
      return;
    }
    if (event.key === 'End') {
      event.preventDefault();
      setActiveIndex(Math.max(0, options.length - 1));
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      const option = options[activeIndex];
      if (option) choose(option.id);
    }
  }

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        aria-label={`Категория: ${selected?.name ?? 'Без категории'}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listboxId : undefined}
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
              onChange={(event) => {
                setQuery(event.target.value);
                setActiveIndex(0);
              }}
              onKeyDown={onSearchKeyDown}
              placeholder="Поиск категории"
              aria-label="Поиск категории"
              role="combobox"
              aria-expanded
              aria-controls={listboxId}
              aria-autocomplete="list"
              aria-activedescendant={
                options[activeIndex] ? `${listboxId}-option-${activeIndex}` : undefined
              }
              className="h-8 text-xs"
            />
          </div>
          <div role="listbox" id={listboxId} aria-label="Категории">
            {options.map((option, index) => {
              const isSelected = value === option.id;
              const isActive = activeIndex === index;
              return (
                <button
                  key={option.id || 'uncategorized'}
                  type="button"
                  role="option"
                  tabIndex={-1}
                  id={`${listboxId}-option-${index}`}
                  aria-selected={isSelected}
                  onMouseEnter={() => setActiveIndex(index)}
                  onClick={() => choose(option.id)}
                  className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm transition ${
                    isSelected
                      ? 'bg-emerald-50 font-medium text-emerald-900'
                      : isActive
                        ? 'bg-zinc-100 text-zinc-900'
                        : 'text-zinc-800 hover:bg-zinc-50'
                  }`}
                >
                  <span
                    className={`h-2.5 w-2.5 shrink-0 rounded-full ${
                      option.color
                        ? (categoryColorClass[option.color] ?? categoryColorClass.default)
                        : 'bg-zinc-300'
                    }`}
                  />
                  <span className="min-w-0 flex-1 truncate">{option.name}</span>
                  {isSelected ? <span className="ml-auto text-emerald-700">✓</span> : null}
                </button>
              );
            })}
            {options.length === 0 ? (
              <p className="px-2 py-3 text-center text-xs text-zinc-500">Ничего не найдено</p>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

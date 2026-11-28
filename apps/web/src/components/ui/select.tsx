import { cn } from '@/lib/utils';
import {
  Children,
  isValidElement,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type ReactNode,
  type SelectHTMLAttributes,
} from 'react';

interface SelectOption {
  value: string;
  label: ReactNode;
  disabled: boolean;
}

function collectOptions(children: ReactNode): SelectOption[] {
  const options: SelectOption[] = [];

  Children.forEach(children, (child) => {
    if (!isValidElement(child)) return;
    const props = child.props as {
      value?: string | number;
      disabled?: boolean;
      children?: ReactNode;
    };

    if (child.type === 'option') {
      options.push({
        value: String(props.value ?? props.children ?? ''),
        label: props.children,
        disabled: Boolean(props.disabled),
      });
      return;
    }

    if (child.type === 'optgroup') {
      options.push(...collectOptions(props.children));
    }
  });

  return options;
}

function syntheticChange(value: string): ChangeEvent<HTMLSelectElement> {
  return { target: { value } } as unknown as ChangeEvent<HTMLSelectElement>;
}

export function Select({
  className,
  children,
  style,
  multiple,
  onMouseDown,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement>) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const options = collectOptions(children);
  const currentValue = String(props.value ?? props.defaultValue ?? '');
  const selected = options.find((option) => option.value === currentValue);

  useEffect(() => {
    if (!open) return;

    function onPointerDown(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false);
    }

    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  if (multiple) {
    return (
      <select
        className={cn(
          'h-10 w-full rounded-xl border border-zinc-200 bg-white px-3 text-sm text-zinc-900',
          className,
        )}
        multiple
        {...props}
      >
        {children}
      </select>
    );
  }

  return (
    <div ref={rootRef} className={cn('relative h-10 w-full', className)} style={style}>
      <div
        aria-hidden="true"
        className={cn(
          'pointer-events-none flex h-full w-full items-center justify-between gap-2 rounded-xl border border-zinc-200 bg-white px-3 text-sm text-zinc-900',
          props.disabled && 'opacity-60',
          open && 'border-emerald-500 ring-4 ring-emerald-500/10',
        )}
      >
        <span className="min-w-0 truncate">{selected?.label ?? '—'}</span>
        <span className="shrink-0 text-xs text-zinc-500">▾</span>
      </div>

      <select
        {...props}
        className="absolute inset-0 z-10 h-full w-full cursor-pointer opacity-0 disabled:cursor-not-allowed"
        onMouseDown={(event) => {
          onMouseDown?.(event);
          if (props.disabled || options.length === 0) return;
          event.preventDefault();
          setOpen((value) => !value);
        }}
        onChange={(event) => {
          props.onChange?.(event);
          setOpen(false);
        }}
      >
        {children}
      </select>

      {open ? (
        <div
          className="absolute left-0 top-full z-30 mt-1 max-h-64 w-max min-w-full max-w-[240px] overflow-y-auto rounded-xl border border-zinc-200 bg-white p-1 shadow-xl"
          role="listbox"
        >
          {options.map((option) => {
            const active = option.value === currentValue;
            return (
              <button
                key={`${option.value}-${String(option.label)}`}
                type="button"
                role="option"
                aria-selected={active}
                disabled={option.disabled}
                className={cn(
                  'flex w-full items-center justify-between gap-1.5 rounded-lg px-1.5 py-1.5 text-left text-sm transition',
                  active
                    ? 'bg-emerald-50 font-medium text-emerald-900'
                    : 'text-zinc-800 hover:bg-zinc-50',
                  option.disabled && 'cursor-not-allowed opacity-50',
                )}
                onClick={() => {
                  if (option.disabled) return;
                  props.onChange?.(syntheticChange(option.value));
                  setOpen(false);
                }}
              >
                <span className="min-w-0 flex-1 break-words">{option.label}</span>
                {active ? <span className="ml-2 shrink-0 text-emerald-700">✓</span> : null}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

import { TokenIcon } from '@/components/token-icon';
import { formatTokenAmount } from '@/lib/format';
import type { SwapToken } from '@nexter/contracts';
import { useEffect, useRef, useState } from 'react';

function balanceLabel(value: string | null | undefined): string {
  if (!value) return '—';
  return formatTokenAmount(value, 4);
}

export function StablecoinSelect({
  options,
  value,
  onChange,
  balances,
  disabled = false,
}: {
  options: SwapToken[];
  value: string;
  onChange: (symbol: string) => void;
  balances: Map<string, string | null>;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const selected = options.find((item) => item.symbol === value) ?? options[0];

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

  return (
    <div ref={rootRef} className="relative mt-1">
      <button
        type="button"
        className="flex h-10 w-full items-center justify-between gap-2 rounded-xl border border-zinc-200 bg-white px-3 text-left text-sm text-zinc-900 outline-none transition hover:border-zinc-300 focus-visible:border-emerald-500 focus-visible:ring-4 focus-visible:ring-emerald-500/10 disabled:cursor-not-allowed disabled:opacity-60"
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen((current) => !current)}
      >
        <span className="flex min-w-0 items-center gap-2">
          {selected ? (
            <TokenIcon logoUrl={null} symbol={selected.symbol} className="h-6 w-6 text-[9px]" />
          ) : null}
          <span className="font-medium">{selected?.symbol ?? '—'}</span>
          <span className="truncate text-xs text-zinc-500">
            {balanceLabel(balances.get(selected?.symbol ?? ''))}
          </span>
        </span>
        <span aria-hidden="true" className="text-xs text-zinc-500">
          ▾
        </span>
      </button>

      {open ? (
        <div
          className="absolute left-0 right-0 top-full z-30 mt-1 overflow-hidden rounded-xl border border-zinc-200 bg-white p-1 shadow-xl"
          role="listbox"
          aria-label="Выбор стейблкоина"
        >
          {options.map((option) => {
            const active = option.symbol === selected?.symbol;
            return (
              <button
                key={option.symbol}
                type="button"
                role="option"
                aria-selected={active}
                className={`flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-left text-sm transition ${
                  active ? 'bg-emerald-50 text-emerald-900' : 'text-zinc-800 hover:bg-zinc-50'
                }`}
                onClick={() => {
                  onChange(option.symbol);
                  setOpen(false);
                }}
              >
                <span className="flex min-w-0 items-center gap-2">
                  <TokenIcon
                    logoUrl={null}
                    symbol={option.symbol}
                    className="h-7 w-7 text-[10px]"
                  />
                  <span className="min-w-0">
                    <span className="block font-medium">{option.symbol}</span>
                    <span className="block truncate text-[11px] text-zinc-500">{option.name}</span>
                  </span>
                </span>
                <span className="shrink-0 text-right">
                  <span className="block font-mono text-xs text-zinc-800">
                    {balanceLabel(balances.get(option.symbol))}
                  </span>
                  <span className="block text-[10px] text-zinc-500">на кошельке</span>
                </span>
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

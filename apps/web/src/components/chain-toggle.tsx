import { cn } from '@/lib/utils';
import type { ReactNode } from 'react';

export type ChainCode = 'bsc' | 'ethereum';

export function BnbIcon() {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true" className="h-4 w-4">
      <path d="m16 4 4.4 4.4L16 12.8l-4.4-4.4Z" fill="#F3BA2F" />
      <path d="m7.2 12.8 4.4 4.4-4.4 4.4L2.8 17.2Z" fill="#F3BA2F" />
      <path d="m24.8 12.8 4.4 4.4-4.4 4.4-4.4-4.4Z" fill="#F3BA2F" />
      <path d="m16 15.6 4.4 4.4-4.4 4.4-4.4-4.4Z" fill="#F3BA2F" />
      <path d="m16 27.2 4.4-4.4L16 25l-4.4-2.2Z" fill="#F3BA2F" opacity=".65" />
    </svg>
  );
}

export function EthIcon() {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true" className="h-4 w-4">
      <path d="M16 3.5 24 16l-8 4.7L8 16Z" fill="#627EEA" />
      <path d="M16 21.9 24 17.2 16 29l-8-11.8Z" fill="#8A9DF1" />
    </svg>
  );
}

function ChainButton({
  chain,
  active,
  onClick,
  label,
  shortLabel,
  labelClassName,
  children,
}: {
  chain: ChainCode;
  active: boolean;
  onClick: (chain: ChainCode) => void;
  label: string;
  shortLabel: string;
  labelClassName: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={active}
      title={chain === 'bsc' ? 'BNB Smart Chain' : 'Ethereum'}
      onClick={() => onClick(chain)}
      className={cn(
        'flex h-8 items-center gap-1.5 rounded-lg px-2 text-xs font-medium transition',
        active
          ? 'bg-white text-zinc-900 shadow-sm'
          : 'text-zinc-400 hover:bg-white/60 hover:text-zinc-600',
      )}
    >
      <span className={active ? '' : 'opacity-40 grayscale'}>{children}</span>
      <span className={labelClassName}>{shortLabel}</span>
      {active ? <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> : null}
    </button>
  );
}

export function ChainToggle({
  value,
  onChange,
  ariaLabel = 'Блокчейн',
  className,
  labelClassName = 'hidden md:inline',
}: {
  value: ChainCode;
  onChange: (chain: ChainCode) => void;
  ariaLabel?: string;
  className?: string;
  labelClassName?: string;
}) {
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className={cn(
        'flex items-center gap-1 rounded-xl border border-zinc-200 bg-zinc-100 p-1',
        className,
      )}
    >
      <ChainButton
        chain="bsc"
        active={value === 'bsc'}
        onClick={onChange}
        label="BNB"
        shortLabel="BNB"
        labelClassName={labelClassName}
      >
        <BnbIcon />
      </ChainButton>
      <ChainButton
        chain="ethereum"
        active={value === 'ethereum'}
        onClick={onChange}
        label="Ethereum"
        shortLabel="ETH"
        labelClassName={labelClassName}
      >
        <EthIcon />
      </ChainButton>
    </div>
  );
}

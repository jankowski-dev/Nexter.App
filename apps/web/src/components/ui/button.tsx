import { cn } from '@/lib/utils';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import type { ButtonHTMLAttributes } from 'react';

const buttonVariants = cva(
  'inline-flex h-10 items-center justify-center rounded-xl px-4 text-sm font-medium transition-all disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        primary:
          'bg-emerald-600 text-white shadow-sm shadow-emerald-900/10 hover:bg-emerald-700 active:scale-[0.99]',
        secondary:
          'border border-zinc-200 bg-white text-zinc-700 shadow-sm hover:border-zinc-300 hover:bg-zinc-50',
        ghost: 'bg-transparent text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900',
        danger: 'bg-red-600 text-white hover:bg-red-700',
      },
    },
    defaultVariants: {
      variant: 'primary',
    },
  },
);

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

export function Button({
  className,
  variant,
  asChild = false,
  type = 'button',
  ...props
}: ButtonProps) {
  const Component = asChild ? Slot : 'button';

  return (
    <Component
      type={asChild ? undefined : type}
      className={cn(buttonVariants({ variant, className }))}
      {...props}
    />
  );
}

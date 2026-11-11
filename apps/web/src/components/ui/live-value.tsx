import { cn } from '@/lib/utils';
import { useEffect, useRef, useState, type ReactNode } from 'react';

export function LiveValue({
  value,
  children,
  className,
  title,
}: {
  value: string | number | null | undefined;
  children: ReactNode;
  className?: string;
  title?: string;
}) {
  const previous = useRef<string | number | null>(value ?? null);
  const [flashing, setFlashing] = useState(false);
  const [flashKey, setFlashKey] = useState(0);

  useEffect(() => {
    const next = value ?? null;
    if (previous.current === next) return;
    previous.current = next;
    setFlashKey((value) => value + 1);
    setFlashing(true);
    const timer = window.setTimeout(() => setFlashing(false), 900);
    return () => window.clearTimeout(timer);
  }, [value]);

  return (
    <span
      key={flashKey}
      className={cn('live-value', flashing && 'live-value-flash', className)}
      title={title}
    >
      {children}
    </span>
  );
}

import { useIsFetching } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';

export function FanIcon({ spinning }: { spinning: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className={`h-5 w-5 ${spinning ? 'animate-spin [animation-duration:1.1s]' : 'opacity-45'}`}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="12" r="1.8" fill="currentColor" stroke="none" />
      <path d="M12 10.2c-2.9-.2-5.4-1.5-5.2-3.3.2-1.8 3-2.1 4.6-.4.8.9 1.4 2.1 1.6 3.7Z" />
      <path d="M13.8 12c.2-2.9 1.5-5.4 3.3-5.2 1.8.2 2.1 3 .4 4.6-.9.8-2.1 1.4-3.7 1.6Z" />
      <path d="M12 13.8c2.9.2 5.4 1.5 5.2 3.3-.2 1.8-3 2.1-4.6.4-.8-.9-1.4-2.1-1.6-3.7Z" />
      <path d="M10.2 12c-.2 2.9-1.5 5.4-3.3 5.2-1.8-.2-2.1-3-.4-4.6.9-.8 2.1-1.4 3.7-1.6Z" />
    </svg>
  );
}

export function useLiveRefreshing(): boolean {
  const fetching = useIsFetching();
  const [active, setActive] = useState(false);
  const startedAt = useRef(0);
  const hideTimer = useRef<number | null>(null);

  useEffect(() => {
    if (fetching > 0) {
      if (hideTimer.current !== null) window.clearTimeout(hideTimer.current);
      hideTimer.current = null;
      if (!active) startedAt.current = Date.now();
      setActive(true);
      return;
    }

    if (!active) return;

    const remaining = Math.max(0, 3000 - (Date.now() - startedAt.current));
    hideTimer.current = window.setTimeout(() => {
      setActive(false);
      hideTimer.current = null;
    }, remaining);

    return () => {
      if (hideTimer.current !== null) window.clearTimeout(hideTimer.current);
      hideTimer.current = null;
    };
  }, [fetching, active]);

  return active;
}

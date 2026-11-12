import { useEffect, useRef } from 'react';

export function useAutoDismissNotice(notice: string | null, clear: () => void, delay = 5000): void {
  const clearRef = useRef(clear);

  useEffect(() => {
    clearRef.current = clear;
  }, [clear]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => clearRef.current(), delay);
    return () => window.clearTimeout(timer);
  }, [notice, delay]);
}

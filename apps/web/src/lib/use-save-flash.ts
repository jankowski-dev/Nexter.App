import { useEffect, useRef, useState } from 'react';

/**
 * Keep the "saving" indicator visible for a short, fixed window so a fast
 * autosave is still perceptible. Errors are handled by the caller.
 */
export function useSaveFlash(
  state: 'idle' | 'saving' | 'saved' | 'error',
  durationMs = 3000,
): boolean {
  const [visible, setVisible] = useState(false);
  const startedAt = useRef(0);
  const timer = useRef<number | null>(null);

  useEffect(() => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }

    if (state === 'saving') {
      startedAt.current = Date.now();
      setVisible(true);
      return;
    }

    if (state === 'idle' || state === 'error') {
      setVisible(false);
      return;
    }

    if (state === 'saved' && visible) {
      const remaining = Math.max(0, durationMs - (Date.now() - startedAt.current));
      timer.current = window.setTimeout(() => {
        timer.current = null;
        setVisible(false);
      }, remaining);
    }

    return () => {
      if (timer.current !== null) {
        window.clearTimeout(timer.current);
        timer.current = null;
      }
    };
  }, [durationMs, state, visible]);

  return state === 'saving' || visible;
}

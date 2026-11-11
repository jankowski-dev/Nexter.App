import { useEffect, useRef, useState } from 'react';

/**
 * Briefly highlight a card when its query receives fresh data. The first
 * timestamp is ignored so opening a page does not flash everything.
 */
export function useLiveFlash(timestamp: number | undefined): boolean {
  const [flashing, setFlashing] = useState(false);
  const firstTimestampAt = useRef<number | null>(null);

  useEffect(() => {
    if (!timestamp) {
      setFlashing(false);
      return;
    }
    if (firstTimestampAt.current === null) {
      firstTimestampAt.current = Date.now();
      return;
    }
    if (Date.now() - firstTimestampAt.current < 1500) return;

    setFlashing(true);
    const timer = window.setTimeout(() => setFlashing(false), 1100);
    return () => window.clearTimeout(timer);
  }, [timestamp]);

  return flashing;
}

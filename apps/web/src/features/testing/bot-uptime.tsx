import { useEffect, useState } from 'react';

export function formatUptime(startedAt: string | null, now: number): string {
  if (!startedAt) return '00:00:00';
  const seconds = Math.max(0, Math.floor((now - new Date(startedAt).getTime()) / 1000));
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = seconds % 60;
  const clock = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(rest).padStart(2, '0')}`;
  return days > 0 ? `${days} д ${clock}` : clock;
}

export function BotUptimeText({
  startedAt,
  running,
  className,
}: {
  startedAt: string | null;
  running: boolean;
  className?: string;
}) {
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [running]);

  return <span className={className}>{running ? formatUptime(startedAt, now) : '00:00:00'}</span>;
}

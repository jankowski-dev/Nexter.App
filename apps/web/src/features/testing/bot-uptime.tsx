import { useEffect, useState } from 'react';

export function formatUptime(startedAt: string | null, now: number): string {
  if (!startedAt) return '—';
  const seconds = Math.max(0, Math.floor((now - new Date(startedAt).getTime()) / 1000));
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = seconds % 60;

  if (days > 0) return `${days} д ${hours} ч ${minutes} мин`;
  if (hours > 0) return `${hours} ч ${minutes} мин`;
  if (minutes > 0) return `${minutes} мин ${rest} с`;
  return `${rest} с`;
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

  return <span className={className}>{running ? formatUptime(startedAt, now) : '—'}</span>;
}

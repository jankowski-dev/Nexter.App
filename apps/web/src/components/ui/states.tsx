import { Card, CardDescription, CardTitle } from '@/components/ui/card';
import type { ReactNode } from 'react';

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <Card className="border-dashed bg-zinc-900/30 text-center">
      <CardTitle>{title}</CardTitle>
      <CardDescription>{description}</CardDescription>
      {action ? <div className="mt-4">{action}</div> : null}
    </Card>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <Card className="border-red-900/60 bg-red-950/20">
      <CardTitle className="text-red-200">Ошибка</CardTitle>
      <CardDescription className="text-red-200/80">{message}</CardDescription>
      {onRetry ? (
        <button
          type="button"
          onClick={onRetry}
          className="mt-4 rounded-md bg-zinc-800 px-3 py-1.5 text-sm text-zinc-100 hover:bg-zinc-700"
        >
          Повторить
        </button>
      ) : null}
    </Card>
  );
}

export function LoadingRows({ rows = 5 }: { rows?: number }) {
  return (
    <div className="space-y-2" aria-label="Загрузка">
      {Array.from({ length: rows }).map((_, index) => (
        <div key={index} className="h-10 animate-pulse rounded-md bg-zinc-800/80" />
      ))}
    </div>
  );
}

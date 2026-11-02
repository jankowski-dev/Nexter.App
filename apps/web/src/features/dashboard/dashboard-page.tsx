import { Button } from '@/components/ui/button';
import { Card, CardDescription, CardHeader, CardTitle, CardValue } from '@/components/ui/card';
import { apiFetch, type HealthResponse } from '@/lib/api';
import { useQuery } from '@tanstack/react-query';

export function DashboardPage() {
  const health = useQuery({
    queryKey: ['health'],
    queryFn: () => apiFetch<HealthResponse>('/health'),
    refetchInterval: 30_000,
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Дашборд</h1>
          <p className="mt-1 text-sm text-zinc-400">
            Каркас Nexter запущен. Здесь появится портфель, P&amp;L и статистика.
          </p>
        </div>
        <Button variant="secondary" onClick={() => void health.refetch()}>
          Проверить API
        </Button>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Card>
          <CardHeader>
            <CardTitle>API</CardTitle>
          </CardHeader>
          <CardValue>
            {health.isPending ? '...' : health.isError ? 'offline' : health.data?.status}
          </CardValue>
          <CardDescription>
            {health.isError ? 'API недоступен. Запустите backend.' : 'Liveness probe /health'}
          </CardDescription>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Версия</CardTitle>
          </CardHeader>
          <CardValue>{health.data?.version ?? '—'}</CardValue>
          <CardDescription>Текущая версия API</CardDescription>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Фаза</CardTitle>
          </CardHeader>
          <CardValue>1</CardValue>
          <CardDescription>Foundation: каркас, БД, CI</CardDescription>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Следующая фаза</CardTitle>
          </CardHeader>
          <CardValue>2</CardValue>
          <CardDescription>Auth, 2FA, сессии, audit</CardDescription>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Что уже есть</CardTitle>
        </CardHeader>
        <ul className="grid gap-2 text-sm text-zinc-400 sm:grid-cols-2">
          <li>• pnpm workspace и строгая типизация</li>
          <li>• Postgres 17 + Drizzle + миграции</li>
          <li>• NestJS + Fastify, health/ready</li>
          <li>• React + Vite + TanStack Router/Query</li>
          <li>• Tailwind CSS и тёмная тема</li>
          <li>• CI, Dockerfile и Railway-заготовка</li>
        </ul>
      </Card>
    </div>
  );
}

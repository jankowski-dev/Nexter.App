import { Button } from '@/components/ui/button';
import { Card, CardDescription, CardHeader, CardTitle, CardValue } from '@/components/ui/card';
import { apiFetch, healthResponseSchema } from '@/lib/api';
import { messages } from '@/lib/i18n';
import type { HealthResponse } from '@nexter/contracts';
import { useQuery } from '@tanstack/react-query';

export function DashboardPage() {
  const health = useQuery({
    queryKey: ['health'],
    queryFn: () => apiFetch<HealthResponse>('/health', {}, healthResponseSchema),
    refetchInterval: 30_000,
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{messages.dashboard.title}</h1>
          <p className="mt-1 text-sm text-zinc-400">{messages.dashboard.subtitle}</p>
        </div>
        <Button variant="secondary" onClick={() => void health.refetch()}>
          {messages.dashboard.checkApi}
        </Button>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Card>
          <CardHeader>
            <CardTitle>{messages.dashboard.api}</CardTitle>
          </CardHeader>
          <CardValue>
            {health.isPending ? '...' : health.isError ? 'offline' : health.data?.status}
          </CardValue>
          <CardDescription>
            {health.isError ? 'API недоступен. Запустите backend.' : messages.dashboard.apiHint}
          </CardDescription>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{messages.dashboard.version}</CardTitle>
          </CardHeader>
          <CardValue>{health.data?.version ?? '—'}</CardValue>
          <CardDescription>{messages.dashboard.versionHint}</CardDescription>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{messages.dashboard.phase}</CardTitle>
          </CardHeader>
          <CardValue>2</CardValue>
          <CardDescription>{messages.dashboard.phaseHint}</CardDescription>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{messages.dashboard.nextPhase}</CardTitle>
          </CardHeader>
          <CardValue>3</CardValue>
          <CardDescription>{messages.dashboard.nextPhaseHint}</CardDescription>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{messages.dashboard.whatWorks}</CardTitle>
        </CardHeader>
        <ul className="grid gap-2 text-sm text-zinc-400 sm:grid-cols-2">
          <li>• pnpm workspace и строгая типизация</li>
          <li>• Postgres 17 + Drizzle + миграции</li>
          <li>• NestJS + Fastify, health/ready</li>
          <li>• React + Vite + TanStack Router/Query</li>
          <li>• Auth: пароль, TOTP, recovery codes</li>
          <li>• Tailwind CSS и тёмная тема</li>
          <li>• CI, Dockerfile и Railway-заготовка</li>
        </ul>
      </Card>
    </div>
  );
}

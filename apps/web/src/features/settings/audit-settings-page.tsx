import { Button } from '@/components/ui/button';
import { Card, CardDescription, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { PageHeader } from '@/components/ui/page-header';
import { ErrorState, LoadingRows } from '@/components/ui/states';
import { fetchAuditLog } from '@/lib/api';
import { toRussianError } from '@/lib/error-messages';
import { formatDateTime } from '@/lib/format';
import { useInfiniteQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useDeferredValue, useState } from 'react';

export function AuditSettingsPage() {
  const [action, setAction] = useState('');
  const [entityType, setEntityType] = useState('');
  const deferredAction = useDeferredValue(action);
  const deferredEntity = useDeferredValue(entityType);
  const audit = useInfiniteQuery({
    queryKey: ['audit-log', deferredAction, deferredEntity],
    queryFn: ({ pageParam }) =>
      fetchAuditLog({
        limit: 50,
        cursor: pageParam ?? undefined,
        action: deferredAction || undefined,
        entityType: deferredEntity || undefined,
      }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => (last.page.hasMore ? last.page.nextCursor : undefined),
  });
  const rows = audit.data?.pages.flatMap((page) => page.data) ?? [];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Аудит"
        subtitle="Журнал действий. Записи доступны только владельцу."
        actions={
          <Button variant="secondary" asChild>
            <Link to="/settings">Назад</Link>
          </Button>
        }
      />

      <Card>
        <div className="grid gap-3 md:grid-cols-2">
          <Input
            placeholder="Фильтр по action, например import."
            value={action}
            onChange={(event) => setAction(event.target.value)}
            aria-label="Фильтр по действию"
          />
          <Input
            placeholder="Фильтр по entityType, например transaction"
            value={entityType}
            onChange={(event) => setEntityType(event.target.value)}
            aria-label="Фильтр по типу объекта"
          />
        </div>
      </Card>

      {audit.isPending ? <LoadingRows rows={8} /> : null}
      {audit.isError ? (
        <ErrorState
          message={toRussianError(audit.error, 'Не удалось загрузить аудит')}
          onRetry={() => void audit.refetch()}
        />
      ) : null}

      {!audit.isPending && !audit.isError ? (
        <Card>
          <CardTitle>Записи</CardTitle>
          <CardDescription>{rows.length} записей</CardDescription>
          {rows.length === 0 ? (
            <p className="mt-4 text-sm text-zinc-600">Записей нет.</p>
          ) : (
            <div className="mt-4 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-zinc-200 text-left text-xs text-zinc-500">
                    <th className="py-2 pr-3 font-medium">Дата</th>
                    <th className="py-2 pr-3 font-medium">Действие</th>
                    <th className="py-2 pr-3 font-medium">Объект</th>
                    <th className="py-2 font-medium">Детали</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((entry) => (
                    <tr
                      key={entry.id}
                      className="border-b border-zinc-100 last:border-0 hover:bg-zinc-50"
                    >
                      <td className="py-2 pr-3 text-zinc-600">{formatDateTime(entry.createdAt)}</td>
                      <td className="py-2 pr-3 font-mono text-xs text-zinc-700">{entry.action}</td>
                      <td className="py-2 pr-3 text-zinc-500">
                        {entry.entityType} · {entry.entityId?.slice(0, 8) ?? '—'}
                      </td>
                      <td className="max-w-md truncate py-2 font-mono text-xs text-zinc-500">
                        {entry.after ? JSON.stringify(entry.after) : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {audit.hasNextPage ? (
            <div className="mt-4 flex justify-center">
              <Button
                variant="secondary"
                onClick={() => void audit.fetchNextPage()}
                disabled={audit.isFetchingNextPage}
              >
                {audit.isFetchingNextPage ? 'Загружаю…' : 'Загрузить ещё'}
              </Button>
            </div>
          ) : null}
        </Card>
      ) : null}
    </div>
  );
}

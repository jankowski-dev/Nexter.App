import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardDescription, CardTitle } from '@/components/ui/card';
import { PageHeader } from '@/components/ui/page-header';
import { ErrorState, LoadingRows } from '@/components/ui/states';
import { NavIcon } from '@/components/nav-icon';
import { fetchNotifications, markAllNotificationsRead } from '@/lib/api';
import { toRussianError } from '@/lib/error-messages';
import { formatDateTime } from '@/lib/format';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import type { NotificationsResponse } from '@nexter/contracts';

export function NotificationsPage() {
  const queryClient = useQueryClient();
  const notifications = useQuery({
    queryKey: ['notifications'],
    queryFn: () => fetchNotifications(100),
    refetchInterval: 30_000,
  });
  const markAllRead = useMutation({
    mutationFn: markAllNotificationsRead,
    onSuccess: () => {
      queryClient.setQueryData<NotificationsResponse>(['notifications'], (current) => {
        if (!current) return current;
        const readAt = new Date().toISOString();
        return {
          ...current,
          unreadCount: 0,
          data: current.data.map((notification) =>
            notification.readAt ? notification : { ...notification, readAt },
          ),
        };
      });
      void queryClient.invalidateQueries({ queryKey: ['notifications-unread-count'] });
    },
  });

  useEffect(() => {
    if (!notifications.data || notifications.data.unreadCount === 0) return;
    if (markAllRead.isPending || markAllRead.isError) return;
    markAllRead.mutate();
  }, [notifications.data, markAllRead]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Уведомления"
        subtitle="События ботов, длительных операций и фоновых задач."
        actions={
          <Button variant="secondary" onClick={() => void notifications.refetch()}>
            Обновить
          </Button>
        }
      />

      {notifications.isPending ? <LoadingRows rows={5} /> : null}
      {notifications.isError ? (
        <ErrorState
          message={toRussianError(notifications.error, 'Не удалось загрузить уведомления')}
          onRetry={() => void notifications.refetch()}
        />
      ) : null}

      {!notifications.isPending && !notifications.isError ? (
        (notifications.data?.data.length ?? 0) === 0 ? (
          <Card>
            <CardTitle>Уведомлений пока нет</CardTitle>
            <CardDescription>
              Здесь появятся события остановки ботов, завершения длительных операций и другие
              системные сообщения.
            </CardDescription>
          </Card>
        ) : (
          <div className="space-y-2">
            {(notifications.data?.data ?? []).map((notification) => (
              <Card
                key={notification.id}
                className={`p-4 ${
                  notification.readAt ? '' : 'border-emerald-200 bg-emerald-50/60'
                }`}
              >
                <div className="flex items-start gap-3">
                  <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-zinc-200 bg-zinc-50 text-zinc-600">
                    <NavIcon name="notifications" className="h-5 w-5" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium text-zinc-900">{notification.title}</span>
                      {notification.readAt ? null : <Badge tone="success">новое</Badge>}
                      <span className="text-xs text-zinc-500">
                        {formatDateTime(notification.createdAt)}
                      </span>
                    </div>
                    {notification.body ? (
                      <p className="mt-1 text-sm leading-6 text-zinc-600">{notification.body}</p>
                    ) : null}
                    {notification.href ? (
                      <a
                        href={notification.href}
                        className="mt-2 inline-block text-xs font-medium text-emerald-800 hover:text-emerald-700"
                      >
                        Открыть
                      </a>
                    ) : null}
                  </div>
                </div>
              </Card>
            ))}
          </div>
        )
      ) : null}
    </div>
  );
}

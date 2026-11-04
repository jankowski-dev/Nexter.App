import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardDescription, CardTitle } from '@/components/ui/card';
import { PageHeader } from '@/components/ui/page-header';
import { ErrorState, LoadingRows } from '@/components/ui/states';
import { fetchDashboardDataQuality } from '@/lib/api';
import { toRussianError } from '@/lib/error-messages';
import { formatCount } from '@/lib/format';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';

export function DataQualityPage() {
  const quality = useQuery({
    queryKey: ['dashboard-data-quality'],
    queryFn: fetchDashboardDataQuality,
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Качество данных"
        subtitle="Неизвестные сети и контракты, отсутствующие цены, сборы, сверка и отрицательные балансы."
        actions={
          <Button variant="secondary" asChild>
            <Link to="/settings">Назад</Link>
          </Button>
        }
      />

      {quality.isPending ? <LoadingRows rows={6} /> : null}
      {quality.isError ? (
        <ErrorState
          message={toRussianError(quality.error, 'Не удалось загрузить качество данных')}
          onRetry={() => void quality.refetch()}
        />
      ) : null}

      {quality.data ? (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Card>
              <CardTitle>Проблемы</CardTitle>
              <div className="mt-1 font-mono text-2xl font-semibold text-zinc-900">
                {formatCount(quality.data.issues.length)}
              </div>
            </Card>
            <Card>
              <CardTitle>Без цен</CardTitle>
              <div className="mt-1 font-mono text-2xl font-semibold text-zinc-900">
                {formatCount(quality.data.missingPrices.length)}
              </div>
              <CardDescription>{quality.data.missingPrices.join(', ') || '—'}</CardDescription>
            </Card>
            <Card>
              <CardTitle>Непроверенные активы</CardTitle>
              <div className="mt-1 font-mono text-2xl font-semibold text-zinc-900">
                {formatCount(quality.data.unverifiedAssets.length)}
              </div>
            </Card>
            <Card>
              <CardTitle>Отрицательные балансы</CardTitle>
              <div className="mt-1 font-mono text-2xl font-semibold text-zinc-900">
                {formatCount(quality.data.negativeBalances.length)}
              </div>
            </Card>
          </div>

          <Card>
            <CardTitle>Список проблем</CardTitle>
            <CardDescription>
              Сгруппировано по типу; детали ограничены первыми 20 записями.
            </CardDescription>
            {quality.data.issues.length === 0 ? (
              <p className="mt-4 text-sm text-emerald-700">Проблем не найдено.</p>
            ) : (
              <div className="mt-4 space-y-3">
                {quality.data.issues.map((issue) => (
                  <div
                    key={issue.code}
                    className="rounded-lg border border-zinc-200 bg-zinc-50 p-3"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <Badge
                          tone={
                            issue.severity === 'error'
                              ? 'danger'
                              : issue.severity === 'warning'
                                ? 'warning'
                                : 'info'
                          }
                        >
                          {issue.severity}
                        </Badge>
                        <span className="text-sm font-medium text-zinc-800">{issue.label}</span>
                      </div>
                      <span className="font-mono text-sm text-zinc-600">{issue.count}</span>
                    </div>
                    {issue.details.length > 0 ? (
                      <ul className="mt-2 space-y-1 text-xs text-zinc-500">
                        {issue.details.map((detail) => (
                          <li key={detail}>• {detail}</li>
                        ))}
                      </ul>
                    ) : null}
                  </div>
                ))}
              </div>
            )}
          </Card>

          {quality.data.negativeBalances.length > 0 ? (
            <Card className="border-red-200 bg-red-50">
              <CardTitle className="text-red-700">Отрицательные балансы</CardTitle>
              <div className="mt-3 space-y-1 text-sm text-red-700">
                {quality.data.negativeBalances.map((row) => (
                  <div key={`${row.accountId}:${row.assetId}`} className="font-mono">
                    {row.accountName} · {row.symbol}: {row.amount}
                  </div>
                ))}
              </div>
            </Card>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardDescription, CardTitle } from '@/components/ui/card';
import { PageHeader } from '@/components/ui/page-header';
import { ErrorState, LoadingRows } from '@/components/ui/states';
import { fetchDataQuality } from '@/lib/api';
import { toRussianError } from '@/lib/error-messages';
import { formatRelativeTime } from '@/lib/format';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import type { DataQualityCheck, DataQualitySeverity } from '@nexter/contracts';

function severityTone(severity: DataQualitySeverity) {
  return severity === 'error' ? 'danger' : severity === 'warning' ? 'warning' : 'info';
}

function severityLabel(severity: DataQualitySeverity) {
  return severity === 'error' ? 'Ошибка' : severity === 'warning' ? 'Внимание' : 'Инфо';
}

function checkCount(check: DataQualityCheck): string {
  return check.count.toLocaleString('ru-RU');
}

export function DataQualityPage() {
  const report = useQuery({
    queryKey: ['data-quality'],
    queryFn: fetchDataQuality,
    refetchInterval: 60_000,
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Качество данных"
        subtitle="Проверки учёта, ордеров, свопов, котировок и роботов. Только просмотр."
        actions={
          <Button variant="secondary" asChild>
            <Link to="/settings">Назад</Link>
          </Button>
        }
      />

      {report.isPending ? <LoadingRows rows={8} /> : null}
      {report.isError ? (
        <ErrorState
          message={toRussianError(report.error, 'Не удалось загрузить отчёт')}
          onRetry={() => void report.refetch()}
        />
      ) : null}

      {report.data ? (
        <div className="space-y-6">
          <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-zinc-500">
            <span>Обновлено {formatRelativeTime(report.data.generatedAt)}</span>
            <div className="flex items-center gap-2">
              <Badge tone={report.data.summary.healthy ? 'success' : 'danger'}>
                {report.data.summary.healthy ? 'Критических ошибок нет' : 'Есть ошибки'}
              </Badge>
              <Button
                variant="secondary"
                onClick={() => void report.refetch()}
                disabled={report.isFetching}
              >
                {report.isFetching ? 'Обновляю…' : 'Проверить снова'}
              </Button>
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <SummaryTile label="Ошибки" value={report.data.summary.errors} tone="danger" />
            <SummaryTile
              label="Предупреждения"
              value={report.data.summary.warnings}
              tone="warning"
            />
            <SummaryTile label="Информация" value={report.data.summary.info} tone="info" />
            <SummaryTile
              label="Статус"
              value={report.data.summary.healthy ? 'OK' : 'Нужно внимание'}
              tone={report.data.summary.healthy ? 'success' : 'danger'}
            />
          </div>

          {report.data.sections.map((section) => {
            const checks = section.checks.filter((check) => check.count > 0);
            return (
              <Card key={section.key}>
                <CardTitle>{section.label}</CardTitle>
                {checks.length === 0 ? (
                  <CardDescription>Проблем не найдено.</CardDescription>
                ) : (
                  <div className="mt-3 space-y-3">
                    {checks.map((check) => (
                      <div key={check.code} className="rounded-xl border border-zinc-200 p-3">
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge tone={severityTone(check.severity)}>
                            {severityLabel(check.severity)}
                          </Badge>
                          <span className="font-medium text-zinc-800">{check.label}</span>
                          <span className="ml-auto rounded-full bg-zinc-100 px-2 py-0.5 font-mono text-xs text-zinc-600">
                            {checkCount(check)}
                          </span>
                        </div>
                        {check.hint ? (
                          <p className="mt-1 text-xs text-zinc-500">{check.hint}</p>
                        ) : null}
                        {check.samples.length > 0 ? (
                          <ul className="mt-2 space-y-1 text-xs">
                            {check.samples.map((sample, index) => (
                              <li key={`${check.code}-${index}`} className="text-zinc-600">
                                {sample.href ? (
                                  <a
                                    href={sample.href}
                                    className="text-emerald-800 underline-offset-2 hover:underline"
                                  >
                                    {sample.label}
                                  </a>
                                ) : (
                                  sample.label
                                )}
                              </li>
                            ))}
                          </ul>
                        ) : null}
                        {check.count > check.samples.length ? (
                          <p className="mt-1 text-xs text-zinc-400">
                            Показаны первые {check.samples.length} из {checkCount(check)}.
                          </p>
                        ) : null}
                      </div>
                    ))}
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

function SummaryTile({
  label,
  value,
  tone,
}: {
  label: string;
  value: number | string;
  tone: 'danger' | 'warning' | 'info' | 'success';
}) {
  return (
    <Card>
      <div className="flex items-center justify-between gap-2">
        <CardTitle>{label}</CardTitle>
        <Badge tone={tone}>{tone === 'success' ? 'OK' : label}</Badge>
      </div>
      <div className="mt-2 font-mono text-2xl font-semibold tabular-nums text-zinc-900">
        {typeof value === 'number' ? value.toLocaleString('ru-RU') : value}
      </div>
    </Card>
  );
}

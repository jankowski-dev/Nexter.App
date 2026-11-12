import { Button } from '@/components/ui/button';
import { Card, CardDescription, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { PageHeader } from '@/components/ui/page-header';
import { ErrorState, LoadingRows } from '@/components/ui/states';
import { downloadExport, fetchSettings, updateSettings } from '@/lib/api';
import { toRussianError } from '@/lib/error-messages';
import { formatDateTime } from '@/lib/format';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAutoDismissNotice } from '@/lib/use-auto-dismiss-notice';
import { Link } from '@tanstack/react-router';
import { useEffect, useState } from 'react';

export function SettingsPage() {
  const queryClient = useQueryClient();
  const settings = useQuery({ queryKey: ['settings'], queryFn: fetchSettings });
  const [timezone, setTimezone] = useState('Europe/Minsk');
  const [includeGas, setIncludeGas] = useState(true);
  const [notice, setNotice] = useState<string | null>(null);

  useAutoDismissNotice(notice, () => setNotice(null), 6000);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!settings.data) return;
    setTimezone(settings.data.timezone);
    setIncludeGas(settings.data.includeGasInCostBasis);
  }, [settings.data]);

  const saveMutation = useMutation({
    mutationFn: () => updateSettings({ timezone, includeGasInCostBasis: includeGas }),
    onSuccess: (data) => {
      queryClient.setQueryData(['settings'], data);
      setNotice('Настройки сохранены.');
      setError(null);
    },
    onError: (err) => {
      setNotice(null);
      setError(toRussianError(err, 'Не удалось сохранить настройки'));
    },
  });

  async function exportData(
    dataset: 'transactions' | 'positions' | 'trade-groups',
    format: 'csv' | 'json',
  ) {
    try {
      await downloadExport(dataset, format);
      setNotice(`Экспорт ${dataset}.${format} скачан.`);
      setError(null);
    } catch (err) {
      setNotice(null);
      setError(toRussianError(err, 'Не удалось скачать экспорт'));
    }
  }

  if (settings.isPending) {
    return (
      <div className="space-y-6">
        <PageHeader title="Настройки" />
        <LoadingRows rows={5} />
      </div>
    );
  }

  if (settings.isError || !settings.data) {
    return (
      <div className="space-y-6">
        <PageHeader title="Настройки" />
        <ErrorState
          message={toRussianError(settings.error, 'Не удалось загрузить настройки')}
          onRetry={() => void settings.refetch()}
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Настройки"
        subtitle="Общие параметры, безопасность, аудит, качество данных и экспорт."
      />

      {notice ? (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700">
          {notice}
        </div>
      ) : null}
      {error ? (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      ) : null}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Link to="/settings/security" className="block">
          <Card className="h-full transition-colors hover:border-emerald-300">
            <CardTitle>Безопасность</CardTitle>
            <CardDescription>Пароль, 2FA, recovery codes, сессии.</CardDescription>
          </Card>
        </Link>
        <Link to="/settings/accounts" className="block">
          <Card className="h-full transition-colors hover:border-emerald-300">
            <CardTitle>Счета</CardTitle>
            <CardDescription>Кошельки и системные счета учёта.</CardDescription>
          </Card>
        </Link>
        <Link to="/settings/audit" className="block">
          <Card className="h-full transition-colors hover:border-emerald-300">
            <CardTitle>Аудит</CardTitle>
            <CardDescription>Журнал действий и изменений.</CardDescription>
          </Card>
        </Link>
        <Link to="/settings/data-quality" className="block">
          <Card className="h-full transition-colors hover:border-emerald-300">
            <CardTitle>Качество данных</CardTitle>
            <CardDescription>Цены, сети, сборы и сверка.</CardDescription>
          </Card>
        </Link>
        <Link to="/import" className="block">
          <Card className="h-full transition-colors hover:border-emerald-300">
            <CardTitle>Импорт Notion</CardTitle>
            <CardDescription>Legacy-инструмент до clean cutover.</CardDescription>
          </Card>
        </Link>
      </div>

      <Card>
        <CardTitle>Общие</CardTitle>
        <CardDescription>Базовая валюта и метод учёта фиксированы: USD и FIFO.</CardDescription>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <label className="block text-sm text-zinc-600">
            Базовая валюта
            <Input className="mt-1" value={settings.data.baseCurrency} readOnly disabled />
          </label>
          <label className="block text-sm text-zinc-600">
            Метод списания
            <Input className="mt-1" value={settings.data.taxMethod} readOnly disabled />
          </label>
          <label className="block text-sm text-zinc-600">
            Часовой пояс (IANA)
            <Input
              className="mt-1"
              value={timezone}
              onChange={(event) => setTimezone(event.target.value)}
              placeholder="Europe/Minsk"
            />
            <span className="mt-1 block text-xs text-zinc-500">
              Используется для группировки P&L по месяцам; даты в интерфейсе показываются в часовом
              поясе браузера.
            </span>
          </label>
          <label className="mt-7 flex items-center gap-2 text-sm text-zinc-700">
            <input
              type="checkbox"
              checked={includeGas}
              onChange={(event) => setIncludeGas(event.target.checked)}
              className="h-4 w-4 rounded border-zinc-300 bg-white"
            />
            Включать газ в себестоимость
          </label>
        </div>
        <div className="mt-4 flex items-center gap-3">
          <Button
            onClick={() => saveMutation.mutate()}
            disabled={saveMutation.isPending || !timezone}
          >
            {saveMutation.isPending ? 'Сохраняю…' : 'Сохранить настройки'}
          </Button>
          <span className="text-xs text-zinc-500">
            Обновлено {formatDateTime(settings.data.updatedAt)}
          </span>
        </div>
      </Card>

      <Card>
        <CardTitle>Экспорт</CardTitle>
        <CardDescription>CSV или JSON для транзакций, позиций и торговых групп.</CardDescription>
        <div className="mt-4 grid gap-3 md:grid-cols-3">
          {(
            [
              ['transactions', 'Транзакции'],
              ['positions', 'Позиции'],
              ['trade-groups', 'Сделки'],
            ] as const
          ).map(([dataset, label]) => (
            <div key={dataset} className="rounded-lg border border-zinc-200 p-3">
              <div className="text-sm font-medium text-zinc-800">{label}</div>
              <div className="mt-2 flex gap-2">
                <Button
                  variant="secondary"
                  className="h-8 px-3 text-xs"
                  onClick={() => void exportData(dataset, 'csv')}
                >
                  CSV
                </Button>
                <Button
                  variant="ghost"
                  className="h-8 px-3 text-xs"
                  onClick={() => void exportData(dataset, 'json')}
                >
                  JSON
                </Button>
              </div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

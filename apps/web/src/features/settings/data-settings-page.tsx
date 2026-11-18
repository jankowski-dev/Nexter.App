import { Button } from '@/components/ui/button';
import { toRussianError } from '@/lib/error-messages';
import { downloadExport } from '@/lib/api';
import { Link } from '@tanstack/react-router';
import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { SettingsCard, SettingsPageShell } from './settings-form';

export function DataSettingsPage() {
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const exportMutation = useMutation({
    mutationFn: ({
      dataset,
      format,
    }: {
      dataset: 'transactions' | 'positions' | 'trade-groups';
      format: 'csv' | 'json';
    }) => downloadExport(dataset, format, {}),
    onSuccess: (_data, variables) => {
      setNotice(`Экспорт ${variables.dataset}.${variables.format} скачан.`);
      setError(null);
    },
    onError: (err) => {
      setNotice(null);
      setError(toRussianError(err, 'Не удалось скачать экспорт'));
    },
  });

  return (
    <SettingsPageShell
      title="Данные и экспорт"
      description="Справочники, выгрузки и импорт истории."
    >
      <SettingsCard title="Справочники">
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" asChild>
            <Link to="/settings/accounts">Счета</Link>
          </Button>
          <Button variant="secondary" asChild>
            <Link to="/import">Импорт Notion</Link>
          </Button>
        </div>
      </SettingsCard>
      <SettingsCard title="Экспорт" description="CSV или JSON для транзакций, позиций и сделок.">
        <div className="grid gap-3 md:grid-cols-3">
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
                  onClick={() => exportMutation.mutate({ dataset, format: 'csv' })}
                >
                  CSV
                </Button>
                <Button
                  variant="ghost"
                  className="h-8 px-3 text-xs"
                  onClick={() => exportMutation.mutate({ dataset, format: 'json' })}
                >
                  JSON
                </Button>
              </div>
            </div>
          ))}
        </div>
        {notice ? <p className="text-sm text-emerald-700">{notice}</p> : null}
        {error ? <p className="text-sm text-red-700">{error}</p> : null}
      </SettingsCard>
    </SettingsPageShell>
  );
}

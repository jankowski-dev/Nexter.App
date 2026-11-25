import { Button } from '@/components/ui/button';
import { toRussianError } from '@/lib/error-messages';
import { downloadExport } from '@/lib/api';
import { Link } from '@tanstack/react-router';
import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { SettingsCard, SettingsPageShell } from './settings-form';

const datasets = [
  ['transactions', 'Транзакции', 'Все покупки, продажи, переводы и корректировки.'],
  ['positions', 'Позиции', 'Открытые лоты и остатки по активам.'],
  ['trade-groups', 'Сделки', 'Группы сделок с реализованным и нереализованным P&L.'],
] as const;

export function ExportSettingsPage() {
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
      title="Экспорт"
      description="Выгрузка данных в CSV и JSON, а также импорт истории."
    >
      <SettingsCard
        title="Файлы"
        description="CSV удобен для таблиц, JSON — для полного набора полей и повторной обработки."
      >
        <div className="grid gap-3 md:grid-cols-3">
          {datasets.map(([dataset, label, description]) => (
            <div key={dataset} className="rounded-xl border border-zinc-200 p-4">
              <div className="text-sm font-semibold text-zinc-900">{label}</div>
              <p className="mt-1 text-xs leading-5 text-zinc-500">{description}</p>
              <div className="mt-3 flex gap-2">
                <Button
                  variant="secondary"
                  className="h-8 px-3 text-xs"
                  onClick={() => exportMutation.mutate({ dataset, format: 'csv' })}
                  disabled={exportMutation.isPending}
                >
                  CSV
                </Button>
                <Button
                  variant="ghost"
                  className="h-8 px-3 text-xs"
                  onClick={() => exportMutation.mutate({ dataset, format: 'json' })}
                  disabled={exportMutation.isPending}
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
      <SettingsCard title="Импорт">
        <p className="text-sm text-zinc-600">
          Перенос истории из Notion: счета, категории, операции и переводы. Импорт выполняется в
          отдельном разделе с предпросмотром и откатом.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" asChild>
            <Link to="/import">Открыть импорт</Link>
          </Button>
          <Button variant="ghost" asChild>
            <Link to="/settings/data">Счета и справочники</Link>
          </Button>
        </div>
      </SettingsCard>
    </SettingsPageShell>
  );
}

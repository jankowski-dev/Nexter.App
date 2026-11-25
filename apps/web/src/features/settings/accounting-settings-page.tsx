import { ErrorState, LoadingRows } from '@/components/ui/states';
import { Link } from '@tanstack/react-router';
import { toRussianError } from '@/lib/error-messages';
import type { ReportPeriodDefault, Settings } from '@nexter/contracts';
import { useState } from 'react';
import { SelectField, SettingsCard, SettingsPageShell, SettingsSaveBar } from './settings-form';
import { useSettings, useUpdateSettings } from './use-settings';

const periodOptions: ReadonlyArray<{ value: ReportPeriodDefault; label: string }> = [
  { value: '30d', label: '30 дней' },
  { value: '90d', label: '90 дней' },
  { value: '365d', label: '12 месяцев' },
  { value: 'ytd', label: 'С начала года' },
  { value: 'all', label: 'Всё время' },
];

export function AccountingSettingsPage() {
  const settings = useSettings();

  if (settings.isPending) return <LoadingRows rows={5} />;
  if (settings.isError) {
    return (
      <ErrorState
        message={toRussianError(settings.error, 'Не удалось загрузить настройки учёта')}
        onRetry={() => void settings.refetch()}
      />
    );
  }

  return <AccountingForm settings={settings.data} />;
}

function AccountingForm({ settings }: { settings: Settings }) {
  const update = useUpdateSettings();
  const [defaultReportPeriod, setDefaultReportPeriod] = useState<ReportPeriodDefault>(
    settings.defaultReportPeriod,
  );

  return (
    <SettingsPageShell
      title="Учёт и отчёты"
      description="Период статистики по умолчанию и ссылки на общие правила учёта."
    >
      <SettingsCard title="Отчёты">
        <SelectField
          label="Период статистики по умолчанию"
          hint="Применяется к странице статистики и отчётам."
          value={defaultReportPeriod}
          onChange={setDefaultReportPeriod}
          options={periodOptions}
        />
      </SettingsCard>
      <SettingsCard title="Правила учёта">
        <p className="text-sm text-zinc-600">
          Базовая валюта — USD, налоговый метод — FIFO. Это фиксированные продуктовые правила.
          Часовой пояс и включение газа в стоимость настраиваются в «Общих настройках».
        </p>
        <div className="flex flex-wrap gap-2">
          <Link
            className="inline-flex h-9 items-center rounded-lg border border-zinc-200 px-3 text-sm text-emerald-800 hover:border-emerald-300"
            to="/settings/general"
          >
            Общие настройки
          </Link>
          <Link
            className="inline-flex h-9 items-center rounded-lg border border-zinc-200 px-3 text-sm text-emerald-800 hover:border-emerald-300"
            to="/settings/export"
          >
            Экспорт
          </Link>
        </div>
      </SettingsCard>
      <SettingsSaveBar
        pending={update.isPending}
        saved={update.isSuccess}
        error={
          update.isError ? toRussianError(update.error, 'Не удалось сохранить настройки') : null
        }
        onSave={() => update.mutate({ defaultReportPeriod })}
      />
    </SettingsPageShell>
  );
}

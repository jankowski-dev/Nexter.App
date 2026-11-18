import { ErrorState, LoadingRows } from '@/components/ui/states';
import { Link } from '@tanstack/react-router';
import { toRussianError } from '@/lib/error-messages';
import type { ReportPeriodDefault, Settings } from '@nexter/contracts';
import { useState } from 'react';
import {
  SelectField,
  SettingsCard,
  SettingsPageShell,
  SettingsSaveBar,
  TextField,
  ToggleField,
} from './settings-form';
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
  const [values, setValues] = useState({
    timezone: settings.timezone,
    includeGasInCostBasis: settings.includeGasInCostBasis,
    defaultReportPeriod: settings.defaultReportPeriod,
  });

  return (
    <SettingsPageShell
      title="Учёт и отчёты"
      description="Часовой пояс, стоимость газа и период статистики."
    >
      <SettingsCard title="Общие">
        <TextField
          label="Часовой пояс (IANA)"
          hint="Например, Europe/Minsk. Влияет на границы месяцев и снапшоты."
          value={values.timezone}
          onChange={(value) => setValues((current) => ({ ...current, timezone: value }))}
        />
        <ToggleField
          label="Включать gas в стоимость покупки"
          hint="Применяется к новым сделкам; история не пересчитывается."
          checked={values.includeGasInCostBasis}
          onChange={(checked) =>
            setValues((current) => ({ ...current, includeGasInCostBasis: checked }))
          }
        />
        <SelectField
          label="Период статистики по умолчанию"
          value={values.defaultReportPeriod}
          onChange={(value) => setValues((current) => ({ ...current, defaultReportPeriod: value }))}
          options={periodOptions}
        />
      </SettingsCard>
      <SettingsCard title="Справочники">
        <p className="text-sm text-zinc-600">
          Базовая валюта — USD, налоговый метод — FIFO. Это фиксированные продуктовые правила,
          поэтому они не редактируются.
        </p>
        <Link className="text-sm text-emerald-800 hover:underline" to="/settings/data">
          Счета, экспорт и импорт →
        </Link>
      </SettingsCard>
      <SettingsSaveBar
        pending={update.isPending}
        saved={update.isSuccess}
        error={
          update.isError ? toRussianError(update.error, 'Не удалось сохранить настройки') : null
        }
        onSave={() =>
          update.mutate({
            timezone: values.timezone,
            includeGasInCostBasis: values.includeGasInCostBasis,
            defaultReportPeriod: values.defaultReportPeriod,
          })
        }
      />
    </SettingsPageShell>
  );
}

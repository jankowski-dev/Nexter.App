import { ErrorState, LoadingRows } from '@/components/ui/states';
import { toRussianError } from '@/lib/error-messages';
import type { Settings } from '@nexter/contracts';
import { useState } from 'react';
import {
  SettingsCard,
  SettingsPageShell,
  SettingsSaveBar,
  TextField,
  ToggleField,
} from './settings-form';
import { useSettings, useUpdateSettings } from './use-settings';

export function GeneralSettingsPage() {
  const settings = useSettings();

  if (settings.isPending) return <LoadingRows rows={4} />;
  if (settings.isError) {
    return (
      <ErrorState
        message={toRussianError(settings.error, 'Не удалось загрузить общие настройки')}
        onRetry={() => void settings.refetch()}
      />
    );
  }

  return <GeneralForm settings={settings.data} />;
}

function GeneralForm({ settings }: { settings: Settings }) {
  const update = useUpdateSettings();
  const [values, setValues] = useState({
    timezone: settings.timezone,
    includeGasInCostBasis: settings.includeGasInCostBasis,
  });

  return (
    <SettingsPageShell
      title="Общие настройки"
      description="Базовая валюта, метод учёта, часовой пояс и стоимость газа."
    >
      <SettingsCard title="Учёт">
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            label="Базовая валюта"
            hint="Фиксированное правило продукта."
            value={settings.baseCurrency}
            onChange={() => undefined}
            disabled
          />
          <TextField
            label="Метод списания"
            hint="Фиксированное правило продукта — FIFO."
            value={settings.taxMethod}
            onChange={() => undefined}
            disabled
          />
        </div>
        <p className="text-sm text-zinc-600">
          Базовая валюта и метод списания не редактируются: отчёты, P&L и экспорт считаются в USD по
          FIFO.
        </p>
      </SettingsCard>
      <SettingsCard title="Время и стоимость">
        <TextField
          label="Часовой пояс (IANA)"
          hint="Например, Europe/Minsk. Влияет на границы месяцев, снимки капитала и время дайджеста ViberBot."
          value={values.timezone}
          onChange={(value) => setValues((current) => ({ ...current, timezone: value }))}
        />
        <ToggleField
          label="Включать газ в стоимость покупки"
          hint="Применяется к новым сделкам; история не пересчитывается."
          checked={values.includeGasInCostBasis}
          onChange={(checked) =>
            setValues((current) => ({ ...current, includeGasInCostBasis: checked }))
          }
        />
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
          })
        }
      />
    </SettingsPageShell>
  );
}

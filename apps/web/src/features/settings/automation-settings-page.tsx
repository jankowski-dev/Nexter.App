import { ErrorState, LoadingRows } from '@/components/ui/states';
import { toRussianError } from '@/lib/error-messages';
import type { AutomationMode, Settings } from '@nexter/contracts';
import { useState } from 'react';
import {
  NumberField,
  SelectField,
  SettingsCard,
  SettingsPageShell,
  SettingsSaveBar,
  ToggleField,
} from './settings-form';
import { useSettings, useUpdateSettings } from './use-settings';

const modeOptions: ReadonlyArray<{ value: AutomationMode; label: string }> = [
  { value: 'dry_run', label: 'Dry-run: только сигналы' },
  { value: 'proposal', label: 'Предложение: уведомление + карточка' },
];

export function AutomationSettingsPage() {
  const settings = useSettings();

  if (settings.isPending) return <LoadingRows rows={8} />;
  if (settings.isError) {
    return (
      <ErrorState
        message={toRussianError(settings.error, 'Не удалось загрузить настройки автоматизации')}
        onRetry={() => void settings.refetch()}
      />
    );
  }

  return <AutomationForm settings={settings.data} />;
}

function AutomationForm({ settings }: { settings: Settings }) {
  const update = useUpdateSettings();
  const [values, setValues] = useState({
    automationEnabled: settings.automationEnabled,
    automationMode: settings.automationMode,
    automationMaxOrderUsd: settings.automationMaxOrderUsd,
    automationMaxDailyUsd: settings.automationMaxDailyUsd,
    automationMaxActionsPerDay: String(settings.automationMaxActionsPerDay),
    automationCooldownMinutes: String(settings.automationCooldownMinutes),
    automationDefaultStopLossPct: String(settings.automationDefaultStopLossPct),
    automationDefaultTakeProfitPct: String(settings.automationDefaultTakeProfitPct),
    automationDefaultTrailingPct: String(settings.automationDefaultTrailingPct),
    automationDefaultBuyDropPct: String(settings.automationDefaultBuyDropPct),
    automationDefaultBuyAmountUsd: settings.automationDefaultBuyAmountUsd,
  });

  return (
    <SettingsPageShell
      title="Автоматизация"
      description="Dry-run и предложения. Сервер не подписывает транзакции: владелец подтверждает действие в кошельке."
    >
      <SettingsCard
        title="Режим"
        description="Выключено по умолчанию. Предложения создают уведомление и ссылку на сделку."
      >
        <ToggleField
          label="Автоматизация включена"
          hint="Глобальный выключатель для всех правил."
          checked={values.automationEnabled}
          onChange={(checked) =>
            setValues((current) => ({ ...current, automationEnabled: checked }))
          }
        />
        <SelectField
          label="Режим по умолчанию"
          value={values.automationMode}
          onChange={(value) => setValues((current) => ({ ...current, automationMode: value }))}
          options={modeOptions}
        />
      </SettingsCard>

      <SettingsCard title="Лимиты">
        <div className="grid gap-4 sm:grid-cols-2">
          <NumberField
            label="Максимум на одно действие"
            hint="Для авто-покупки. Закрытия по стоп-лоссу не блокируются этим лимитом."
            value={values.automationMaxOrderUsd}
            onChange={(value) =>
              setValues((current) => ({ ...current, automationMaxOrderUsd: value }))
            }
            min={1}
            suffix="USD"
          />
          <NumberField
            label="Максимум в день"
            hint="Сумма авто-покупок за сутки."
            value={values.automationMaxDailyUsd}
            onChange={(value) =>
              setValues((current) => ({ ...current, automationMaxDailyUsd: value }))
            }
            min={1}
            suffix="USD"
          />
          <NumberField
            label="Действий в день"
            hint="Общий счётчик срабатываний."
            value={values.automationMaxActionsPerDay}
            onChange={(value) =>
              setValues((current) => ({ ...current, automationMaxActionsPerDay: value }))
            }
            min={1}
            max={100}
          />
          <NumberField
            label="Пауза между срабатываниями"
            hint="Минимум 5 минут."
            value={values.automationCooldownMinutes}
            onChange={(value) =>
              setValues((current) => ({ ...current, automationCooldownMinutes: value }))
            }
            min={5}
            max={1440}
            suffix="мин"
          />
        </div>
      </SettingsCard>

      <SettingsCard title="Значения по умолчанию для новых правил">
        <div className="grid gap-4 sm:grid-cols-2">
          <NumberField
            label="Стоп-лосс"
            value={values.automationDefaultStopLossPct}
            onChange={(value) =>
              setValues((current) => ({ ...current, automationDefaultStopLossPct: value }))
            }
            min={1}
            max={90}
            suffix="%"
          />
          <NumberField
            label="Тейк-профит"
            value={values.automationDefaultTakeProfitPct}
            onChange={(value) =>
              setValues((current) => ({ ...current, automationDefaultTakeProfitPct: value }))
            }
            min={1}
            max={1000}
            suffix="%"
          />
          <NumberField
            label="Трейлинг"
            value={values.automationDefaultTrailingPct}
            onChange={(value) =>
              setValues((current) => ({ ...current, automationDefaultTrailingPct: value }))
            }
            min={1}
            max={90}
            suffix="%"
          />
          <NumberField
            label="Падение для авто-покупки"
            value={values.automationDefaultBuyDropPct}
            onChange={(value) =>
              setValues((current) => ({ ...current, automationDefaultBuyDropPct: value }))
            }
            min={1}
            max={90}
            suffix="%"
          />
          <NumberField
            label="Сумма авто-покупки"
            value={values.automationDefaultBuyAmountUsd}
            onChange={(value) =>
              setValues((current) => ({ ...current, automationDefaultBuyAmountUsd: value }))
            }
            min={1}
            suffix="USD"
          />
        </div>
      </SettingsCard>

      <SettingsSaveBar
        pending={update.isPending}
        saved={update.isSuccess}
        error={
          update.isError ? toRussianError(update.error, 'Не удалось сохранить настройки') : null
        }
        onSave={() =>
          update.mutate({
            automationEnabled: values.automationEnabled,
            automationMode: values.automationMode,
            automationMaxOrderUsd: values.automationMaxOrderUsd,
            automationMaxDailyUsd: values.automationMaxDailyUsd,
            automationMaxActionsPerDay: Number(values.automationMaxActionsPerDay),
            automationCooldownMinutes: Number(values.automationCooldownMinutes),
            automationDefaultStopLossPct: Number(values.automationDefaultStopLossPct),
            automationDefaultTakeProfitPct: Number(values.automationDefaultTakeProfitPct),
            automationDefaultTrailingPct: Number(values.automationDefaultTrailingPct),
            automationDefaultBuyDropPct: Number(values.automationDefaultBuyDropPct),
            automationDefaultBuyAmountUsd: values.automationDefaultBuyAmountUsd,
          })
        }
      />
    </SettingsPageShell>
  );
}

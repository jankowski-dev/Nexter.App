import { ErrorState, LoadingRows } from '@/components/ui/states';
import { toRussianError } from '@/lib/error-messages';
import type { Settings } from '@nexter/contracts';
import { useState } from 'react';
import {
  NumberField,
  SettingsCard,
  SettingsPageShell,
  SettingsSaveBar,
  ToggleField,
} from './settings-form';
import { useSettings, useUpdateSettings } from './use-settings';

export function NotificationsSettingsPage() {
  const settings = useSettings();

  if (settings.isPending) return <LoadingRows rows={4} />;
  if (settings.isError) {
    return (
      <ErrorState
        message={toRussianError(settings.error, 'Не удалось загрузить настройки уведомлений')}
        onRetry={() => void settings.refetch()}
      />
    );
  }

  return <NotificationsForm settings={settings.data} />;
}

function NotificationsForm({ settings }: { settings: Settings }) {
  const update = useUpdateSettings();
  const [values, setValues] = useState({
    notifyBotStopped: settings.notifyBotStopped,
    notifyPositionsClosed: settings.notifyPositionsClosed,
    notifyTradesClosed: settings.notifyTradesClosed,
    notificationsPollSeconds: String(settings.notificationsPollSeconds),
  });

  return (
    <SettingsPageShell
      title="Уведомления"
      description="Какие события показывать и как часто обновлять список."
    >
      <SettingsCard title="События">
        <ToggleField
          label="Остановка робота"
          hint="Ошибка стратегии или автоматическая остановка."
          checked={values.notifyBotStopped}
          onChange={(checked) =>
            setValues((current) => ({ ...current, notifyBotStopped: checked }))
          }
        />
        <ToggleField
          label="Закрытие сделок"
          hint="Ручное/ончейн-закрытие и автоматическая продажа робота. В уведомлении будет P&L."
          checked={values.notifyTradesClosed}
          onChange={(checked) =>
            setValues((current) => ({ ...current, notifyTradesClosed: checked }))
          }
        />
        <ToggleField
          label="Закрытие всех позиций робота"
          hint="Ручное или автоматическое закрытие всех позиций робота."
          checked={values.notifyPositionsClosed}
          onChange={(checked) =>
            setValues((current) => ({ ...current, notifyPositionsClosed: checked }))
          }
        />
      </SettingsCard>
      <SettingsCard title="Обновление">
        <NumberField
          label="Интервал обновления списка"
          hint="5–600 секунд."
          value={values.notificationsPollSeconds}
          onChange={(value) =>
            setValues((current) => ({ ...current, notificationsPollSeconds: value }))
          }
          min={5}
          max={600}
          suffix="сек"
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
            notifyBotStopped: values.notifyBotStopped,
            notifyPositionsClosed: values.notifyPositionsClosed,
            notifyTradesClosed: values.notifyTradesClosed,
            notificationsPollSeconds: Number(values.notificationsPollSeconds),
          })
        }
      />
    </SettingsPageShell>
  );
}

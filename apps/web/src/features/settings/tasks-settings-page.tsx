import { ErrorState, LoadingRows } from '@/components/ui/states';
import { toRussianError } from '@/lib/error-messages';
import type { Settings } from '@nexter/contracts';
import { useState } from 'react';
import {
  NumberField,
  SettingsCard,
  SettingsPageShell,
  SettingsSaveBar,
  TextField,
} from './settings-form';
import { useSettings, useUpdateSettings } from './use-settings';

export function TasksSettingsPage() {
  const settings = useSettings();

  if (settings.isPending) return <LoadingRows rows={4} />;
  if (settings.isError) {
    return (
      <ErrorState
        message={toRussianError(settings.error, 'Не удалось загрузить настройки задач')}
        onRetry={() => void settings.refetch()}
      />
    );
  }

  return <TasksForm settings={settings.data} />;
}

function TasksForm({ settings }: { settings: Settings }) {
  const update = useUpdateSettings();
  const [values, setValues] = useState({
    taskReminderLeadMinutes: String(settings.taskReminderLeadMinutes),
    taskDefaultDueTime: settings.taskDefaultDueTime,
    autosaveIntervalSeconds: String(settings.autosaveIntervalSeconds),
  });

  const set = (key: keyof typeof values, value: string) =>
    setValues((current) => ({ ...current, [key]: value }));

  return (
    <SettingsPageShell
      title="Задачи и заметки"
      description="Напоминания, время задачи по умолчанию и автосохранение."
    >
      <SettingsCard title="Задачи">
        <div className="grid gap-4 sm:grid-cols-2">
          <NumberField
            label="Напоминание заранее"
            hint="1–60 минут. Используется ботом Viber."
            value={values.taskReminderLeadMinutes}
            onChange={(value) => set('taskReminderLeadMinutes', value)}
            min={1}
            max={60}
            suffix="мин"
          />
          <TextField
            label="Время задачи по умолчанию"
            hint="Формат HH:MM. Применяется к новым задачам."
            type="time"
            value={values.taskDefaultDueTime}
            onChange={(value) => set('taskDefaultDueTime', value)}
          />
        </div>
      </SettingsCard>
      <SettingsCard title="Автосохранение">
        <NumberField
          label="Интервал автосохранения"
          hint="5–60 секунд. Общий для заметок и задач."
          value={values.autosaveIntervalSeconds}
          onChange={(value) => set('autosaveIntervalSeconds', value)}
          min={5}
          max={60}
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
            taskReminderLeadMinutes: Number(values.taskReminderLeadMinutes),
            taskDefaultDueTime: values.taskDefaultDueTime,
            autosaveIntervalSeconds: Number(values.autosaveIntervalSeconds),
          })
        }
      />
    </SettingsPageShell>
  );
}

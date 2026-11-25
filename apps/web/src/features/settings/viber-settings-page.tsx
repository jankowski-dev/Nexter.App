import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import { ErrorState, LoadingRows } from '@/components/ui/states';
import { fetchViberNotifications, fetchViberStatus, sendViberTest } from '@/lib/api';
import { toRussianError } from '@/lib/error-messages';
import { formatDateTime } from '@/lib/format';
import type { Settings, ViberFrequency, ViberNotificationStatus } from '@nexter/contracts';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useState } from 'react';
import {
  SettingsCard,
  SettingsPageShell,
  SettingsSaveBar,
  TextField,
  ToggleField,
} from './settings-form';
import { useSettings, useUpdateSettings } from './use-settings';

const frequencyLabels: Record<ViberFrequency, string> = {
  instant: 'Сразу',
  hourly: 'Раз в час',
  daily: 'Раз в день',
};

const statusLabels: Record<ViberNotificationStatus, string> = {
  pending: 'В очереди',
  sent: 'Доставлено',
  failed: 'Ошибка',
};

function statusTone(status: ViberNotificationStatus): 'success' | 'warning' | 'danger' {
  if (status === 'sent') return 'success';
  if (status === 'pending') return 'warning';
  return 'danger';
}

export function ViberSettingsPage() {
  const settings = useSettings();

  if (settings.isPending) return <LoadingRows rows={5} />;
  if (settings.isError) {
    return (
      <ErrorState
        message={toRussianError(settings.error, 'Не удалось загрузить настройки ViberBot')}
        onRetry={() => void settings.refetch()}
      />
    );
  }

  return <ViberForm settings={settings.data} />;
}

function ViberForm({ settings }: { settings: Settings }) {
  const update = useUpdateSettings();
  const status = useQuery({
    queryKey: ['viber-status'],
    queryFn: fetchViberStatus,
    refetchInterval: 15_000,
  });
  const deliveries = useQuery({
    queryKey: ['viber-notifications'],
    queryFn: () => fetchViberNotifications(10),
    refetchInterval: 15_000,
  });
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const test = useMutation({
    mutationFn: sendViberTest,
    onSuccess: async () => {
      setError(null);
      setNotice('Тестовое сообщение поставлено в очередь. Бот отправит его при следующем опросе.');
      await Promise.all([status.refetch(), deliveries.refetch()]);
    },
    onError: (err) => {
      setNotice(null);
      setError(toRussianError(err, 'Не удалось поставить тест в очередь'));
    },
  });
  const [values, setValues] = useState({
    viberNotificationsEnabled: settings.viberNotificationsEnabled,
    viberTradeClosedEnabled: settings.viberTradeClosedEnabled,
    viberBotStoppedEnabled: settings.viberBotStoppedEnabled,
    viberFrequency: settings.viberFrequency,
    viberDigestTime: settings.viberDigestTime,
  });

  return (
    <SettingsPageShell
      title="ViberBot"
      description="Доставка уведомлений о сделках и остановках роботов через Viber."
    >
      {status.isError ? (
        <ErrorState
          message={toRussianError(status.error, 'Не удалось загрузить статус ViberBot')}
          onRetry={() => void status.refetch()}
        />
      ) : null}

      <SettingsCard
        title="Подключение"
        description="Секреты Viber хранятся только в сервисе Nexter.Bot."
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-xl border border-zinc-200 bg-zinc-50/70 p-3">
            <div className="text-[11px] uppercase tracking-wide text-zinc-500">API-токен</div>
            <div className="mt-1 text-sm font-medium text-zinc-900">
              {status.data?.configured ? 'Настроен' : 'Не настроен'}
            </div>
            <div className="mt-1 text-xs text-zinc-500">
              {status.data?.configured
                ? 'API принимает запросы бота по BOT_API_TOKEN.'
                : 'Задайте BOT_API_TOKEN в API и NEXTER_BOT_TOKEN в Nexter.Bot.'}
            </div>
          </div>
          <div className="rounded-xl border border-zinc-200 bg-zinc-50/70 p-3">
            <div className="text-[11px] uppercase tracking-wide text-zinc-500">Очередь</div>
            <div className="mt-1 text-sm font-medium text-zinc-900">
              {status.isPending ? '—' : `${status.data?.pending ?? 0} в очереди`}
            </div>
            <div className="mt-1 text-xs text-zinc-500">
              Доставлено за 24 ч: {status.data?.sent24h ?? 0} · ошибок:{' '}
              {status.data?.failed24h ?? 0}
            </div>
          </div>
          <div className="rounded-xl border border-zinc-200 bg-zinc-50/70 p-3">
            <div className="text-[11px] uppercase tracking-wide text-zinc-500">
              Последняя доставка
            </div>
            <div className="mt-1 text-sm font-medium text-zinc-900">
              {status.data?.lastSentAt ? formatDateTime(status.data.lastSentAt) : 'Пока нет'}
            </div>
          </div>
          <div className="rounded-xl border border-zinc-200 bg-zinc-50/70 p-3">
            <div className="text-[11px] uppercase tracking-wide text-zinc-500">
              Последняя ошибка
            </div>
            <div className="mt-1 text-sm font-medium text-red-700">
              {status.data?.lastError ?? 'Нет'}
            </div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="secondary"
            onClick={() => test.mutate()}
            disabled={test.isPending || !status.data?.configured}
          >
            {test.isPending ? 'Отправляю…' : 'Отправить тест'}
          </Button>
          <span className="text-xs text-zinc-500">
            Тест проходит через общую очередь и не требует отдельного вебхука.
          </span>
        </div>
        {notice ? <p className="text-sm text-emerald-700">{notice}</p> : null}
        {error ? <p className="text-sm text-red-700">{error}</p> : null}
      </SettingsCard>

      <SettingsCard title="События">
        <ToggleField
          label="Отправлять уведомления в Viber"
          hint="Главный переключатель канала. In-app уведомления настраиваются отдельно."
          checked={values.viberNotificationsEnabled}
          onChange={(checked) =>
            setValues((current) => ({ ...current, viberNotificationsEnabled: checked }))
          }
        />
        <ToggleField
          label="Закрытие сделок"
          hint="Ручные и ончейн-закрытия, а также автоматические продажи роботов. В сообщении будет P&L."
          checked={values.viberTradeClosedEnabled}
          onChange={(checked) =>
            setValues((current) => ({ ...current, viberTradeClosedEnabled: checked }))
          }
        />
        <ToggleField
          label="Остановка робота"
          hint="Ошибка стратегии, некорректные параметры или остановка владельцем."
          checked={values.viberBotStoppedEnabled}
          onChange={(checked) =>
            setValues((current) => ({ ...current, viberBotStoppedEnabled: checked }))
          }
        />
      </SettingsCard>

      <SettingsCard title="Периодичность">
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block text-sm text-zinc-600">
            Частота отправки
            <Select
              className="mt-1"
              value={values.viberFrequency}
              onChange={(event) =>
                setValues((current) => ({
                  ...current,
                  viberFrequency: event.target.value as ViberFrequency,
                }))
              }
            >
              {(Object.keys(frequencyLabels) as ViberFrequency[]).map((value) => (
                <option key={value} value={value}>
                  {frequencyLabels[value]}
                </option>
              ))}
            </Select>
            <span className="mt-1 block text-[11px] text-zinc-500">
              «Раз в час» и «Раз в день» собирают события в одну сводку.
            </span>
          </label>
          <TextField
            label="Время дневной сводки"
            hint="Формат HH:MM, часовой пояс из «Общих настроек»."
            type="time"
            value={values.viberDigestTime}
            disabled={values.viberFrequency !== 'daily'}
            onChange={(value) => setValues((current) => ({ ...current, viberDigestTime: value }))}
          />
        </div>
      </SettingsCard>

      <SettingsCard title="Последние доставки" description="Последние 10 сообщений очереди.">
        {deliveries.isPending ? <LoadingRows rows={3} /> : null}
        {deliveries.isError ? (
          <ErrorState
            message={toRussianError(deliveries.error, 'Не удалось загрузить доставки')}
            onRetry={() => void deliveries.refetch()}
          />
        ) : null}
        {!deliveries.isPending && !deliveries.isError ? (
          (deliveries.data?.data ?? []).length === 0 ? (
            <p className="text-sm text-zinc-500">Доставок пока нет.</p>
          ) : (
            <div className="space-y-2">
              {(deliveries.data?.data ?? []).map((item) => (
                <div
                  key={item.id}
                  className="flex flex-wrap items-start justify-between gap-3 rounded-xl border border-zinc-200 p-3"
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium text-zinc-900">{item.title}</span>
                      <Badge tone={statusTone(item.status)}>{statusLabels[item.status]}</Badge>
                    </div>
                    <p className="mt-1 text-xs text-zinc-600">{item.body}</p>
                    <p className="mt-1 text-[11px] text-zinc-400">
                      {formatDateTime(item.createdAt)}
                      {item.sentAt ? ` · отправлено ${formatDateTime(item.sentAt)}` : ''}
                    </p>
                  </div>
                  {item.error ? <span className="text-xs text-red-700">{item.error}</span> : null}
                </div>
              ))}
            </div>
          )
        ) : null}
      </SettingsCard>

      <SettingsCard title="Связанные настройки">
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" asChild>
            <Link to="/settings/tasks">Напоминания о задачах</Link>
          </Button>
          <Button variant="secondary" asChild>
            <Link to="/settings/ai">Аудиозаметки и ИИ</Link>
          </Button>
          <Button variant="ghost" asChild>
            <Link to="/settings/notifications">In-app уведомления</Link>
          </Button>
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
            viberNotificationsEnabled: values.viberNotificationsEnabled,
            viberTradeClosedEnabled: values.viberTradeClosedEnabled,
            viberBotStoppedEnabled: values.viberBotStoppedEnabled,
            viberFrequency: values.viberFrequency,
            viberDigestTime: values.viberDigestTime,
          })
        }
      />
    </SettingsPageShell>
  );
}

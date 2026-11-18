import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardDescription, CardTitle } from '@/components/ui/card';
import { PageHeader } from '@/components/ui/page-header';
import { LoadingRows } from '@/components/ui/states';
import { NumberField, SettingsCard, SettingsSaveBar } from './settings-form';
import { useSettings, useUpdateSettings } from './use-settings';
import { Select } from '@/components/ui/select';
import { ChainToggle } from '@/components/chain-toggle';
import { useAppLock } from '@/lib/app-lock';
import {
  idleLockOptions,
  readIdleLockMinutes,
  readTheme,
  subscribeUiPreference,
  writeIdleLockMinutes,
  writeTheme,
  type ThemePreference,
} from '@/lib/ui-preferences';
import { useWallet } from '@/lib/wallet-context';
import { useEffect, useState } from 'react';
import { toRussianError } from '@/lib/error-messages';

function PollingSettingsCard() {
  const settings = useSettings();
  const update = useUpdateSettings();
  const [values, setValues] = useState<Record<string, string> | null>(null);

  useEffect(() => {
    if (!settings.data || values) return;
    setValues({
      dashboardPollSeconds: String(settings.data.dashboardPollSeconds),
      portfolioPollSeconds: String(settings.data.portfolioPollSeconds),
      watchlistPollSeconds: String(settings.data.watchlistPollSeconds),
      reportsPollSeconds: String(settings.data.reportsPollSeconds),
      notificationsPollSeconds: String(settings.data.notificationsPollSeconds),
    });
  }, [settings.data, values]);

  if (settings.isPending || !values) {
    return (
      <Card>
        <CardTitle>Обновление данных</CardTitle>
        <div className="mt-4">
          <LoadingRows rows={3} />
        </div>
      </Card>
    );
  }

  const set = (key: keyof typeof values, value: string) =>
    setValues((current) => (current ? { ...current, [key]: value } : current));

  return (
    <SettingsCard
      title="Обновление данных"
      description="Как часто страницы запрашивают свежие данные. Слишком частые запросы создают нагрузку."
    >
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <NumberField
          label="Дашборд"
          value={values.dashboardPollSeconds}
          onChange={(value) => set('dashboardPollSeconds', value)}
          min={5}
          max={300}
          suffix="сек"
        />
        <NumberField
          label="Портфель"
          value={values.portfolioPollSeconds}
          onChange={(value) => set('portfolioPollSeconds', value)}
          min={5}
          max={300}
          suffix="сек"
        />
        <NumberField
          label="Токены"
          value={values.watchlistPollSeconds}
          onChange={(value) => set('watchlistPollSeconds', value)}
          min={5}
          max={600}
          suffix="сек"
        />
        <NumberField
          label="Статистика"
          value={values.reportsPollSeconds}
          onChange={(value) => set('reportsPollSeconds', value)}
          min={5}
          max={600}
          suffix="сек"
        />
        <NumberField
          label="Уведомления"
          value={values.notificationsPollSeconds}
          onChange={(value) => set('notificationsPollSeconds', value)}
          min={5}
          max={600}
          suffix="сек"
        />
      </div>
      <SettingsSaveBar
        pending={update.isPending}
        saved={update.isSuccess}
        error={
          update.isError ? toRussianError(update.error, 'Не удалось сохранить настройки') : null
        }
        onSave={() =>
          update.mutate({
            dashboardPollSeconds: Number(values.dashboardPollSeconds),
            portfolioPollSeconds: Number(values.portfolioPollSeconds),
            watchlistPollSeconds: Number(values.watchlistPollSeconds),
            reportsPollSeconds: Number(values.reportsPollSeconds),
            notificationsPollSeconds: Number(values.notificationsPollSeconds),
          })
        }
      />
    </SettingsCard>
  );
}

export function InterfaceSettingsPage() {
  const appLock = useAppLock();
  const wallet = useWallet();
  const [theme, setTheme] = useState<ThemePreference>(() => readTheme());
  const [idleMinutes, setIdleMinutes] = useState(() => readIdleLockMinutes());

  useEffect(() => subscribeUiPreference('nexter-theme', () => setTheme(readTheme())), []);
  useEffect(
    () =>
      subscribeUiPreference('nexter-idle-lock-minutes', () =>
        setIdleMinutes(readIdleLockMinutes()),
      ),
    [],
  );

  function changeTheme(next: ThemePreference) {
    writeTheme(next);
    setTheme(next);
  }

  function changeIdleMinutes(next: number) {
    writeIdleLockMinutes(next);
    setIdleMinutes(next);
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Интерфейс и поведение"
        subtitle="Оформление, блокировка по неактивности и сеть кошелька. Эти параметры хранятся в этом браузере."
      />

      <Card>
        <CardTitle>Внешний вид</CardTitle>
        <CardDescription>
          Тема применяется сразу и запоминается на этом устройстве. Переключатель также доступен в
          шапке.
        </CardDescription>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button
            variant={theme === 'light' ? 'primary' : 'secondary'}
            onClick={() => changeTheme('light')}
            aria-pressed={theme === 'light'}
          >
            Светлая
          </Button>
          <Button
            variant={theme === 'dark' ? 'primary' : 'secondary'}
            onClick={() => changeTheme('dark')}
            aria-pressed={theme === 'dark'}
          >
            Тёмная
          </Button>
        </div>
      </Card>

      <Card>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle>Блокировка по неактивности</CardTitle>
          <Badge tone={appLock.hasPin ? 'success' : 'neutral'}>
            {appLock.hasPin ? 'Код установлен' : 'Код не установлен'}
          </Badge>
        </div>
        <CardDescription>
          Если в приложении нет активности — движения мыши, нажатий клавиш или касаний — экран
          блокируется и просит 6-значный код. Работает только при установленном коде.
        </CardDescription>
        <div className="mt-4 grid gap-4 md:grid-cols-[minmax(0,320px)_1fr] md:items-end">
          <label className="block text-sm text-zinc-600">
            Блокировать через
            <Select
              className="mt-1"
              value={String(idleMinutes)}
              onChange={(event) => changeIdleMinutes(Number(event.target.value))}
              aria-label="Таймаут автоблокировки"
              disabled={!appLock.hasPin}
            >
              {idleLockOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
          </label>
          <div className="flex flex-wrap gap-2">
            <Button variant={appLock.hasPin ? 'secondary' : 'primary'} onClick={appLock.openSetup}>
              {appLock.hasPin ? 'Изменить код' : 'Установить код'}
            </Button>
            {appLock.hasPin ? (
              <Button variant="secondary" onClick={appLock.lock}>
                Заблокировать сейчас
              </Button>
            ) : null}
          </div>
        </div>
        {!appLock.hasPin ? (
          <p className="mt-3 text-xs text-zinc-500">
            Сначала установите код — без него автоматическая блокировка не включается.
          </p>
        ) : null}
      </Card>

      <PollingSettingsCard />

      <Card>
        <CardTitle>Сеть кошелька</CardTitle>
        <CardDescription>
          Выбирает сеть для подключения WalletConnect, on-chain свапов и ручных операций. Не
          фильтрует портфель, сделки и токены — они показывают все сети.
        </CardDescription>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <ChainToggle value={wallet.chain} onChange={wallet.selectChain} />
          <span className="text-xs text-zinc-500">
            {wallet.connected
              ? 'Кошелёк подключён: смена сети переключит сеть в кошельке.'
              : 'Кошелёк не подключён: сеть запомнится для следующего подключения.'}
          </span>
        </div>
      </Card>
    </div>
  );
}

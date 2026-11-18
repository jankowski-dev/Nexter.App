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

export function BotsSettingsPage() {
  const settings = useSettings();

  if (settings.isPending) return <LoadingRows rows={8} />;
  if (settings.isError) {
    return (
      <ErrorState
        message={toRussianError(settings.error, 'Не удалось загрузить настройки роботов')}
        onRetry={() => void settings.refetch()}
      />
    );
  }

  return <BotsForm settings={settings.data} />;
}

function BotsForm({ settings }: { settings: Settings }) {
  const update = useUpdateSettings();
  const [values, setValues] = useState({
    botTickIntervalSeconds: String(settings.botTickIntervalSeconds),
    botQuoteMaxAgeSeconds: String(settings.botQuoteMaxAgeSeconds),
    botDefaultBudgetUsd: settings.botDefaultBudgetUsd,
    botDefaultMaxPositions: String(settings.botDefaultMaxPositions),
    botDefaultPositionSizePct: String(settings.botDefaultPositionSizePct),
    botDefaultFeeBps: String(settings.botDefaultFeeBps),
    botDefaultSlippageBps: String(settings.botDefaultSlippageBps),
    botDefaultDailyLossPct: String(settings.botDefaultDailyLossPct),
    botDefaultCooldownMinutes: String(settings.botDefaultCooldownMinutes),
    backtestDefaultCapitalUsd: settings.backtestDefaultCapitalUsd,
    backtestDefaultFeeBps: String(settings.backtestDefaultFeeBps),
    backtestDefaultSlippageBps: String(settings.backtestDefaultSlippageBps),
    backtestDefaultDays: String(settings.backtestDefaultDays),
    backtestDefaultStopLoss: settings.backtestDefaultStopLoss,
    backtestDefaultTakeProfit: settings.backtestDefaultTakeProfit,
    backtestDefaultReinvest: settings.backtestDefaultReinvest,
  });

  const set = (key: keyof typeof values, value: string | boolean) =>
    setValues((current) => ({ ...current, [key]: value }));

  return (
    <SettingsPageShell
      title="Роботы и бэктест"
      description="Параметры бумажной торговли и значения по умолчанию для новых ботов."
    >
      <SettingsCard title="Исполнение" description="Частота тиков и допустимый возраст котировки.">
        <div className="grid gap-4 sm:grid-cols-2">
          <NumberField
            label="Интервал тика"
            hint="15–3600 секунд. Влияет на скорость реакции стратегий."
            value={values.botTickIntervalSeconds}
            onChange={(value) => set('botTickIntervalSeconds', value)}
            min={15}
            max={3600}
            suffix="сек"
          />
          <NumberField
            label="Максимальный возраст котировки"
            hint="60–3600 секунд. Старше — бот пропускает сигнал."
            value={values.botQuoteMaxAgeSeconds}
            onChange={(value) => set('botQuoteMaxAgeSeconds', value)}
            min={60}
            max={3600}
            suffix="сек"
          />
        </div>
      </SettingsCard>

      <SettingsCard title="Новый бот по умолчанию">
        <div className="grid gap-4 sm:grid-cols-2">
          <NumberField
            label="Бюджет"
            value={values.botDefaultBudgetUsd}
            onChange={(value) => set('botDefaultBudgetUsd', value)}
            min={100}
            suffix="USD"
          />
          <NumberField
            label="Максимум позиций"
            value={values.botDefaultMaxPositions}
            onChange={(value) => set('botDefaultMaxPositions', value)}
            min={1}
            max={20}
          />
          <NumberField
            label="Размер позиции"
            value={values.botDefaultPositionSizePct}
            onChange={(value) => set('botDefaultPositionSizePct', value)}
            min={1}
            max={100}
            suffix="%"
          />
          <NumberField
            label="Комиссия"
            value={values.botDefaultFeeBps}
            onChange={(value) => set('botDefaultFeeBps', value)}
            min={0}
            max={500}
            suffix="bps"
          />
          <NumberField
            label="Slippage"
            value={values.botDefaultSlippageBps}
            onChange={(value) => set('botDefaultSlippageBps', value)}
            min={0}
            max={500}
            suffix="bps"
          />
          <NumberField
            label="Дневной лимит убытка"
            value={values.botDefaultDailyLossPct}
            onChange={(value) => set('botDefaultDailyLossPct', value)}
            min={0}
            max={100}
            suffix="%"
          />
          <NumberField
            label="Пауза после сделки"
            value={values.botDefaultCooldownMinutes}
            onChange={(value) => set('botDefaultCooldownMinutes', value)}
            min={0}
            max={1440}
            suffix="мин"
          />
        </div>
      </SettingsCard>

      <SettingsCard title="Бэктест по умолчанию">
        <div className="grid gap-4 sm:grid-cols-2">
          <NumberField
            label="Стартовый капитал"
            value={values.backtestDefaultCapitalUsd}
            onChange={(value) => set('backtestDefaultCapitalUsd', value)}
            min={100}
            suffix="USD"
          />
          <NumberField
            label="Период"
            value={values.backtestDefaultDays}
            onChange={(value) => set('backtestDefaultDays', value)}
            min={30}
            max={730}
            suffix="дней"
          />
          <NumberField
            label="Комиссия"
            value={values.backtestDefaultFeeBps}
            onChange={(value) => set('backtestDefaultFeeBps', value)}
            min={0}
            max={500}
            suffix="bps"
          />
          <NumberField
            label="Slippage"
            value={values.backtestDefaultSlippageBps}
            onChange={(value) => set('backtestDefaultSlippageBps', value)}
            min={0}
            max={500}
            suffix="bps"
          />
        </div>
        <ToggleField
          label="Учитывать стоп-лосс"
          checked={values.backtestDefaultStopLoss}
          onChange={(checked) => set('backtestDefaultStopLoss', checked)}
        />
        <ToggleField
          label="Учитывать тейк-профит"
          checked={values.backtestDefaultTakeProfit}
          onChange={(checked) => set('backtestDefaultTakeProfit', checked)}
        />
        <ToggleField
          label="Реинвестировать прибыль"
          checked={values.backtestDefaultReinvest}
          onChange={(checked) => set('backtestDefaultReinvest', checked)}
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
            botTickIntervalSeconds: Number(values.botTickIntervalSeconds),
            botQuoteMaxAgeSeconds: Number(values.botQuoteMaxAgeSeconds),
            botDefaultBudgetUsd: values.botDefaultBudgetUsd,
            botDefaultMaxPositions: Number(values.botDefaultMaxPositions),
            botDefaultPositionSizePct: Number(values.botDefaultPositionSizePct),
            botDefaultFeeBps: Number(values.botDefaultFeeBps),
            botDefaultSlippageBps: Number(values.botDefaultSlippageBps),
            botDefaultDailyLossPct: Number(values.botDefaultDailyLossPct),
            botDefaultCooldownMinutes: Number(values.botDefaultCooldownMinutes),
            backtestDefaultCapitalUsd: values.backtestDefaultCapitalUsd,
            backtestDefaultFeeBps: Number(values.backtestDefaultFeeBps),
            backtestDefaultSlippageBps: Number(values.backtestDefaultSlippageBps),
            backtestDefaultDays: Number(values.backtestDefaultDays),
            backtestDefaultStopLoss: values.backtestDefaultStopLoss,
            backtestDefaultTakeProfit: values.backtestDefaultTakeProfit,
            backtestDefaultReinvest: values.backtestDefaultReinvest,
          })
        }
      />
    </SettingsPageShell>
  );
}

import { ErrorState, LoadingRows } from '@/components/ui/states';
import { toRussianError } from '@/lib/error-messages';
import type { Settings } from '@nexter/contracts';
import { useState } from 'react';
import { NumberField, SettingsCard, SettingsPageShell, SettingsSaveBar } from './settings-form';
import { useSettings, useUpdateSettings } from './use-settings';

export function TradingSettingsPage() {
  const settings = useSettings();

  if (settings.isPending) return <LoadingRows rows={6} />;
  if (settings.isError) {
    return (
      <ErrorState
        message={toRussianError(settings.error, 'Не удалось загрузить настройки торговли')}
        onRetry={() => void settings.refetch()}
      />
    );
  }

  return <TradingForm settings={settings.data} />;
}

function TradingForm({ settings }: { settings: Settings }) {
  const update = useUpdateSettings();
  const [values, setValues] = useState({
    swapDefaultSlippageBps: String(settings.swapDefaultSlippageBps),
    swapMaxSlippageBps: String(settings.swapMaxSlippageBps),
    swapMaxPriceImpactBps: String(settings.swapMaxPriceImpactBps),
    swapMaxGasUsd: settings.swapMaxGasUsd,
    swapQuoteTtlSeconds: String(settings.swapQuoteTtlSeconds),
  });

  const set = (key: keyof typeof values, value: string) =>
    setValues((current) => ({ ...current, [key]: value }));

  return (
    <SettingsPageShell
      title="Торговля и свопы"
      description="Параметры ончейн-исполнения. Флаги исполнения и allowlists остаются в диагностике и env."
    >
      <SettingsCard
        title="Проскальзывание и защита"
        description="Значения по умолчанию и верхние границы для KyberSwap."
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <NumberField
            label="Slippage по умолчанию"
            hint="10–200 bps. 50 bps = 0.50%."
            value={values.swapDefaultSlippageBps}
            onChange={(value) => set('swapDefaultSlippageBps', value)}
            min={10}
            max={200}
            suffix="bps"
          />
          <NumberField
            label="Максимальный slippage"
            hint="50–500 bps. Не может быть меньше значения по умолчанию."
            value={values.swapMaxSlippageBps}
            onChange={(value) => set('swapMaxSlippageBps', value)}
            min={50}
            max={500}
            suffix="bps"
          />
          <NumberField
            label="Максимальный price impact"
            hint="50–500 bps. Защита от плохих маршрутов."
            value={values.swapMaxPriceImpactBps}
            onChange={(value) => set('swapMaxPriceImpactBps', value)}
            min={50}
            max={500}
            suffix="bps"
          />
          <NumberField
            label="Максимальный gas"
            hint="1–50 USD. Своп дороже будет отклонён."
            value={values.swapMaxGasUsd}
            onChange={(value) => set('swapMaxGasUsd', value)}
            min={1}
            max={50}
            step={0.5}
            suffix="USD"
          />
          <NumberField
            label="TTL котировки"
            hint="5–30 секунд. Сколько живёт quote до сборки."
            value={values.swapQuoteTtlSeconds}
            onChange={(value) => set('swapQuoteTtlSeconds', value)}
            min={5}
            max={30}
            suffix="сек"
          />
        </div>
      </SettingsCard>

      <SettingsCard title="Безопасность">
        <p className="text-sm text-zinc-600">
          Порог step-up TOTP, router/executor/selector/wallet allowlists и флаги исполнения
          управляются только через env и показаны read-only в «Диагностике». Это защита от
          случайного включения исполнения.
        </p>
      </SettingsCard>

      <SettingsSaveBar
        pending={update.isPending}
        saved={update.isSuccess}
        error={
          update.isError ? toRussianError(update.error, 'Не удалось сохранить настройки') : null
        }
        onSave={() =>
          update.mutate({
            swapDefaultSlippageBps: Number(values.swapDefaultSlippageBps),
            swapMaxSlippageBps: Number(values.swapMaxSlippageBps),
            swapMaxPriceImpactBps: Number(values.swapMaxPriceImpactBps),
            swapMaxGasUsd: values.swapMaxGasUsd,
            swapQuoteTtlSeconds: Number(values.swapQuoteTtlSeconds),
          })
        }
      />
    </SettingsPageShell>
  );
}

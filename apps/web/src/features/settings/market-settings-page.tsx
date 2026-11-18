import { ErrorState, LoadingRows } from '@/components/ui/states';
import { toRussianError } from '@/lib/error-messages';
import type { ChartDefaultDays, Settings } from '@nexter/contracts';
import { useState } from 'react';
import {
  NumberField,
  SelectField,
  SettingsCard,
  SettingsPageShell,
  SettingsSaveBar,
} from './settings-form';
import { useSettings, useUpdateSettings } from './use-settings';

const chartOptions: ReadonlyArray<{ value: `${ChartDefaultDays}`; label: string }> = [
  { value: '30', label: '30 дней' },
  { value: '90', label: '90 дней' },
  { value: '180', label: '180 дней' },
  { value: '365', label: '365 дней' },
];

export function MarketSettingsPage() {
  const settings = useSettings();

  if (settings.isPending) return <LoadingRows rows={6} />;
  if (settings.isError) {
    return (
      <ErrorState
        message={toRussianError(settings.error, 'Не удалось загрузить настройки рынка')}
        onRetry={() => void settings.refetch()}
      />
    );
  }

  return <MarketForm settings={settings.data} />;
}

function MarketForm({ settings }: { settings: Settings }) {
  const update = useUpdateSettings();
  const [values, setValues] = useState({
    marketQuoteIntervalSeconds: String(settings.marketQuoteIntervalSeconds),
    marketCoinGeckoIntervalSeconds: String(settings.marketCoinGeckoIntervalSeconds),
    marketMinLiquidityUsd: settings.marketMinLiquidityUsd,
    chartDefaultDays: String(settings.chartDefaultDays) as `${ChartDefaultDays}`,
    chartHistoryRefreshHours: String(settings.chartHistoryRefreshHours),
  });

  const set = (key: keyof typeof values, value: string) =>
    setValues((current) => ({ ...current, [key]: value }));

  return (
    <SettingsPageShell
      title="Рынок и графики"
      description="Частота обновления котировок, минимальная ликвидность и кэш истории."
    >
      <SettingsCard
        title="Котировки"
        description="Слишком частые запросы упираются в лимиты DexScreener и CoinGecko."
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <NumberField
            label="Обновление DEX-котировок"
            hint="30–3600 секунд. Влияет на цену в портфеле и P&L."
            value={values.marketQuoteIntervalSeconds}
            onChange={(value) => set('marketQuoteIntervalSeconds', value)}
            min={30}
            max={3600}
            suffix="сек"
          />
          <NumberField
            label="Обновление CoinGecko"
            hint="60–86400 секунд. 7д/30д/1г и капитализация."
            value={values.marketCoinGeckoIntervalSeconds}
            onChange={(value) => set('marketCoinGeckoIntervalSeconds', value)}
            min={60}
            max={86400}
            suffix="сек"
          />
          <NumberField
            label="Минимальная ликвидность пула"
            hint="Ниже — больше токенов, но риск тонких пулов."
            value={values.marketMinLiquidityUsd}
            onChange={(value) => set('marketMinLiquidityUsd', value)}
            min={1000}
            max={1000000}
            step={1000}
            suffix="USD"
          />
        </div>
      </SettingsCard>

      <SettingsCard
        title="Графики"
        description="Период по умолчанию и частота обновления дневной истории."
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <SelectField
            label="Период графика по умолчанию"
            value={values.chartDefaultDays}
            onChange={(value) => set('chartDefaultDays', value)}
            options={chartOptions}
          />
          <NumberField
            label="Обновление истории"
            hint="6–48 часов. Один внешний запрос на токен за период."
            value={values.chartHistoryRefreshHours}
            onChange={(value) => set('chartHistoryRefreshHours', value)}
            min={6}
            max={48}
            suffix="ч"
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
            marketQuoteIntervalSeconds: Number(values.marketQuoteIntervalSeconds),
            marketCoinGeckoIntervalSeconds: Number(values.marketCoinGeckoIntervalSeconds),
            marketMinLiquidityUsd: values.marketMinLiquidityUsd,
            chartDefaultDays: Number(values.chartDefaultDays) as ChartDefaultDays,
            chartHistoryRefreshHours: Number(values.chartHistoryRefreshHours),
          })
        }
      />
    </SettingsPageShell>
  );
}

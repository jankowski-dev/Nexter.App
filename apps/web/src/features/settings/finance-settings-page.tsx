import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ErrorState, LoadingRows } from '@/components/ui/states';
import {
  fetchFinanceFxRates,
  refreshFinanceFxRates,
  resetFinanceFxRate,
  updateFinanceFxRate,
} from '@/lib/api';
import { toRussianError } from '@/lib/error-messages';
import type { FinanceFxCurrency, FinanceFxRate } from '@nexter/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { SettingsCard, SettingsPageShell } from './settings-form';

const currencyLabels: Record<FinanceFxCurrency, string> = {
  USD: 'Доллар США',
  EUR: 'Евро',
  CNY: 'Китайский юань',
};

const currencySymbols: Record<FinanceFxCurrency, string> = {
  USD: 'USD',
  EUR: 'EUR',
  CNY: 'CNY',
};

function updatedLabel(rate: FinanceFxRate): string {
  const date = new Date(rate.fetchedAt);
  return new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function RateRow({
  rate,
  pending,
  onSave,
  onReset,
}: {
  rate: FinanceFxRate;
  pending: boolean;
  onSave: (value: string) => void;
  onReset: () => void;
}) {
  const [value, setValue] = useState(rate.rate);

  useEffect(() => {
    setValue(rate.rate);
  }, [rate.rate]);

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-xl border border-zinc-200 bg-white px-3 py-3">
      <div className="min-w-[180px] flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-semibold text-zinc-900">
            {currencyLabels[rate.currency]}
          </span>
          <Badge tone={rate.source === 'manual' ? 'warning' : 'success'}>
            {rate.source === 'manual' ? 'вручную' : 'НБРБ'}
          </Badge>
        </div>
        <div className="mt-0.5 text-[11px] text-zinc-500">
          {currencySymbols[rate.currency]} · {updatedLabel(rate)}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-zinc-500">1 {rate.currency} =</span>
        <Input
          aria-label={`Курс ${rate.currency} к BYN`}
          className="h-9 w-32 font-mono tabular-nums"
          value={value}
          onChange={(event) => setValue(event.target.value)}
        />
        <span className="text-xs text-zinc-500">BYN</span>
        <Button className="h-9 px-3 text-xs" onClick={() => onSave(value)} disabled={pending}>
          Сохранить
        </Button>
        {rate.source === 'manual' ? (
          <Button variant="ghost" className="h-9 px-3 text-xs" onClick={onReset} disabled={pending}>
            Вернуть НБРБ
          </Button>
        ) : null}
      </div>
    </div>
  );
}

export function FinanceSettingsPage() {
  const queryClient = useQueryClient();
  const rates = useQuery({ queryKey: ['finance-fx-rates'], queryFn: fetchFinanceFxRates });
  const autoRefreshTried = useRef(false);

  const refresh = useMutation({
    mutationFn: refreshFinanceFxRates,
    onSuccess: (data) => {
      queryClient.setQueryData(['finance-fx-rates'], data);
    },
  });
  const update = useMutation({
    mutationFn: ({ currency, rate }: { currency: FinanceFxCurrency; rate: string }) =>
      updateFinanceFxRate(currency, { rate }),
    onSuccess: (data) => {
      queryClient.setQueryData(['finance-fx-rates'], data);
    },
  });
  const reset = useMutation({
    mutationFn: (currency: FinanceFxCurrency) => resetFinanceFxRate(currency),
    onSuccess: (data) => {
      queryClient.setQueryData(['finance-fx-rates'], data);
    },
  });

  useEffect(() => {
    if (autoRefreshTried.current || rates.isPending || rates.isError) return;
    if (!rates.data?.stale) return;
    autoRefreshTried.current = true;
    refresh.mutate();
  }, [rates.data?.stale, rates.isError, rates.isPending, refresh]);

  if (rates.isPending) return <LoadingRows rows={4} />;
  if (rates.isError) {
    return (
      <ErrorState
        message={toRussianError(rates.error, 'Не удалось загрузить курсы валют')}
        onRetry={() => void rates.refetch()}
      />
    );
  }

  return (
    <SettingsPageShell
      title="Курсы валют"
      description="Курсы НБРБ для новых счетов и долларового эквивалента в финансах."
    >
      <SettingsCard
        title="Курсы к белорусскому рублю"
        description="Курсы обновляются из НБРБ при открытии страницы, если им больше 12 часов. Ручной курс не перезаписывается."
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span className="text-xs text-zinc-500">
            {rates.data?.stale ? 'Требуется обновление' : 'Курсы актуальны'}
          </span>
          <Button variant="secondary" onClick={() => refresh.mutate()} disabled={refresh.isPending}>
            {refresh.isPending ? 'Обновляю…' : 'Обновить из НБРБ'}
          </Button>
        </div>
        {refresh.isError ? (
          <p className="text-sm text-red-700">
            {toRussianError(refresh.error, 'Не удалось получить курсы НБРБ')}
          </p>
        ) : null}
        {update.isError ? (
          <p className="text-sm text-red-700">
            {toRussianError(update.error, 'Не удалось сохранить курс')}
          </p>
        ) : null}
        {reset.isError ? (
          <p className="text-sm text-red-700">
            {toRussianError(reset.error, 'Не удалось вернуть курс НБРБ')}
          </p>
        ) : null}

        {rates.data?.rates.length ? (
          <div className="space-y-2">
            {rates.data.rates.map((rate) => (
              <RateRow
                key={rate.currency}
                rate={rate}
                pending={update.isPending || reset.isPending}
                onSave={(value) => update.mutate({ currency: rate.currency, rate: value.trim() })}
                onReset={() => reset.mutate(rate.currency)}
              />
            ))}
          </div>
        ) : (
          <div className="rounded-xl border border-dashed border-zinc-200 bg-zinc-50/70 px-4 py-8 text-center">
            <p className="text-sm font-medium text-zinc-700">Курсов пока нет</p>
            <p className="mt-1 text-xs text-zinc-500">
              Нажмите «Обновить из НБРБ», чтобы загрузить USD, EUR и CNY.
            </p>
          </div>
        )}
      </SettingsCard>
    </SettingsPageShell>
  );
}

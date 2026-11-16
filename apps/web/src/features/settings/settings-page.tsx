import { Button } from '@/components/ui/button';
import { Card, CardDescription, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { NavIcon, type NavIconName } from '@/components/nav-icon';
import { PageHeader } from '@/components/ui/page-header';
import { ErrorState, LoadingRows } from '@/components/ui/states';
import { downloadExport, fetchSettings, updateSettings } from '@/lib/api';
import { toRussianError } from '@/lib/error-messages';
import { formatDateTime } from '@/lib/format';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useEffect, useState } from 'react';

const settingsTones = {
  emerald: {
    card: 'hover:border-emerald-300',
    icon: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  },
  sky: { card: 'hover:border-sky-300', icon: 'border-sky-200 bg-sky-50 text-sky-700' },
  amber: { card: 'hover:border-amber-300', icon: 'border-amber-200 bg-amber-50 text-amber-700' },
  violet: {
    card: 'hover:border-violet-300',
    icon: 'border-violet-200 bg-violet-50 text-violet-700',
  },
  rose: { card: 'hover:border-rose-300', icon: 'border-rose-200 bg-rose-50 text-rose-700' },
  zinc: { card: 'hover:border-zinc-300', icon: 'border-zinc-200 bg-zinc-100 text-zinc-600' },
} as const;

function SettingsNavCard({
  to,
  title,
  description,
  icon,
  tone,
}: {
  to: string;
  title: string;
  description: string;
  icon: NavIconName;
  tone: keyof typeof settingsTones;
}) {
  const styles = settingsTones[tone];
  return (
    <Link to={to} className="block">
      <Card className={`h-full p-4 transition-colors ${styles.card}`}>
        <div className="flex items-start gap-3">
          <span
            className={`inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border ${styles.icon}`}
          >
            <NavIcon name={icon} className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <div className="font-medium text-zinc-900">{title}</div>
            <p className="mt-1 text-xs leading-5 text-zinc-500">{description}</p>
          </div>
        </div>
        <div className="mt-3 flex justify-end text-[11px] text-zinc-400">Открыть →</div>
      </Card>
    </Link>
  );
}

export function SettingsPage() {
  const queryClient = useQueryClient();
  const settings = useQuery({ queryKey: ['settings'], queryFn: fetchSettings });
  const [timezone, setTimezone] = useState('Europe/Minsk');
  const [includeGas, setIncludeGas] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!settings.data) return;
    setTimezone(settings.data.timezone);
    setIncludeGas(settings.data.includeGasInCostBasis);
  }, [settings.data]);

  const saveMutation = useMutation({
    mutationFn: () => updateSettings({ timezone, includeGasInCostBasis: includeGas }),
    onSuccess: (data) => {
      queryClient.setQueryData(['settings'], data);
      setError(null);
    },
    onError: (err) => {
      setError(toRussianError(err, 'Не удалось сохранить настройки'));
    },
  });

  async function exportData(
    dataset: 'transactions' | 'positions' | 'trade-groups',
    format: 'csv' | 'json',
  ) {
    try {
      await downloadExport(dataset, format);
      setError(null);
    } catch (err) {
      setError(toRussianError(err, 'Не удалось скачать экспорт'));
    }
  }

  if (settings.isPending) {
    return (
      <div className="space-y-6">
        <PageHeader title="Настройки" />
        <LoadingRows rows={5} />
      </div>
    );
  }

  if (settings.isError || !settings.data) {
    return (
      <div className="space-y-6">
        <PageHeader title="Настройки" />
        <ErrorState
          message={toRussianError(settings.error, 'Не удалось загрузить настройки')}
          onRetry={() => void settings.refetch()}
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Настройки"
        subtitle="Общие параметры, безопасность, аудит, качество данных и экспорт."
      />

      {error ? (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      ) : null}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <SettingsNavCard
          to="/settings/security"
          title="Безопасность"
          description="Пароль, 2FA, recovery codes и активные сессии."
          icon="security"
          tone="emerald"
        />
        <SettingsNavCard
          to="/settings/interface"
          title="Интерфейс и поведение"
          description="Тема, автоблокировка и сеть кошелька."
          icon="sliders"
          tone="sky"
        />
        <SettingsNavCard
          to="/settings/ai"
          title="ИИ"
          description="DeepSeek, ключ API, модель и режим мышления."
          icon="ai"
          tone="violet"
        />
        <SettingsNavCard
          to="/settings/accounts"
          title="Счета"
          description="Кошельки и системные счета учёта."
          icon="wallet"
          tone="amber"
        />
        <SettingsNavCard
          to="/settings/audit"
          title="Аудит"
          description="Журнал действий и изменений."
          icon="audit"
          tone="violet"
        />
        <SettingsNavCard
          to="/settings/system"
          title="Система"
          description="Котировки, задачи, свопы и провайдеры."
          icon="system"
          tone="emerald"
        />
        <SettingsNavCard
          to="/settings/data-quality"
          title="Качество данных"
          description="Расхождения учёта, ордеров и котировок."
          icon="quality"
          tone="rose"
        />
        <SettingsNavCard
          to="/import"
          title="Импорт Notion"
          description="Legacy-инструмент до clean cutover."
          icon="upload"
          tone="zinc"
        />
      </div>

      <Card>
        <CardTitle>Общие</CardTitle>
        <CardDescription>Базовая валюта и метод учёта фиксированы: USD и FIFO.</CardDescription>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <label className="block text-sm text-zinc-600">
            Базовая валюта
            <Input className="mt-1" value={settings.data.baseCurrency} readOnly disabled />
          </label>
          <label className="block text-sm text-zinc-600">
            Метод списания
            <Input className="mt-1" value={settings.data.taxMethod} readOnly disabled />
          </label>
          <label className="block text-sm text-zinc-600">
            Часовой пояс (IANA)
            <Input
              className="mt-1"
              value={timezone}
              onChange={(event) => setTimezone(event.target.value)}
              placeholder="Europe/Minsk"
            />
            <span className="mt-1 block text-xs text-zinc-500">
              Используется для группировки P&L по месяцам; даты в интерфейсе показываются в часовом
              поясе браузера.
            </span>
          </label>
          <label className="mt-7 flex items-center gap-2 text-sm text-zinc-700">
            <input
              type="checkbox"
              checked={includeGas}
              onChange={(event) => setIncludeGas(event.target.checked)}
              className="h-4 w-4 rounded border-zinc-300 bg-white"
            />
            Включать газ в себестоимость
          </label>
        </div>
        <div className="mt-4 flex items-center gap-3">
          <Button
            onClick={() => saveMutation.mutate()}
            disabled={saveMutation.isPending || !timezone}
          >
            {saveMutation.isPending ? 'Сохраняю…' : 'Сохранить настройки'}
          </Button>
          <span className="text-xs text-zinc-500">
            Обновлено {formatDateTime(settings.data.updatedAt)}
          </span>
        </div>
      </Card>

      <Card>
        <CardTitle>Экспорт</CardTitle>
        <CardDescription>CSV или JSON для транзакций, позиций и торговых групп.</CardDescription>
        <div className="mt-4 grid gap-3 md:grid-cols-3">
          {(
            [
              ['transactions', 'Транзакции'],
              ['positions', 'Позиции'],
              ['trade-groups', 'Сделки'],
            ] as const
          ).map(([dataset, label]) => (
            <div key={dataset} className="rounded-lg border border-zinc-200 p-3">
              <div className="text-sm font-medium text-zinc-800">{label}</div>
              <div className="mt-2 flex gap-2">
                <Button
                  variant="secondary"
                  className="h-8 px-3 text-xs"
                  onClick={() => void exportData(dataset, 'csv')}
                >
                  CSV
                </Button>
                <Button
                  variant="ghost"
                  className="h-8 px-3 text-xs"
                  onClick={() => void exportData(dataset, 'json')}
                >
                  JSON
                </Button>
              </div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

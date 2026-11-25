import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardDescription, CardTitle } from '@/components/ui/card';
import { Drawer } from '@/components/ui/drawer';
import { ErrorState, LoadingRows } from '@/components/ui/states';
import { fetchBotStrategies } from '@/lib/api';
import { toRussianError } from '@/lib/error-messages';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import type { BotStrategyTemplate } from '@nexter/contracts';
import { formatStrategyParamValue } from '../testing/strategy-params';
import { StrategyIcon } from '../testing/strategy-icon';
import { SettingsPageShell } from './settings-form';

export function StrategiesSettingsPage() {
  const strategies = useQuery({
    queryKey: ['trading-bot-strategies'],
    queryFn: fetchBotStrategies,
    refetchOnWindowFocus: false,
  });

  if (strategies.isPending) return <LoadingRows rows={6} />;
  if (strategies.isError) {
    return (
      <ErrorState
        message={toRussianError(strategies.error, 'Не удалось загрузить стратегии')}
        onRetry={() => void strategies.refetch()}
      />
    );
  }

  return <StrategiesSettingsView templates={strategies.data.data} />;
}

/**
 * Read-only strategy reference. The registry is code-defined; parameters are
 * configured per robot and per sandbox run, never edited here.
 */
export function StrategiesSettingsView({ templates }: { templates: BotStrategyTemplate[] }) {
  const [selected, setSelected] = useState<BotStrategyTemplate | null>(null);

  return (
    <SettingsPageShell
      title="Стратегии"
      description="Встроенные алгоритмы роботов и песочницы. Справочник только для чтения."
    >
      <Card>
        <CardTitle>Каталог стратегий</CardTitle>
        <CardDescription>
          Алгоритмы заданы в коде и не редактируются. Числовые параметры настраиваются отдельно для
          каждого робота и каждого прогона песочницы. Нажмите на карточку, чтобы прочитать описание,
          гайд и риски.
        </CardDescription>
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          {templates.map((template) => (
            <button
              key={template.key}
              type="button"
              onClick={() => setSelected(template)}
              className="cursor-pointer rounded-xl border border-zinc-200 p-3 text-left transition-colors hover:border-emerald-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/40"
            >
              <div className="flex items-start gap-3">
                <StrategyIcon icon={template.icon} />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-zinc-900">{template.name}</span>
                    <Badge tone={template.kind === 'system' ? 'info' : 'warning'}>
                      {template.kind === 'system' ? 'Системная' : 'Кастомная'}
                    </Badge>
                  </div>
                  <p className="mt-1 text-xs text-zinc-500">{template.description}</p>
                  <p className="mt-2 text-[11px] text-zinc-400">
                    {template.paramFields.length} параметров · нажмите для подробностей
                  </p>
                </div>
              </div>
            </button>
          ))}
        </div>
      </Card>

      <Drawer
        open={Boolean(selected)}
        onClose={() => setSelected(null)}
        title={selected?.name ?? 'Стратегия'}
        titleIcon={selected ? <StrategyIcon icon={selected.icon} className="h-8 w-8" /> : undefined}
        size="lg"
        footer={
          <Button variant="secondary" onClick={() => setSelected(null)}>
            Готово
          </Button>
        }
      >
        {selected ? (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={selected.kind === 'system' ? 'info' : 'warning'}>
                {selected.kind === 'system' ? 'Системная' : 'Кастомная'}
              </Badge>
              <span className="font-mono text-xs text-zinc-500">{selected.key}</span>
            </div>
            <Card>
              <CardTitle>Что это</CardTitle>
              <p className="mt-1 text-sm text-zinc-700">{selected.description}</p>
            </Card>
            <Card>
              <CardTitle>Как работает</CardTitle>
              <p className="mt-1 text-sm leading-6 text-zinc-700">{selected.guide}</p>
            </Card>
            <Card>
              <CardTitle>Когда лучше использовать</CardTitle>
              <p className="mt-1 text-sm leading-6 text-zinc-700">{selected.bestFor}</p>
            </Card>
            <Card className="border-amber-200/80 bg-amber-50/50">
              <CardTitle>Риски</CardTitle>
              <p className="mt-1 text-sm leading-6 text-zinc-700">{selected.risks}</p>
            </Card>
            <Card>
              <CardTitle>Параметры по умолчанию</CardTitle>
              <div className="mt-2 space-y-2">
                {selected.paramFields.map((field) => {
                  const value = selected.defaultParams[field.key];
                  return (
                    <div
                      key={field.key}
                      className="flex items-start justify-between gap-3 border-b border-zinc-100 pb-2 last:border-0 last:pb-0"
                    >
                      <div className="text-sm text-zinc-700">
                        {field.label}
                        {field.hint ? (
                          <div className="text-[11px] text-zinc-500">{field.hint}</div>
                        ) : null}
                      </div>
                      <div className="shrink-0 font-mono text-sm text-zinc-900">
                        {formatStrategyParamValue(field, value)}
                      </div>
                    </div>
                  );
                })}
              </div>
            </Card>
            <p className="text-xs leading-5 text-zinc-500">
              Стратегия встроена в приложение и не редактируется. Параметры задаются отдельно для
              каждого робота и исторического прогона песочницы.
            </p>
          </div>
        ) : null}
      </Drawer>
    </SettingsPageShell>
  );
}

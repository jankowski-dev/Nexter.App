import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardDescription, CardTitle } from '@/components/ui/card';
import { EmptyState, ErrorState, LoadingRows } from '@/components/ui/states';
import { PageHeader } from '@/components/ui/page-header';
import { TabGroup } from '@/components/ui/list-toolbar';
import { toRussianError } from '@/lib/error-messages';
import { SandboxRunsTab } from './sandbox-runs-tab';
import { useSandboxStatus } from './sandbox-hooks';
import {
  SANDBOX_PATH,
  sandboxHashForTab,
  sandboxTabFromHash,
  sandboxTabs,
  type SandboxTab,
} from './sandbox-tabs';
import { useEffect, useState } from 'react';

const placeholderCopy: Record<
  Exclude<SandboxTab, 'runs'>,
  { title: string; description: string }
> = {
  overview: {
    title: 'Дашборд запуска',
    description:
      'Капитал, P&L, просадка, позиции, режимы токенов и свежесть данных активного запуска появятся в следующем шаге.',
  },
  journal: {
    title: 'Журнал',
    description:
      'События, интенты, сделки, проверки риска и причины «почему не купили» появятся в следующем шаге.',
  },
  reports: {
    title: 'Отчёты',
    description:
      'Скачивание JSON/Markdown и сводные карточки отчёта live-paper появятся в следующем шаге.',
  },
};

function SandboxPlaceholder({ tab }: { tab: Exclude<SandboxTab, 'runs'> }) {
  const copy = placeholderCopy[tab];

  return (
    <Card className="border-dashed bg-zinc-50">
      <CardTitle>{copy.title}</CardTitle>
      <CardDescription>{copy.description}</CardDescription>
      <p className="mt-3 inline-flex rounded-full border border-zinc-200 bg-white px-3 py-1 text-xs text-zinc-500">
        Будет в следующем шаге
      </p>
    </Card>
  );
}

export function SandboxPage() {
  const status = useSandboxStatus();
  const [tab, setTab] = useState<SandboxTab>(() =>
    sandboxTabFromHash(typeof window === 'undefined' ? undefined : window.location.hash),
  );

  useEffect(() => {
    function onHashChange(): void {
      setTab(sandboxTabFromHash(window.location.hash));
    }
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  function changeTab(next: SandboxTab): void {
    setTab(next);
    window.history.replaceState(null, '', `${SANDBOX_PATH}${sandboxHashForTab(next)}`);
  }

  const header = (
    <PageHeader
      title="Песочница"
      subtitle="Автономный paper-режим на реальных рыночных данных 1h: виртуальные деньги, без кошелька, подписи и реальных ордеров."
      actions={<Badge tone="info">live-paper · виртуальные деньги</Badge>}
    />
  );

  if (status.isPending) {
    return (
      <div className="space-y-6">
        {header}
        <LoadingRows rows={4} />
      </div>
    );
  }

  if (status.isError) {
    return (
      <div className="space-y-6">
        {header}
        <ErrorState
          message={toRussianError(status.error, 'Не удалось проверить доступность песочницы')}
          onRetry={() => void status.refetch()}
        />
      </div>
    );
  }

  if (!status.data?.enabled) {
    return (
      <div className="space-y-6">
        {header}
        <EmptyState
          title="Песочница выключена"
          description="Функция отключена на сервере (SANDBOX_ENABLED=false). Запуски, журнал и отчёты не удаляются: включите флаг, чтобы вернуться."
        />
        <div>
          <Button variant="secondary" onClick={() => void status.refetch()}>
            Проверить снова
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {header}
      <TabGroup
        value={tab}
        options={sandboxTabs.map((item) => ({ value: item.value, label: item.label }))}
        onChange={changeTab}
        ariaLabel="Разделы песочницы"
      />
      {tab === 'runs' ? <SandboxRunsTab /> : <SandboxPlaceholder tab={tab} />}
    </div>
  );
}

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState, ErrorState, LoadingRows } from '@/components/ui/states';
import { PageHeader } from '@/components/ui/page-header';
import { TabGroup } from '@/components/ui/list-toolbar';
import { toRussianError } from '@/lib/error-messages';
import { SandboxDashboard } from './sandbox-dashboard';
import { SandboxJournal } from './sandbox-journal';
import { SandboxReports } from './sandbox-reports';
import { SandboxRunsTab } from './sandbox-runs-tab';
import { useSandboxOverview, useSandboxRuns, useSandboxStatus } from './sandbox-hooks';
import {
  sandboxDefaultRunId,
  sandboxMergeRuns,
  sandboxRunIdFromSearch,
  sandboxUrlForSelection,
} from './sandbox-selection';
import { sandboxTabFromHash, sandboxTabs, type SandboxTab } from './sandbox-tabs';
import { useEffect, useMemo, useState } from 'react';

export function SandboxPage() {
  const status = useSandboxStatus();
  const enabled = status.data?.enabled === true;
  const overview = useSandboxOverview(enabled);
  const runsQuery = useSandboxRuns(true, enabled);
  const [tab, setTab] = useState<SandboxTab>(() =>
    sandboxTabFromHash(typeof window === 'undefined' ? undefined : window.location.hash),
  );
  const [selectedRunId, setSelectedRunId] = useState<string | null>(() =>
    typeof window === 'undefined' ? null : sandboxRunIdFromSearch(window.location.search),
  );

  useEffect(() => {
    function onHashChange(): void {
      setTab(sandboxTabFromHash(window.location.hash));
    }
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  const allRuns = useMemo(
    () => sandboxMergeRuns(overview.data?.activeRuns ?? [], runsQuery.data?.runs ?? []),
    [overview.data?.activeRuns, runsQuery.data?.runs],
  );
  // No `?run=` means the dashboard/журнал/отчёты open the first active run.
  const effectiveRunId = selectedRunId ?? sandboxDefaultRunId(allRuns);

  function changeTab(next: SandboxTab): void {
    setTab(next);
    window.history.replaceState(null, '', sandboxUrlForSelection(next, effectiveRunId));
  }

  function selectRun(runId: string): void {
    setSelectedRunId(runId);
    window.history.replaceState(null, '', sandboxUrlForSelection(tab, runId));
  }

  function openRun(runId: string): void {
    setSelectedRunId(runId);
    setTab('overview');
    window.history.replaceState(null, '', sandboxUrlForSelection('overview', runId));
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

  const sharedProps = {
    runs: allRuns,
    selectedRunId: effectiveRunId,
    onSelectRun: selectRun,
    onChangeTab: changeTab,
    selectionPending: overview.isPending || runsQuery.isPending,
  };

  return (
    <div className="space-y-6">
      {header}
      <TabGroup
        value={tab}
        options={sandboxTabs.map((item) => ({ value: item.value, label: item.label }))}
        onChange={changeTab}
        ariaLabel="Разделы песочницы"
      />
      {tab === 'overview' ? (
        <SandboxDashboard {...sharedProps} selectedRunId={effectiveRunId} />
      ) : null}
      {tab === 'runs' ? <SandboxRunsTab onOpenRun={openRun} /> : null}
      {tab === 'journal' ? <SandboxJournal {...sharedProps} /> : null}
      {tab === 'reports' ? <SandboxReports {...sharedProps} /> : null}
    </div>
  );
}

import { Button } from '@/components/ui/button';
import { EmptyState, ErrorState, LoadingRows } from '@/components/ui/states';
import { ListToolbar } from '@/components/ui/list-toolbar';
import { Select } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { useConfirm } from '@/lib/confirm';
import { toRussianError } from '@/lib/error-messages';
import { useAutoDismissNotice } from '@/lib/use-auto-dismiss-notice';
import { SandboxRunCard, type SandboxRunAction } from './sandbox-run-card';
import { SandboxRunDrawer } from './sandbox-run-drawer';
import { SandboxTokensDrawer } from './sandbox-tokens-drawer';
import { useSandboxLifecycle, useSandboxRuns } from './sandbox-hooks';
import { isSandboxPartialCoverageError, planSandboxRunAction } from './sandbox-runs-actions';
import { sandboxStatusLabels } from './sandbox-tabs';
import { useState } from 'react';
import type { SandboxRunStatus, SandboxRunSummary } from '@nexter/contracts';

type StatusFilter = 'all' | SandboxRunStatus;

const statusOptions: ReadonlyArray<{ value: StatusFilter; label: string }> = [
  { value: 'all', label: 'Все статусы' },
  { value: 'draft', label: sandboxStatusLabels.draft },
  { value: 'running', label: sandboxStatusLabels.running },
  { value: 'paused', label: sandboxStatusLabels.paused },
  { value: 'stopped', label: sandboxStatusLabels.stopped },
  { value: 'failed', label: sandboxStatusLabels.failed },
];

const actionNotices: Partial<Record<SandboxRunAction, string>> = {
  start: 'Запуск стартовал: первое решение появится на следующем закрытом баре 1h.',
  pause: 'Запуск приостановлен: открытые позиции остаются отмеченными.',
  resume: 'Запуск продолжен со следующего закрытого бара 1h.',
  stop: 'Запуск остановлен: состояние зафиксировано по последнему закрытому бару.',
  archive: 'Запуск отправлен в архив.',
};

export function SandboxRunsTab() {
  const confirm = useConfirm();
  const [includeArchived, setIncludeArchived] = useState(false);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [search, setSearch] = useState('');
  const [drawerRunId, setDrawerRunId] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [tokensOpen, setTokensOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const runs = useSandboxRuns(includeArchived);
  const lifecycle = useSandboxLifecycle();
  useAutoDismissNotice(notice, () => setNotice(null), 6000);

  const allRuns = runs.data?.runs ?? [];
  const term = search.trim().toLowerCase();
  const visibleRuns = allRuns.filter((run) => {
    if (statusFilter !== 'all' && run.status !== statusFilter) return false;
    if (term.length > 0 && !run.name.toLowerCase().includes(term)) return false;
    return true;
  });

  function openCreate(): void {
    setDrawerRunId(null);
    setDrawerOpen(true);
  }

  function openEdit(runId: string): void {
    setDrawerRunId(runId);
    setDrawerOpen(true);
  }

  async function startWithCoverageConfirmation(run: SandboxRunSummary): Promise<boolean> {
    try {
      await lifecycle.mutateAsync({ runId: run.id, action: 'start' });
      return true;
    } catch (error) {
      if (!isSandboxPartialCoverageError(error)) {
        throw error;
      }

      const accepted = await confirm({
        title: 'История неполная',
        description:
          'Для выбранных токенов доступна не вся история 1h. Запуск начнётся с предупреждением и сниженной уверенностью режима.',
        confirmLabel: 'Всё равно запустить',
        cancelLabel: 'Отмена',
        variant: 'primary',
      });
      if (!accepted) return false;

      await lifecycle.mutateAsync({ runId: run.id, action: 'start', allowPartial: true });
      return true;
    }
  }

  async function handleAction(run: SandboxRunSummary, action: SandboxRunAction): Promise<void> {
    setNotice(null);
    const plan = planSandboxRunAction(action);

    if (plan.kind === 'edit') {
      openEdit(run.id);
      return;
    }

    if (plan.confirmation) {
      const accepted = await confirm({ ...plan.confirmation, cancelLabel: 'Отмена' });
      if (!accepted) return;
    }

    try {
      if (plan.action === 'start') {
        const started = await startWithCoverageConfirmation(run);
        if (!started) return;
      } else {
        await lifecycle.mutateAsync({ runId: run.id, action: plan.action });
      }
      setNotice(actionNotices[action] ?? null);
    } catch (error) {
      setNotice(toRussianError(error, 'Не удалось выполнить действие с запуском'));
    }
  }

  if (runs.isPending) {
    return <LoadingRows rows={5} />;
  }

  if (runs.isError || !runs.data) {
    return (
      <ErrorState
        message={toRussianError(runs.error, 'Не удалось загрузить запуски песочницы')}
        onRetry={() => void runs.refetch()}
      />
    );
  }

  return (
    <div className="space-y-4">
      <ListToolbar
        search={search}
        onSearch={setSearch}
        searchPlaceholder="Поиск по названию"
        searchAriaLabel="Поиск запусков песочницы"
        actions={
          <>
            <Button variant="secondary" onClick={() => setTokensOpen(true)}>
              Токены песочницы
            </Button>
            <Button onClick={openCreate}>Новый запуск</Button>
          </>
        }
      >
        <Select
          aria-label="Фильтр по статусу"
          value={statusFilter}
          className="w-44"
          onChange={(event) => setStatusFilter(event.target.value as StatusFilter)}
        >
          {statusOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </Select>
        <label className="flex items-center gap-2 text-sm text-zinc-600">
          <Switch
            checked={includeArchived}
            onChange={setIncludeArchived}
            label="Показывать архив"
          />
          Архив
        </label>
      </ListToolbar>

      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-zinc-500">
        <span>
          Всего: {runs.data.total} · показано {visibleRuns.length}
        </span>
        <span>Исполнение: live-paper · виртуальные деньги</span>
      </div>

      {notice ? (
        <div
          role="status"
          className="rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-3 text-sm text-zinc-700"
        >
          {notice}
        </div>
      ) : null}

      {visibleRuns.length === 0 ? (
        <EmptyState
          title={allRuns.length === 0 ? 'Запусков пока нет' : 'Ничего не найдено'}
          description={
            allRuns.length === 0
              ? 'Создайте черновик, выберите токены и капитал, затем запустите его. Решения принимаются на закрытых барах 1h.'
              : 'Измените фильтр по статусу, поиск или включите архив.'
          }
          action={
            allRuns.length === 0 ? <Button onClick={openCreate}>Новый запуск</Button> : undefined
          }
        />
      ) : (
        <div className="space-y-3">
          {visibleRuns.map((run) => (
            <SandboxRunCard
              key={run.id}
              run={run}
              busy={lifecycle.isPending && lifecycle.variables?.runId === run.id}
              onAction={(target, action) => void handleAction(target, action)}
            />
          ))}
        </div>
      )}

      <SandboxRunDrawer
        open={drawerOpen}
        runId={drawerRunId}
        onClose={() => setDrawerOpen(false)}
        onManageTokens={() => setTokensOpen(true)}
        onSaved={() => {
          setDrawerOpen(false);
          setNotice(
            drawerRunId === null
              ? 'Черновик создан. Проверьте настройки и запустите его.'
              : 'Настройки черновика сохранены.',
          );
        }}
      />

      <SandboxTokensDrawer open={tokensOpen} onClose={() => setTokensOpen(false)} />
    </div>
  );
}

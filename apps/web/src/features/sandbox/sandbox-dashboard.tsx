import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardTitle } from '@/components/ui/card';
import { StatCard } from '@/components/ui/stat-card';
import { LineChart } from '@/components/charts/line-chart';
import { EmptyState, ErrorState, LoadingRows } from '@/components/ui/states';
import { useConfirm } from '@/lib/confirm';
import { toRussianError } from '@/lib/error-messages';
import {
  formatDateTime,
  formatPct,
  formatPrice,
  formatSignedUsd,
  formatTokenAmount,
  formatUsd,
  pnlTone,
} from '@/lib/format';
import { useAutoDismissNotice } from '@/lib/use-auto-dismiss-notice';
import {
  useCloseSandboxTrade,
  useSandboxEquity,
  useSandboxEventTail,
  useSandboxLifecycle,
  useSandboxOverview,
  useSandboxPositions,
  useSandboxRunDetail,
} from './sandbox-hooks';
import { sandboxEventWhyNot } from './sandbox-journal-helpers';
import {
  sandboxAbsolutePnlUsd,
  sandboxCloseConfirmation,
  sandboxCloseEligibility,
  sandboxFreshnessTone,
  sandboxFreshnessWarnings,
  sandboxLastDecision,
  sandboxPositionPnl,
  sandboxRunCounts,
  sandboxRunDrawdownPct,
  sandboxRunReturnPct,
  sandboxRunStaleTokens,
  sandboxTokenStates,
} from './sandbox-dashboard-helpers';
import { SandboxHealth } from './sandbox-health';
import {
  sandboxDecisionActionLabels,
  sandboxEventSeverityLabels,
  sandboxEventSeverityTones,
  sandboxRegimeLabel,
  sandboxStrategyLabel,
} from './sandbox-labels';
import { SandboxRunPicker } from './sandbox-run-picker';
import { planSandboxRunAction, startSandboxRunWithCoverage } from './sandbox-runs-actions';
import { sandboxStatusLabels, sandboxStatusTones } from './sandbox-tabs';
import type { SandboxDashboardProps } from './sandbox-tab-types';
import { useState } from 'react';
import type {
  SandboxEquityPoint,
  SandboxEvent,
  SandboxOverview,
  SandboxPosition,
  SandboxRunDetail,
} from '@nexter/contracts';

type DashboardControl = 'start' | 'pause' | 'resume' | 'stop';

const controlLabels: Record<DashboardControl, string> = {
  start: 'Запустить',
  pause: 'Пауза',
  resume: 'Продолжить',
  stop: 'Остановить',
};

const controlNotices: Record<DashboardControl, string> = {
  start: 'Запуск стартовал: первое решение появится на следующем закрытом баре 1h.',
  pause: 'Запуск приостановлен: открытые позиции остаются отмеченными.',
  resume: 'Запуск продолжен со следующего закрытого бара 1h.',
  stop: 'Запуск остановлен. Итоговый отчёт доступен в разделе «Отчёты».',
};

function formatPercentPlain(value: string): string {
  return formatPct(value).replace(/^\+/, '');
}

/**
 * `Обзор`: the owner dashboard of the selected live-paper run.
 *
 * It is deliberately read-only except for start/pause/resume/stop and the
 * single-position close request. No manual buy, add or override exists: the
 * sandbox is autonomous inside its frozen limits.
 */
export function SandboxDashboard({
  runs,
  selectedRunId,
  onSelectRun,
  onChangeTab,
  selectionPending = false,
}: SandboxDashboardProps) {
  const confirm = useConfirm();
  const overview = useSandboxOverview();
  const detail = useSandboxRunDetail(selectedRunId);
  const running = detail.data?.status === 'running' && detail.data.archivedAt === null;
  const positionsQuery = useSandboxPositions(selectedRunId, running);
  const equityQuery = useSandboxEquity(selectedRunId, running, 2_000, 0);
  const eventsQuery = useSandboxEventTail(
    selectedRunId,
    running,
    detail.data?.eventCount ?? null,
    200,
  );
  const lifecycle = useSandboxLifecycle();
  const closeTrade = useCloseSandboxTrade();
  const [notice, setNotice] = useState<string | null>(null);
  const [noticeTone, setNoticeTone] = useState<'status' | 'error'>('status');
  useAutoDismissNotice(notice, () => setNotice(null), 8000);

  function note(text: string, tone: 'status' | 'error' = 'status'): void {
    setNoticeTone(tone);
    setNotice(text);
  }

  const events = eventsQuery.data?.events ?? [];
  const positions = positionsQuery.data?.positions ?? [];

  async function handleControl(action: DashboardControl): Promise<void> {
    const run = detail.data;
    if (!run) return;
    const plan = planSandboxRunAction(action);
    if (plan.kind !== 'control') return;

    if (plan.confirmation) {
      const accepted = await confirm({ ...plan.confirmation, cancelLabel: 'Отмена' });
      if (!accepted) return;
    }

    try {
      if (action === 'start') {
        const started = await startSandboxRunWithCoverage({
          start: () => lifecycle.mutateAsync({ runId: run.id, action: 'start' }),
          startAllowPartial: () =>
            lifecycle.mutateAsync({ runId: run.id, action: 'start', allowPartial: true }),
          confirm,
        });
        if (!started) return;
      } else {
        await lifecycle.mutateAsync({ runId: run.id, action });
      }
      note(controlNotices[action]);
    } catch (error) {
      note(toRussianError(error, 'Не удалось выполнить действие с запуском'), 'error');
    }
  }

  async function requestClose(position: SandboxPosition, symbol: string): Promise<void> {
    const run = detail.data;
    if (!run) return;
    const accepted = await confirm(sandboxCloseConfirmation(symbol));
    if (!accepted) return;

    try {
      await closeTrade.mutateAsync({ runId: run.id, tokenId: position.tokenId });
      note(
        `Закрытие ${symbol} поставлено в очередь: продажа исполнится на следующем закрытом баре 1h.`,
      );
    } catch (error) {
      note(toRussianError(error, 'Не удалось запросить закрытие сделки'), 'error');
      // A 409 usually means the position or run state changed; refresh every
      // read so the owner sees the persisted truth instead of a stale card.
      void Promise.all([
        detail.refetch(),
        positionsQuery.refetch(),
        equityQuery.refetch(),
        eventsQuery.refetch(),
        overview.refetch(),
      ]);
    }
  }

  return (
    <div className="space-y-4">
      <SandboxHealth />

      {runs.length > 0 && selectedRunId ? (
        <SandboxRunPicker runs={runs} selectedRunId={selectedRunId} onChange={onSelectRun} />
      ) : null}

      {notice ? (
        <div
          role={noticeTone === 'error' ? 'alert' : 'status'}
          className={`rounded-xl border px-4 py-3 text-sm ${
            noticeTone === 'error'
              ? 'border-red-200 bg-red-50 text-red-700'
              : 'border-zinc-200 bg-zinc-50 text-zinc-700'
          }`}
        >
          {notice}
        </div>
      ) : null}

      {selectedRunId === null ? (
        selectionPending ? (
          <LoadingRows rows={4} />
        ) : (
          <EmptyState
            title="Нет выбранного запуска"
            description="Создайте черновик, выберите токены и капитал, затем запустите его. После старта здесь появятся капитал, позиции, решения и свежесть данных."
            action={<Button onClick={() => onChangeTab('runs')}>Перейти к запускам</Button>}
          />
        )
      ) : detail.isPending ? (
        <LoadingRows rows={5} />
      ) : detail.isError || !detail.data ? (
        <ErrorState
          message={toRussianError(detail.error, 'Не удалось загрузить запуск песочницы')}
          onRetry={() => void detail.refetch()}
        />
      ) : (
        <DashboardRun
          run={detail.data}
          overview={overview.data}
          positions={positions}
          events={events}
          equityPoints={equityQuery.data?.points ?? []}
          equityTotal={equityQuery.data?.total ?? null}
          equityPending={equityQuery.isPending}
          equityError={equityQuery.isError}
          onRetryEquity={() => void equityQuery.refetch()}
          positionsPending={positionsQuery.isPending}
          positionsError={positionsQuery.isError}
          onRetryPositions={() => void positionsQuery.refetch()}
          busy={lifecycle.isPending || closeTrade.isPending}
          onControl={(action) => void handleControl(action)}
          onClose={(position, symbol) => void requestClose(position, symbol)}
        />
      )}
    </div>
  );
}

function DashboardRun({
  run,
  overview,
  positions,
  events,
  equityPoints,
  equityTotal,
  equityPending,
  equityError,
  onRetryEquity,
  positionsPending,
  positionsError,
  onRetryPositions,
  busy,
  onControl,
  onClose,
}: {
  run: SandboxRunDetail;
  overview: SandboxOverview | undefined;
  positions: readonly SandboxPosition[];
  events: readonly SandboxEvent[];
  equityPoints: readonly SandboxEquityPoint[];
  equityTotal: number | null;
  equityPending: boolean;
  equityError: boolean;
  onRetryEquity: () => void;
  positionsPending: boolean;
  positionsError: boolean;
  onRetryPositions: () => void;
  busy: boolean;
  onControl: (action: DashboardControl) => void;
  onClose: (position: SandboxPosition, symbol: string) => void;
}) {
  const counts = sandboxRunCounts(run);
  const returnPct = sandboxRunReturnPct(run);
  const drawdownPct = sandboxRunDrawdownPct(run);
  const absolutePnl = sandboxAbsolutePnlUsd(run);
  const symbolByToken = new Map(run.tokens.map((token) => [token.tokenKey, token.symbol]));
  const tokenStates = sandboxTokenStates({ tokens: run.tokens, events, positions });
  const lastDecision = sandboxLastDecision(events);
  const archived = run.archivedAt !== null;
  // Freshness only means something while the runner is advancing the run. A
  // paused/stopped/draft/archived run must not claim that its data is fresh.
  const freshnessChecked = run.status === 'running' && !archived;
  const freshness = freshnessChecked
    ? sandboxFreshnessWarnings({
        lastBarClose: run.lastBarClose,
        lastTickAt: run.lastTickAt,
        lastCandleAt: overview?.universe.lastCandleAt ?? null,
        staleTokens: sandboxRunStaleTokens(overview?.universe.staleTokens ?? [], run.tokenKeys),
        now: new Date(),
      })
    : [];
  const freshnessTone = sandboxFreshnessTone(freshness);
  const controls: DashboardControl[] = archived
    ? []
    : run.status === 'draft'
      ? ['start']
      : run.status === 'running'
        ? ['pause', 'stop']
        : run.status === 'paused'
          ? ['resume', 'stop']
          : [];

  const chartPoints = equityPoints.map((point) => ({
    label: formatDateTime(point.clockTime),
    value: Number(point.equityUsd),
  }));

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-lg font-semibold text-zinc-900">{run.name}</h2>
              <Badge tone={sandboxStatusTones[run.status]}>{sandboxStatusLabels[run.status]}</Badge>
              {archived ? <Badge tone="neutral">Архив</Badge> : null}
              <Badge tone="info">{run.executionMode}</Badge>
              {freshnessChecked ? (
                <Badge tone={freshnessTone === 'ok' ? 'success' : freshnessTone}>
                  {freshnessTone === 'ok' ? 'Данные свежие' : 'Данные требуют внимания'}
                </Badge>
              ) : (
                <Badge tone="neutral">Свежесть не проверяется</Badge>
              )}
            </div>
            <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-zinc-500">
              <span>{counts.positions} откр. позиций</span>
              <span>
                {counts.intents} интентов · {counts.pendingIntents} ожидает
              </span>
              <span>{counts.events} событий</span>
              <span>Токенов: {run.tokens.length}</span>
              <span>Тик: {formatDateTime(run.lastTickAt)}</span>
              <span>Бар 1h: {formatDateTime(run.lastBarClose)}</span>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {controls.map((action) => (
              <Button
                key={action}
                variant={action === 'stop' ? 'danger' : 'secondary'}
                disabled={busy}
                onClick={() => onControl(action)}
              >
                {controlLabels[action]}
              </Button>
            ))}
          </div>
        </div>

        {archived ? (
          <p className="mt-3 rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs text-zinc-600">
            Запуск в архиве: доступен только просмотр и отчёты.
          </p>
        ) : null}

        {run.status === 'draft' ? (
          <p className="mt-3 rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-xs text-sky-800">
            Черновик ещё не торгует. Настройки меняются в разделе «Запуски», затем запустите его.
          </p>
        ) : null}

        {run.status === 'failed' && run.error ? (
          <p className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {run.error}
          </p>
        ) : null}

        {freshness.length > 0 ? (
          <ul className="mt-3 space-y-1 text-xs">
            {freshness.map((warning) => (
              <li
                key={warning.message}
                className={
                  warning.tone === 'danger'
                    ? 'rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-red-700'
                    : 'rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-amber-800'
                }
              >
                {warning.message}
              </li>
            ))}
          </ul>
        ) : null}
      </Card>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
        <StatCard
          title="Капитал"
          value={formatUsd(run.equityUsd)}
          description="Equity по последнему бару"
          icon="statistics"
          tone="emerald"
        />
        <StatCard
          title="P&L"
          value={formatSignedUsd(absolutePnl)}
          description="Капитал минус начальный"
          icon="operations"
          tone={absolutePnl.startsWith('-') ? 'rose' : 'emerald'}
        />
        <StatCard
          title="Доходность"
          value={formatPct(returnPct)}
          description="К начальному капиталу"
          icon="dashboard"
          tone={returnPct.startsWith('-') ? 'rose' : 'sky'}
        />
        <StatCard
          title="Просадка"
          value={formatPct(drawdownPct).replace(/^[-+]/, '')}
          description="От пика капитала"
          icon="statistics"
          tone="amber"
        />
        <StatCard
          title="Свободный капитал"
          value={formatUsd(run.cashUsd)}
          description="Виртуальные деньги вне позиций"
          icon="finance"
          tone="sky"
        />
        <StatCard
          title="Позиции"
          value={String(counts.positions)}
          description={`${counts.openTrades} открытых сделок`}
          icon="portfolio"
          tone="violet"
        />
      </div>

      <Card>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle>Кривая капитала</CardTitle>
          <span className="text-xs text-zinc-500">
            Точек: {equityPoints.length}
            {equityTotal !== null ? ` из ${equityTotal}` : ''}
          </span>
        </div>
        {equityPending ? (
          <div className="mt-3">
            <LoadingRows rows={2} />
          </div>
        ) : equityError ? (
          <div className="mt-3">
            <ErrorState message="Не удалось загрузить кривую капитала" onRetry={onRetryEquity} />
          </div>
        ) : chartPoints.length === 0 ? (
          <p className="mt-3 rounded-lg border border-dashed border-zinc-300 bg-zinc-50 px-3 py-6 text-center text-sm text-zinc-500">
            Точек equity пока нет: они появятся после первого закрытого бара 1h.
          </p>
        ) : (
          <div className="mt-3">
            <LineChart points={chartPoints} height={200} />
          </div>
        )}
      </Card>

      <Card>
        <CardTitle>Позиции</CardTitle>
        {positionsPending ? (
          <div className="mt-3">
            <LoadingRows rows={2} />
          </div>
        ) : positionsError ? (
          <div className="mt-3">
            <ErrorState message="Не удалось загрузить позиции" onRetry={onRetryPositions} />
          </div>
        ) : positions.length === 0 ? (
          <p className="mt-3 rounded-lg border border-dashed border-zinc-300 bg-zinc-50 px-3 py-4 text-sm text-zinc-600">
            Открытых позиций нет. Решения принимаются автономно на закрытых барах 1h.
          </p>
        ) : (
          <div className="mt-3 space-y-2">
            {positions.map((position) => {
              const symbol = symbolByToken.get(position.tokenId) ?? position.tokenId;
              const pnl = sandboxPositionPnl(position);
              const eligibility = sandboxCloseEligibility({
                status: run.status,
                amount: position.amount,
                archivedAt: run.archivedAt,
              });
              return (
                <div key={position.tokenId} className="rounded-xl border border-zinc-200 px-4 py-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold text-zinc-900">{symbol}</span>
                      <Badge tone="neutral">{sandboxStrategyLabel(position.strategyKey)}</Badge>
                      {position.stopLossPct ? (
                        <Badge tone="warning">
                          Стоп {formatPercentPlain(position.stopLossPct)}
                        </Badge>
                      ) : null}
                      {position.takeProfitPct ? (
                        <Badge tone="info">Тейк {formatPercentPlain(position.takeProfitPct)}</Badge>
                      ) : null}
                    </div>
                    <div className="flex items-center gap-3">
                      <span
                        className={`font-mono text-sm font-semibold tabular-nums ${pnlTone(pnl.pnlUsd)}`}
                      >
                        {formatUsd(pnl.pnlUsd)} · {formatPct(pnl.pnlPct)}
                      </span>
                      {eligibility.eligible ? (
                        <Button
                          variant="danger"
                          disabled={busy}
                          onClick={() => onClose(position, symbol)}
                        >
                          Закрыть сделку
                        </Button>
                      ) : null}
                    </div>
                  </div>
                  <div className="mt-2 grid gap-x-4 gap-y-1 text-xs text-zinc-600 sm:grid-cols-3 xl:grid-cols-6">
                    <span>Количество: {formatTokenAmount(position.amount, 8)}</span>
                    <span>Средняя цена: {formatPrice(position.avgCostUsd)}</span>
                    <span>Рынок: {formatPrice(position.marketPriceUsd)}</span>
                    <span>Стоимость: {formatUsd(position.marketValueUsd)}</span>
                    <span>Вложено: {formatUsd(position.costBasisUsd)}</span>
                    <span>Комиссии: {formatUsd(position.feesPaidUsd)}</span>
                  </div>
                  <div className="mt-1 text-[11px] text-zinc-500">
                    Открыта {formatDateTime(position.openedAt)} · entry {position.entryIntentId}
                  </div>
                  {!eligibility.eligible && eligibility.reason ? (
                    <div className="mt-1 text-[11px] text-zinc-500">{eligibility.reason}</div>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
      </Card>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardTitle>Состояние токенов</CardTitle>
          {tokenStates.length === 0 ? (
            <p className="mt-3 text-sm text-zinc-600">В запуске нет токенов.</p>
          ) : (
            <div className="mt-3 space-y-2">
              {tokenStates.map((state) => (
                <div key={state.tokenId} className="rounded-xl border border-zinc-200 px-3 py-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-medium text-zinc-900">{state.symbol}</span>
                    {state.severity ? (
                      <Badge tone={sandboxEventSeverityTones[state.severity]}>
                        {sandboxEventSeverityLabels[state.severity]}
                      </Badge>
                    ) : (
                      <Badge tone="neutral">Нет событий</Badge>
                    )}
                  </div>
                  <div className="mt-1 grid gap-x-4 gap-y-1 text-xs text-zinc-600 sm:grid-cols-2">
                    <span>Режим: {sandboxRegimeLabel(state.regime)}</span>
                    <span>
                      Последнее решение:{' '}
                      {state.action ? sandboxDecisionActionLabels[state.action] : '—'}
                    </span>
                    <span>
                      Позиция:{' '}
                      {state.positionAmount ? formatTokenAmount(state.positionAmount, 8) : '—'}
                    </span>
                    <span>
                      Риск:{' '}
                      {state.riskStatus === 'failed'
                        ? `${state.failedRiskChecks} проверок не пройдено`
                        : state.riskStatus === 'passed'
                          ? 'Проверки пройдены'
                          : 'нет проверок'}
                    </span>
                  </div>
                  {state.reasonText ? (
                    <p className="mt-1 text-[11px] text-zinc-500">{state.reasonText}</p>
                  ) : null}
                  <div className="mt-1 text-[11px] text-zinc-400">
                    Обновлено {formatDateTime(state.lastEventAt)}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card>
          <CardTitle>Последнее решение</CardTitle>
          {lastDecision === null ? (
            <p className="mt-3 text-sm text-zinc-600">
              Решений пока нет: они появятся после первого закрытого бара 1h.
            </p>
          ) : (
            <div className="mt-3 space-y-2 text-sm text-zinc-700">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={sandboxEventSeverityTones[lastDecision.severity]}>
                  {sandboxEventSeverityLabels[lastDecision.severity]}
                </Badge>
                <Badge tone="info">{sandboxDecisionActionLabels[lastDecision.action]}</Badge>
                <span className="text-xs text-zinc-500">#{lastDecision.seq}</span>
              </div>
              <div className="grid gap-x-4 gap-y-1 text-xs text-zinc-600 sm:grid-cols-2">
                <span>Время: {formatDateTime(lastDecision.clockTime)}</span>
                <span>
                  Токен:{' '}
                  {lastDecision.tokenId
                    ? (symbolByToken.get(lastDecision.tokenId) ?? lastDecision.tokenId)
                    : '—'}
                </span>
                <span>Размер: {lastDecision.sizeUsd ? formatUsd(lastDecision.sizeUsd) : '—'}</span>
                <span>Альтернатив: {lastDecision.alternatives}</span>
              </div>
              <p className="rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs text-zinc-700">
                {lastDecision.reasonText}
              </p>
            </div>
          )}
        </Card>
      </div>

      {events.length > 0 ? (
        <Card>
          <CardTitle>Почему не вошли</CardTitle>
          <p className="mt-1 text-xs text-zinc-500">
            Альтернативы из последних решений: доказательство того, какие варианты отклонил движок.
          </p>
          <div className="mt-3 space-y-2">
            {events
              .filter((event) => event.decision !== null)
              .slice(-5)
              .reverse()
              .map((event) => {
                const whyNot = sandboxEventWhyNot(event);
                return (
                  <div
                    key={event.seq}
                    className="rounded-xl border border-zinc-200 px-3 py-2 text-xs text-zinc-600"
                  >
                    <div className="flex flex-wrap items-center gap-2 text-zinc-700">
                      <span className="font-medium">#{event.seq}</span>
                      <span>{formatDateTime(event.clockTime)}</span>
                      <span>
                        {event.tokenId ? (symbolByToken.get(event.tokenId) ?? event.tokenId) : '—'}
                      </span>
                      <Badge tone="neutral">
                        {event.decision ? sandboxDecisionActionLabels[event.decision.action] : '—'}
                      </Badge>
                    </div>
                    {whyNot.length > 0 ? (
                      <ul className="mt-1 list-disc space-y-0.5 pl-4">
                        {whyNot.map((reason) => (
                          <li key={reason}>{reason}</li>
                        ))}
                      </ul>
                    ) : (
                      <p className="mt-1">Альтернатив нет.</p>
                    )}
                  </div>
                );
              })}
          </div>
        </Card>
      ) : null}
    </div>
  );
}

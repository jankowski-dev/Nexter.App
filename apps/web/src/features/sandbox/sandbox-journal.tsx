import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardTitle } from '@/components/ui/card';
import { TabGroup } from '@/components/ui/list-toolbar';
import { Select } from '@/components/ui/select';
import { EmptyState, ErrorState, LoadingRows } from '@/components/ui/states';
import { Input } from '@/components/ui/input';
import { toRussianError } from '@/lib/error-messages';
import { formatDateTime, formatPrice, formatTokenAmount, formatUsd, pnlTone } from '@/lib/format';
import {
  useSandboxEvents,
  useSandboxIntents,
  useSandboxRunDetail,
  useSandboxTrades,
} from './sandbox-hooks';
import {
  defaultSandboxEventFilters,
  defaultSandboxIntentFilters,
  filterSandboxEvents,
  filterSandboxIntents,
  filterSandboxTrades,
  flattenSandboxEventPages,
  sandboxIntentFiltersActive,
  sandboxIntentFiltersWithOffset,
  sandboxPageState,
  sandboxRiskEvents,
  sandboxTradeFilterActive,
  sandboxTradeFilterWithOffset,
  type SandboxEventFilters,
  type SandboxIntentFilters,
  type SandboxTradeFilter,
} from './sandbox-journal-helpers';
import {
  sandboxDecisionActionLabels,
  sandboxDecisionActionTones,
  sandboxEventModuleLabels,
  sandboxEventSeverityLabels,
  sandboxEventSeverityTones,
  sandboxIntentSideLabels,
  sandboxIntentStatusLabels,
  sandboxIntentStatusTones,
  sandboxRegimeLabel,
  sandboxStrategyLabel,
  sandboxTradeStatusLabels,
} from './sandbox-labels';
import { SandboxRunPicker } from './sandbox-run-picker';
import type { SandboxTabSharedProps } from './sandbox-tab-types';
import { useEffect, useMemo, useState } from 'react';
import type {
  SandboxEvent,
  SandboxIntent,
  SandboxIntentStatus,
  SandboxTrade,
} from '@nexter/contracts';

type JournalSection = 'events' | 'intents' | 'trades' | 'risk';

const sections: ReadonlyArray<{ value: JournalSection; label: string }> = [
  { value: 'events', label: 'События' },
  { value: 'intents', label: 'Интенты' },
  { value: 'trades', label: 'Сделки' },
  { value: 'risk', label: 'Проверки риска' },
];

const modules = Object.keys(sandboxEventModuleLabels) as Array<SandboxEvent['module']>;
const eventSeverities: Array<SandboxEvent['severity']> = [
  'debug',
  'info',
  'warn',
  'error',
  'decision',
];
const intentStatuses: Array<SandboxIntentStatus> = [
  'pending',
  'filled',
  'partial',
  'rejected',
  'expired',
];

const JOURNAL_PAGE_SIZE = 50;

/**
 * `Журнал`: events, intents, trades and risk checks of the selected run.
 *
 * Event filters apply to the already loaded pages (the API paginates by
 * `afterSeq`), and the hint states that explicitly. Everything is read-only.
 */
export function SandboxJournal({
  runs,
  selectedRunId,
  onSelectRun,
  onChangeTab,
  selectionPending = false,
  initialSection = 'events',
  initialIntentFilters = defaultSandboxIntentFilters,
  initialTradeStatus = 'all',
}: SandboxTabSharedProps & {
  initialSection?: JournalSection;
  initialIntentFilters?: SandboxIntentFilters;
  initialTradeStatus?: SandboxTradeFilter;
}) {
  const detail = useSandboxRunDetail(selectedRunId);
  const live = detail.data?.status === 'running' && detail.data.archivedAt === null;
  const eventsQuery = useSandboxEvents(selectedRunId, live, 200);
  const [section, setSection] = useState<JournalSection>(initialSection);
  const [eventFilters, setEventFilters] = useState<SandboxEventFilters>(defaultSandboxEventFilters);
  const [riskTokenId, setRiskTokenId] = useState<string | null>(null);
  const [intentFilters, setIntentFilters] = useState<SandboxIntentFilters>(initialIntentFilters);
  const [intentOffset, setIntentOffset] = useState(0);
  const [tradeStatus, setTradeStatus] = useState<SandboxTradeFilter>(initialTradeStatus);
  const [tradeOffset, setTradeOffset] = useState(0);
  const intentsQuery = useSandboxIntents(selectedRunId, JOURNAL_PAGE_SIZE, intentOffset, live);
  const tradesQuery = useSandboxTrades(selectedRunId, JOURNAL_PAGE_SIZE, tradeOffset, live);

  function updateIntentFilters(patch: Partial<SandboxIntentFilters>): void {
    const next = sandboxIntentFiltersWithOffset(intentFilters, patch);
    setIntentFilters(next.filters);
    setIntentOffset(next.offset);
  }

  function updateTradeStatus(status: SandboxTradeFilter): void {
    const next = sandboxTradeFilterWithOffset(status);
    setTradeStatus(next.status);
    setTradeOffset(next.offset);
  }

  useEffect(() => {
    setIntentOffset(0);
    setTradeOffset(0);
    setEventFilters(defaultSandboxEventFilters);
    setIntentFilters(defaultSandboxIntentFilters);
    setRiskTokenId(null);
    setTradeStatus('all');
  }, [selectedRunId]);

  const events = useMemo(
    () => flattenSandboxEventPages(eventsQuery.data?.pages.map((page) => page.events) ?? []),
    [eventsQuery.data],
  );
  const filteredEvents = filterSandboxEvents(events, eventFilters);
  const riskEvents = sandboxRiskEvents(
    riskTokenId === null ? events : events.filter((event) => event.tokenId === riskTokenId),
  );
  const intents = filterSandboxIntents(intentsQuery.data?.intents ?? [], intentFilters);
  const trades = filterSandboxTrades(tradesQuery.data?.trades ?? [], tradeStatus);
  const tokenOptions = useMemo(() => {
    const byToken = new Map<string, string>();
    for (const token of detail.data?.tokens ?? []) byToken.set(token.tokenKey, token.symbol);
    for (const event of events) {
      if (event.tokenId && !byToken.has(event.tokenId)) byToken.set(event.tokenId, event.tokenId);
    }
    return [...byToken.entries()].map(([value, label]) => ({ value, label }));
  }, [detail.data?.tokens, events]);
  const symbolByToken = useMemo(
    () => new Map((detail.data?.tokens ?? []).map((token) => [token.tokenKey, token.symbol])),
    [detail.data?.tokens],
  );

  if (selectedRunId === null) {
    if (selectionPending) return <LoadingRows rows={4} />;
    return (
      <EmptyState
        title="Нет выбранного запуска"
        description="Журнал показывает события, интенты, сделки и проверки риска выбранного запуска. Сначала создайте и запустите его."
        action={
          onChangeTab ? (
            <Button onClick={() => onChangeTab('runs')}>Перейти к запускам</Button>
          ) : undefined
        }
      />
    );
  }

  return (
    <div className="space-y-4">
      <SandboxRunPicker runs={runs} selectedRunId={selectedRunId} onChange={onSelectRun} />

      {detail.isPending ? <LoadingRows rows={2} /> : null}
      {detail.isError ? (
        <ErrorState
          message={toRussianError(detail.error, 'Не удалось загрузить журнал запуска')}
          onRetry={() => void detail.refetch()}
        />
      ) : null}
      {detail.data ? (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-2 text-xs text-zinc-600">
          <span>Событий: {detail.data.eventCount}</span>
          <span className="break-all">Хеш цепочки: {detail.data.eventHash}</span>
          <span>Ожидающих интентов: {detail.data.pendingIntents}</span>
          <span>
            Сделок: {detail.data.closedTrades} закрыто · {detail.data.openTrades} открыто
          </span>
        </div>
      ) : null}
      {detail.data?.status === 'failed' && detail.data.error ? (
        <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {detail.data.error}
        </p>
      ) : null}

      <TabGroup
        value={section}
        options={sections}
        onChange={setSection}
        ariaLabel="Разделы журнала песочницы"
      />

      {section === 'events' ? (
        <EventsBlock
          query={eventsQuery}
          events={events}
          filtered={filteredEvents}
          filters={eventFilters}
          onFilters={setEventFilters}
          tokenOptions={tokenOptions}
          symbolByToken={symbolByToken}
        />
      ) : null}

      {section === 'risk' ? (
        <Card>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle>Проверки риска</CardTitle>
            <Select
              aria-label="Фильтр проверок по токену"
              className="w-52"
              value={riskTokenId ?? ''}
              onChange={(event) => setRiskTokenId(event.target.value || null)}
            >
              <option value="">Все токены</option>
              {tokenOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
          </div>
          <p className="mt-1 text-xs text-zinc-500">
            События с проверками риска из загруженной части журнала: имя, значение, лимит и
            результат.
          </p>
          {eventsQuery.isPending ? (
            <div className="mt-3">
              <LoadingRows rows={3} />
            </div>
          ) : eventsQuery.isError ? (
            <div className="mt-3">
              <ErrorState
                message="Не удалось загрузить проверки риска"
                onRetry={() => void eventsQuery.refetch()}
              />
            </div>
          ) : riskEvents.length === 0 ? (
            <p className="mt-3 text-sm text-zinc-600">Проверок риска пока нет.</p>
          ) : (
            <div className="mt-3 space-y-2">
              {riskEvents.map((event) => (
                <RiskCheckRow
                  key={event.seq}
                  event={event}
                  symbol={event.tokenId ? (symbolByToken.get(event.tokenId) ?? event.tokenId) : '—'}
                />
              ))}
            </div>
          )}
          <EventLoadMore query={eventsQuery} events={events} />
        </Card>
      ) : null}

      {section === 'intents' ? (
        <IntentsBlock
          query={intentsQuery}
          intents={intents}
          filters={intentFilters}
          onFilters={updateIntentFilters}
          tokenOptions={tokenOptions}
          symbolByToken={symbolByToken}
          offset={intentOffset}
          onOffset={setIntentOffset}
          onRefresh={() => void intentsQuery.refetch()}
        />
      ) : null}

      {section === 'trades' ? (
        <TradesBlock
          query={tradesQuery}
          trades={trades}
          status={tradeStatus}
          onStatus={updateTradeStatus}
          symbolByToken={symbolByToken}
          offset={tradeOffset}
          onOffset={setTradeOffset}
          onRefresh={() => void tradesQuery.refetch()}
        />
      ) : null}
    </div>
  );
}

function EventsBlock({
  query,
  events,
  filtered,
  filters,
  onFilters,
  tokenOptions,
  symbolByToken,
}: {
  query: ReturnType<typeof useSandboxEvents>;
  events: readonly SandboxEvent[];
  filtered: readonly SandboxEvent[];
  filters: SandboxEventFilters;
  onFilters: (filters: SandboxEventFilters) => void;
  tokenOptions: ReadonlyArray<{ value: string; label: string }>;
  symbolByToken: ReadonlyMap<string, string>;
}) {
  return (
    <Card>
      <div className="flex flex-wrap items-end gap-2">
        <label className="text-xs text-zinc-600">
          Токен
          <Select
            aria-label="Фильтр событий по токену"
            className="mt-1 w-44"
            value={filters.tokenId ?? ''}
            onChange={(event) => onFilters({ ...filters, tokenId: event.target.value || null })}
          >
            <option value="">Все токены</option>
            {tokenOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
        </label>
        <label className="text-xs text-zinc-600">
          Модуль
          <Select
            aria-label="Фильтр событий по модулю"
            className="mt-1 w-44"
            value={filters.module}
            onChange={(event) =>
              onFilters({ ...filters, module: event.target.value as SandboxEventFilters['module'] })
            }
          >
            <option value="all">Все модули</option>
            {modules.map((module) => (
              <option key={module} value={module}>
                {sandboxEventModuleLabels[module]}
              </option>
            ))}
          </Select>
        </label>
        <label className="text-xs text-zinc-600">
          Важность
          <Select
            aria-label="Фильтр событий по важности"
            className="mt-1 w-44"
            value={filters.severity}
            onChange={(event) =>
              onFilters({
                ...filters,
                severity: event.target.value as SandboxEventFilters['severity'],
              })
            }
          >
            <option value="all">Все уровни</option>
            {eventSeverities.map((severity) => (
              <option key={severity} value={severity}>
                {sandboxEventSeverityLabels[severity]}
              </option>
            ))}
          </Select>
        </label>
        <label className="text-xs text-zinc-600">
          Тип события
          <Input
            className="mt-1 w-56"
            value={filters.eventType}
            placeholder="Например, risk."
            onChange={(event) => onFilters({ ...filters, eventType: event.target.value })}
          />
        </label>
      </div>

      <p className="mt-2 text-xs text-zinc-500">
        Фильтры применяются к загруженным событиям: показано {filtered.length} из {events.length}.
      </p>

      {query.isPending ? (
        <div className="mt-3">
          <LoadingRows rows={4} />
        </div>
      ) : query.isError ? (
        <div className="mt-3">
          <ErrorState message="Не удалось загрузить события" onRetry={() => void query.refetch()} />
        </div>
      ) : events.length === 0 ? (
        <p className="mt-3 rounded-lg border border-dashed border-zinc-300 bg-zinc-50 px-3 py-4 text-sm text-zinc-600">
          Событий пока нет: первое появится после старта и первого закрытого бара 1h.
        </p>
      ) : filtered.length === 0 ? (
        <p className="mt-3 text-sm text-zinc-600">Под фильтры не подошло ни одно событие.</p>
      ) : (
        <div className="mt-3 space-y-2">
          {filtered.map((event) => (
            <EventRow
              key={event.seq}
              event={event}
              symbol={event.tokenId ? (symbolByToken.get(event.tokenId) ?? event.tokenId) : null}
            />
          ))}
        </div>
      )}

      <EventLoadMore query={query} events={events} />
    </Card>
  );
}

function EventLoadMore({
  query,
  events,
}: {
  query: ReturnType<typeof useSandboxEvents>;
  events: readonly SandboxEvent[];
}) {
  if (query.hasNextPage) {
    return (
      <div className="mt-3 flex flex-col items-center gap-1">
        <span className="text-[11px] text-zinc-500">
          Загружено {events.length}; есть ещё события.
        </span>
        <Button
          variant="secondary"
          disabled={query.isFetchingNextPage}
          onClick={() => void query.fetchNextPage()}
        >
          {query.isFetchingNextPage ? 'Загружаю…' : 'Загрузить ещё'}
        </Button>
      </div>
    );
  }
  if (events.length === 0) return null;
  return (
    <div className="mt-3 text-center text-[11px] text-zinc-500">
      Загружено {events.length}; это весь журнал.
    </div>
  );
}

function EventRow({ event, symbol }: { event: SandboxEvent; symbol: string | null }) {
  return (
    <details className="rounded-xl border border-zinc-200 px-3 py-2">
      <summary className="flex cursor-pointer flex-wrap items-center gap-2 text-xs text-zinc-600">
        <span className="font-mono font-medium text-zinc-800">#{event.seq}</span>
        <span>{formatDateTime(event.clockTime)}</span>
        <Badge tone="neutral">{sandboxEventModuleLabels[event.module]}</Badge>
        <Badge tone={sandboxEventSeverityTones[event.severity]}>
          {sandboxEventSeverityLabels[event.severity]}
        </Badge>
        <span className="font-medium text-zinc-700">{event.eventType}</span>
        <span>{symbol ?? '—'}</span>
        {event.decision ? (
          <Badge tone={sandboxDecisionActionTones[event.decision.action]}>
            {sandboxDecisionActionLabels[event.decision.action]}
          </Badge>
        ) : null}
        {event.regime ? <span>Режим: {sandboxRegimeLabel(event.regime)}</span> : null}
      </summary>

      <div className="mt-2 space-y-2 border-t border-zinc-100 pt-2 text-xs text-zinc-600">
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          <span>Стратегия: {sandboxStrategyLabel(event.strategyId)}</span>
          <span>Режим: {sandboxRegimeLabel(event.regime)}</span>
          <span>Записано: {formatDateTime(event.recordedAt)}</span>
        </div>

        {event.decision ? (
          <div className="rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={sandboxDecisionActionTones[event.decision.action]}>
                {sandboxDecisionActionLabels[event.decision.action]}
              </Badge>
              <span>
                Размер: {event.decision.sizeUsd ? formatUsd(event.decision.sizeUsd) : '—'}
              </span>
              <span>Код: {event.decision.reasonCode}</span>
            </div>
            <p className="mt-1">{event.decision.reasonText}</p>
          </div>
        ) : null}

        {event.reasonCode || event.reasonText ? (
          <div>
            <span className="font-medium text-zinc-700">Причина: </span>
            {event.reasonCode ?? '—'} · {event.reasonText ?? '—'}
          </div>
        ) : null}

        {event.alternatives.length > 0 ? (
          <div>
            <div className="font-medium text-zinc-700">Почему не (альтернативы)</div>
            <ul className="mt-1 list-disc space-y-1 pl-4">
              {event.alternatives.map((alternative) => (
                <li key={`${alternative.action}-${alternative.reasonCode}`}>
                  {sandboxDecisionActionLabels[alternative.action]}: {alternative.whyNot} (
                  {alternative.reasonCode})
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {event.riskChecks.length > 0 ? (
          <div>
            <div className="font-medium text-zinc-700">Проверки риска</div>
            <RiskCheckTable event={event} />
          </div>
        ) : null}

        <div className="break-all text-[11px] text-zinc-400">
          seq {event.seq} · prevHash {event.prevHash} · hash {event.hash}
        </div>
      </div>
    </details>
  );
}

function RiskCheckTable({ event }: { event: SandboxEvent }) {
  return (
    <div className="mt-1 overflow-x-auto">
      <table className="w-full min-w-[520px] text-left text-[11px]">
        <thead className="text-zinc-500">
          <tr>
            <th className="py-1 pr-2">Проверка</th>
            <th className="py-1 pr-2">Значение</th>
            <th className="py-1 pr-2">Лимит</th>
            <th className="py-1">Результат</th>
          </tr>
        </thead>
        <tbody>
          {event.riskChecks.map((check) => (
            <tr key={check.name} className="border-t border-zinc-100">
              <td className="py-1 pr-2 text-zinc-700">{check.name}</td>
              <td className="py-1 pr-2 font-mono">{check.value}</td>
              <td className="py-1 pr-2 font-mono">{check.limit}</td>
              <td className="py-1">
                <Badge tone={check.passed ? 'success' : 'danger'}>
                  {check.passed ? 'Пройдено' : 'Не пройдено'}
                </Badge>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function RiskCheckRow({ event, symbol }: { event: SandboxEvent; symbol: string }) {
  return (
    <details className="rounded-xl border border-zinc-200 px-3 py-2" open>
      <summary className="flex cursor-pointer flex-wrap items-center gap-2 text-xs text-zinc-600">
        <span className="font-mono font-medium text-zinc-800">#{event.seq}</span>
        <span>{formatDateTime(event.clockTime)}</span>
        <span>{symbol}</span>
        <Badge tone={event.riskChecks.some((check) => !check.passed) ? 'danger' : 'success'}>
          {event.riskChecks.filter((check) => check.passed).length}/{event.riskChecks.length}{' '}
          пройдено
        </Badge>
        <span>{event.eventType}</span>
      </summary>
      <div className="mt-2 border-t border-zinc-100 pt-2">
        <RiskCheckTable event={event} />
      </div>
    </details>
  );
}

function OffsetPager({
  total,
  offset,
  limit,
  busy,
  onOffset,
}: {
  total: number;
  offset: number;
  limit: number;
  busy: boolean;
  onOffset: (offset: number) => void;
}) {
  const page = sandboxPageState(total, limit, offset);
  return (
    <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-zinc-600">
      <span>
        {page.from}–{page.to} из {page.total}
      </span>
      <div className="flex gap-2">
        <Button
          variant="secondary"
          disabled={!page.canPrev || busy}
          onClick={() => onOffset(Math.max(0, offset - limit))}
        >
          Назад
        </Button>
        <Button
          variant="secondary"
          disabled={!page.canNext || busy}
          onClick={() => onOffset(offset + limit)}
        >
          Вперёд
        </Button>
      </div>
    </div>
  );
}

function IntentsBlock({
  query,
  intents,
  filters,
  onFilters,
  tokenOptions,
  symbolByToken,
  offset,
  onOffset,
  onRefresh,
}: {
  query: ReturnType<typeof useSandboxIntents>;
  intents: readonly SandboxIntent[];
  filters: SandboxIntentFilters;
  onFilters: (patch: Partial<SandboxIntentFilters>) => void;
  tokenOptions: ReadonlyArray<{ value: string; label: string }>;
  symbolByToken: ReadonlyMap<string, string>;
  offset: number;
  onOffset: (offset: number) => void;
  onRefresh: () => void;
}) {
  const loaded = query.data?.intents.length ?? 0;
  const active = sandboxIntentFiltersActive(filters);

  return (
    <Card>
      <div className="flex flex-wrap items-end gap-2">
        <label className="text-xs text-zinc-600">
          Статус
          <Select
            aria-label="Фильтр интентов по статусу"
            className="mt-1 w-40"
            value={filters.status}
            onChange={(event) =>
              onFilters({ status: event.target.value as SandboxIntentFilters['status'] })
            }
          >
            <option value="all">Все статусы</option>
            {intentStatuses.map((status) => (
              <option key={status} value={status}>
                {sandboxIntentStatusLabels[status]}
              </option>
            ))}
          </Select>
        </label>
        <label className="text-xs text-zinc-600">
          Сторона
          <Select
            aria-label="Фильтр интентов по стороне"
            className="mt-1 w-36"
            value={filters.side}
            onChange={(event) =>
              onFilters({ side: event.target.value as SandboxIntentFilters['side'] })
            }
          >
            <option value="all">Все</option>
            <option value="buy">{sandboxIntentSideLabels.buy}</option>
            <option value="sell">{sandboxIntentSideLabels.sell}</option>
          </Select>
        </label>
        <label className="text-xs text-zinc-600">
          Токен
          <Select
            aria-label="Фильтр интентов по токену"
            className="mt-1 w-44"
            value={filters.tokenId ?? ''}
            onChange={(event) => onFilters({ tokenId: event.target.value || null })}
          >
            <option value="">Все токены</option>
            {tokenOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
        </label>
        <Button variant="ghost" onClick={onRefresh}>
          Обновить
        </Button>
      </div>

      <p className="mt-2 text-xs text-zinc-500">
        {active
          ? `Фильтры применяются к загруженной странице: показано ${intents.length} из ${loaded} загруженных.`
          : `Загружено ${loaded}${query.data ? ` из ${query.data.total}` : ''}.`}
      </p>

      {query.isPending ? (
        <div className="mt-3">
          <LoadingRows rows={4} />
        </div>
      ) : query.isError ? (
        <div className="mt-3">
          <ErrorState message="Не удалось загрузить интенты" onRetry={onRefresh} />
        </div>
      ) : loaded === 0 ? (
        <p className="mt-3 rounded-lg border border-dashed border-zinc-300 bg-zinc-50 px-3 py-4 text-sm text-zinc-600">
          {active ? 'На загруженной странице нет интентов под этот фильтр.' : 'Интентов пока нет.'}
        </p>
      ) : intents.length === 0 ? (
        <p className="mt-3 text-sm text-zinc-600">
          На загруженной странице нет интентов под этот фильтр.
        </p>
      ) : (
        <div className="mt-3 space-y-2">
          {intents.map((intent) => (
            <div key={intent.intentId} className="rounded-xl border border-zinc-200 px-3 py-2">
              <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-600">
                <Badge tone={sandboxIntentStatusTones[intent.status]}>
                  {sandboxIntentStatusLabels[intent.status]}
                </Badge>
                <Badge tone={intent.side === 'buy' ? 'success' : 'info'}>
                  {sandboxIntentSideLabels[intent.side]}
                </Badge>
                <span className="font-medium text-zinc-800">
                  {symbolByToken.get(intent.tokenId) ?? intent.tokenId}
                </span>
                <span>{sandboxStrategyLabel(intent.strategyKey)}</span>
                <span>Код: {intent.reasonCode}</span>
                {intent.strategyReasonCode ? (
                  <span>Стратегия: {intent.strategyReasonCode}</span>
                ) : null}
              </div>
              <div className="mt-1 grid gap-x-4 gap-y-1 text-xs text-zinc-600 sm:grid-cols-3 xl:grid-cols-6">
                <span>
                  Запрошено:{' '}
                  {intent.requestedUsd
                    ? formatUsd(intent.requestedUsd)
                    : intent.requestedAmount
                      ? formatTokenAmount(intent.requestedAmount, 8)
                      : '—'}
                </span>
                <span>Исполнено: {formatUsd(intent.filledUsd)}</span>
                <span>Цена: {intent.priceUsd ? formatPrice(intent.priceUsd) : '—'}</span>
                <span>Комиссия: {formatUsd(intent.feeUsd)}</span>
                <span>Решение: {formatDateTime(intent.decisionTime)}</span>
                <span>Исполнение: {formatDateTime(intent.fillTime)}</span>
              </div>
              {intent.reasonText ? (
                <p className="mt-1 text-[11px] text-zinc-500">{intent.reasonText}</p>
              ) : null}
            </div>
          ))}
        </div>
      )}

      {query.data && !active ? (
        <OffsetPager
          total={query.data.total}
          offset={offset}
          limit={query.data.limit}
          busy={query.isFetching}
          onOffset={onOffset}
        />
      ) : null}
    </Card>
  );
}

function TradesBlock({
  query,
  trades,
  status,
  onStatus,
  symbolByToken,
  offset,
  onOffset,
  onRefresh,
}: {
  query: ReturnType<typeof useSandboxTrades>;
  trades: readonly SandboxTrade[];
  status: SandboxTradeFilter;
  onStatus: (status: SandboxTradeFilter) => void;
  symbolByToken: ReadonlyMap<string, string>;
  offset: number;
  onOffset: (offset: number) => void;
  onRefresh: () => void;
}) {
  const loaded = query.data?.trades.length ?? 0;
  const active = sandboxTradeFilterActive(status);

  return (
    <Card>
      <div className="flex flex-wrap items-end gap-2">
        <label className="text-xs text-zinc-600">
          Состояние
          <Select
            aria-label="Фильтр сделок"
            className="mt-1 w-40"
            value={status}
            onChange={(event) => onStatus(event.target.value as SandboxTradeFilter)}
          >
            <option value="all">Все сделки</option>
            <option value="open">Открытые</option>
            <option value="closed">Закрытые</option>
          </Select>
        </label>
        <Button variant="ghost" onClick={onRefresh}>
          Обновить
        </Button>
      </div>

      <p className="mt-2 text-xs text-zinc-500">
        {active
          ? `Фильтры применяются к загруженной странице: показано ${trades.length} из ${loaded} загруженных.`
          : `Загружено ${loaded}${query.data ? ` из ${query.data.total}` : ''}.`}
      </p>

      {query.isPending ? (
        <div className="mt-3">
          <LoadingRows rows={4} />
        </div>
      ) : query.isError ? (
        <div className="mt-3">
          <ErrorState message="Не удалось загрузить сделки" onRetry={onRefresh} />
        </div>
      ) : loaded === 0 ? (
        <p className="mt-3 rounded-lg border border-dashed border-zinc-300 bg-zinc-50 px-3 py-4 text-sm text-zinc-600">
          {active ? 'На загруженной странице нет сделок под этот фильтр.' : 'Сделок пока нет.'}
        </p>
      ) : trades.length === 0 ? (
        <p className="mt-3 text-sm text-zinc-600">
          На загруженной странице нет сделок под этот фильтр.
        </p>
      ) : (
        <div className="mt-3 space-y-2">
          {trades.map((trade) => (
            <div key={trade.tradeId} className="rounded-xl border border-zinc-200 px-3 py-2">
              <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-600">
                <Badge tone={trade.status === 'open' ? 'info' : 'neutral'}>
                  {sandboxTradeStatusLabels[trade.status]}
                </Badge>
                <span className="font-medium text-zinc-800">
                  {symbolByToken.get(trade.tokenId) ?? trade.tokenId}
                </span>
                <span>{sandboxStrategyLabel(trade.strategyKey)}</span>
                <span className={`font-mono ${pnlTone(trade.realizedPnlUsd)}`}>
                  P&L {formatUsd(trade.realizedPnlUsd)}
                </span>
                {trade.exitReasonCode ? <span>Выход: {trade.exitReasonCode}</span> : null}
              </div>
              <div className="mt-1 grid gap-x-4 gap-y-1 text-xs text-zinc-600 sm:grid-cols-3 xl:grid-cols-6">
                <span>Вход: {formatDateTime(trade.entryAt)}</span>
                <span>Цена входа: {formatPrice(trade.entryPriceUsd)}</span>
                <span>Сумма входа: {formatUsd(trade.entryNotionalUsd)}</span>
                <span>Выход: {formatDateTime(trade.exitAt)}</span>
                <span>
                  Цена выхода: {trade.exitPriceUsd ? formatPrice(trade.exitPriceUsd) : '—'}
                </span>
                <span>Сумма выхода: {formatUsd(trade.exitNotionalUsd)}</span>
              </div>
            </div>
          ))}
        </div>
      )}

      {query.data && !active ? (
        <OffsetPager
          total={query.data.total}
          offset={offset}
          limit={query.data.limit}
          busy={query.isFetching}
          onOffset={onOffset}
        />
      ) : null}
    </Card>
  );
}

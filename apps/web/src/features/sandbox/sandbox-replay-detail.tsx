import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardTitle } from '@/components/ui/card';
import { StatCard } from '@/components/ui/stat-card';
import { LineChart } from '@/components/charts/line-chart';
import { ErrorState, LoadingRows } from '@/components/ui/states';
import { downloadSandboxReplayReport } from './sandbox-api';
import { useSandboxReplay, useSandboxReplayReport } from './sandbox-hooks';
import { SandboxReplayChart } from './sandbox-replay-chart';
import {
  sandboxIntentSideLabels,
  sandboxIntentStatusLabels,
  sandboxIntentStatusTones,
  sandboxStrategyLabel,
} from './sandbox-labels';
import {
  sandboxReplayCanArchive,
  sandboxReplayCanCancel,
  sandboxReplayCounterfactualOutcomeLabels,
  sandboxReplayCounterfactualOutcomeTones,
  sandboxReplayDetailError,
  sandboxReplayDownloadError,
  sandboxReplayElapsedLabel,
  sandboxReplayIsActive,
  sandboxReplayPeriodLabel,
  sandboxReplayReportError,
  sandboxReplayStatusLabels,
  sandboxReplayStatusTones,
  sandboxReplaySummaryCards,
  sandboxReplayTokenSymbols,
  sandboxReplayWindowLabel,
} from './sandbox-replay-helpers';
import {
  formatSandboxPercentPlain,
  formatSandboxReportTimestamp,
  sandboxReportPrice,
} from './sandbox-report-helpers';
import { formatDateTime, formatPct, formatUsd, pnlTone } from '@/lib/format';
import { useMemo, useState } from 'react';
import type {
  SandboxReplayDetail as SandboxReplayDetailData,
  SandboxReplayReportResponse,
  SandboxReportCounterfactual,
  SandboxReportIntent,
  SandboxReportTrade,
} from '@nexter/contracts';

export interface SandboxReplayDetailProps {
  replayId: string;
  onClose?: () => void;
  onArchive?: (replay: SandboxReplayDetailData) => void;
  onCancel?: (replay: SandboxReplayDetailData) => void;
  busy?: boolean;
  symbolByKey?: ReadonlyMap<string, string>;
}

/**
 * `Детали прогона`: progress while queued/running, then the stored report.
 *
 * The report is fetched only after `completed`; failed/cancelled replays show
 * the persisted error/state and never render a partial report. There is no
 * manual buy/add and no live-run mutation in this view.
 */
export function SandboxReplayDetail({
  replayId,
  onClose,
  onArchive,
  onCancel,
  busy = false,
  symbolByKey = new Map<string, string>(),
}: SandboxReplayDetailProps) {
  const replay = useSandboxReplay(replayId);
  const completed = replay.data?.status === 'completed';
  const report = useSandboxReplayReport(replayId, completed);

  if (replay.isPending) return <LoadingRows rows={5} />;

  if (replay.isError || !replay.data) {
    return (
      <ErrorState
        message={sandboxReplayDetailError(replay.error)}
        onRetry={() => void replay.refetch()}
      />
    );
  }

  const data = replay.data;
  const active = sandboxReplayIsActive(data.status);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="truncate text-lg font-semibold text-zinc-900">{data.name}</h2>
            <Badge tone={sandboxReplayStatusTones[data.status]}>
              {sandboxReplayStatusLabels[data.status]}
            </Badge>
            {data.archivedAt ? <Badge tone="neutral">Архив</Badge> : null}
            <Badge tone="info">{sandboxReplayPeriodLabel(data.periodDays)}</Badge>
          </div>
          <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-zinc-500">
            <span>Токены: {sandboxReplayTokenSymbols(data.tokenKeys, symbolByKey)}</span>
            <span>Окно: {sandboxReplayWindowLabel(data.fromTime, data.toTime)}</span>
            <span>seed {data.seed}</span>
            {data.eventCount !== null ? <span>Событий: {data.eventCount}</span> : null}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {onCancel && sandboxReplayCanCancel(data) ? (
            <Button variant="danger" disabled={busy} onClick={() => onCancel(data)}>
              Отменить
            </Button>
          ) : null}
          {onArchive && sandboxReplayCanArchive(data) ? (
            <Button variant="secondary" disabled={busy} onClick={() => onArchive(data)}>
              В архив
            </Button>
          ) : null}
          {onClose ? (
            <Button variant="ghost" onClick={onClose}>
              Закрыть
            </Button>
          ) : null}
        </div>
      </div>

      {active ? <ReplayProgress replay={data} /> : null}

      {data.status === 'failed' ? (
        <Card className="border-red-200 bg-red-50">
          <CardTitle className="text-red-700">Прогон завершился ошибкой</CardTitle>
          <p className="mt-2 text-sm text-red-700">
            {data.error ?? 'Сервер не сохранил текст ошибки.'}
          </p>
          <p className="mt-2 text-xs text-red-700/80">
            Отчёт не сформирован. Обновите данные токенов и запустите новый прогон.
          </p>
        </Card>
      ) : null}

      {data.status === 'cancelled' ? (
        <Card className="border-zinc-200 bg-zinc-50">
          <CardTitle>Прогон отменён</CardTitle>
          <p className="mt-2 text-sm text-zinc-700">
            Прогон отменён владельцем до запуска. Отчёт и снимок данных не создавались.
          </p>
        </Card>
      ) : null}

      {completed ? <SandboxReplayChart replay={data} symbolByKey={symbolByKey} /> : null}

      {completed ? (
        <>
          {report.isPending ? <LoadingRows rows={6} /> : null}
          {report.isError ? (
            <ErrorState
              message={sandboxReplayReportError(report.error)}
              onRetry={() => void report.refetch()}
            />
          ) : null}
          {report.data ? (
            <ReplayReportBody replay={data} response={report.data} symbolByKey={symbolByKey} />
          ) : null}
        </>
      ) : null}
    </div>
  );
}

function ReplayProgress({ replay }: { replay: SandboxReplayDetailData }) {
  return (
    <Card className="border-sky-200 bg-sky-50/60">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={sandboxReplayStatusTones[replay.status]}>
          {sandboxReplayStatusLabels[replay.status]}
        </Badge>
        <span className="text-sm font-medium text-sky-900">Прогон ещё не завершён</span>
      </div>
      <div className="mt-3 grid gap-2 text-xs text-sky-900/80 sm:grid-cols-3">
        <span>Поставлен: {formatDateTime(replay.queuedAt)}</span>
        <span>Начат: {formatDateTime(replay.startedAt)}</span>
        <span>
          Длительность:{' '}
          {sandboxReplayElapsedLabel({
            queuedAt: replay.queuedAt,
            startedAt: replay.startedAt,
            finishedAt: replay.finishedAt,
            nowMs: Date.now(),
          })}
        </span>
      </div>
      <div className="mt-3 h-2 overflow-hidden rounded-full bg-sky-100">
        <div className="h-full w-1/3 animate-pulse rounded-full bg-sky-500" />
      </div>
      <p className="mt-3 text-sm text-sky-900">
        {replay.status === 'queued'
          ? 'Прогон ждёт свободный worker. Отчёт появится автоматически после запуска.'
          : 'Идёт расчёт на сохранённых свечах 1h. Прогресс по барам недоступен до завершения.'}
      </p>
    </Card>
  );
}

function ReplayReportBody({
  replay,
  response,
  symbolByKey,
}: {
  replay: SandboxReplayDetailData;
  response: SandboxReplayReportResponse;
  symbolByKey: ReadonlyMap<string, string>;
}) {
  const { report } = response;
  const cards = sandboxReplaySummaryCards(report.metrics);
  const [pending, setPending] = useState<'json' | 'pdf' | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const chartPoints = useMemo(
    () =>
      report.equityCurve.map((point) => ({
        label: formatDateTime(new Date(point.clockTime).toISOString()),
        value: Number(point.equityUsd),
      })),
    [report.equityCurve],
  );

  async function download(format: 'json' | 'pdf'): Promise<void> {
    setPending(format);
    setDownloadError(null);
    try {
      await downloadSandboxReplayReport(replay.id, format);
    } catch (error) {
      setDownloadError(sandboxReplayDownloadError(error));
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-base font-semibold text-zinc-900">Отчёт прогона</h3>
              <Badge tone="info">{response.executionMode}</Badge>
              <Badge tone={report.reconciliationOk ? 'success' : 'danger'}>
                {report.reconciliationOk ? 'Сверка пройдена' : 'Сверка не пройдена'}
              </Badge>
            </div>
            <p className="mt-1 text-xs text-zinc-500">
              {sandboxReplayWindowLabel(replay.fromTime, replay.toTime)} ·{' '}
              {sandboxReplayPeriodLabel(replay.periodDays)} · {report.period.bars} бар. ·{' '}
              {report.period.tokens.length} ток.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="secondary"
              disabled={pending !== null}
              onClick={() => void download('json')}
            >
              {pending === 'json' ? 'Готовлю JSON…' : 'Скачать JSON'}
            </Button>
            <Button
              variant="secondary"
              disabled={pending !== null}
              onClick={() => void download('pdf')}
            >
              {pending === 'pdf' ? 'Готовлю PDF…' : 'Скачать PDF'}
            </Button>
          </div>
        </div>

        {downloadError ? (
          <div
            role="alert"
            className="mt-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
          >
            {downloadError}
          </div>
        ) : null}

        <p className="mt-3 text-[11px] text-zinc-500">
          Технические данные, хеши и полный журнал решений доступны в PDF и JSON.
        </p>
      </Card>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {cards.map((card) => (
          <StatCard
            key={card.title}
            title={card.title}
            value={card.value}
            description={card.description}
            icon={card.icon}
            tone={card.tone}
          />
        ))}
      </div>

      <Card>
        <CardTitle>Кривая капитала</CardTitle>
        {chartPoints.length === 0 ? (
          <p className="mt-3 text-sm text-zinc-600">Точек equity в отчёте нет.</p>
        ) : (
          <div className="mt-3">
            <LineChart points={chartPoints} height={200} />
          </div>
        )}
      </Card>

      <div className="space-y-4">
        <Card>
          <CardTitle>По стратегиям</CardTitle>
          <ReplayMetricTable
            labelHeader="Стратегия"
            rows={report.metrics.perStrategy.map((row) => ({
              key: row.strategyKey,
              label: sandboxStrategyLabel(row.strategyKey),
              trades: row.tradeCount,
              wins: row.wins,
              losses: row.losses,
              pnl: row.realizedPnlUsd,
              winRate: row.winRatePct,
            }))}
          />
        </Card>
        <Card>
          <CardTitle>По токенам</CardTitle>
          <ReplayMetricTable
            labelHeader="Токен"
            rows={report.metrics.perToken.map((row) => ({
              key: row.tokenId,
              label: symbolByKey.get(row.tokenId) ?? row.tokenId,
              trades: row.tradeCount,
              wins: row.wins,
              losses: row.losses,
              pnl: row.realizedPnlUsd,
              winRate: row.winRatePct,
            }))}
          />
        </Card>
      </div>

      <ReplayTradesTable trades={report.trades} symbolByKey={symbolByKey} />
      <ReplayIntentJournal intents={report.intentJournal} symbolByKey={symbolByKey} />
      <ReplayCounterfactuals counterfactuals={report.counterfactuals} symbolByKey={symbolByKey} />
    </div>
  );
}

function ReplayMetricTable({
  labelHeader,
  rows,
}: {
  labelHeader: string;
  rows: ReadonlyArray<{
    key: string;
    label: string;
    trades: number;
    wins: number;
    losses: number;
    pnl: string;
    winRate: string | null;
  }>;
}) {
  if (rows.length === 0) {
    return <p className="mt-3 text-sm text-zinc-600">Нет закрытых сделок для разбивки.</p>;
  }

  return (
    <div className="mt-3 overflow-x-auto">
      <table className="w-full min-w-[520px] text-left text-xs">
        <thead className="text-zinc-500">
          <tr>
            <th className="py-1 pr-2">{labelHeader}</th>
            <th className="py-1 pr-2">Сделки</th>
            <th className="py-1 pr-2">Победы</th>
            <th className="py-1 pr-2">Поражения</th>
            <th className="py-1 pr-2">P&L</th>
            <th className="py-1">Win rate</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key} className="border-t border-zinc-100">
              <td className="py-1 pr-2 break-all text-zinc-800">{row.label}</td>
              <td className="py-1 pr-2">{row.trades}</td>
              <td className="py-1 pr-2">{row.wins}</td>
              <td className="py-1 pr-2">{row.losses}</td>
              <td className={`py-1 pr-2 font-mono ${pnlTone(row.pnl)}`}>{formatUsd(row.pnl)}</td>
              <td className="py-1">
                {row.winRate === null ? '—' : formatSandboxPercentPlain(row.winRate)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ReplayTradesTable({
  trades,
  symbolByKey,
}: {
  trades: readonly SandboxReportTrade[];
  symbolByKey: ReadonlyMap<string, string>;
}) {
  const [visible, setVisible] = useState(20);

  return (
    <Card>
      <CardTitle>Сделки прогона</CardTitle>
      {trades.length === 0 ? (
        <p className="mt-3 text-sm text-zinc-600">Сделок нет.</p>
      ) : (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[900px] text-left text-xs">
            <thead className="text-zinc-500">
              <tr>
                <th className="py-1 pr-2">Токен</th>
                <th className="py-1 pr-2">Стратегия</th>
                <th className="py-1 pr-2">Статус</th>
                <th className="py-1 pr-2">Вход</th>
                <th className="py-1 pr-2">Цена входа</th>
                <th className="py-1 pr-2">Выход</th>
                <th className="py-1 pr-2">Цена выхода</th>
                <th className="py-1 pr-2">P&L</th>
                <th className="py-1">Причина выхода</th>
              </tr>
            </thead>
            <tbody>
              {trades.slice(0, visible).map((trade) => (
                <tr key={trade.tradeId} className="border-t border-zinc-100">
                  <td className="py-1 pr-2 text-zinc-800">
                    {symbolByKey.get(trade.tokenId) ?? trade.tokenId}
                  </td>
                  <td className="py-1 pr-2">{sandboxStrategyLabel(trade.strategyKey)}</td>
                  <td className="py-1 pr-2">{trade.status === 'open' ? 'Открыта' : 'Закрыта'}</td>
                  <td className="py-1 pr-2">{formatSandboxReportTimestamp(trade.entryAt)}</td>
                  <td className="py-1 pr-2 font-mono">{sandboxReportPrice(trade.entryPriceUsd)}</td>
                  <td className="py-1 pr-2">{formatSandboxReportTimestamp(trade.exitAt)}</td>
                  <td className="py-1 pr-2 font-mono">{sandboxReportPrice(trade.exitPriceUsd)}</td>
                  <td className={`py-1 pr-2 font-mono ${pnlTone(trade.realizedPnlUsd)}`}>
                    {formatUsd(trade.realizedPnlUsd)}
                  </td>
                  <td className="py-1">{trade.exitReasonCode ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {trades.length > visible ? (
            <div className="mt-3 flex justify-center">
              <Button
                variant="secondary"
                className="h-8 px-3 text-xs"
                onClick={() => setVisible((current) => current + 20)}
              >
                Ещё
              </Button>
            </div>
          ) : null}
        </div>
      )}
    </Card>
  );
}

function ReplayIntentJournal({
  intents,
  symbolByKey,
}: {
  intents: readonly SandboxReportIntent[];
  symbolByKey: ReadonlyMap<string, string>;
}) {
  const [visible, setVisible] = useState(20);

  return (
    <Card>
      <CardTitle>Журнал интентов</CardTitle>
      <p className="mt-1 text-xs text-zinc-500">
        Терминальные интенты прогона. Код причины объясняет решение стратегии или риска.
      </p>
      {intents.length === 0 ? (
        <p className="mt-3 text-sm text-zinc-600">Интентов нет.</p>
      ) : (
        <div className="mt-3 space-y-2">
          {intents.slice(0, visible).map((intent) => (
            <div
              key={intent.intentId}
              className="rounded-xl border border-zinc-200 px-3 py-2 text-xs text-zinc-600"
            >
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={sandboxIntentStatusTones[intent.status]}>
                  {sandboxIntentStatusLabels[intent.status]}
                </Badge>
                <Badge tone={intent.side === 'buy' ? 'success' : 'info'}>
                  {sandboxIntentSideLabels[intent.side]}
                </Badge>
                <span className="font-medium text-zinc-800">
                  {symbolByKey.get(intent.tokenId) ?? intent.tokenId}
                </span>
                <span>{sandboxStrategyLabel(intent.strategyKey)}</span>
                <span className="font-mono text-zinc-700">{formatUsd(intent.filledUsd)}</span>
                <span>Код: {intent.reasonCode}</span>
                <span>Стратегия: {intent.strategyReasonCode}</span>
              </div>
              <div className="mt-1 grid gap-x-4 gap-y-1 sm:grid-cols-3">
                <span>Решение: {formatSandboxReportTimestamp(intent.decisionTime)}</span>
                <span>Исполнение: {formatSandboxReportTimestamp(intent.fillTime)}</span>
                <span>Комиссия: {formatUsd(intent.feeUsd)}</span>
              </div>
              {intent.reasonText ? (
                <p className="mt-1 text-[11px] text-zinc-500">{intent.reasonText}</p>
              ) : null}
            </div>
          ))}
          {intents.length > visible ? (
            <div className="flex justify-center">
              <Button
                variant="secondary"
                className="h-8 px-3 text-xs"
                onClick={() => setVisible((current) => current + 20)}
              >
                Ещё
              </Button>
            </div>
          ) : null}
        </div>
      )}
    </Card>
  );
}

function ReplayCounterfactuals({
  counterfactuals,
  symbolByKey,
}: {
  counterfactuals: readonly SandboxReportCounterfactual[];
  symbolByKey: ReadonlyMap<string, string>;
}) {
  const [visible, setVisible] = useState(20);

  return (
    <Card>
      <CardTitle>Контрфактические наблюдения</CardTitle>
      <p className="mt-1 text-xs text-zinc-500">
        Ретроспектива (hindsight) и не использовалась в решениях прогона.
      </p>
      {counterfactuals.length === 0 ? (
        <p className="mt-3 text-sm text-zinc-600">Контрфактических наблюдений нет.</p>
      ) : (
        <div className="mt-3 space-y-2">
          {counterfactuals.slice(0, visible).map((counterfactual, index) => (
            <div
              key={`${counterfactual.tokenId}-${counterfactual.decisionTime}-${index}`}
              className="rounded-xl border border-zinc-200 px-3 py-2 text-xs text-zinc-600"
            >
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={sandboxReplayCounterfactualOutcomeTones[counterfactual.outcome]}>
                  {sandboxReplayCounterfactualOutcomeLabels[counterfactual.outcome]}
                </Badge>
                <span className="font-medium text-zinc-800">
                  {symbolByKey.get(counterfactual.tokenId) ?? counterfactual.tokenId}
                </span>
                <span>Код: {counterfactual.reasonCode}</span>
                {counterfactual.returnPct !== null ? (
                  <span className={`font-mono ${pnlTone(counterfactual.returnPct)}`}>
                    {formatPct(counterfactual.returnPct)}
                  </span>
                ) : null}
              </div>
              <div className="mt-1 grid gap-x-4 gap-y-1 sm:grid-cols-2">
                <span>Решение: {formatSandboxReportTimestamp(counterfactual.decisionTime)}</span>
                <span>
                  Вход: {formatSandboxReportTimestamp(counterfactual.entryAt)} · Выход:{' '}
                  {formatSandboxReportTimestamp(counterfactual.exitAt)}
                </span>
                <span>
                  Цена входа: {sandboxReportPrice(counterfactual.entryPriceUsd)} · выхода:{' '}
                  {sandboxReportPrice(counterfactual.exitPriceUsd)}
                </span>
              </div>
            </div>
          ))}
          {counterfactuals.length > visible ? (
            <div className="flex justify-center">
              <Button
                variant="secondary"
                className="h-8 px-3 text-xs"
                onClick={() => setVisible((current) => current + 20)}
              >
                Ещё
              </Button>
            </div>
          ) : null}
        </div>
      )}
    </Card>
  );
}

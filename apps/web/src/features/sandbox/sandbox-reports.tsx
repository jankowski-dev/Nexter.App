import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardTitle } from '@/components/ui/card';
import { StatCard } from '@/components/ui/stat-card';
import { LineChart } from '@/components/charts/line-chart';
import { EmptyState, ErrorState, LoadingRows } from '@/components/ui/states';
import { formatDateTime, formatUsd, pnlTone } from '@/lib/format';
import { downloadSandboxReportJson, downloadSandboxReportMarkdown } from './sandbox-api';
import { useSandboxReport, useSandboxRunDetail } from './sandbox-hooks';
import {
  sandboxIntentSideLabels,
  sandboxIntentStatusLabels,
  sandboxIntentStatusTones,
  sandboxStrategyLabel,
} from './sandbox-labels';
import {
  formatSandboxPercentPlain,
  formatSandboxReportTimestamp,
  sandboxEquityCurveSummary,
  sandboxReportDownloadError,
  sandboxReportError,
  sandboxReportPeriodLabel,
  sandboxReportPrice,
  sandboxReportSummaryCards,
  sandboxReportUnits,
} from './sandbox-report-helpers';
import { SandboxRunPicker } from './sandbox-run-picker';
import type { SandboxTabSharedProps } from './sandbox-tab-types';
import { useState } from 'react';
import type { SandboxReportResponse } from '@nexter/contracts';

/**
 * `Отчёты`: the deterministic `live-paper` report of the selected run.
 *
 * The JSON/Markdown artifacts are generated on demand by the API; the UI only
 * downloads them. A failed or stopped run still renders every available number,
 * and an integrity failure surfaces the typed Russian `SANDBOX_REPORT_NOT_READY`
 * message instead of a partial report.
 */
export function SandboxReports({
  runs,
  selectedRunId,
  onSelectRun,
  onChangeTab,
  selectionPending = false,
}: SandboxTabSharedProps) {
  const report = useSandboxReport(selectedRunId);
  // Read-only identity lookup; reports must not poll.
  const detail = useSandboxRunDetail(selectedRunId, false);
  const [pending, setPending] = useState<'json' | 'md' | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const symbolByToken = new Map(
    (detail.data?.tokens ?? []).map((token) => [token.tokenKey, token.symbol]),
  );

  async function download(format: 'json' | 'md'): Promise<void> {
    if (!selectedRunId) return;
    setPending(format);
    setDownloadError(null);
    try {
      if (format === 'json') await downloadSandboxReportJson(selectedRunId);
      else await downloadSandboxReportMarkdown(selectedRunId);
    } catch (error) {
      setDownloadError(sandboxReportDownloadError(error));
    } finally {
      setPending(null);
    }
  }

  if (selectedRunId === null) {
    if (selectionPending) return <LoadingRows rows={5} />;
    return (
      <EmptyState
        title="Нет выбранного запуска"
        description="Отчёт live-paper строится из сохранённой цепочки событий и состояния запуска. Сначала создайте и запустите его."
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

      {!report.isError ? (
        <div className="flex flex-wrap items-center gap-2">
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
            onClick={() => void download('md')}
          >
            {pending === 'md' ? 'Готовлю Markdown…' : 'Скачать Markdown'}
          </Button>
        </div>
      ) : null}

      {downloadError ? (
        <div
          role="alert"
          className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
        >
          {downloadError}
        </div>
      ) : null}

      {report.isPending ? <LoadingRows rows={6} /> : null}
      {report.isError ? (
        <ErrorState
          message={sandboxReportError(report.error)}
          onRetry={() => void report.refetch()}
        />
      ) : null}
      {report.data ? <ReportBody response={report.data} symbolByToken={symbolByToken} /> : null}
    </div>
  );
}

function ReportBody({
  response,
  symbolByToken,
}: {
  response: SandboxReportResponse;
  symbolByToken: ReadonlyMap<string, string>;
}) {
  const { report } = response;
  const cards = sandboxReportSummaryCards(report.metrics);
  const curve = sandboxEquityCurveSummary(report.equityCurve);
  const chartPoints = report.equityCurve.map((point) => ({
    label: formatDateTime(new Date(point.clockTime).toISOString()),
    value: Number(point.equityUsd),
  }));

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-lg font-semibold text-zinc-900">Отчёт запуска</h2>
              <Badge tone="info">{response.executionMode}</Badge>
              <Badge tone={report.reconciliationOk ? 'success' : 'danger'}>
                {report.reconciliationOk ? 'Сверка пройдена' : 'Сверка не пройдена'}
              </Badge>
            </div>
            <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-zinc-500">
              <span className="break-all">Запуск: {report.runId}</span>
              <span>Событий: {report.eventCount}</span>
              <span>Записей учёта: {report.ledgerEntries}</span>
              <span>Ожидающих интентов: {response.pendingIntents}</span>
              <span>
                configVersion: <code className="break-all">{report.configVersion}</code>
              </span>
              <span>
                dataSnapshotId: <code className="break-all">{report.dataSnapshotId}</code>
              </span>
              <span>
                settingsVersion: <code className="break-all">{report.settingsVersion}</code>
              </span>
            </div>
            <div className="mt-1 space-y-0.5 break-all font-mono text-[11px] text-zinc-500">
              <div>eventHash: {report.eventHash}</div>
              <div>reportHash: {report.reportHash}</div>
            </div>
            <div className="mt-1 text-xs text-zinc-500">{sandboxReportPeriodLabel(report)}</div>
            <div className="mt-1 text-[11px] text-zinc-400">
              Режим: {report.config.timeframe} · seed {report.seed} · версия {report.paperVersion}
            </div>
          </div>
        </div>

        {report.reconciliationChecks.length > 0 ? (
          <div className="mt-3 text-xs text-zinc-600">
            <span className="font-medium text-zinc-700">Проверки сверки: </span>
            {report.reconciliationChecks.join(' · ')}
          </div>
        ) : null}

        {response.notes.length > 0 ? (
          <ul className="mt-3 list-disc space-y-1 rounded-xl border border-zinc-200 bg-zinc-50 py-2 pl-8 pr-4 text-xs text-zinc-600">
            {response.notes.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
        ) : null}
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

      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardTitle>Кривая капитала</CardTitle>
          <div className="mt-2 grid grid-cols-2 gap-2 text-xs text-zinc-600">
            <span>Точек: {curve.points}</span>
            <span>Первый: {formatUsd(curve.firstEquityUsd)}</span>
            <span>Последний: {formatUsd(curve.lastEquityUsd)}</span>
            <span>
              Диапазон: {formatUsd(curve.minEquityUsd)} — {formatUsd(curve.maxEquityUsd)}
            </span>
          </div>
          {chartPoints.length === 0 ? (
            <p className="mt-3 text-sm text-zinc-600">Точек equity в отчёте нет.</p>
          ) : (
            <div className="mt-3">
              <LineChart points={chartPoints} height={200} />
            </div>
          )}
        </Card>

        <Card>
          <CardTitle>По стратегиям</CardTitle>
          <ReportMetricTable
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
          <div className="mt-4">
            <CardTitle>По токенам</CardTitle>
            <ReportMetricTable
              labelHeader="Токен"
              rows={report.metrics.perToken.map((row) => ({
                key: row.tokenId,
                label: symbolByToken.get(row.tokenId) ?? row.tokenId,
                trades: row.tradeCount,
                wins: row.wins,
                losses: row.losses,
                pnl: row.realizedPnlUsd,
                winRate: row.winRatePct,
              }))}
            />
          </div>
        </Card>
      </div>

      <Card>
        <CardTitle>Позиции отчёта</CardTitle>
        {report.positions.length === 0 ? (
          <p className="mt-3 text-sm text-zinc-600">Открытых позиций нет.</p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[720px] text-left text-xs">
              <thead className="text-zinc-500">
                <tr>
                  <th className="py-1 pr-2">Токен</th>
                  <th className="py-1 pr-2">Стратегия</th>
                  <th className="py-1 pr-2">Количество</th>
                  <th className="py-1 pr-2">Средняя цена</th>
                  <th className="py-1 pr-2">Рынок</th>
                  <th className="py-1 pr-2">Стоимость</th>
                  <th className="py-1 pr-2">Стоп</th>
                  <th className="py-1 pr-2">Тейк</th>
                  <th className="py-1">Открыта</th>
                </tr>
              </thead>
              <tbody>
                {report.positions.map((position) => (
                  <tr key={position.tokenId} className="border-t border-zinc-100">
                    <td className="py-1 pr-2 text-zinc-800">
                      {symbolByToken.get(position.tokenId) ?? position.tokenId}
                    </td>
                    <td className="py-1 pr-2">{sandboxStrategyLabel(position.strategyKey)}</td>
                    <td className="py-1 pr-2 font-mono">{sandboxReportUnits(position.amount)}</td>
                    <td className="py-1 pr-2 font-mono">
                      {sandboxReportPrice(position.avgCostUsd)}
                    </td>
                    <td className="py-1 pr-2 font-mono">
                      {sandboxReportPrice(position.marketPriceUsd)}
                    </td>
                    <td className="py-1 pr-2 font-mono">{formatUsd(position.marketValueUsd)}</td>
                    <td className="py-1 pr-2">
                      {position.stopLossPct ? formatSandboxPercentPlain(position.stopLossPct) : '—'}
                    </td>
                    <td className="py-1 pr-2">
                      {position.takeProfitPct
                        ? formatSandboxPercentPlain(position.takeProfitPct)
                        : '—'}
                    </td>
                    <td className="py-1">{formatSandboxReportTimestamp(position.openedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card>
        <CardTitle>Сделки отчёта</CardTitle>
        {report.trades.length === 0 ? (
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
                {report.trades.map((trade) => (
                  <tr key={trade.tradeId} className="border-t border-zinc-100">
                    <td className="py-1 pr-2 text-zinc-800">
                      {symbolByToken.get(trade.tokenId) ?? trade.tokenId}
                    </td>
                    <td className="py-1 pr-2">{sandboxStrategyLabel(trade.strategyKey)}</td>
                    <td className="py-1 pr-2">{trade.status === 'open' ? 'Открыта' : 'Закрыта'}</td>
                    <td className="py-1 pr-2">{formatSandboxReportTimestamp(trade.entryAt)}</td>
                    <td className="py-1 pr-2 font-mono">
                      {sandboxReportPrice(trade.entryPriceUsd)}
                    </td>
                    <td className="py-1 pr-2">{formatSandboxReportTimestamp(trade.exitAt)}</td>
                    <td className="py-1 pr-2 font-mono">
                      {sandboxReportPrice(trade.exitPriceUsd)}
                    </td>
                    <td className={`py-1 pr-2 font-mono ${pnlTone(trade.realizedPnlUsd)}`}>
                      {formatUsd(trade.realizedPnlUsd)}
                    </td>
                    <td className="py-1">{trade.exitReasonCode ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card>
        <CardTitle>Журнал интентов</CardTitle>
        <p className="mt-1 text-xs text-zinc-500">
          Только терминальные интенты. Ожидающие интенты исключены и доступны в «Журнале».
        </p>
        {report.intentJournal.length === 0 ? (
          <p className="mt-3 text-sm text-zinc-600">Терминальных интентов нет.</p>
        ) : (
          <div className="mt-3 space-y-2">
            {report.intentJournal.map((intent) => (
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
                    {symbolByToken.get(intent.tokenId) ?? intent.tokenId}
                  </span>
                  <span>{sandboxStrategyLabel(intent.strategyKey)}</span>
                  <span className="font-mono text-zinc-700">{formatUsd(intent.filledUsd)}</span>
                  <span>Код: {intent.reasonCode}</span>
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
          </div>
        )}
      </Card>
    </div>
  );
}

function ReportMetricTable({
  labelHeader = 'Название',
  rows,
}: {
  labelHeader?: string;
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

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardDescription, CardTitle } from '@/components/ui/card';
import { ErrorState, LoadingRows } from '@/components/ui/states';
import { Select } from '@/components/ui/select';
import { fetchBotTelemetry, fetchTradingBots } from '@/lib/api';
import { toRussianError } from '@/lib/error-messages';
import { formatDateTime, formatSignedUsd, formatUsd, pnlTone } from '@/lib/format';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import type { BotSummary, BotTelemetryResponse } from '@nexter/contracts';

const periodOptions = [
  { value: '1', label: '24 часа' },
  { value: '7', label: '7 дней' },
  { value: '30', label: '30 дней' },
  { value: '90', label: '90 дней' },
] as const;

function downloadJson(name: string, data: unknown) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function safeName(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9а-яё]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}

function SummaryTile({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="rounded-lg border border-zinc-200 bg-zinc-50/60 p-3">
      <div className="text-[11px] text-zinc-500">{label}</div>
      <div className={`mt-0.5 font-mono text-lg font-semibold ${tone ?? 'text-zinc-900'}`}>
        {value}
      </div>
    </div>
  );
}

export function AiJournalPanel() {
  const bots = useQuery({ queryKey: ['trading-bots'], queryFn: () => fetchTradingBots(false) });
  const [botId, setBotId] = useState('');
  const [days, setDays] = useState('7');
  const [report, setReport] = useState<BotTelemetryResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (botId || !bots.data?.data.length) return;
    setBotId(bots.data.data[0]?.id ?? '');
  }, [botId, bots.data]);

  const selectedBot = bots.data?.data.find((bot) => bot.id === botId) ?? null;

  async function buildReport() {
    if (!botId) return;
    setLoading(true);
    setError(null);
    try {
      const to = new Date();
      const from = new Date(to.getTime() - Number(days) * 24 * 60 * 60 * 1000);
      const data = await fetchBotTelemetry(botId, from.toISOString(), to.toISOString());
      setReport(data);
    } catch (err) {
      setError(toRussianError(err, 'Не удалось собрать телеметрию робота'));
      setReport(null);
    } finally {
      setLoading(false);
    }
  }

  function download() {
    if (!report || !selectedBot) return;
    const from = report.range.from.slice(0, 10);
    const to = report.range.to.slice(0, 10);
    downloadJson(`nexter-ai-${safeName(selectedBot.name)}-${from}-${to}.json`, report);
  }

  if (bots.isPending) return <LoadingRows rows={4} />;
  if (bots.isError) {
    return (
      <ErrorState
        message={toRussianError(bots.error, 'Не удалось загрузить роботов')}
        onRetry={() => void bots.refetch()}
      />
    );
  }

  const botList = bots.data?.data ?? [];

  return (
    <div className="space-y-4">
      <Card>
        <CardTitle>Журнал для ИИ</CardTitle>
        <CardDescription>
          Соберите телеметрию робота за период и скачайте JSON. Внутри — конфигурация стратегии,
          сделки с сигналами, события, эквити и движение котировок. Готовый файл можно передать
          ИИ-агенту для анализа параметров.
        </CardDescription>
        <div className="mt-4 grid gap-3 md:grid-cols-[minmax(0,1fr)_180px_auto] md:items-end">
          <label className="block text-sm text-zinc-600">
            Робот
            <Select
              className="mt-1"
              value={botId}
              onChange={(event) => {
                setBotId(event.target.value);
                setReport(null);
                setError(null);
              }}
              aria-label="Робот для телеметрии"
            >
              {botList.length === 0 ? <option value="">Нет роботов</option> : null}
              {botList.map((bot: BotSummary) => (
                <option key={bot.id} value={bot.id}>
                  {bot.name} · {bot.strategy.name}
                </option>
              ))}
            </Select>
          </label>
          <label className="block text-sm text-zinc-600">
            Период
            <Select
              className="mt-1"
              value={days}
              onChange={(event) => {
                setDays(event.target.value);
                setReport(null);
              }}
              aria-label="Период телеметрии"
            >
              {periodOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
          </label>
          <Button onClick={() => void buildReport()} disabled={!botId || loading}>
            {loading ? 'Собираю…' : 'Собрать отчёт'}
          </Button>
        </div>
        {error ? <p className="mt-3 text-sm text-red-700">{error}</p> : null}
      </Card>

      {!report ? (
        <Card>
          <CardTitle>Что попадёт в файл</CardTitle>
          <div className="mt-3 grid gap-2 text-sm text-zinc-600 sm:grid-cols-2">
            <p>• настройки робота и полное описание стратегии;</p>
            <p>• токены, позиции и последние сигналы по каждому токену;</p>
            <p>• все сделки за период с причиной, комиссией, проскальзыванием и снимком сигнала;</p>
            <p>• события робота: старт, стоп, покупки, продажи, ошибки, сброс;</p>
            <p>• кривая эквити и реализованный/нереализованный P&amp;L;</p>
            <p>• движение цен и 24ч-изменения по токенам робота.</p>
          </div>
        </Card>
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-sm text-zinc-600">
              {selectedBot?.name} · {formatDateTime(report.range.from)} —{' '}
              {formatDateTime(report.range.to)}
            </div>
            <Button variant="secondary" onClick={download}>
              Скачать JSON для ИИ
            </Button>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <SummaryTile
              label="Реализованный P&L"
              value={formatSignedUsd(report.summary.realizedPnlUsd)}
              tone={pnlTone(report.summary.realizedPnlUsd)}
            />
            <SummaryTile
              label="Сделки"
              value={`${report.summary.trades} · ${report.summary.buys} покупок / ${report.summary.sells} продаж`}
            />
            <SummaryTile
              label="Тейк-профиты / стопы"
              value={`${report.summary.takeProfits} / ${report.summary.stopLosses + report.summary.trailingStops}`}
            />
            <SummaryTile
              label="Комиссии / проскальзывание"
              value={`${formatUsd(report.summary.feesUsd)} / ${formatUsd(report.summary.slippageUsd)}`}
            />
            <SummaryTile
              label="Эквити на начало"
              value={report.summary.equityStartUsd ? formatUsd(report.summary.equityStartUsd) : '—'}
            />
            <SummaryTile
              label="Эквити на конец"
              value={report.summary.equityEndUsd ? formatUsd(report.summary.equityEndUsd) : '—'}
            />
            <SummaryTile
              label="События / сигналы"
              value={`${report.summary.events} / ${report.summary.signals}`}
            />
            <SummaryTile label="Точки котировок" value={String(report.summary.quotePoints)} />
          </div>

          <Card>
            <div className="flex flex-wrap items-center gap-2">
              <CardTitle>Состав отчёта</CardTitle>
              <Badge tone="info">schema v{report.schemaVersion}</Badge>
            </div>
            <div className="mt-3 grid gap-2 text-sm text-zinc-600 sm:grid-cols-2">
              <p>Сделки: {report.trades.length}</p>
              <p>События: {report.events.length}</p>
              <p>Точки эквити: {report.equity.length}</p>
              <p>
                Токены: {report.tokens.length} · позиции: {report.positions.length}
              </p>
            </div>
            <p className="mt-3 text-xs text-zinc-500">
              Файл содержит сырые данные без сокращений, кроме прореживания очень длинных рядов
              котировок и эквити. Он не содержит секретов, ключей и персональных данных.
            </p>
          </Card>
        </>
      )}
    </div>
  );
}

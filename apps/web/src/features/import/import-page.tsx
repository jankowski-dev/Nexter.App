import { Button } from '@/components/ui/button';
import { Card, CardDescription, CardHeader, CardTitle, CardValue } from '@/components/ui/card';
import { toRussianError } from '@/lib/error-messages';
import {
  commitImport,
  fetchDashboardSummary,
  fetchImport,
  fetchImports,
  previewNotionImport,
  rollbackImport,
  type ImportResponse,
} from '@/lib/api';
import type { ImportSummary } from '@nexter/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useState, type ChangeEvent } from 'react';

type FileKey = 'source' | 'orders' | 'transactions';

const FILE_LABELS: Record<FileKey, string> = {
  source: 'Source.json',
  orders: 'Orders.json',
  transactions: 'Transactions.json',
};

const FILE_HINTS: Record<FileKey, string> = {
  source: 'Активы, цены и CoinGecko ID',
  orders: 'Покупки и продажи',
  transactions: 'Пополнения и выводы USDT',
};

const STATUS_LABELS: Record<string, string> = {
  preview: 'Предпросмотр',
  committed: 'Импортирован',
  rolled_back: 'Откатан',
  failed: 'Ошибка',
};

const STATUS_STYLES: Record<string, string> = {
  preview: 'border-amber-800/60 bg-amber-950/30 text-amber-200',
  committed: 'border-emerald-800/60 bg-emerald-950/30 text-emerald-200',
  rolled_back: 'border-zinc-700 bg-zinc-800/60 text-zinc-300',
  failed: 'border-red-800/60 bg-red-950/30 text-red-200',
};

const usdFormatter = new Intl.NumberFormat('ru-RU', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const countFormatter = new Intl.NumberFormat('ru-RU');

function formatUsd(value: string): string {
  const number = Number(value);
  return Number.isFinite(number) ? usdFormatter.format(number) : '—';
}

function formatSignedUsd(value: string): string {
  const number = Number(value);

  if (!Number.isFinite(number)) return '—';
  if (number === 0) return formatUsd('0');

  return `${number > 0 ? '+' : ''}${formatUsd(value)}`;
}

function formatSignedCount(value: number): string {
  if (value === 0) return '0';
  return `${value > 0 ? '+' : ''}${countFormatter.format(value)}`;
}

function formatDate(value: string | null): string {
  if (!value) return '—';

  return new Intl.DateTimeFormat('ru-RU', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date(value));
}

function valueTone(value: string | number): string {
  const number = typeof value === 'number' ? value : Number(value);

  if (!Number.isFinite(number) || number === 0) return 'text-zinc-400';
  return number > 0 ? 'text-emerald-300' : 'text-red-300';
}

function StatusBadge({ status }: { status: string }) {
  return (
    <span
      className={`inline-flex rounded-full border px-2.5 py-0.5 text-xs font-medium ${
        STATUS_STYLES[status] ?? STATUS_STYLES.failed
      }`}
    >
      {STATUS_LABELS[status] ?? status}
    </span>
  );
}

function Metric({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <Card>
      <CardTitle>{label}</CardTitle>
      <CardValue className="mt-1 text-xl">{value}</CardValue>
      {hint ? <CardDescription>{hint}</CardDescription> : null}
    </Card>
  );
}

async function readJsonArrayText(file: File | null): Promise<string> {
  if (!file) throw new Error('Выберите все три файла');

  const text = (await file.text()).replace(/^\uFEFF/, '').trim();

  if (!text.startsWith('[') || !text.endsWith(']')) {
    throw new Error(`Файл ${file.name} должен содержать JSON-массив`);
  }

  return text;
}

function ControlCard({ summary }: { summary: ImportSummary }) {
  const rows: Array<{
    label: string;
    baseline: string | number;
    expected: string | number;
    delta: string | number;
    usd?: boolean;
  }> = [
    {
      label: 'Ордера',
      baseline: summary.control.baseline.orders,
      expected: summary.control.expected.orders,
      delta: summary.control.deltas.orders,
    },
    {
      label: 'Закрытые',
      baseline: summary.control.baseline.closedOrders,
      expected: summary.control.expected.closedOrders,
      delta: summary.control.deltas.closedOrders,
    },
    {
      label: 'Активные',
      baseline: summary.control.baseline.activeOrders,
      expected: summary.control.expected.activeOrders,
      delta: summary.control.deltas.activeOrders,
    },
    {
      label: 'Покупки',
      baseline: summary.control.baseline.buyUsd,
      expected: summary.control.expected.buyUsd,
      delta: summary.control.deltas.buyUsd,
      usd: true,
    },
    {
      label: 'Продажи',
      baseline: summary.control.baseline.sellUsd,
      expected: summary.control.expected.sellUsd,
      delta: summary.control.deltas.sellUsd,
      usd: true,
    },
    {
      label: 'Пополнения',
      baseline: summary.control.baseline.depositsUsd,
      expected: summary.control.expected.depositsUsd,
      delta: summary.control.deltas.depositsUsd,
      usd: true,
    },
    {
      label: 'Выводы',
      baseline: summary.control.baseline.withdrawalsUsd,
      expected: summary.control.expected.withdrawalsUsd,
      delta: summary.control.deltas.withdrawalsUsd,
      usd: true,
    },
    {
      label: 'Реализованный P&L',
      baseline: summary.control.baseline.realizedPnlUsd,
      expected: summary.control.expected.realizedPnlUsd,
      delta: summary.control.deltas.realizedPnlUsd,
      usd: true,
    },
    {
      label: 'Кэш',
      baseline: summary.control.baseline.cashUsd,
      expected: summary.control.expected.cashUsd,
      delta: summary.control.deltas.cashUsd,
      usd: true,
    },
    {
      label: 'Активная себестоимость',
      baseline: summary.control.baseline.activeCostUsd,
      expected: summary.control.expected.activeCostUsd,
      delta: summary.control.deltas.activeCostUsd,
      usd: true,
    },
  ];
  const display = (value: string | number, usd?: boolean) =>
    usd ? formatUsd(String(value)) : countFormatter.format(Number(value));

  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>Сверка с контролем 429 ордеров</CardTitle>
          <CardDescription>
            Базовый снимок Phase 3 восстанавливается из текущего экспорта с учётом известных
            изменений.
          </CardDescription>
        </div>
        {summary.control.applicable ? (
          <span
            className={`inline-flex shrink-0 rounded-full border px-2.5 py-0.5 text-xs font-medium ${
              summary.control.matches
                ? 'border-emerald-800/60 bg-emerald-950/30 text-emerald-200'
                : 'border-red-800/60 bg-red-950/30 text-red-200'
            }`}
          >
            {summary.control.matches ? 'Сходится' : 'Расхождение'}
          </span>
        ) : (
          <span className="inline-flex shrink-0 rounded-full border border-zinc-700 bg-zinc-800/60 px-2.5 py-0.5 text-xs font-medium text-zinc-300">
            Не применимо
          </span>
        )}
      </CardHeader>

      {summary.control.applicable ? (
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-800 text-left text-xs text-zinc-500">
                  <th className="py-2 pr-4 font-medium">Показатель</th>
                  <th className="py-2 pr-4 text-right font-medium">Снимок 429</th>
                  <th className="py-2 pr-4 text-right font-medium">Эталон</th>
                  <th className="py-2 text-right font-medium">Δ</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.label} className="border-b border-zinc-800/60 last:border-0">
                    <td className="py-2 pr-4 text-zinc-400">{row.label}</td>
                    <td className="py-2 pr-4 text-right font-mono tabular-nums text-zinc-200">
                      {display(row.baseline, row.usd)}
                    </td>
                    <td className="py-2 pr-4 text-right font-mono tabular-nums text-zinc-400">
                      {display(row.expected, row.usd)}
                    </td>
                    <td
                      className={`py-2 text-right font-mono tabular-nums ${valueTone(row.delta)}`}
                    >
                      {row.usd
                        ? formatSignedUsd(String(row.delta))
                        : formatSignedCount(Number(row.delta))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-4 rounded-lg border border-zinc-800 bg-zinc-950/50 p-3 text-xs text-zinc-400">
            <div className="font-medium text-zinc-300">Известные изменения после снимка</div>
            <div className="mt-1">
              Новые ордера: {summary.control.adjustments.addedOrderIds.join(', ') || '—'}. Закрыты
              после снимка:{' '}
              {summary.control.adjustments.closedAfterSnapshotOrderIds.join(', ') || '—'}.
            </div>
          </div>
        </>
      ) : (
        <p className="text-sm text-zinc-400">
          В экспорте нет ордеров 465, 466, 450 и 463, поэтому сверка с базовым снимком 429 ордеров
          не выполняется. Итоги текущего экспорта показаны выше.
        </p>
      )}
    </Card>
  );
}

function ValuationCard({ summary }: { summary: ImportSummary }) {
  const valuation = summary.valuation;

  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>Текущая оценка по ценам Source</CardTitle>
          <CardDescription>
            Используются текущие значения `Курс [1]`. Контроль Phase 3 считал оценку на дату аудита,
            поэтому стоимость позиций и связанный P&L не входят в допуск ±$0.01.
          </CardDescription>
        </div>
      </CardHeader>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Metric label="Активная себестоимость" value={formatUsd(valuation.activeCostUsd)} />
        <Metric label="Стоимость позиций" value={formatUsd(valuation.activeValueUsd)} />
        <Metric label="Нереализованный P&L" value={formatUsd(valuation.unrealizedPnlUsd)} />
        <Metric label="Капитал" value={formatUsd(valuation.equityUsd)} />
        <Metric label="Кэш" value={formatUsd(valuation.cashUsd)} />
        <Metric label="Реализованный P&L" value={formatUsd(valuation.realizedPnlUsd)} />
        <Metric label="Итого P&L" value={formatUsd(valuation.totalPnlUsd)} />
        <Metric
          label="Без цен"
          value={countFormatter.format(valuation.missingPrices.length)}
          hint={valuation.missingPrices.join(', ') || 'Все позиции оценены'}
        />
      </div>

      <div className="mt-4 rounded-lg border border-zinc-800 bg-zinc-950/50 p-3 text-xs text-zinc-400">
        Для сравнения, snapshot Phase 3: позиции{' '}
        {formatUsd(valuation.controlSnapshot.activeValueUsd)}, капитал{' '}
        {formatUsd(valuation.controlSnapshot.equityUsd)}, нереализованный P&L{' '}
        {formatUsd(valuation.controlSnapshot.unrealizedPnlUsd)}, итого P&L{' '}
        {formatUsd(valuation.controlSnapshot.totalPnlUsd)}. Разница объясняется изменением цен
        Source после аудита и четырьмя известными изменениями ордеров; транзакционные суммы и
        активная себестоимость сверены выше.
      </div>
    </Card>
  );
}

function TotalsCard({ summary }: { summary: ImportSummary }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <Metric
        label="Ордера"
        value={countFormatter.format(summary.counts.orders)}
        hint={`${countFormatter.format(summary.counts.closedOrders)} закрытых · ${countFormatter.format(
          summary.counts.activeOrders,
        )} активных`}
      />
      <Metric
        label="Покупки / продажи"
        value={formatUsd(summary.totals.buyUsd)}
        hint={`Продажи: ${formatUsd(summary.totals.sellUsd)}`}
      />
      <Metric
        label="Пополнения / выводы"
        value={formatUsd(summary.totals.depositsUsd)}
        hint={`Выводы: ${formatUsd(summary.totals.withdrawalsUsd)}`}
      />
      <Metric
        label="Кэш после импорта"
        value={formatUsd(summary.totals.cashUsd)}
        hint="USDT как денежный эквивалент, $1"
      />
      <Metric
        label="Реализованный P&L"
        value={formatUsd(summary.totals.realizedPnlUsd)}
        hint="По закрытым ордерам Notion"
      />
      <Metric
        label="Транзакции"
        value={countFormatter.format(summary.counts.transactions)}
        hint={`${countFormatter.format(summary.counts.newTransactions)} новых · ${countFormatter.format(
          summary.counts.skippedTransactions,
        )} уже было`}
      />
      <Metric
        label="Новые сделки"
        value={`${countFormatter.format(summary.counts.newOrders)} / ${countFormatter.format(
          summary.counts.updatedOrders,
        )}`}
        hint="Новые / обновлённые ордера"
      />
      <Metric
        label="Активы"
        value={countFormatter.format(summary.counts.sourceAssets)}
        hint={`${countFormatter.format(summary.counts.newAssets)} новых · ${countFormatter.format(
          summary.counts.reusedAssets,
        )} переиспользовано`}
      />
    </div>
  );
}

function DashboardPreview() {
  const dashboard = useQuery({
    queryKey: ['dashboard-summary'],
    queryFn: fetchDashboardSummary,
  });

  if (dashboard.isPending) {
    return (
      <Card>
        <CardTitle>Результат в учёте</CardTitle>
        <CardDescription>Загружаю итоги…</CardDescription>
      </Card>
    );
  }

  if (dashboard.isError || !dashboard.data) {
    return (
      <Card>
        <CardTitle>Результат в учёте</CardTitle>
        <CardDescription>Не удалось загрузить итоги. Обновите страницу.</CardDescription>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>Результат в учёте</CardTitle>
          <CardDescription>
            Итоги рассчитаны по проводкам и лотам. Полный дашборд появится в следующей фазе.
          </CardDescription>
        </div>
        <Link
          to="/dashboard"
          className="shrink-0 text-sm font-medium text-emerald-400 hover:text-emerald-300"
        >
          Дашборд →
        </Link>
      </CardHeader>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Metric label="Кэш" value={formatUsd(dashboard.data.cashUsd)} />
        <Metric label="Позиции" value={formatUsd(dashboard.data.positionsValueUsd)} />
        <Metric label="Капитал" value={formatUsd(dashboard.data.equityUsd)} />
        <Metric label="Чистые пополнения" value={formatUsd(dashboard.data.netDepositsUsd)} />
        <Metric label="Реализованный P&L" value={formatUsd(dashboard.data.realizedPnlUsd)} />
        <Metric label="Нереализованный P&L" value={formatUsd(dashboard.data.unrealizedPnlUsd)} />
        <Metric label="Итого P&L" value={formatUsd(dashboard.data.totalPnlUsd)} />
        <Metric
          label="Без цен"
          value={countFormatter.format(dashboard.data.missingPrices.length)}
          hint={dashboard.data.missingPrices.join(', ') || 'Все позиции оценены'}
        />
      </div>
    </Card>
  );
}

export function ImportPage() {
  const [files, setFiles] = useState<Record<FileKey, File | null>>({
    source: null,
    orders: null,
    transactions: null,
  });
  const [preview, setPreview] = useState<ImportResponse | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const importsQuery = useQuery({
    queryKey: ['imports'],
    queryFn: fetchImports,
  });

  const previewMutation = useMutation({
    mutationFn: previewNotionImport,
    onSuccess: (data) => {
      setPreview(data);
      setNotice('Предпросмотр готов. Проверьте итоги и подтвердите импорт.');
      setLocalError(null);
      void queryClient.invalidateQueries({ queryKey: ['imports'] });
    },
    onError: (error) => {
      setPreview(null);
      setLocalError(toRussianError(error, 'Не удалось выполнить предпросмотр'));
    },
  });

  const commitMutation = useMutation({
    mutationFn: commitImport,
    onSuccess: (data) => {
      setPreview(data);
      setNotice('Импорт применён к учёту.');
      setLocalError(null);
      void queryClient.invalidateQueries({ queryKey: ['imports'] });
      void queryClient.invalidateQueries({ queryKey: ['dashboard-summary'] });
    },
    onError: (error) => {
      setLocalError(toRussianError(error, 'Не удалось применить импорт'));
    },
  });

  const rollbackMutation = useMutation({
    mutationFn: rollbackImport,
    onSuccess: (data) => {
      setPreview(data);
      setNotice('Импорт откатан. Проводки, лоты и цены импорта удалены.');
      setLocalError(null);
      void queryClient.invalidateQueries({ queryKey: ['imports'] });
      void queryClient.invalidateQueries({ queryKey: ['dashboard-summary'] });
    },
    onError: (error) => {
      setLocalError(toRussianError(error, 'Не удалось откатить импорт'));
    },
  });

  const loadMutation = useMutation({
    mutationFn: fetchImport,
    onSuccess: (data) => {
      setPreview(data);
      setNotice(null);
      setLocalError(null);
    },
    onError: (error) => {
      setLocalError(toRussianError(error, 'Не удалось открыть импорт'));
    },
  });

  const busy =
    previewMutation.isPending ||
    commitMutation.isPending ||
    rollbackMutation.isPending ||
    loadMutation.isPending;

  const canPreview = Boolean(files.source && files.orders && files.transactions);
  const summary = preview?.import.summary;
  const rowCounts =
    preview?.rows?.reduce<Record<string, number>>((counts, row) => {
      counts[row.status] = (counts[row.status] ?? 0) + 1;
      return counts;
    }, {}) ?? {};

  function handleFile(key: FileKey) {
    return (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0] ?? null;
      setFiles((current) => ({ ...current, [key]: file }));
      setPreview(null);
      setLocalError(null);
      setNotice(null);
    };
  }

  async function handlePreview() {
    setPreview(null);
    setLocalError(null);
    setNotice(null);

    try {
      const [source, orders, transactions] = await Promise.all([
        readJsonArrayText(files.source),
        readJsonArrayText(files.orders),
        readJsonArrayText(files.transactions),
      ]);

      previewMutation.mutate({
        fileName: `notion-export-${new Date().toISOString().slice(0, 10)}.json`,
        source,
        orders,
        transactions,
      });
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : 'Не удалось прочитать файлы');
    }
  }

  function handleCommit() {
    if (!preview) return;

    if (
      !window.confirm(
        'Применить импорт к учёту? Будут созданы проводки, лоты и цены. Действие можно откатить, пока нет более поздних операций.',
      )
    ) {
      return;
    }

    commitMutation.mutate(preview.import.id);
  }

  function handleRollback() {
    if (!preview) return;

    if (
      !window.confirm(
        'Откатить этот импорт? Все созданные им проводки, лоты, группы и цены будут удалены. Это возможно только для последнего импорта без более поздних операций.',
      )
    ) {
      return;
    }

    rollbackMutation.mutate(preview.import.id);
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Импорт из Notion</h1>
          <p className="mt-1 max-w-3xl text-sm text-zinc-400">
            Загрузите три JSON-файла из Notion: Source, Orders и Transactions. Сначала выполняется
            предпросмотр с восстановлением контрольных сумм; данные попадут в учёт только после
            подтверждения.
          </p>
        </div>
        <Link
          to="/dashboard"
          className="shrink-0 text-sm font-medium text-emerald-400 hover:text-emerald-300"
        >
          Дашборд →
        </Link>
      </div>

      <Card>
        <CardHeader>
          <div>
            <CardTitle>Файлы экспорта</CardTitle>
            <CardDescription>
              Экспорт не сохраняется в репозитории. Строки хранятся в staging-таблицах импорта;
              audit log получает только сводку.
            </CardDescription>
          </div>
        </CardHeader>

        <div className="grid gap-4 md:grid-cols-3">
          {(Object.keys(FILE_LABELS) as FileKey[]).map((key) => (
            <label key={key} className="block">
              <span className="mb-1 block text-xs font-medium text-zinc-400">
                {FILE_LABELS[key]}
              </span>
              <input
                type="file"
                accept="application/json,.json"
                onChange={handleFile(key)}
                className="block w-full cursor-pointer rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-300 outline-none file:mr-3 file:rounded file:border-0 file:bg-zinc-800 file:px-3 file:py-1 file:text-sm file:text-zinc-100 hover:border-zinc-600 focus:border-emerald-500"
              />
              <span className="mt-1 block truncate text-xs text-zinc-500">
                {files[key]?.name ?? FILE_HINTS[key]}
              </span>
            </label>
          ))}
        </div>

        <div className="mt-5 flex flex-wrap items-center gap-3">
          <Button onClick={() => void handlePreview()} disabled={!canPreview || busy}>
            {previewMutation.isPending ? 'Читаю файлы…' : 'Предпросмотр'}
          </Button>
          {preview?.import.status === 'preview' ? (
            <Button
              variant="secondary"
              onClick={handleCommit}
              disabled={busy || summary?.errors.length !== 0}
            >
              {commitMutation.isPending ? 'Применяю…' : 'Подтвердить импорт'}
            </Button>
          ) : null}
          {preview?.import.status === 'committed' ? (
            <Button variant="secondary" onClick={handleRollback} disabled={busy}>
              {rollbackMutation.isPending ? 'Откатываю…' : 'Откатить импорт'}
            </Button>
          ) : null}
          {preview ? (
            <span className="text-xs text-zinc-500">
              {preview.import.fileName ?? 'без имени'} · {formatDate(preview.import.createdAt)}
            </span>
          ) : null}
        </div>
      </Card>

      {localError ? (
        <div className="rounded-lg border border-red-900/60 bg-red-950/30 p-3 text-sm text-red-200">
          {localError}
        </div>
      ) : null}

      {notice ? (
        <div className="rounded-lg border border-emerald-900/60 bg-emerald-950/30 p-3 text-sm text-emerald-200">
          {notice}
        </div>
      ) : null}

      {summary ? (
        <>
          <TotalsCard summary={summary} />

          {summary.errors.length > 0 ? (
            <Card className="border-red-900/60 bg-red-950/20">
              <CardTitle className="text-red-200">Ошибки импорта</CardTitle>
              <CardDescription>
                Импорт нельзя подтвердить, пока ошибки не устранены.
              </CardDescription>
              <ul className="mt-3 space-y-1 text-sm text-red-200">
                {summary.errors.map((error) => (
                  <li key={error}>• {error}</li>
                ))}
              </ul>
            </Card>
          ) : null}

          {summary.warnings.length > 0 ? (
            <Card className="border-amber-900/60 bg-amber-950/20">
              <CardTitle className="text-amber-200">Предупреждения</CardTitle>
              <ul className="mt-3 space-y-1 text-sm text-amber-100/90">
                {summary.warnings.map((warning) => (
                  <li key={warning}>• {warning}</li>
                ))}
              </ul>
            </Card>
          ) : null}

          <ControlCard summary={summary} />
          <ValuationCard summary={summary} />

          <Card>
            <CardHeader>
              <div>
                <CardTitle>Строки импорта</CardTitle>
                <CardDescription>
                  {preview?.rows ? `${countFormatter.format(preview.rows.length)} строк` : '—'} ·{' '}
                  {Object.entries(rowCounts)
                    .map(([status, count]) => `${status}: ${count}`)
                    .join(' · ') || 'нет данных'}
                </CardDescription>
              </div>
              <StatusBadge status={preview?.import.status ?? 'preview'} />
            </CardHeader>
            <div className="text-xs text-zinc-500">
              Source: {countFormatter.format(summary.counts.sourceAssets)} · Orders:{' '}
              {countFormatter.format(summary.counts.orders)} · Transactions:{' '}
              {countFormatter.format(summary.counts.transactions)}
            </div>
          </Card>

          {preview?.import.status === 'committed' ? <DashboardPreview /> : null}
        </>
      ) : null}

      <Card>
        <CardHeader>
          <div>
            <CardTitle>История импортов</CardTitle>
            <CardDescription>
              Импорт можно повторить: уже созданные строки будут пропущены.
            </CardDescription>
          </div>
          <Button
            variant="ghost"
            className="h-8 px-3 text-xs"
            onClick={() => void importsQuery.refetch()}
            disabled={importsQuery.isFetching}
          >
            Обновить
          </Button>
        </CardHeader>

        {importsQuery.isPending ? (
          <p className="text-sm text-zinc-400">Загружаю историю…</p>
        ) : importsQuery.isError ? (
          <p className="text-sm text-red-300">Не удалось загрузить историю импортов.</p>
        ) : importsQuery.data.imports.length === 0 ? (
          <p className="text-sm text-zinc-400">Импортов пока нет.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-800 text-left text-xs text-zinc-500">
                  <th className="py-2 pr-4 font-medium">Дата</th>
                  <th className="py-2 pr-4 font-medium">Файл</th>
                  <th className="py-2 pr-4 font-medium">Статус</th>
                  <th className="py-2 pr-4 text-right font-medium">Ордера</th>
                  <th className="py-2 pr-4 text-right font-medium">Покупки</th>
                  <th className="py-2 pr-4 text-right font-medium">Продажи</th>
                  <th className="py-2 text-right font-medium" />
                </tr>
              </thead>
              <tbody>
                {importsQuery.data.imports.map((item) => (
                  <tr key={item.id} className="border-b border-zinc-800/60 last:border-0">
                    <td className="py-2 pr-4 text-zinc-400">{formatDate(item.createdAt)}</td>
                    <td className="max-w-[220px] truncate py-2 pr-4 text-zinc-300">
                      {item.fileName ?? '—'}
                    </td>
                    <td className="py-2 pr-4">
                      <StatusBadge status={item.status} />
                    </td>
                    <td className="py-2 pr-4 text-right font-mono tabular-nums text-zinc-300">
                      {countFormatter.format(item.summary.counts.orders)}
                    </td>
                    <td className="py-2 pr-4 text-right font-mono tabular-nums text-zinc-300">
                      {formatUsd(item.summary.totals.buyUsd)}
                    </td>
                    <td className="py-2 pr-4 text-right font-mono tabular-nums text-zinc-300">
                      {formatUsd(item.summary.totals.sellUsd)}
                    </td>
                    <td className="py-2 text-right">
                      <Button
                        variant="ghost"
                        className="h-8 px-3 text-xs"
                        onClick={() => loadMutation.mutate(item.id)}
                        disabled={busy}
                      >
                        Открыть
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

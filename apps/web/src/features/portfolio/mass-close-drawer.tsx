import { Button } from '@/components/ui/button';
import { Card, CardDescription, CardTitle } from '@/components/ui/card';
import { Drawer } from '@/components/ui/drawer';
import { formatCount, formatSignedUsd, formatUsd, pluralizeRu, pnlTone } from '@/lib/format';
import { Decimal } from 'decimal.js';
import type { TradeGroupSummary } from '@nexter/contracts';

function Metric({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: string;
}) {
  return (
    <div className="rounded-lg border border-zinc-200 p-3">
      <div className="text-xs text-zinc-500">{label}</div>
      <div
        className={`mt-1 font-mono text-lg font-semibold tabular-nums ${tone ?? 'text-zinc-900'}`}
      >
        {value}
      </div>
      {hint ? <div className="mt-1 text-xs text-zinc-500">{hint}</div> : null}
    </div>
  );
}

function sum(values: Array<string | null>): { value: Decimal; unknown: boolean } {
  let total = new Decimal(0);
  let unknown = false;

  for (const value of values) {
    if (value === null) {
      unknown = true;
      continue;
    }
    total = total.plus(value);
  }

  return { value: total, unknown };
}

export function MassCloseDrawer({
  open,
  onClose,
  groups,
  onCloseTrades,
}: {
  open: boolean;
  onClose: () => void;
  groups: TradeGroupSummary[];
  onCloseTrades?: (groups: TradeGroupSummary[]) => void;
}) {
  const invested = sum(groups.map((group) => group.buyUsd));
  const pnl = sum(groups.map((group) => group.totalPnlUsd));
  const gas = sum(groups.map((group) => group.gasUsd));
  const currentValue = sum(
    groups.map((group) =>
      group.unrealizedPnlUsd === null
        ? null
        : new Decimal(group.remainingCostBasisUsd).plus(group.unrealizedPnlUsd).toFixed(8),
    ),
  );
  const assets = new Map<
    string,
    {
      assetId: string;
      symbol: string;
      chainCode: string;
      count: number;
      invested: Decimal;
      pnl: Decimal;
      pnlUnknown: boolean;
    }
  >();

  for (const group of groups) {
    const existing = assets.get(group.asset.id);
    const entry = existing ?? {
      assetId: group.asset.id,
      symbol: group.asset.symbol,
      chainCode: group.asset.chainCode,
      count: 0,
      invested: new Decimal(0),
      pnl: new Decimal(0),
      pnlUnknown: false,
    };
    entry.count += 1;
    entry.invested = entry.invested.plus(group.buyUsd);
    if (group.totalPnlUsd === null) entry.pnlUnknown = true;
    else entry.pnl = entry.pnl.plus(group.totalPnlUsd);
    assets.set(group.asset.id, entry);
  }

  const assetRows = [...assets.values()].sort((a, b) => b.invested.comparedTo(a.invested));
  const canClose = groups.some((group) => group.status !== 'closed');

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title="Массовое закрытие"
      description={`${formatCount(groups.length)} ${pluralizeRu(
        groups.length,
        'сделка',
        'сделки',
        'сделок',
      )} · ${formatCount(assetRows.length)} ${pluralizeRu(
        assetRows.length,
        'токен',
        'токена',
        'токенов',
      )}`}
      wide
      footer={
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Отмена
          </Button>
          <Button
            variant="danger"
            disabled={!canClose || !onCloseTrades}
            onClick={() => {
              if (!onCloseTrades) return;
              onClose();
              onCloseTrades(groups);
            }}
          >
            Выйти из сделок
          </Button>
        </div>
      }
    >
      <div className="space-y-5">
        <div className="grid gap-3 sm:grid-cols-2">
          <Metric label="Вложено" value={formatUsd(invested.value.toFixed(8))} />
          <Metric
            label="Текущая стоимость"
            value={currentValue.unknown ? '—' : formatUsd(currentValue.value.toFixed(8))}
            hint={currentValue.unknown ? 'Есть позиции без цены' : undefined}
          />
          <Metric
            label="Итоговый P&L"
            value={
              pnl.unknown
                ? `${formatSignedUsd(pnl.value.toFixed(8))} + н/д`
                : formatSignedUsd(pnl.value.toFixed(8))
            }
            tone={pnlTone(pnl.value.toFixed(8))}
          />
          <Metric label="Газ" value={formatUsd(gas.value.toFixed(8))} hint="Подтверждённые свопы" />
        </div>

        <Card>
          <CardTitle>По токенам</CardTitle>
          <CardDescription>
            Сумма прибыли по всем сделкам каждого токена и общий результат.
          </CardDescription>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-200 text-left text-xs text-zinc-500">
                  <th className="py-2 pr-3 font-medium">Токен</th>
                  <th className="py-2 pr-3 text-right font-medium">Сделок</th>
                  <th className="py-2 pr-3 text-right font-medium">Вложено</th>
                  <th className="py-2 pr-3 text-right font-medium">P&L</th>
                  <th className="py-2 text-right font-medium">Доходность</th>
                </tr>
              </thead>
              <tbody>
                {assetRows.map((row) => (
                  <tr key={row.assetId} className="border-b border-zinc-100 last:border-0">
                    <td className="py-2 pr-3">
                      <div className="font-medium text-zinc-800">{row.symbol}</div>
                      <div className="text-xs text-zinc-500">{row.chainCode}</div>
                    </td>
                    <td className="py-2 pr-3 text-right font-mono tabular-nums text-zinc-600">
                      {row.count}
                    </td>
                    <td className="py-2 pr-3 text-right font-mono tabular-nums text-zinc-700">
                      {formatUsd(row.invested.toFixed(8))}
                    </td>
                    <td
                      className={`py-2 pr-3 text-right font-mono tabular-nums ${pnlTone(
                        row.pnl.toFixed(8),
                      )}`}
                    >
                      {row.pnlUnknown
                        ? `${formatSignedUsd(row.pnl.toFixed(8))} + н/д`
                        : formatSignedUsd(row.pnl.toFixed(8))}
                    </td>
                    <td className="py-2 text-right font-mono tabular-nums text-zinc-600">
                      {row.invested.gt(0)
                        ? `${row.pnl.div(row.invested).mul(100).toFixed(2)}%`
                        : '—'}
                    </td>
                  </tr>
                ))}
                <tr className="bg-zinc-50 font-medium">
                  <td className="py-2 pr-3 text-zinc-800">Итого</td>
                  <td className="py-2 pr-3 text-right font-mono tabular-nums text-zinc-700">
                    {groups.length}
                  </td>
                  <td className="py-2 pr-3 text-right font-mono tabular-nums text-zinc-800">
                    {formatUsd(invested.value.toFixed(8))}
                  </td>
                  <td
                    className={`py-2 pr-3 text-right font-mono tabular-nums ${pnlTone(
                      pnl.value.toFixed(8),
                    )}`}
                  >
                    {pnl.unknown
                      ? `${formatSignedUsd(pnl.value.toFixed(8))} + н/д`
                      : formatSignedUsd(pnl.value.toFixed(8))}
                  </td>
                  <td className="py-2 text-right font-mono tabular-nums text-zinc-600">
                    {invested.value.gt(0)
                      ? `${pnl.value.div(invested.value).mul(100).toFixed(2)}%`
                      : '—'}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </Card>

        {assetRows.length > 1 ? (
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
            Будет {assetRows.length} отдельных swap-ордеров и подписей — по одной на токен.
            Approval-транзакции, если нужны, добавят ещё подписи.
          </div>
        ) : null}
        {!canClose ? (
          <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-3 text-sm text-zinc-600">
            Все выбранные сделки уже закрыты.
          </div>
        ) : null}
      </div>
    </Drawer>
  );
}

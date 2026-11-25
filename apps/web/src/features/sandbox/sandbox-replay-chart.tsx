import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardDescription, CardTitle } from '@/components/ui/card';
import { Drawer } from '@/components/ui/drawer';
import { Select } from '@/components/ui/select';
import { ErrorState, LoadingRows } from '@/components/ui/states';
import { formatDateTime } from '@/lib/format';
import { toRussianError } from '@/lib/error-messages';
import type {
  SandboxReplayChartAction,
  SandboxReplayChartActionKind,
  SandboxReplayChartToken,
  SandboxReplayDetail,
} from '@nexter/contracts';
import { useSandboxReplayChart, useSandboxReplayDecisions } from './sandbox-hooks';
import { useState } from 'react';

const actionLabels: Record<SandboxReplayChartActionKind, string> = {
  buy: 'Покупка',
  sell: 'Продажа',
  reject: 'Отклонено',
  expire: 'Истекло',
  counterfactual: 'Ретроспектива',
};

const actionColors: Record<SandboxReplayChartActionKind, string> = {
  buy: '#059669',
  sell: '#0284c7',
  reject: '#dc2626',
  expire: '#71717a',
  counterfactual: '#7c3aed',
};

const actionTone: Record<
  SandboxReplayChartActionKind,
  'success' | 'info' | 'danger' | 'neutral' | 'warning'
> = {
  buy: 'success',
  sell: 'info',
  reject: 'danger',
  expire: 'neutral',
  counterfactual: 'warning',
};

function formatActionTime(time: number): string {
  return formatDateTime(new Date(time).toISOString());
}

function actionPrice(
  action: SandboxReplayChartAction,
  token: SandboxReplayChartToken | undefined,
): number | null {
  if (action.priceUsd !== null) return Number(action.priceUsd);
  let close: number | null = null;
  for (const candle of token?.candles ?? []) {
    if (candle.time > action.time) break;
    close = Number(candle.closeUsd);
  }
  return close;
}

export function ReplayPriceChart({
  token,
  actions,
  selectedActionId,
  onSelect,
}: {
  token: SandboxReplayChartToken;
  actions: readonly SandboxReplayChartAction[];
  selectedActionId: string | null;
  onSelect: (action: SandboxReplayChartAction) => void;
}) {
  if (token.candles.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-zinc-200 bg-zinc-50/70 px-4 py-10 text-center text-sm text-zinc-600">
        Для этого токена в окне прогона нет свечей.
      </div>
    );
  }

  const width = 960;
  const height = 300;
  const padding = { top: 20, right: 16, bottom: 28, left: 52 };
  const values = token.candles.map((candle) => Number(candle.closeUsd));
  const minValue = Math.min(...values);
  const maxValue = Math.max(...values);
  const span = maxValue - minValue || 1;
  const minTime = token.candles[0]?.time ?? 0;
  const maxTime = token.candles[token.candles.length - 1]?.time ?? minTime + 1;
  const timeSpan = maxTime - minTime || 1;
  const x = (time: number) =>
    padding.left + ((time - minTime) / timeSpan) * (width - padding.left - padding.right);
  const y = (price: number) =>
    height - padding.bottom - ((price - minValue) / span) * (height - padding.top - padding.bottom);
  const path = token.candles
    .map((candle, index) => {
      const px = x(candle.time);
      const py = y(Number(candle.closeUsd));
      return `${index === 0 ? 'M' : 'L'}${px.toFixed(2)},${py.toFixed(2)}`;
    })
    .join(' ');
  const tokenActions = actions.filter((action) => action.tokenId === token.tokenId);

  return (
    <div className="overflow-x-auto">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="h-auto min-w-[720px] w-full"
        role="img"
        aria-label="График цены и действий прогона"
      >
        {[0, 0.25, 0.5, 0.75, 1].map((ratio) => (
          <line
            key={ratio}
            x1={padding.left}
            x2={width - padding.right}
            y1={padding.top + (height - padding.top - padding.bottom) * ratio}
            y2={padding.top + (height - padding.top - padding.bottom) * ratio}
            stroke="#e4e4e7"
            strokeWidth="1"
          />
        ))}
        <path d={path} fill="none" stroke="#18181b" strokeWidth="1.8" strokeLinejoin="round" />
        {tokenActions.map((action) => {
          const price = actionPrice(action, token);
          if (price === null) return null;
          const selected = selectedActionId === action.id;
          const cx = x(action.time);
          const cy = y(price);
          const color = actionColors[action.kind];
          return (
            <g
              key={action.id}
              role="button"
              tabIndex={0}
              aria-label={`${actionLabels[action.kind]}: ${action.reasonText || action.reasonCode} (${action.reasonCode})`}
              onClick={() => onSelect(action)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  onSelect(action);
                }
              }}
              className="cursor-pointer outline-none"
            >
              {selected ? (
                <circle cx={cx} cy={cy} r="10" fill="none" stroke={color} strokeWidth="2" />
              ) : null}
              {action.kind === 'counterfactual' ? (
                <rect
                  x={cx - 4}
                  y={cy - 4}
                  width="8"
                  height="8"
                  fill="white"
                  stroke={color}
                  strokeWidth="2"
                />
              ) : action.kind === 'reject' || action.kind === 'expire' ? (
                <path
                  d={`M${cx},${cy - 6} L${cx + 6},${cy + 4} L${cx - 6},${cy + 4} Z`}
                  fill={color}
                />
              ) : (
                <circle cx={cx} cy={cy} r="4.5" fill={color} />
              )}
            </g>
          );
        })}
        <text x={padding.left} y={height - 8} fontSize="10" fill="#71717a">
          {formatActionTime(minTime)}
        </text>
        <text
          x={width - padding.right}
          y={height - 8}
          textAnchor="end"
          fontSize="10"
          fill="#71717a"
        >
          {formatActionTime(maxTime)}
        </text>
        <text x={padding.left} y={padding.top + 4} fontSize="10" fill="#71717a">
          {maxValue.toFixed(4)}
        </text>
        <text
          x={padding.left}
          y={height - padding.bottom}
          fontSize="10"
          fill="#71717a"
          dominantBaseline="hanging"
        >
          {minValue.toFixed(4)}
        </text>
      </svg>
    </div>
  );
}

function SelectedAction({ action }: { action: SandboxReplayChartAction | null }) {
  if (!action) {
    return (
      <p className="rounded-xl border border-dashed border-zinc-200 bg-zinc-50/70 px-4 py-3 text-xs text-zinc-500">
        Нажмите на точку на графике, чтобы увидеть причину действия.
      </p>
    );
  }

  return (
    <div className="rounded-xl border border-zinc-200 bg-zinc-50/70 px-4 py-3 text-sm text-zinc-700">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={actionTone[action.kind]}>{actionLabels[action.kind]}</Badge>
        <span className="font-mono text-xs text-zinc-500">{formatActionTime(action.time)}</span>
        <span className="font-mono text-xs text-zinc-700">{action.reasonCode}</span>
        {action.priceUsd !== null ? (
          <span className="ml-auto font-mono text-xs text-zinc-600">
            Цена: {Number(action.priceUsd).toFixed(6)}
          </span>
        ) : null}
      </div>
      <p className="mt-2 text-sm text-zinc-800">{action.reasonText || 'Причина не указана.'}</p>
      <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-xs text-zinc-500">
        <span>Сумма: ${Number(action.amountUsd).toFixed(2)}</span>
        {action.pnlUsd !== null ? (
          <span className={Number(action.pnlUsd) >= 0 ? 'text-emerald-700' : 'text-red-700'}>
            P&L: ${Number(action.pnlUsd).toFixed(2)}
          </span>
        ) : null}
        {action.intentId ? <span className="font-mono">intent {action.intentId}</span> : null}
        {action.tradeId ? <span className="font-mono">trade {action.tradeId}</span> : null}
      </div>
    </div>
  );
}

export function SandboxReplayChart({
  replay,
  symbolByKey,
}: {
  replay: SandboxReplayDetail;
  symbolByKey: ReadonlyMap<string, string>;
}) {
  const chart = useSandboxReplayChart(replay.id, replay.status === 'completed');
  const [tokenId, setTokenId] = useState<string | null>(null);
  const [selected, setSelected] = useState<SandboxReplayChartAction | null>(null);
  const [decisionsOpen, setDecisionsOpen] = useState(false);
  const data = chart.data;
  const selectedTokenId =
    tokenId ??
    data?.tokens.find((token) => token.candles.length > 0)?.tokenId ??
    data?.tokens[0]?.tokenId ??
    null;
  const token = data?.tokens.find((item) => item.tokenId === selectedTokenId);
  const actions = data?.actions ?? [];

  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <CardTitle>Карта действий</CardTitle>
          <CardDescription>
            Цена токена, точки входов/выходов и причины решений. Нажмите на точку для деталей.
          </CardDescription>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {data && data.tokens.length > 1 ? (
            <Select
              aria-label="Токен графика"
              className="h-9 w-44"
              value={selectedTokenId ?? ''}
              onChange={(event) => {
                setTokenId(event.target.value);
                setSelected(null);
              }}
            >
              {data.tokens.map((item) => (
                <option key={item.tokenId} value={item.tokenId}>
                  {symbolByKey.get(item.tokenId) ?? item.tokenId}
                </option>
              ))}
            </Select>
          ) : null}
          <Button variant="secondary" onClick={() => setDecisionsOpen(true)}>
            Все решения
          </Button>
        </div>
      </div>

      {chart.isPending ? <LoadingRows rows={3} /> : null}
      {chart.isError ? (
        <ErrorState
          message={toRussianError(chart.error, 'Не удалось загрузить карту действий')}
          onRetry={() => void chart.refetch()}
        />
      ) : null}
      {data && token ? (
        <div className="mt-4 space-y-3">
          <div className="flex flex-wrap gap-3 text-[11px] text-zinc-500">
            {(['buy', 'sell', 'reject', 'expire', 'counterfactual'] as const).map((kind) => (
              <span key={kind} className="inline-flex items-center gap-1.5">
                <span
                  className="h-2.5 w-2.5 rounded-full"
                  style={{ backgroundColor: actionColors[kind] }}
                />
                {actionLabels[kind]}
              </span>
            ))}
          </div>
          <ReplayPriceChart
            token={token}
            actions={actions}
            selectedActionId={selected?.id ?? null}
            onSelect={setSelected}
          />
          <SelectedAction action={selected} />
          <p className="text-[11px] text-zinc-500">{data.note}</p>
        </div>
      ) : null}

      <SandboxReplayDecisions
        replayId={replay.id}
        tokenId={selectedTokenId}
        open={decisionsOpen}
        onClose={() => setDecisionsOpen(false)}
      />
    </Card>
  );
}

function SandboxReplayDecisions({
  replayId,
  tokenId,
  open,
  onClose,
}: {
  replayId: string;
  tokenId: string | null;
  open: boolean;
  onClose: () => void;
}) {
  const decisions = useSandboxReplayDecisions(replayId, tokenId, open);
  const [visible, setVisible] = useState(20);
  const rows = decisions.data?.pages.flatMap((page) => page.items) ?? [];
  const total = decisions.data?.pages[0]?.total ?? 0;

  function showMore(): void {
    setVisible((current) => current + 20);
    if (visible + 20 >= rows.length && decisions.hasNextPage) {
      void decisions.fetchNextPage();
    }
  }

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title="Все решения прогона"
      description="Полный детерминированный журнал решений: hold, block, risk checks и действия."
      size="xl"
      footer={
        <Button variant="secondary" onClick={onClose}>
          Закрыть
        </Button>
      }
    >
      {decisions.isPending ? <LoadingRows rows={5} /> : null}
      {decisions.isError ? (
        <ErrorState
          message={toRussianError(decisions.error, 'Не удалось восстановить журнал решений')}
          onRetry={() => void decisions.refetch()}
        />
      ) : null}
      {!decisions.isPending && !decisions.isError ? (
        <div className="space-y-3">
          <p className="text-xs text-zinc-500">Записей: {total}</p>
          {rows.length === 0 ? (
            <p className="text-sm text-zinc-600">Решений нет.</p>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-zinc-200">
              <table className="w-full min-w-[760px] text-left text-xs">
                <thead className="bg-zinc-50 text-zinc-500">
                  <tr>
                    <th className="px-3 py-2">Время</th>
                    <th className="px-3 py-2">Токен</th>
                    <th className="px-3 py-2">Стратегия</th>
                    <th className="px-3 py-2">Действие</th>
                    <th className="px-3 py-2">Размер</th>
                    <th className="px-3 py-2">Причина</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.slice(0, visible).map((row, index) => (
                    <tr
                      key={`${row.time}-${row.tokenId}-${row.reasonCode}-${index}`}
                      className="border-t border-zinc-100"
                    >
                      <td className="px-3 py-2 text-zinc-500">{formatActionTime(row.time)}</td>
                      <td className="px-3 py-2">{row.tokenId}</td>
                      <td className="px-3 py-2">{row.strategyKey || '—'}</td>
                      <td className="px-3 py-2">
                        <Badge
                          tone={
                            row.action === 'buy'
                              ? 'success'
                              : row.action === 'sell'
                                ? 'info'
                                : row.action === 'block'
                                  ? 'danger'
                                  : 'neutral'
                          }
                        >
                          {row.action}
                        </Badge>
                      </td>
                      <td className="px-3 py-2 font-mono">
                        {row.sizeUsd === null ? '—' : `$${Number(row.sizeUsd).toFixed(2)}`}
                      </td>
                      <td className="px-3 py-2">
                        <span className="font-mono text-zinc-700">{row.reasonCode}</span>
                        {row.reasonText ? (
                          <span className="text-zinc-500"> · {row.reasonText}</span>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {rows.length > visible || decisions.hasNextPage ? (
            <div className="flex justify-center">
              <Button
                variant="secondary"
                onClick={showMore}
                disabled={decisions.isFetchingNextPage}
              >
                {decisions.isFetchingNextPage ? 'Загружаю…' : 'Ещё'}
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}
    </Drawer>
  );
}

import { LineChart } from '@/components/charts/line-chart';
import { Button } from '@/components/ui/button';
import { Card, CardDescription, CardTitle } from '@/components/ui/card';
import { fetchBotEquity } from '@/lib/api';
import { toRussianError } from '@/lib/error-messages';
import {
  formatDate,
  formatDateTime,
  formatPct,
  formatSignedUsd,
  formatUsd,
  pnlTone,
} from '@/lib/format';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';

const RANGES = [1, 7, 30, 365] as const;

function rangeLabel(days: (typeof RANGES)[number]): string {
  return days === 1 ? '24ч' : days === 365 ? '1г' : `${days}д`;
}

export function BotEquityChart({ botId, open }: { botId: string; open: boolean }) {
  const [days, setDays] = useState<(typeof RANGES)[number]>(7);
  const equity = useQuery({
    queryKey: ['trading-bot-equity', botId, days],
    queryFn: () => fetchBotEquity(botId, 1000, 0, days),
    enabled: Boolean(botId) && open,
    refetchInterval: 15_000,
  });

  const points = (equity.data?.data ?? []).map((point) => ({
    label: days <= 7 ? formatDateTime(point.capturedAt) : formatDate(point.capturedAt),
    value: Number(point.equityUsd),
  }));
  const first = points[0]?.value;
  const last = points.at(-1)?.value;
  const change = first !== undefined && last !== undefined ? last - first : null;
  const changePct =
    first !== undefined && last !== undefined && first > 0 ? ((last - first) / first) * 100 : null;
  const positive = (change ?? 0) >= 0;

  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <CardTitle>Капитал</CardTitle>
          {last !== undefined ? (
            <div className="mt-1 flex flex-wrap items-baseline gap-2">
              <span className="font-mono text-2xl font-semibold tabular-nums text-zinc-900">
                {formatUsd(String(last))}
              </span>
              {change !== null ? (
                <span className={`font-mono text-sm ${pnlTone(String(change))}`}>
                  {formatSignedUsd(String(change))}
                  {changePct !== null ? ` · ${formatPct(String(changePct))}` : ''}
                </span>
              ) : null}
            </div>
          ) : (
            <CardDescription>Снимки капитала появятся после первого тика.</CardDescription>
          )}
        </div>
        <div className="flex gap-1">
          {RANGES.map((range) => (
            <Button
              key={range}
              type="button"
              variant={days === range ? 'primary' : 'secondary'}
              className="h-7 px-2 text-xs"
              onClick={() => setDays(range)}
            >
              {rangeLabel(range)}
            </Button>
          ))}
        </div>
      </div>

      {equity.isPending ? (
        <div className="mt-4 h-56 animate-pulse rounded-lg bg-zinc-100" />
      ) : equity.isError ? (
        <p className="mt-4 text-sm text-red-700">
          {toRussianError(equity.error, 'Не удалось загрузить капитал')}
        </p>
      ) : points.length < 2 ? (
        <p className="mt-4 rounded-lg border border-zinc-200 bg-zinc-50 p-3 text-sm text-zinc-500">
          Недостаточно снимков капитала за выбранный период.
        </p>
      ) : (
        <div className="mt-3">
          <LineChart
            points={points}
            height={220}
            color={positive ? '#059669' : '#dc2626'}
            strokeWidth={2}
            formatValue={(value) => formatUsd(String(value))}
          />
        </div>
      )}
    </Card>
  );
}

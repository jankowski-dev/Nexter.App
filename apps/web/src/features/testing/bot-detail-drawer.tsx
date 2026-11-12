import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardDescription, CardTitle } from '@/components/ui/card';
import { Drawer } from '@/components/ui/drawer';
import { ErrorState, LoadingRows } from '@/components/ui/states';
import { FanIcon } from '@/components/live-refresh-indicator';
import { LineChart } from '@/components/charts/line-chart';
import { TokenIcon } from '@/components/token-icon';
import { StrategyIcon } from './strategy-icon';
import { fetchBotEquity, fetchBotEvents, fetchBotTrades, fetchTradingBot } from '@/lib/api';
import { toRussianError } from '@/lib/error-messages';
import {
  formatDateTime,
  formatPrice,
  formatSignedUsd,
  formatTokenAmount,
  formatUsd,
  pnlTone,
} from '@/lib/format';
import { useQuery } from '@tanstack/react-query';
import type { BotStatus } from '@nexter/contracts';

const statusLabels: Record<BotStatus, string> = {
  draft: 'Черновик',
  running: 'Работает',
  stopped: 'Остановлен',
};

const eventLabels: Record<string, string> = {
  created: 'создан',
  started: 'запуск',
  stopped: 'остановка',
  buy: 'покупка',
  sell: 'продажа',
  error: 'ошибка',
  reset: 'сброс',
  archived: 'архив',
  closed_all: 'закрытие позиций',
};

export function BotDetailDrawer({
  botId,
  onClose,
  onStart,
  onStop,
  onReset,
  onClosePositions,
  onArchive,
  busy,
}: {
  botId: string | null;
  onClose: () => void;
  onStart: (id: string) => void;
  onStop: (id: string) => void;
  onReset: (id: string) => void;
  onClosePositions: (id: string) => void;
  onArchive: (id: string) => void;
  busy: boolean;
}) {
  const detail = useQuery({
    queryKey: ['trading-bot', botId],
    queryFn: () => fetchTradingBot(botId as string),
    enabled: Boolean(botId),
    refetchInterval: 15_000,
  });
  const trades = useQuery({
    queryKey: ['trading-bot-trades', botId],
    queryFn: () => fetchBotTrades(botId as string),
    enabled: Boolean(botId),
    refetchInterval: 15_000,
  });
  const events = useQuery({
    queryKey: ['trading-bot-events', botId],
    queryFn: () => fetchBotEvents(botId as string),
    enabled: Boolean(botId),
    refetchInterval: 15_000,
  });
  const equity = useQuery({
    queryKey: ['trading-bot-equity', botId],
    queryFn: () => fetchBotEquity(botId as string),
    enabled: Boolean(botId),
    refetchInterval: 15_000,
  });

  if (!botId) return null;
  if (detail.isPending) {
    return (
      <Drawer open onClose={onClose} title="Бот" size="lg">
        <LoadingRows rows={8} />
      </Drawer>
    );
  }
  if (detail.isError || !detail.data) {
    return (
      <Drawer open onClose={onClose} title="Бот" size="lg">
        <ErrorState
          message={toRussianError(detail.error, 'Не удалось загрузить бота')}
          onRetry={() => void detail.refetch()}
        />
      </Drawer>
    );
  }

  const { bot, strategy, tokens, positions } = detail.data;
  const stats = bot.stats;
  const equityPoints = (equity.data?.data ?? []).map((point) => ({
    label: formatDateTime(point.capturedAt),
    value: Number(point.equityUsd),
  }));

  return (
    <Drawer
      open
      onClose={onClose}
      title={bot.name}
      titleIcon={<StrategyIcon icon={strategy.icon} className="h-8 w-8" />}
      description={`${strategy.name} · ${statusLabels[bot.status]}`}
      size="lg"
      footer={
        <div className="flex w-full flex-wrap items-center justify-between gap-2">
          <Button
            variant="ghost"
            className="text-red-700"
            onClick={() => onArchive(bot.id)}
            disabled={busy || positions.length > 0}
            title={positions.length > 0 ? 'Сначала закройте позиции' : undefined}
          >
            Удалить
          </Button>
          <div className="flex flex-wrap gap-2">
            {positions.length > 0 ? (
              <Button variant="secondary" onClick={() => onClosePositions(bot.id)} disabled={busy}>
                Закрыть позиции
              </Button>
            ) : null}
            <Button variant="secondary" onClick={() => onReset(bot.id)} disabled={busy}>
              Сбросить
            </Button>
            {bot.status === 'running' ? (
              <Button variant="secondary" onClick={() => onStop(bot.id)} disabled={busy}>
                Остановить
              </Button>
            ) : (
              <Button onClick={() => onStart(bot.id)} disabled={busy}>
                Запустить
              </Button>
            )}
            <Button variant="ghost" onClick={onClose}>
              Закрыть
            </Button>
          </div>
        </div>
      }
    >
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-3 rounded-xl border border-zinc-200 bg-zinc-50 p-3">
          <div>
            <div className="text-sm font-medium text-zinc-800">{strategy.name}</div>
            <div className="text-xs text-zinc-500">
              {strategy.key} · v{strategy.version}
            </div>
          </div>
          <div className="flex items-center gap-2 text-sm text-zinc-600">
            {bot.status === 'running' ? <FanIcon spinning /> : null}
            <Badge tone={bot.status === 'running' ? 'success' : 'neutral'}>
              {statusLabels[bot.status]}
            </Badge>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Card>
            <CardTitle>Капитал</CardTitle>
            <div className="mt-1 font-mono text-xl font-semibold">{formatUsd(stats.equityUsd)}</div>
            <CardDescription>
              Кэш {formatUsd(stats.cashUsd)} · просадка {stats.maxDrawdownPct ?? '—'}%
            </CardDescription>
          </Card>
          <Card>
            <CardTitle>Общий P&L</CardTitle>
            <div className={`mt-1 font-mono text-xl font-semibold ${pnlTone(stats.totalPnlUsd)}`}>
              {formatSignedUsd(stats.totalPnlUsd)}
            </div>
            <CardDescription>Бюджет {formatUsd(stats.budgetUsd)}</CardDescription>
          </Card>
          <Card>
            <CardTitle>Профит-фактор</CardTitle>
            <div className="mt-1 font-mono text-xl font-semibold">{stats.profitFactor ?? '—'}</div>
            <CardDescription>Win rate {stats.winRate ? `${stats.winRate}%` : '—'}</CardDescription>
          </Card>
          <Card>
            <CardTitle>Прибыль</CardTitle>
            <div className="mt-1 font-mono text-xl font-semibold text-emerald-700">
              {formatUsd(stats.grossProfitUsd)}
            </div>
            <CardDescription>Реализованная</CardDescription>
          </Card>
          <Card>
            <CardTitle>Убыток</CardTitle>
            <div className="mt-1 font-mono text-xl font-semibold text-red-700">
              {formatUsd(stats.grossLossUsd)}
            </div>
            <CardDescription>Реализованный</CardDescription>
          </Card>
          <Card>
            <CardTitle>Сделки</CardTitle>
            <div className="mt-1 font-mono text-xl font-semibold">{stats.tradesCount}</div>
            <CardDescription>
              {stats.wins} / {stats.losses} · открыто {stats.openPositions}
            </CardDescription>
          </Card>
        </div>

        <Card>
          <CardTitle>Капитал</CardTitle>
          {equity.isError ? (
            <p className="py-6 text-sm text-red-700">
              {toRussianError(equity.error, 'Не удалось загрузить equity')}
            </p>
          ) : (
            <LineChart points={equityPoints} height={180} />
          )}
        </Card>

        <Card>
          <CardTitle>Токены</CardTitle>
          <div className="mt-2 flex flex-wrap gap-2">
            {tokens.map((token) => (
              <span
                key={token.assetId}
                className="inline-flex items-center gap-1.5 rounded-full border border-zinc-200 px-2.5 py-1 text-xs text-zinc-700"
              >
                <TokenIcon
                  logoUrl={token.logoUrl}
                  symbol={token.symbol}
                  className="h-5 w-5 text-[9px]"
                />
                {token.symbol}
                <span className="text-zinc-400">{token.chainCode}</span>
              </span>
            ))}
          </div>
        </Card>

        <Card>
          <CardTitle>Настройки</CardTitle>
          <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-2 text-xs sm:grid-cols-4">
            <div>
              <div className="text-zinc-500">Бюджет</div>
              <div className="font-mono text-zinc-900">{formatUsd(bot.budgetUsd)}</div>
            </div>
            <div>
              <div className="text-zinc-500">Макс. позиций</div>
              <div className="font-mono text-zinc-900">{bot.maxPositions}</div>
            </div>
            <div>
              <div className="text-zinc-500">Размер позиции</div>
              <div className="font-mono text-zinc-900">{bot.positionSizePct}%</div>
            </div>
            <div>
              <div className="text-zinc-500">Пауза после покупки</div>
              <div className="font-mono text-zinc-900">{bot.cooldownMinutes} мин</div>
            </div>
            <div>
              <div className="text-zinc-500">Комиссия</div>
              <div className="font-mono text-zinc-900">{bot.feeBps} bps</div>
            </div>
            <div>
              <div className="text-zinc-500">Проскальзывание</div>
              <div className="font-mono text-zinc-900">{bot.slippageBps} bps</div>
            </div>
            <div>
              <div className="text-zinc-500">Дневной лимит убытка</div>
              <div className="font-mono text-zinc-900">{bot.maxDailyLossPct}%</div>
            </div>
            <div>
              <div className="text-zinc-500">Последний тик</div>
              <div className="font-mono text-zinc-900">
                {bot.lastTickAt ? formatDateTime(bot.lastTickAt) : '—'}
              </div>
            </div>
          </div>
        </Card>

        <Card>
          <CardTitle>Открытые позиции</CardTitle>
          {positions.length === 0 ? (
            <CardDescription>Позиций нет.</CardDescription>
          ) : (
            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-zinc-200 text-left text-xs text-zinc-500">
                    <th className="py-2 pr-3 font-medium">Токен</th>
                    <th className="py-2 pr-3 text-right font-medium">Количество</th>
                    <th className="py-2 pr-3 text-right font-medium">Средняя</th>
                    <th className="py-2 pr-3 text-right font-medium">Сейчас</th>
                    <th className="py-2 pr-3 text-right font-medium">Стоимость</th>
                    <th className="py-2 text-right font-medium">P&L</th>
                  </tr>
                </thead>
                <tbody>
                  {positions.map((position) => (
                    <tr key={position.asset.id} className="border-b border-zinc-100 last:border-0">
                      <td className="py-2 pr-3">
                        <div className="flex items-center gap-2">
                          <TokenIcon
                            logoUrl={position.asset.logoUrl}
                            symbol={position.asset.symbol}
                          />
                          <span className="font-medium">{position.asset.symbol}</span>
                        </div>
                      </td>
                      <td className="py-2 pr-3 text-right font-mono">
                        {formatTokenAmount(position.amount, 8)}
                      </td>
                      <td className="py-2 pr-3 text-right font-mono">
                        {formatPrice(position.avgCostUsd)}
                      </td>
                      <td className="py-2 pr-3 text-right font-mono">
                        {formatPrice(position.currentPriceUsd)}
                      </td>
                      <td className="py-2 pr-3 text-right font-mono">
                        {formatUsd(position.valueUsd)}
                      </td>
                      <td
                        className={`py-2 text-right font-mono ${pnlTone(position.unrealizedPnlUsd)}`}
                      >
                        {formatSignedUsd(position.unrealizedPnlUsd)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <Card>
          <CardTitle>Сделки</CardTitle>
          {trades.isError ? (
            <p className="text-sm text-red-700">
              {toRussianError(trades.error, 'Не удалось загрузить сделки')}
            </p>
          ) : !trades.data || trades.data.data.length === 0 ? (
            <CardDescription>Сделок пока нет.</CardDescription>
          ) : (
            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-zinc-200 text-left text-xs text-zinc-500">
                    <th className="py-2 pr-3 font-medium">Время</th>
                    <th className="py-2 pr-3 font-medium">Токен</th>
                    <th className="py-2 pr-3 font-medium">Сторона</th>
                    <th className="py-2 pr-3 text-right font-medium">Кол-во</th>
                    <th className="py-2 pr-3 text-right font-medium">Цена</th>
                    <th className="py-2 pr-3 text-right font-medium">P&L</th>
                    <th className="py-2 font-medium">Причина</th>
                  </tr>
                </thead>
                <tbody>
                  {trades.data.data.map((trade) => (
                    <tr key={trade.id} className="border-b border-zinc-100 last:border-0">
                      <td className="py-2 pr-3 text-xs text-zinc-500">
                        {formatDateTime(trade.executedAt)}
                      </td>
                      <td className="py-2 pr-3">{trade.asset.symbol}</td>
                      <td className="py-2 pr-3">
                        <Badge tone={trade.side === 'buy' ? 'info' : 'neutral'}>
                          {trade.side === 'buy' ? 'Покупка' : 'Продажа'}
                        </Badge>
                      </td>
                      <td className="py-2 pr-3 text-right font-mono">
                        {formatTokenAmount(trade.amount, 8)}
                      </td>
                      <td className="py-2 pr-3 text-right font-mono">
                        {formatPrice(trade.priceUsd)}
                      </td>
                      <td
                        className={`py-2 pr-3 text-right font-mono ${pnlTone(trade.realizedPnlUsd)}`}
                      >
                        {trade.realizedPnlUsd !== '0.00000000'
                          ? formatSignedUsd(trade.realizedPnlUsd)
                          : '—'}
                      </td>
                      <td className="py-2 text-xs text-zinc-500">{trade.reason}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <Card>
          <CardTitle>Журнал бота</CardTitle>
          {events.isError ? (
            <p className="text-sm text-red-700">
              {toRussianError(events.error, 'Не удалось загрузить журнал')}
            </p>
          ) : !events.data || events.data.data.length === 0 ? (
            <CardDescription>Событий нет.</CardDescription>
          ) : (
            <div className="mt-2 space-y-1.5">
              {events.data.data.slice(0, 40).map((event) => (
                <div key={event.id} className="flex items-start gap-2 text-xs">
                  <span className="shrink-0 text-zinc-400">{formatDateTime(event.createdAt)}</span>
                  <Badge tone={event.type === 'error' ? 'warning' : 'info'}>
                    {eventLabels[event.type] ?? event.type}
                  </Badge>
                  <span className="text-zinc-600">{event.message}</span>
                </div>
              ))}
            </div>
          )}
        </Card>
        <CardDescription>
          Сделки виртуальные. Реальные свопы и подписи не отправляются. Комиссия и проскальзывание
          симулируются настройками бота.
        </CardDescription>
      </div>
    </Drawer>
  );
}

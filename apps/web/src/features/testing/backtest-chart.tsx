import type { BotBacktestTrade, BotCandle } from '@nexter/contracts';
import { formatPrice } from '@/lib/format';

const WIDTH = 900;
const HEIGHT = 280;
const PADDING = { top: 16, right: 64, bottom: 30, left: 12 };

export function BacktestChart({
  candles,
  trades,
  visibleTrades,
}: {
  candles: BotCandle[];
  trades: BotBacktestTrade[];
  visibleTrades: number;
}) {
  if (candles.length < 2) {
    return (
      <div className="flex h-64 items-center justify-center rounded-xl border border-dashed border-zinc-200 text-sm text-zinc-500">
        Нет данных для графика.
      </div>
    );
  }

  const visible = trades.slice(0, Math.max(0, Math.min(visibleTrades, trades.length)));
  const closes = candles.map((candle) => Number(candle.closeUsd));
  const markedPrices = visible.map((trade) => Number(trade.priceUsd));
  const lows = candles.map((candle) => Number(candle.lowUsd));
  const highs = candles.map((candle) => Number(candle.highUsd));

  let min = Math.min(...lows, ...markedPrices);
  let max = Math.max(...highs, ...markedPrices);
  if (!Number.isFinite(min) || !Number.isFinite(max)) {
    min = 0;
    max = 1;
  }
  if (max === min) {
    const delta = Math.abs(max) * 0.01 || 1;
    min -= delta;
    max += delta;
  }
  const padding = (max - min) * 0.06;
  min -= padding;
  max += padding;

  const chartWidth = WIDTH - PADDING.left - PADDING.right;
  const chartHeight = HEIGHT - PADDING.top - PADDING.bottom;
  const x = (index: number) =>
    PADDING.left +
    (candles.length === 1 ? chartWidth / 2 : (index / (candles.length - 1)) * chartWidth);
  const y = (value: number) => PADDING.top + ((max - value) / (max - min)) * chartHeight;

  const linePath = closes
    .map(
      (close, index) => `${index === 0 ? 'M' : 'L'} ${x(index).toFixed(2)} ${y(close).toFixed(2)}`,
    )
    .join(' ');
  const areaPath = `${linePath} L ${x(candles.length - 1).toFixed(2)} ${(HEIGHT - PADDING.bottom).toFixed(2)} L ${x(0).toFixed(2)} ${(HEIGHT - PADDING.bottom).toFixed(2)} Z`;

  const yTicks = Array.from({ length: 5 }, (_, index) => {
    const value = min + ((max - min) * index) / 4;
    return { value, y: y(value) };
  });

  const xTickIndexes = [
    0,
    Math.floor((candles.length - 1) / 3),
    Math.floor(((candles.length - 1) * 2) / 3),
    candles.length - 1,
  ];
  const uniqueTicks = [...new Set(xTickIndexes)];

  return (
    <div className="space-y-2">
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="h-auto w-full"
        role="img"
        aria-label="График исторических дневных цен и сделок бэктеста"
      >
        <defs>
          <linearGradient id="backtest-area" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="#10b981" stopOpacity="0.18" />
            <stop offset="100%" stopColor="#10b981" stopOpacity="0" />
          </linearGradient>
        </defs>
        {yTicks.map((tick) => (
          <g key={tick.value}>
            <line
              x1={PADDING.left}
              x2={WIDTH - PADDING.right}
              y1={tick.y}
              y2={tick.y}
              stroke="#e4e4e7"
              strokeDasharray="3 4"
            />
            <text x={WIDTH - PADDING.right + 6} y={tick.y + 3} fontSize="10" fill="#a1a1aa">
              {formatPrice(String(tick.value))}
            </text>
          </g>
        ))}
        <path d={areaPath} fill="url(#backtest-area)" />
        <path d={linePath} fill="none" stroke="#059669" strokeWidth="2" />
        {uniqueTicks.map((index) => (
          <text
            key={index}
            x={x(index)}
            y={HEIGHT - 8}
            fontSize="10"
            fill="#a1a1aa"
            textAnchor={index === 0 ? 'start' : index === candles.length - 1 ? 'end' : 'middle'}
          >
            {candles[index]?.date.slice(5)}
          </text>
        ))}
        {visible.map((trade) => {
          const isSell = trade.side === 'sell';
          const pnl = Number(trade.realizedPnlUsd);
          const color = isSell
            ? pnl > 0
              ? '#059669'
              : pnl < 0
                ? '#dc2626'
                : '#71717a'
            : '#0284c7';
          return (
            <g key={`${trade.index}-${trade.date}`}>
              <circle
                cx={x(tradeIndex(candles, trade.date))}
                cy={y(Number(trade.priceUsd))}
                r="4"
                fill={color}
                stroke="#ffffff"
                strokeWidth="1.5"
              >
                <title>
                  {`${trade.date} · ${isSell ? 'Продажа' : 'Покупка'} · ${formatPrice(trade.priceUsd)}${isSell ? ` · P&L ${trade.realizedPnlUsd}` : ''} · ${trade.reason}`}
                </title>
              </circle>
            </g>
          );
        })}
      </svg>
      <div className="flex flex-wrap items-center gap-4 text-xs text-zinc-500">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-sky-600" /> Покупка
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-emerald-600" /> Прибыльная продажа
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-red-600" /> Убыточная продажа
        </span>
        <span className="ml-auto">
          {candles[0]?.date} — {candles[candles.length - 1]?.date}
        </span>
      </div>
    </div>
  );
}

function tradeIndex(candles: BotCandle[], date: string): number {
  const index = candles.findIndex((candle) => candle.date === date);
  return index >= 0 ? index : candles.length - 1;
}

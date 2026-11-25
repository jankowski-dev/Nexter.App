import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardDescription, CardTitle } from '@/components/ui/card';
import { formatByn, pluralizeRu } from '@/lib/format';
import { useId, useState, type ReactNode } from 'react';
import type {
  FinanceAccountKind,
  FinanceAccountWithBalance,
  FinanceCategoryTotal,
  FinanceMonthTotal,
} from '@nexter/contracts';
import { categoryColorHex, categoryFallbackPalette } from './category-colors';
import {
  accountKindLabels,
  buildCategorySections,
  financeMoney,
  formatShare,
  hasMonthlyMovement,
  monthLabel,
  monthShortLabel,
  summarizeMonths,
  type FinanceCategorySection,
  type FinanceCategorySlice,
} from './finance-view-model';

type SurfaceTone = 'emerald' | 'sky' | 'amber' | 'violet' | 'rose';

const accountSurfaceTone: Record<FinanceAccountKind, SurfaceTone> = {
  cash: 'amber',
  card: 'sky',
  bank: 'emerald',
  savings: 'violet',
  investment: 'emerald',
  credit: 'rose',
};

const accountIconTone: Record<SurfaceTone, string> = {
  emerald: 'text-emerald-700',
  sky: 'text-sky-700',
  amber: 'text-amber-700',
  violet: 'text-violet-700',
  rose: 'text-rose-700',
};

const accountGlyphs: Record<FinanceAccountKind, ReactNode> = {
  cash: (
    <>
      <rect x="3" y="6.5" width="18" height="11" rx="2" />
      <circle cx="12" cy="12" r="2.5" />
      <path d="M6.5 9.5h.01M17.5 14.5h.01" />
    </>
  ),
  card: (
    <>
      <rect x="3" y="5.5" width="18" height="13" rx="2.5" />
      <path d="M3 9.5h18M7 14.5h4" />
    </>
  ),
  bank: (
    <>
      <path d="M4 20h16M4 10l8-5 8 5H4Z" />
      <path d="M6 20V10M10 20V10M14 20V10M18 20V10" />
    </>
  ),
  savings: (
    <>
      <rect x="4" y="5" width="16" height="14" rx="3" />
      <circle cx="12" cy="12" r="3.2" />
      <path d="M12 10.2v3.6M10.2 12h3.6" />
    </>
  ),
  investment: (
    <>
      <path d="M4 19V5M4 19h16" />
      <path d="m7 15 3.5-3.5 3 3L20 8" />
      <path d="M20 12V8h-4" />
    </>
  ),
  credit: (
    <>
      <rect x="3" y="5.5" width="18" height="13" rx="2.5" />
      <path d="M3 9.5h18M8 15.5h8" />
    </>
  ),
};

export function FinanceAccountGlyph({
  kind,
  className = 'h-4 w-4',
}: {
  kind: FinanceAccountKind;
  className?: string;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {accountGlyphs[kind]}
    </svg>
  );
}

function TotalCell({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div>
      <div className="text-[10px] font-medium uppercase tracking-wide text-zinc-500">{label}</div>
      <div
        className={`mt-0.5 font-mono text-sm font-semibold tabular-nums ${tone ?? 'text-zinc-900'}`}
      >
        {value}
      </div>
    </div>
  );
}

export function FinanceAccountsBlock({
  accounts,
  assetsBase,
  liabilitiesBase,
  netWorthBase,
  onManage,
}: {
  accounts: readonly FinanceAccountWithBalance[];
  assetsBase?: string;
  liabilitiesBase?: string;
  netWorthBase?: string;
  onManage: () => void;
}) {
  const hasNegativeNetWorth = Number(netWorthBase ?? 0) < 0;

  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <CardTitle>Счета</CardTitle>
          <CardDescription>Балансы по всем валютам и текущий капитал.</CardDescription>
        </div>
        <Button variant="ghost" className="h-8 px-2 text-xs" onClick={onManage}>
          Все счета
        </Button>
      </div>

      {accounts.length === 0 ? (
        <div className="mt-4 rounded-xl border border-dashed border-zinc-200 bg-zinc-50/70 px-4 py-7 text-center">
          <span className="mx-auto inline-flex h-10 w-10 items-center justify-center rounded-xl bg-amber-100 text-amber-700">
            <FinanceAccountGlyph kind="cash" className="h-5 w-5" />
          </span>
          <p className="mt-3 text-sm font-medium text-zinc-700">Счетов пока нет</p>
          <p className="mx-auto mt-1 max-w-xs text-xs text-zinc-500">
            Добавьте первый счёт, чтобы видеть балансы в валюте и общий капитал в BYN.
          </p>
          <Button variant="secondary" className="mt-3 h-8 px-3 text-xs" onClick={onManage}>
            Перейти к счетам
          </Button>
        </div>
      ) : (
        <>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {accounts.map((account) => {
              const surface = accountSurfaceTone[account.kind];
              const isNegative = account.kind === 'credit' || Number(account.balanceBase) < 0;

              return (
                <div
                  key={account.id}
                  className={`tone-surface tone-surface-${surface} rounded-xl border p-3.5 ${
                    account.archivedAt ? 'opacity-60' : ''
                  }`}
                >
                  <div className="flex items-start gap-2.5">
                    <span
                      className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white/80 shadow-sm ${accountIconTone[surface]}`}
                    >
                      <FinanceAccountGlyph kind={account.kind} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-semibold text-zinc-900">
                        {account.name}
                      </div>
                      <div className="mt-0.5 text-[11px] text-zinc-600">
                        {accountKindLabels[account.kind]} · {account.currency}
                      </div>
                    </div>
                    {account.archivedAt ? (
                      <Badge tone="neutral" className="shrink-0">
                        архив
                      </Badge>
                    ) : null}
                  </div>
                  <div className="mt-3 flex flex-wrap items-end justify-between gap-2">
                    <div
                      className={`font-mono text-lg font-semibold tabular-nums ${
                        isNegative ? 'text-rose-700' : 'text-zinc-900'
                      }`}
                    >
                      {financeMoney(account.balance, account.currency)}
                    </div>
                    {account.currency === 'BYN' ? null : (
                      <div className="text-right">
                        <div className="text-[10px] text-zinc-500">в BYN</div>
                        <div className="font-mono text-xs font-medium tabular-nums text-zinc-700">
                          {financeMoney(account.balanceBase, 'BYN')}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="mt-4 rounded-xl border border-zinc-200 bg-zinc-50/70 p-3">
            <div className="grid gap-3 sm:grid-cols-3">
              <TotalCell
                label="Активы"
                value={financeMoney(assetsBase, 'BYN')}
                tone="text-emerald-700"
              />
              <TotalCell
                label="Обязательства"
                value={financeMoney(liabilitiesBase, 'BYN')}
                tone="text-rose-700"
              />
              <TotalCell
                label="Итого по счетам"
                value={financeMoney(netWorthBase, 'BYN')}
                tone={hasNegativeNetWorth ? 'text-rose-700' : 'text-emerald-800'}
              />
            </div>
          </div>
        </>
      )}
    </Card>
  );
}

function categoryColor(
  slice: FinanceCategorySlice,
  index: number,
  colorById: ReadonlyMap<string, string | null>,
): string {
  const known = slice.categoryId ? colorById.get(slice.categoryId) : null;
  if (known && known !== 'default' && categoryColorHex[known]) return categoryColorHex[known];
  return (
    categoryFallbackPalette[index % categoryFallbackPalette.length] ?? categoryColorHex.default
  );
}

function CategoryDonut({
  section,
  colors,
}: {
  section: FinanceCategorySection;
  colors: readonly string[];
}) {
  const center = 88;
  const radius = 68;
  const strokeWidth = 20;
  const circumference = 2 * Math.PI * radius;
  let offset = 0;

  const segments = section.slices.map((slice, index) => {
    const length = (Math.max(0, slice.percent) / 100) * circumference;
    const segment = {
      key: slice.key,
      name: slice.name,
      amountBase: slice.amountBase,
      percent: slice.percent,
      color: colors[index] ?? categoryColorHex.default,
      dashArray: `${length} ${Math.max(circumference - length, 0)}`,
      dashOffset: -offset,
    };
    offset += length;
    return segment;
  });

  return (
    <div className="relative mx-auto h-44 w-44 shrink-0">
      <svg
        viewBox="0 0 176 176"
        className="h-44 w-44"
        role="img"
        aria-label={`${section.label}: ${financeMoney(section.totalBase, 'BYN')}`}
      >
        <circle
          cx={center}
          cy={center}
          r={radius}
          fill="none"
          stroke="var(--surface-muted)"
          strokeWidth={strokeWidth}
        />
        <g transform={`rotate(-90 ${center} ${center})`}>
          {segments.map((segment) => (
            <circle
              key={segment.key}
              cx={center}
              cy={center}
              r={radius}
              fill="none"
              stroke={segment.color}
              strokeWidth={strokeWidth}
              strokeDasharray={segment.dashArray}
              strokeDashoffset={segment.dashOffset}
            >
              <title>
                {segment.name}: {financeMoney(segment.amountBase, 'BYN')} (
                {formatShare(segment.percent)})
              </title>
            </circle>
          ))}
        </g>
      </svg>
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center px-5 text-center">
        <span className="text-[10px] font-medium uppercase tracking-wide text-zinc-500">
          {section.label}
        </span>
        <span className="mt-0.5 font-mono text-sm font-semibold leading-tight text-zinc-900">
          {financeMoney(section.totalBase, 'BYN')}
        </span>
      </div>
    </div>
  );
}

function CategoryLegendRow({ slice, color }: { slice: FinanceCategorySlice; color: string }) {
  return (
    <div
      title={`${slice.name}: ${slice.count} ${pluralizeRu(slice.count, 'операция', 'операции', 'операций')}`}
    >
      <div className="flex items-center gap-2">
        <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: color }} />
        <span className="min-w-0 flex-1 truncate text-sm font-medium text-zinc-800">
          {slice.name}
        </span>
        <span className="shrink-0 font-mono text-xs font-semibold tabular-nums text-zinc-900">
          {financeMoney(slice.amountBase, 'BYN')}
        </span>
        <span className="w-10 shrink-0 text-right font-mono text-[11px] tabular-nums text-zinc-500">
          {formatShare(slice.percent)}
        </span>
      </div>
      <div className="mt-1 flex items-center gap-2 pl-4">
        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-zinc-100">
          <div
            className="h-full rounded-full"
            style={{
              width: `${Math.max(2, Math.min(100, slice.percent))}%`,
              backgroundColor: color,
            }}
          />
        </div>
        <span className="shrink-0 text-[10px] text-zinc-400">
          {slice.count} {pluralizeRu(slice.count, 'операция', 'операции', 'операций')}
        </span>
      </div>
    </div>
  );
}

function CategoryCompactRow({ slice, color }: { slice: FinanceCategorySlice; color: string }) {
  return (
    <div className="flex items-center gap-2 py-0.5 text-xs">
      <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: color }} />
      <span className="min-w-0 flex-1 truncate text-zinc-700">{slice.name}</span>
      <span className="shrink-0 font-mono tabular-nums text-zinc-800">
        {financeMoney(slice.amountBase, 'BYN')}
      </span>
      <span className="w-10 shrink-0 text-right text-zinc-500">{formatShare(slice.percent)}</span>
    </div>
  );
}

export function FinanceCategoriesBlock({
  categories,
  colorById,
  periodLabel,
  onAddExpense,
}: {
  categories: readonly FinanceCategoryTotal[];
  colorById: ReadonlyMap<string, string | null>;
  periodLabel: string;
  onAddExpense: () => void;
}) {
  const sections = buildCategorySections(categories);
  const primary = sections[0];
  const secondary = sections[1];

  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <CardTitle>Категории периода</CardTitle>
          <CardDescription>{periodLabel}</CardDescription>
        </div>
        {primary ? (
          <Badge tone={primary.kind === 'expense' ? 'danger' : 'success'}>
            {primary.slices.length}{' '}
            {pluralizeRu(primary.slices.length, 'категория', 'категории', 'категорий')}
          </Badge>
        ) : null}
      </div>

      {!primary ? (
        <div className="mt-4 rounded-xl border border-dashed border-emerald-200 bg-emerald-50/40 px-4 py-7 text-center">
          <div className="mx-auto flex w-fit items-end gap-1.5">
            <span className="h-5 w-2 rounded-full bg-emerald-300" />
            <span className="h-8 w-2 rounded-full bg-sky-300" />
            <span className="h-6 w-2 rounded-full bg-amber-300" />
            <span className="h-10 w-2 rounded-full bg-violet-300" />
          </div>
          <p className="mt-3 text-sm font-medium text-zinc-700">За период пока нет категорий</p>
          <p className="mx-auto mt-1 max-w-xs text-xs text-zinc-500">
            Добавьте доход или расход — здесь появится структура с суммами и долями.
          </p>
          <Button variant="secondary" className="mt-3 h-8 px-3 text-xs" onClick={onAddExpense}>
            + Расход
          </Button>
        </div>
      ) : (
        <div className="mt-4 space-y-4">
          <div className="grid items-center gap-4 sm:grid-cols-[176px_1fr]">
            <CategoryDonut
              section={primary}
              colors={primary.slices.map((slice, index) => categoryColor(slice, index, colorById))}
            />
            <div className="space-y-3">
              {primary.slices.map((slice, index) => (
                <CategoryLegendRow
                  key={slice.key}
                  slice={slice}
                  color={categoryColor(slice, index, colorById)}
                />
              ))}
            </div>
          </div>

          {secondary ? (
            <div className="rounded-xl border border-zinc-200/80 bg-zinc-50/70 p-3">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span
                    className="h-2.5 w-2.5 rounded-full"
                    style={{ backgroundColor: categoryColor(secondary.slices[0]!, 0, colorById) }}
                  />
                  <span className="text-xs font-medium text-zinc-600">{secondary.label}</span>
                </div>
                <span className="font-mono text-sm font-semibold tabular-nums text-zinc-900">
                  {financeMoney(secondary.totalBase, 'BYN')}
                </span>
              </div>
              <div className="mt-2 grid gap-x-4 gap-y-1 sm:grid-cols-2">
                {secondary.slices.map((slice, index) => (
                  <CategoryCompactRow
                    key={slice.key}
                    slice={slice}
                    color={categoryColor(slice, index, colorById)}
                  />
                ))}
              </div>
            </div>
          ) : null}
        </div>
      )}
    </Card>
  );
}

const compactNumber = new Intl.NumberFormat('ru-RU', {
  notation: 'compact',
  maximumFractionDigits: 1,
});

function MonthlyFlowTable({ months }: { months: readonly FinanceMonthTotal[] }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-zinc-200">
      <table className="w-full min-w-[360px] text-sm">
        <thead>
          <tr className="border-b border-zinc-200 bg-zinc-50/70 text-left text-[11px] text-zinc-500">
            <th className="px-3 py-2 font-medium">Месяц</th>
            <th className="px-3 py-2 text-right font-medium">Доходы</th>
            <th className="px-3 py-2 text-right font-medium">Расходы</th>
            <th className="px-3 py-2 text-right font-medium">Сальдо</th>
          </tr>
        </thead>
        <tbody>
          {months.map((row) => (
            <tr key={row.month} className="border-b border-zinc-100 last:border-0">
              <td className="px-3 py-2 capitalize text-zinc-700">{monthShortLabel(row.month)}</td>
              <td className="px-3 py-2 text-right font-mono text-emerald-700">
                {financeMoney(row.incomeBase, 'BYN')}
              </td>
              <td className="px-3 py-2 text-right font-mono text-rose-700">
                {financeMoney(row.expenseBase, 'BYN')}
              </td>
              <td
                className={`px-3 py-2 text-right font-mono ${
                  Number(row.netBase) >= 0 ? 'text-emerald-700' : 'text-rose-700'
                }`}
              >
                {financeMoney(row.netBase, 'BYN')}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function compactByn(value: number): string {
  if (!Number.isFinite(value) || value === 0) return '0 Br';
  return `${compactNumber.format(value)} Br`;
}

function signedCompactByn(value: number): string {
  if (!Number.isFinite(value) || value === 0) return '0 Br';
  return `${value > 0 ? '+' : '−'}${compactByn(Math.abs(value))}`;
}

function niceCeil(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const normalized = value / magnitude;
  const step = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
  return step * magnitude;
}

function MonthlyFlowChart({ months }: { months: readonly FinanceMonthTotal[] }) {
  const [hovered, setHovered] = useState<number | null>(null);
  const gradientId = useId().replace(/:/g, '');
  const width = 860;
  const height = 300;
  const padding = { top: 20, right: 16, bottom: 54, left: 64 };
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;
  const values = months.flatMap((month) => [Number(month.incomeBase), Number(month.expenseBase)]);
  const max = niceCeil(Math.max(1, ...values.filter(Number.isFinite)));
  const slot = plotWidth / Math.max(months.length, 1);
  const barWidth = Math.min(22, Math.max(8, slot * 0.26));
  const zeroY = padding.top + plotHeight;
  const y = (value: number) => padding.top + ((max - value) / max) * plotHeight;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((share) => share * max);
  const hoveredMonth = hovered === null ? null : months[hovered];

  return (
    <div className="relative">
      <div className="mb-2 flex min-h-[34px] flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-3 text-[11px] text-zinc-500">
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-emerald-500" />
            доходы
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-rose-500" />
            расходы
          </span>
        </div>
        {hoveredMonth ? (
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border border-zinc-200 bg-white px-2.5 py-1 text-xs shadow-sm">
            <span className="font-medium capitalize text-zinc-700">
              {monthLabel(hoveredMonth.month)}
            </span>
            <span className="text-zinc-400">·</span>
            <span className="text-zinc-500">доход</span>
            <span className="font-mono text-emerald-700">
              {financeMoney(hoveredMonth.incomeBase, 'BYN')}
            </span>
            <span className="text-zinc-400">·</span>
            <span className="text-zinc-500">расход</span>
            <span className="font-mono text-rose-700">
              {financeMoney(hoveredMonth.expenseBase, 'BYN')}
            </span>
            <span className="text-zinc-400">·</span>
            <span className="text-zinc-500">сальдо</span>
            <span
              className={`font-mono ${
                Number(hoveredMonth.netBase) >= 0 ? 'text-emerald-700' : 'text-rose-700'
              }`}
            >
              {formatByn(hoveredMonth.netBase)}
            </span>
          </div>
        ) : (
          <span className="text-[11px] text-zinc-400">Наведите на месяц, чтобы увидеть детали</span>
        )}
      </div>

      <div className="overflow-x-auto">
        <div className="min-w-[680px]">
          <svg
            viewBox={`0 0 ${width} ${height}`}
            className="h-auto w-full"
            role="img"
            aria-label="Доходы, расходы и сальдо по месяцам"
            onMouseLeave={() => setHovered(null)}
          >
            <defs>
              <linearGradient id={`${gradientId}-income`} x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%" stopColor="#10b981" stopOpacity="0.95" />
                <stop offset="100%" stopColor="#6ee7b7" stopOpacity="0.45" />
              </linearGradient>
              <linearGradient id={`${gradientId}-expense`} x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%" stopColor="#fb7185" stopOpacity="0.55" />
                <stop offset="100%" stopColor="#e11d48" stopOpacity="0.9" />
              </linearGradient>
            </defs>

            {ticks.map((tick) => (
              <g key={tick}>
                <line
                  x1={padding.left}
                  x2={width - padding.right}
                  y1={y(tick)}
                  y2={y(tick)}
                  stroke="var(--border)"
                  strokeDasharray="3 5"
                  strokeWidth="1"
                />
                <text
                  x={padding.left - 10}
                  y={y(tick) + 3}
                  textAnchor="end"
                  fontSize="10"
                  fill="var(--text-soft)"
                >
                  {compactByn(tick)}
                </text>
              </g>
            ))}

            <line
              x1={padding.left}
              x2={width - padding.right}
              y1={zeroY}
              y2={zeroY}
              stroke="var(--text-soft)"
              strokeOpacity="0.55"
              strokeWidth="1"
            />

            {months.map((month, index) => {
              const center = padding.left + slot * (index + 0.5);
              const income = Number(month.incomeBase);
              const expense = Number(month.expenseBase);
              const net = Number(month.netBase);
              const incomeY = y(Number.isFinite(income) ? income : 0);
              const expenseY = y(Number.isFinite(expense) ? expense : 0);
              const incomeHeight = Math.max(income > 0 ? 2 : 0, zeroY - incomeY);
              const expenseHeight = Math.max(expense > 0 ? 2 : 0, zeroY - expenseY);
              const active = hovered === index;

              return (
                <g
                  key={month.month}
                  onMouseEnter={() => setHovered(index)}
                  onFocus={() => setHovered(index)}
                  tabIndex={0}
                  role="button"
                  aria-label={`${monthLabel(month.month)}: доходы ${financeMoney(
                    month.incomeBase,
                    'BYN',
                  )}, расходы ${financeMoney(month.expenseBase, 'BYN')}, сальдо ${formatByn(
                    month.netBase,
                  )}`}
                  className="outline-none"
                >
                  {active ? (
                    <rect
                      x={center - slot / 2 + 3}
                      y={padding.top}
                      width={Math.max(slot - 6, 1)}
                      height={plotHeight}
                      rx="8"
                      fill="var(--surface-hover)"
                      opacity="0.45"
                    />
                  ) : null}
                  <rect
                    x={center - barWidth - 1.5}
                    y={incomeY}
                    width={barWidth}
                    height={incomeHeight}
                    rx="4"
                    fill={`url(#${gradientId}-income)`}
                    opacity={hovered === null || active ? 1 : 0.55}
                  />
                  <rect
                    x={center + 1.5}
                    y={expenseY}
                    width={barWidth}
                    height={expenseHeight}
                    rx="4"
                    fill={`url(#${gradientId}-expense)`}
                    opacity={hovered === null || active ? 1 : 0.55}
                  />
                  <text
                    x={center}
                    y={height - 34}
                    textAnchor="middle"
                    fontSize="10"
                    fill="var(--text-soft)"
                  >
                    {monthShortLabel(month.month)}
                  </text>
                  <text
                    x={center}
                    y={height - 18}
                    textAnchor="middle"
                    fontSize="9"
                    fill={net >= 0 ? '#047857' : '#be123c'}
                  >
                    {signedCompactByn(net)}
                  </text>
                </g>
              );
            })}
          </svg>
        </div>
      </div>
    </div>
  );
}

export function FinanceMonthsBlock({ months }: { months: readonly FinanceMonthTotal[] }) {
  const totals = summarizeMonths(months);
  const hasMovement = hasMonthlyMovement(months);
  const positiveNet = Number(totals.netBase) >= 0;

  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <CardTitle>Последние 12 месяцев</CardTitle>
          <CardDescription>
            Доходы, расходы (включая погашение кредита) и сальдо в BYN.
          </CardDescription>
        </div>
        <Badge tone="info">12 месяцев</Badge>
      </div>

      <div className="mt-4 grid gap-2 sm:grid-cols-3">
        <div className="tone-surface tone-surface-emerald rounded-xl border p-3">
          <div className="text-[11px] text-zinc-600">Доходы</div>
          <div className="mt-0.5 font-mono text-lg font-semibold tabular-nums text-emerald-800">
            {financeMoney(totals.incomeBase, 'BYN')}
          </div>
        </div>
        <div className="tone-surface tone-surface-rose rounded-xl border p-3">
          <div className="text-[11px] text-zinc-600">Расходы</div>
          <div className="mt-0.5 font-mono text-lg font-semibold tabular-nums text-rose-700">
            {financeMoney(totals.expenseBase, 'BYN')}
          </div>
        </div>
        <div className="tone-surface tone-surface-sky rounded-xl border p-3">
          <div className="text-[11px] text-zinc-600">Сальдо</div>
          <div
            className={`mt-0.5 font-mono text-lg font-semibold tabular-nums ${
              positiveNet ? 'text-emerald-700' : 'text-rose-700'
            }`}
          >
            {financeMoney(totals.netBase, 'BYN')}
          </div>
        </div>
      </div>

      {hasMovement ? (
        <div className="mt-4 grid gap-4 xl:grid-cols-[1.35fr_0.65fr]">
          <MonthlyFlowChart months={months} />
          <MonthlyFlowTable months={months} />
        </div>
      ) : (
        <div className="mt-4 rounded-xl border border-dashed border-zinc-200 bg-zinc-50/70 px-4 py-8 text-center">
          <div className="mx-auto flex h-10 w-fit items-end gap-1.5">
            <span className="h-4 w-2 rounded-full bg-emerald-200" />
            <span className="h-9 w-2 rounded-full bg-sky-200" />
            <span className="h-6 w-2 rounded-full bg-amber-200" />
            <span className="h-10 w-2 rounded-full bg-violet-200" />
          </div>
          <p className="mt-3 text-sm font-medium text-zinc-700">
            За последние 12 месяцев нет движения
          </p>
          <p className="mx-auto mt-1 max-w-sm text-xs text-zinc-500">
            Как только появятся доходы или расходы, здесь появится динамика по месяцам.
          </p>
        </div>
      )}
    </Card>
  );
}

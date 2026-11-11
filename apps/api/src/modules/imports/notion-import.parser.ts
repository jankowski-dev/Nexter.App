import { createHash } from 'node:crypto';
import type { ImportSummary, ImportTotals } from '@nexter/contracts';
import { Decimal, amountString, decimal, usdString } from '../../shared/money/decimal';

export type NotionOrderStatus = 'open' | 'closed' | 'for_sale' | 'reserve';

export interface NormalizedSource {
  sourceId: string;
  symbol: string;
  name: string;
  coingeckoId: string | null;
  description: string | null;
  priceUsd: string | null;
  isStablecoin: boolean;
  raw: Record<string, unknown>;
}

export interface NormalizedOrder {
  sourceId: string;
  orderId: string;
  status: NotionOrderStatus;
  openedAt: string;
  closedAt: string | null;
  sourceSymbol: string;
  destinationSymbol: string;
  sourceAmount: string;
  destinationAmount: string;
  saleRate: string | null;
  buyUsd: string;
  buyUsdFull: string;
  sellUsd: string;
  sellUsdFull: string;
  realizedPnlUsd: string;
  realizedPnlUsdFull: string;
  raw: Record<string, unknown>;
}

export interface NormalizedTransaction {
  sourceId: string;
  type: 'deposit' | 'withdrawal';
  occurredAt: string;
  amountUsd: string;
  accountSymbol: string;
  notes: string | null;
  raw: Record<string, unknown>;
}

export interface ParsedNotionImport {
  source: NormalizedSource[];
  orders: NormalizedOrder[];
  transactions: NormalizedTransaction[];
  summary: ImportSummary;
}

export interface ParseResult {
  parsed: ParsedNotionImport;
  errors: string[];
  warnings: string[];
}

/**
 * The accounting control snapshot was taken before orders 465/466 were opened
 * and before orders 450/463 were closed. These are a one-time migration
 * fingerprint: the 431-row import must reproduce the 429-row snapshot when
 * these four known differences are removed.
 */
const CONTROL_ADDED_ORDER_IDS = ['465', '466'] as const;
const CONTROL_CLOSED_AFTER_SNAPSHOT_ORDER_IDS = ['450', '463'] as const;
const CONTROL_AS_OF = '2026-10-31T23:59:59.999Z';
const CONTROL_LEGACY_MAX_ORDER_ID = 466;
const CONTROL_TOLERANCE_USD = '0.01';

const CONTROL_EXPECTED: ImportTotals = {
  orders: 429,
  closedOrders: 410,
  activeOrders: 19,
  depositsUsd: '2519.80',
  withdrawalsUsd: '57.00',
  buyUsd: '54955.30',
  sellUsd: '52508.0139345416',
  realizedPnlUsd: '69.81393454159962',
  cashUsd: '15.513934541602794',
  activeCostUsd: '2517.10',
};

/**
 * Phase 3 valuation metrics were calculated at the audit-time Source prices.
 * The current export contains current `Курс [1]` values, so these numbers are
 * shown for context but are not used for commit gating.
 */
const CONTROL_VALUATION = {
  activeCostUsd: '2517.10',
  activeValueUsd: '2060.42365438',
  unrealizedPnlUsd: '-456.67634561999995',
  equityUsd: '2075.937588921603',
  totalPnlUsd: '-386.86241107839714',
  note: 'Phase 3 snapshot valuation at audit-time prices; current Source prices are expected to differ.',
} as const;

const DECIMAL_PATTERN = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d{1,3})?$/;
const MAX_DECIMAL_EXPONENT = 30;
const MAX_DECIMAL_LENGTH = 80;
const MAX_TEXT_LENGTH = 5000;
const MAX_ID_LENGTH = 200;
const MAX_MESSAGES = 200;

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function text(row: Record<string, unknown>, key: string): string | null {
  const value = row[key];

  if (typeof value !== 'string') return null;

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed.slice(0, MAX_TEXT_LENGTH) : null;
}

function number(row: Record<string, unknown>, key: string): string | null {
  const value = row[key];
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);

  if (typeof value === 'string') {
    const trimmed = value.trim();

    if (
      trimmed.length === 0 ||
      trimmed.length > MAX_DECIMAL_LENGTH ||
      !DECIMAL_PATTERN.test(trimmed)
    ) {
      return null;
    }

    const exponent = /[eE]([+-]?\d+)/.exec(trimmed)?.[1];

    if (exponent && Math.abs(Number(exponent)) > MAX_DECIMAL_EXPONENT) {
      return null;
    }

    try {
      return new Decimal(trimmed).toFixed();
    } catch {
      return null;
    }
  }

  return null;
}

function idValue(value: unknown): string | null {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length > 0 && trimmed.length <= MAX_ID_LENGTH ? trimmed : null;
  }

  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return null;
}

function notionId(value: string): string | null {
  const match = value.match(/([0-9a-f]{32})/i);
  return match?.[1]?.toLowerCase() ?? null;
}

function relationIds(row: Record<string, unknown>, key: string): string[] {
  const value = row[key];
  let values: unknown[] = [];

  if (Array.isArray(value)) values = value;
  else if (typeof value === 'string') {
    try {
      const parsed: unknown = JSON.parse(value);
      values = Array.isArray(parsed) ? parsed : [parsed];
    } catch {
      values = [value];
    }
  }

  return values
    .filter((item): item is string => typeof item === 'string')
    .map((item) => notionId(item))
    .filter((item): item is string => Boolean(item));
}

function iso(value: string | null, endOfDay = false, capAtNow = false): string | null {
  if (!value) return null;

  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(value);
  let parsed = new Date(dateOnly && endOfDay ? `${value}T23:59:59.999Z` : value);

  if (Number.isNaN(parsed.getTime())) return null;
  if (capAtNow && parsed.getTime() > Date.now()) parsed = new Date();

  return parsed.toISOString();
}

function mapStatus(value: string | null): NotionOrderStatus | null {
  switch (value) {
    case 'Активна':
      return 'open';
    case 'Закрыта':
      return 'closed';
    case 'В продажу':
      return 'for_sale';
    case 'Резерв':
      return 'reserve';
    default:
      return null;
  }
}

function fullString(value: Decimal): string {
  return value.toFixed();
}

function capMessages(messages: string[]): string[] {
  if (messages.length <= MAX_MESSAGES) return messages;

  return [...messages.slice(0, MAX_MESSAGES), `... and ${messages.length - MAX_MESSAGES} more`];
}

function sum(values: Iterable<Decimal>): Decimal {
  let total = new Decimal(0);
  for (const value of values) total = total.plus(value);
  return total;
}

function difference(actual: Decimal, expected: string): string {
  return fullString(actual.minus(decimal(expected)));
}

function countDifference(actual: number, expected: number): number {
  return actual - expected;
}

function compareUsd(actual: Decimal, expected: string): boolean {
  return actual.minus(decimal(expected)).abs().lte(decimal(CONTROL_TOLERANCE_USD));
}

function buildTotals(input: {
  orders: NormalizedOrder[];
  transactions: NormalizedTransaction[];
  closedOrderIds?: Set<string>;
  asOf?: string;
}): ImportTotals {
  const asOf = input.asOf ? new Date(input.asOf) : null;
  const includedOrders = input.orders.filter(
    (order) => !asOf || new Date(order.openedAt).getTime() <= asOf.getTime(),
  );
  const includedTransactions = input.transactions.filter(
    (transaction) => !asOf || new Date(transaction.occurredAt).getTime() <= asOf.getTime(),
  );
  const closed = includedOrders.filter((order) => {
    if (input.closedOrderIds) return input.closedOrderIds.has(order.orderId);
    return order.status === 'closed';
  });
  const closedIds = new Set(closed.map((order) => order.orderId));
  const activeOrders = includedOrders.filter((order) => !closedIds.has(order.orderId));
  const buy = sum(includedOrders.map((order) => decimal(order.buyUsdFull)));
  const sell = sum(closed.map((order) => decimal(order.sellUsdFull)));
  const realized = sum(closed.map((order) => decimal(order.realizedPnlUsdFull)));
  const activeCost = sum(activeOrders.map((order) => decimal(order.buyUsdFull)));
  const deposits = sum(
    includedTransactions
      .filter((transaction) => transaction.type === 'deposit')
      .map((transaction) => decimal(transaction.amountUsd)),
  );
  const withdrawals = sum(
    includedTransactions
      .filter((transaction) => transaction.type === 'withdrawal')
      .map((transaction) => decimal(transaction.amountUsd)),
  );

  return {
    orders: includedOrders.length,
    closedOrders: closed.length,
    activeOrders: includedOrders.length - closed.length,
    depositsUsd: fullString(deposits),
    withdrawalsUsd: fullString(withdrawals),
    buyUsd: fullString(buy),
    sellUsd: fullString(sell),
    realizedPnlUsd: fullString(realized),
    cashUsd: fullString(deposits.minus(withdrawals).minus(buy).plus(sell)),
    activeCostUsd: fullString(activeCost),
  };
}

function buildControl(input: {
  orders: NormalizedOrder[];
  transactions: NormalizedTransaction[];
  totals: ImportTotals;
}): {
  applicable: boolean;
  matches: boolean;
  toleranceUsd: string;
  expected: ImportTotals;
  baseline: ImportTotals;
  deltas: ImportTotals;
  adjustments: { addedOrderIds: string[]; closedAfterSnapshotOrderIds: string[] };
} {
  const orderById = new Map(input.orders.map((order) => [order.orderId, order]));
  const added = CONTROL_ADDED_ORDER_IDS.filter((id) => orderById.has(id));
  const closedAfterSnapshot = CONTROL_CLOSED_AFTER_SNAPSHOT_ORDER_IDS.filter((id) => {
    const order = orderById.get(id);
    return order?.status === 'closed';
  });
  const withinLegacyRange = input.orders.every(
    (order) => /^\d+$/.test(order.orderId) && Number(order.orderId) <= CONTROL_LEGACY_MAX_ORDER_ID,
  );
  const applicable =
    withinLegacyRange &&
    added.length === CONTROL_ADDED_ORDER_IDS.length &&
    closedAfterSnapshot.length === CONTROL_CLOSED_AFTER_SNAPSHOT_ORDER_IDS.length;

  const addedSet = new Set<string>(CONTROL_ADDED_ORDER_IDS);
  const closedAfterSet = new Set<string>(CONTROL_CLOSED_AFTER_SNAPSHOT_ORDER_IDS);
  const baselineOrders = input.orders.filter((order) => !addedSet.has(order.orderId));
  const baselineClosedIds = new Set(
    baselineOrders
      .filter((order) => order.status === 'closed' && !closedAfterSet.has(order.orderId))
      .map((order) => order.orderId),
  );
  const baseline = buildTotals({
    orders: baselineOrders,
    transactions: input.transactions,
    closedOrderIds: baselineClosedIds,
    asOf: CONTROL_AS_OF,
  });

  const deltas: ImportTotals = {
    orders: countDifference(baseline.orders, CONTROL_EXPECTED.orders),
    closedOrders: countDifference(baseline.closedOrders, CONTROL_EXPECTED.closedOrders),
    activeOrders: countDifference(baseline.activeOrders, CONTROL_EXPECTED.activeOrders),
    depositsUsd: difference(decimal(baseline.depositsUsd), CONTROL_EXPECTED.depositsUsd),
    withdrawalsUsd: difference(decimal(baseline.withdrawalsUsd), CONTROL_EXPECTED.withdrawalsUsd),
    buyUsd: difference(decimal(baseline.buyUsd), CONTROL_EXPECTED.buyUsd),
    sellUsd: difference(decimal(baseline.sellUsd), CONTROL_EXPECTED.sellUsd),
    realizedPnlUsd: difference(decimal(baseline.realizedPnlUsd), CONTROL_EXPECTED.realizedPnlUsd),
    cashUsd: difference(decimal(baseline.cashUsd), CONTROL_EXPECTED.cashUsd),
    activeCostUsd: difference(decimal(baseline.activeCostUsd), CONTROL_EXPECTED.activeCostUsd),
  };

  const matches =
    applicable &&
    deltas.orders === 0 &&
    deltas.closedOrders === 0 &&
    deltas.activeOrders === 0 &&
    compareUsd(decimal(baseline.depositsUsd), CONTROL_EXPECTED.depositsUsd) &&
    compareUsd(decimal(baseline.withdrawalsUsd), CONTROL_EXPECTED.withdrawalsUsd) &&
    compareUsd(decimal(baseline.buyUsd), CONTROL_EXPECTED.buyUsd) &&
    compareUsd(decimal(baseline.sellUsd), CONTROL_EXPECTED.sellUsd) &&
    compareUsd(decimal(baseline.realizedPnlUsd), CONTROL_EXPECTED.realizedPnlUsd) &&
    compareUsd(decimal(baseline.cashUsd), CONTROL_EXPECTED.cashUsd) &&
    compareUsd(decimal(baseline.activeCostUsd), CONTROL_EXPECTED.activeCostUsd);

  return {
    applicable,
    matches,
    toleranceUsd: CONTROL_TOLERANCE_USD,
    expected: CONTROL_EXPECTED,
    baseline,
    deltas,
    adjustments: {
      addedOrderIds: [...CONTROL_ADDED_ORDER_IDS],
      closedAfterSnapshotOrderIds: [...CONTROL_CLOSED_AFTER_SNAPSHOT_ORDER_IDS],
    },
  };
}

function currentDeltas(totals: ImportTotals): ImportTotals {
  return {
    orders: countDifference(totals.orders, CONTROL_EXPECTED.orders),
    closedOrders: countDifference(totals.closedOrders, CONTROL_EXPECTED.closedOrders),
    activeOrders: countDifference(totals.activeOrders, CONTROL_EXPECTED.activeOrders),
    depositsUsd: difference(decimal(totals.depositsUsd), CONTROL_EXPECTED.depositsUsd),
    withdrawalsUsd: difference(decimal(totals.withdrawalsUsd), CONTROL_EXPECTED.withdrawalsUsd),
    buyUsd: difference(decimal(totals.buyUsd), CONTROL_EXPECTED.buyUsd),
    sellUsd: difference(decimal(totals.sellUsd), CONTROL_EXPECTED.sellUsd),
    realizedPnlUsd: difference(decimal(totals.realizedPnlUsd), CONTROL_EXPECTED.realizedPnlUsd),
    cashUsd: difference(decimal(totals.cashUsd), CONTROL_EXPECTED.cashUsd),
    activeCostUsd: difference(decimal(totals.activeCostUsd), CONTROL_EXPECTED.activeCostUsd),
  };
}

function buildValuation(input: {
  source: NormalizedSource[];
  orders: NormalizedOrder[];
  totals: ImportTotals;
}): ImportSummary['valuation'] {
  const priceBySymbol = new Map<string, Decimal | null>(
    input.source.map((row) => [row.symbol, row.priceUsd ? decimal(row.priceUsd) : null]),
  );
  const amountBySymbol = new Map<string, Decimal>();
  const costBySymbol = new Map<string, Decimal>();

  for (const order of input.orders) {
    if (order.status === 'closed') continue;

    amountBySymbol.set(
      order.destinationSymbol,
      (amountBySymbol.get(order.destinationSymbol) ?? new Decimal(0)).plus(
        decimal(order.destinationAmount),
      ),
    );
    costBySymbol.set(
      order.destinationSymbol,
      (costBySymbol.get(order.destinationSymbol) ?? new Decimal(0)).plus(decimal(order.buyUsd)),
    );
  }

  let activeValue = new Decimal(0);
  let pricedCost = new Decimal(0);
  const missingPrices: string[] = [];

  for (const [symbol, amount] of amountBySymbol) {
    const price = priceBySymbol.get(symbol);

    if (price === null || price === undefined) {
      missingPrices.push(symbol);
      continue;
    }

    activeValue = activeValue.plus(decimal(usdString(amount.mul(price))));
    pricedCost = pricedCost.plus(decimal(usdString(costBySymbol.get(symbol) ?? new Decimal(0))));
  }

  const unrealized = activeValue.minus(pricedCost);
  const realized = decimal(usdString(decimal(input.totals.realizedPnlUsd)));
  const cash = decimal(usdString(decimal(input.totals.cashUsd)));

  return {
    priceSource: 'notion:Курс [1]',
    activeCostUsd: input.totals.activeCostUsd,
    activeValueUsd: fullString(activeValue),
    unrealizedPnlUsd: fullString(unrealized),
    realizedPnlUsd: fullString(realized),
    cashUsd: fullString(cash),
    equityUsd: fullString(cash.plus(activeValue)),
    totalPnlUsd: fullString(realized.plus(unrealized)),
    missingPrices,
    controlSnapshot: { ...CONTROL_VALUATION },
  };
}

export function parseNotionExport(input: {
  source: unknown[];
  orders: unknown[];
  transactions: unknown[];
}): ParseResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const sourceRows = input.source.map(record);
  const sourceById = new Map<string, Record<string, unknown>>();
  const seenSourceIds = new Set<string>();
  const seenSymbols = new Set<string>();

  const source: NormalizedSource[] = sourceRows.map((row, index) => {
    const url = text(row, 'url');
    const sourceId = url ? notionId(url) : null;
    const symbol = text(row, 'Название') ?? text(row, 'Символ [P]');
    const coingeckoId = text(row, 'Символ [P]');
    const price = number(row, 'Курс [1]');
    const description = text(row, 'Описание');
    const name = symbol ?? `Notion asset ${index + 1}`;

    if (!sourceId) errors.push(`Source row ${index + 1}: missing Notion page id`);
    if (!symbol) errors.push(`Source row ${index + 1}: missing symbol`);
    if (sourceId && seenSourceIds.has(sourceId)) {
      errors.push(`Source row ${index + 1}: duplicate Notion page id ${sourceId}`);
    }
    if (symbol && seenSymbols.has(symbol.toUpperCase())) {
      warnings.push(`Source row ${index + 1}: duplicate symbol ${symbol}`);
    }

    if (sourceId) {
      sourceById.set(sourceId, row);
      seenSourceIds.add(sourceId);
    }
    if (symbol) seenSymbols.add(symbol.toUpperCase());

    return {
      sourceId: sourceId ?? `missing-source-${index}`,
      symbol: symbol ?? `UNKNOWN_${index}`,
      name,
      coingeckoId,
      description,
      priceUsd: price && decimal(price).gt(0) ? usdString(decimal(price)) : null,
      isStablecoin: ['USDT', 'USDC'].includes((symbol ?? '').toUpperCase()),
      raw: row,
    };
  });

  const orders: NormalizedOrder[] = [];
  const seenOrderIds = new Set<string>();
  const seenOrderSourceIds = new Set<string>();

  input.orders.map(record).forEach((row, index) => {
    const orderId = idValue(row['userDefined:ID']);
    const status = mapStatus(text(row, 'Статус'));
    const openedAt = iso(text(row, 'date:Открытие:start'));
    const closedAt = iso(text(row, 'date:Закрытие:start'), true, true);
    const sourceIds = relationIds(row, 'Счет источника');
    const destinationIds = relationIds(row, 'Счет назначения');
    const sourceSymbol = sourceIds[0] ? text(sourceById.get(sourceIds[0]) ?? {}, 'Название') : null;
    const destinationSymbol = destinationIds[0]
      ? text(sourceById.get(destinationIds[0]) ?? {}, 'Название')
      : null;
    const sourceAmountValue = number(row, 'Сумма-источника [1]');
    const destinationAmountValue = number(row, 'Сумма-назначения');
    const saleRateValue = number(row, 'Фактический курс [2]');
    const url = text(row, 'url');
    const label = orderId ? `Order ${orderId}` : `Order row ${index + 1}`;

    if (!orderId) {
      errors.push(`${label}: missing userDefined:ID`);
      return;
    }
    if (seenOrderIds.has(orderId)) {
      errors.push(`${label}: duplicate order id`);
      return;
    }
    seenOrderIds.add(orderId);

    const orderSourceId = url ? (notionId(url) ?? `order-${orderId}`) : `order-${orderId}`;
    if (seenOrderSourceIds.has(orderSourceId)) {
      errors.push(`${label}: duplicate Notion page id ${orderSourceId}`);
      return;
    }
    seenOrderSourceIds.add(orderSourceId);

    if (!status) {
      errors.push(`${label}: unsupported status "${text(row, 'Статус') ?? ''}"`);
      return;
    }
    if (!openedAt) {
      errors.push(`${label}: missing open date`);
      return;
    }
    if (sourceIds.length !== 1) {
      errors.push(`${label}: expected exactly one source account, got ${sourceIds.length}`);
      return;
    }
    if (destinationIds.length !== 1) {
      errors.push(
        `${label}: expected exactly one destination account, got ${destinationIds.length}`,
      );
      return;
    }
    if (sourceSymbol?.toUpperCase() !== 'USDT') {
      errors.push(`${label}: unsupported source asset ${sourceSymbol ?? 'unknown'}`);
      return;
    }
    if (!destinationSymbol) {
      errors.push(`${label}: destination asset is not present in Source`);
      return;
    }
    if (['USDT', 'USDC'].includes(destinationSymbol.toUpperCase())) {
      errors.push(`${label}: destination asset must not be a cash equivalent`);
      return;
    }
    if (!sourceAmountValue || !destinationAmountValue) {
      errors.push(`${label}: missing source/destination amount`);
      return;
    }

    const sourceAmount = decimal(sourceAmountValue);
    const destinationAmount = decimal(destinationAmountValue);

    if (sourceAmount.lte(0) || destinationAmount.lte(0)) {
      errors.push(`${label}: amounts must be positive`);
      return;
    }
    if (destinationAmount.decimalPlaces() > 18) {
      errors.push(`${label}: destination amount supports at most 18 decimal places`);
      return;
    }
    if (sourceAmount.decimalPlaces() > 8) {
      errors.push(`${label}: source USD amount supports at most 8 decimal places`);
      return;
    }

    let sellUsdFull = new Decimal(0);
    let realizedFull = new Decimal(0);

    if (status === 'closed') {
      if (!saleRateValue) {
        errors.push(`${label}: closed order has no sale rate`);
        return;
      }
      if (!closedAt) {
        errors.push(`${label}: closed order has no close date`);
        return;
      }
      if (new Date(closedAt).getTime() < new Date(openedAt).getTime()) {
        errors.push(`${label}: close date is before open date`);
        return;
      }

      const saleRate = decimal(saleRateValue);
      if (saleRate.lte(0)) {
        errors.push(`${label}: sale rate must be positive`);
        return;
      }

      sellUsdFull = destinationAmount.mul(saleRate);
      realizedFull = sellUsdFull.minus(sourceAmount);
    } else if (closedAt) {
      warnings.push(`${label}: non-closed order has a close date; it will be ignored`);
    }

    orders.push({
      sourceId: orderSourceId,
      orderId,
      status,
      openedAt,
      closedAt: status === 'closed' ? closedAt : null,
      sourceSymbol: sourceSymbol ?? 'USDT',
      destinationSymbol,
      sourceAmount: amountString(sourceAmount),
      destinationAmount: amountString(destinationAmount),
      saleRate: status === 'closed' && saleRateValue ? usdString(decimal(saleRateValue)) : null,
      buyUsd: usdString(sourceAmount),
      buyUsdFull: fullString(sourceAmount),
      sellUsd: usdString(sellUsdFull),
      sellUsdFull: fullString(sellUsdFull),
      realizedPnlUsd: usdString(realizedFull),
      realizedPnlUsdFull: fullString(realizedFull),
      raw: row,
    });
  });

  const transactions: NormalizedTransaction[] = [];
  const seenTransactionIds = new Set<string>();

  input.transactions.map(record).forEach((row, index) => {
    const typeLabel = text(row, 'Тип транзакции');
    const type = typeLabel === 'Ввод' ? 'deposit' : typeLabel === 'Вывод' ? 'withdrawal' : null;
    const occurredAt = iso(text(row, 'date:Дата операции:start'));
    const url = text(row, 'url');
    const sourceId = url ? notionId(url) : null;
    const accountIds = relationIds(row, 'Счет');
    const accountSymbol = accountIds[0]
      ? text(sourceById.get(accountIds[0]) ?? {}, 'Название')
      : null;
    const amountValue =
      type === 'deposit'
        ? number(row, 'Сумма пополнения')
        : type === 'withdrawal'
          ? number(row, 'Сумма вывода')
          : null;
    const notes = text(row, 'Комментарий');
    const label = `Transaction row ${index + 1}`;

    if (!type || !occurredAt || !sourceId || !amountValue) {
      errors.push(`${label}: invalid type/date/amount/page id`);
      return;
    }
    if (seenTransactionIds.has(sourceId)) {
      errors.push(`${label}: duplicate Notion page id ${sourceId}`);
      return;
    }
    if (accountIds.length !== 1) {
      errors.push(`${label}: expected exactly one account, got ${accountIds.length}`);
      return;
    }
    if (accountSymbol?.toUpperCase() !== 'USDT') {
      errors.push(`${label}: unsupported account asset ${accountSymbol ?? 'unknown'}`);
      return;
    }

    const amount = decimal(amountValue);
    if (amount.lt(0)) {
      errors.push(`${label}: amount must not be negative`);
      return;
    }
    if (amount.decimalPlaces() > 8) {
      errors.push(`${label}: amount supports at most 8 decimal places`);
      return;
    }

    seenTransactionIds.add(sourceId);
    transactions.push({
      sourceId,
      type,
      occurredAt,
      amountUsd: fullString(amount),
      accountSymbol: accountSymbol ?? 'USDT',
      notes,
      raw: row,
    });
  });

  const totals = buildTotals({ orders, transactions });
  const control = buildControl({ orders, transactions, totals });
  const summary: ImportSummary = {
    counts: {
      sourceAssets: source.length,
      orders: orders.length,
      closedOrders: totals.closedOrders,
      activeOrders: totals.activeOrders,
      transactions: transactions.length,
      newOrders: 0,
      updatedOrders: 0,
      skippedOrders: 0,
      newTransactions: 0,
      skippedTransactions: 0,
      newAssets: 0,
      reusedAssets: 0,
    },
    totals,
    control,
    currentDeltas: currentDeltas(totals),
    valuation: buildValuation({ source, orders, totals }),
    warnings,
    errors,
  };

  if (orders.length === 0) {
    errors.push('Export contains no valid orders');
  }
  if (orders.length !== input.orders.length) {
    warnings.push(`Skipped ${input.orders.length - orders.length} invalid order rows`);
  }
  if (transactions.length !== input.transactions.length) {
    warnings.push(
      `Skipped ${input.transactions.length - transactions.length} invalid transaction rows`,
    );
  }
  if (control.applicable && !control.matches) {
    errors.push(
      'Control reconciliation failed: the 429-order baseline does not match within tolerance',
    );
  }
  if (!control.applicable) {
    warnings.push(
      'Control snapshot is scoped to the original 431-order export; baseline reconciliation is not applicable',
    );
  }

  const cappedErrors = capMessages(errors);
  const cappedWarnings = capMessages(warnings);
  summary.errors = cappedErrors;
  summary.warnings = cappedWarnings;

  return {
    parsed: { source, orders, transactions, summary },
    errors: cappedErrors,
    warnings: cappedWarnings,
  };
}

export function payloadHash(payload: unknown): string {
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

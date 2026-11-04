import { describe, expect, it } from 'vitest';
import { parseNotionExport, payloadHash } from './notion-import.parser';

const page = (char: string) => `https://app.notion.com/p/${char.repeat(32)}`;

function sourceRow(char: string, symbol: string, price?: number) {
  return {
    url: page(char),
    Название: symbol,
    'Символ [P]': symbol.toLowerCase(),
    'Курс [1]': price ?? null,
  };
}

function orderRow(input: {
  id: string;
  status: string;
  openedAt: string;
  closedAt?: string;
  source: string;
  destination: string;
  sourceAmount: number | string;
  destinationAmount: number | string;
  saleRate?: number | string;
}) {
  return {
    url: page(input.id.padEnd(32, '0').slice(0, 32)),
    'userDefined:ID': input.id,
    Статус: input.status,
    'date:Открытие:start': input.openedAt,
    'date:Закрытие:start': input.closedAt ?? null,
    'Счет источника': [input.source],
    'Счет назначения': [input.destination],
    'Сумма-источника [1]': input.sourceAmount,
    'Сумма-назначения': input.destinationAmount,
    'Фактический курс [2]': input.saleRate ?? null,
  };
}

function transactionRow(input: {
  id: string;
  type: string;
  occurredAt: string;
  deposit?: number;
  withdrawal?: number;
  account: string;
}) {
  return {
    url: page(input.id.padEnd(32, '0').slice(0, 32)),
    'userDefined:ID': input.id,
    'Тип транзакции': input.type,
    'date:Дата операции:start': input.occurredAt,
    'Сумма пополнения': input.deposit ?? null,
    'Сумма вывода': input.withdrawal ?? null,
    Счет: [input.account],
    Комментарий: null,
  };
}

describe('parseNotionExport', () => {
  const usdt = sourceRow('a', 'USDT', 0.998);
  const tokenA = sourceRow('b', 'TOKENA', 0.12);
  const tokenB = sourceRow('c', 'TOKENB', 0.15);

  it('normalizes orders, transactions and control totals', () => {
    const result = parseNotionExport({
      source: [usdt, tokenA, tokenB],
      orders: [
        orderRow({
          id: '1',
          status: 'Закрыта',
          openedAt: '2026-01-01T00:00:00.000Z',
          closedAt: '2026-01-02T00:00:00.000Z',
          source: usdt.url,
          destination: tokenA.url,
          sourceAmount: 100,
          destinationAmount: 1000,
          saleRate: 0.12,
        }),
        orderRow({
          id: '2',
          status: 'Активна',
          openedAt: '2026-01-03T00:00:00.000Z',
          source: usdt.url,
          destination: tokenA.url,
          sourceAmount: 50,
          destinationAmount: 500,
        }),
        orderRow({
          id: '3',
          status: 'Закрыта',
          openedAt: '2026-01-04T00:00:00.000Z',
          closedAt: '2026-01-05T00:00:00.000Z',
          source: usdt.url,
          destination: tokenB.url,
          sourceAmount: 200,
          destinationAmount: 1000,
          saleRate: 0.15,
        }),
      ],
      transactions: [
        transactionRow({
          id: 'd1',
          type: 'Ввод',
          occurredAt: '2025-12-01T00:00:00.000Z',
          deposit: 500,
          account: usdt.url,
        }),
        transactionRow({
          id: 'e1',
          type: 'Вывод',
          occurredAt: '2026-02-01T00:00:00.000Z',
          withdrawal: 50,
          account: usdt.url,
        }),
      ],
    });

    expect(result.errors).toEqual([]);
    expect(result.parsed.source).toHaveLength(3);
    expect(result.parsed.orders).toHaveLength(3);
    expect(result.parsed.transactions).toHaveLength(2);
    expect(result.parsed.summary.counts).toMatchObject({
      sourceAssets: 3,
      orders: 3,
      closedOrders: 2,
      activeOrders: 1,
      transactions: 2,
    });
    expect(result.parsed.summary.totals).toMatchObject({
      orders: 3,
      closedOrders: 2,
      activeOrders: 1,
      depositsUsd: '500',
      withdrawalsUsd: '50',
      buyUsd: '350',
      sellUsd: '270',
      realizedPnlUsd: '-30',
      cashUsd: '370',
      activeCostUsd: '50',
    });
    expect(result.parsed.summary.valuation).toMatchObject({
      priceSource: 'notion:Курс [1]',
      activeCostUsd: '50',
      activeValueUsd: '60',
      unrealizedPnlUsd: '10',
      cashUsd: '370',
      equityUsd: '430',
      totalPnlUsd: '-20',
      missingPrices: [],
    });
    expect(result.parsed.summary.control.applicable).toBe(false);
    expect(result.parsed.summary.warnings).toContain(
      'Control snapshot adjustments are not present in this export; baseline reconciliation is not applicable',
    );
  });

  it('rejects unsupported and incomplete orders', () => {
    const result = parseNotionExport({
      source: [usdt, tokenA],
      orders: [
        orderRow({
          id: '1',
          status: 'Закрыта',
          openedAt: '2026-01-01T00:00:00.000Z',
          source: usdt.url,
          destination: tokenA.url,
          sourceAmount: 100,
          destinationAmount: 1000,
        }),
        orderRow({
          id: '1',
          status: 'Активна',
          openedAt: '2026-01-01T00:00:00.000Z',
          source: usdt.url,
          destination: tokenA.url,
          sourceAmount: 100,
          destinationAmount: 1000,
        }),
        orderRow({
          id: '2',
          status: 'Неизвестно',
          openedAt: '2026-01-01T00:00:00.000Z',
          source: usdt.url,
          destination: tokenA.url,
          sourceAmount: 100,
          destinationAmount: 1000,
        }),
        orderRow({
          id: '4',
          status: 'Активна',
          openedAt: '2026-01-01T00:00:00.000Z',
          source: tokenA.url,
          destination: tokenA.url,
          sourceAmount: 100,
          destinationAmount: 1000,
        }),
      ],
      transactions: [],
    });

    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.stringContaining('closed order has no sale rate'),
        expect.stringContaining('duplicate order id'),
        expect.stringContaining('unsupported source asset'),
        expect.stringContaining('unsupported status'),
      ]),
    );
  });

  it('rejects transactions that are not USDT', () => {
    const result = parseNotionExport({
      source: [usdt, tokenA],
      orders: [],
      transactions: [
        transactionRow({
          id: 'd1',
          type: 'Ввод',
          occurredAt: '2025-12-01T00:00:00.000Z',
          deposit: 500,
          account: tokenA.url,
        }),
      ],
    });

    expect(result.errors).toEqual(
      expect.arrayContaining([expect.stringContaining('unsupported account asset')]),
    );
  });

  it('preserves high-precision decimal strings', () => {
    const result = parseNotionExport({
      source: [usdt, tokenA],
      orders: [
        orderRow({
          id: '5',
          status: 'Активна',
          openedAt: '2026-01-01T00:00:00.000Z',
          source: usdt.url,
          destination: tokenA.url,
          sourceAmount: 100,
          destinationAmount: '123456789012345678.123456789012345678',
        }),
      ],
      transactions: [],
    });

    expect(result.errors).toEqual([]);
    expect(result.parsed.orders[0]?.destinationAmount).toBe(
      '123456789012345678.123456789012345678',
    );
  });

  it('rejects malformed numeric strings and cash-equivalent destinations', () => {
    const result = parseNotionExport({
      source: [usdt, tokenA],
      orders: [
        orderRow({
          id: '6',
          status: 'Активна',
          openedAt: '2026-01-01T00:00:00.000Z',
          source: usdt.url,
          destination: tokenA.url,
          sourceAmount: '0x10',
          destinationAmount: 1000,
        }),
        orderRow({
          id: '7',
          status: 'Активна',
          openedAt: '2026-01-01T00:00:00.000Z',
          source: usdt.url,
          destination: usdt.url,
          sourceAmount: 100,
          destinationAmount: 1000,
        }),
        orderRow({
          id: '8',
          status: 'Активна',
          openedAt: '2026-01-01T00:00:00.000Z',
          source: usdt.url,
          destination: tokenA.url,
          sourceAmount: '1e1000000',
          destinationAmount: '1e1000000',
        }),
      ],
      transactions: [],
    });

    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.stringContaining('missing source/destination amount'),
        expect.stringContaining('destination asset must not be a cash equivalent'),
      ]),
    );
    expect(result.parsed.orders).toHaveLength(0);
  });

  it('hashes payloads deterministically', () => {
    const payload = { source: [usdt], orders: [], transactions: [] };
    expect(payloadHash(payload)).toBe(payloadHash(payload));
    expect(payloadHash(payload)).toHaveLength(64);
  });
});

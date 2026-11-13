import { expect, test } from '@playwright/test';
import { generateSync } from 'otplib';
import { Client } from 'pg';

const setupToken = process.env.SETUP_TOKEN ?? '';
const password = 'correct horse battery staple';

const pageUrl = (id: string) => `https://app.notion.com/p/${id.padEnd(32, '0').slice(0, 32)}`;

function source(id: string, symbol: string, price: number) {
  return {
    url: pageUrl(id),
    Название: symbol,
    'Символ [P]': symbol.toLowerCase(),
    'Курс [1]': price,
  };
}

function order(input: {
  id: string;
  pageId: string;
  status: string;
  openedAt: string;
  closedAt?: string;
  sourceUrl: string;
  destinationUrl: string;
  sourceAmount: number;
  destinationAmount: number;
  saleRate?: number;
}) {
  return {
    url: pageUrl(input.pageId),
    'userDefined:ID': input.id,
    Статус: input.status,
    'date:Открытие:start': input.openedAt,
    'date:Закрытие:start': input.closedAt ?? null,
    'Счет источника': [input.sourceUrl],
    'Счет назначения': [input.destinationUrl],
    'Сумма-источника [1]': input.sourceAmount,
    'Сумма-назначения': input.destinationAmount,
    'Фактический курс [2]': input.saleRate ?? null,
  };
}

function transaction(input: {
  id: string;
  pageId: string;
  type: string;
  occurredAt: string;
  deposit?: number;
  withdrawal?: number;
  accountUrl: string;
}) {
  return {
    url: pageUrl(input.pageId),
    'userDefined:ID': input.id,
    'Тип транзакции': input.type,
    'date:Дата операции:start': input.occurredAt,
    'Сумма пополнения': input.deposit ?? null,
    'Сумма вывода': input.withdrawal ?? null,
    Счет: [input.accountUrl],
    Комментарий: null,
  };
}

test.skip(
  process.env.NEXTER_TEST_DB !== '1',
  'Set NEXTER_TEST_DB=1 and use a dedicated test database; this suite truncates auth tables.',
);

test.beforeAll(async () => {
  if (process.env.NEXTER_TEST_DB !== '1') {
    return;
  }

  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  try {
    await client.query(
      'truncate table prices, market_quotes, audit_log, sessions, settings, rate_limits, users restart identity cascade',
    );
    await client.query(
      "delete from assets where chain_id = (select id from chains where code = 'bsc') and symbol not in ('USDC', 'XNY', 'BASED', 'APR', 'POP', 'LINK', 'BNB', 'USDT')",
    );
  } finally {
    await client.end();
  }
});

test('previews, commits and rolls back a Notion import through the UI', async ({ page }) => {
  const email = `playwright-import-${Date.now()}@example.com`;

  await page.goto('/setup');
  await page.getByLabel('Setup token').fill(setupToken);
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Пароль (минимум 12 символов)').fill(password);
  await page.getByLabel('Повторите пароль').fill(password);
  await page.getByRole('button', { name: 'Создать владельца' }).click();

  await page.getByRole('button', { name: 'Я сохранил коды — продолжить' }).click();
  const secret = (await page.locator('code').textContent())?.trim() ?? '';
  await page.getByLabel('Код из приложения').fill(generateSync({ secret }));
  await page.getByRole('button', { name: 'Включить 2FA' }).click();
  await expect(page).toHaveURL(/\/dashboard$/);

  await page.goto('/import');
  await expect(page.getByRole('heading', { name: 'Импорт из Notion' })).toBeVisible();

  const usdt = source('1', 'USDT', 0.99873);
  const tokenA = source('2', 'TOKENA', 0.12);
  const tokenB = source('3', 'TOKENB', 0.15);
  const sourceRows = [usdt, tokenA, tokenB];
  const orderRows = [
    order({
      id: '101',
      pageId: '4',
      status: 'Закрыта',
      openedAt: '2026-01-01T00:00:00.000Z',
      closedAt: '2026-01-02T00:00:00.000Z',
      sourceUrl: usdt.url,
      destinationUrl: tokenA.url,
      sourceAmount: 100,
      destinationAmount: 1000,
      saleRate: 0.12,
    }),
    order({
      id: '102',
      pageId: '5',
      status: 'Активна',
      openedAt: '2026-01-03T00:00:00.000Z',
      sourceUrl: usdt.url,
      destinationUrl: tokenA.url,
      sourceAmount: 50,
      destinationAmount: 500,
    }),
    order({
      id: '103',
      pageId: '6',
      status: 'Закрыта',
      openedAt: '2026-01-04T00:00:00.000Z',
      closedAt: '2026-01-05T00:00:00.000Z',
      sourceUrl: usdt.url,
      destinationUrl: tokenB.url,
      sourceAmount: 200,
      destinationAmount: 1000,
      saleRate: 0.15,
    }),
  ];
  const transactionRows = [
    transaction({
      id: 'd1',
      pageId: '7',
      type: 'Ввод',
      occurredAt: '2025-12-01T00:00:00.000Z',
      deposit: 500,
      accountUrl: usdt.url,
    }),
    transaction({
      id: 'e1',
      pageId: '8',
      type: 'Вывод',
      occurredAt: '2026-02-01T00:00:00.000Z',
      withdrawal: 50,
      accountUrl: usdt.url,
    }),
  ];

  await page.getByLabel('Source.json').setInputFiles({
    name: 'source.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(sourceRows)),
  });
  await page.getByLabel('Orders.json').setInputFiles({
    name: 'orders.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(orderRows)),
  });
  await page.getByLabel('Transactions.json').setInputFiles({
    name: 'transactions.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(transactionRows)),
  });

  await page.getByRole('button', { name: 'Предпросмотр' }).click();
  await expect(page.getByText('Сверка с контролем 429 ордеров')).toBeVisible();
  await expect(page.getByText('Не применимо').first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Подтвердить импорт' })).toBeEnabled();

  await page.getByLabel('Orders.json').setInputFiles({
    name: 'orders.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(orderRows)),
  });
  await expect(page.getByRole('button', { name: 'Подтвердить импорт' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Предпросмотр' }).click();
  await expect(page.getByRole('button', { name: 'Подтвердить импорт' })).toBeEnabled();

  page.on('dialog', (dialog) => {
    void dialog.accept();
  });

  await page.getByRole('button', { name: 'Подтвердить импорт' }).click();
  await expect(page.getByText('Результат в учёте')).toBeVisible();
  await expect(page.getByText(/370,00/).first()).toBeVisible();
  await expect(page.getByText(/430,00/).first()).toBeVisible();
  await expect(page.getByText(/-30,00/).first()).toBeVisible();
  await expect(page.getByText(/-20,00/).first()).toBeVisible();

  await page.getByRole('button', { name: 'Откатить импорт' }).click();
  await expect(page.getByText('Результат в учёте')).toHaveCount(0);

  const history = page.getByRole('heading', { name: 'История импортов' });
  await expect(history).toBeVisible();
  await expect(page.getByText('Откатан').first()).toBeVisible();
});

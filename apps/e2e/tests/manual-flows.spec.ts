import { expect, test } from '@playwright/test';
import { generateSync } from 'otplib';
import { Client } from 'pg';

const setupToken = process.env.SETUP_TOKEN ?? '';
const password = 'correct horse battery staple';

test.skip(
  process.env.NEXTER_TEST_DB !== '1',
  'Set NEXTER_TEST_DB=1 and use a dedicated test database; this suite truncates auth tables.',
);

test.beforeAll(async () => {
  if (process.env.NEXTER_TEST_DB !== '1') return;

  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  try {
    await client.query(
      'truncate table prices, audit_log, sessions, settings, rate_limits, users restart identity cascade',
    );
    await client.query(
      "delete from assets where chain_id = (select id from chains where code = 'bsc') and symbol not in ('USDC', 'XNY', 'BASED', 'APR', 'POP', 'LINK', 'BNB', 'USDT')",
    );
  } finally {
    await client.end();
  }
});

test('manual buy, partial sell, income, adjustment, trade detail and export through the UI', async ({
  page,
}) => {
  const email = `playwright-manual-${Date.now()}@example.com`;

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

  const csrf =
    (await page.context().cookies()).find((cookie) => cookie.name === 'nexter_csrf')?.value ?? '';
  const assets = (
    (await (await page.request.get('/api/v1/assets')).json()) as {
      assets: Array<{ id: string; symbol: string; chainCode: string }>;
    }
  ).assets;
  const accounts = (
    (await (await page.request.get('/api/v1/accounts')).json()) as {
      accounts: Array<{ id: string; name: string; type: string }>;
    }
  ).accounts;
  const based = assets.find((asset) => asset.symbol === 'BASED' && asset.chainCode === 'bsc');
  const usdt = assets.find((asset) => asset.symbol === 'USDT' && asset.chainCode === 'bsc');
  const wallet = accounts.find(
    (account) => account.name === 'Tangem BSC' && account.type === 'wallet',
  );
  expect(based).toBeDefined();
  expect(usdt).toBeDefined();
  expect(wallet).toBeDefined();

  await page.request.post(`/api/v1/prices/${based?.id}`, {
    headers: { 'x-csrf-token': csrf },
    data: { priceUsd: '2.00' },
  });
  await page.request.post('/api/v1/transactions', {
    headers: { 'x-csrf-token': csrf },
    data: {
      type: 'deposit',
      accountId: wallet?.id,
      assetId: usdt?.id,
      amount: '1000',
      usdValue: '1000',
    },
  });

  async function openManual() {
    await page.getByRole('button', { name: '+ Операция' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText('Новая операция')).toBeVisible();
    return dialog;
  }

  // Buy through the manual-entry dialog.
  let dialog = await openManual();
  await dialog.getByRole('button', { name: 'Покупка' }).click();
  await dialog.getByLabel('Кошелёк').selectOption(wallet?.id ?? '');
  await dialog.getByLabel('Актив покупки').selectOption(based?.id ?? '');
  await dialog.getByLabel('Количество актива').fill('100');
  await dialog.getByLabel('Валюта покупки').selectOption(usdt?.id ?? '');
  await dialog.getByLabel('Сумма валюты').fill('100');
  await dialog.getByRole('button', { name: 'Сохранить операцию' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);

  // Partial sell through the manual-entry dialog.
  dialog = await openManual();
  await dialog.getByRole('button', { name: 'Продажа' }).click();
  await dialog.getByLabel('Кошелёк').selectOption(wallet?.id ?? '');
  await dialog.getByLabel('Актив продажи').selectOption(based?.id ?? '');
  await dialog.getByLabel('Количество актива').fill('40');
  await dialog.getByLabel('Валюта выручки').selectOption(usdt?.id ?? '');
  await dialog.getByLabel('Сумма выручки').fill('100');
  await dialog.getByRole('button', { name: 'Сохранить операцию' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);

  // Income and adjustment require reasons/values and must be audited.
  dialog = await openManual();
  await dialog.getByRole('button', { name: 'Доход' }).click();
  await dialog.getByLabel('Кошелёк').selectOption(wallet?.id ?? '');
  await dialog
    .getByLabel('Актив')
    .first()
    .selectOption(usdt?.id ?? '');
  await dialog.getByLabel('Количество').first().fill('10');
  await dialog.getByLabel('USD стоимость').first().fill('10');
  await dialog.getByRole('button', { name: 'Сохранить операцию' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);

  dialog = await openManual();
  await dialog.getByRole('button', { name: 'Корректировка' }).click();
  await dialog.getByLabel('Кошелёк').selectOption(wallet?.id ?? '');
  await dialog
    .getByLabel('Актив')
    .first()
    .selectOption(usdt?.id ?? '');
  await dialog.getByLabel('Количество').first().fill('5');
  await dialog.getByLabel('USD стоимость').first().fill('5');
  await dialog.getByLabel('Причина корректировки').fill('Playwright adjustment');
  await dialog.getByRole('button', { name: 'Сохранить операцию' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);

  // The buy+sell create one partial trade group with FIFO consumption.
  await page.goto('/portfolio');
  await expect(page.getByRole('heading', { name: 'Сделки' })).toBeVisible();
  await page.getByRole('link', { name: 'BASED' }).first().click();
  await expect(page).toHaveURL(/\/trades\//);
  await expect(page.getByText('Ноги сделки')).toBeVisible();
  await expect(page.getByText('Списания').first()).toBeVisible();

  // Sell more from the trade detail; the UI must show the reduced remaining amount.
  await page.getByRole('button', { name: 'Добавить продажу' }).click();
  const sellDialog = page.getByRole('dialog');
  await sellDialog.getByLabel('Кошелёк').selectOption(wallet?.id ?? '');
  await sellDialog.getByLabel('Количество BASED').fill('10');
  await sellDialog.getByLabel('Валюта выручки').selectOption(usdt?.id ?? '');
  await sellDialog.getByLabel('Сумма выручки').fill('25');
  await sellDialog.getByRole('button', { name: 'Добавить продажу' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByText('50', { exact: true }).first()).toBeVisible();

  // Audit page shows the mutations created above.
  await page.goto('/settings/audit');
  await expect(page.getByRole('heading', { name: 'Аудит' })).toBeVisible();
  await expect(page.getByText('accounting.transaction_created').first()).toBeVisible();

  // Data-quality page renders after the manual entries.
  await page.goto('/settings/data-quality');
  await expect(page.getByRole('heading', { name: 'Качество данных' })).toBeVisible();
  await expect(page.getByText('Отрицательные балансы').first()).toBeVisible();

  // JSON export downloads a real file.
  await page.goto('/settings');
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'JSON' }).first().click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toContain('transactions');
  expect(download.suggestedFilename()).toContain('.json');
});

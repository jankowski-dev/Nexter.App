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

  async function openManualTrade() {
    await page.goto('/portfolio');
    await page.getByRole('button', { name: 'Ручная сделка' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('heading', { name: 'Ручная сделка' })).toBeVisible();
    await expect.poll(() => page.evaluate('document.body.style.overflow')).toBe('hidden');
    return dialog;
  }

  async function openOperation(mode: 'Доход' | 'Корректировка' | 'Пополнение') {
    await page.goto('/operations');
    await page.getByRole('button', { name: 'Новая операция' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('heading', { name: 'Новая операция' })).toBeVisible();
    await dialog.getByRole('button', { name: mode }).click();
    return dialog;
  }

  // Manual buy through the dedicated manual trade dialog.
  let dialog = await openManualTrade();
  await dialog
    .locator('select')
    .nth(0)
    .selectOption(based?.id ?? '');
  await dialog.getByLabel('Количество BASED').fill('100');
  await dialog
    .locator('select')
    .nth(1)
    .selectOption(usdt?.id ?? '');
  await dialog.getByLabel('Сумма покупки').fill('100');
  await dialog.getByRole('button', { name: 'Сохранить' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect.poll(() => page.evaluate('document.body.style.overflow')).toBe('');

  // Income and adjustment live in the manual operation dialog.
  dialog = await openOperation('Доход');
  await dialog
    .locator('select')
    .nth(0)
    .selectOption(wallet?.id ?? '');
  await dialog
    .locator('select')
    .nth(1)
    .selectOption(usdt?.id ?? '');
  await dialog.getByLabel('Количество USDT').fill('10');
  await dialog.getByLabel('USD-стоимость').fill('10');
  await dialog.getByRole('button', { name: 'Сохранить' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);

  dialog = await openOperation('Корректировка');
  await dialog
    .locator('select')
    .nth(0)
    .selectOption(wallet?.id ?? '');
  await dialog
    .locator('select')
    .nth(1)
    .selectOption(usdt?.id ?? '');
  await dialog.getByLabel('Количество USDT').fill('5');
  await dialog.getByLabel('USD-стоимость').fill('5');
  await dialog.getByLabel('Причина').fill('Playwright adjustment');
  await dialog.getByRole('button', { name: 'Сохранить' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);

  // The trade journal opens the sell drawer; the full card still has lots and legs.
  await page.goto('/portfolio');
  await page.getByRole('tab', { name: 'Сделки' }).click();
  await expect(page.getByText('Активные сделки')).toBeVisible();
  await page.getByRole('row').filter({ hasText: 'BASED' }).first().click();
  let sellDrawer = page.getByRole('dialog');
  await expect(sellDrawer.getByRole('heading', { name: 'Продать BASED' })).toBeVisible();
  await expect(sellDrawer.getByText('Текущая сделка')).toBeVisible();
  await sellDrawer.getByRole('link', { name: 'Полная карточка' }).click();
  await expect(page).toHaveURL(/\/trades\//);
  await expect(page.getByText('Ноги сделки')).toBeVisible();
  await expect(page.getByText('Списания').first()).toBeVisible();

  // Partial manual sell from the selected trade.
  await page.goto('/portfolio');
  await page.getByRole('tab', { name: 'Сделки' }).click();
  await page.getByRole('row').filter({ hasText: 'BASED' }).first().click();
  sellDrawer = page.getByRole('dialog');
  await sellDrawer.getByRole('button', { name: 'Записать продажу вручную' }).click();
  const firstSellDialog = page.getByRole('dialog');
  await expect(firstSellDialog.getByRole('heading', { name: 'Ручная сделка' })).toBeVisible();
  await firstSellDialog
    .locator('select')
    .nth(1)
    .selectOption(usdt?.id ?? '');
  await firstSellDialog.getByLabel('Количество BASED').fill('40');
  await firstSellDialog.getByLabel('Сумма продажи').fill('100');
  await firstSellDialog.getByRole('button', { name: 'Сохранить' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);

  await page.getByRole('row').filter({ hasText: 'BASED' }).first().click();
  sellDrawer = page.getByRole('dialog');
  await expect(sellDrawer.getByText('60 BASED', { exact: true }).first()).toBeVisible();
  await sellDrawer.getByRole('button', { name: 'Записать продажу вручную' }).click();
  const secondSellDialog = page.getByRole('dialog');
  await secondSellDialog
    .locator('select')
    .nth(1)
    .selectOption(usdt?.id ?? '');
  await secondSellDialog.getByLabel('Количество BASED').fill('10');
  await secondSellDialog.getByLabel('Сумма продажи').fill('25');
  await secondSellDialog.getByRole('button', { name: 'Сохранить' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);

  await page.getByRole('row').filter({ hasText: 'BASED' }).first().click();
  sellDrawer = page.getByRole('dialog');
  await expect(sellDrawer.getByText('50 BASED', { exact: true }).first()).toBeVisible();
  await sellDrawer.getByRole('button', { name: 'Готово' }).click();

  // Manual exchange records a swap operation and appears in the journal.
  await page.goto('/operations');
  await page.getByRole('button', { name: 'Новая операция' }).click();
  const exchangeDialog = page.getByRole('dialog');
  await exchangeDialog
    .locator('select')
    .nth(1)
    .selectOption(based?.id ?? '');
  await exchangeDialog
    .locator('select')
    .nth(2)
    .selectOption(usdt?.id ?? '');
  await exchangeDialog.getByLabel('Количество BASED').fill('1');
  await exchangeDialog.getByLabel('Количество USDT').fill('2');
  await exchangeDialog.getByRole('button', { name: 'Сохранить' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('tab', { name: 'Обмены' }).click();
  const exchangeRow = page.getByRole('row').filter({ hasText: 'Обмен' }).first();
  await expect(exchangeRow).toBeVisible();
  await expect(exchangeRow.getByText(/BASED/).first()).toBeVisible();

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

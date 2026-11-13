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
      'truncate table prices, market_quotes, audit_log, sessions, settings, rate_limits, users restart identity cascade',
    );
    await client.query(
      "delete from assets where chain_id = (select id from chains where code = 'bsc') and symbol not in ('USDC', 'XNY', 'BASED', 'APR', 'POP', 'LINK', 'BNB', 'USDT')",
    );
  } finally {
    await client.end();
  }
});

test('MVP-1 UI: dashboard, portfolio, trades, watchlist, settings and manual entry', async ({
  page,
}) => {
  const email = `playwright-phase5-${Date.now()}@example.com`;

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

  const header = page.locator('header');
  await expect(header.getByText(email, { exact: true })).toBeVisible();
  await expect(header.getByRole('button', { name: 'BNB' })).toHaveAttribute('aria-pressed', 'true');
  await expect(header.getByRole('button', { name: 'Ethereum' })).toHaveAttribute(
    'aria-pressed',
    'false',
  );
  await expect(header.getByRole('button', { name: 'Подключить' })).toBeVisible();
  await expect(page.getByText('MVP-1 · BSC/Ethereum')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '+ Операция' })).toHaveCount(0);

  const cookies = await page.context().cookies();
  const csrf = cookies.find((cookie) => cookie.name === 'nexter_csrf')?.value ?? '';
  const assetsResponse = await page.request.get('/api/v1/assets');
  const assets = (
    (await assetsResponse.json()) as {
      assets: Array<{ id: string; symbol: string; contractAddress: string | null }>;
    }
  ).assets;
  const accountsResponse = await page.request.get('/api/v1/accounts');
  const accounts = (
    (await accountsResponse.json()) as {
      accounts: Array<{ id: string; name: string; type: string }>;
    }
  ).accounts;
  const based = assets.find((asset) => asset.symbol === 'BASED');
  const usdt = assets.find((asset) => asset.symbol === 'USDT');
  const wallet = accounts.find((account) => account.name === 'Tangem BSC');
  expect(based).toBeDefined();
  expect(usdt).toBeDefined();
  expect(wallet).toBeDefined();

  const post = (url: string, data: Record<string, unknown>) =>
    page.request.post(url, { headers: { 'x-csrf-token': csrf }, data });

  await page.request.post(`/api/v1/prices/${based?.id}`, {
    headers: { 'x-csrf-token': csrf },
    data: { priceUsd: '2.00' },
  });
  await post('/api/v1/transactions', {
    type: 'deposit',
    accountId: wallet?.id,
    assetId: usdt?.id,
    amount: '1000',
    usdValue: '1000',
  });
  await post('/api/v1/transactions', {
    type: 'buy',
    accountId: wallet?.id,
    assetId: based?.id,
    amount: '100',
    quoteAssetId: usdt?.id,
    quoteAmount: '100',
  });
  await post('/api/v1/transactions', {
    type: 'sell',
    accountId: wallet?.id,
    assetId: based?.id,
    amount: '40',
    proceedsAssetId: usdt?.id,
    proceedsAmount: '100',
    usdValue: '100',
  });
  await post('/api/v1/transactions', {
    type: 'income',
    accountId: wallet?.id,
    assetId: usdt?.id,
    amount: '10',
    usdValue: '10',
  });
  await post('/api/v1/transactions', {
    type: 'adjustment',
    accountId: wallet?.id,
    assetId: usdt?.id,
    amount: '5',
    usdValue: '5',
    reason: 'Playwright adjustment',
  });

  await page.goto('/dashboard');
  await expect(page.getByRole('heading', { name: 'Дашборд' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Крипта' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Финансы' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Задачи на сегодня' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Без вредных привычек' })).toBeVisible();
  await expect(page.getByText('Чистая прибыль за месяц')).toBeVisible();
  await expect(page.getByText('Средний расход в день')).toBeVisible();
  await page.getByRole('button', { name: 'Тёмная тема' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Дашборд' })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.getByRole('button', { name: 'Светлая тема' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');

  await page.goto('/operations');
  await expect(page.getByRole('heading', { name: 'Операции' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Журнал операций' })).toBeVisible();
  await page.getByRole('tab', { name: 'Пополнения' }).click();
  await expect(page.getByText('Пополнение').first()).toBeVisible();

  await page.goto('/statistics');
  await expect(page.getByRole('heading', { name: 'Статистика' })).toBeVisible();
  await expect(page.getByText('Итоги за период')).toBeVisible();
  await expect(page.getByRole('button', { name: '12 месяцев' })).toBeVisible();
  await expect(page.getByText('Разбивка по активам')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Транзакции за период' })).toBeVisible();
  await page.getByRole('button', { name: '30 дней' }).click();
  await expect(page.getByText('Чистая прибыль за период')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Реализованный P&L по месяцам' })).toBeVisible();

  await page.goto('/trades');
  await expect(page).toHaveURL(/\/portfolio$/);

  await page.goto('/portfolio');
  await expect(page.getByRole('heading', { name: 'Торговля' })).toBeVisible();
  await expect(page.getByText('Портфель по токенам')).toBeVisible();
  await page.getByRole('button', { name: 'Открыть статистику BASED' }).click();
  const assetDrawer = page.getByRole('dialog');
  await expect(assetDrawer.getByRole('heading', { name: 'Лоты' })).toBeVisible();
  await expect(assetDrawer.getByRole('heading', { name: 'Сделки' })).toBeVisible();
  await expect(assetDrawer.getByRole('heading', { name: 'Транзакции' })).toBeVisible();
  await assetDrawer.getByRole('link', { name: 'Открыть полную карточку' }).click();
  await expect(page).toHaveURL(/\/portfolio\/assets\//);
  await expect(page.getByRole('heading', { name: /BASED/ })).toBeVisible();
  await expect(page.getByTitle(/Данные обновляются автоматически/)).toHaveCount(0);
  await expect(page.getByText('Установить цену')).toHaveCount(0);
  await expect(page.getByText('Лоты')).toHaveCount(0);
  await expect(page.getByText('Сделки').first()).toBeVisible();
  await expect(page.getByText('Транзакции').first()).toBeVisible();

  await page.goto('/portfolio');
  await page.getByRole('tab', { name: 'Ордера' }).click();
  await expect(page.getByText('Активные ордера')).toBeVisible();
  await page.getByRole('row').filter({ hasText: 'BASED' }).first().click();
  const tradeDrawer = page.getByRole('dialog');
  await expect(tradeDrawer.getByRole('heading', { name: 'Продать BASED' })).toBeVisible();
  await expect(tradeDrawer.getByText('Текущая сделка')).toBeVisible();
  await tradeDrawer.getByRole('link', { name: 'Полная карточка' }).click();
  await expect(page).toHaveURL(/\/trades\//);
  await expect(page.getByText('Ноги сделки')).toBeVisible();
  await expect(page.getByText('Лоты').first()).toBeVisible();
  await expect(page.getByText('Списания').first()).toBeVisible();
  await expect(page.getByText('Аудит').first()).toBeVisible();

  await page.getByRole('button', { name: 'Заметка' }).click();
  const noteDialog = page.getByRole('dialog');
  await noteDialog.getByRole('textbox').fill('Playwright trade note');
  await noteDialog.getByRole('button', { name: 'Сохранить' }).click();
  await expect(page.getByText('Playwright trade note')).toBeVisible();

  await page.goto('/portfolio');
  await page.getByRole('button', { name: 'Ручная сделка' }).click();
  const tradeDialog = page.getByRole('dialog');
  await expect(tradeDialog.getByRole('heading', { name: 'Ручная сделка' })).toBeVisible();
  await tradeDialog
    .locator('select')
    .nth(0)
    .selectOption(based?.id ?? '');
  await tradeDialog.getByLabel('Количество BASED').fill('1');
  await tradeDialog
    .locator('select')
    .nth(1)
    .selectOption(usdt?.id ?? '');
  await tradeDialog.getByLabel('Сумма покупки').fill('2');
  await tradeDialog.getByRole('button', { name: 'Сохранить' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);

  await page.goto('/watchlist');
  await expect(page.getByRole('heading', { name: 'База токенов' })).toBeVisible();
  await page.getByRole('button', { name: 'Добавить актив' }).first().click();
  const watchDialog = page.getByRole('dialog');
  await watchDialog.getByLabel('Актив').selectOption(based?.id ?? '');
  await watchDialog.getByLabel('Описание').fill('Playwright thesis');
  await watchDialog.getByLabel('Теги (через запятую)').fill('Топ, тест');
  await watchDialog.getByLabel('Twitter / X').fill('https://x.com/based');
  await watchDialog.getByLabel('Сайт').fill('https://based.example');
  await watchDialog.getByLabel('Инвесторы (через запятую)').fill('Alpha Capital, Beta Ventures');
  await watchDialog.getByLabel('Приоритет').fill('10');
  await watchDialog.getByRole('button', { name: 'Сохранить' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);

  await page.getByRole('button', { name: /BASED/ }).first().click();
  const tokenDrawer = page.getByRole('dialog');
  await expect(tokenDrawer.getByRole('heading', { name: 'BASED' })).toBeVisible();
  await expect(tokenDrawer.getByText('Playwright thesis')).toBeVisible();
  await expect(tokenDrawer.getByText('Alpha Capital')).toBeVisible();
  await expect(tokenDrawer.getByText('Beta Ventures')).toBeVisible();
  await expect(tokenDrawer.getByText(based?.contractAddress ?? '')).toBeVisible();
  await expect(tokenDrawer.getByRole('link', { name: 'Twitter / X' })).toHaveAttribute(
    'href',
    'https://x.com/based',
  );

  await tokenDrawer.getByRole('button', { name: 'Изменить' }).click();
  const editDialog = page.getByRole('dialog');
  await editDialog.getByLabel('Описание').fill('Updated Playwright thesis');
  await editDialog.getByLabel('Файл иконки токена').setInputFiles({
    name: 'based-icon.png',
    mimeType: 'image/png',
    buffer: Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAEUlEQVR4nGP4z8DwH4QZYAwAR8oH+WdZbrcAAAAASUVORK5CYII=',
      'base64',
    ),
  });
  await expect(editDialog.locator('img[src^="data:image/"]')).toBeVisible();
  await editDialog.getByRole('button', { name: 'Сохранить' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('button', { name: /BASED/ }).first().click();
  const updatedDrawer = page.getByRole('dialog');
  await expect(updatedDrawer.getByText('Updated Playwright thesis')).toBeVisible();
  await updatedDrawer.getByLabel('Закрыть').click();
  await expect(page.locator('img[src^="data:image/"]').first()).toBeVisible();

  page.on('dialog', (dialog) => {
    void dialog.accept();
  });

  await page.goto('/settings');
  await expect(page.getByRole('heading', { name: 'Настройки' })).toBeVisible();
  await expect(page.getByText('Общие').first()).toBeVisible();
  await page.getByLabel('Часовой пояс (IANA)').fill('Europe/Moscow');
  await page.getByRole('button', { name: 'Сохранить настройки' }).click();
  await page.reload();
  await expect(page.getByLabel('Часовой пояс (IANA)')).toHaveValue('Europe/Moscow');

  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'CSV' }).first().click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toContain('transactions');

  await page.goto('/operations');
  await page.getByRole('button', { name: 'Новая операция' }).click();
  const manualDialog = page.getByRole('dialog');
  await expect(manualDialog.getByRole('heading', { name: 'Новая операция' })).toBeVisible();
  await manualDialog.getByRole('button', { name: 'Пополнение' }).click();
  await manualDialog
    .locator('select')
    .nth(0)
    .selectOption(wallet?.id ?? '');
  await manualDialog
    .locator('select')
    .nth(1)
    .selectOption(usdt?.id ?? '');
  await manualDialog.getByLabel('Количество USDT').fill('5');
  await manualDialog.getByLabel('Сколько USD потрачено на токены').fill('5');
  await manualDialog.getByRole('button', { name: 'Сохранить' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);

  await page.goto('/portfolio');
  await expect(page.locator('img[src^="data:image/"]').first()).toBeVisible();
  await page.getByRole('tab', { name: 'Ордера' }).click();
  await expect(page.locator('img[src^="data:image/"]').first()).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Активность' })).toHaveCount(0);

  await page.goto('/watchlist');
  await page.getByRole('button', { name: /BASED/ }).first().click();
  const drawerToDelete = page.getByRole('dialog');
  await expect(drawerToDelete.getByText('Updated Playwright thesis')).toBeVisible();
  await drawerToDelete.getByRole('button', { name: 'Удалить' }).click();
  await expect(page.getByRole('button', { name: /BASED/ })).toHaveCount(0);
  await expect(page.getByRole('switch', { name: 'Показать архивные токены' })).toHaveCount(0);
});

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

  const cookies = await page.context().cookies();
  const csrf = cookies.find((cookie) => cookie.name === 'nexter_csrf')?.value ?? '';
  const assetsResponse = await page.request.get('/api/v1/assets');
  const assets = (
    (await assetsResponse.json()) as { assets: Array<{ id: string; symbol: string }> }
  ).assets;
  const accountsResponse = await page.request.get('/api/v1/accounts');
  const accounts = (
    (await accountsResponse.json()) as {
      accounts: Array<{ id: string; name: string; type: string }>;
    }
  ).accounts;
  const based = assets.find((asset) => asset.symbol === 'BASED');
  const usdt = assets.find((asset) => asset.symbol === 'USDT');
  const usdc = assets.find((asset) => asset.symbol === 'USDC');
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
  await expect(page.getByText('Капитал').first()).toBeVisible();
  await expect(page.getByText('Итого P&L').first()).toBeVisible();
  await expect(page.getByText('Качество торговли')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Доходность по месяцам' })).toBeVisible();
  await expect(page.getByText('Кривая капитала')).toBeVisible();
  await expect(page.getByText(/135,00/).first()).toBeVisible();

  await page.goto('/operations');
  await expect(page.getByRole('heading', { name: 'Операции' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Журнал операций' })).toBeVisible();
  await page.getByRole('tab', { name: 'Пополнения' }).click();
  await expect(page.getByText('Пополнение').first()).toBeVisible();

  await page.goto('/reports');
  await expect(page.getByRole('heading', { name: 'Отчёты' })).toBeVisible();
  await expect(page.getByText('Итоги за период')).toBeVisible();
  await expect(page.getByRole('button', { name: '12 месяцев' })).toBeVisible();
  await expect(page.getByText('Разбивка по активам')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Транзакции за период' })).toBeVisible();
  await page.getByRole('button', { name: '30 дней' }).click();
  await expect(page.getByText('Net P&L за период')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Реализованный P&L по месяцам' })).toBeVisible();

  await page.goto('/trades');
  await expect(page).toHaveURL(/\/portfolio$/);

  await page.goto('/portfolio');
  await expect(page.getByRole('heading', { name: 'Портфель' })).toBeVisible();
  await expect(page.getByText('Позиции по активам')).toBeVisible();
  await page.getByRole('button', { name: 'Открыть статистику BASED' }).click();
  const assetDrawer = page.getByRole('dialog');
  await expect(assetDrawer.getByRole('heading', { name: 'Лоты' })).toBeVisible();
  await expect(assetDrawer.getByRole('heading', { name: 'Сделки' })).toBeVisible();
  await expect(assetDrawer.getByRole('heading', { name: 'Транзакции' })).toBeVisible();
  await assetDrawer.getByRole('link', { name: 'Открыть полную карточку' }).click();
  await expect(page).toHaveURL(/\/portfolio\/assets\//);
  await expect(page.getByRole('heading', { name: /BASED/ })).toBeVisible();
  await expect(page.getByText('Лоты').first()).toBeVisible();
  await expect(page.getByText('Сделки').first()).toBeVisible();
  await expect(page.getByText('Транзакции').first()).toBeVisible();

  await page.goto('/portfolio');
  await expect(page.getByRole('heading', { name: 'Сделки' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Торговые группы' })).toBeVisible();
  await page.getByRole('link', { name: 'BASED' }).first().click();
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
  await page.getByRole('button', { name: 'Новая сделка' }).click();
  const tradeDialog = page.getByRole('dialog');
  await expect(tradeDialog.getByRole('tab', { name: 'Сделка' })).toBeVisible();
  await tradeDialog.getByLabel('Актив', { exact: true }).selectOption(based?.id ?? '');
  await tradeDialog.getByLabel('Количество BASED').fill('1');
  await tradeDialog.getByLabel('Валюта покупки', { exact: true }).selectOption(usdc?.id ?? '');
  await tradeDialog.getByLabel('Сумма USDC').fill('2');
  await tradeDialog.getByRole('button', { name: 'Выполнить on-chain' }).click();
  await expect(tradeDialog.getByText('Кошелёк Tangem')).toBeVisible();
  await tradeDialog.getByRole('button', { name: 'Записать' }).click();
  await tradeDialog.getByLabel('Валюта покупки', { exact: true }).selectOption(usdt?.id ?? '');
  await tradeDialog.getByLabel('Сумма USDT').fill('2');
  await tradeDialog.getByRole('button', { name: 'Сохранить' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);

  await page.getByRole('button', { name: 'Открыть статистику BASED' }).click();
  const assetDrawerForClose = page.getByRole('dialog');
  await assetDrawerForClose.getByRole('button', { name: 'Закрыть позиции' }).click();
  const closeDialog = page.getByRole('dialog');
  await expect(closeDialog.getByText('Закрываемые позиции')).toBeVisible();
  await closeDialog.getByRole('checkbox').first().check();
  await expect(closeDialog.getByLabel(/Количество BASED/)).not.toHaveValue('');
  await closeDialog.getByRole('button', { name: 'Отмена' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);

  await page.goto('/watchlist');
  await expect(page.getByRole('heading', { name: 'Наблюдение' })).toBeVisible();
  await page.getByRole('button', { name: 'Добавить актив' }).first().click();
  const watchDialog = page.getByRole('dialog');
  await watchDialog.getByLabel('Актив').selectOption(based?.id ?? '');
  await watchDialog.getByLabel('Тезис').fill('Playwright thesis');
  await watchDialog.getByLabel('Теги (через запятую)').fill('Топ, тест');
  await watchDialog.getByLabel('Приоритет').fill('10');
  await watchDialog.getByRole('button', { name: 'Сохранить' }).click();
  await expect(page.getByText('Playwright thesis')).toBeVisible();
  await expect(page.getByText('тест')).toBeVisible();

  await page.getByRole('button', { name: 'Изменить' }).click();
  const editDialog = page.getByRole('dialog');
  await editDialog.getByLabel('Тезис').fill('Updated Playwright thesis');
  await editDialog.getByRole('button', { name: 'Сохранить' }).click();
  await expect(page.getByText('Updated Playwright thesis')).toBeVisible();

  page.on('dialog', (dialog) => {
    void dialog.accept();
  });
  await page.getByRole('button', { name: 'В архив' }).click();
  await expect(page.getByText('Updated Playwright thesis')).toHaveCount(0);

  await page.getByLabel('Архив').check();
  await expect(page.getByRole('button', { name: 'Вернуть' })).toBeVisible();
  await page.getByRole('button', { name: 'Вернуть' }).click();
  await page.getByLabel('Архив').uncheck();
  await expect(page.getByText('Updated Playwright thesis')).toBeVisible();

  await page.goto('/settings');
  await expect(page.getByRole('heading', { name: 'Настройки' })).toBeVisible();
  await expect(page.getByText('Общие').first()).toBeVisible();
  await page.getByLabel('Часовой пояс (IANA)').fill('Europe/Moscow');
  await page.getByRole('button', { name: 'Сохранить настройки' }).click();
  await expect(page.getByText('Настройки сохранены.')).toBeVisible();

  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'CSV' }).first().click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toContain('transactions');

  await page.getByRole('button', { name: '+ Операция' }).click();
  const manualDialog = page.getByRole('dialog');
  await expect(manualDialog.getByRole('tab', { name: 'Сделка' })).toBeVisible();
  await manualDialog.getByRole('tab', { name: 'Пополнение' }).click();
  await manualDialog.getByLabel('Кошелёк').selectOption(wallet?.id ?? '');
  await manualDialog.getByLabel('Актив', { exact: true }).selectOption(usdt?.id ?? '');
  await manualDialog.getByLabel('Количество', { exact: true }).fill('5');
  await manualDialog.getByLabel('USD стоимость', { exact: true }).fill('5');
  await manualDialog.getByRole('button', { name: 'Сохранить' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);

  await page.goto('/portfolio');
  await page.getByRole('tab', { name: 'Активность' }).click();
  await expect(page.getByText('deposit / deposit').first()).toBeVisible();
});

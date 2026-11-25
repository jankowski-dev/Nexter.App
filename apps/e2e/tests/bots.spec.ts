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
  } finally {
    await client.end();
  }
});

test('bot create modal has no backtest action and the detail drawer keeps telemetry', async ({
  page,
}) => {
  const email = `playwright-bot-${Date.now()}@example.com`;

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
  const based = assets.find((asset) => asset.symbol === 'BASED' && asset.chainCode === 'bsc');
  expect(based).toBeDefined();
  await page.request.post('/api/v1/watchlist', {
    headers: { 'x-csrf-token': csrf },
    data: { assetId: based?.id },
  });

  await page.goto('/portfolio');
  await page.getByRole('tab', { name: 'Роботы' }).click();
  await page.getByRole('button', { name: 'Добавить робота' }).first().click();

  const botDialog = page.getByRole('dialog').filter({ hasText: 'Новый робот' });
  await expect(botDialog).toBeVisible();
  await botDialog.getByLabel('Название').fill('E2E робот');
  await botDialog
    .locator('label')
    .filter({ hasText: 'BASED' })
    .first()
    .getByRole('checkbox')
    .check();

  await expect(botDialog.getByRole('button', { name: 'Тестировать' })).toHaveCount(0);
  await expect(page.getByRole('dialog')).toHaveCount(1);

  await botDialog.getByRole('button', { name: 'Отмена' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);

  const created = await page.request.post('/api/v1/trading-bots/bots', {
    headers: { 'x-csrf-token': csrf },
    data: {
      name: 'Telemetry bot',
      strategyKey: 'momentum_breakout',
      tokenAssetIds: [based?.id],
      budgetUsd: '1000',
      maxPositions: 5,
      positionSizePct: 20,
      feeBps: 25,
      slippageBps: 10,
      maxDailyLossPct: 10,
      cooldownMinutes: 15,
    },
  });
  expect(created.status()).toBe(201);

  await page.reload();
  await page.getByRole('tab', { name: 'Роботы' }).click();
  await page.getByRole('button', { name: 'Открыть робота Telemetry bot' }).click();
  const detailDialog = page.getByRole('dialog').filter({ hasText: 'Telemetry bot' });
  await expect(detailDialog).toBeVisible();
  await expect(detailDialog.getByRole('button', { name: 'Тестировать' })).toHaveCount(0);
  await detailDialog.getByRole('button', { name: 'Телеметрия' }).click();
  const telemetryDialog = page.getByRole('dialog').filter({ hasText: 'Телеметрия ·' });
  await expect(telemetryDialog).toBeVisible();
  await expect(telemetryDialog.getByRole('button', { name: 'Собрать отчёт' })).toBeVisible();
  await telemetryDialog.getByRole('button', { name: 'Готово' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(1);
});

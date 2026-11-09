import { expect, test } from '@playwright/test';
import { generateSync } from 'otplib';
import { Client } from 'pg';

const setupToken = process.env.SETUP_TOKEN ?? '';
const password = 'correct horse battery staple';

test.skip(
  process.env.NEXTER_TEST_DB !== '1',
  'Set NEXTER_TEST_DB=1 and use a dedicated test database; this suite truncates auth tables.',
);
test.use({ viewport: { width: 390, height: 844 } });

test.beforeAll(async () => {
  if (process.env.NEXTER_TEST_DB !== '1') return;

  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  try {
    await client.query(
      'truncate table prices, audit_log, sessions, settings, rate_limits, users restart identity cascade',
    );
  } finally {
    await client.end();
  }
});

test('mobile navigation and dialogs', async ({ page }) => {
  const email = `playwright-mobile-${Date.now()}@example.com`;

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

  const mobileNav = page.getByRole('navigation', { name: 'Мобильная навигация' });
  await expect(mobileNav).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Дашборд' })).toBeVisible();

  await mobileNav.getByRole('link', { name: 'Портфель' }).click();
  await expect(page).toHaveURL(/\/portfolio$/);
  await expect(page.getByRole('heading', { name: 'Портфель' })).toBeVisible();

  await mobileNav.getByRole('link', { name: 'Отчёты' }).click();
  await expect(page).toHaveURL(/\/reports$/);
  await expect(page.getByRole('heading', { name: 'Отчёты' })).toBeVisible();
  await expect(page.getByLabel('Период отчёта')).toBeVisible();

  await page.getByRole('button', { name: '+ Операция' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('tab', { name: 'Сделка' })).toBeVisible();
  await expect(dialog.getByLabel('Закрыть')).toBeVisible();
  await dialog.getByLabel('Закрыть').click();
  await expect(page.getByRole('dialog')).toHaveCount(0);

  await mobileNav.getByRole('link', { name: 'Наблюдение' }).click();
  await expect(page).toHaveURL(/\/watchlist$/);
  await expect(page.getByRole('heading', { name: 'Наблюдение' })).toBeVisible();

  await page.goto('/swap');
  await expect(page).toHaveURL(/\/portfolio$/);
});

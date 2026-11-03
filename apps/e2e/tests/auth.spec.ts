import { expect, test } from '@playwright/test';
import { generateSync } from 'otplib';
import { Client } from 'pg';

const setupToken = process.env.SETUP_TOKEN ?? '';
const password = 'correct horse battery staple';
const newPassword = 'correct horse battery staple 2';

test.skip(
  process.env.NEXTER_TEST_DB !== '1',
  'Set NEXTER_TEST_DB=1 and use a dedicated test database; this suite truncates auth tables.',
);

test.beforeAll(async () => {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  try {
    await client.query(
      'truncate table audit_log, sessions, settings, rate_limits, users restart identity cascade',
    );
  } finally {
    await client.end();
  }
});

test('setup, TOTP, login and password change through the real UI', async ({ page }) => {
  const email = `playwright-${Date.now()}@example.com`;

  await page.goto('/setup');
  await expect(page.getByRole('heading', { name: 'Первый запуск' })).toBeVisible();

  await page.getByLabel('Setup token').fill(setupToken);
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Пароль (минимум 12 символов)').fill(password);
  await page.getByLabel('Повторите пароль').fill(password);
  await page.getByRole('button', { name: 'Создать владельца' }).click();

  await expect(page.getByRole('heading', { name: 'Сохраните recovery codes' })).toBeVisible();
  await page.getByRole('button', { name: 'Я сохранил коды — продолжить' }).click();

  await expect(page.getByRole('heading', { name: 'Включите 2FA' })).toBeVisible();
  const secret = (await page.locator('code').textContent())?.trim() ?? '';
  expect(secret.length).toBeGreaterThan(10);

  await page.getByLabel('Код из приложения').fill(generateSync({ secret }));
  await page.getByRole('button', { name: 'Включить 2FA' }).click();

  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByRole('heading', { name: 'Дашборд' })).toBeVisible();

  await page.goto('/setup-2fa');
  await expect(page).toHaveURL(/\/dashboard$/);

  await page.getByRole('button', { name: 'Выйти' }).first().click();
  await expect(page).toHaveURL(/\/login$/);

  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Пароль').fill(password);
  await page.getByRole('button', { name: 'Войти' }).click();

  await expect(page.getByRole('heading', { name: 'Двухфакторная проверка' })).toBeVisible();
  await page.getByLabel('Код').fill(generateSync({ secret }));
  await page.getByRole('button', { name: 'Подтвердить' }).click();
  await expect(page).toHaveURL(/\/dashboard$/);

  await page.goto('/settings/security');
  await expect(page.getByRole('heading', { name: 'Безопасность' })).toBeVisible();

  await page.getByLabel('Текущий пароль').fill(password);
  await page.getByLabel('Новый пароль (минимум 12 символов)').fill(newPassword);
  await page.getByRole('button', { name: 'Изменить пароль' }).click();
  await expect(page.getByText('Пароль изменён. Текущая сессия обновлена')).toBeVisible();

  await page.getByRole('button', { name: 'Выйти' }).first().click();
  await expect(page).toHaveURL(/\/login$/);

  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Пароль').fill(newPassword);
  await page.getByRole('button', { name: 'Войти' }).click();
  await expect(page.getByRole('heading', { name: 'Двухфакторная проверка' })).toBeVisible();
  await page.getByLabel('Код').fill(generateSync({ secret }));
  await page.getByRole('button', { name: 'Подтвердить' }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
});

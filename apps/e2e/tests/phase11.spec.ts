import { expect, test } from '@playwright/test';
import { generateSync } from 'otplib';
import { Client } from 'pg';

const setupToken = process.env.SETUP_TOKEN ?? '';
const password = 'correct horse battery staple';
const masterPassword = 'vault master password 123';

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
  } finally {
    await client.end();
  }
});

test('encrypted vault, tasks and notes through the UI', async ({ page }) => {
  const email = `playwright-phase11-${Date.now()}@example.com`;

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

  const nav = page.getByRole('navigation', { name: 'Основная навигация' });

  await nav.getByRole('link', { name: 'Хранилище' }).click();
  await expect(page.getByRole('heading', { name: 'Хранилище', exact: true })).toBeVisible();
  await page.getByLabel('Мастер-пароль').fill(masterPassword);
  await page.getByLabel('Повторите пароль').fill(masterPassword);
  await page.getByRole('button', { name: 'Создать хранилище' }).click();
  await expect(page.getByText('Хранилище создано')).toBeVisible();

  await page.getByRole('button', { name: 'Добавить запись' }).first().click();
  const vaultDialog = page.getByRole('dialog');
  await vaultDialog.getByLabel('Название').click();
  await vaultDialog.getByLabel('Название').pressSequentially('Test Login', { delay: 20 });
  await expect(vaultDialog.getByLabel('Название')).toHaveValue('Test Login');
  await vaultDialog.getByLabel('Логин').fill('user@example.com');
  await vaultDialog.getByRole('button', { name: 'Сгенерировать' }).click();
  await expect(vaultDialog.getByLabel('Пароль', { exact: true })).not.toHaveValue('');
  await vaultDialog.getByLabel('Пароль', { exact: true }).fill('s3cret-password');
  await vaultDialog.getByLabel('Ссылка').fill('https://example.com');
  await vaultDialog.getByLabel('Заметки').fill('Тестовая запись vault');
  await vaultDialog.getByRole('button', { name: 'Сохранить' }).click();

  await expect(page.getByText('Test Login')).toBeVisible();
  await expect(page.getByText('user@example.com')).toBeVisible();
  await page.getByRole('button', { name: 'Показать' }).click();
  await expect(page.getByText('s3cret-password')).toBeVisible();

  const vaultResponse = await page.request.get('/api/v1/vault');
  expect(vaultResponse.status()).toBe(200);
  const vaultBody = await vaultResponse.text();
  expect(vaultBody).not.toContain('Test Login');
  expect(vaultBody).not.toContain('s3cret-password');
  expect(vaultBody).not.toContain('Тестовая запись vault');

  await page.reload();
  await expect(page.getByText('Хранилище заблокировано', { exact: true })).toBeVisible();
  await page.getByLabel('Мастер-пароль').fill('wrong master password');
  await page.getByRole('button', { name: 'Разблокировать' }).click();
  await expect(page.getByText('Неверный мастер-пароль.')).toBeVisible();

  await page.getByLabel('Мастер-пароль').fill(masterPassword);
  await page.getByRole('button', { name: 'Разблокировать' }).click();
  await expect(page.getByText('Test Login')).toBeVisible();
  await expect(page.getByText('user@example.com')).toBeVisible();

  await page.getByRole('button', { name: 'Изменить' }).click();
  const editDialog = page.getByRole('dialog');
  await expect(editDialog.getByLabel('Пароль', { exact: true })).toHaveValue('s3cret-password');
  await page
    .getByRole('button', { name: 'Заблокировать' })
    .evaluate((node) => (node as { click: () => void }).click());
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByText('Хранилище заблокировано', { exact: true })).toBeVisible();

  await page.getByLabel('Мастер-пароль').fill(masterPassword);
  await page.getByRole('button', { name: 'Разблокировать' }).click();
  await expect(page.getByText('Test Login')).toBeVisible();

  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'В архив' }).click();
  await expect(page.getByText('Test Login')).toHaveCount(0);
  await page.getByLabel('Архив').check();
  await expect(page.getByText('Test Login')).toBeVisible();
  await page.getByRole('button', { name: 'Вернуть' }).click();
  await expect(page.getByRole('button', { name: 'В архив' })).toBeVisible();
  await page.getByLabel('Архив').uncheck();
  await expect(page.getByText('Test Login')).toBeVisible();

  await nav.getByRole('link', { name: 'Задачи' }).click();
  await expect(page.getByRole('heading', { name: 'Задачи', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Новая задача' }).first().click();
  const taskDialog = page.getByRole('dialog');
  await taskDialog.getByLabel('Название').click();
  await taskDialog.getByLabel('Название').pressSequentially('Проверить BASED', { delay: 20 });
  await expect(taskDialog.getByLabel('Название')).toHaveValue('Проверить BASED');
  await taskDialog.getByLabel('Описание').fill('Пересмотреть тезис');
  await taskDialog.getByRole('button', { name: 'Сохранить' }).click();
  await expect(page.getByText('Проверить BASED')).toBeVisible();
  await page.getByRole('button', { name: 'Завершить' }).click();
  await expect(page.getByText('Выполнена', { exact: true })).toBeVisible();

  await nav.getByRole('link', { name: 'Хранилище' }).click();
  await expect(page.getByText('Хранилище заблокировано', { exact: true })).toBeVisible();

  await nav.getByRole('link', { name: 'Заметки' }).click();
  await expect(page.getByRole('heading', { name: 'Заметки', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Новая заметка' }).first().click();
  const noteDialog = page.getByRole('dialog');
  await noteDialog.getByLabel('Заголовок').click();
  await noteDialog.getByLabel('Заголовок').pressSequentially('Идея по портфелю', { delay: 20 });
  await expect(noteDialog.getByLabel('Заголовок')).toHaveValue('Идея по портфелю');
  await noteDialog.getByLabel('Текст').click();
  await noteDialog
    .getByLabel('Текст')
    .pressSequentially('Проверить корреляцию BASED и LINK', { delay: 20 });
  await expect(noteDialog.getByLabel('Текст')).toHaveValue('Проверить корреляцию BASED и LINK');
  await noteDialog.getByLabel('Теги (через запятую)').fill('идея, риск');
  await noteDialog.getByRole('button', { name: 'Сохранить' }).click();
  await expect(page.getByText('Идея по портфелю')).toBeVisible();
  await expect(page.getByText('Проверить корреляцию BASED и LINK')).toBeVisible();
  await page.getByLabel('Поиск по заметкам').fill('корреляцию');
  await expect(page.getByText('Идея по портфелю')).toBeVisible();
});

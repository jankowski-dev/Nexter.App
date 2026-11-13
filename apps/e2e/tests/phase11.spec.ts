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
      'truncate table prices, market_quotes, audit_log, sessions, settings, rate_limits, users restart identity cascade',
    );
  } finally {
    await client.end();
  }
});

test('encrypted vault, tasks and notes through the UI', async ({ page }) => {
  const email = `playwright-phase11-${Date.now()}@example.com`;
  const habitStartedOn = new Date().toISOString().slice(0, 10);

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

  await page.getByRole('button', { name: 'Добавить', exact: true }).click();
  const habitDialog = page.getByRole('dialog');
  await habitDialog.getByLabel('Название').fill('Без сахара');
  await habitDialog.getByLabel('Дата начала воздержания').fill(habitStartedOn);
  await habitDialog.getByRole('button', { name: 'Сохранить' }).click();
  await expect(page.getByText('Без сахара')).toBeVisible();
  await page.getByRole('button', { name: 'Удалить привычку Без сахара' }).click();
  await expect.poll(() => page.evaluate('document.body.style.overflow')).toBe('hidden');
  await page.getByRole('button', { name: 'Удалить', exact: true }).click();
  await expect(page.getByText('Без сахара')).toHaveCount(0);
  await expect.poll(() => page.evaluate('document.body.style.overflow')).toBe('');
  await page.getByRole('button', { name: 'Архив', exact: true }).click();
  await expect(page.getByText('Без сахара')).toBeVisible();
  await page.getByRole('button', { name: 'Вернуть' }).click();
  await page.getByRole('button', { name: 'Активные', exact: true }).click();
  await expect(page.getByText('Без сахара')).toBeVisible();

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
  await expect(page.getByLabel('Мастер-пароль')).toBeVisible();
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
  await expect(page.getByLabel('Мастер-пароль')).toBeVisible();

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
  await expect(page.getByRole('tab', { name: 'Список' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('tab', { name: 'Календарь' })).toBeVisible();

  const today = new Date();
  const todayKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(
    today.getDate(),
  ).padStart(2, '0')}`;

  await page.getByRole('button', { name: 'Новая задача' }).first().click();
  const taskDialog = page.getByRole('dialog');
  await taskDialog.getByLabel('Название').fill('Проверить BASED');
  await taskDialog.getByLabel('Описание').fill('Пересмотреть тезис');
  await taskDialog.getByLabel('Срок').fill(todayKey);
  await taskDialog.getByLabel('Теги (через запятую)').fill('риск, портфель');
  await taskDialog.locator('input[type="file"]').setInputFiles({
    name: 'dot.png',
    mimeType: 'image/png',
    buffer: Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAEUlEQVR4nGP4z8DwH4QZYAwAR8oH+WdZbrcAAAAASUVORK5CYII=',
      'base64',
    ),
  });
  await expect(taskDialog.getByAltText('dot.jpg')).toBeVisible();
  await taskDialog.getByRole('button', { name: 'Готово' }).click();
  await expect(taskDialog.getByRole('heading', { name: 'Проверить BASED' })).toBeVisible();
  await expect(taskDialog.getByLabel('Название')).toHaveCount(0);
  await expect(taskDialog.getByText('Пересмотреть тезис')).toBeVisible();
  await expect(taskDialog.getByAltText('dot.jpg')).toBeVisible();
  await taskDialog.getByLabel('Закрыть').click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('tab', { name: 'Календарь' }).click();

  const todayCell = page.locator(`[data-date="${todayKey}"]`);
  await expect(todayCell.getByRole('button', { name: /Проверить BASED/ })).toBeVisible();
  await todayCell.getByRole('button', { name: /Проверить BASED/ }).click();
  const completedTaskDrawer = page.getByRole('dialog');
  await completedTaskDrawer.getByRole('button', { name: 'Завершить' }).click();
  await expect(completedTaskDrawer.getByText('Выполнена', { exact: true })).toBeVisible();
  await completedTaskDrawer.getByLabel('Закрыть').click();
  await expect(todayCell.getByRole('button', { name: /Проверить BASED/ })).toHaveClass(
    /bg-emerald-50/,
  );

  await page.getByRole('tab', { name: 'Список' }).click();
  await page.getByRole('tab', { name: 'Открытые' }).click();
  await page.getByRole('button', { name: 'Новая задача' }).first().click();
  const listTaskDialog = page.getByRole('dialog');
  await listTaskDialog.getByLabel('Название').fill('Задача для списка');
  await listTaskDialog.getByLabel('Описание').fill('Скрытое описание');
  await listTaskDialog.getByLabel('Теги (через запятую)').fill('тег1, тег2');
  await listTaskDialog.getByRole('button', { name: 'Готово' }).click();
  await expect(listTaskDialog.getByRole('heading', { name: 'Задача для списка' })).toBeVisible();
  await listTaskDialog.getByLabel('Закрыть').click();
  await expect(page.getByText('Задача для списка')).toBeVisible();
  await expect(page.getByText('Скрытое описание')).toHaveCount(0);
  await expect(page.getByText('тег1, тег2')).toBeVisible();

  await page.getByRole('button', { name: 'Открыть задачу Задача для списка' }).click();
  const taskView = page.getByRole('dialog');
  await expect(taskView.getByText('Скрытое описание')).toBeVisible();
  await taskView.getByRole('button', { name: 'Изменить' }).click();
  await expect(taskView.getByLabel('Название')).toHaveValue('Задача для списка');
  await expect(taskView.getByRole('combobox', { name: 'Повтор' })).toHaveCount(0);
  await taskView.getByRole('button', { name: 'Готово' }).click();
  await expect(taskView.getByRole('heading', { name: 'Задача для списка' })).toBeVisible();
  await taskView.getByLabel('Закрыть').click();

  await page.getByRole('button', { name: 'Завершить задачу' }).click();
  await expect(page.getByText('Задача для списка')).toHaveCount(0);
  await page.getByRole('tab', { name: 'Выполненные' }).click();
  await expect(page.getByText('Задача для списка')).toBeVisible();

  const listTaskRow = page.locator('[data-task-id]').filter({ hasText: 'Задача для списка' });
  await listTaskRow.getByRole('button', { name: 'Удалить задачу' }).click();
  await expect(page.getByRole('heading', { name: 'Удалить задачу?' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Изменить задачу' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Отменить удаление задачи' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await listTaskRow.getByRole('button', { name: 'Удалить задачу' }).click();
  await page.getByRole('button', { name: 'Подтвердить удаление задачи' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByText('Задача для списка')).toHaveCount(0);

  await page.getByRole('button', { name: 'Архивные' }).click();
  await expect(page.getByText('Задача для списка')).toBeVisible();
  await page.getByRole('button', { name: 'Вернуть задачу' }).click();
  await expect(page.getByText('Задача для списка')).toHaveCount(0);
  await page.getByRole('button', { name: 'Актуальные' }).click();
  await page.getByRole('tab', { name: 'Выполненные' }).click();
  await expect(page.getByText('Задача для списка')).toBeVisible();

  const monthValue = String(today.getMonth() + 1).padStart(2, '0');
  const firstDate = `${today.getFullYear()}-${monthValue}-10`;
  const secondDate = `${today.getFullYear()}-${monthValue}-11`;
  const lastDate = `${today.getFullYear()}-${monthValue}-24`;

  await page.getByRole('button', { name: 'Актуальные' }).click();
  await page.getByRole('tab', { name: 'Календарь' }).click();
  await page.getByRole('button', { name: 'Новая задача' }).first().click();
  const recurringDialog = page.getByRole('dialog');
  await recurringDialog.getByLabel('Название').fill('Календарная задача');
  await recurringDialog.getByLabel('Срок').fill(firstDate);
  await recurringDialog.getByRole('combobox', { name: 'Повтор' }).selectOption('weekly');
  await recurringDialog.getByLabel('Повторять до (необязательно)').fill(lastDate);
  await recurringDialog.getByRole('button', { name: 'Готово' }).click();
  await expect(recurringDialog.getByRole('heading', { name: 'Календарная задача' })).toBeVisible();
  await recurringDialog.getByLabel('Закрыть').click();

  const firstCell = page.locator(`[data-date="${firstDate}"]`);
  const secondCell = page.locator(`[data-date="${secondDate}"]`);
  const chip = firstCell.getByRole('button', { name: /Календарная задача/ });
  await expect(chip).toBeVisible();
  await chip.dragTo(secondCell);

  await expect(secondCell.getByRole('button', { name: /Календарная задача/ })).toBeVisible();
  await expect(firstCell.getByRole('button', { name: /Календарная задача/ })).toHaveCount(0);
  await secondCell.getByRole('button', { name: /Календарная задача/ }).click();
  const movedDrawer = page.getByRole('dialog');
  await expect(movedDrawer.getByText('↻ Еженедельно')).toBeVisible();
  await movedDrawer.getByRole('button', { name: 'Изменить' }).click();
  await expect(movedDrawer.getByText(/Повтор: Еженедельно/)).toBeVisible();
  await expect(movedDrawer.getByLabel('Срок')).toHaveValue(secondDate);
  await movedDrawer.getByRole('button', { name: 'Готово' }).click();
  await expect(movedDrawer.getByRole('heading', { name: 'Календарная задача' })).toBeVisible();
  await movedDrawer.getByLabel('Закрыть').click();

  await page.getByRole('tab', { name: 'Список' }).click();
  await page.getByRole('tab', { name: 'Открытые' }).click();
  await expect(page.getByText('↻ Повтор').first()).toBeVisible();

  await nav.getByRole('link', { name: 'Хранилище' }).click();
  await expect(page.getByLabel('Мастер-пароль')).toBeVisible();

  await nav.getByRole('link', { name: 'Заметки' }).click();
  await expect(page.getByRole('heading', { name: 'Заметки', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Новая заметка' }).first().click();
  const noteDrawer = page.getByRole('dialog');
  await noteDrawer.getByLabel('Заголовок заметки').click();
  await noteDrawer
    .getByLabel('Заголовок заметки')
    .pressSequentially('Идея по портфелю', { delay: 20 });
  await expect(noteDrawer.getByLabel('Заголовок заметки')).toHaveValue('Идея по портфелю');
  await noteDrawer.getByLabel('Текст заметки').click();
  await noteDrawer
    .getByLabel('Текст заметки')
    .pressSequentially('Проверить корреляцию BASED и LINK', { delay: 20 });
  await expect(noteDrawer.getByLabel('Текст заметки')).toHaveValue(
    'Проверить корреляцию BASED и LINK',
  );
  await noteDrawer.getByLabel('Теги (через запятую)').fill('идея, риск');
  await noteDrawer.getByRole('button', { name: 'Готово' }).click();
  await expect(noteDrawer).toBeVisible();
  await expect(noteDrawer.getByRole('heading', { name: 'Идея по портфелю' })).toBeVisible();
  await expect(noteDrawer.getByLabel('Заголовок заметки')).toHaveCount(0);
  await expect(noteDrawer.getByLabel('Текст заметки')).toHaveCount(0);
  await noteDrawer.getByLabel('Закрыть').click();
  await expect(page.getByRole('dialog')).toHaveCount(0);

  await page.getByText('Идея по портфелю').first().click();
  const noteView = page.getByRole('dialog');
  await expect(noteView.getByText('Проверить корреляцию BASED и LINK')).toBeVisible();
  await noteView.getByLabel('Закрыть').click();
  await expect(page.getByRole('dialog')).toHaveCount(0);

  await page.getByLabel('Поиск по заметкам').fill('корреляцию');
  await expect(page.getByText('Идея по портфелю')).toBeVisible();

  await page.getByText('Идея по портфелю').first().click();
  const deleteDrawer = page.getByRole('dialog');
  await deleteDrawer.getByRole('button', { name: 'Удалить' }).click();
  await expect(page.getByRole('heading', { name: 'Удалить заметку?' })).toBeVisible();
  await page.getByRole('button', { name: 'Отменить удаление' }).click();
  await expect(page.getByRole('heading', { name: 'Удалить заметку?' })).toHaveCount(0);
  await deleteDrawer.getByRole('button', { name: 'Удалить' }).click();
  await page.getByRole('button', { name: 'Подтвердить удаление' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByText('Идея по портфелю')).toHaveCount(0);

  await page.getByRole('button', { name: 'Архивные' }).click();
  await expect(page.getByText('Идея по портфелю')).toBeVisible();
  await page.getByRole('button', { name: 'Вернуть заметку' }).click();
  await page.getByRole('button', { name: 'Актуальные' }).click();
  await expect(page.getByText('Идея по портфелю')).toBeVisible();
});

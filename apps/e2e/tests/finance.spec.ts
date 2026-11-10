import { expect, test } from '@playwright/test';
import { generateSync } from 'otplib';
import { Client } from 'pg';

const setupToken = process.env.SETUP_TOKEN ?? '';
const password = 'correct horse battery staple';

function previousMonthLabel(): string {
  const date = new Date();
  date.setDate(1);
  date.setMonth(date.getMonth() - 1);
  const value = new Intl.DateTimeFormat('ru-RU', { month: 'long', year: 'numeric' }).format(date);
  return value.charAt(0).toUpperCase() + value.slice(1);
}

test.skip(process.env.NEXTER_TEST_DB !== '1', 'Test DB only');

test.beforeAll(async () => {
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

test('finance accounts, operations, transfers and overview through the UI', async ({ page }) => {
  const email = `playwright-finance-${Date.now()}@example.com`;
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
  const post = async (url: string, data: Record<string, unknown>) => {
    const response = await page.request.post(url, {
      headers: { 'x-csrf-token': csrf },
      data,
    });
    expect(response.status()).toBe(201);
    return response.json();
  };
  const today = new Date().toISOString().slice(0, 10);

  const card = (await post('/api/v1/finance/accounts', {
    name: 'Карта',
    kind: 'card',
    currency: 'BYN',
    openingBalance: '100',
    openingDate: '2026-05-27',
    fxRate: '1',
  })) as { id: string };
  const cash = (await post('/api/v1/finance/accounts', {
    name: 'Наличные',
    kind: 'cash',
    currency: 'BYN',
    openingBalance: '0',
    openingDate: '2026-05-27',
    fxRate: '1',
  })) as { id: string };
  const incomeCategory = (await post('/api/v1/finance/categories', {
    name: 'Доход',
    kind: 'income',
  })) as { id: string };
  const expenseCategory = (await post('/api/v1/finance/categories', {
    name: 'Продукты',
    kind: 'expense',
  })) as { id: string };

  await post('/api/v1/finance/transactions', {
    kind: 'income',
    occurredOn: today,
    accountId: card.id,
    categoryId: incomeCategory.id,
    amount: '1000',
    title: 'Зарплата',
  });
  await post('/api/v1/finance/transactions', {
    kind: 'expense',
    occurredOn: today,
    accountId: card.id,
    categoryId: expenseCategory.id,
    amount: '250',
    title: 'Продукты',
  });
  await post('/api/v1/finance/transfers', {
    kind: 'card_topup',
    occurredOn: today,
    fromAccountId: card.id,
    toAccountId: cash.id,
    fromAmount: '100',
    toAmount: '100',
  });

  await page.goto('/finance');
  await expect(page.getByRole('heading', { name: 'Финансы' })).toBeVisible();
  await expect(page.getByText('Чистый капитал')).toBeVisible();
  await expect(page.getByText('Net worth')).toHaveCount(0);
  await expect(page.getByText('850,00 BYN').first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Текущий месяц' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(page.getByRole('button', { name: 'Прошлый месяц' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Выбрать месяц' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'За год' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'За всё время' })).toBeVisible();

  await page.getByRole('button', { name: 'Прошлый месяц' }).click();
  await expect(page.getByRole('button', { name: 'Прошлый месяц' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(page.getByText(previousMonthLabel()).first()).toBeVisible();
  await page.getByRole('button', { name: 'За всё время' }).click();
  await expect(page.getByRole('button', { name: 'За всё время' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.getByRole('button', { name: 'Текущий месяц' }).click();

  await page.getByRole('tab', { name: 'Категории' }).click();
  await page.getByRole('button', { name: '+ Категория' }).first().click();
  const categoryDialog = page.getByRole('dialog');
  await categoryDialog.getByLabel('Название').fill('Проверка цвета');
  await categoryDialog.getByRole('button', { name: 'Цвет категории: Серый' }).click();
  await categoryDialog.getByRole('option', { name: 'Зелёный' }).click();
  await expect(
    categoryDialog.getByRole('button', { name: 'Цвет категории: Зелёный' }),
  ).toBeVisible();
  await categoryDialog.getByRole('button', { name: 'Сохранить' }).click();
  await expect(page.getByText('Проверка цвета')).toBeVisible();

  const categoryRow = page.getByText('Проверка цвета').locator('xpath=ancestor::div[1]');
  await categoryRow.getByRole('button', { name: 'Изменить' }).click();
  const editCategoryDialog = page.getByRole('dialog');
  await editCategoryDialog.getByRole('button', { name: 'Цвет категории: Зелёный' }).click();
  await page.keyboard.press('Escape');
  await expect(editCategoryDialog).toBeVisible();
  await expect(editCategoryDialog.getByRole('option', { name: 'Красный' })).toHaveCount(0);
  await editCategoryDialog.getByRole('button', { name: 'Цвет категории: Зелёный' }).click();
  await editCategoryDialog.getByRole('option', { name: 'Красный' }).click();
  await editCategoryDialog.getByRole('button', { name: 'Сохранить' }).click();
  await expect(page.getByText('Проверка цвета')).toBeVisible();

  await page.getByRole('tab', { name: 'Операции' }).click();
  await expect(page.getByText('Зарплата')).toBeVisible();
  await expect(page.getByText('Продукты').first()).toBeVisible();

  const incomeRow = page.getByRole('row').filter({ hasText: 'Зарплата' });
  await incomeRow.getByRole('button', { name: 'Изменить' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Сумма').fill('1200');
  await dialog.getByRole('button', { name: 'Сохранить' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);

  await page.getByRole('tab', { name: 'Счета' }).click();
  await expect(page.getByText('950,00 BYN').first()).toBeVisible();
  await expect(page.getByText('100,00 BYN').first()).toBeVisible();

  await page.getByRole('button', { name: 'Получить кредит' }).click();
  const creditDialog = page.getByRole('dialog');
  await creditDialog.getByLabel('Название').fill('Кредит на авто');
  await creditDialog.getByLabel('Сумма кредита').fill('500');
  await creditDialog.getByLabel('Куда зачислить деньги').selectOption(card.id);
  await creditDialog.getByRole('button', { name: 'Получить кредит' }).click();
  await expect(page.getByText('Кредит на авто')).toBeVisible();
  await expect(page.getByText('1 450,00 BYN').first()).toBeVisible();

  await page.getByRole('tab', { name: 'Импорт' }).click();
  await expect(page.getByText('История импортов')).toBeVisible();
});

import { expect, test } from '@playwright/test';
import { generateSync } from 'otplib';
import { Client } from 'pg';

const setupToken = process.env.SETUP_TOKEN ?? '';
const password = 'correct horse battery staple';
const wallet = '0x1111111111111111111111111111111111111111';
const usdc = '0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d';
const based = '0x1d28d989f9e3ccb8b15d0cec601734514f958e4d';

test.skip(
  process.env.NEXTER_TEST_DB !== '1',
  'Set NEXTER_TEST_DB=1 and use a dedicated test database; this suite truncates auth tables.',
);

test.beforeAll(async () => {
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

test('buy drawer preview and manual operations UI', async ({ page }) => {
  const email = `playwright-swap-${Date.now()}@example.com`;

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

  const swapsEnabled = true;

  await page.route('**/api/v1/swap/config', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        enabled: swapsEnabled,
        killSwitch: !swapsEnabled,
        providerConfigured: true,
        providerMode: 'gateway',
        walletConnectProjectId: '11111111111111111111111111111111',
        buildEnabled: true,
        executionEnabled: false,
        rpcConfigured: true,
        walletAllowlistConfigured: false,
        chains: [
          {
            code: 'bsc',
            chainId: 56,
            name: 'BNB Smart Chain',
            tokens: [
              { symbol: 'USDC', name: 'USD Coin', address: usdc, decimals: 18, native: false },
              { symbol: 'BASED', name: 'BASED', address: based, decimals: 18, native: false },
              {
                symbol: 'BNB',
                name: 'BNB',
                address: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE',
                decimals: 18,
                native: true,
              },
            ],
            rpcConfigured: true,
            executionEnabled: false,
          },
        ],
        quoteTtlSeconds: 15,
        maxPriceImpactBps: 200,
        stepUpThresholdUsd: '500.00',
        defaultSlippageBps: 50,
        maxSlippageBps: 200,
      }),
    });
  });

  await page.route('**/api/v1/swap/preview', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        chain: 'bsc',
        tokenIn: { symbol: 'USDC', name: 'USD Coin', address: usdc, decimals: 18, native: false },
        tokenOut: { symbol: 'BASED', name: 'BASED', address: based, decimals: 18, native: false },
        amountIn: '1.000000000000000000',
        amountOut: '2.000000000000000000',
        minOut: '1.990000000000000000',
        slippageBps: 50,
        priceImpactBps: 10,
        amountInUsd: '1.00',
        amountOutUsd: '1.02',
        gasUsd: '0.01',
        routeId: 'route-ui',
        fetchedAt: new Date().toISOString(),
      }),
    });
  });

  await page.route('**/api/v1/swap/quote', async (route) => {
    await route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify({
        id: '11111111-1111-4111-8111-111111111111',
        chain: 'bsc',
        walletAddress: wallet,
        accountId: null,
        tokenIn: { symbol: 'USDC', name: 'USD Coin', address: usdc, decimals: 18, native: false },
        tokenOut: { symbol: 'BASED', name: 'BASED', address: based, decimals: 18, native: false },
        amountIn: '1.000000000000000000',
        amountOut: '2.000000000000000000',
        executedAmountIn: null,
        executedAmountOut: null,
        amountInUsd: '1.00',
        amountOutUsd: '0.99',
        minOut: '1.990000000000000000',
        slippageBps: 50,
        priceImpactBps: 10,
        gasUsd: '0.05000000',
        routeId: 'route-ui',
        status: 'QUOTED',
        quoteExpiresAt: new Date(Date.now() + 15_000).toISOString(),
        builtAt: null,
        deadline: null,
        submittedAt: null,
        confirmedAt: null,
        cancelledAt: null,
        confirmations: 0,
        txHash: null,
        blockNumber: null,
        networkFeeWei: null,
        networkFeeUsd: null,
        accountingTransactionId: null,
        tradeGroupId: null,
        createdAt: new Date().toISOString(),
        routerAddress: '0x6131B5fae19EA4f9D964eAc0408E4408b66337b5',
        calldata: null,
        transactionValue: null,
        gasEstimate: null,
        closeGroupIds: [],
        errors: [],
        events: [],
      }),
    });
  });

  const assets = (
    (await (await page.request.get('/api/v1/assets')).json()) as {
      assets: Array<{ id: string; symbol: string; chainCode: string }>;
    }
  ).assets;
  const basedAssetId = assets.find(
    (asset) => asset.symbol === 'BASED' && asset.chainCode === 'bsc',
  )?.id;
  const linkAssetId = assets.find(
    (asset) => asset.symbol === 'LINK' && asset.chainCode === 'bsc',
  )?.id;
  expect(basedAssetId).toBeDefined();
  expect(linkAssetId).toBeDefined();

  const csrf =
    (await page.context().cookies()).find((cookie) => cookie.name === 'nexter_csrf')?.value ?? '';
  await page.request.post('/api/v1/watchlist', {
    headers: { 'x-csrf-token': csrf },
    data: { assetId: basedAssetId },
  });

  await page.reload();
  await page.goto('/portfolio');
  const basedRow = page.getByRole('row').filter({ hasText: 'BASED' }).first();
  await expect(basedRow).toBeVisible();
  await basedRow.getByRole('button', { name: 'Купить' }).click();

  const buyDrawer = page.getByRole('dialog');
  await expect(buyDrawer.getByRole('heading', { name: 'Создание ордера · BASED' })).toBeVisible();
  await buyDrawer.getByLabel('Сколько USDC потратить').fill('1');
  await expect(buyDrawer.getByText('Получите BASED')).toBeVisible();
  await expect(buyDrawer.getByText('2', { exact: true }).first()).toBeVisible();
  await expect(buyDrawer.getByText('KyberSwap')).toBeVisible();
  await expect(buyDrawer.getByRole('tab', { name: 'Вручную' })).toBeVisible();
  await expect(buyDrawer.getByRole('button', { name: 'Купить BASED' })).toBeDisabled();

  const manualForm = buyDrawer.locator('#manual-order-form');
  await buyDrawer.getByRole('tab', { name: 'Вручную' }).click();
  await manualForm.getByLabel('Количество BASED').fill('2');
  await buyDrawer.getByRole('tab', { name: 'Ончейн' }).click();
  await expect(buyDrawer.getByLabel('Сколько USDC потратить')).toHaveValue('1');
  await buyDrawer.getByRole('tab', { name: 'Вручную' }).click();
  await expect(manualForm.getByLabel('Количество BASED')).toHaveValue('2');

  await buyDrawer.getByRole('button', { name: 'Закрыть' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);

  await page.goto('/operations');
  await expect(page.getByRole('button', { name: 'Обмен on-chain' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Новая операция' }).click();
  const operationDrawer = page.getByRole('dialog');
  await expect(operationDrawer.getByRole('heading', { name: 'Новая операция' })).toBeVisible();
  for (const tab of ['Обмен', 'Пополнение', 'Вывод', 'Корректировка']) {
    await expect(operationDrawer.getByRole('button', { name: tab })).toBeVisible();
  }
  await expect(operationDrawer.getByRole('button', { name: 'Доход' })).toHaveCount(0);
  await operationDrawer.getByLabel('Закрыть').click();
  await expect(page.getByRole('dialog')).toHaveCount(0);

  const secondGroup = await page.request.post('/api/v1/watchlist/groups', {
    headers: { 'x-csrf-token': csrf },
    data: { name: 'Наблюдение' },
  });
  expect(secondGroup.status()).toBe(201);
  const secondGroupId = ((await secondGroup.json()) as { id: string }).id;
  await page.request.post('/api/v1/watchlist', {
    headers: { 'x-csrf-token': csrf },
    data: { assetId: linkAssetId, groupId: secondGroupId },
  });

  await page.goto('/portfolio');
  const mainList = page.getByRole('table').filter({ hasText: 'Действие' });
  await expect(mainList).toBeVisible();
  await expect(mainList.getByText('LINK', { exact: true })).toHaveCount(0);
});

import { expect, test } from '@playwright/test';
import { generateSync } from 'otplib';
import { Client } from 'pg';

const setupToken = process.env.SETUP_TOKEN ?? '';
const password = 'correct horse battery staple';
const wallet = '0x1111111111111111111111111111111111111111';
const usdc = '0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d';
const based = '0x1d28d989f9e3ccb8b15d0cec601734514f958e4d';
const ethereumUsdc = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48';
const ethereumLink = '0x514910771af9ca656af840dff83e8264ecf986ca';

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

test('read-only BSC quote UI and disabled kill-switch state', async ({ page }) => {
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

  let swapsEnabled = true;

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
        walletAllowlistConfigured: true,
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
          {
            code: 'ethereum',
            chainId: 1,
            name: 'Ethereum',
            tokens: [
              {
                symbol: 'USDC',
                name: 'USD Coin',
                address: ethereumUsdc,
                decimals: 6,
                native: false,
              },
              {
                symbol: 'LINK',
                name: 'ChainLink Token',
                address: ethereumLink,
                decimals: 18,
                native: false,
              },
              {
                symbol: 'ETH',
                name: 'Ether',
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

  await page.route('**/api/v1/swap/orders?limit=5', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        data: [],
        page: { nextCursor: null, hasMore: false },
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
  const usdcAssetId = assets.find(
    (asset) => asset.symbol === 'USDC' && asset.chainCode === 'bsc',
  )?.id;
  expect(basedAssetId).toBeDefined();
  expect(usdcAssetId).toBeDefined();

  async function openEmbeddedSwap() {
    await page.getByRole('button', { name: '+ Операция' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('tab', { name: 'Сделка' })).toBeVisible();
    await dialog.getByLabel('Актив', { exact: true }).selectOption(basedAssetId ?? '');
    await dialog.getByLabel('Количество BASED').fill('1');
    await dialog.getByLabel('Валюта покупки', { exact: true }).selectOption(usdcAssetId ?? '');
    await dialog.getByLabel('Сумма USDC').fill('1');
    const onchain = dialog.getByRole('button', { name: 'Выполнить on-chain' });
    await expect(onchain).toBeEnabled();
    await onchain.click();
    await expect(dialog.getByText('Кошелёк Tangem')).toBeVisible();
    return dialog;
  }

  await page.goto('/dashboard');
  const dialog = await openEmbeddedSwap();
  await expect(dialog.getByRole('button', { name: 'Подключить Tangem' })).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Проверить сборку' })).toBeVisible();
  await expect(
    dialog.getByText('Исполнение для сети BNB Smart Chain выключено.', { exact: false }),
  ).toBeVisible();

  await dialog.getByLabel('Сеть свопа').selectOption('ethereum');
  await expect(dialog.getByLabel('Токен отдачи')).toHaveValue(ethereumUsdc);
  await expect(dialog.getByLabel('Токен получения')).toHaveValue(ethereumLink);
  await dialog.getByLabel('Сеть свопа').selectOption('bsc');

  await dialog.getByLabel('Адрес кошелька').fill(wallet);
  await dialog.getByLabel('Количество токена отдачи').fill('1');
  await dialog.getByRole('button', { name: 'Получить котировку' }).click();

  await expect(dialog.getByText('2 BASED').first()).toBeVisible();
  await expect(dialog.getByText('1 USDC = 2 BASED')).toBeVisible();
  await expect(dialog.getByText(/1 BASED =/)).toBeVisible();
  await expect(dialog.getByText('1,99 BASED')).toBeVisible();
  await expect(dialog.getByText('route-ui')).toBeVisible();
  await expect(dialog.getByText('+0,10%')).toBeVisible();

  swapsEnabled = false;
  await page.reload();
  const disabledDialog = await openEmbeddedSwap();
  await expect(disabledDialog.getByText('Свопы отключены')).toBeVisible();
  await expect(disabledDialog.getByRole('button', { name: 'Получить котировку' })).toBeDisabled();

  await page.goto('/swap');
  await expect(page).toHaveURL(/\/portfolio$/);
});

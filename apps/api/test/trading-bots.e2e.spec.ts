import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import cookie from '@fastify/cookie';
import { eq, sql } from 'drizzle-orm';
import { generateSync } from 'otplib';
import request, { type SuperAgentTest } from 'supertest';
import { botQuoteSamples, createDb, marketQuotes, type Database } from '@nexter/db';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { AllExceptionsFilter } from '../src/shared/errors/all-exceptions.filter';
import { BotRunnerService } from '../src/modules/trading-bots/bot-runner.service';

const canRun = Boolean(
  process.env.NEXTER_TEST_DB === '1' &&
  process.env.DATABASE_URL &&
  process.env.SETUP_TOKEN &&
  process.env.AUTH_ENCRYPTION_KEY,
);

const password = 'correct horse battery staple';

function csrfFrom(response: request.Response): string {
  const setCookie = response.headers['set-cookie'];
  const cookies = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : [];
  const raw = cookies.find((value) => value.startsWith('nexter_csrf='));

  return raw?.split(';')[0]?.split('=')[1] ?? '';
}

describe.runIf(canRun)('Trading bots e2e', () => {
  let app: NestFastifyApplication;
  let db: Database;
  let pool: ReturnType<typeof createDb>['pool'];
  let emailCounter = 0;

  async function setupOwner(agent: SuperAgentTest) {
    const email = `trading-bots-e2e-${Date.now()}-${emailCounter++}@example.com`;
    const setup = await agent
      .post('/api/v1/auth/setup')
      .send({ setupToken: process.env.SETUP_TOKEN, email, password })
      .expect(201);

    const totpSetup = await agent
      .post('/api/v1/auth/2fa/setup')
      .set('x-csrf-token', csrfFrom(setup))
      .expect(200);
    const secret = totpSetup.body.secret as string;
    const enabled = await agent
      .post('/api/v1/auth/2fa/enable')
      .set('x-csrf-token', csrfFrom(setup))
      .send({ code: generateSync({ secret }) })
      .expect(200);

    return {
      userId: setup.body.user.id as string,
      csrf: csrfFrom(enabled),
    };
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    await app.register(cookie as any);
    app.setGlobalPrefix('api/v1', { exclude: ['health', 'ready'] });
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
    await app.getHttpAdapter().getInstance().ready();

    const created = createDb(process.env.DATABASE_URL ?? '');
    db = created.db;
    pool = created.pool;
  }, 30_000);

  beforeEach(async () => {
    await db.execute(
      sql`truncate table bot_quote_samples, prices, market_quotes, users restart identity cascade`,
    );
  });

  afterAll(async () => {
    await app.close();
    await pool.end();
  });

  it('creates a strategy and bot, runs paper trades, reports stats, resets and archives', async () => {
    const agent = request.agent(app.getHttpServer());
    const owner = await setupOwner(agent);

    const assetsResponse = await agent.get('/api/v1/assets').expect(200);
    const assets = assetsResponse.body.assets as Array<{
      id: string;
      symbol: string;
      chainCode: string;
    }>;
    const asset = assets.find((item) => item.symbol === 'BASED') ?? assets[0];
    if (!asset) throw new Error('No seeded asset available for the bot test');

    await agent
      .post('/api/v1/watchlist')
      .set('x-csrf-token', owner.csrf)
      .send({ assetId: asset.id })
      .expect(201);

    const strategies = await agent.get('/api/v1/trading-bots/strategies').expect(200);
    const momentum = strategies.body.data.find(
      (item: { key: string }) => item.key === 'momentum_breakout',
    );
    expect(momentum).toMatchObject({ kind: 'system' });
    expect(momentum.defaultParams).toMatchObject({ fastPeriod: 5, slowPeriod: 20 });
    expect(Array.isArray(momentum.paramFields)).toBe(true);

    const created = await agent
      .post('/api/v1/trading-bots/bots')
      .set('x-csrf-token', owner.csrf)
      .send({
        name: 'Momentum paper bot',
        description: 'E2E paper bot',
        strategyKey: 'momentum_breakout',
        tokenAssetIds: [asset.id],
        budgetUsd: '1000',
        maxPositions: 5,
        positionSizePct: 20,
        feeBps: 25,
        slippageBps: 10,
        maxDailyLossPct: 10,
        cooldownMinutes: 0,
      })
      .expect(201);
    const botId = created.body.bot.id as string;
    expect(created.body.bot.status).toBe('draft');
    expect(created.body.bot.stats.cashUsd).toBe('1000.00000000');

    await agent
      .post('/api/v1/trading-bots/bots')
      .set('x-csrf-token', owner.csrf)
      .send({
        name: 'Invalid budget bot',
        strategyKey: 'momentum_breakout',
        tokenAssetIds: [asset.id],
        budgetUsd: '150',
      })
      .expect(400);

    const now = new Date();
    const samples = Array.from({ length: 40 }, (_, index) => ({
      assetId: asset.id,
      priceUsd: (1 + index * 0.02).toFixed(8),
      change24hPct: '5.0000',
      capturedAt: new Date(now.getTime() - (40 - index) * 60_000),
    }));
    await db.insert(botQuoteSamples).values(samples);

    await db.insert(marketQuotes).values({
      assetId: asset.id,
      priceUsd: '1.78000000',
      change24hPct: '5.0000',
      change7dPct: null,
      change30dPct: null,
      change1yPct: null,
      marketCapUsd: null,
      source: 'test',
      liquidityUsd: '1000000.00',
      fetchedAt: now,
      changedAt: now,
    });

    await agent
      .post(`/api/v1/trading-bots/bots/${botId}/start`)
      .set('x-csrf-token', owner.csrf)
      .expect(201);

    const runner = app.get(BotRunnerService);
    await runner.runOnce();

    let detail = await agent.get(`/api/v1/trading-bots/bots/${botId}`).expect(200);
    expect(detail.body.positions).toHaveLength(1);
    expect(detail.body.bot.stats.tradesCount).toBe(1);
    expect(detail.body.bot.stats.cashUsd).not.toBe('1000.00000000');
    expect(detail.body.bot.stats.totalPnlUsd).not.toBe('0.00000000');

    expect(detail.body.strategy).toMatchObject({ key: 'momentum_breakout', kind: 'system' });
    expect(detail.body.strategyParams).toMatchObject({ fastPeriod: 5, slowPeriod: 20 });

    const tradesAfterBuy = await agent.get(`/api/v1/trading-bots/bots/${botId}/trades`).expect(200);
    expect(tradesAfterBuy.body.data).toHaveLength(1);
    expect(tradesAfterBuy.body.data[0]).toMatchObject({
      side: 'buy',
      asset: { id: asset.id },
    });

    const signalsAfterBuy = await agent
      .get(`/api/v1/trading-bots/bots/${botId}/signals`)
      .expect(200);
    expect(signalsAfterBuy.body.data).toHaveLength(1);
    expect(signalsAfterBuy.body.data[0]).toMatchObject({
      assetId: asset.id,
      action: 'buy',
      hasPosition: true,
    });
    expect(signalsAfterBuy.body.data[0].reason.length).toBeGreaterThan(0);

    await db
      .update(marketQuotes)
      .set({
        priceUsd: '2.50000000',
        change24hPct: '20.0000',
        fetchedAt: new Date(),
        changedAt: new Date(),
      })
      .where(eq(marketQuotes.assetId, asset.id));

    await runner.runOnce();

    detail = await agent.get(`/api/v1/trading-bots/bots/${botId}`).expect(200);
    expect(detail.body.positions).toHaveLength(0);
    expect(detail.body.bot.stats.tradesCount).toBe(2);
    expect(detail.body.bot.stats.wins).toBe(1);
    expect(detail.body.bot.stats.losses).toBe(0);
    expect(detail.body.bot.stats.winRate).toBe('100.00');
    expect(detail.body.bot.stats.realizedPnlUsd).not.toBe('0.00000000');
    expect(Number(detail.body.bot.stats.equityUsd)).toBeGreaterThan(1000);

    const sells = await agent.get(`/api/v1/trading-bots/bots/${botId}/trades`).expect(200);
    expect(sells.body.data.map((trade: { side: string }) => trade.side)).toEqual(['sell', 'buy']);

    const events = await agent.get(`/api/v1/trading-bots/bots/${botId}/events`).expect(200);
    expect(events.body.data.map((event: { type: string }) => event.type)).toEqual(
      expect.arrayContaining(['created', 'started', 'buy', 'sell']),
    );

    const equity = await agent.get(`/api/v1/trading-bots/bots/${botId}/equity`).expect(200);
    expect(equity.body.data.length).toBeGreaterThanOrEqual(2);

    await agent
      .post(`/api/v1/trading-bots/bots/${botId}/stop`)
      .set('x-csrf-token', owner.csrf)
      .expect(201);

    const notifications = await agent.get('/api/v1/notifications').expect(200);
    expect(notifications.body.unreadCount).toBeGreaterThan(0);
    expect(
      notifications.body.data.some(
        (notification: { type: string }) => notification.type === 'bot_stopped',
      ),
    ).toBe(true);

    const unread = await agent.get('/api/v1/notifications/unread-count').expect(200);
    expect(unread.body.count).toBeGreaterThan(0);

    const readAll = await agent
      .post('/api/v1/notifications/read-all')
      .set('x-csrf-token', owner.csrf)
      .expect(201);
    expect(readAll.body.updated).toBeGreaterThan(0);

    const afterRead = await agent.get('/api/v1/notifications/unread-count').expect(200);
    expect(afterRead.body.count).toBe(0);

    const closeBot = await agent
      .post('/api/v1/trading-bots/bots')
      .set('x-csrf-token', owner.csrf)
      .send({
        name: 'Close positions bot',
        description: 'E2E forced close',
        strategyKey: 'momentum_breakout',
        tokenAssetIds: [asset.id],
        budgetUsd: '1000',
        maxPositions: 5,
        positionSizePct: 20,
        feeBps: 25,
        slippageBps: 10,
        maxDailyLossPct: 10,
        cooldownMinutes: 0,
      })
      .expect(201);
    const closeBotId = closeBot.body.bot.id as string;

    await db
      .update(marketQuotes)
      .set({
        priceUsd: '1.78000000',
        change24hPct: '5.0000',
        fetchedAt: new Date(),
        changedAt: new Date(),
      })
      .where(eq(marketQuotes.assetId, asset.id));

    await agent
      .post(`/api/v1/trading-bots/bots/${closeBotId}/start`)
      .set('x-csrf-token', owner.csrf)
      .expect(201);
    await runner.runOnce();

    const closeBotDetail = await agent.get(`/api/v1/trading-bots/bots/${closeBotId}`).expect(200);
    expect(closeBotDetail.body.positions).toHaveLength(1);

    await agent
      .delete(`/api/v1/trading-bots/bots/${closeBotId}`)
      .set('x-csrf-token', owner.csrf)
      .expect(409);

    const closed = await agent
      .post(`/api/v1/trading-bots/bots/${closeBotId}/close-positions`)
      .set('x-csrf-token', owner.csrf)
      .expect(201);
    expect(closed.body.bot.status).toBe('stopped');
    expect(closed.body.positions).toHaveLength(0);
    expect(closed.body.bot.stats.tradesCount).toBe(2);
    expect(closed.body.bot.stats.cashUsd).not.toBe('1000.00000000');

    const closeEvents = await agent
      .get(`/api/v1/trading-bots/bots/${closeBotId}/events`)
      .expect(200);
    expect(closeEvents.body.data.map((event: { type: string }) => event.type)).toEqual(
      expect.arrayContaining(['buy', 'sell', 'closed_all']),
    );

    await agent
      .delete(`/api/v1/trading-bots/bots/${closeBotId}`)
      .set('x-csrf-token', owner.csrf)
      .expect(200);

    const reset = await agent
      .post(`/api/v1/trading-bots/bots/${botId}/reset`)
      .set('x-csrf-token', owner.csrf)
      .expect(201);
    expect(reset.body.bot.status).toBe('stopped');
    expect(reset.body.bot.stats.cashUsd).toBe('1000.00000000');
    expect(reset.body.bot.stats.tradesCount).toBe(0);
    expect(reset.body.positions).toHaveLength(0);
    expect(reset.body.bot.stats.equityUsd).toBe('1000.00000000');

    const updated = await agent
      .patch(`/api/v1/trading-bots/bots/${botId}`)
      .set('x-csrf-token', owner.csrf)
      .send({
        strategyKey: 'mean_reversion',
        strategyParams: {
          lookback: 30,
          entryDropPct: 2,
          exitAbovePct: 0.5,
          takeProfitPct: 5,
          stopLossPct: 5,
        },
      })
      .expect(200);
    expect(updated.body.bot.strategy.key).toBe('mean_reversion');
    expect(updated.body.strategyParams).toMatchObject({ lookback: 30, entryDropPct: 2 });

    await agent
      .delete(`/api/v1/trading-bots/bots/${botId}`)
      .set('x-csrf-token', owner.csrf)
      .expect(200);

    const list = await agent.get('/api/v1/trading-bots/bots').expect(200);
    expect(list.body.data).toHaveLength(0);
  }, 60_000);
});

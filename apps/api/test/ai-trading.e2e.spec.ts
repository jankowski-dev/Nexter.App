import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import cookie from '@fastify/cookie';
import { eq, sql } from 'drizzle-orm';
import { generateSync } from 'otplib';
import request, { type SuperAgentTest } from 'supertest';
import {
  aiCandidates,
  aiPipelineRuns,
  botPositions,
  createDb,
  marketCandles,
  marketQuotes,
  tradingBots,
  type Database,
} from '@nexter/db';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { AllExceptionsFilter } from '../src/shared/errors/all-exceptions.filter';

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

describe.runIf(canRun)('AI trading control center API', () => {
  let app: NestFastifyApplication;
  let db: Database;
  let pool: ReturnType<typeof createDb>['pool'];

  async function setupOwner(agent: SuperAgentTest) {
    const email = `ai-trading-e2e-${Date.now()}@example.com`;
    const setup = await agent
      .post('/api/v1/auth/setup')
      .send({ setupToken: process.env.SETUP_TOKEN, email, password })
      .expect(201);
    const totp = await agent
      .post('/api/v1/auth/2fa/setup')
      .set('x-csrf-token', csrfFrom(setup))
      .expect(200);
    const secret = totp.body.secret as string;
    const enabled = await agent
      .post('/api/v1/auth/2fa/enable')
      .set('x-csrf-token', csrfFrom(setup))
      .send({ code: generateSync({ secret }) })
      .expect(200);
    return { userId: setup.body.user.id as string, csrf: csrfFrom(enabled) };
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
    await db.execute(sql`truncate table prices, market_quotes, users restart identity cascade`);
  });

  afterAll(async () => {
    await app.close();
    await pool.end();
  });

  it('creates a profile, manages the AI universe and service configs', async () => {
    const agent = request.agent(app.getHttpServer());
    const owner = await setupOwner(agent);

    const profile = await agent.get('/api/v1/ai-trading/profile').expect(200);
    expect(Number(profile.body.budgetUsd)).toBe(10000);
    expect(profile.body.workerMaxTokens).toBe(5);

    const updated = await agent
      .put('/api/v1/ai-trading/profile')
      .set('x-csrf-token', owner.csrf)
      .send({ budgetUsd: '25000', maxWorkers: 8 })
      .expect(200);
    expect(Number(updated.body.budgetUsd)).toBe(25000);
    expect(updated.body.maxWorkers).toBe(8);

    const assets = await agent.get('/api/v1/assets').expect(200);
    const based = (assets.body.assets as Array<{ id: string; symbol: string }>).find(
      (asset) => asset.symbol === 'BASED',
    );
    expect(based).toBeDefined();

    const token = await agent
      .post('/api/v1/ai-trading/profile/tokens')
      .set('x-csrf-token', owner.csrf)
      .send({ assetId: based?.id, timeframes: ['1h', '1d'], priority: 5 })
      .expect(201);
    expect(token.body.asset.symbol).toBe('BASED');
    expect(token.body.timeframes).toEqual(['1h', '1d']);

    const tokens = await agent.get('/api/v1/ai-trading/profile/tokens').expect(200);
    expect(tokens.body.data).toHaveLength(1);

    const patched = await agent
      .patch(`/api/v1/ai-trading/profile/tokens/${token.body.id}`)
      .set('x-csrf-token', owner.csrf)
      .send({ enabled: false, timeframes: ['1d'] })
      .expect(200);
    expect(patched.body.enabled).toBe(false);
    expect(patched.body.timeframes).toEqual(['1d']);

    await agent
      .patch(`/api/v1/ai-trading/profile/tokens/${token.body.id}`)
      .set('x-csrf-token', owner.csrf)
      .send({ enabled: true })
      .expect(200);

    const coverage = await agent.get('/api/v1/ai-trading/coverage').expect(200);
    expect(coverage.body.tokens).toHaveLength(1);
    expect(coverage.body.tokens[0].timeframes).toHaveLength(1);
    expect(coverage.body.tokens[0].timeframes[0]).toMatchObject({
      timeframe: '1d',
      candles: 0,
      status: 'missing',
    });

    const refreshed = await agent
      .post('/api/v1/ai-trading/data/refresh')
      .set('x-csrf-token', owner.csrf)
      .send({ days: 30 })
      .expect(201);
    expect(refreshed.body.pairs).toBe(1);
    expect(refreshed.body.upserted).toBe(0);
    expect(refreshed.body.failed).toHaveLength(1);

    const assetId = based?.id as string;
    await agent
      .post('/api/v1/watchlist')
      .set('x-csrf-token', owner.csrf)
      .send({ assetId })
      .expect(201);
    const now = Date.now();
    await db.insert(marketCandles).values(
      Array.from({ length: 120 }, (_, index) => {
        const close = 100 + index;
        return {
          assetId,
          timeframe: '1d',
          openTime: new Date(now - (119 - index) * 86_400_000),
          open: String(close - 0.5),
          high: String(close + 1),
          low: String(close - 1),
          close: String(close),
          volumeUsd: '1000',
          source: 'test',
          quality: 'ok',
        };
      }),
    );

    const hourly = Array.from({ length: 4320 }, (_, index) => {
      const close = 1 + index * 0.0001;
      return {
        assetId,
        timeframe: '1h',
        openTime: new Date(now - (4319 - index) * 3_600_000),
        open: String(close - 0.00005),
        high: String(close + 0.0001),
        low: String(close - 0.0001),
        close: String(close),
        volumeUsd: '1000',
        source: 'test',
        quality: 'ok',
      };
    });
    for (let index = 0; index < hourly.length; index += 1000) {
      await db.insert(marketCandles).values(hourly.slice(index, index + 1000));
    }
    await agent
      .patch(`/api/v1/ai-trading/profile/tokens/${token.body.id}`)
      .set('x-csrf-token', owner.csrf)
      .send({ timeframes: ['1h', '1d'] })
      .expect(200);

    const search = await agent
      .post('/api/v1/ai-trading/search')
      .set('x-csrf-token', owner.csrf)
      .send({ assetId, timeframe: '1h', horizonDays: 5, variants: 100, seed: 1 })
      .expect(202);
    const searchId = search.body.runId as string;
    let searchStatus: { status: string } = { status: 'queued' };
    for (let attempt = 0; attempt < 600; attempt += 1) {
      const statusResponse = await agent.get(`/api/v1/ai-trading/search/${searchId}`).expect(200);
      searchStatus = statusResponse.body;
      if (['succeeded', 'failed', 'cancelled'].includes(searchStatus.status)) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    expect(searchStatus.status).toBe('succeeded');
    const searchResults = await agent
      .get(`/api/v1/ai-trading/search/${searchId}/results`)
      .expect(200);
    expect(searchResults.body.stats.total).toBeGreaterThan(0);
    expect(searchResults.body.stats.evaluated).toBe(searchResults.body.stats.total);
    const histogram = searchResults.body.stats.histogram as Array<{ count: number }>;
    expect(histogram).toHaveLength(8);
    const histogramTotal = histogram.reduce((sum, bucket) => sum + bucket.count, 0);
    expect(histogramTotal).toBeLessThanOrEqual(searchResults.body.stats.evaluated);
    expect(Array.isArray(searchResults.body.candidates)).toBe(true);
    expect(Array.isArray(searchResults.body.nearMisses)).toBe(true);

    const runs = await agent.get('/api/v1/ai-trading/search/runs').expect(200);
    const listedRun = (runs.body.data as Array<Record<string, unknown>>).find(
      (run) => run.runId === searchId,
    );
    expect(listedRun?.status).toBe('succeeded');
    expect(listedRun?.symbol).toBe('BASED');
    expect(listedRun?.timeframe).toBe('1h');
    expect((listedRun?.stats as { total?: number } | undefined)?.total).toBeGreaterThan(0);
    expect((runs.body.data as Array<{ variants: number }>).every((run) => run.variants > 0)).toBe(
      true,
    );

    const [recommendation] = await db
      .insert(aiCandidates)
      .values({
        profileId: profile.body.id as string,
        runId: searchId,
        assetId,
        timeframe: '1h',
        strategyKey: 'momentum_breakout',
        params: {
          fastPeriod: 5,
          slowPeriod: 20,
          minChange24hPct: 1,
          takeProfitPct: 5,
          stopLossPct: 3,
        },
        metrics: { horizonDays: 5 },
        policyScore: '1.5000',
        status: 'recommended',
      })
      .returning({ id: aiCandidates.id });
    const recommendationId = recommendation?.id as string;

    const draft = await agent
      .post('/api/v1/trading-bots/bots')
      .set('x-csrf-token', owner.csrf)
      .send({
        name: 'AI recommendation draft',
        strategyKey: 'momentum_breakout',
        tokenAssetIds: [assetId],
        budgetUsd: '1000.00',
        maxPositions: 5,
        positionSizePct: 20,
        feeBps: 25,
        slippageBps: 10,
        maxDailyLossPct: 10,
        cooldownMinutes: 15,
        aiCandidateId: recommendationId,
      })
      .expect(201);
    expect(draft.body.bot.status).toBe('draft');
    expect(draft.body.bot.origin).toBe('ai');
    expect(draft.body.bot.aiCandidateId).toBe(recommendationId);
    expect(draft.body.bot.evaluationTimeframe).toBe('1h');
    expect(draft.body.bot.startedAt).toBeNull();

    const [accepted] = await db
      .select({ status: aiCandidates.status })
      .from(aiCandidates)
      .where(eq(aiCandidates.id, recommendationId));
    expect(accepted?.status).toBe('accepted');

    const afterAccept = await agent
      .get(`/api/v1/ai-trading/search/${searchId}/results`)
      .expect(200);
    const acceptedCandidate = (afterAccept.body.candidates as Array<Record<string, unknown>>).find(
      (item) => item.id === recommendationId,
    );
    expect(acceptedCandidate?.status).toBe('accepted');
    expect(acceptedCandidate?.linkedBotId).toBe(draft.body.bot.id);

    const health = await agent.get('/api/v1/ai-trading/bots/health').expect(200);
    const draftHealth = (health.body.data as Array<Record<string, unknown>>).find(
      (item) => item.botId === draft.body.bot.id,
    );
    expect(draftHealth?.level).toBe('ok');
    expect(draftHealth?.candidateId).toBe(recommendationId);
    expect(draftHealth?.candidateStatus).toBe('accepted');

    await db
      .update(tradingBots)
      .set({
        status: 'running',
        startedAt: new Date(),
        strategyParams: { stopLossPct: 5, takeProfitPct: 10 },
      })
      .where(eq(tradingBots.id, draft.body.bot.id));
    await db.insert(botPositions).values({
      botId: draft.body.bot.id,
      assetId,
      amount: '1.000000000000000000',
      avgCostUsd: '100.00000000',
      costBasisUsd: '100.00000000',
    });
    await db
      .insert(marketQuotes)
      .values({
        assetId,
        priceUsd: '90.000000000000000000',
        source: 'test',
        fetchedAt: new Date(),
        changedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: marketQuotes.assetId,
        set: {
          priceUsd: '90.000000000000000000',
          source: 'test',
          fetchedAt: new Date(),
          changedAt: new Date(),
          updatedAt: new Date(),
        },
      });
    const positionedHealth = await agent.get('/api/v1/ai-trading/bots/health').expect(200);
    const positioned = (positionedHealth.body.data as Array<Record<string, unknown>>).find(
      (item) => item.botId === draft.body.bot.id,
    );
    expect(positioned?.level).toBe('stop');
    expect((positioned?.reasons as Array<{ code: string }>).map((reason) => reason.code)).toContain(
      'STOP_HIT',
    );

    await db
      .update(tradingBots)
      .set({ status: 'draft', startedAt: null })
      .where(eq(tradingBots.id, draft.body.bot.id));

    await agent
      .post('/api/v1/trading-bots/bots')
      .set('x-csrf-token', owner.csrf)
      .send({
        name: 'AI recommendation reuse',
        strategyKey: 'momentum_breakout',
        tokenAssetIds: [assetId],
        budgetUsd: '1000.00',
        aiCandidateId: recommendationId,
      })
      .expect(409);

    const [expiredRecommendation] = await db
      .insert(aiCandidates)
      .values({
        profileId: profile.body.id as string,
        runId: searchId,
        assetId,
        timeframe: '1h',
        strategyKey: 'momentum_breakout',
        params: {
          fastPeriod: 5,
          slowPeriod: 20,
          minChange24hPct: 1,
          takeProfitPct: 5,
          stopLossPct: 3,
        },
        metrics: { horizonDays: 5 },
        policyScore: '1.0000',
        status: 'recommended',
        createdAt: new Date(Date.now() - 30 * 86_400_000),
      })
      .returning({ id: aiCandidates.id });
    const expired = await agent
      .post('/api/v1/trading-bots/bots')
      .set('x-csrf-token', owner.csrf)
      .send({
        name: 'AI recommendation expired',
        strategyKey: 'momentum_breakout',
        tokenAssetIds: [assetId],
        budgetUsd: '1000.00',
        aiCandidateId: expiredRecommendation?.id,
      })
      .expect(409);
    expect(expired.body.error.code).toBe('AI_RECOMMENDATION_EXPIRED');

    const recommendations = await agent.get('/api/v1/ai-trading/recommendations').expect(200);
    const acceptedRecommendation = (
      recommendations.body.data as Array<Record<string, unknown>>
    ).find((item) => item.id === recommendationId);
    expect(acceptedRecommendation?.status).toBe('accepted');
    expect(acceptedRecommendation?.symbol).toBe('BASED');
    expect(acceptedRecommendation?.timeframe).toBe('1h');
    expect(acceptedRecommendation?.linkedBotId).toBe(draft.body.bot.id);
    expect(acceptedRecommendation?.expired).toBe(false);
    expect(
      (recommendations.body.data as Array<{ status: string }>).every((item) =>
        ['recommended', 'accepted'].includes(item.status),
      ),
    ).toBe(true);

    const expiredRecommendationRow = (
      recommendations.body.data as Array<Record<string, unknown>>
    ).find((item) => item.id === expiredRecommendation?.id);
    expect(expiredRecommendationRow?.expired).toBe(true);

    const [rejectable] = await db
      .insert(aiCandidates)
      .values({
        profileId: profile.body.id as string,
        runId: searchId,
        assetId,
        timeframe: '1h',
        strategyKey: 'momentum_breakout',
        params: {
          fastPeriod: 5,
          slowPeriod: 20,
          minChange24hPct: 1,
          takeProfitPct: 5,
          stopLossPct: 3,
        },
        metrics: { horizonDays: 5 },
        policyScore: '1.0000',
        status: 'recommended',
      })
      .returning({ id: aiCandidates.id });
    const rejectableId = rejectable?.id as string;
    const recommendationCard = await agent
      .get(`/api/v1/ai-trading/recommendations/${rejectableId}`)
      .expect(200);
    expect(recommendationCard.body.status).toBe('recommended');
    expect(recommendationCard.body.suggestedAllocationUsd).toBe('5000.00');
    expect(recommendationCard.body.invalidationRules.length).toBeGreaterThan(0);

    const rejected = await agent
      .post(`/api/v1/ai-trading/recommendations/${rejectableId}/reject`)
      .set('x-csrf-token', owner.csrf)
      .expect(200);
    expect(rejected.body).toMatchObject({ id: rejectableId, status: 'rejected' });
    await agent.get(`/api/v1/ai-trading/recommendations/${rejectableId}`).expect(404);
    await agent
      .post(`/api/v1/ai-trading/recommendations/${rejectableId}/reject`)
      .set('x-csrf-token', owner.csrf)
      .expect(409);

    const analysis = await agent
      .post('/api/v1/ai-trading/lab/analyze')
      .set('x-csrf-token', owner.csrf)
      .send({ assetId, timeframe: '1d', lookbackDays: 180 })
      .expect(201);
    expect(analysis.body.source).toBe('fallback');
    expect(analysis.body.candidates.length).toBeGreaterThan(0);
    expect(analysis.body.features.candles).toBe(120);

    const latest = await agent
      .get(`/api/v1/ai-trading/lab?assetId=${assetId}&timeframe=1d`)
      .expect(200);
    expect(latest.body.analysis.candidates.length).toBeGreaterThan(0);

    const candidateId = latest.body.analysis.candidates[0].id as string;
    const backtest = await agent
      .post('/api/v1/ai-trading/lab/backtest')
      .set('x-csrf-token', owner.csrf)
      .send({ candidateId })
      .expect(201);
    expect(['backtested', 'rejected']).toContain(backtest.body.status);
    expect(backtest.body.train.returnPct).toBeDefined();
    expect(backtest.body.oos.returnPct).toBeDefined();
    expect(typeof backtest.body.policyScore).toBe('number');

    const cycle = await agent
      .post('/api/v1/ai-trading/cycle')
      .set('x-csrf-token', owner.csrf)
      .send({ assetId, timeframe: '1h', horizonDays: 5, variants: 100, maxDrafts: 0 })
      .expect(202);
    const cycleId = cycle.body.cycleId as string;
    let cycleStatus: {
      status: string;
      steps?: Array<{ key: string; status: string }>;
      recommended?: number;
    } = {
      status: 'queued',
    };
    for (let attempt = 0; attempt < 300; attempt += 1) {
      const response = await agent.get(`/api/v1/ai-trading/cycle/${cycleId}`).expect(200);
      cycleStatus = response.body;
      if (['succeeded', 'failed', 'cancelled'].includes(cycleStatus.status)) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    expect(cycleStatus.status).toBe('succeeded');
    expect(cycleStatus.steps?.map((step) => step.key)).toEqual([
      'data',
      'search',
      'recommendations',
      'drafts',
    ]);
    expect(cycleStatus.steps?.find((step) => step.key === 'drafts')?.status).toBe('skipped');

    const history = await agent.get('/api/v1/ai-trading/cycles').expect(200);
    const historyRow = (history.body.data as Array<Record<string, unknown>>).find(
      (item) => item.cycleId === cycleId,
    );
    expect(historyRow).toBeDefined();
    expect(historyRow).toMatchObject({
      status: 'succeeded',
      symbol: 'BASED',
      timeframe: '1h',
      draftsCreated: 0,
      error: null,
    });
    expect(typeof historyRow?.recommended).toBe('number');
    expect(historyRow?.recommended).toBe(cycleStatus.recommended);
    expect((historyRow?.steps as Array<{ key: string }>).map((step) => step.key)).toEqual([
      'data',
      'search',
      'recommendations',
      'drafts',
    ]);
    await agent.get('/api/v1/ai-trading/cycles?limit=0').expect(400);
    await agent.get('/api/v1/ai-trading/cycles?limit=51').expect(400);
    await agent.get('/api/v1/ai-trading/cycles?limit=abc').expect(400);

    const [legacy] = await db
      .insert(aiPipelineRuns)
      .values({
        profileId: profile.body.id as string,
        trigger: 'manual',
        status: 'failed',
        summary: {
          kind: 'cycle',
          assetId,
          timeframe: '1h',
          steps: [
            {
              key: 'search',
              status: 'failed',
              message: null,
              error: 'Failed query: select 1',
              startedAt: null,
              finishedAt: null,
            },
          ],
          error: 'Failed query: select 1',
        },
      })
      .returning({ id: aiPipelineRuns.id });
    const legacyId = legacy?.id as string;
    const legacyStatus = await agent.get(`/api/v1/ai-trading/cycle/${legacyId}`).expect(200);
    expect(legacyStatus.body.recommended).toBe(0);
    expect(legacyStatus.body.draftsCreated).toBe(0);
    expect(legacyStatus.body.searchRunId).toBeNull();
    expect(legacyStatus.body.error).toContain('База данных временно недоступна');
    expect(legacyStatus.body.steps[0].error).toContain('База данных временно недоступна');

    const legacyHistory = await agent.get('/api/v1/ai-trading/cycles').expect(200);
    const legacyRow = (legacyHistory.body.data as Array<Record<string, unknown>>).find(
      (item) => item.cycleId === legacyId,
    );
    expect(legacyRow).toMatchObject({ status: 'failed', recommended: 0, draftsCreated: 0 });
    expect(legacyRow?.error).toContain('База данных временно недоступна');

    await agent
      .delete(`/api/v1/ai-trading/profile/tokens/${token.body.id}`)
      .set('x-csrf-token', owner.csrf)
      .expect(200);

    const services = await agent.get('/api/v1/ai-trading/services').expect(200);
    expect(services.body.data).toHaveLength(5);

    const serviceAudit = await db.execute(
      sql`select count(*)::int as n from audit_log where action = 'ai_trading.service_created'`,
    );
    expect((serviceAudit.rows[0] as { n: number } | undefined)?.n).toBe(5);

    const service = await agent
      .put('/api/v1/ai-trading/services/data')
      .set('x-csrf-token', owner.csrf)
      .send({ concurrency: 3, config: { historyDays: 500 } })
      .expect(200);
    expect(service.body.concurrency).toBe(3);
    expect(service.body.config.historyDays).toBe(500);

    const dashboard = await agent.get('/api/v1/ai-trading/dashboard').expect(200);
    expect(dashboard.body.tokensCount).toBe(1);
    expect(dashboard.body.workersCount).toBe(1);
    expect(dashboard.body.activeWorkers).toBe(0);
  }, 120_000);
});

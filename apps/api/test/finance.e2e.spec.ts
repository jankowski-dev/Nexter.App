import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import cookie from '@fastify/cookie';
import { readFileSync } from 'node:fs';
import { sql } from 'drizzle-orm';
import { generateSync } from 'otplib';
import request, { type SuperAgentTest } from 'supertest';
import { createDb, type Database } from '@nexter/db';
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

describe.runIf(canRun)('Finance API', () => {
  let app: NestFastifyApplication;
  let db: Database;
  let pool: ReturnType<typeof createDb>['pool'];
  let emailCounter = 0;

  async function setupOwner(agent: SuperAgentTest) {
    const email = `finance-e2e-${Date.now()}-${emailCounter++}@example.com`;
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

    return { csrf: csrfFrom(enabled) };
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
    await db.execute(sql`truncate table users restart identity cascade`);
  });

  afterAll(async () => {
    await app.close();
    await pool.end();
  });

  it('creates accounts, categories, transactions and transfers with balances', async () => {
    const agent = request.agent(app.getHttpServer());
    const owner = await setupOwner(agent);
    const post = (url: string, body: Record<string, unknown>) =>
      agent.post(url).set('x-csrf-token', owner.csrf).send(body);

    const card = await post('/api/v1/finance/accounts', {
      name: 'Карта',
      kind: 'card',
      currency: 'BYN',
      openingBalance: '13.60',
      openingDate: '2026-05-27',
      fxRate: '1',
    }).expect(201);
    const cash = await post('/api/v1/finance/accounts', {
      name: 'Наличные',
      kind: 'cash',
      currency: 'BYN',
      openingBalance: '65',
      openingDate: '2026-05-27',
      fxRate: '1',
    }).expect(201);
    const dollars = await post('/api/v1/finance/accounts', {
      name: 'Доллары',
      kind: 'cash',
      currency: 'USD',
      openingBalance: '910',
      openingDate: '2026-05-27',
      fxRate: '2.965',
    }).expect(201);
    const investment = await post('/api/v1/finance/accounts', {
      name: 'Инвестиционный',
      kind: 'investment',
      currency: 'BYN',
      openingBalance: '7315',
      openingDate: '2026-05-27',
      fxRate: '1',
    }).expect(201);
    const credit = await post('/api/v1/finance/accounts', {
      name: 'Кредитный',
      kind: 'credit',
      currency: 'BYN',
      openingBalance: '-2646',
      openingDate: '2026-05-27',
      fxRate: '1',
    }).expect(201);

    const incomeCategory = await post('/api/v1/finance/categories', {
      name: 'Отделка',
      kind: 'income',
    }).expect(201);
    const expenseCategory = await post('/api/v1/finance/categories', {
      name: 'Продукты',
      kind: 'expense',
    }).expect(201);

    const income = await post('/api/v1/finance/transactions', {
      kind: 'income',
      occurredOn: '2026-11-05',
      accountId: card.body.id,
      categoryId: incomeCategory.body.id,
      amount: '1000',
      title: 'Оплата',
    }).expect(201);
    expect(income.body).toMatchObject({
      kind: 'income',
      amount: '1000.00',
      currency: 'BYN',
      baseAmount: '1000.00',
    });

    await post('/api/v1/finance/transactions', {
      kind: 'expense',
      occurredOn: '2026-11-05',
      accountId: card.body.id,
      categoryId: expenseCategory.body.id,
      amount: '200',
      title: 'Продукты',
    }).expect(201);

    await post('/api/v1/finance/transactions', {
      kind: 'income',
      occurredOn: '2026-11-06',
      accountId: dollars.body.id,
      categoryId: incomeCategory.body.id,
      amount: '100',
      title: 'Доход',
    }).expect(201);

    await post('/api/v1/finance/transfers', {
      kind: 'exchange',
      occurredOn: '2026-11-07',
      fromAccountId: dollars.body.id,
      toAccountId: cash.body.id,
      fromAmount: '100',
      toAmount: '296.50',
      description: 'Обмен USD',
    }).expect(201);

    await post('/api/v1/finance/transfers', {
      kind: 'credit',
      occurredOn: '2026-11-08',
      fromAccountId: card.body.id,
      toAccountId: credit.body.id,
      fromAmount: '100',
      toAmount: '100',
      description: 'Платёж по кредиту',
    }).expect(201);

    const accounts = await agent.get('/api/v1/finance/accounts').expect(200);
    const byName = new Map(
      (accounts.body.accounts as Array<{ name: string; balance: string; balanceBase: string }>).map(
        (account) => [account.name, account],
      ),
    );
    expect(byName.get('Карта')).toMatchObject({ balance: '713.60' });
    expect(byName.get('Наличные')).toMatchObject({ balance: '361.50' });
    expect(byName.get('Доллары')).toMatchObject({ balance: '910.00', balanceBase: '2698.15' });
    expect(byName.get('Инвестиционный')).toMatchObject({ balance: '7315.00' });
    expect(byName.get('Кредитный')).toMatchObject({ balance: '-2546.00' });

    const summary = await agent.get('/api/v1/finance/summary?month=2026-11&months=2').expect(200);
    expect(summary.body).toMatchObject({
      month: '2026-11',
      incomeBase: '1296.50',
      expenseBase: '300.00',
      netBase: '996.50',
    });
    expect(summary.body.months).toHaveLength(2);
    expect(summary.body.categories).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'Отделка', amountBase: '1296.50' }),
        expect.objectContaining({ name: 'Продукты', amountBase: '200.00' }),
        expect.objectContaining({ name: 'Погашение кредита', amountBase: '100.00' }),
      ]),
    );

    const ranged = await agent
      .get('/api/v1/finance/summary?from=2026-11-01&to=2026-11-30&month=2026-11&months=2')
      .expect(200);
    expect(ranged.body).toMatchObject({
      month: '2026-11',
      incomeBase: '1296.50',
      expenseBase: '300.00',
      netBase: '996.50',
    });

    const allTime = await agent.get('/api/v1/finance/summary?all=true&months=2').expect(200);
    expect(Number(allTime.body.incomeBase)).toBeGreaterThanOrEqual(1296.5);
    expect(Number(allTime.body.expenseBase)).toBeGreaterThanOrEqual(300);
    expect(allTime.body.categories.length).toBeGreaterThan(0);

    await agent.get('/api/v1/finance/summary?from=2026-12-01&to=2026-11-01').expect(400);

    const journal = await agent
      .get('/api/v1/finance/journal?from=2026-11-01&to=2026-11-30')
      .expect(200);
    expect(journal.body.transactions).toHaveLength(3);
    expect(journal.body.transfers).toHaveLength(2);

    await post('/api/v1/finance/transactions', {
      kind: 'income',
      occurredOn: '2026-11-05',
      accountId: card.body.id,
      categoryId: expenseCategory.body.id,
      amount: '10',
      title: 'Неверная категория',
    }).expect(400);

    await post('/api/v1/finance/transfers', {
      kind: 'card_topup',
      occurredOn: '2026-11-09',
      fromAccountId: card.body.id,
      toAccountId: card.body.id,
      fromAmount: '10',
      toAmount: '10',
    }).expect(400);

    await agent
      .patch(`/api/v1/finance/accounts/${investment.body.id}`)
      .set('x-csrf-token', owner.csrf)
      .send({ archived: true })
      .expect(200);
    await post('/api/v1/finance/transactions', {
      kind: 'expense',
      occurredOn: '2026-11-10',
      accountId: investment.body.id,
      amount: '10',
      title: 'Архивный счёт',
    }).expect(400);

    const audit = await agent.get('/api/v1/audit-log?limit=100').expect(200);
    const actions = (audit.body.data as Array<{ action: string }>).map((entry) => entry.action);
    expect(actions).toEqual(
      expect.arrayContaining([
        'finance.account_created',
        'finance.category_created',
        'finance.transaction_created',
        'finance.transfer_created',
      ]),
    );
  }, 60_000);

  it('previews, commits and rolls back a finance import', async () => {
    const agent = request.agent(app.getHttpServer());
    const owner = await setupOwner(agent);
    const post = (url: string, body: Record<string, unknown>) =>
      agent.post(url).set('x-csrf-token', owner.csrf).send(body);

    const payload = {
      source: 'notion',
      accounts: [
        {
          name: 'Карта',
          kind: 'card',
          currency: 'BYN',
          openingBalance: '100',
          openingDate: '2026-05-27',
          fxRate: '1',
        },
        {
          name: 'Наличные',
          kind: 'cash',
          currency: 'BYN',
          openingBalance: '0',
          openingDate: '2026-05-27',
          fxRate: '1',
        },
      ],
      categories: [
        { name: 'Отделка', kind: 'income' },
        { name: 'Продукты', kind: 'expense' },
      ],
      transactions: [
        {
          sourceId: 'notion:income:1',
          kind: 'income',
          occurredOn: '2026-06-01',
          account: 'Карта',
          category: 'Отделка',
          amount: '500',
          title: 'Оплата',
        },
        {
          sourceId: 'notion:expense:1',
          kind: 'expense',
          occurredOn: '2026-06-02',
          account: 'Карта',
          category: 'Продукты',
          amount: '200',
          title: 'Продукты',
        },
      ],
      transfers: [
        {
          sourceId: 'notion:transfer:1',
          kind: 'card_topup',
          occurredOn: '2026-06-03',
          fromAccount: 'Карта',
          toAccount: 'Наличные',
          fromAmount: '50',
          toAmount: '50',
        },
      ],
    };

    const preview = await post('/api/v1/finance/import/preview', payload).expect(201);
    expect(preview.body.summary).toMatchObject({
      accounts: 2,
      categories: 2,
      transactions: 2,
      transfers: 1,
      errors: [],
    });

    const committed = await post(`/api/v1/finance/import/${preview.body.id}/commit`, {}).expect(
      201,
    );
    expect(committed.body.status).toBe('committed');

    const accounts = await agent.get('/api/v1/finance/accounts').expect(200);
    const byName = new Map(
      (accounts.body.accounts as Array<{ name: string; balance: string }>).map((account) => [
        account.name,
        account,
      ]),
    );
    expect(byName.get('Карта')?.balance).toBe('350.00');
    expect(byName.get('Наличные')?.balance).toBe('50.00');

    const duplicate = await post('/api/v1/finance/import/preview', payload).expect(409);
    expect(duplicate.body.error.code).toBe('CONFLICT');

    const rolledBack = await post(`/api/v1/finance/import/${preview.body.id}/rollback`, {}).expect(
      201,
    );
    expect(rolledBack.body.status).toBe('rolled_back');
    const emptyAccounts = await agent.get('/api/v1/finance/accounts').expect(200);
    expect(emptyAccounts.body.accounts).toEqual([]);

    const previewAgain = await post('/api/v1/finance/import/preview', payload).expect(201);
    expect(previewAgain.body.status).toBe('preview');
  }, 60_000);

  it.runIf(Boolean(process.env.FINANCE_IMPORT_FILE))(
    'imports the real Notion finance export',
    async () => {
      const agent = request.agent(app.getHttpServer());
      const owner = await setupOwner(agent);
      const payload = JSON.parse(readFileSync(process.env.FINANCE_IMPORT_FILE as string, 'utf8'));
      const preview = await agent
        .post('/api/v1/finance/import/preview')
        .set('x-csrf-token', owner.csrf)
        .send(payload)
        .expect(201);

      expect(preview.body.summary.errors).toEqual([]);
      expect(preview.body.summary).toMatchObject({
        accounts: 7,
        categories: 19,
        transactions: 248,
        transfers: 43,
      });

      await agent
        .post(`/api/v1/finance/import/${preview.body.id}/commit`)
        .set('x-csrf-token', owner.csrf)
        .expect(201);

      const accounts = await agent.get('/api/v1/finance/accounts').expect(200);
      const byName = new Map(
        (
          accounts.body.accounts as Array<{ name: string; balance: string; balanceBase: string }>
        ).map((account) => [account.name, account]),
      );
      expect(byName.get('Карта')?.balance).toBe('0.01');
      expect(byName.get('Наличные')?.balance).toBe('44.95');
      expect(byName.get('Доллары')?.balance).toBe('1925.00');
      expect(byName.get('Доллары')?.balanceBase).toBe('5707.62');
      expect(byName.get('Кредитный')?.balance).toBe('-938.53');
      expect(byName.get('Инвестиционный')?.balance).toBe('7315.00');

      const summary = await agent.get('/api/v1/finance/summary?month=2026-11&months=7').expect(200);
      expect(summary.body.netWorthBase).toBe('12129.05');
      expect(summary.body.assetsBase).toBe('13067.58');
      expect(summary.body.liabilitiesBase).toBe('938.53');
      expect(Number(summary.body.netBase)).toBeCloseTo(-349.35, 1);

      const totals = (
        summary.body.months as Array<{ incomeBase: string; expenseBase: string }>
      ).reduce(
        (acc, row) => ({
          income: acc.income + Number(row.incomeBase),
          expense: acc.expense + Number(row.expenseBase),
        }),
        { income: 0, expense: 0 },
      );
      expect(totals.income).toBeCloseTo(13719.22, 1);
      // Includes 16 principal repayments (1,707.47 BYN) in the import window.
      expect(totals.expense).toBeCloseTo(10629.64, 1);
    },
    60_000,
  );

  it('enforces positive amounts, BYN rate, FX snapshots and journal filters', async () => {
    const agent = request.agent(app.getHttpServer());
    const owner = await setupOwner(agent);
    const post = (url: string, body: Record<string, unknown>) =>
      agent.post(url).set('x-csrf-token', owner.csrf).send(body);

    const byn = await post('/api/v1/finance/accounts', {
      name: 'BYN счёт',
      kind: 'card',
      currency: 'BYN',
      openingBalance: '0',
      openingDate: '2026-05-27',
      fxRate: '2',
    }).expect(201);
    expect(Number(byn.body.fxRate)).toBe(1);

    const usd = await post('/api/v1/finance/accounts', {
      name: 'USD счёт',
      kind: 'cash',
      currency: 'USD',
      openingBalance: '0',
      openingDate: '2026-05-27',
      fxRate: '2.965',
    }).expect(201);
    const cash = await post('/api/v1/finance/accounts', {
      name: 'Наличные',
      kind: 'cash',
      currency: 'BYN',
      openingBalance: '0',
      openingDate: '2026-05-27',
      fxRate: '1',
    }).expect(201);

    const category = await post('/api/v1/finance/categories', {
      name: 'Доход',
      kind: 'income',
    }).expect(201);

    await post('/api/v1/finance/transactions', {
      kind: 'income',
      occurredOn: '2026-11-05',
      accountId: usd.body.id,
      categoryId: category.body.id,
      amount: '-100',
      title: 'Отрицательный доход',
    }).expect(400);

    await post('/api/v1/finance/transfers', {
      kind: 'card_topup',
      occurredOn: '2026-11-05',
      fromAccountId: usd.body.id,
      toAccountId: cash.body.id,
      fromAmount: '-100',
      toAmount: '100',
    }).expect(400);

    const income = await post('/api/v1/finance/transactions', {
      kind: 'income',
      occurredOn: '2026-11-05',
      accountId: usd.body.id,
      categoryId: category.body.id,
      amount: '100',
      title: 'Доход',
    }).expect(201);
    expect(income.body.baseAmount).toBe('296.50');

    await post('/api/v1/finance/transfers', {
      kind: 'card_topup',
      occurredOn: '2026-11-05',
      fromAccountId: cash.body.id,
      toAccountId: byn.body.id,
      fromAmount: '50',
      toAmount: '50',
    }).expect(201);

    const usdTransfer = await post('/api/v1/finance/transfers', {
      kind: 'exchange',
      occurredOn: '2026-11-05',
      fromAccountId: usd.body.id,
      toAccountId: cash.body.id,
      fromAmount: '10',
      toAmount: '29.65',
    }).expect(201);
    expect(usdTransfer.body.fromBaseAmount).toBe('29.65');

    await agent
      .patch(`/api/v1/finance/accounts/${usd.body.id}`)
      .set('x-csrf-token', owner.csrf)
      .send({ fxRate: '3.1' })
      .expect(200);

    const updated = await agent
      .patch(`/api/v1/finance/transactions/${income.body.id}`)
      .set('x-csrf-token', owner.csrf)
      .send({ title: 'Доход (изменено)' })
      .expect(200);
    expect(updated.body.baseAmount).toBe('296.50');
    expect(Number(updated.body.fxRate)).toBe(2.965);

    const updatedTransfer = await agent
      .patch(`/api/v1/finance/transfers/${usdTransfer.body.id}`)
      .set('x-csrf-token', owner.csrf)
      .send({
        description: 'Обмен после изменения курса',
        fromAmount: '10',
        toAmount: '29.65',
      })
      .expect(200);
    expect(updatedTransfer.body.fromBaseAmount).toBe('29.65');
    expect(Number(updatedTransfer.body.fxRate)).toBe(2.965);

    const duplicate = await post('/api/v1/finance/accounts', {
      name: 'USD счёт',
      kind: 'cash',
      currency: 'USD',
      openingBalance: '0',
      openingDate: '2026-05-27',
      fxRate: '1',
    }).expect(409);
    expect(duplicate.body.error.code).toBe('CONFLICT');

    const journal = await agent.get('/api/v1/finance/journal?kind=income').expect(200);
    expect(journal.body.transactions).toHaveLength(1);
    expect(journal.body.transfers).toHaveLength(0);

    await agent
      .patch(`/api/v1/finance/accounts/${usd.body.id}`)
      .set('x-csrf-token', owner.csrf)
      .send({ archived: true })
      .expect(200);
    await agent
      .patch(`/api/v1/finance/transactions/${income.body.id}`)
      .set('x-csrf-token', owner.csrf)
      .send({ title: 'Доход в архиве' })
      .expect(200);
  }, 60_000);

  it('refuses an import rollback after an imported row was edited', async () => {
    const agent = request.agent(app.getHttpServer());
    const owner = await setupOwner(agent);
    const post = (url: string, body: Record<string, unknown>) =>
      agent.post(url).set('x-csrf-token', owner.csrf).send(body);

    const payload = {
      source: 'notion',
      accounts: [
        {
          name: 'Карта',
          kind: 'card',
          currency: 'BYN',
          openingBalance: '0',
          openingDate: '2026-05-27',
          fxRate: '1',
        },
      ],
      categories: [{ name: 'Продукты', kind: 'expense' }],
      transactions: [
        {
          sourceId: 'notion:expense:protected',
          kind: 'expense',
          occurredOn: '2026-06-02',
          account: 'Карта',
          category: 'Продукты',
          amount: '10',
          title: 'Продукты',
        },
      ],
      transfers: [],
    };

    const preview = await post('/api/v1/finance/import/preview', payload).expect(201);
    await post(`/api/v1/finance/import/${preview.body.id}/commit`, {}).expect(201);

    const journal = await agent
      .get('/api/v1/finance/journal?from=2026-06-01&to=2026-06-30')
      .expect(200);
    const imported = journal.body.transactions[0] as { id: string };
    await agent
      .patch(`/api/v1/finance/transactions/${imported.id}`)
      .set('x-csrf-token', owner.csrf)
      .send({ title: 'Изменено после импорта' })
      .expect(200);

    const blocked = await post(`/api/v1/finance/import/${preview.body.id}/rollback`, {}).expect(
      409,
    );
    expect(blocked.body.error.code).toBe('CONFLICT');
  }, 60_000);

  it('rejects a BYN account with a non-unit rate in an import preview', async () => {
    const agent = request.agent(app.getHttpServer());
    const owner = await setupOwner(agent);

    const response = await agent
      .post('/api/v1/finance/import/preview')
      .set('x-csrf-token', owner.csrf)
      .send({
        source: 'notion',
        accounts: [
          {
            name: 'Плохой BYN',
            kind: 'card',
            currency: 'BYN',
            openingBalance: '0',
            openingDate: '2026-05-27',
            fxRate: '2',
          },
        ],
        categories: [],
        transactions: [],
        transfers: [],
      })
      .expect(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  }, 60_000);

  it('refuses a rollback after an imported account was edited', async () => {
    const agent = request.agent(app.getHttpServer());
    const owner = await setupOwner(agent);
    const post = (url: string, body: Record<string, unknown>) =>
      agent.post(url).set('x-csrf-token', owner.csrf).send(body);

    const payload = {
      source: 'notion',
      accounts: [
        {
          name: 'Карта',
          kind: 'card',
          currency: 'BYN',
          openingBalance: '0',
          openingDate: '2026-05-27',
          fxRate: '1',
        },
      ],
      categories: [],
      transactions: [],
      transfers: [],
    };

    const preview = await post('/api/v1/finance/import/preview', payload).expect(201);
    await post(`/api/v1/finance/import/${preview.body.id}/commit`, {}).expect(201);

    const accounts = await agent.get('/api/v1/finance/accounts').expect(200);
    const account = (accounts.body.accounts as Array<{ id: string }>)[0];
    await agent
      .patch(`/api/v1/finance/accounts/${account.id}`)
      .set('x-csrf-token', owner.csrf)
      .send({ openingBalance: '1' })
      .expect(200);

    await post(`/api/v1/finance/import/${preview.body.id}/rollback`, {}).expect(409);
  }, 60_000);

  it('creates credit drawdowns without income or expense', async () => {
    const agent = request.agent(app.getHttpServer());
    const owner = await setupOwner(agent);
    const post = (url: string, body: Record<string, unknown>) =>
      agent.post(url).set('x-csrf-token', owner.csrf).send(body);

    const card = await post('/api/v1/finance/accounts', {
      name: 'Карта',
      kind: 'card',
      currency: 'BYN',
      openingBalance: '0',
      openingDate: '2026-05-27',
      fxRate: '1',
    }).expect(201);

    const drawdown = await post('/api/v1/finance/credits/drawdown', {
      name: 'Кредит на авто',
      currency: 'BYN',
      amount: '5000',
      occurredOn: '2026-11-10',
      destinationAccountId: card.body.id,
      description: 'Получение кредита',
    }).expect(201);
    expect(drawdown.body.account).toMatchObject({
      name: 'Кредит на авто',
      kind: 'credit',
      balance: '-5000.00',
    });
    expect(drawdown.body.transfer).toMatchObject({
      kind: 'credit',
      fromAmount: '5000.00',
      toAmount: '5000.00',
    });

    const accounts = await agent.get('/api/v1/finance/accounts').expect(200);
    const byName = new Map(
      (accounts.body.accounts as Array<{ name: string; balance: string }>).map((account) => [
        account.name,
        account,
      ]),
    );
    expect(byName.get('Карта')?.balance).toBe('5000.00');
    expect(byName.get('Кредит на авто')?.balance).toBe('-5000.00');

    const summary = await agent.get('/api/v1/finance/summary?month=2026-11').expect(200);
    expect(summary.body.incomeBase).toBe('0.00');
    expect(summary.body.expenseBase).toBe('0.00');
    expect(summary.body.netWorthBase).toBe('0.00');

    await post('/api/v1/finance/transfers', {
      kind: 'credit',
      occurredOn: '2026-11-10',
      fromAccountId: card.body.id,
      toAccountId: drawdown.body.account.id,
      fromAmount: '100',
      toAmount: '100',
      description: 'Платёж по кредиту',
    }).expect(201);

    const afterRepayment = await agent.get('/api/v1/finance/summary?month=2026-11').expect(200);
    expect(afterRepayment.body.incomeBase).toBe('0.00');
    expect(afterRepayment.body.expenseBase).toBe('100.00');
    expect(afterRepayment.body.netBase).toBe('-100.00');
    expect(afterRepayment.body.netWorthBase).toBe('0.00');
    expect(afterRepayment.body.categories).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'Погашение кредита', amountBase: '100.00' }),
      ]),
    );

    const debtOnly = await post('/api/v1/finance/credits/drawdown', {
      name: 'Кредит без зачисления',
      currency: 'BYN',
      amount: '1000',
      occurredOn: '2026-11-10',
    }).expect(201);
    expect(debtOnly.body.account.balance).toBe('-1000.00');
    expect(debtOnly.body.transfer).toBeNull();

    const afterDebt = await agent.get('/api/v1/finance/summary?month=2026-11').expect(200);
    expect(afterDebt.body.netWorthBase).toBe('-1000.00');

    await post('/api/v1/finance/credits/drawdown', {
      creditAccountId: drawdown.body.account.id,
      amount: '10',
      occurredOn: '2026-11-10',
      destinationAccountId: drawdown.body.account.id,
    }).expect(400);
  }, 60_000);
});

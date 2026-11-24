import { asc, eq, sql } from 'drizzle-orm';
import {
  createDb,
  sandboxEquityPoints,
  sandboxIntents,
  sandboxLedgerEntries,
  sandboxPositions,
  sandboxTrades,
  type Database,
} from '@nexter/db';
import { Reason } from '@nexter/sandbox-core';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { SandboxRepository } from '../src/modules/sandbox/sandbox.repository';
import { assertDisposableTestDatabase } from './helpers/test-database';
import {
  makeClosedLedger,
  makeOpenLedger,
  makeTick,
  SANDBOX_TEST_AT,
  SANDBOX_TEST_HOUR,
  SANDBOX_TEST_TOKEN,
  seedSandboxRun,
} from './helpers/sandbox-fixtures';

const canRun = Boolean(process.env.NEXTER_TEST_DB === '1' && process.env.DATABASE_URL);

if (canRun) {
  assertDisposableTestDatabase(process.env.DATABASE_URL);
}

describe.runIf(canRun)('sandbox projections', () => {
  let db: Database;
  let pool: ReturnType<typeof createDb>['pool'];
  let repository: SandboxRepository;

  beforeAll(() => {
    const created = createDb(process.env.DATABASE_URL ?? '');
    db = created.db;
    pool = created.pool;
    repository = new SandboxRepository(db);
  });

  beforeEach(async () => {
    await db.execute(sql`truncate table users restart identity cascade`);
  });

  afterAll(async () => {
    await pool.end();
  });

  it('projects the ledger position, trade, entry, intent and equity point', async () => {
    const { runId } = await seedSandboxRun(db);
    const open = makeOpenLedger();
    const entry = open.ledger.entries[0];
    const trade = open.ledger.openTrades[SANDBOX_TEST_TOKEN];
    const position = open.ledger.positions[SANDBOX_TEST_TOKEN];
    const mark = open.marked.positions[0];
    const intent = open.intents[0];
    if (!entry || !trade || !position || !mark || !intent) {
      throw new Error('fixture is incomplete');
    }

    await repository.persistTick(runId, makeTick(open.ledger, open.marked, open.intents));

    const [positionRow] = await db
      .select()
      .from(sandboxPositions)
      .where(eq(sandboxPositions.runId, runId));
    expect(positionRow).toMatchObject({
      tokenId: SANDBOX_TEST_TOKEN,
      strategyKey: position.strategyKey,
      strategyVersion: position.strategyVersion,
      amount: position.amount,
      avgCostUsd: position.avgCostUsd,
      costBasisUsd: position.costBasisUsd,
      marketPriceUsd: mark.marketPriceUsd,
      marketValueUsd: mark.marketValueUsd,
      stopLossPct: position.stopLossPct,
      takeProfitPct: position.takeProfitPct,
      entryIntentId: position.entryIntentId,
      feesPaidUsd: position.feesPaidUsd,
    });
    expect(positionRow?.openedAt.getTime()).toBe(position.openedAt);

    const [tradeRow] = await db.select().from(sandboxTrades).where(eq(sandboxTrades.runId, runId));
    expect(tradeRow).toMatchObject({
      tradeId: trade.tradeId,
      tokenId: SANDBOX_TEST_TOKEN,
      strategyKey: trade.strategyKey,
      status: 'open',
      entryIntentId: trade.entryIntentId,
      entryPriceUsd: trade.entryPriceUsd,
      entryAmount: trade.entryAmount,
      entryNotionalUsd: trade.entryNotionalUsd,
      entryFeeUsd: trade.entryFeeUsd,
      entryCostBasisUsd: trade.entryCostBasisUsd,
      exitAt: null,
      exitPriceUsd: null,
      exitAmount: '0.00000000',
      exitNotionalUsd: '0.00',
      exitFeeUsd: '0.00',
      realizedPnlUsd: '0.00',
    });
    expect(tradeRow?.entryAt.getTime()).toBe(trade.entryAt);

    const [entryRow] = await db
      .select()
      .from(sandboxLedgerEntries)
      .where(eq(sandboxLedgerEntries.runId, runId));
    expect(entryRow).toMatchObject({
      sequence: entry.sequence,
      entryId: entry.entryId,
      tokenId: SANDBOX_TEST_TOKEN,
      side: entry.side,
      intentId: entry.intentId,
      amount: entry.amount,
      priceUsd: entry.priceUsd,
      notionalUsd: entry.notionalUsd,
      feeUsd: entry.feeUsd,
      cashAfterUsd: entry.cashAfterUsd,
      positionAmountAfter: entry.positionAmountAfter,
      positionAvgCostAfter: entry.positionAvgCostAfter,
      positionCostBasisAfterUsd: entry.positionCostBasisAfterUsd,
      costBasisReleasedUsd: null,
      realizedPnlUsd: null,
      reasonCode: Reason.LEDGER_BUY,
    });
    expect(entryRow?.clockTime.getTime()).toBe(entry.clockTime);

    const [intentRow] = await db
      .select()
      .from(sandboxIntents)
      .where(eq(sandboxIntents.runId, runId));
    expect(intentRow).toMatchObject({
      intentId: intent.intentId,
      tokenId: SANDBOX_TEST_TOKEN,
      side: 'buy',
      strategyKey: 'trend_pullback',
      strategyVersion: 1,
      status: 'filled',
      requestedUsd: '200.00',
      requestedAmount: null,
      filledUsd: intent.filledUsd,
      filledAmount: intent.filledAmount,
      priceUsd: intent.priceUsd,
      feeUsd: intent.feeUsd,
      reasonCode: Reason.FILL_FILLED,
      strategyReasonCode: Reason.TREND_PULLBACK_ENTRY,
      reasonText: intent.reasonText,
    });
    expect(intentRow?.decisionTime.getTime()).toBe(SANDBOX_TEST_AT);
    expect(intentRow?.fillTime?.getTime()).toBe(SANDBOX_TEST_AT);

    const [equityRow] = await db
      .select()
      .from(sandboxEquityPoints)
      .where(eq(sandboxEquityPoints.runId, runId));
    expect(equityRow).toMatchObject({
      equityUsd: open.marked.equityUsd,
      cashUsd: open.ledger.cashUsd,
      positionsValueUsd: open.marked.positionsValueUsd,
      drawdownPct: '0.00',
    });
    expect(equityRow?.clockTime.getTime()).toBe(SANDBOX_TEST_AT);
  });

  it('closes the trade projection and zeroes the position without deleting rows', async () => {
    const { runId } = await seedSandboxRun(db);
    const open = makeOpenLedger();
    await repository.persistTick(runId, makeTick(open.ledger, open.marked, open.intents));

    const closed = makeClosedLedger();
    const closedTrade = closed.ledger.closedTrades[0];
    if (!closedTrade) throw new Error('fixture has no closed trade');

    await repository.persistTick(
      runId,
      makeTick(closed.ledger, closed.marked, [], {
        cashUsd: closed.ledger.cashUsd,
        lastBarClose: new Date(SANDBOX_TEST_AT + SANDBOX_TEST_HOUR),
        lastTickAt: new Date(SANDBOX_TEST_AT + SANDBOX_TEST_HOUR),
        equityPoint: {
          clockTime: SANDBOX_TEST_AT + SANDBOX_TEST_HOUR,
          equityUsd: closed.marked.equityUsd,
          cashUsd: closed.ledger.cashUsd,
          positionsValueUsd: '0.00',
          drawdownPct: '0.00',
        },
      }),
    );

    const trades = await db.select().from(sandboxTrades).where(eq(sandboxTrades.runId, runId));
    expect(trades).toHaveLength(1);
    expect(trades[0]).toMatchObject({
      tradeId: closedTrade.tradeId,
      status: 'closed',
      exitPriceUsd: closedTrade.exitPriceUsd,
      exitAmount: closedTrade.exitAmount,
      exitNotionalUsd: closedTrade.exitNotionalUsd,
      exitFeeUsd: closedTrade.exitFeeUsd,
      exitReasonCode: closedTrade.exitReasonCode,
      exitIntentId: closedTrade.exitIntentId,
      realizedPnlUsd: closedTrade.realizedPnlUsd,
    });
    expect(trades[0]?.exitAt?.getTime()).toBe(closedTrade.exitAt);

    const positions = await db
      .select()
      .from(sandboxPositions)
      .where(eq(sandboxPositions.runId, runId));
    expect(positions).toHaveLength(1);
    expect(positions[0]).toMatchObject({
      tokenId: SANDBOX_TEST_TOKEN,
      amount: '0.00000000',
      costBasisUsd: '0.00',
      marketValueUsd: '0.00',
    });

    const entries = await db
      .select()
      .from(sandboxLedgerEntries)
      .where(eq(sandboxLedgerEntries.runId, runId))
      .orderBy(asc(sandboxLedgerEntries.sequence));
    expect(entries.map((row) => row.sequence)).toEqual([1, 2]);
    expect(entries[1]).toMatchObject({
      side: 'sell',
      reasonCode: Reason.LEDGER_SELL,
      intentId: 'intent-2',
    });
    expect(entries[1]?.costBasisReleasedUsd).not.toBeNull();
    expect(entries[1]?.realizedPnlUsd).not.toBeNull();

    const equity = await db
      .select()
      .from(sandboxEquityPoints)
      .where(eq(sandboxEquityPoints.runId, runId));
    expect(equity).toHaveLength(2);
  });
});

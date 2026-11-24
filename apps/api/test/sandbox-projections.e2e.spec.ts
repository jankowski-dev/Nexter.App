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
import Decimal from 'decimal.js';
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

/**
 * Projection columns have fixed Postgres scales (numeric(38,8), numeric(30,18),
 * numeric(9,4), numeric(18,2)), and Drizzle returns the padded scale. Compare
 * numerically so a core 8-decimal string matches its 18-decimal storage form.
 *
 * NOTE for Task 5: API/UI reads of these columns must normalize the padded
 * strings before comparing or displaying them.
 */
function expectDecimal(actual: string | null | undefined, expected: string | null): void {
  if (expected === null) {
    expect(actual).toBeNull();
    return;
  }
  expect(actual).not.toBeNull();
  expect(new Decimal(actual as string).equals(expected)).toBe(true);
}

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
      entryIntentId: position.entryIntentId,
    });
    expectDecimal(positionRow?.amount, position.amount);
    expectDecimal(positionRow?.avgCostUsd, position.avgCostUsd);
    expectDecimal(positionRow?.costBasisUsd, position.costBasisUsd);
    expectDecimal(positionRow?.marketPriceUsd, mark.marketPriceUsd);
    expectDecimal(positionRow?.marketValueUsd, mark.marketValueUsd);
    expectDecimal(positionRow?.stopLossPct, position.stopLossPct);
    expectDecimal(positionRow?.takeProfitPct, position.takeProfitPct);
    expectDecimal(positionRow?.feesPaidUsd, position.feesPaidUsd);
    expect(positionRow?.openedAt.getTime()).toBe(position.openedAt);

    const [tradeRow] = await db.select().from(sandboxTrades).where(eq(sandboxTrades.runId, runId));
    expect(tradeRow).toMatchObject({
      tradeId: trade.tradeId,
      tokenId: SANDBOX_TEST_TOKEN,
      strategyKey: trade.strategyKey,
      status: 'open',
      entryIntentId: trade.entryIntentId,
      exitAt: null,
      exitPriceUsd: null,
    });
    expectDecimal(tradeRow?.entryPriceUsd, trade.entryPriceUsd);
    expectDecimal(tradeRow?.entryAmount, trade.entryAmount);
    expectDecimal(tradeRow?.entryNotionalUsd, trade.entryNotionalUsd);
    expectDecimal(tradeRow?.entryFeeUsd, trade.entryFeeUsd);
    expectDecimal(tradeRow?.entryCostBasisUsd, trade.entryCostBasisUsd);
    expectDecimal(tradeRow?.exitAmount, '0.00000000');
    expectDecimal(tradeRow?.exitNotionalUsd, '0.00');
    expectDecimal(tradeRow?.exitFeeUsd, '0.00');
    expectDecimal(tradeRow?.realizedPnlUsd, '0.00');
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
      costBasisReleasedUsd: null,
      realizedPnlUsd: null,
      reasonCode: Reason.LEDGER_BUY,
    });
    expectDecimal(entryRow?.amount, entry.amount);
    expectDecimal(entryRow?.priceUsd, entry.priceUsd);
    expectDecimal(entryRow?.notionalUsd, entry.notionalUsd);
    expectDecimal(entryRow?.feeUsd, entry.feeUsd);
    expectDecimal(entryRow?.cashAfterUsd, entry.cashAfterUsd);
    expectDecimal(entryRow?.positionAmountAfter, entry.positionAmountAfter);
    expectDecimal(entryRow?.positionAvgCostAfter, entry.positionAvgCostAfter);
    expectDecimal(entryRow?.positionCostBasisAfterUsd, entry.positionCostBasisAfterUsd);
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
      requestedAmount: null,
      reasonCode: Reason.FILL_FILLED,
      strategyReasonCode: Reason.TREND_PULLBACK_ENTRY,
      reasonText: intent.reasonText,
    });
    expectDecimal(intentRow?.requestedUsd, '200.00');
    expectDecimal(intentRow?.filledUsd, intent.filledUsd);
    expectDecimal(intentRow?.filledAmount, intent.filledAmount);
    expectDecimal(intentRow?.priceUsd, intent.priceUsd);
    expectDecimal(intentRow?.feeUsd, intent.feeUsd);
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
    });
    expectDecimal(equityRow?.drawdownPct, '0.00');
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
      exitReasonCode: closedTrade.exitReasonCode,
      exitIntentId: closedTrade.exitIntentId,
    });
    expectDecimal(trades[0]?.exitPriceUsd, closedTrade.exitPriceUsd);
    expectDecimal(trades[0]?.exitAmount, closedTrade.exitAmount);
    expectDecimal(trades[0]?.exitNotionalUsd, closedTrade.exitNotionalUsd);
    expectDecimal(trades[0]?.exitFeeUsd, closedTrade.exitFeeUsd);
    expectDecimal(trades[0]?.realizedPnlUsd, closedTrade.realizedPnlUsd);
    expect(trades[0]?.exitAt?.getTime()).toBe(closedTrade.exitAt);

    const positions = await db
      .select()
      .from(sandboxPositions)
      .where(eq(sandboxPositions.runId, runId));
    expect(positions).toHaveLength(1);
    expect(positions[0]).toMatchObject({
      tokenId: SANDBOX_TEST_TOKEN,
      stopLossPct: null,
      takeProfitPct: null,
    });
    expectDecimal(positions[0]?.amount, '0.00000000');
    expectDecimal(positions[0]?.avgCostUsd, '0.00000000');
    expectDecimal(positions[0]?.marketPriceUsd, '0.00000000');
    expectDecimal(positions[0]?.costBasisUsd, '0.00');
    expectDecimal(positions[0]?.marketValueUsd, '0.00');
    expectDecimal(positions[0]?.feesPaidUsd, '0.00');

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

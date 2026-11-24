import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const SANDBOX_TABLES = [
  'sandbox_tokens',
  'sandbox_candles',
  'sandbox_runs',
  'sandbox_run_tokens',
  'sandbox_events',
  'sandbox_positions',
  'sandbox_trades',
  'sandbox_ledger_entries',
  'sandbox_equity_points',
  'sandbox_intents',
  'sandbox_reports',
] as const;

function readMigration(): string {
  const candidates = [
    resolve(process.cwd(), '../../packages/db/drizzle/0052_sandbox_stage2.sql'),
    resolve(process.cwd(), 'packages/db/drizzle/0052_sandbox_stage2.sql'),
  ];

  for (const candidate of candidates) {
    try {
      return readFileSync(candidate, 'utf8');
    } catch {
      // Try the next location; the suite can run from the repo root or the package.
    }
  }

  throw new Error('0052_sandbox_stage2.sql was not found');
}

const sql = readMigration().replace(/\s+/g, ' ');

describe('sandbox stage 2 migration', () => {
  it('creates every sandbox table', () => {
    for (const table of SANDBOX_TABLES) {
      expect(sql).toContain(`CREATE TABLE "${table}"`);
    }
  });

  it('grants read/write on mutable sandbox tables to the app role', () => {
    const mutable = SANDBOX_TABLES.filter((table) => table !== 'sandbox_events');

    expect(sql).toContain(`GRANT SELECT, INSERT, UPDATE ON ${mutable.join(', ')} TO nexter_app;`);
  });

  it('grants only SELECT and INSERT on the append-only event log', () => {
    expect(sql).toContain('GRANT SELECT, INSERT ON sandbox_events TO nexter_app;');
  });

  it('never grants DELETE on a sandbox table', () => {
    expect(sql).not.toMatch(/GRANT[^;]*DELETE/i);
  });

  it('does not touch old AI or legacy tables', () => {
    expect(sql).not.toMatch(/market_candles|\bai_[a-z_]+|trading_bots/);
  });
});

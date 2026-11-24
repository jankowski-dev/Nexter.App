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

function readRepoFile(...candidates: string[]): string {
  for (const candidate of candidates) {
    for (const base of [process.cwd(), resolve(process.cwd(), '../..')]) {
      try {
        return readFileSync(resolve(base, candidate), 'utf8');
      } catch {
        // Try the next location; the suite can run from the repo root or the package.
      }
    }
  }

  throw new Error(`${candidates.join(' or ')} was not found`);
}

const migrationSql = readRepoFile('packages/db/drizzle/0052_sandbox_stage2.sql').replace(
  /\s+/g,
  ' ',
);
const provisioningSource = readRepoFile('packages/db/scripts/provision-app-role.mjs');

describe('sandbox stage 2 migration', () => {
  it('creates every sandbox table', () => {
    for (const table of SANDBOX_TABLES) {
      expect(migrationSql).toContain(`CREATE TABLE "${table}"`);
    }
  });

  it('grants read/write on mutable sandbox tables to the app role', () => {
    const mutable = SANDBOX_TABLES.filter((table) => table !== 'sandbox_events');

    expect(migrationSql).toContain(
      `GRANT SELECT, INSERT, UPDATE ON ${mutable.join(', ')} TO nexter_app;`,
    );
  });

  it('grants only SELECT and INSERT on the append-only event log', () => {
    expect(migrationSql).toContain('GRANT SELECT, INSERT ON sandbox_events TO nexter_app;');
  });

  it('revokes UPDATE and DELETE on the append-only event log', () => {
    expect(migrationSql).toContain('REVOKE UPDATE, DELETE ON sandbox_events FROM nexter_app;');
  });

  it('never grants DELETE on a sandbox table and revokes it on every one', () => {
    expect(migrationSql).not.toMatch(/GRANT[^;]*DELETE/i);
    expect(migrationSql).toContain(
      `REVOKE DELETE ON ${SANDBOX_TABLES.join(', ')} FROM nexter_app;`,
    );
  });

  it('does not touch old AI or legacy tables', () => {
    expect(migrationSql).not.toMatch(/market_candles|\bai_[a-z_]+|trading_bots/);
  });
});

describe('app-role provisioning keeps sandbox append-only', () => {
  it('revokes DELETE on every sandbox table', () => {
    for (const table of SANDBOX_TABLES) {
      expect(provisioningSource).toMatch(
        new RegExp(`revoke delete on[^;]*\\b${table}\\b[^;]*from \\$\\{quoteIdent\\(appUser\\)\\}`),
      );
      // The verification array must cover the same table or a re-provision drill
      // would miss restored DELETE grants.
      expect(provisioningSource).toContain(`'${table}',`);
    }
  });

  it('revokes UPDATE and DELETE on the append-only event log', () => {
    expect(provisioningSource).toMatch(
      /revoke update, delete on sandbox_events from \$\{quoteIdent\(appUser\)\}/,
    );
  });
});

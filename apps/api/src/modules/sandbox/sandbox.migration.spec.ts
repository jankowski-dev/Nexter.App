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

const SANDBOX_REPLAY_INDEXES = [
  'sandbox_replays_user_created_idx',
  'sandbox_replays_status_queued_idx',
  'sandbox_replays_user_archived_idx',
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
const replayMigrationSql = readRepoFile('packages/db/drizzle/0053_sandbox_replays.sql').replace(
  /\s+/g,
  ' ',
);
const replaySnapshotSource = readRepoFile('packages/db/drizzle/meta/0053_snapshot.json');
const journal = JSON.parse(readRepoFile('packages/db/drizzle/meta/_journal.json')) as {
  entries: Array<{ idx: number; tag: string }>;
};
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

  it('stores pending decision protection and prevents duplicate pending sides', () => {
    expect(migrationSql).toContain('"stop_loss_pct" numeric(9, 4)');
    expect(migrationSql).toContain('"take_profit_pct" numeric(9, 4)');
    expect(migrationSql).toContain(
      'CREATE UNIQUE INDEX "sandbox_intents_pending_token_side_unique"',
    );
    expect(migrationSql).toContain('WHERE "sandbox_intents"."status" = \'pending\'');
  });
});

describe('sandbox historical replay migration 0053', () => {
  it('adds exactly one new table and no old AI tables', () => {
    expect(replayMigrationSql).toContain('CREATE TABLE "sandbox_replays"');
    expect(replayMigrationSql.match(/CREATE TABLE/g)).toHaveLength(1);
    expect(replayMigrationSql).not.toMatch(/market_candles|\bai_[a-z_]+|trading_bots/);
  });

  it('stores the frozen replay input and report evidence', () => {
    expect(replayMigrationSql).toContain('"candle_snapshot" bytea');
    expect(replayMigrationSql).toContain('"candle_snapshot_hash" text');
    expect(replayMigrationSql).toContain('"report" jsonb');
    expect(replayMigrationSql).toContain('"initial_capital_usd" numeric(18, 2)');
    expect(replayMigrationSql).toContain('"token_keys" jsonb');
    expect(replayMigrationSql).toContain('"queued_at" timestamp with time zone');
    expect(replayMigrationSql).toContain(
      'REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action',
    );
  });

  it('creates the owner/status/archive indexes', () => {
    for (const index of SANDBOX_REPLAY_INDEXES) {
      expect(replayMigrationSql).toContain(`"${index}"`);
    }
  });

  it('grants SELECT, INSERT and UPDATE but never DELETE to the app role', () => {
    expect(replayMigrationSql).toContain(
      'GRANT SELECT, INSERT, UPDATE ON sandbox_replays TO nexter_app;',
    );
    expect(replayMigrationSql).toContain('REVOKE DELETE ON sandbox_replays FROM nexter_app;');
    expect(replayMigrationSql).not.toMatch(/GRANT[^;]*DELETE/i);
  });

  it('keeps the migration journal and snapshot chain consistent', () => {
    expect(journal.entries).toHaveLength(54);
    const last = journal.entries.at(-1);
    expect(last).toMatchObject({ idx: 53, tag: '0053_sandbox_replays' });
    expect(journal.entries.some((entry) => entry.tag === '0052_sandbox_stage2')).toBe(true);
    expect(replaySnapshotSource).toContain('"sandbox_replays"');
  });
});

describe('app-role provisioning keeps sandbox append-only', () => {
  it('revokes DELETE on every sandbox table', () => {
    for (const table of [...SANDBOX_TABLES, 'sandbox_replays'] as const) {
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

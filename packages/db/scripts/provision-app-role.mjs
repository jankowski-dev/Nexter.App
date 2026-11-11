#!/usr/bin/env node
/**
 * Provision a least-privilege application role for Nexter.
 *
 * Run with an owner/migration DATABASE_URL. The generated role can read and
 * write application data but cannot create/drop schema objects or manage roles.
 *
 * Usage:
 *   APP_DB_USER=nexter_app APP_DB_PASSWORD='...' DATABASE_URL=... \
 *     node packages/db/scripts/provision-app-role.mjs
 *
 * Options:
 *   --dry-run  Print SQL without executing it (password redacted).
 */

import pg from 'pg';

const { Client } = pg;

const databaseUrl = process.env.DATABASE_URL;
const appUser = process.env.APP_DB_USER ?? 'nexter_app';
const appPassword = process.env.APP_DB_PASSWORD;
const dryRun = process.argv.includes('--dry-run');

if (!databaseUrl) fail('DATABASE_URL is required (owner/migration role)');
if (!appPassword || appPassword.length < 16) {
  fail('APP_DB_PASSWORD is required and must be at least 16 characters');
}
if (!/^[a-z_][a-z0-9_]{0,62}$/.test(appUser)) {
  fail('APP_DB_USER must be a lowercase PostgreSQL identifier');
}

const url = new URL(databaseUrl);
const databaseName = decodeURIComponent(url.pathname.slice(1));

if (!databaseName) fail('DATABASE_URL must include a database name');

function fail(message) {
  console.error(message);
  process.exit(1);
}

function quoteIdent(value) {
  return `"${value.replaceAll('"', '""')}"`;
}

function quoteLiteral(value) {
  return `'${value.replaceAll("'", "''")}'`;
}

const statements = [
  `do $$
   begin
     if not exists (select 1 from pg_roles where rolname = ${quoteLiteral(appUser)}) then
       create role ${quoteIdent(appUser)} login password ${quoteLiteral(appPassword)};
     else
       alter role ${quoteIdent(appUser)} with login password ${quoteLiteral(appPassword)};
     end if;
     alter role ${quoteIdent(appUser)} nosuperuser nocreatedb nocreaterole noinherit;
   end
   $$;`,
  `grant connect on database ${quoteIdent(databaseName)} to ${quoteIdent(appUser)};`,
  `grant usage on schema public to ${quoteIdent(appUser)};`,
  `grant select, insert, update, delete on all tables in schema public to ${quoteIdent(appUser)};`,
  `revoke update, delete on audit_log from ${quoteIdent(appUser)};`,
  `revoke delete on users, settings, accounts, assets, chains, imports, watchlist, swap_orders, swap_events, token_approvals, external_api_calls, watched_addresses, indexed_transfers, reconciliation_runs, reconciliation_items, vault_configs, vault_items, tasks, notes, habits, market_quotes from ${quoteIdent(appUser)};`,
  `revoke update on vault_configs from ${quoteIdent(appUser)};`,
  `grant usage, select on all sequences in schema public to ${quoteIdent(appUser)};`,
  `revoke update on indexed_transfers, reconciliation_items from ${quoteIdent(appUser)};`,
  `alter default privileges in schema public grant select, insert, update, delete on tables to ${quoteIdent(appUser)};`,
  `alter default privileges in schema public grant usage, select on sequences to ${quoteIdent(appUser)};`,
];

if (dryRun) {
  console.log(statements.join('\n').replaceAll(quoteLiteral(appPassword), '<redacted>'));
  process.exit(0);
}

const client = new Client({ connectionString: databaseUrl });

try {
  await client.connect();

  for (const statement of statements) {
    await client.query(statement);
  }

  const check = await client.query(
    `select rolname, rolsuper, rolcreatedb, rolcreaterole
     from pg_roles where rolname = $1`,
    [appUser],
  );

  const deleteCheck = await client.query(
    `select table_name, has_table_privilege($1, 'public.' || table_name, 'delete') as can_delete
     from unnest($2::text[]) as table_name`,
    [
      appUser,
      [
        'users',
        'settings',
        'accounts',
        'assets',
        'chains',
        'imports',
        'watchlist',
        'swap_orders',
        'swap_events',
        'token_approvals',
        'external_api_calls',
        'watched_addresses',
        'indexed_transfers',
        'reconciliation_runs',
        'reconciliation_items',
        'vault_configs',
        'vault_items',
        'tasks',
        'notes',
        'habits',
        'market_quotes',
      ],
    ],
  );
  const deleteAllowed = deleteCheck.rows
    .filter((row) => row.can_delete)
    .map((row) => row.table_name);

  if (deleteAllowed.length > 0) {
    throw new Error(`Application role still has DELETE on: ${deleteAllowed.join(', ')}`);
  }

  const updateCheck = await client.query(
    `select table_name, has_table_privilege($1, 'public.' || table_name, 'update') as can_update
     from unnest($2::text[]) as table_name`,
    [appUser, ['indexed_transfers', 'reconciliation_items', 'vault_configs']],
  );
  const updateAllowed = updateCheck.rows
    .filter((row) => row.can_update)
    .map((row) => row.table_name);

  if (updateAllowed.length > 0) {
    throw new Error(`Application role still has UPDATE on: ${updateAllowed.join(', ')}`);
  }

  console.log(
    JSON.stringify(
      {
        role: appUser,
        database: databaseName,
        superuser: check.rows[0]?.rolsuper ?? null,
        createDb: check.rows[0]?.rolcreatedb ?? null,
        createRole: check.rows[0]?.rolcreaterole ?? null,
        deleteDenied: true,
        result: 'provisioned',
      },
      null,
      2,
    ),
  );
} catch (error) {
  const message =
    error instanceof Error ? error.message.replaceAll(appPassword, '<redacted>') : 'unknown error';
  console.error(`Failed to provision application role: ${message}`);
  process.exitCode = 1;
} finally {
  await client.end();
}

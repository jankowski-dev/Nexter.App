#!/usr/bin/env node
/**
 * Backup/restore drill for Nexter.
 *
 * Creates a disposable target database, restores the source database into it,
 * then verifies row counts, key sums, and referential integrity. The drill uses
 * pg_dump/pg_restore when available (directly or through the postgres:17-alpine
 * Docker image). Without those tools it falls back to a logical JSON copy so
 * the verification steps still run on a developer machine.
 *
 * Usage:
 *   RESTORE_DRILL_SOURCE_URL=postgres://... pnpm --filter @nexter/db restore:drill
 *
 * Environment:
 *   RESTORE_DRILL_SOURCE_URL  Source database (defaults to DATABASE_URL)
 *   RESTORE_DRILL_MODE        auto | dump | json (default auto)
 *   RESTORE_DRILL_KEEP=1      Keep the restored database for inspection
 */

import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const { Client } = pg;

const scriptDir = dirname(fileURLToPath(import.meta.url));
const sourceUrlValue = process.env.RESTORE_DRILL_SOURCE_URL ?? process.env.DATABASE_URL;
const requestedMode = process.env.RESTORE_DRILL_MODE ?? 'auto';
const keep = process.env.RESTORE_DRILL_KEEP === '1';

if (!sourceUrlValue) {
  console.error('RESTORE_DRILL_SOURCE_URL or DATABASE_URL is required');
  process.exit(1);
}

const sourceUrl = new URL(sourceUrlValue);
const databaseName = `nexter_drill_${Date.now()}`;
const targetUrl = new URL(sourceUrlValue);
targetUrl.pathname = `/${databaseName}`;
const adminUrl = new URL(sourceUrlValue);
adminUrl.pathname = '/postgres';

function redact(url) {
  const copy = new URL(url.toString());
  if (copy.password) copy.password = '***';
  return copy.toString();
}

function quoteIdent(value) {
  return `"${value.replaceAll('"', '""')}"`;
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    stdio: options.capture ? 'pipe' : 'inherit',
    encoding: 'utf8',
    env: { ...process.env, ...options.env },
  });

  if (options.allowFailure) return result;
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} exited with ${result.status}`);
  }

  return result;
}

function hasCommand(command) {
  const result = spawnSync(command, ['--version'], { stdio: 'ignore' });
  return !result.error && result.status === 0;
}

function hasDocker() {
  const result = spawnSync('docker', ['info'], { stdio: 'ignore' });
  return !result.error && result.status === 0;
}

function chooseMode() {
  if (['dump', 'dump-docker', 'json'].includes(requestedMode)) return requestedMode;

  if (hasCommand('pg_dump') && hasCommand('pg_restore')) return 'dump';
  if (hasDocker()) return 'dump-docker';
  return 'json';
}

async function withClient(url, callback) {
  const client = new Client({ connectionString: url.toString() });
  await client.connect();

  try {
    return await callback(client);
  } finally {
    await client.end();
  }
}

async function adminClient(callback) {
  return withClient(adminUrl, callback);
}

async function createTarget() {
  await adminClient(async (client) => {
    await client.query(`drop database if exists ${quoteIdent(databaseName)}`);
    await client.query(`create database ${quoteIdent(databaseName)}`);
  });
}

async function dropTarget() {
  await adminClient(async (client) => {
    await client.query(`drop database if exists ${quoteIdent(databaseName)}`);
  });
}

async function migrateTarget() {
  const runner = resolve(scriptDir, '../dist/migrate.js');
  run(process.execPath, [runner], {
    env: { ...process.env, DATABASE_URL: targetUrl.toString() },
  });
}

function dumpRestoreNative() {
  const tempDir = mkdtempSync(join(tmpdir(), 'nexter-restore-'));
  const dumpFile = join(tempDir, 'nexter.dump');

  try {
    run('pg_dump', [
      '--format=custom',
      '--no-owner',
      '--no-privileges',
      `--file=${dumpFile}`,
      `--dbname=${sourceUrl.toString()}`,
    ]);
    run('pg_restore', [
      '--no-owner',
      '--no-privileges',
      '--exit-on-error',
      `--dbname=${targetUrl.toString()}`,
      dumpFile,
    ]);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

function dumpRestoreDocker() {
  const tempDir = mkdtempSync(join(tmpdir(), 'nexter-restore-'));
  const mount = `${tempDir}:/backup`;

  try {
    const sourcePassword = sourceUrl.password;
    const common = [
      'run',
      '--rm',
      '--network',
      'host',
      '-v',
      mount,
      '-e',
      `PGPASSWORD=${sourcePassword}`,
    ];

    run('docker', [
      ...common,
      'postgres:17-alpine',
      'pg_dump',
      '--format=custom',
      '--no-owner',
      '--no-privileges',
      '--host',
      sourceUrl.hostname,
      '--port',
      sourceUrl.port || '5432',
      '--username',
      decodeURIComponent(sourceUrl.username),
      '--dbname',
      sourceUrl.pathname.slice(1),
      '--file',
      '/backup/nexter.dump',
    ]);

    run('docker', [
      ...common,
      'postgres:17-alpine',
      'pg_restore',
      '--no-owner',
      '--no-privileges',
      '--exit-on-error',
      '--host',
      targetUrl.hostname,
      '--port',
      targetUrl.port || '5432',
      '--username',
      decodeURIComponent(targetUrl.username),
      '--dbname',
      targetUrl.pathname.slice(1),
      '/backup/nexter.dump',
    ]);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

async function listTables(client) {
  const result = await client.query(`
    select table_name
    from information_schema.tables
    where table_schema = 'public' and table_type = 'BASE TABLE'
    order by table_name
  `);

  return result.rows.map((row) => row.table_name);
}

async function copyDataJson() {
  await withClient(targetUrl, async (target) => {
    const targetTables = await listTables(target);

    if (targetTables.length > 0) {
      await target.query(
        `truncate table ${targetTables.map(quoteIdent).join(', ')} restart identity cascade`,
      );
    }

    await target.query('set session_replication_role = replica');

    try {
      const sourceTables = await withClient(sourceUrl, (source) => listTables(source));

      for (const table of sourceTables) {
        const data = await withClient(sourceUrl, async (source) => {
          const result = await source.query(
            `select coalesce(json_agg(t), '[]'::json)::text as rows from ${quoteIdent(table)} t`,
          );
          return result.rows[0]?.rows ?? '[]';
        });

        if (data === '[]') continue;

        await target.query(
          `insert into ${quoteIdent(table)} select * from json_populate_recordset(null::${quoteIdent(
            table,
          )}, $1::json)`,
          [data],
        );
      }
    } finally {
      await target.query('reset session_replication_role');
    }
  });
}

async function tableStats(client) {
  const tables = await listTables(client);
  const stats = {};

  for (const table of tables) {
    const countResult = await client.query(
      `select count(*)::int as count from ${quoteIdent(table)}`,
    );
    const count = countResult.rows[0]?.count ?? 0;
    let checksum = null;

    const idCheck = await client.query(
      `
      select 1
      from information_schema.columns
      where table_schema = 'public' and table_name = $1 and column_name = 'id'
      limit 1
    `,
      [table],
    );

    if (idCheck.rowCount > 0) {
      const checksumResult = await client.query(
        `select md5(coalesce(string_agg(id::text, ',' order by id::text), '')) as checksum from ${quoteIdent(
          table,
        )}`,
      );
      checksum = checksumResult.rows[0]?.checksum ?? null;
    }

    stats[table] = { count, checksum };
  }

  return stats;
}

async function scalar(client, query) {
  const result = await client.query(query);
  return result.rows[0]?.value ?? null;
}

async function invariants(client) {
  return {
    postingAmountSum: await scalar(
      client,
      'select coalesce(sum(amount), 0)::text as value from postings',
    ),
    realizedPnlSum: await scalar(
      client,
      'select coalesce(sum(realized_pnl_usd), 0)::text as value from lot_consumptions',
    ),
    lotRemainingSum: await scalar(
      client,
      'select coalesce(sum(remaining_amount), 0)::text as value from lots',
    ),
    orphanPostings: Number(
      await scalar(
        client,
        `select count(*)::int as value
         from postings p left join transactions t on t.id = p.transaction_id
         where t.id is null`,
      ),
    ),
    orphanLots: Number(
      await scalar(
        client,
        `select count(*)::int as value
         from lots l left join transactions t on t.id = l.acquisition_transaction_id
         where t.id is null`,
      ),
    ),
    orphanConsumptions: Number(
      await scalar(
        client,
        `select count(*)::int as value
         from lot_consumptions c
         left join lots l on l.id = c.lot_id
         left join transactions t on t.id = c.disposal_transaction_id
         where l.id is null or t.id is null`,
      ),
    ),
  };
}

function assertEqual(label, sourceValue, targetValue, failures) {
  const left = String(sourceValue ?? '');
  const right = String(targetValue ?? '');

  if (left !== right) {
    failures.push(`${label}: source=${left} target=${right}`);
  }
}

function compareStats(sourceStats, targetStats, failures) {
  const sourceTables = Object.keys(sourceStats).sort();
  const targetTables = Object.keys(targetStats).sort();

  if (sourceTables.join(',') !== targetTables.join(',')) {
    failures.push(
      `table list differs: source=${sourceTables.join(',')} target=${targetTables.join(',')}`,
    );
  }

  for (const table of sourceTables) {
    const source = sourceStats[table];
    const target = targetStats[table];

    if (!target) {
      failures.push(`${table}: missing in target`);
      continue;
    }

    assertEqual(`${table}.count`, source.count, target.count, failures);

    if (source.checksum && target.checksum) {
      assertEqual(`${table}.idChecksum`, source.checksum, target.checksum, failures);
    }
  }
}

async function main() {
  const mode = chooseMode();
  console.log(`Source: ${redact(sourceUrl)}`);
  console.log(`Target: ${redact(targetUrl)}`);
  console.log(`Mode: ${mode}`);

  await createTarget();

  try {
    if (mode === 'json') {
      await migrateTarget();
      await copyDataJson();
    } else if (mode === 'dump-docker') {
      dumpRestoreDocker();
    } else {
      dumpRestoreNative();
    }

    const sourceStats = await withClient(sourceUrl, tableStats);
    const targetStats = await withClient(targetUrl, tableStats);
    const sourceInvariants = await withClient(sourceUrl, invariants);
    const targetInvariants = await withClient(targetUrl, invariants);
    const failures = [];

    compareStats(sourceStats, targetStats, failures);

    for (const key of Object.keys(sourceInvariants)) {
      assertEqual(`invariant.${key}`, sourceInvariants[key], targetInvariants[key], failures);
    }

    if (targetInvariants.orphanPostings !== 0) failures.push('target has orphan postings');
    if (targetInvariants.orphanLots !== 0) failures.push('target has orphan lots');
    if (targetInvariants.orphanConsumptions !== 0) failures.push('target has orphan consumptions');

    // A restored database must be able to run the current migration set.
    await migrateTarget();

    const summary = {
      mode,
      source: redact(sourceUrl),
      target: redact(targetUrl),
      tables: Object.keys(targetStats).length,
      rows: Object.values(targetStats).reduce((total, value) => total + value.count, 0),
      invariants: targetInvariants,
      failures,
    };

    console.log(JSON.stringify(summary, null, 2));

    if (failures.length > 0) {
      console.error(`Restore drill FAILED with ${failures.length} difference(s)`);
      process.exitCode = 1;
      return;
    }

    console.log('Restore drill PASSED');
  } finally {
    if (keep) {
      console.log(`Kept restored database ${databaseName}`);
    } else {
      await dropTarget();
    }
  }
}

main().catch(async (error) => {
  console.error(error);
  process.exitCode = 1;

  try {
    if (!keep) await dropTarget();
  } catch {
    // The target may not exist; nothing else to clean up.
  }
});

import { loadRootEnv } from '@nexter/config';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { resolve } from 'node:path';
import { createDb } from './client';

loadRootEnv();

const connectionString: string =
  process.env.MIGRATION_DATABASE_URL ??
  process.env.DATABASE_URL ??
  (() => {
    throw new Error('MIGRATION_DATABASE_URL or DATABASE_URL is required to run migrations');
  })();

async function main() {
  const { db, pool } = createDb(connectionString);

  try {
    await migrate(db, { migrationsFolder: resolve(__dirname, '../drizzle') });
    console.log('Migrations applied');
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error('Migration failed', error);
  process.exitCode = 1;
});

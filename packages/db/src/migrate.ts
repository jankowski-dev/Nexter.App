import 'dotenv/config';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { createDb } from './client';

const connectionString =
  process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/nexter';

async function main() {
  const { db, pool } = createDb(connectionString);

  try {
    await migrate(db, { migrationsFolder: 'drizzle' });
    console.log('Migrations applied');
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error('Migration failed', error);
  process.exitCode = 1;
});

import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema';

export interface CreateDbOptions {
  maxConnections?: number;
}

export function createDb(connectionString: string, options: CreateDbOptions = {}) {
  const pool = new Pool({
    connectionString,
    max: options.maxConnections ?? 10,
  });

  const db = drizzle(pool, { schema });

  return { pool, db };
}

export type Database = ReturnType<typeof createDb>['db'];

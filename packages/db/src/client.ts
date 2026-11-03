import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema';

export interface CreateDbOptions {
  maxConnections?: number;
  connectionTimeoutMillis?: number;
  idleTimeoutMillis?: number;
  statementTimeoutMillis?: number;
  onPoolError?: (error: Error) => void;
}

export function createDb(connectionString: string, options: CreateDbOptions = {}) {
  const pool = new Pool({
    connectionString,
    max: options.maxConnections ?? 10,
    connectionTimeoutMillis: options.connectionTimeoutMillis ?? 5_000,
    idleTimeoutMillis: options.idleTimeoutMillis ?? 30_000,
    statement_timeout: options.statementTimeoutMillis ?? 15_000,
  });

  pool.on('error', (error) => {
    options.onPoolError?.(error);
  });

  const db = drizzle(pool, { schema });

  return { pool, db };
}

export type Database = ReturnType<typeof createDb>['db'];
export type DbTransaction = Parameters<Parameters<Database['transaction']>[0]>[0];
export type DbExecutor = Pick<Database, 'insert' | 'select' | 'update' | 'delete' | 'execute'>;

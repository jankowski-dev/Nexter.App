import { Global, Injectable, Logger, Module, type OnApplicationShutdown } from '@nestjs/common';
import { createDb, type Database } from '@nexter/db';
import type { Pool } from 'pg';
import { env } from '../config/env';

export const DB = Symbol('DB');
export const DB_POOL = Symbol('DB_POOL');

@Injectable()
export class DbService implements OnApplicationShutdown {
  private readonly logger = new Logger(DbService.name);
  readonly db: Database;
  readonly pool: Pool;

  constructor() {
    const created = createDb(env.DATABASE_URL, {
      onPoolError: (error) => {
        this.logger.error('Postgres pool error', error.stack);
      },
    });
    this.db = created.db;
    this.pool = created.pool;
  }

  async onApplicationShutdown(): Promise<void> {
    await this.pool.end();
  }
}

@Global()
@Module({
  providers: [
    DbService,
    {
      provide: DB,
      useFactory: (service: DbService) => service.db,
      inject: [DbService],
    },
    {
      provide: DB_POOL,
      useFactory: (service: DbService) => service.pool,
      inject: [DbService],
    },
  ],
  exports: [DbService, DB, DB_POOL],
})
export class DbModule {}

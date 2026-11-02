import { Inject, Injectable, ServiceUnavailableException } from '@nestjs/common';
import type { Database } from '@nexter/db';
import type { HealthResponse, ReadinessResponse } from '@nexter/contracts';
import { sql } from 'drizzle-orm';
import { env } from '../../shared/config/env';
import { DB } from '../../shared/db/db.module';

@Injectable()
export class HealthService {
  constructor(@Inject(DB) private readonly db: Database) {}

  liveness(): HealthResponse {
    return {
      status: 'ok',
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
      version: env.VERSION,
    };
  }

  async readiness(): Promise<ReadinessResponse> {
    try {
      await this.db.execute(sql`select 1`);
    } catch {
      throw new ServiceUnavailableException('Database is not ready');
    }

    return {
      status: 'ready',
      database: 'ok',
      timestamp: new Date().toISOString(),
    };
  }
}

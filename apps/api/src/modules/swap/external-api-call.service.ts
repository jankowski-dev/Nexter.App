import { Inject, Injectable, Logger } from '@nestjs/common';
import { externalApiCalls, type Database } from '@nexter/db';
import { DB } from '../../shared/db/db.module';

export interface ExternalApiCallInput {
  userId?: string;
  provider: string;
  endpoint: string;
  status: number;
  latencyMs: number;
  errorCode?: string | null;
}

@Injectable()
export class ExternalApiCallService {
  private readonly logger = new Logger(ExternalApiCallService.name);

  constructor(@Inject(DB) private readonly db: Database) {}

  async record(input: ExternalApiCallInput): Promise<void> {
    try {
      await this.db.insert(externalApiCalls).values({
        userId: input.userId ?? null,
        provider: input.provider,
        endpoint: input.endpoint.slice(0, 200),
        status: input.status,
        latencyMs: Math.max(0, Math.min(input.latencyMs, 600_000)),
        errorCode: input.errorCode?.slice(0, 100) ?? null,
      });
    } catch (error) {
      // Observability must never break a quote/build request.
      this.logger.warn(
        `Failed to record external API call: ${error instanceof Error ? error.message : 'unknown'}`,
      );
    }
  }
}

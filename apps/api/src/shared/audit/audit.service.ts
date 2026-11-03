import { Inject, Injectable, Logger } from '@nestjs/common';
import { auditLog, type Database } from '@nexter/db';
import { DB } from '../db/db.module';

export interface AuditInput {
  userId?: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  before?: unknown;
  after?: unknown;
  ip?: string;
  userAgent?: string;
}

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(@Inject(DB) private readonly db: Database) {}

  async log(input: AuditInput): Promise<void> {
    try {
      await this.db.insert(auditLog).values({
        userId: input.userId ?? null,
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId ?? null,
        before: input.before,
        after: input.after,
        ip: input.ip,
        userAgent: input.userAgent,
      });
    } catch (error) {
      this.logger.error(
        'Failed to write audit log',
        error instanceof Error ? error.stack : undefined,
      );
    }
  }
}

import { Inject, Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import {
  accounts,
  chains,
  users,
  type AccountType,
  type Database,
  type DbExecutor,
} from '@nexter/db';
import { AuditService } from '../../shared/audit/audit.service';
import { DB } from '../../shared/db/db.module';

interface AccountSeed {
  name: string;
  type: AccountType;
  chainCode?: string;
  isSystem: boolean;
}

const ACCOUNT_SEEDS: AccountSeed[] = [
  { name: 'External', type: 'external', isSystem: true },
  { name: 'Income', type: 'income', isSystem: true },
  { name: 'Expense', type: 'expense', isSystem: true },
  { name: 'Equity', type: 'equity', isSystem: true },
  { name: 'Tangem BSC', type: 'wallet', chainCode: 'bsc', isSystem: false },
  { name: 'Tangem Ethereum', type: 'wallet', chainCode: 'ethereum', isSystem: false },
];

@Injectable()
export class AccountingBootstrapService implements OnApplicationBootstrap {
  private readonly logger = new Logger(AccountingBootstrapService.name);

  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly audit: AuditService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    try {
      await this.ensureDefaultsForExistingUsers();
    } catch (error) {
      this.logger.error(
        'Failed to bootstrap accounting accounts',
        error instanceof Error ? error.stack : undefined,
      );
    }
  }

  async ensureDefaults(
    userId: string,
    executor: DbExecutor = this.db,
    meta: { ip?: string; userAgent?: string } = {},
    strictAudit = false,
  ): Promise<void> {
    const chainRows = await executor.select().from(chains);
    const chainByCode = new Map(chainRows.map((chain) => [chain.code, chain.id]));
    const now = new Date();

    for (const seed of ACCOUNT_SEEDS) {
      const chainId = seed.chainCode ? chainByCode.get(seed.chainCode) : undefined;

      if (seed.chainCode && !chainId) {
        throw new Error(`Chain ${seed.chainCode} is not seeded`);
      }

      const [created] = await executor
        .insert(accounts)
        .values({
          userId,
          name: seed.name,
          type: seed.type,
          chainId: chainId ?? null,
          isSystem: seed.isSystem,
          updatedAt: now,
        })
        .onConflictDoNothing({ target: [accounts.userId, accounts.name] })
        .returning({ id: accounts.id });

      if (created) {
        await this.audit.log(
          {
            userId,
            action: 'accounting.account_bootstrapped',
            entityType: 'account',
            entityId: created.id,
            after: {
              name: seed.name,
              type: seed.type,
              chainCode: seed.chainCode ?? null,
              isSystem: seed.isSystem,
            },
            ip: meta.ip,
            userAgent: meta.userAgent,
          },
          { executor, strict: strictAudit },
        );
      }
    }
  }

  async ensureDefaultsForExistingUsers(): Promise<void> {
    const rows = await this.db.select({ id: users.id }).from(users);

    for (const row of rows) {
      await this.db.transaction(async (tx) => {
        await this.ensureDefaults(row.id, tx, {}, true);
      });
    }
  }
}

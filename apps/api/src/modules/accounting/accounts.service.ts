import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
import {
  accounts,
  chains,
  postings,
  type Account,
  type AccountType,
  type Database,
  type DbExecutor,
} from '@nexter/db';
import type { Account as AccountContract } from '@nexter/contracts';
import { DB } from '../../shared/db/db.module';
import { AccountingBootstrapService } from './accounting-bootstrap.service';

@Injectable()
export class AccountsService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly bootstrap: AccountingBootstrapService,
  ) {}

  private toContract(row: { account: Account; chainCode: string | null }): AccountContract {
    return {
      id: row.account.id,
      name: row.account.name,
      type: row.account.type,
      chainId: row.account.chainId,
      chainCode: row.chainCode,
      isSystem: row.account.isSystem,
    };
  }

  async list(userId: string): Promise<AccountContract[]> {
    await this.bootstrap.ensureDefaults(userId);

    const rows = await this.db
      .select({ account: accounts, chainCode: chains.code })
      .from(accounts)
      .leftJoin(chains, eq(accounts.chainId, chains.id))
      .where(eq(accounts.userId, userId))
      .orderBy(accounts.isSystem, accounts.name);

    return rows.map((row) => this.toContract(row));
  }

  async requireWalletForChain(
    userId: string,
    accountId: string,
    chainCode: string,
    executor: DbExecutor = this.db,
  ): Promise<Account> {
    const account = await this.requireWallet(userId, accountId, executor);

    const [row] = await executor
      .select({ id: accounts.id })
      .from(accounts)
      .innerJoin(chains, eq(accounts.chainId, chains.id))
      .where(
        and(eq(accounts.id, account.id), eq(accounts.userId, userId), eq(chains.code, chainCode)),
      )
      .limit(1);

    if (!row) {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        message: `Wallet account does not belong to ${chainCode}`,
      });
    }

    return account;
  }

  async defaultWalletForChain(
    userId: string,
    chainCode: string,
    executor: DbExecutor = this.db,
  ): Promise<Account> {
    await this.bootstrap.ensureDefaults(userId, executor);

    const [row] = await executor
      .select({ account: accounts })
      .from(accounts)
      .innerJoin(chains, eq(accounts.chainId, chains.id))
      .where(
        and(eq(accounts.userId, userId), eq(accounts.type, 'wallet'), eq(chains.code, chainCode)),
      )
      .orderBy(accounts.name)
      .limit(1);

    if (!row) {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        message: `No ${chainCode} wallet account is configured`,
      });
    }

    return row.account;
  }

  async get(userId: string, accountId: string): Promise<AccountContract> {
    await this.bootstrap.ensureDefaults(userId);

    const [row] = await this.db
      .select({ account: accounts, chainCode: chains.code })
      .from(accounts)
      .leftJoin(chains, eq(accounts.chainId, chains.id))
      .where(and(eq(accounts.id, accountId), eq(accounts.userId, userId)))
      .limit(1);

    if (!row) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Account not found' });
    }

    return this.toContract(row);
  }

  async require(
    userId: string,
    accountId: string,
    executor: DbExecutor = this.db,
  ): Promise<Account> {
    const [account] = await executor
      .select()
      .from(accounts)
      .where(and(eq(accounts.id, accountId), eq(accounts.userId, userId)))
      .limit(1);

    if (!account) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Account not found' });
    }

    return account;
  }

  async requireWallet(
    userId: string,
    accountId: string,
    executor: DbExecutor = this.db,
  ): Promise<Account> {
    const account = await this.require(userId, accountId, executor);

    if (account.type !== 'wallet') {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Wallet account not found' });
    }

    return account;
  }

  async systemAccount(
    userId: string,
    type: AccountType,
    executor: DbExecutor = this.db,
  ): Promise<Account> {
    const [account] = await executor
      .select()
      .from(accounts)
      .where(and(eq(accounts.userId, userId), eq(accounts.type, type), eq(accounts.isSystem, true)))
      .limit(1);

    if (!account) {
      throw new Error(`System account ${type} is not configured`);
    }

    return account;
  }

  async balance(
    accountId: string,
    assetId: string,
    executor: DbExecutor = this.db,
  ): Promise<string> {
    const [row] = await executor
      .select({ amount: sql<string>`coalesce(sum(${postings.amount}), 0)::text` })
      .from(postings)
      .where(and(eq(postings.accountId, accountId), eq(postings.assetId, assetId)));

    return row?.amount ?? '0';
  }
}

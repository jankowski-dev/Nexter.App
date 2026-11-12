import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, desc, eq, gte, ilike, isNull, lte, or } from 'drizzle-orm';
import {
  financeAccounts,
  financeCategories,
  financeTransactions,
  financeTransfers,
  type Database,
  type DbExecutor,
  type FinanceAccount,
  type FinanceCategory,
  type FinanceTransaction,
  type FinanceTransfer,
} from '@nexter/db';
import type {
  FinanceAccountCreateRequest,
  FinanceAccountUpdateRequest,
  FinanceAccountWithBalance,
  FinanceAccountsResponse,
  FinanceCategoryCreateRequest,
  FinanceCategoryUpdateRequest,
  FinanceCategoryTotal,
  FinanceCategoriesResponse,
  FinanceCreditDrawdownRequest,
  FinanceCreditDrawdownResponse,
  FinanceJournalResponse,
  FinanceListQuery,
  FinanceMonthTotal,
  FinanceSummary,
  FinanceSummaryQuery,
  FinanceTransaction as FinanceTransactionContract,
  FinanceTransactionCreateRequest,
  FinanceTransactionUpdateRequest,
  FinanceTransactionsResponse,
  FinanceTransfer as FinanceTransferContract,
  FinanceTransferCreateRequest,
  FinanceTransfersResponse,
  FinanceTransferUpdateRequest,
} from '@nexter/contracts';
import { AuditService } from '../../shared/audit/audit.service';
import { DB } from '../../shared/db/db.module';
import { Decimal, decimal } from '../../shared/money/decimal';
import { financeBaseAmount, roundFinanceAmount } from './finance-money';

function rethrowUnique(error: unknown, message: string): never {
  const candidate =
    typeof error === 'object' && error !== null
      ? (error as { code?: string; cause?: { code?: string } })
      : null;
  if (candidate?.code === '23505' || candidate?.cause?.code === '23505') {
    throw new ConflictException({ code: 'CONFLICT', message });
  }
  throw error;
}

interface FinanceMeta {
  ip?: string;
  userAgent?: string;
}

interface BalanceRow {
  account: FinanceAccount;
  balance: Decimal;
  balanceBase: Decimal;
}

function toAccount(row: FinanceAccount) {
  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    currency: row.currency,
    openingBalance: row.openingBalance,
    openingDate: row.openingDate,
    fxRate: row.fxRate,
    creditLimit: row.creditLimit,
    sortOrder: row.sortOrder,
    archivedAt: row.archivedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toCategory(row: FinanceCategory) {
  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    color: row.color,
    icon: row.icon,
    sortOrder: row.sortOrder,
    archivedAt: row.archivedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toTransaction(row: FinanceTransaction): FinanceTransactionContract {
  return {
    id: row.id,
    kind: row.kind,
    occurredOn: row.occurredOn,
    accountId: row.accountId,
    categoryId: row.categoryId,
    amount: row.amount,
    currency: row.currency,
    fxRate: row.fxRate,
    baseAmount: row.baseAmount,
    title: row.title,
    description: row.description,
    source: row.source,
    sourceId: row.sourceId,
    archivedAt: row.archivedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toTransfer(row: FinanceTransfer): FinanceTransferContract {
  return {
    id: row.id,
    kind: row.kind,
    occurredOn: row.occurredOn,
    fromAccountId: row.fromAccountId,
    toAccountId: row.toAccountId,
    fromAmount: row.fromAmount,
    toAmount: row.toAmount,
    fromCurrency: row.fromCurrency,
    toCurrency: row.toCurrency,
    fxRate: row.fxRate,
    fromBaseAmount: row.fromBaseAmount,
    toBaseAmount: row.toBaseAmount,
    description: row.description,
    source: row.source,
    sourceId: row.sourceId,
    archivedAt: row.archivedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function monthOf(date: string): string {
  return date.slice(0, 7);
}

function shiftMonth(month: string, delta: number): string {
  const [year, monthNumber] = month.split('-').map(Number);
  const date = new Date(Date.UTC(year, monthNumber - 1 + delta, 1));
  return date.toISOString().slice(0, 7);
}

function currentMonth(): string {
  return new Date().toISOString().slice(0, 7);
}

@Injectable()
export class FinanceService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly audit: AuditService,
  ) {}

  async listAccounts(userId: string): Promise<FinanceAccountsResponse> {
    const balances = await this.balances(userId);
    return {
      accounts: balances.map((row) => ({
        ...toAccount(row.account),
        balance: row.balance.toFixed(2),
        balanceBase: row.balanceBase.toFixed(2),
      })),
    };
  }

  async createAccount(
    userId: string,
    input: FinanceAccountCreateRequest,
    meta: FinanceMeta,
  ): Promise<FinanceAccountWithBalance> {
    const [created] = await this.db
      .insert(financeAccounts)
      .values({
        userId,
        name: input.name,
        kind: input.kind,
        currency: input.currency,
        openingBalance: input.openingBalance ?? '0',
        openingDate: input.openingDate,
        fxRate: input.currency === 'BYN' ? '1' : (input.fxRate ?? '1'),
        creditLimit: input.creditLimit ?? null,
        sortOrder: input.sortOrder ?? 0,
      })
      .returning()
      .catch((error) => rethrowUnique(error, 'Account with this name already exists'));

    if (!created) throw new Error('Failed to create finance account');

    await this.audit.log(
      {
        userId,
        action: 'finance.account_created',
        entityType: 'finance_account',
        entityId: created.id,
        after: {
          name: created.name,
          kind: created.kind,
          currency: created.currency,
          openingBalance: created.openingBalance,
          fxRate: created.fxRate,
          creditLimit: created.creditLimit,
        },
        ip: meta.ip,
        userAgent: meta.userAgent,
      },
      { strict: true },
    );

    return {
      ...toAccount(created),
      balance: created.openingBalance,
      balanceBase: financeBaseAmount(created.openingBalance, created.fxRate),
    };
  }

  async updateAccount(
    userId: string,
    id: string,
    input: FinanceAccountUpdateRequest,
    meta: FinanceMeta,
  ): Promise<FinanceAccountWithBalance> {
    const [existing] = await this.db
      .select()
      .from(financeAccounts)
      .where(and(eq(financeAccounts.id, id), eq(financeAccounts.userId, userId)))
      .limit(1);

    if (!existing) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Account not found' });

    if (input.currency && input.currency !== existing.currency) {
      const [used] = await this.db
        .select({ id: financeTransactions.id })
        .from(financeTransactions)
        .where(and(eq(financeTransactions.userId, userId), eq(financeTransactions.accountId, id)))
        .limit(1);
      const [usedTransfer] = await this.db
        .select({ id: financeTransfers.id })
        .from(financeTransfers)
        .where(
          and(
            eq(financeTransfers.userId, userId),
            or(eq(financeTransfers.fromAccountId, id), eq(financeTransfers.toAccountId, id)),
          ),
        )
        .limit(1);

      if (used || usedTransfer) {
        throw new ConflictException({
          code: 'CONFLICT',
          message: 'Account currency cannot change while the account has transactions',
        });
      }
    }

    const targetCurrency = input.currency ?? existing.currency;
    if (
      targetCurrency !== existing.currency &&
      targetCurrency !== 'BYN' &&
      input.fxRate === undefined
    ) {
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: 'Explicit fxRate is required when changing account currency',
      });
    }
    const targetFxRate = targetCurrency === 'BYN' ? '1' : (input.fxRate ?? existing.fxRate);

    const [updated] = await this.db
      .update(financeAccounts)
      .set({
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.kind !== undefined ? { kind: input.kind } : {}),
        ...(input.currency !== undefined ? { currency: input.currency } : {}),
        ...(input.openingBalance !== undefined ? { openingBalance: input.openingBalance } : {}),
        ...(input.openingDate !== undefined ? { openingDate: input.openingDate } : {}),
        fxRate: targetFxRate,
        ...(input.creditLimit !== undefined ? { creditLimit: input.creditLimit } : {}),
        ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}),
        ...(input.archived !== undefined ? { archivedAt: input.archived ? new Date() : null } : {}),
        updatedAt: new Date(),
      })
      .where(eq(financeAccounts.id, id))
      .returning()
      .catch((error) => rethrowUnique(error, 'Account with this name already exists'));

    if (!updated) throw new Error('Failed to update finance account');

    await this.audit.log(
      {
        userId,
        action: 'finance.account_updated',
        entityType: 'finance_account',
        entityId: id,
        before: {
          name: existing.name,
          kind: existing.kind,
          currency: existing.currency,
          openingBalance: existing.openingBalance,
          fxRate: existing.fxRate,
          creditLimit: existing.creditLimit,
          archivedAt: existing.archivedAt,
        },
        after: {
          name: updated.name,
          kind: updated.kind,
          currency: updated.currency,
          openingBalance: updated.openingBalance,
          fxRate: updated.fxRate,
          creditLimit: updated.creditLimit,
          archivedAt: updated.archivedAt,
        },
        ip: meta.ip,
        userAgent: meta.userAgent,
      },
      { strict: true },
    );

    const balance = (await this.balances(userId)).find((row) => row.account.id === id);

    return {
      ...toAccount(updated),
      balance: balance?.balance.toFixed(2) ?? updated.openingBalance,
      balanceBase: balance?.balanceBase.toFixed(2) ?? '0.00',
    };
  }

  async listCategories(userId: string): Promise<FinanceCategoriesResponse> {
    const rows = await this.db
      .select()
      .from(financeCategories)
      .where(eq(financeCategories.userId, userId))
      .orderBy(financeCategories.kind, financeCategories.sortOrder, financeCategories.name);

    return { categories: rows.map(toCategory) };
  }

  async createCategory(userId: string, input: FinanceCategoryCreateRequest, meta: FinanceMeta) {
    const [created] = await this.db
      .insert(financeCategories)
      .values({
        userId,
        name: input.name,
        kind: input.kind,
        color: input.color ?? null,
        icon: input.icon ?? null,
        sortOrder: input.sortOrder ?? 0,
      })
      .returning()
      .catch((error) => rethrowUnique(error, 'Category with this name already exists'));

    if (!created) throw new Error('Failed to create finance category');

    await this.audit.log(
      {
        userId,
        action: 'finance.category_created',
        entityType: 'finance_category',
        entityId: created.id,
        after: { name: created.name, kind: created.kind },
        ip: meta.ip,
        userAgent: meta.userAgent,
      },
      { strict: true },
    );

    return toCategory(created);
  }

  async updateCategory(
    userId: string,
    id: string,
    input: FinanceCategoryUpdateRequest,
    meta: FinanceMeta,
  ) {
    const [existing] = await this.db
      .select()
      .from(financeCategories)
      .where(and(eq(financeCategories.id, id), eq(financeCategories.userId, userId)))
      .limit(1);

    if (!existing) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Category not found' });
    }

    const [updated] = await this.db
      .update(financeCategories)
      .set({
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.color !== undefined ? { color: input.color } : {}),
        ...(input.icon !== undefined ? { icon: input.icon } : {}),
        ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}),
        ...(input.archived !== undefined ? { archivedAt: input.archived ? new Date() : null } : {}),
        updatedAt: new Date(),
      })
      .where(eq(financeCategories.id, id))
      .returning()
      .catch((error) => rethrowUnique(error, 'Category with this name already exists'));

    if (!updated) throw new Error('Failed to update finance category');

    await this.audit.log(
      {
        userId,
        action: 'finance.category_updated',
        entityType: 'finance_category',
        entityId: id,
        before: {
          name: existing.name,
          color: existing.color,
          icon: existing.icon,
          archivedAt: existing.archivedAt,
        },
        after: {
          name: updated.name,
          color: updated.color,
          icon: updated.icon,
          archivedAt: updated.archivedAt,
        },
        ip: meta.ip,
        userAgent: meta.userAgent,
      },
      { strict: true },
    );

    return toCategory(updated);
  }

  async listTransactions(
    userId: string,
    query: FinanceListQuery,
  ): Promise<FinanceTransactionsResponse> {
    if (
      query.kind === 'exchange' ||
      query.kind === 'card_topup' ||
      query.kind === 'credit' ||
      query.kind === 'other'
    ) {
      return { transactions: [] };
    }

    const conditions = [eq(financeTransactions.userId, userId)];
    if (!query.includeArchived) conditions.push(isNull(financeTransactions.archivedAt));
    if (query.from) conditions.push(gte(financeTransactions.occurredOn, query.from));
    if (query.to) conditions.push(lte(financeTransactions.occurredOn, query.to));
    if (query.accountId) conditions.push(eq(financeTransactions.accountId, query.accountId));
    if (query.categoryId) conditions.push(eq(financeTransactions.categoryId, query.categoryId));
    if (query.kind === 'income' || query.kind === 'expense') {
      conditions.push(eq(financeTransactions.kind, query.kind));
    }
    if (query.search) {
      const pattern = `%${query.search}%`;
      conditions.push(
        or(
          ilike(financeTransactions.title, pattern),
          ilike(financeTransactions.description, pattern),
        )!,
      );
    }

    const rows = await this.db
      .select()
      .from(financeTransactions)
      .where(and(...conditions))
      .orderBy(desc(financeTransactions.occurredOn), desc(financeTransactions.createdAt))
      .limit(query.limit);

    return { transactions: rows.map(toTransaction) };
  }

  async createTransaction(
    userId: string,
    input: FinanceTransactionCreateRequest,
    meta: FinanceMeta,
  ): Promise<FinanceTransactionContract> {
    const account = await this.requireAccount(userId, input.accountId);
    const category = input.categoryId ? await this.requireCategory(userId, input.categoryId) : null;

    if (category && category.kind !== input.kind) {
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: 'Category kind does not match transaction kind',
      });
    }

    const baseAmount = financeBaseAmount(input.amount, account.fxRate);

    const [created] = await this.db
      .insert(financeTransactions)
      .values({
        userId,
        kind: input.kind,
        occurredOn: input.occurredOn,
        accountId: account.id,
        categoryId: category?.id ?? null,
        amount: input.amount,
        currency: account.currency,
        fxRate: account.fxRate,
        baseAmount,
        title: input.title,
        description: input.description ?? null,
      })
      .returning();

    if (!created) throw new Error('Failed to create finance transaction');

    await this.audit.log(
      {
        userId,
        action: 'finance.transaction_created',
        entityType: 'finance_transaction',
        entityId: created.id,
        after: {
          kind: created.kind,
          amount: created.amount,
          currency: created.currency,
          accountId: created.accountId,
          categoryId: created.categoryId,
          occurredOn: created.occurredOn,
        },
        ip: meta.ip,
        userAgent: meta.userAgent,
      },
      { strict: true },
    );

    return toTransaction(created);
  }

  async updateTransaction(
    userId: string,
    id: string,
    input: FinanceTransactionUpdateRequest,
    meta: FinanceMeta,
  ): Promise<FinanceTransactionContract> {
    const [existing] = await this.db
      .select()
      .from(financeTransactions)
      .where(and(eq(financeTransactions.id, id), eq(financeTransactions.userId, userId)))
      .limit(1);

    if (!existing) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Transaction not found' });
    }

    const accountChanged = input.accountId !== undefined && input.accountId !== existing.accountId;
    const amountChanged = input.amount !== undefined && !decimal(input.amount).eq(existing.amount);
    const account =
      accountChanged || amountChanged
        ? await this.requireAccount(
            userId,
            input.accountId ?? existing.accountId,
            this.db,
            !accountChanged && !amountChanged,
          )
        : null;
    const categoryId = input.categoryId === undefined ? existing.categoryId : input.categoryId;
    const categoryChanged =
      input.categoryId !== undefined && input.categoryId !== existing.categoryId;
    const category = categoryId
      ? await this.requireCategory(userId, categoryId, this.db, !categoryChanged)
      : null;
    const kind = input.kind ?? existing.kind;

    if (category && category.kind !== kind) {
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: 'Category kind does not match transaction kind',
      });
    }

    const baseAmount = account
      ? financeBaseAmount(input.amount ?? existing.amount, account.fxRate)
      : existing.baseAmount;

    const [updated] = await this.db
      .update(financeTransactions)
      .set({
        ...(input.kind !== undefined ? { kind: input.kind } : {}),
        ...(input.occurredOn !== undefined ? { occurredOn: input.occurredOn } : {}),
        ...(account ? { accountId: account.id } : {}),
        ...(input.categoryId !== undefined ? { categoryId: input.categoryId } : {}),
        ...(input.amount !== undefined ? { amount: input.amount } : {}),
        ...(account ? { currency: account.currency, fxRate: account.fxRate, baseAmount } : {}),
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.archived !== undefined ? { archivedAt: input.archived ? new Date() : null } : {}),
        updatedAt: new Date(),
      })
      .where(eq(financeTransactions.id, id))
      .returning();

    if (!updated) throw new Error('Failed to update finance transaction');

    await this.audit.log(
      {
        userId,
        action: 'finance.transaction_updated',
        entityType: 'finance_transaction',
        entityId: id,
        before: {
          amount: existing.amount,
          kind: existing.kind,
          accountId: existing.accountId,
          categoryId: existing.categoryId,
          archivedAt: existing.archivedAt,
        },
        after: {
          amount: updated.amount,
          kind: updated.kind,
          accountId: updated.accountId,
          categoryId: updated.categoryId,
          archivedAt: updated.archivedAt,
        },
        ip: meta.ip,
        userAgent: meta.userAgent,
      },
      { strict: true },
    );

    return toTransaction(updated);
  }

  async listTransfers(userId: string, query: FinanceListQuery): Promise<FinanceTransfersResponse> {
    if (query.kind === 'income' || query.kind === 'expense') {
      return { transfers: [] };
    }

    const conditions = [eq(financeTransfers.userId, userId)];
    if (!query.includeArchived) conditions.push(isNull(financeTransfers.archivedAt));
    if (query.from) conditions.push(gte(financeTransfers.occurredOn, query.from));
    if (query.to) conditions.push(lte(financeTransfers.occurredOn, query.to));
    if (query.accountId) {
      conditions.push(
        or(
          eq(financeTransfers.fromAccountId, query.accountId),
          eq(financeTransfers.toAccountId, query.accountId),
        )!,
      );
    }
    if (
      query.kind === 'exchange' ||
      query.kind === 'card_topup' ||
      query.kind === 'credit' ||
      query.kind === 'other'
    ) {
      conditions.push(eq(financeTransfers.kind, query.kind));
    }
    if (query.search) {
      conditions.push(ilike(financeTransfers.description, `%${query.search}%`));
    }

    const rows = await this.db
      .select()
      .from(financeTransfers)
      .where(and(...conditions))
      .orderBy(desc(financeTransfers.occurredOn), desc(financeTransfers.createdAt))
      .limit(query.limit);

    return { transfers: rows.map(toTransfer) };
  }

  async journal(userId: string, query: FinanceListQuery): Promise<FinanceJournalResponse> {
    const transactionKind = query.kind === 'income' || query.kind === 'expense';
    const transferKind =
      query.kind === 'exchange' ||
      query.kind === 'card_topup' ||
      query.kind === 'credit' ||
      query.kind === 'other';

    const [transactions, transfers] = await Promise.all([
      transferKind
        ? Promise.resolve({ transactions: [] as FinanceTransactionContract[] })
        : this.listTransactions(userId, query),
      transactionKind
        ? Promise.resolve({ transfers: [] as FinanceTransferContract[] })
        : this.listTransfers(userId, query),
    ]);

    return {
      transactions: transactions.transactions,
      transfers: transfers.transfers,
    };
  }

  async createTransfer(
    userId: string,
    input: FinanceTransferCreateRequest,
    meta: FinanceMeta,
  ): Promise<FinanceTransferContract> {
    const from = await this.requireAccount(userId, input.fromAccountId);
    const to = await this.requireAccount(userId, input.toAccountId);

    if (from.id === to.id) {
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: 'Transfer accounts must differ',
      });
    }

    return this.insertTransfer(userId, input, from, to, meta);
  }

  async updateTransfer(
    userId: string,
    id: string,
    input: FinanceTransferUpdateRequest,
    meta: FinanceMeta,
  ): Promise<FinanceTransferContract> {
    const [existing] = await this.db
      .select()
      .from(financeTransfers)
      .where(and(eq(financeTransfers.id, id), eq(financeTransfers.userId, userId)))
      .limit(1);

    if (!existing) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Transfer not found' });
    }

    const fromChanged =
      input.fromAccountId !== undefined && input.fromAccountId !== existing.fromAccountId;
    const toChanged = input.toAccountId !== undefined && input.toAccountId !== existing.toAccountId;
    const fromAmountChanged =
      input.fromAmount !== undefined && !decimal(input.fromAmount).eq(existing.fromAmount);
    const toAmountChanged =
      input.toAmount !== undefined && !decimal(input.toAmount).eq(existing.toAmount);
    const from = await this.requireAccount(
      userId,
      input.fromAccountId ?? existing.fromAccountId,
      this.db,
      !fromChanged && !fromAmountChanged,
    );
    const to = await this.requireAccount(
      userId,
      input.toAccountId ?? existing.toAccountId,
      this.db,
      !toChanged && !toAmountChanged,
    );

    if (from.id === to.id) {
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: 'Transfer accounts must differ',
      });
    }

    const recalculate = fromChanged || toChanged || fromAmountChanged || toAmountChanged;
    const fromAmount = input.fromAmount ?? existing.fromAmount;
    const toAmount = input.toAmount ?? existing.toAmount;
    const fromBaseAmount = recalculate
      ? financeBaseAmount(fromAmount, from.fxRate)
      : existing.fromBaseAmount;
    const toBaseAmount = recalculate
      ? financeBaseAmount(toAmount, to.fxRate)
      : existing.toBaseAmount;
    const fxRate = recalculate ? decimal(toAmount).div(fromAmount).toFixed(8) : existing.fxRate;

    const [updated] = await this.db
      .update(financeTransfers)
      .set({
        ...(input.kind !== undefined ? { kind: input.kind } : {}),
        ...(input.occurredOn !== undefined ? { occurredOn: input.occurredOn } : {}),
        ...(fromChanged ? { fromAccountId: from.id } : {}),
        ...(toChanged ? { toAccountId: to.id } : {}),
        ...(input.fromAmount !== undefined ? { fromAmount: input.fromAmount } : {}),
        ...(input.toAmount !== undefined ? { toAmount: input.toAmount } : {}),
        ...(recalculate
          ? {
              fromCurrency: from.currency,
              toCurrency: to.currency,
              fxRate,
              fromBaseAmount,
              toBaseAmount,
            }
          : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.archived !== undefined ? { archivedAt: input.archived ? new Date() : null } : {}),
        updatedAt: new Date(),
      })
      .where(eq(financeTransfers.id, id))
      .returning();

    if (!updated) throw new Error('Failed to update finance transfer');

    await this.audit.log(
      {
        userId,
        action: 'finance.transfer_updated',
        entityType: 'finance_transfer',
        entityId: id,
        before: {
          fromAmount: existing.fromAmount,
          toAmount: existing.toAmount,
          fromAccountId: existing.fromAccountId,
          toAccountId: existing.toAccountId,
        },
        after: {
          fromAmount: updated.fromAmount,
          toAmount: updated.toAmount,
          fromAccountId: updated.fromAccountId,
          toAccountId: updated.toAccountId,
        },
        ip: meta.ip,
        userAgent: meta.userAgent,
      },
      { strict: true },
    );

    return toTransfer(updated);
  }

  async summary(userId: string, query: FinanceSummaryQuery): Promise<FinanceSummary> {
    const month = query.month ?? (query.to ? query.to.slice(0, 7) : currentMonth());
    const inSelectedRange = (date: string): boolean => {
      if (query.all) return true;
      if (query.from || query.to) {
        if (query.from && date < query.from) return false;
        if (query.to && date > query.to) return false;
        return true;
      }
      return monthOf(date) === month;
    };

    const balances = await this.balances(userId);
    const accountById = new Map(balances.map((row) => [row.account.id, row.account]));
    const [transactions, transfers] = await Promise.all([
      this.db
        .select()
        .from(financeTransactions)
        .where(and(eq(financeTransactions.userId, userId), isNull(financeTransactions.archivedAt))),
      this.db
        .select()
        .from(financeTransfers)
        .where(and(eq(financeTransfers.userId, userId), isNull(financeTransfers.archivedAt))),
    ]);
    // A transfer into a credit account from an asset account is a principal repayment.
    // It is a cash-flow expense even though the liability reduction keeps net worth unchanged.
    const creditRepayments = transfers.filter((transfer) => {
      const from = accountById.get(transfer.fromAccountId);
      const to = accountById.get(transfer.toAccountId);
      return Boolean(from && to && to.kind === 'credit' && from.kind !== 'credit');
    });

    const monthTotals = new Map<string, FinanceMonthTotal>();
    const ensureMonth = (key: string): FinanceMonthTotal => {
      const existing = monthTotals.get(key);
      if (existing) return existing;
      const row: FinanceMonthTotal = {
        month: key,
        incomeBase: '0.00',
        expenseBase: '0.00',
        netBase: '0.00',
        incomeCount: 0,
        expenseCount: 0,
      };
      monthTotals.set(key, row);
      return row;
    };

    for (const transaction of transactions) {
      const row = ensureMonth(monthOf(transaction.occurredOn));
      if (transaction.kind === 'income') {
        row.incomeBase = decimal(row.incomeBase).plus(transaction.baseAmount).toFixed(2);
        row.incomeCount += 1;
      } else {
        row.expenseBase = decimal(row.expenseBase).plus(transaction.baseAmount).toFixed(2);
        row.expenseCount += 1;
      }
      row.netBase = decimal(row.incomeBase).minus(row.expenseBase).toFixed(2);
    }

    for (const transfer of creditRepayments) {
      const row = ensureMonth(monthOf(transfer.occurredOn));
      row.expenseBase = decimal(row.expenseBase).plus(transfer.fromBaseAmount).toFixed(2);
      row.expenseCount += 1;
      row.netBase = decimal(row.incomeBase).minus(row.expenseBase).toFixed(2);
    }

    const months: FinanceMonthTotal[] = [];
    for (let index = query.months - 1; index >= 0; index -= 1) {
      const key = shiftMonth(month, -index);
      months.push(
        monthTotals.get(key) ?? {
          month: key,
          incomeBase: '0.00',
          expenseBase: '0.00',
          netBase: '0.00',
          incomeCount: 0,
          expenseCount: 0,
        },
      );
    }

    const selected: FinanceMonthTotal = {
      month,
      incomeBase: '0.00',
      expenseBase: '0.00',
      netBase: '0.00',
      incomeCount: 0,
      expenseCount: 0,
    };
    for (const transaction of transactions) {
      if (!inSelectedRange(transaction.occurredOn)) continue;
      if (transaction.kind === 'income') {
        selected.incomeBase = decimal(selected.incomeBase).plus(transaction.baseAmount).toFixed(2);
        selected.incomeCount += 1;
      } else {
        selected.expenseBase = decimal(selected.expenseBase)
          .plus(transaction.baseAmount)
          .toFixed(2);
        selected.expenseCount += 1;
      }
    }
    for (const transfer of creditRepayments) {
      if (!inSelectedRange(transfer.occurredOn)) continue;
      selected.expenseBase = decimal(selected.expenseBase).plus(transfer.fromBaseAmount).toFixed(2);
      selected.expenseCount += 1;
    }
    selected.netBase = decimal(selected.incomeBase).minus(selected.expenseBase).toFixed(2);

    const categoryTotals = new Map<string, FinanceCategoryTotal>();
    const categories = await this.db
      .select()
      .from(financeCategories)
      .where(eq(financeCategories.userId, userId));
    const categoryById = new Map(categories.map((category) => [category.id, category]));
    for (const transaction of transactions) {
      if (!inSelectedRange(transaction.occurredOn)) continue;
      const category = transaction.categoryId ? categoryById.get(transaction.categoryId) : null;
      const key = category?.id ?? `uncategorized:${transaction.kind}`;
      const row =
        categoryTotals.get(key) ??
        ({
          categoryId: category?.id ?? null,
          name: category?.name ?? 'Без категории',
          kind: category?.kind ?? (transaction.kind === 'income' ? 'income' : 'expense'),
          amountBase: '0.00',
          count: 0,
        } satisfies FinanceCategoryTotal);
      row.amountBase = decimal(row.amountBase).plus(transaction.baseAmount).toFixed(2);
      row.count += 1;
      categoryTotals.set(key, row);
    }

    const selectedRepayments = creditRepayments.filter((transfer) =>
      inSelectedRange(transfer.occurredOn),
    );
    if (selectedRepayments.length > 0) {
      const amountBase = selectedRepayments.reduce(
        (total, transfer) => total.plus(decimal(transfer.fromBaseAmount)),
        new Decimal(0),
      );
      categoryTotals.set('credit_repayment', {
        categoryId: null,
        name: 'Погашение кредита',
        kind: 'expense',
        amountBase: amountBase.toFixed(2),
        count: selectedRepayments.length,
      });
    }

    let assetsBase = new Decimal(0);
    let liabilitiesBase = new Decimal(0);
    for (const row of balances) {
      if (row.account.kind === 'credit') {
        if (row.balanceBase.lt(0)) {
          liabilitiesBase = liabilitiesBase.plus(row.balanceBase.abs());
        } else {
          assetsBase = assetsBase.plus(row.balanceBase);
        }
      } else {
        assetsBase = assetsBase.plus(row.balanceBase);
      }
    }

    return {
      baseCurrency: 'BYN',
      month,
      incomeBase: selected.incomeBase,
      expenseBase: selected.expenseBase,
      netBase: selected.netBase,
      assetsBase: assetsBase.toFixed(2),
      liabilitiesBase: liabilitiesBase.toFixed(2),
      netWorthBase: assetsBase.minus(liabilitiesBase).toFixed(2),
      accounts: balances.map((row) => ({
        accountId: row.account.id,
        balance: row.balance.toFixed(2),
        balanceBase: row.balanceBase.toFixed(2),
      })),
      categories: [...categoryTotals.values()].sort((a, b) =>
        decimal(b.amountBase).comparedTo(a.amountBase),
      ),
      months,
    };
  }

  async creditDrawdown(
    userId: string,
    input: FinanceCreditDrawdownRequest,
    meta: FinanceMeta,
  ): Promise<FinanceCreditDrawdownResponse> {
    let credit: FinanceAccount;

    if (input.creditAccountId) {
      credit = await this.requireAccount(userId, input.creditAccountId);
      if (credit.kind !== 'credit') {
        throw new BadRequestException({
          code: 'VALIDATION_ERROR',
          message: 'Selected account is not a credit account',
        });
      }
    } else {
      if (!input.name) {
        throw new BadRequestException({
          code: 'VALIDATION_ERROR',
          message: 'A new credit account requires a name',
        });
      }
      const currency = input.currency ?? 'BYN';
      if (currency !== 'BYN' && !input.fxRate) {
        throw new BadRequestException({
          code: 'VALIDATION_ERROR',
          message: 'A non-BYN credit account requires an fxRate',
        });
      }
      const [created] = await this.db
        .insert(financeAccounts)
        .values({
          userId,
          name: input.name,
          kind: 'credit',
          currency,
          openingBalance: '0',
          openingDate: input.occurredOn,
          fxRate: currency === 'BYN' ? '1' : (input.fxRate as string),
        })
        .returning();

      if (!created) throw new Error('Failed to create credit account');
      credit = created;

      await this.audit.log(
        {
          userId,
          action: 'finance.account_created',
          entityType: 'finance_account',
          entityId: created.id,
          after: {
            name: created.name,
            kind: created.kind,
            currency: created.currency,
            openingBalance: created.openingBalance,
            fxRate: created.fxRate,
          },
          ip: meta.ip,
          userAgent: meta.userAgent,
        },
        { strict: true },
      );
    }

    if (input.destinationAccountId) {
      const destination = await this.requireAccount(userId, input.destinationAccountId);

      if (destination.id === credit.id || destination.kind === 'credit') {
        throw new BadRequestException({
          code: 'VALIDATION_ERROR',
          message: 'Credit destination must be a non-credit account',
        });
      }

      const toAmount =
        input.destinationAmount ?? (destination.currency === credit.currency ? input.amount : null);

      if (!toAmount) {
        throw new BadRequestException({
          code: 'VALIDATION_ERROR',
          message: 'destinationAmount is required when currencies differ',
        });
      }

      const transfer = await this.insertTransfer(
        userId,
        {
          kind: 'credit',
          occurredOn: input.occurredOn,
          fromAccountId: credit.id,
          toAccountId: destination.id,
          fromAmount: input.amount,
          toAmount,
          description: input.description ?? 'Получение кредита',
        },
        credit,
        destination,
        meta,
      );

      const balance = (await this.balances(userId)).find((row) => row.account.id === credit.id);

      return {
        account: {
          ...toAccount(credit),
          balance: balance?.balance.toFixed(2) ?? '0.00',
          balanceBase: balance?.balanceBase.toFixed(2) ?? '0.00',
        },
        transfer,
      };
    }

    const [updated] = await this.db
      .update(financeAccounts)
      .set({
        openingBalance: decimal(credit.openingBalance).minus(input.amount).toFixed(2),
        updatedAt: new Date(),
      })
      .where(eq(financeAccounts.id, credit.id))
      .returning();

    if (!updated) throw new Error('Failed to increase credit debt');

    await this.audit.log(
      {
        userId,
        action: 'finance.credit_drawdown',
        entityType: 'finance_account',
        entityId: credit.id,
        before: { openingBalance: credit.openingBalance },
        after: {
          openingBalance: updated.openingBalance,
          amount: input.amount,
          destinationAccountId: null,
        },
        ip: meta.ip,
        userAgent: meta.userAgent,
      },
      { strict: true },
    );

    const balance = (await this.balances(userId)).find((row) => row.account.id === credit.id);

    return {
      account: {
        ...toAccount(updated),
        balance: balance?.balance.toFixed(2) ?? updated.openingBalance,
        balanceBase: balance?.balanceBase.toFixed(2) ?? '0.00',
      },
      transfer: null,
    };
  }

  private async insertTransfer(
    userId: string,
    input: FinanceTransferCreateRequest,
    from: FinanceAccount,
    to: FinanceAccount,
    meta: FinanceMeta,
  ): Promise<FinanceTransferContract> {
    const fromBaseAmount = financeBaseAmount(input.fromAmount, from.fxRate);
    const toBaseAmount = financeBaseAmount(input.toAmount, to.fxRate);
    const fxRate = decimal(input.toAmount).div(input.fromAmount).toFixed(8);

    const [created] = await this.db
      .insert(financeTransfers)
      .values({
        userId,
        kind: input.kind,
        occurredOn: input.occurredOn,
        fromAccountId: from.id,
        toAccountId: to.id,
        fromAmount: input.fromAmount,
        toAmount: input.toAmount,
        fromCurrency: from.currency,
        toCurrency: to.currency,
        fxRate,
        fromBaseAmount,
        toBaseAmount,
        description: input.description ?? null,
      })
      .returning();

    if (!created) throw new Error('Failed to create finance transfer');

    await this.audit.log(
      {
        userId,
        action: 'finance.transfer_created',
        entityType: 'finance_transfer',
        entityId: created.id,
        after: {
          kind: created.kind,
          fromAccountId: created.fromAccountId,
          toAccountId: created.toAccountId,
          fromAmount: created.fromAmount,
          toAmount: created.toAmount,
          occurredOn: created.occurredOn,
        },
        ip: meta.ip,
        userAgent: meta.userAgent,
      },
      { strict: true },
    );

    return toTransfer(created);
  }

  private async requireAccount(
    userId: string,
    id: string,
    executor: DbExecutor = this.db,
    allowArchived = false,
  ): Promise<FinanceAccount> {
    const [account] = await executor
      .select()
      .from(financeAccounts)
      .where(and(eq(financeAccounts.id, id), eq(financeAccounts.userId, userId)))
      .limit(1);

    if (!account) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Account not found' });
    }
    if (account.archivedAt && !allowArchived) {
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: 'Account is archived',
      });
    }

    return account;
  }

  private async requireCategory(
    userId: string,
    id: string,
    executor: DbExecutor = this.db,
    allowArchived = false,
  ): Promise<FinanceCategory> {
    const [category] = await executor
      .select()
      .from(financeCategories)
      .where(and(eq(financeCategories.id, id), eq(financeCategories.userId, userId)))
      .limit(1);

    if (!category) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Category not found' });
    }
    if (category.archivedAt && !allowArchived) {
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: 'Category is archived',
      });
    }

    return category;
  }

  private async balances(userId: string, executor: DbExecutor = this.db): Promise<BalanceRow[]> {
    const [accounts, transactions, transfers] = await Promise.all([
      executor.select().from(financeAccounts).where(eq(financeAccounts.userId, userId)),
      executor
        .select()
        .from(financeTransactions)
        .where(and(eq(financeTransactions.userId, userId), isNull(financeTransactions.archivedAt))),
      executor
        .select()
        .from(financeTransfers)
        .where(and(eq(financeTransfers.userId, userId), isNull(financeTransfers.archivedAt))),
    ]);

    const balances = new Map<string, Decimal>();
    for (const account of accounts) {
      balances.set(account.id, decimal(account.openingBalance));
    }
    for (const transaction of transactions) {
      const current = balances.get(transaction.accountId) ?? new Decimal(0);
      balances.set(
        transaction.accountId,
        transaction.kind === 'income'
          ? current.plus(transaction.amount)
          : current.minus(transaction.amount),
      );
    }
    for (const transfer of transfers) {
      const from = balances.get(transfer.fromAccountId) ?? new Decimal(0);
      const to = balances.get(transfer.toAccountId) ?? new Decimal(0);
      balances.set(transfer.fromAccountId, from.minus(transfer.fromAmount));
      balances.set(transfer.toAccountId, to.plus(transfer.toAmount));
    }

    return accounts
      .map((account) => {
        const balance = balances.get(account.id) ?? new Decimal(0);
        return {
          account,
          balance,
          balanceBase: decimal(roundFinanceAmount(balance.mul(account.fxRate))),
        };
      })
      .sort(
        (a, b) =>
          a.account.sortOrder - b.account.sortOrder || a.account.name.localeCompare(b.account.name),
      );
  }
}

import { createHash } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, desc, eq, gt, inArray, isNull, ne, or } from 'drizzle-orm';
import {
  financeAccounts,
  financeCategories,
  financeImportRows,
  financeImports,
  financeTransactions,
  financeTransfers,
  type Database,
  type FinanceAccount,
  type FinanceCategory,
} from '@nexter/db';
import type {
  FinanceImport,
  FinanceImportError,
  FinanceImportRequest,
  FinanceImportsResponse,
  FinanceImportSummary,
  FinanceTransferKind,
} from '@nexter/contracts';
import { AuditService } from '../../shared/audit/audit.service';
import { DB } from '../../shared/db/db.module';
import { decimal } from '../../shared/money/decimal';
import { financeBaseAmount } from './finance-money';

interface FinanceImportMeta {
  ip?: string;
  userAgent?: string;
}

type ImportEntity = {
  entityType: 'account' | 'category' | 'transaction' | 'transfer';
  sourceId: string;
  data: Record<string, unknown>;
  status: 'new' | 'duplicate' | 'error';
  error: string | null;
};

function hashPayload(payload: FinanceImportRequest): string {
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

function toImport(
  row: typeof financeImports.$inferSelect,
  summary: FinanceImportSummary,
): FinanceImport {
  return {
    id: row.id,
    source: row.source,
    status: row.status,
    summary,
    createdAt: row.createdAt.toISOString(),
    committedAt: row.committedAt?.toISOString() ?? null,
    rolledBackAt: row.rolledBackAt?.toISOString() ?? null,
  };
}

function emptySummary(): FinanceImportSummary {
  return {
    accounts: 0,
    categories: 0,
    transactions: 0,
    transfers: 0,
    duplicates: 0,
    errors: [],
    warnings: [],
  };
}

@Injectable()
export class FinanceImportService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly audit: AuditService,
  ) {}

  async preview(
    userId: string,
    payload: FinanceImportRequest,
    meta: FinanceImportMeta,
  ): Promise<FinanceImport> {
    const sourceHash = hashPayload(payload);
    const [existing] = await this.db
      .select()
      .from(financeImports)
      .where(
        and(
          eq(financeImports.userId, userId),
          eq(financeImports.source, payload.source),
          eq(financeImports.sourceHash, sourceHash),
        ),
      )
      .limit(1);

    if (existing?.status === 'committed') {
      throw new ConflictException({
        code: 'CONFLICT',
        message: 'This finance import has already been committed',
      });
    }

    if (existing) {
      await this.db.delete(financeImportRows).where(eq(financeImportRows.importId, existing.id));
      await this.db.delete(financeImports).where(eq(financeImports.id, existing.id));
    }

    const [accounts, categories] = await Promise.all([
      this.db.select().from(financeAccounts).where(eq(financeAccounts.userId, userId)),
      this.db.select().from(financeCategories).where(eq(financeCategories.userId, userId)),
    ]);
    const accountByName = new Map(accounts.map((account) => [account.name, account]));
    const categoryByKey = new Map(
      categories.map((category) => [`${category.kind}:${category.name}`, category]),
    );
    const payloadAccounts = new Map(payload.accounts.map((account) => [account.name, account]));
    const payloadCategories = new Map(
      payload.categories.map((category) => [`${category.kind}:${category.name}`, category]),
    );
    const seenCategoryKeys = new Set<string>();

    const errors: FinanceImportError[] = [];
    const warnings: string[] = [];
    const rows: ImportEntity[] = [];
    const sourceIds = new Set<string>();

    const seenAccountNames = new Set<string>();

    for (const account of payload.accounts) {
      let error: string | null = null;
      if (seenAccountNames.has(account.name)) {
        error = 'Дублирующееся имя счёта в импорте';
      }
      seenAccountNames.add(account.name);

      const existingAccount = accountByName.get(account.name);
      if (!error && existingAccount) {
        if (existingAccount.archivedAt) {
          error = `Счёт «${account.name}» архивирован; восстановите его перед импортом`;
        } else if (
          existingAccount.currency !== account.currency ||
          existingAccount.kind !== account.kind ||
          !decimal(existingAccount.fxRate).eq(account.fxRate ?? '1')
        ) {
          error = `Счёт «${account.name}» уже существует с другой валютой, типом или курсом`;
        } else if (!decimal(existingAccount.openingBalance).eq(account.openingBalance ?? '0')) {
          warnings.push(
            `Счёт «${account.name}» уже существует с другим начальным остатком; импорт его не изменит.`,
          );
        }
      }

      if (error) {
        errors.push({ entityType: 'account', sourceId: `account:${account.name}`, message: error });
      }
      rows.push({
        entityType: 'account',
        sourceId: `account:${account.name}`,
        data: account,
        status: error ? 'error' : existingAccount ? 'duplicate' : 'new',
        error,
      });
    }

    for (const category of payload.categories) {
      const key = `${category.kind}:${category.name}`;
      if (categoryByKey.has(key) || seenCategoryKeys.has(key)) {
        rows.push({
          entityType: 'category',
          sourceId: `category:${key}`,
          data: category,
          status: 'duplicate',
          error: null,
        });
      } else {
        rows.push({
          entityType: 'category',
          sourceId: `category:${key}`,
          data: category,
          status: 'new',
          error: null,
        });
      }
      seenCategoryKeys.add(key);
    }

    const transactionSourceIds = payload.transactions.map((transaction) => transaction.sourceId);
    const transferSourceIds = payload.transfers.map((transfer) => transfer.sourceId);
    const existingTransactionIds = new Set(
      (
        await this.db
          .select({ sourceId: financeTransactions.sourceId })
          .from(financeTransactions)
          .where(
            and(
              eq(financeTransactions.userId, userId),
              inArray(
                financeTransactions.sourceId,
                transactionSourceIds.length ? transactionSourceIds : ['__none__'],
              ),
            ),
          )
      )
        .map((row) => row.sourceId)
        .filter((value): value is string => Boolean(value)),
    );
    const existingTransferIds = new Set(
      (
        await this.db
          .select({ sourceId: financeTransfers.sourceId })
          .from(financeTransfers)
          .where(
            and(
              eq(financeTransfers.userId, userId),
              inArray(
                financeTransfers.sourceId,
                transferSourceIds.length ? transferSourceIds : ['__none__'],
              ),
            ),
          )
      )
        .map((row) => row.sourceId)
        .filter((value): value is string => Boolean(value)),
    );

    for (const transaction of payload.transactions) {
      let error: string | null = null;
      if (sourceIds.has(transaction.sourceId)) {
        error = 'Дублирующийся sourceId в импорте';
      } else if (existingTransactionIds.has(transaction.sourceId)) {
        rows.push({
          entityType: 'transaction',
          sourceId: transaction.sourceId,
          data: transaction,
          status: 'duplicate',
          error: null,
        });
        sourceIds.add(transaction.sourceId);
        continue;
      } else if (
        !accountByName.has(transaction.account) &&
        !payloadAccounts.has(transaction.account)
      ) {
        error = `Не найден счёт «${transaction.account}»`;
      } else if (transaction.category) {
        const key = `${transaction.kind}:${transaction.category}`;
        if (!categoryByKey.has(key) && !payloadCategories.has(key)) {
          error = `Не найдена категория «${transaction.category}» для ${transaction.kind}`;
        }
      }
      sourceIds.add(transaction.sourceId);
      if (error)
        errors.push({ entityType: 'transaction', sourceId: transaction.sourceId, message: error });
      rows.push({
        entityType: 'transaction',
        sourceId: transaction.sourceId,
        data: transaction,
        status: error ? 'error' : 'new',
        error,
      });
    }

    for (const transfer of payload.transfers) {
      let error: string | null = null;
      if (sourceIds.has(transfer.sourceId)) {
        error = 'Дублирующийся sourceId в импорте';
      } else if (existingTransferIds.has(transfer.sourceId)) {
        rows.push({
          entityType: 'transfer',
          sourceId: transfer.sourceId,
          data: transfer,
          status: 'duplicate',
          error: null,
        });
        sourceIds.add(transfer.sourceId);
        continue;
      } else if (
        (!accountByName.has(transfer.fromAccount) && !payloadAccounts.has(transfer.fromAccount)) ||
        (!accountByName.has(transfer.toAccount) && !payloadAccounts.has(transfer.toAccount))
      ) {
        error = 'Не найден счёт перевода';
      } else if (transfer.fromAccount === transfer.toAccount) {
        error = 'Счета перевода совпадают';
      }
      if (error)
        errors.push({ entityType: 'transfer', sourceId: transfer.sourceId, message: error });
      rows.push({
        entityType: 'transfer',
        sourceId: transfer.sourceId,
        data: transfer,
        status: error ? 'error' : 'new',
        error,
      });
    }

    const summary: FinanceImportSummary = {
      ...emptySummary(),
      accounts: payload.accounts.length,
      categories: payload.categories.length,
      transactions: payload.transactions.length,
      transfers: payload.transfers.length,
      duplicates: rows.filter((row) => row.status === 'duplicate').length,
      errors,
      warnings,
    };

    const created = await this.db.transaction(async (tx) => {
      const [row] = await tx
        .insert(financeImports)
        .values({
          userId,
          source: payload.source,
          sourceHash,
          status: 'preview',
          summary,
        })
        .returning();

      if (!row) throw new Error('Failed to create finance import');

      for (let offset = 0; offset < rows.length; offset += 1000) {
        await tx.insert(financeImportRows).values(
          rows.slice(offset, offset + 1000).map((item) => ({
            importId: row.id,
            userId,
            entityType: item.entityType,
            sourceId: item.sourceId,
            data: item.data,
            status: item.status,
            error: item.error,
          })),
        );
      }

      return row;
    });

    await this.audit.log(
      {
        userId,
        action: 'finance.import_previewed',
        entityType: 'finance_import',
        entityId: created.id,
        after: {
          accounts: summary.accounts,
          categories: summary.categories,
          transactions: summary.transactions,
          transfers: summary.transfers,
          errors: summary.errors.length,
        },
        ip: meta.ip,
        userAgent: meta.userAgent,
      },
      { strict: true },
    );

    return toImport(created, summary);
  }

  async commit(userId: string, id: string, meta: FinanceImportMeta): Promise<FinanceImport> {
    const [importRow] = await this.db
      .select()
      .from(financeImports)
      .where(and(eq(financeImports.id, id), eq(financeImports.userId, userId)))
      .limit(1);

    if (!importRow) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Finance import not found' });
    }
    if (importRow.status !== 'preview') {
      throw new ConflictException({
        code: 'CONFLICT',
        message: 'Import is not in preview status',
      });
    }

    const summary = importRow.summary as FinanceImportSummary;
    if (summary.errors.length > 0) {
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: 'Import has row errors',
        details: { errors: summary.errors },
      });
    }

    const rows = await this.db
      .select()
      .from(financeImportRows)
      .where(eq(financeImportRows.importId, id));

    const createdAccountIds: string[] = [];
    const createdCategoryIds: string[] = [];

    await this.db.transaction(async (tx) => {
      const existingAccounts = await tx
        .select()
        .from(financeAccounts)
        .where(eq(financeAccounts.userId, userId));
      const accountByName = new Map(existingAccounts.map((account) => [account.name, account]));
      const existingCategories = await tx
        .select()
        .from(financeCategories)
        .where(eq(financeCategories.userId, userId));
      const categoryByKey = new Map(
        existingCategories.map((category) => [`${category.kind}:${category.name}`, category]),
      );

      for (const row of rows.filter((item) => item.entityType === 'account')) {
        const data = row.data as {
          name: string;
          kind: FinanceAccount['kind'];
          currency: FinanceAccount['currency'];
          openingBalance?: string;
          openingDate: string;
          fxRate?: string;
          creditLimit?: string | null;
          sortOrder?: number;
        };
        const existing = accountByName.get(data.name);
        if (existing) {
          if (existing.archivedAt) {
            throw new ConflictException({
              code: 'CONFLICT',
              message: `Account «${data.name}» is archived`,
            });
          }
          if (
            existing.currency !== data.currency ||
            existing.kind !== data.kind ||
            !decimal(existing.fxRate).eq(data.fxRate ?? '1')
          ) {
            throw new ConflictException({
              code: 'CONFLICT',
              message: `Account «${data.name}» changed compatibility after preview`,
            });
          }
          continue;
        }
        if (row.status !== 'new') continue;
        const [created] = await tx
          .insert(financeAccounts)
          .values({
            userId,
            name: data.name,
            kind: data.kind,
            currency: data.currency,
            openingBalance: data.openingBalance ?? '0',
            openingDate: data.openingDate,
            fxRate: data.currency === 'BYN' ? '1' : (data.fxRate ?? '1'),
            creditLimit: data.creditLimit ?? null,
            sortOrder: data.sortOrder ?? 0,
          })
          .returning();
        if (created) {
          accountByName.set(created.name, created);
          createdAccountIds.push(created.id);
        }
      }

      for (const row of rows.filter((item) => item.entityType === 'category')) {
        const data = row.data as {
          name: string;
          kind: FinanceCategory['kind'];
          color?: string | null;
          icon?: string | null;
          sortOrder?: number;
        };
        const key = `${data.kind}:${data.name}`;
        const existing = categoryByKey.get(key);
        if (existing) {
          if (existing.archivedAt) {
            throw new ConflictException({
              code: 'CONFLICT',
              message: `Category «${data.name}» is archived`,
            });
          }
          continue;
        }
        if (row.status !== 'new') continue;
        const [created] = await tx
          .insert(financeCategories)
          .values({
            userId,
            name: data.name,
            kind: data.kind,
            color: data.color ?? null,
            icon: data.icon ?? null,
            sortOrder: data.sortOrder ?? 0,
          })
          .returning();
        if (created) {
          categoryByKey.set(key, created);
          createdCategoryIds.push(created.id);
        }
      }

      for (const row of rows.filter((item) => item.entityType === 'transaction')) {
        if (row.status !== 'new') continue;
        const data = row.data as {
          sourceId: string;
          kind: 'income' | 'expense';
          occurredOn: string;
          account: string;
          category?: string | null;
          amount: string;
          title: string;
          description?: string | null;
        };
        const account = accountByName.get(data.account);
        if (!account) throw new Error(`Account not found during import: ${data.account}`);
        const category = data.category ? categoryByKey.get(`${data.kind}:${data.category}`) : null;
        if (data.category && !category) {
          throw new Error(`Category not found during import: ${data.category}`);
        }
        const baseAmount = financeBaseAmount(data.amount, account.fxRate);
        await tx
          .insert(financeTransactions)
          .values({
            userId,
            kind: data.kind,
            occurredOn: data.occurredOn,
            accountId: account.id,
            categoryId: category?.id ?? null,
            amount: data.amount,
            currency: account.currency,
            fxRate: account.fxRate,
            baseAmount,
            title: data.title,
            description: data.description ?? null,
            source: 'notion',
            sourceId: data.sourceId,
            importId: id,
          })
          .onConflictDoNothing();
      }

      for (const row of rows.filter((item) => item.entityType === 'transfer')) {
        if (row.status !== 'new') continue;
        const data = row.data as {
          sourceId: string;
          kind: FinanceTransferKind;
          occurredOn: string;
          fromAccount: string;
          toAccount: string;
          fromAmount: string;
          toAmount: string;
          description?: string | null;
        };
        const from = accountByName.get(data.fromAccount);
        const to = accountByName.get(data.toAccount);
        if (!from || !to) throw new Error('Transfer account not found during import');
        const fromBaseAmount = financeBaseAmount(data.fromAmount, from.fxRate);
        const toBaseAmount = financeBaseAmount(data.toAmount, to.fxRate);
        const fxRate = decimal(data.toAmount).div(data.fromAmount).toFixed(8);
        await tx
          .insert(financeTransfers)
          .values({
            userId,
            kind: data.kind,
            occurredOn: data.occurredOn,
            fromAccountId: from.id,
            toAccountId: to.id,
            fromAmount: data.fromAmount,
            toAmount: data.toAmount,
            fromCurrency: from.currency,
            toCurrency: to.currency,
            fxRate,
            fromBaseAmount,
            toBaseAmount,
            description: data.description ?? null,
            source: 'notion',
            sourceId: data.sourceId,
            importId: id,
          })
          .onConflictDoNothing();
      }

      await tx
        .update(financeImportRows)
        .set({ status: 'committed' })
        .where(and(eq(financeImportRows.importId, id), eq(financeImportRows.status, 'new')));

      await tx
        .update(financeImports)
        .set({
          status: 'committed',
          committedAt: new Date(),
          summary: {
            ...summary,
            createdAccountIds,
            createdCategoryIds,
          },
        })
        .where(eq(financeImports.id, id));
    });

    await this.audit.log(
      {
        userId,
        action: 'finance.import_committed',
        entityType: 'finance_import',
        entityId: id,
        after: {
          accounts: summary.accounts,
          transactions: summary.transactions,
          transfers: summary.transfers,
        },
        ip: meta.ip,
        userAgent: meta.userAgent,
      },
      { strict: true },
    );

    const [updated] = await this.db
      .select()
      .from(financeImports)
      .where(eq(financeImports.id, id))
      .limit(1);

    return toImport(updated!, summary);
  }

  async list(userId: string): Promise<FinanceImportsResponse> {
    const rows = await this.db
      .select()
      .from(financeImports)
      .where(eq(financeImports.userId, userId))
      .orderBy(desc(financeImports.createdAt))
      .limit(20);

    return {
      imports: rows.map((row) =>
        toImport(row, (row.summary as unknown as FinanceImportSummary) ?? emptySummary()),
      ),
    };
  }

  async rollback(userId: string, id: string, meta: FinanceImportMeta): Promise<FinanceImport> {
    const [importRow] = await this.db
      .select()
      .from(financeImports)
      .where(and(eq(financeImports.id, id), eq(financeImports.userId, userId)))
      .limit(1);

    if (!importRow) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Finance import not found' });
    }
    if (importRow.status !== 'committed') {
      throw new ConflictException({
        code: 'CONFLICT',
        message: 'Import is not committed',
      });
    }

    const [newer] = await this.db
      .select({ id: financeImports.id })
      .from(financeImports)
      .where(
        and(
          eq(financeImports.userId, userId),
          eq(financeImports.source, importRow.source),
          eq(financeImports.status, 'committed'),
        ),
      )
      .orderBy(desc(financeImports.committedAt))
      .limit(1);
    if (newer && newer.id !== id) {
      throw new ConflictException({
        code: 'CONFLICT',
        message: 'Only the newest committed import can be rolled back',
      });
    }

    const committedAt = importRow.committedAt;
    if (!committedAt) {
      throw new ConflictException({ code: 'CONFLICT', message: 'Import has no commit timestamp' });
    }

    const summary = importRow.summary as FinanceImportSummary & {
      createdAccountIds?: string[];
      createdCategoryIds?: string[];
    };
    const createdAccountIds = summary.createdAccountIds ?? [];
    const createdCategoryIds = summary.createdCategoryIds ?? [];

    const [editedTransaction] = await this.db
      .select({ id: financeTransactions.id })
      .from(financeTransactions)
      .where(
        and(
          eq(financeTransactions.userId, userId),
          eq(financeTransactions.importId, id),
          gt(financeTransactions.updatedAt, committedAt),
        ),
      )
      .limit(1);
    const [editedTransfer] = await this.db
      .select({ id: financeTransfers.id })
      .from(financeTransfers)
      .where(
        and(
          eq(financeTransfers.userId, userId),
          eq(financeTransfers.importId, id),
          gt(financeTransfers.updatedAt, committedAt),
        ),
      )
      .limit(1);
    const [editedAccount] = createdAccountIds.length
      ? await this.db
          .select({ id: financeAccounts.id })
          .from(financeAccounts)
          .where(
            and(
              eq(financeAccounts.userId, userId),
              inArray(financeAccounts.id, createdAccountIds),
              gt(financeAccounts.updatedAt, committedAt),
            ),
          )
          .limit(1)
      : [];
    const [editedCategory] = createdCategoryIds.length
      ? await this.db
          .select({ id: financeCategories.id })
          .from(financeCategories)
          .where(
            and(
              eq(financeCategories.userId, userId),
              inArray(financeCategories.id, createdCategoryIds),
              gt(financeCategories.updatedAt, committedAt),
            ),
          )
          .limit(1)
      : [];
    const [dependentTransaction] = createdAccountIds.length
      ? await this.db
          .select({ id: financeTransactions.id })
          .from(financeTransactions)
          .where(
            and(
              eq(financeTransactions.userId, userId),
              inArray(financeTransactions.accountId, createdAccountIds),
              or(isNull(financeTransactions.importId), ne(financeTransactions.importId, id)),
            ),
          )
          .limit(1)
      : [];
    const [dependentTransfer] = createdAccountIds.length
      ? await this.db
          .select({ id: financeTransfers.id })
          .from(financeTransfers)
          .where(
            and(
              eq(financeTransfers.userId, userId),
              or(
                inArray(financeTransfers.fromAccountId, createdAccountIds),
                inArray(financeTransfers.toAccountId, createdAccountIds),
              ),
              or(isNull(financeTransfers.importId), ne(financeTransfers.importId, id)),
            ),
          )
          .limit(1)
      : [];
    const [dependentCategory] = createdCategoryIds.length
      ? await this.db
          .select({ id: financeTransactions.id })
          .from(financeTransactions)
          .where(
            and(
              eq(financeTransactions.userId, userId),
              inArray(financeTransactions.categoryId, createdCategoryIds),
              or(isNull(financeTransactions.importId), ne(financeTransactions.importId, id)),
            ),
          )
          .limit(1)
      : [];

    if (
      editedTransaction ||
      editedTransfer ||
      editedAccount ||
      editedCategory ||
      dependentTransaction ||
      dependentTransfer ||
      dependentCategory
    ) {
      throw new ConflictException({
        code: 'CONFLICT',
        message: 'Import has edited rows or dependent manual data; rollback refused',
        details: {
          editedTransactions: Boolean(editedTransaction),
          editedTransfers: Boolean(editedTransfer),
          editedAccounts: Boolean(editedAccount),
          editedCategories: Boolean(editedCategory),
          dependentTransactions: Boolean(dependentTransaction),
          dependentTransfers: Boolean(dependentTransfer),
          dependentCategories: Boolean(dependentCategory),
        },
      });
    }

    await this.db.transaction(async (tx) => {
      await tx
        .delete(financeTransactions)
        .where(and(eq(financeTransactions.userId, userId), eq(financeTransactions.importId, id)));
      await tx
        .delete(financeTransfers)
        .where(and(eq(financeTransfers.userId, userId), eq(financeTransfers.importId, id)));

      if (createdAccountIds.length) {
        await tx
          .delete(financeAccounts)
          .where(
            and(eq(financeAccounts.userId, userId), inArray(financeAccounts.id, createdAccountIds)),
          );
      }
      if (createdCategoryIds.length) {
        await tx
          .delete(financeCategories)
          .where(
            and(
              eq(financeCategories.userId, userId),
              inArray(financeCategories.id, createdCategoryIds),
            ),
          );
      }

      await tx
        .update(financeImports)
        .set({ status: 'rolled_back', rolledBackAt: new Date() })
        .where(eq(financeImports.id, id));
    });

    await this.audit.log(
      {
        userId,
        action: 'finance.import_rolled_back',
        entityType: 'finance_import',
        entityId: id,
        after: { status: 'rolled_back' },
        ip: meta.ip,
        userAgent: meta.userAgent,
      },
      { strict: true },
    );

    const [updated] = await this.db
      .select()
      .from(financeImports)
      .where(eq(financeImports.id, id))
      .limit(1);

    return toImport(updated!, summary);
  }
}

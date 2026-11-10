import { z } from 'zod';

export const financeCurrencySchema = z.enum(['BYN', 'USD', 'EUR']);
export const financeAccountKindSchema = z.enum([
  'cash',
  'card',
  'bank',
  'savings',
  'investment',
  'credit',
]);
export const financeCategoryKindSchema = z.enum(['income', 'expense', 'transfer']);
export const financeTransactionKindSchema = z.enum(['income', 'expense']);
export const financeTransferKindSchema = z.enum(['exchange', 'card_topup', 'credit', 'other']);

const moneySchema = z
  .string()
  .regex(/^-?\d{1,18}(?:\.\d{1,2})?$/, 'Expected a decimal with at most 2 fraction digits');
const positiveMoneySchema = z
  .string()
  .regex(/^\d{1,18}(?:\.\d{1,2})?$/, 'Expected a positive amount with at most 2 fraction digits')
  .refine((value) => !/^0+(?:\.0{1,2})?$/.test(value), 'Expected a non-zero amount');
const rateSchema = z
  .string()
  .regex(/^\d{1,10}(?:\.\d{1,8})?$/, 'Expected a positive rate with at most 8 fraction digits')
  .refine((value) => !/^0+(?:\.0{1,8})?$/.test(value), 'Expected a positive rate');
const dateOnlySchema = z.iso.date();

export const financeAccountSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  kind: financeAccountKindSchema,
  currency: financeCurrencySchema,
  openingBalance: z.string(),
  openingDate: dateOnlySchema,
  fxRate: z.string(),
  creditLimit: z.string().nullable(),
  sortOrder: z.number().int(),
  archivedAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export const financeAccountWithBalanceSchema = financeAccountSchema.extend({
  balance: z.string(),
  balanceBase: z.string(),
});

export const financeCategorySchema = z.object({
  id: z.uuid(),
  name: z.string(),
  kind: financeCategoryKindSchema,
  color: z.string().nullable(),
  icon: z.string().nullable(),
  sortOrder: z.number().int(),
  archivedAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export const financeTransactionSchema = z.object({
  id: z.uuid(),
  kind: financeTransactionKindSchema,
  occurredOn: dateOnlySchema,
  accountId: z.uuid(),
  categoryId: z.uuid().nullable(),
  amount: z.string(),
  currency: financeCurrencySchema,
  fxRate: z.string(),
  baseAmount: z.string(),
  title: z.string(),
  description: z.string().nullable(),
  source: z.string(),
  sourceId: z.string().nullable(),
  archivedAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export const financeTransferSchema = z.object({
  id: z.uuid(),
  kind: financeTransferKindSchema,
  occurredOn: dateOnlySchema,
  fromAccountId: z.uuid(),
  toAccountId: z.uuid(),
  fromAmount: z.string(),
  toAmount: z.string(),
  fromCurrency: financeCurrencySchema,
  toCurrency: financeCurrencySchema,
  fxRate: z.string(),
  fromBaseAmount: z.string(),
  toBaseAmount: z.string(),
  description: z.string().nullable(),
  source: z.string(),
  sourceId: z.string().nullable(),
  archivedAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export const financeAccountCreateRequestSchema = z.object({
  name: z.string().trim().min(1).max(80),
  kind: financeAccountKindSchema,
  currency: financeCurrencySchema,
  openingBalance: moneySchema.optional(),
  openingDate: dateOnlySchema,
  fxRate: rateSchema.optional(),
  creditLimit: moneySchema.nullable().optional(),
  sortOrder: z.number().int().min(0).max(10_000).optional(),
});

export const financeAccountUpdateRequestSchema = z
  .object({
    name: z.string().trim().min(1).max(80).optional(),
    kind: financeAccountKindSchema.optional(),
    currency: financeCurrencySchema.optional(),
    openingBalance: moneySchema.optional(),
    openingDate: dateOnlySchema.optional(),
    fxRate: rateSchema.optional(),
    creditLimit: moneySchema.nullable().optional(),
    sortOrder: z.number().int().min(0).max(10_000).optional(),
    archived: z.boolean().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, 'At least one field must be provided');

export const financeCategoryCreateRequestSchema = z.object({
  name: z.string().trim().min(1).max(60),
  kind: financeCategoryKindSchema,
  color: z.string().trim().max(30).nullable().optional(),
  icon: z.string().trim().max(30).nullable().optional(),
  sortOrder: z.number().int().min(0).max(10_000).optional(),
});

export const financeCategoryUpdateRequestSchema = z
  .object({
    name: z.string().trim().min(1).max(60).optional(),
    color: z.string().trim().max(30).nullable().optional(),
    icon: z.string().trim().max(30).nullable().optional(),
    sortOrder: z.number().int().min(0).max(10_000).optional(),
    archived: z.boolean().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, 'At least one field must be provided');

export const financeTransactionCreateRequestSchema = z.object({
  kind: financeTransactionKindSchema,
  occurredOn: dateOnlySchema,
  accountId: z.uuid(),
  categoryId: z.uuid().nullable().optional(),
  amount: positiveMoneySchema,
  title: z.string().trim().min(1).max(200),
  description: z.string().max(5000).nullable().optional(),
});

export const financeTransactionUpdateRequestSchema = z
  .object({
    kind: financeTransactionKindSchema.optional(),
    occurredOn: dateOnlySchema.optional(),
    accountId: z.uuid().optional(),
    categoryId: z.uuid().nullable().optional(),
    amount: positiveMoneySchema.optional(),
    title: z.string().trim().min(1).max(200).optional(),
    description: z.string().max(5000).nullable().optional(),
    archived: z.boolean().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, 'At least one field must be provided');

export const financeTransferCreateRequestSchema = z
  .object({
    kind: financeTransferKindSchema,
    occurredOn: dateOnlySchema,
    fromAccountId: z.uuid(),
    toAccountId: z.uuid(),
    fromAmount: positiveMoneySchema,
    toAmount: positiveMoneySchema,
    description: z.string().max(5000).nullable().optional(),
  })
  .refine((value) => value.fromAccountId !== value.toAccountId, {
    message: 'Transfer accounts must differ',
    path: ['toAccountId'],
  });

export const financeTransferUpdateRequestSchema = z
  .object({
    kind: financeTransferKindSchema.optional(),
    occurredOn: dateOnlySchema.optional(),
    fromAccountId: z.uuid().optional(),
    toAccountId: z.uuid().optional(),
    fromAmount: positiveMoneySchema.optional(),
    toAmount: positiveMoneySchema.optional(),
    description: z.string().max(5000).nullable().optional(),
    archived: z.boolean().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, 'At least one field must be provided');

export const financeListQuerySchema = z.object({
  from: dateOnlySchema.optional(),
  to: dateOnlySchema.optional(),
  accountId: z.uuid().optional(),
  categoryId: z.uuid().optional(),
  kind: z.union([financeTransactionKindSchema, financeTransferKindSchema]).optional(),
  search: z.string().max(100).optional(),
  includeArchived: z
    .union([z.boolean(), z.enum(['true', 'false'])])
    .transform((value) => value === true || value === 'true')
    .default(false),
  limit: z.coerce.number().int().min(1).max(500).default(200),
});

export const financeSummaryQuerySchema = z.object({
  month: z
    .string()
    .regex(/^\d{4}-(0[1-9]|1[0-2])$/)
    .optional(),
  months: z.coerce.number().int().min(1).max(24).default(12),
});

export const financeAccountBalanceSchema = z.object({
  accountId: z.uuid(),
  balance: z.string(),
  balanceBase: z.string(),
});

export const financeCategoryTotalSchema = z.object({
  categoryId: z.uuid().nullable(),
  name: z.string(),
  kind: financeCategoryKindSchema,
  amountBase: z.string(),
  count: z.number().int(),
});

export const financeMonthTotalSchema = z.object({
  month: z.string(),
  incomeBase: z.string(),
  expenseBase: z.string(),
  netBase: z.string(),
  incomeCount: z.number().int(),
  expenseCount: z.number().int(),
});

export const financeSummarySchema = z.object({
  baseCurrency: z.literal('BYN'),
  month: z.string(),
  incomeBase: z.string(),
  expenseBase: z.string(),
  netBase: z.string(),
  assetsBase: z.string(),
  liabilitiesBase: z.string(),
  netWorthBase: z.string(),
  accounts: z.array(financeAccountBalanceSchema),
  categories: z.array(financeCategoryTotalSchema),
  months: z.array(financeMonthTotalSchema),
});

export const financeAccountsResponseSchema = z.object({
  accounts: z.array(financeAccountWithBalanceSchema),
});

export const financeCategoriesResponseSchema = z.object({
  categories: z.array(financeCategorySchema),
});

export const financeTransactionsResponseSchema = z.object({
  transactions: z.array(financeTransactionSchema),
});

export const financeTransfersResponseSchema = z.object({
  transfers: z.array(financeTransferSchema),
});

export const financeJournalResponseSchema = z.object({
  transactions: z.array(financeTransactionSchema),
  transfers: z.array(financeTransferSchema),
});

export type FinanceCurrency = z.infer<typeof financeCurrencySchema>;
export type FinanceAccountKind = z.infer<typeof financeAccountKindSchema>;
export type FinanceCategoryKind = z.infer<typeof financeCategoryKindSchema>;
export type FinanceTransactionKind = z.infer<typeof financeTransactionKindSchema>;
export type FinanceTransferKind = z.infer<typeof financeTransferKindSchema>;
export type FinanceAccount = z.infer<typeof financeAccountSchema>;
export type FinanceAccountWithBalance = z.infer<typeof financeAccountWithBalanceSchema>;
export type FinanceCategory = z.infer<typeof financeCategorySchema>;
export type FinanceTransaction = z.infer<typeof financeTransactionSchema>;
export type FinanceTransfer = z.infer<typeof financeTransferSchema>;
export type FinanceAccountCreateRequest = z.infer<typeof financeAccountCreateRequestSchema>;
export type FinanceAccountUpdateRequest = z.infer<typeof financeAccountUpdateRequestSchema>;
export type FinanceCategoryCreateRequest = z.infer<typeof financeCategoryCreateRequestSchema>;
export type FinanceCategoryUpdateRequest = z.infer<typeof financeCategoryUpdateRequestSchema>;
export type FinanceTransactionCreateRequest = z.infer<typeof financeTransactionCreateRequestSchema>;
export type FinanceTransactionUpdateRequest = z.infer<typeof financeTransactionUpdateRequestSchema>;
export type FinanceTransferCreateRequest = z.infer<typeof financeTransferCreateRequestSchema>;
export type FinanceTransferUpdateRequest = z.infer<typeof financeTransferUpdateRequestSchema>;
export type FinanceListQuery = z.infer<typeof financeListQuerySchema>;
export type FinanceSummaryQuery = z.infer<typeof financeSummaryQuerySchema>;
export type FinanceAccountBalance = z.infer<typeof financeAccountBalanceSchema>;
export type FinanceCategoryTotal = z.infer<typeof financeCategoryTotalSchema>;
export type FinanceMonthTotal = z.infer<typeof financeMonthTotalSchema>;
export type FinanceSummary = z.infer<typeof financeSummarySchema>;
export type FinanceAccountsResponse = z.infer<typeof financeAccountsResponseSchema>;
export type FinanceCategoriesResponse = z.infer<typeof financeCategoriesResponseSchema>;
export type FinanceTransactionsResponse = z.infer<typeof financeTransactionsResponseSchema>;
export type FinanceTransfersResponse = z.infer<typeof financeTransfersResponseSchema>;
export type FinanceJournalResponse = z.infer<typeof financeJournalResponseSchema>;

export const financeImportAccountSchema = financeAccountCreateRequestSchema.refine(
  (value) => value.currency !== 'BYN' || value.fxRate === undefined || value.fxRate === '1',
  { message: 'BYN accounts must use fxRate 1', path: ['fxRate'] },
);
export const financeImportCategorySchema = financeCategoryCreateRequestSchema;
export const financeImportTransactionSchema = z.object({
  sourceId: z.string().min(1).max(500),
  kind: z.enum(['income', 'expense']),
  occurredOn: dateOnlySchema,
  account: z.string().trim().min(1).max(80),
  category: z.string().trim().min(1).max(60).nullable().optional(),
  amount: positiveMoneySchema,
  title: z.string().trim().min(1).max(200),
  description: z.string().max(5000).nullable().optional(),
});
export const financeImportTransferSchema = z.object({
  sourceId: z.string().min(1).max(500),
  kind: financeTransferKindSchema,
  occurredOn: dateOnlySchema,
  fromAccount: z.string().trim().min(1).max(80),
  toAccount: z.string().trim().min(1).max(80),
  fromAmount: positiveMoneySchema,
  toAmount: positiveMoneySchema,
  description: z.string().max(5000).nullable().optional(),
});
export const financeImportRequestSchema = z.object({
  source: z.literal('notion'),
  accounts: z.array(financeImportAccountSchema).max(50),
  categories: z.array(financeImportCategorySchema).max(200),
  transactions: z.array(financeImportTransactionSchema).max(5000),
  transfers: z.array(financeImportTransferSchema).max(5000),
});

export const financeImportErrorSchema = z.object({
  entityType: z.string(),
  sourceId: z.string().nullable(),
  message: z.string(),
});

export const financeImportSummarySchema = z.object({
  accounts: z.number().int().nonnegative(),
  categories: z.number().int().nonnegative(),
  transactions: z.number().int().nonnegative(),
  transfers: z.number().int().nonnegative(),
  duplicates: z.number().int().nonnegative(),
  errors: z.array(financeImportErrorSchema),
  warnings: z.array(z.string()),
});

export const financeImportSchema = z.object({
  id: z.uuid(),
  source: z.string(),
  status: z.enum(['preview', 'committed', 'rolled_back']),
  summary: financeImportSummarySchema,
  createdAt: z.iso.datetime(),
  committedAt: z.iso.datetime().nullable(),
  rolledBackAt: z.iso.datetime().nullable(),
});

export const financeImportsResponseSchema = z.object({
  imports: z.array(financeImportSchema),
});

export type FinanceImportAccount = z.infer<typeof financeImportAccountSchema>;
export type FinanceImportCategory = z.infer<typeof financeImportCategorySchema>;
export type FinanceImportTransaction = z.infer<typeof financeImportTransactionSchema>;
export type FinanceImportTransfer = z.infer<typeof financeImportTransferSchema>;
export type FinanceImportRequest = z.infer<typeof financeImportRequestSchema>;
export type FinanceImportError = z.infer<typeof financeImportErrorSchema>;
export type FinanceImportSummary = z.infer<typeof financeImportSummarySchema>;
export type FinanceImport = z.infer<typeof financeImportSchema>;
export type FinanceImportsResponse = z.infer<typeof financeImportsResponseSchema>;

export const financeCreditDrawdownRequestSchema = z
  .object({
    creditAccountId: z.uuid().optional(),
    name: z.string().trim().min(1).max(80).optional(),
    currency: financeCurrencySchema.optional(),
    fxRate: rateSchema.optional(),
    amount: positiveMoneySchema,
    occurredOn: dateOnlySchema,
    destinationAccountId: z.uuid().nullable().optional(),
    destinationAmount: positiveMoneySchema.nullable().optional(),
    description: z.string().max(5000).nullable().optional(),
  })
  .refine((value) => Boolean(value.creditAccountId) !== Boolean(value.name), {
    message: 'Provide either creditAccountId or name for a new credit account',
    path: ['creditAccountId'],
  });

export const financeCreditDrawdownResponseSchema = z.object({
  account: financeAccountWithBalanceSchema,
  transfer: financeTransferSchema.nullable(),
});

export type FinanceCreditDrawdownRequest = z.infer<typeof financeCreditDrawdownRequestSchema>;
export type FinanceCreditDrawdownResponse = z.infer<typeof financeCreditDrawdownResponseSchema>;

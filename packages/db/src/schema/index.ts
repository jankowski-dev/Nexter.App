import { sql } from 'drizzle-orm';
import {
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    email: text('email').notNull(),
    passwordHash: text('password_hash').notNull(),
    totpSecretEncrypted: text('totp_secret_encrypted'),
    totpEnabled: boolean('totp_enabled').notNull().default(false),
    recoveryCodesHash: text('recovery_codes_hash')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    role: text('role').notNull().default('owner'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
  },
  (table) => [
    uniqueIndex('users_email_unique').on(table.email),
    uniqueIndex('users_singleton_unique').on(sql`(true)`),
  ],
);

export const sessions = pgTable(
  'sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull(),
    csrfTokenHash: text('csrf_token_hash').notNull(),
    twoFactorVerified: boolean('two_factor_verified').notNull().default(false),
    ip: text('ip'),
    userAgent: text('user_agent'),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
  },
  (table) => [
    uniqueIndex('sessions_token_hash_unique').on(table.tokenHash),
    index('sessions_user_id_idx').on(table.userId),
    index('sessions_expires_at_idx').on(table.expiresAt),
  ],
);

export const auditLog = pgTable(
  'audit_log',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    action: text('action').notNull(),
    entityType: text('entity_type').notNull(),
    entityId: text('entity_id'),
    before: jsonb('before').$type<unknown>(),
    after: jsonb('after').$type<unknown>(),
    ip: text('ip'),
    userAgent: text('user_agent'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('audit_log_created_at_idx').on(table.createdAt),
    index('audit_log_entity_idx').on(table.entityType, table.entityId),
  ],
);

export const rateLimits = pgTable('rate_limits', {
  key: text('key').primaryKey(),
  points: integer('points').notNull().default(0),
  windowStartedAt: timestamp('window_started_at', { withTimezone: true }).notNull().defaultNow(),
  blockedUntil: timestamp('blocked_until', { withTimezone: true }),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const settings = pgTable('settings', {
  userId: uuid('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  baseCurrency: text('base_currency').notNull().default('USD'),
  displayCurrency: text('display_currency').notNull().default('USD'),
  taxMethod: text('tax_method').notNull().default('FIFO'),
  includeGasInCostBasis: boolean('include_gas_in_cost_basis').notNull().default(true),
  timezone: text('timezone').notNull().default('Europe/Minsk'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Session = typeof sessions.$inferSelect;
export type NewSession = typeof sessions.$inferInsert;
export type AuditLogEntry = typeof auditLog.$inferSelect;
export type NewAuditLogEntry = typeof auditLog.$inferInsert;
export type Settings = typeof settings.$inferSelect;
export type NewSettings = typeof settings.$inferInsert;

export type AccountType = 'wallet' | 'external' | 'income' | 'expense' | 'equity';
export type TransactionType =
  'trade' | 'transfer' | 'deposit' | 'withdrawal' | 'fee' | 'income' | 'adjustment';
export type TransactionSubtype =
  'buy' | 'sell' | 'swap' | 'transfer' | 'deposit' | 'withdrawal' | 'fee' | 'income' | 'adjustment';
export type TransactionSource = 'manual' | 'notion' | 'onchain' | 'system';
export type TradeGroupStatus = 'open' | 'partial' | 'closed' | 'reserve' | 'for_sale';

export const chains = pgTable(
  'chains',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    code: text('code').notNull(),
    name: text('name').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex('chains_code_unique').on(table.code)],
);

export const assets = pgTable(
  'assets',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    chainId: uuid('chain_id')
      .notNull()
      .references(() => chains.id, { onDelete: 'restrict' }),
    symbol: text('symbol').notNull(),
    name: text('name').notNull(),
    contractAddress: text('contract_address'),
    decimals: integer('decimals').notNull().default(18),
    coingeckoId: text('coingecko_id'),
    isStablecoin: boolean('is_stablecoin').notNull().default(false),
    isCashEquivalent: boolean('is_cash_equivalent').notNull().default(false),
    isVerified: boolean('is_verified').notNull().default(false),
    sourceId: text('source_id'),
    dataQuality: jsonb('data_quality').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('assets_chain_symbol_unique').on(table.chainId, table.symbol),
    index('assets_chain_id_idx').on(table.chainId),
  ],
);

export const accounts = pgTable(
  'accounts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    type: text('type').$type<AccountType>().notNull(),
    chainId: uuid('chain_id').references(() => chains.id, { onDelete: 'restrict' }),
    isSystem: boolean('is_system').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('accounts_user_name_unique').on(table.userId, table.name),
    index('accounts_user_id_idx').on(table.userId),
  ],
);

export const tradeGroups = pgTable(
  'trade_groups',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    assetId: uuid('asset_id')
      .notNull()
      .references(() => assets.id, { onDelete: 'restrict' }),
    status: text('status').$type<TradeGroupStatus>().notNull().default('open'),
    openedAt: timestamp('opened_at', { withTimezone: true }).notNull(),
    closedAt: timestamp('closed_at', { withTimezone: true }),
    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('trade_groups_user_id_idx').on(table.userId),
    index('trade_groups_asset_id_idx').on(table.assetId),
  ],
);

export const watchlist = pgTable(
  'watchlist',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    assetId: uuid('asset_id')
      .notNull()
      .references(() => assets.id, { onDelete: 'cascade' }),
    thesis: text('thesis'),
    tags: text('tags')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    priority: integer('priority').notNull().default(0),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('watchlist_user_asset_unique').on(table.userId, table.assetId),
    index('watchlist_user_priority_idx').on(table.userId, table.priority),
    index('watchlist_user_archived_idx').on(table.userId, table.archivedAt),
  ],
);

export const imports = pgTable(
  'imports',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    source: text('source').notNull().default('notion'),
    status: text('status').notNull().default('preview'),
    sourceHash: text('source_hash').notNull(),
    fileName: text('file_name'),
    summary: jsonb('summary').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    committedAt: timestamp('committed_at', { withTimezone: true }),
    rolledBackAt: timestamp('rolled_back_at', { withTimezone: true }),
  },
  (table) => [
    index('imports_user_idx').on(table.userId, table.createdAt),
    uniqueIndex('imports_user_source_hash_unique').on(table.userId, table.source, table.sourceHash),
  ],
);

export const transactions = pgTable(
  'transactions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    type: text('type').$type<TransactionType>().notNull(),
    subtype: text('subtype').$type<TransactionSubtype>().notNull(),
    source: text('source').$type<TransactionSource>().notNull().default('manual'),
    sourceId: text('source_id'),
    importId: uuid('import_id').references(() => imports.id, { onDelete: 'set null' }),
    dataQuality: jsonb('data_quality').$type<Record<string, unknown>>().notNull().default({}),
    tradeGroupId: uuid('trade_group_id').references(() => tradeGroups.id, {
      onDelete: 'set null',
    }),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
    notes: text('notes'),
    feesUsd: numeric('fees_usd', { precision: 24, scale: 8 }).notNull().default('0'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('transactions_user_time_idx').on(table.userId, table.occurredAt),
    index('transactions_trade_group_idx').on(table.tradeGroupId),
    index('transactions_import_idx').on(table.importId),
    uniqueIndex('transactions_source_unique')
      .on(table.userId, table.source, table.sourceId)
      .where(sql`${table.sourceId} is not null`),
  ],
);

export const importRows = pgTable(
  'import_rows',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    importId: uuid('import_id')
      .notNull()
      .references(() => imports.id, { onDelete: 'cascade' }),
    entityType: text('entity_type').notNull(),
    sourceId: text('source_id').notNull(),
    sourceHash: text('source_hash').notNull(),
    status: text('status').notNull().default('pending'),
    data: jsonb('data').$type<Record<string, unknown>>().notNull(),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
    transactionId: uuid('transaction_id').references(() => transactions.id, {
      onDelete: 'set null',
    }),
    error: text('error'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('import_rows_source_unique').on(table.importId, table.entityType, table.sourceId),
    index('import_rows_import_idx').on(table.importId),
  ],
);

export const postings = pgTable(
  'postings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    transactionId: uuid('transaction_id')
      .notNull()
      .references(() => transactions.id, { onDelete: 'cascade' }),
    accountId: uuid('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'restrict' }),
    assetId: uuid('asset_id')
      .notNull()
      .references(() => assets.id, { onDelete: 'restrict' }),
    amount: numeric('amount', { precision: 36, scale: 18 }).notNull(),
    usdValue: numeric('usd_value', { precision: 24, scale: 8 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('postings_transaction_idx').on(table.transactionId),
    index('postings_account_asset_idx').on(table.accountId, table.assetId),
  ],
);

export const tradeDetails = pgTable(
  'trade_details',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tradeGroupId: uuid('trade_group_id')
      .notNull()
      .references(() => tradeGroups.id, { onDelete: 'cascade' }),
    transactionId: uuid('transaction_id')
      .notNull()
      .references(() => transactions.id, { onDelete: 'cascade' }),
    referencePriceUsd: numeric('reference_price_usd', { precision: 24, scale: 8 }),
    executionCostUsd: numeric('execution_cost_usd', { precision: 24, scale: 8 }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('trade_details_group_idx').on(table.tradeGroupId),
    index('trade_details_transaction_idx').on(table.transactionId),
  ],
);

export const lots = pgTable(
  'lots',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    assetId: uuid('asset_id')
      .notNull()
      .references(() => assets.id, { onDelete: 'restrict' }),
    tradeGroupId: uuid('trade_group_id').references(() => tradeGroups.id, {
      onDelete: 'set null',
    }),
    acquisitionTransactionId: uuid('acquisition_transaction_id')
      .notNull()
      .references(() => transactions.id, { onDelete: 'restrict' }),
    amount: numeric('amount', { precision: 36, scale: 18 }).notNull(),
    remainingAmount: numeric('remaining_amount', { precision: 36, scale: 18 }).notNull(),
    costBasisUsd: numeric('cost_basis_usd', { precision: 24, scale: 8 }).notNull(),
    remainingCostBasisUsd: numeric('remaining_cost_basis_usd', {
      precision: 24,
      scale: 8,
    }).notNull(),
    acquiredAt: timestamp('acquired_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('lots_user_asset_idx').on(table.userId, table.assetId),
    index('lots_remaining_idx').on(table.remainingAmount),
    index('lots_group_idx').on(table.tradeGroupId),
  ],
);

export const lotConsumptions = pgTable(
  'lot_consumptions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    lotId: uuid('lot_id')
      .notNull()
      .references(() => lots.id, { onDelete: 'restrict' }),
    disposalTransactionId: uuid('disposal_transaction_id')
      .notNull()
      .references(() => transactions.id, { onDelete: 'restrict' }),
    amount: numeric('amount', { precision: 36, scale: 18 }).notNull(),
    costBasisUsd: numeric('cost_basis_usd', { precision: 24, scale: 8 }).notNull(),
    proceedsUsd: numeric('proceeds_usd', { precision: 24, scale: 8 }).notNull(),
    realizedPnlUsd: numeric('realized_pnl_usd', { precision: 24, scale: 8 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('lot_consumptions_lot_idx').on(table.lotId),
    index('lot_consumptions_transaction_idx').on(table.disposalTransactionId),
  ],
);

export const prices = pgTable(
  'prices',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    assetId: uuid('asset_id')
      .notNull()
      .references(() => assets.id, { onDelete: 'cascade' }),
    priceUsd: numeric('price_usd', { precision: 24, scale: 8 }).notNull(),
    observedAt: timestamp('observed_at', { withTimezone: true }).notNull(),
    source: text('source').notNull().default('manual'),
    importId: uuid('import_id').references(() => imports.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('prices_asset_observed_idx').on(table.assetId, table.observedAt),
    index('prices_import_idx').on(table.importId),
  ],
);

export type Chain = typeof chains.$inferSelect;
export type Asset = typeof assets.$inferSelect;
export type Account = typeof accounts.$inferSelect;
export type TradeGroup = typeof tradeGroups.$inferSelect;
export type WatchlistEntry = typeof watchlist.$inferSelect;
export type Transaction = typeof transactions.$inferSelect;
export type Posting = typeof postings.$inferSelect;
export type TradeDetail = typeof tradeDetails.$inferSelect;
export type Lot = typeof lots.$inferSelect;
export type LotConsumption = typeof lotConsumptions.$inferSelect;
export type Price = typeof prices.$inferSelect;
export type Import = typeof imports.$inferSelect;
export type ImportRow = typeof importRows.$inferSelect;

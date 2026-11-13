import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
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
    stepUpUntil: timestamp('step_up_until', { withTimezone: true }),
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
export type TransactionSource = 'manual' | 'notion' | 'onchain' | 'kyberswap' | 'system';
export type TradeGroupStatus = 'open' | 'partial' | 'closed' | 'reserve' | 'for_sale';
export type TaskStatus = 'open' | 'done' | 'cancelled';
export type TaskRecurrence = 'daily' | 'weekly' | 'monthly';
export type FinanceCurrency = 'BYN' | 'USD' | 'EUR';
export type FinanceAccountKind = 'cash' | 'card' | 'bank' | 'savings' | 'investment' | 'credit';
export type FinanceCategoryKind = 'income' | 'expense' | 'transfer';
export type FinanceTransactionKind = 'income' | 'expense';
export type FinanceTransferKind = 'exchange' | 'card_topup' | 'credit' | 'other';
export type FinanceImportStatus = 'preview' | 'committed' | 'rolled_back';
export type ReconciliationStatus = 'RUNNING' | 'COMPLETED' | 'FAILED';
export type ReconciliationItemStatus =
  'MATCH' | 'MISMATCH' | 'MISSING_ONCHAIN' | 'MISSING_LEDGER' | 'UNSUPPORTED';

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
    logoUrl: text('logo_url'),
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

export const watchedAddresses = pgTable(
  'watched_addresses',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    chain: text('chain').notNull(),
    address: text('address').notNull(),
    label: text('label'),
    enabled: boolean('enabled').notNull().default(true),
    lastIndexedBlock: integer('last_indexed_block'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('watched_addresses_user_chain_address_unique').on(
      table.userId,
      table.chain,
      table.address,
    ),
    index('watched_addresses_user_chain_idx').on(table.userId, table.chain),
  ],
);

export const indexedTransfers = pgTable(
  'indexed_transfers',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    chain: text('chain').notNull(),
    eventKey: text('event_key').notNull(),
    txHash: text('tx_hash').notNull(),
    logIndex: integer('log_index').notNull(),
    blockNumber: integer('block_number').notNull(),
    blockHash: text('block_hash'),
    fromAddress: text('from_address').notNull(),
    toAddress: text('to_address').notNull(),
    assetAddress: text('asset_address'),
    amount: numeric('amount', { precision: 78, scale: 0 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('indexed_transfers_event_key_unique').on(table.eventKey),
    index('indexed_transfers_chain_block_idx').on(table.chain, table.blockNumber),
    index('indexed_transfers_from_idx').on(table.chain, table.fromAddress),
    index('indexed_transfers_to_idx').on(table.chain, table.toAddress),
  ],
);

export const reconciliationRuns = pgTable(
  'reconciliation_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    chain: text('chain').notNull(),
    status: text('status').$type<ReconciliationStatus>().notNull().default('RUNNING'),
    blockNumber: integer('block_number'),
    summary: jsonb('summary').$type<Record<string, unknown>>().notNull().default({}),
    error: text('error'),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  (table) => [
    index('reconciliation_runs_user_chain_idx').on(table.userId, table.chain, table.startedAt),
  ],
);

export const reconciliationItems = pgTable(
  'reconciliation_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    runId: uuid('run_id')
      .notNull()
      .references(() => reconciliationRuns.id, { onDelete: 'cascade' }),
    assetId: uuid('asset_id').references(() => assets.id, { onDelete: 'set null' }),
    symbol: text('symbol').notNull(),
    contractAddress: text('contract_address'),
    ledgerBalance: numeric('ledger_balance', { precision: 36, scale: 18 }).notNull(),
    onchainBalance: numeric('onchain_balance', { precision: 36, scale: 18 }).notNull(),
    delta: numeric('delta', { precision: 36, scale: 18 }).notNull(),
    status: text('status').$type<ReconciliationItemStatus>().notNull(),
    details: jsonb('details').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('reconciliation_items_run_idx').on(table.runId)],
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

export const watchlistGroups = pgTable(
  'watchlist_groups',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    sortOrder: integer('sort_order').notNull().default(0),
    isDefault: boolean('is_default').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('watchlist_groups_user_name_unique').on(table.userId, table.name),
    index('watchlist_groups_user_sort_idx').on(table.userId, table.sortOrder),
    uniqueIndex('watchlist_groups_user_default_unique')
      .on(table.userId)
      .where(sql`${table.isDefault} = true`),
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
    groupId: uuid('group_id').references(() => watchlistGroups.id, { onDelete: 'set null' }),
    thesis: text('thesis'),
    tags: text('tags')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    twitterUrl: text('twitter_url'),
    websiteUrl: text('website_url'),
    bscContractAddress: text('bsc_contract_address'),
    ethereumContractAddress: text('ethereum_contract_address'),
    investors: text('investors')
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
    index('watchlist_user_group_idx').on(table.userId, table.groupId),
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

export const marketQuotes = pgTable(
  'market_quotes',
  {
    assetId: uuid('asset_id')
      .primaryKey()
      .references(() => assets.id, { onDelete: 'cascade' }),
    priceUsd: numeric('price_usd', { precision: 36, scale: 18 }).notNull(),
    change24hPct: numeric('change_24h_pct', { precision: 12, scale: 4 }),
    change7dPct: numeric('change_7d_pct', { precision: 12, scale: 4 }),
    change30dPct: numeric('change_30d_pct', { precision: 12, scale: 4 }),
    change1yPct: numeric('change_1y_pct', { precision: 12, scale: 4 }),
    marketCapUsd: numeric('market_cap_usd', { precision: 24, scale: 2 }),
    source: text('source').notNull(),
    liquidityUsd: numeric('liquidity_usd', { precision: 24, scale: 2 }),
    fetchedAt: timestamp('fetched_at', { withTimezone: true }).notNull(),
    changedAt: timestamp('changed_at', { withTimezone: true }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('market_quotes_fetched_idx').on(table.fetchedAt)],
);

export const portfolioSnapshots = pgTable(
  'portfolio_snapshots',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    snapshotDate: date('snapshot_date').notNull(),
    cashUsd: numeric('cash_usd', { precision: 24, scale: 8 }).notNull(),
    positionsValueUsd: numeric('positions_value_usd', { precision: 24, scale: 8 }).notNull(),
    equityUsd: numeric('equity_usd', { precision: 24, scale: 8 }).notNull(),
    capturedAt: timestamp('captured_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('portfolio_snapshots_user_date_unique').on(table.userId, table.snapshotDate),
    index('portfolio_snapshots_user_date_idx').on(table.userId, table.snapshotDate),
  ],
);

export type SwapStatus =
  | 'QUOTED'
  | 'BUILT'
  | 'APPROVAL_REQUIRED'
  | 'READY'
  | 'AWAITING_SIGNATURE'
  | 'SUBMITTED'
  | 'PENDING'
  | 'CONFIRMED'
  | 'FAILED'
  | 'REPLACED'
  | 'DROPPED'
  | 'EXPIRED'
  | 'CANCELLED';

export const swapOrders = pgTable(
  'swap_orders',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    accountId: uuid('account_id').references(() => accounts.id, { onDelete: 'set null' }),
    chain: text('chain').notNull(),
    walletAddress: text('wallet_address'),
    tokenIn: text('token_in').notNull(),
    tokenOut: text('token_out').notNull(),
    tokenInSymbol: text('token_in_symbol').notNull(),
    tokenOutSymbol: text('token_out_symbol').notNull(),
    amountIn: numeric('amount_in', { precision: 36, scale: 18 }).notNull(),
    amountInUsd: numeric('amount_in_usd', { precision: 24, scale: 8 }),
    amountOut: numeric('amount_out', { precision: 36, scale: 18 }).notNull(),
    builtAmountOut: numeric('built_amount_out', { precision: 36, scale: 0 }),
    executedAmountIn: numeric('executed_amount_in', { precision: 36, scale: 18 }),
    executedAmountOut: numeric('executed_amount_out', { precision: 36, scale: 18 }),
    minOut: numeric('min_out', { precision: 36, scale: 18 }).notNull(),
    slippageBps: integer('slippage_bps').notNull(),
    priceImpactBps: integer('price_impact_bps'),
    routeId: text('route_id'),
    routeSummary: jsonb('route_summary').notNull(),
    routerAddress: text('router_address'),
    calldata: text('calldata'),
    transactionValue: numeric('transaction_value', { precision: 78, scale: 0 }),
    gasEstimate: numeric('gas_estimate', { precision: 24, scale: 0 }),
    gasUsd: numeric('gas_usd', { precision: 24, scale: 8 }),
    txHash: text('tx_hash'),
    nonce: integer('nonce'),
    deadline: integer('deadline'),
    confirmations: integer('confirmations').notNull().default(0),
    blockNumber: integer('block_number'),
    networkFeeWei: numeric('network_fee_wei', { precision: 78, scale: 0 }),
    networkFeeUsd: numeric('network_fee_usd', { precision: 24, scale: 8 }),
    accountingTransactionId: uuid('accounting_transaction_id').references(() => transactions.id, {
      onDelete: 'set null',
    }),
    tradeGroupId: uuid('trade_group_id').references(() => tradeGroups.id, {
      onDelete: 'set null',
    }),
    submittedAt: timestamp('submitted_at', { withTimezone: true }),
    confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
    status: text('status').$type<SwapStatus>().notNull().default('QUOTED'),
    errors: jsonb('errors')
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    quoteExpiresAt: timestamp('quote_expires_at', { withTimezone: true }).notNull(),
    builtAt: timestamp('built_at', { withTimezone: true }),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('swap_orders_user_created_idx').on(table.userId, table.createdAt),
    index('swap_orders_status_idx').on(table.status),
    uniqueIndex('swap_orders_tx_hash_unique')
      .on(table.txHash)
      .where(sql`${table.txHash} is not null`),
  ],
);

export const swapOrderCloseGroups = pgTable(
  'swap_order_close_groups',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orderId: uuid('order_id')
      .notNull()
      .references(() => swapOrders.id, { onDelete: 'cascade' }),
    tradeGroupId: uuid('trade_group_id').references(() => tradeGroups.id, {
      onDelete: 'set null',
    }),
    assetId: uuid('asset_id')
      .notNull()
      .references(() => assets.id, { onDelete: 'restrict' }),
    expectedAmount: numeric('expected_amount', { precision: 36, scale: 18 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('swap_order_close_groups_order_idx').on(table.orderId),
    uniqueIndex('swap_order_close_groups_order_group_unique').on(table.orderId, table.tradeGroupId),
  ],
);

export const swapEvents = pgTable(
  'swap_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orderId: uuid('order_id')
      .notNull()
      .references(() => swapOrders.id, { onDelete: 'cascade' }),
    type: text('type').notNull(),
    payload: jsonb('payload')
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('swap_events_order_created_idx').on(table.orderId, table.createdAt)],
);

export const tokenApprovals = pgTable(
  'token_approvals',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    orderId: uuid('order_id')
      .notNull()
      .references(() => swapOrders.id, { onDelete: 'cascade' }),
    chain: text('chain').notNull(),
    walletAddress: text('wallet_address').notNull(),
    tokenAddress: text('token_address').notNull(),
    spenderAddress: text('spender_address').notNull(),
    amountWei: numeric('amount_wei', { precision: 78, scale: 0 }).notNull(),
    calldata: text('calldata'),
    status: text('status').notNull().default('BUILT'),
    txHash: text('tx_hash'),
    blockNumber: integer('block_number'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    submittedAt: timestamp('submitted_at', { withTimezone: true }),
    confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
  },
  (table) => [
    index('token_approvals_user_created_idx').on(table.userId, table.createdAt),
    index('token_approvals_order_idx').on(table.orderId),
    uniqueIndex('token_approvals_tx_hash_unique')
      .on(table.txHash)
      .where(sql`${table.txHash} is not null`),
    uniqueIndex('token_approvals_active_unique')
      .on(table.orderId, table.tokenAddress, table.spenderAddress)
      .where(sql`${table.status} in ('BUILT', 'SUBMITTED', 'CONFIRMED')`),
  ],
);

export const vaultConfigs = pgTable(
  'vault_configs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    salt: text('salt').notNull(),
    iterations: integer('iterations').notNull().default(600_000),
    wrappedKey: text('wrapped_key').notNull(),
    wrappedKeyIv: text('wrapped_key_iv').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex('vault_configs_user_unique').on(table.userId)],
);

export const vaultItems = pgTable(
  'vault_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    ciphertext: text('ciphertext').notNull(),
    iv: text('iv').notNull(),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('vault_items_user_updated_idx').on(table.userId, table.updatedAt),
    index('vault_items_user_archived_idx').on(table.userId, table.archivedAt),
  ],
);

export const tasks = pgTable(
  'tasks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    description: text('description'),
    status: text('status').$type<TaskStatus>().notNull().default('open'),
    priority: integer('priority').notNull().default(0),
    tags: text('tags')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    dueAt: timestamp('due_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    relatedAssetId: uuid('related_asset_id').references(() => assets.id, { onDelete: 'set null' }),
    seriesId: uuid('series_id'),
    recurrence: text('recurrence').$type<TaskRecurrence>(),
    recurrenceEndsAt: timestamp('recurrence_ends_at', { withTimezone: true }),
    occurrenceIndex: integer('occurrence_index').notNull().default(0),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('tasks_user_status_idx').on(table.userId, table.status),
    index('tasks_user_due_idx').on(table.userId, table.dueAt),
    index('tasks_user_archived_idx').on(table.userId, table.archivedAt),
    index('tasks_user_series_idx').on(table.userId, table.seriesId),
  ],
);

export const taskImages = pgTable(
  'task_images',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    taskId: uuid('task_id')
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    mimeType: text('mime_type').notNull(),
    dataUrl: text('data_url').notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('task_images_user_task_idx').on(table.userId, table.taskId, table.createdAt)],
);

export const notes = pgTable(
  'notes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    body: text('body').notNull().default(''),
    tags: text('tags')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    pinned: boolean('pinned').notNull().default(false),
    relatedAssetId: uuid('related_asset_id').references(() => assets.id, { onDelete: 'set null' }),
    relatedTradeGroupId: uuid('related_trade_group_id').references(() => tradeGroups.id, {
      onDelete: 'set null',
    }),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('notes_user_updated_idx').on(table.userId, table.updatedAt),
    index('notes_user_archived_idx').on(table.userId, table.archivedAt),
    index('notes_user_pinned_idx').on(table.userId, table.pinned),
  ],
);

export const noteImages = pgTable(
  'note_images',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    noteId: uuid('note_id')
      .notNull()
      .references(() => notes.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    mimeType: text('mime_type').notNull(),
    dataUrl: text('data_url').notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('note_images_user_note_idx').on(table.userId, table.noteId, table.createdAt)],
);

export const habits = pgTable(
  'habits',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    startedOn: date('started_on').notNull(),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('habits_user_name_unique')
      .on(table.userId, table.name)
      .where(sql`${table.archivedAt} is null`),
    index('habits_user_archived_idx').on(table.userId, table.archivedAt),
  ],
);

export const financeImports = pgTable(
  'finance_imports',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    source: text('source').notNull().default('notion'),
    sourceHash: text('source_hash').notNull(),
    status: text('status').$type<FinanceImportStatus>().notNull().default('preview'),
    summary: jsonb('summary').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    committedAt: timestamp('committed_at', { withTimezone: true }),
    rolledBackAt: timestamp('rolled_back_at', { withTimezone: true }),
  },
  (table) => [
    uniqueIndex('finance_imports_user_source_hash_unique').on(
      table.userId,
      table.source,
      table.sourceHash,
    ),
    index('finance_imports_user_created_idx').on(table.userId, table.createdAt),
  ],
);

export const financeAccounts = pgTable(
  'finance_accounts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    kind: text('kind').$type<FinanceAccountKind>().notNull(),
    currency: text('currency').$type<FinanceCurrency>().notNull().default('BYN'),
    openingBalance: numeric('opening_balance', { precision: 20, scale: 2 }).notNull().default('0'),
    openingDate: date('opening_date').notNull(),
    fxRate: numeric('fx_rate', { precision: 18, scale: 8 }).notNull().default('1'),
    creditLimit: numeric('credit_limit', { precision: 20, scale: 2 }),
    sortOrder: integer('sort_order').notNull().default(0),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('finance_accounts_user_name_unique').on(table.userId, table.name),
    index('finance_accounts_user_sort_idx').on(table.userId, table.sortOrder),
    index('finance_accounts_user_archived_idx').on(table.userId, table.archivedAt),
    check('finance_accounts_fx_rate_positive', sql`${table.fxRate} > 0`),
    check('finance_accounts_byn_rate_one', sql`${table.currency} <> 'BYN' or ${table.fxRate} = 1`),
  ],
);

export const financeCategories = pgTable(
  'finance_categories',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    kind: text('kind').$type<FinanceCategoryKind>().notNull(),
    color: text('color'),
    icon: text('icon'),
    sortOrder: integer('sort_order').notNull().default(0),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('finance_categories_user_kind_name_unique').on(
      table.userId,
      table.kind,
      table.name,
    ),
    index('finance_categories_user_kind_sort_idx').on(table.userId, table.kind, table.sortOrder),
  ],
);

export const financeTransactions = pgTable(
  'finance_transactions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    kind: text('kind').$type<FinanceTransactionKind>().notNull(),
    occurredOn: date('occurred_on').notNull(),
    accountId: uuid('account_id')
      .notNull()
      .references(() => financeAccounts.id, { onDelete: 'restrict' }),
    categoryId: uuid('category_id').references(() => financeCategories.id, {
      onDelete: 'set null',
    }),
    amount: numeric('amount', { precision: 20, scale: 2 }).notNull(),
    currency: text('currency').$type<FinanceCurrency>().notNull(),
    fxRate: numeric('fx_rate', { precision: 18, scale: 8 }).notNull().default('1'),
    baseAmount: numeric('base_amount', { precision: 20, scale: 2 }).notNull(),
    title: text('title').notNull(),
    description: text('description'),
    source: text('source').notNull().default('manual'),
    sourceId: text('source_id'),
    importId: uuid('import_id').references(() => financeImports.id, { onDelete: 'set null' }),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('finance_transactions_user_source_unique')
      .on(table.userId, table.sourceId)
      .where(sql`${table.sourceId} is not null`),
    index('finance_transactions_user_date_idx').on(table.userId, table.occurredOn),
    index('finance_transactions_user_account_idx').on(table.userId, table.accountId),
    index('finance_transactions_user_category_idx').on(table.userId, table.categoryId),
    check('finance_transactions_amount_positive', sql`${table.amount} > 0`),
  ],
);

export const financeTransfers = pgTable(
  'finance_transfers',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    kind: text('kind').$type<FinanceTransferKind>().notNull(),
    occurredOn: date('occurred_on').notNull(),
    fromAccountId: uuid('from_account_id')
      .notNull()
      .references(() => financeAccounts.id, { onDelete: 'restrict' }),
    toAccountId: uuid('to_account_id')
      .notNull()
      .references(() => financeAccounts.id, { onDelete: 'restrict' }),
    fromAmount: numeric('from_amount', { precision: 20, scale: 2 }).notNull(),
    toAmount: numeric('to_amount', { precision: 20, scale: 2 }).notNull(),
    fromCurrency: text('from_currency').$type<FinanceCurrency>().notNull(),
    toCurrency: text('to_currency').$type<FinanceCurrency>().notNull(),
    fxRate: numeric('fx_rate', { precision: 18, scale: 8 }).notNull().default('1'),
    fromBaseAmount: numeric('from_base_amount', { precision: 20, scale: 2 }).notNull(),
    toBaseAmount: numeric('to_base_amount', { precision: 20, scale: 2 }).notNull(),
    description: text('description'),
    source: text('source').notNull().default('manual'),
    sourceId: text('source_id'),
    importId: uuid('import_id').references(() => financeImports.id, { onDelete: 'set null' }),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('finance_transfers_user_source_unique')
      .on(table.userId, table.sourceId)
      .where(sql`${table.sourceId} is not null`),
    index('finance_transfers_user_date_idx').on(table.userId, table.occurredOn),
    index('finance_transfers_user_from_idx').on(table.userId, table.fromAccountId),
    index('finance_transfers_user_to_idx').on(table.userId, table.toAccountId),
    check(
      'finance_transfers_amounts_positive',
      sql`${table.fromAmount} > 0 and ${table.toAmount} > 0`,
    ),
  ],
);

export const financeImportRows = pgTable(
  'finance_import_rows',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    importId: uuid('import_id')
      .notNull()
      .references(() => financeImports.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    entityType: text('entity_type').notNull(),
    sourceId: text('source_id'),
    data: jsonb('data').$type<Record<string, unknown>>().notNull(),
    status: text('status').notNull(),
    error: text('error'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('finance_import_rows_import_status_idx').on(table.importId, table.status),
    index('finance_import_rows_user_idx').on(table.userId),
  ],
);

export const externalApiCalls = pgTable(
  'external_api_calls',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    provider: text('provider').notNull(),
    endpoint: text('endpoint').notNull(),
    status: integer('status').notNull(),
    latencyMs: integer('latency_ms').notNull(),
    errorCode: text('error_code'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('external_api_calls_created_idx').on(table.createdAt)],
);

export const notifications = pgTable(
  'notifications',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    type: text('type').notNull(),
    title: text('title').notNull(),
    body: text('body').notNull().default(''),
    href: text('href'),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull().default({}),
    readAt: timestamp('read_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('notifications_user_time_idx').on(table.userId, table.createdAt),
    index('notifications_user_unread_idx').on(table.userId, table.readAt),
  ],
);

export const botStrategies = pgTable(
  'bot_strategies',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    key: text('key').notNull(),
    name: text('name').notNull(),
    description: text('description').notNull().default(''),
    version: integer('version').notNull().default(1),
    params: jsonb('params').$type<Record<string, unknown>>().notNull().default({}),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('bot_strategies_user_name_unique')
      .on(table.userId, table.name)
      .where(sql`${table.archivedAt} is null`),
    index('bot_strategies_user_idx').on(table.userId),
  ],
);

export const tradingBots = pgTable(
  'trading_bots',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    strategyId: uuid('strategy_id')
      .notNull()
      .references(() => botStrategies.id, { onDelete: 'restrict' }),
    name: text('name').notNull(),
    description: text('description').notNull().default(''),
    status: text('status').notNull().default('draft'),
    budgetUsd: numeric('budget_usd', { precision: 24, scale: 8 }).notNull(),
    cashUsd: numeric('cash_usd', { precision: 24, scale: 8 }).notNull(),
    maxPositions: integer('max_positions').notNull().default(5),
    positionSizePct: numeric('position_size_pct', { precision: 5, scale: 2 })
      .notNull()
      .default('20'),
    feeBps: integer('fee_bps').notNull().default(25),
    slippageBps: integer('slippage_bps').notNull().default(10),
    maxDailyLossPct: numeric('max_daily_loss_pct', { precision: 5, scale: 2 })
      .notNull()
      .default('10'),
    cooldownMinutes: integer('cooldown_minutes').notNull().default(15),
    peakEquityUsd: numeric('peak_equity_usd', { precision: 24, scale: 8 }).notNull().default('0'),
    maxDrawdownPct: numeric('max_drawdown_pct', { precision: 5, scale: 2 }).notNull().default('0'),
    startedAt: timestamp('started_at', { withTimezone: true }),
    stoppedAt: timestamp('stopped_at', { withTimezone: true }),
    lastTickAt: timestamp('last_tick_at', { withTimezone: true }),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('trading_bots_user_name_unique')
      .on(table.userId, table.name)
      .where(sql`${table.archivedAt} is null`),
    index('trading_bots_user_idx').on(table.userId),
    index('trading_bots_status_idx').on(table.status),
  ],
);

export const botTokens = pgTable(
  'bot_tokens',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    botId: uuid('bot_id')
      .notNull()
      .references(() => tradingBots.id, { onDelete: 'cascade' }),
    assetId: uuid('asset_id')
      .notNull()
      .references(() => assets.id, { onDelete: 'restrict' }),
    enabled: boolean('enabled').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('bot_tokens_bot_asset_unique').on(table.botId, table.assetId),
    index('bot_tokens_asset_idx').on(table.assetId),
  ],
);

export const botPositions = pgTable(
  'bot_positions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    botId: uuid('bot_id')
      .notNull()
      .references(() => tradingBots.id, { onDelete: 'cascade' }),
    assetId: uuid('asset_id')
      .notNull()
      .references(() => assets.id, { onDelete: 'restrict' }),
    amount: numeric('amount', { precision: 36, scale: 18 }).notNull(),
    avgCostUsd: numeric('avg_cost_usd', { precision: 24, scale: 8 }).notNull(),
    costBasisUsd: numeric('cost_basis_usd', { precision: 24, scale: 8 }).notNull(),
    openedAt: timestamp('opened_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('bot_positions_bot_asset_unique').on(table.botId, table.assetId),
    index('bot_positions_bot_idx').on(table.botId),
  ],
);

export const botTrades = pgTable(
  'bot_trades',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    botId: uuid('bot_id')
      .notNull()
      .references(() => tradingBots.id, { onDelete: 'cascade' }),
    assetId: uuid('asset_id')
      .notNull()
      .references(() => assets.id, { onDelete: 'restrict' }),
    side: text('side').notNull(),
    amount: numeric('amount', { precision: 36, scale: 18 }).notNull(),
    priceUsd: numeric('price_usd', { precision: 36, scale: 18 }).notNull(),
    usdValue: numeric('usd_value', { precision: 24, scale: 8 }).notNull(),
    feeUsd: numeric('fee_usd', { precision: 24, scale: 8 }).notNull(),
    slippageUsd: numeric('slippage_usd', { precision: 24, scale: 8 }).notNull(),
    realizedPnlUsd: numeric('realized_pnl_usd', { precision: 24, scale: 8 }).notNull().default('0'),
    reason: text('reason').notNull().default(''),
    signal: jsonb('signal').$type<Record<string, unknown>>().notNull().default({}),
    executedAt: timestamp('executed_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('bot_trades_bot_time_idx').on(table.botId, table.executedAt)],
);

export const botEquitySnapshots = pgTable(
  'bot_equity_snapshots',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    botId: uuid('bot_id')
      .notNull()
      .references(() => tradingBots.id, { onDelete: 'cascade' }),
    capturedAt: timestamp('captured_at', { withTimezone: true }).notNull(),
    cashUsd: numeric('cash_usd', { precision: 24, scale: 8 }).notNull(),
    positionsValueUsd: numeric('positions_value_usd', { precision: 24, scale: 8 }).notNull(),
    equityUsd: numeric('equity_usd', { precision: 24, scale: 8 }).notNull(),
    realizedPnlUsd: numeric('realized_pnl_usd', { precision: 24, scale: 8 }).notNull(),
    unrealizedPnlUsd: numeric('unrealized_pnl_usd', { precision: 24, scale: 8 }).notNull(),
  },
  (table) => [
    index('bot_equity_bot_time_idx').on(table.botId, table.capturedAt),
    index('bot_equity_time_idx').on(table.capturedAt),
  ],
);

export const botEvents = pgTable(
  'bot_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    botId: uuid('bot_id')
      .notNull()
      .references(() => tradingBots.id, { onDelete: 'cascade' }),
    type: text('type').notNull(),
    message: text('message').notNull().default(''),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('bot_events_bot_time_idx').on(table.botId, table.createdAt),
    index('bot_events_time_idx').on(table.createdAt),
  ],
);

export const botQuoteSamples = pgTable(
  'bot_quote_samples',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    assetId: uuid('asset_id')
      .notNull()
      .references(() => assets.id, { onDelete: 'cascade' }),
    priceUsd: numeric('price_usd', { precision: 36, scale: 18 }).notNull(),
    change24hPct: numeric('change_24h_pct', { precision: 12, scale: 4 }),
    capturedAt: timestamp('captured_at', { withTimezone: true }).notNull(),
  },
  (table) => [
    index('bot_quote_samples_asset_time_idx').on(table.assetId, table.capturedAt),
    index('bot_quote_samples_time_idx').on(table.capturedAt),
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
export type MarketQuote = typeof marketQuotes.$inferSelect;
export type Import = typeof imports.$inferSelect;
export type ImportRow = typeof importRows.$inferSelect;
export type SwapOrder = typeof swapOrders.$inferSelect;
export type SwapEvent = typeof swapEvents.$inferSelect;
export type ExternalApiCall = typeof externalApiCalls.$inferSelect;
export type NotificationRecord = typeof notifications.$inferSelect;
export type BotStrategyRecord = typeof botStrategies.$inferSelect;
export type TradingBotRecord = typeof tradingBots.$inferSelect;
export type BotTokenRecord = typeof botTokens.$inferSelect;
export type BotPositionRecord = typeof botPositions.$inferSelect;
export type BotTradeRecord = typeof botTrades.$inferSelect;
export type BotEquitySnapshotRecord = typeof botEquitySnapshots.$inferSelect;
export type BotEventRecord = typeof botEvents.$inferSelect;
export type BotQuoteSampleRecord = typeof botQuoteSamples.$inferSelect;
export type TokenApproval = typeof tokenApprovals.$inferSelect;
export type VaultConfig = typeof vaultConfigs.$inferSelect;
export type VaultItem = typeof vaultItems.$inferSelect;
export type TaskRecord = typeof tasks.$inferSelect;
export type NoteRecord = typeof notes.$inferSelect;
export type NoteImageRecord = typeof noteImages.$inferSelect;
export type HabitRecord = typeof habits.$inferSelect;
export type FinanceImport = typeof financeImports.$inferSelect;
export type FinanceAccount = typeof financeAccounts.$inferSelect;
export type FinanceCategory = typeof financeCategories.$inferSelect;
export type FinanceTransaction = typeof financeTransactions.$inferSelect;
export type FinanceTransfer = typeof financeTransfers.$inferSelect;
export type FinanceImportRow = typeof financeImportRows.$inferSelect;

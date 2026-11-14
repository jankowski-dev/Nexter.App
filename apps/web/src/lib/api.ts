import {
  accountsResponseSchema,
  approvalBuildResponseSchema,
  assetsResponseSchema,
  auditLogResponseSchema,
  authMeResponseSchema,
  botBacktestClearResponseSchema,
  botBacktestPreviewResponseSchema,
  botBacktestRunSchema,
  botBacktestsResponseSchema,
  botDetailResponseSchema,
  botEquityResponseSchema,
  botEventsResponseSchema,
  botStrategiesResponseSchema,
  botSignalsResponseSchema,
  botTradesResponseSchema,
  tradingBotsResponseSchema,
  dashboardActivePositionsSchema,
  dashboardAllocationSchema,
  dashboardDataQualitySchema,
  dashboardPnlSchema,
  dashboardRecentTradesSchema,
  dashboardSummarySchema,
  equityCurveSchema,
  errorEnvelopeSchema,
  financeAccountsResponseSchema,
  financeCategoriesResponseSchema,
  financeCreditDrawdownResponseSchema,
  financeImportSchema,
  financeImportsResponseSchema,
  financeJournalResponseSchema,
  financeSummarySchema,
  financeTransactionSchema,
  financeTransactionsResponseSchema,
  financeTransfersResponseSchema,
  habitSchema,
  habitsResponseSchema,
  healthResponseSchema,
  importResponseSchema,
  importsResponseSchema,
  manualTransactionResponseSchema,
  noteImageSchema,
  noteSchema,
  notificationsResponseSchema,
  notificationsReadAllResponseSchema,
  notificationUnreadCountSchema,
  notificationsClearResponseSchema,
  notesResponseSchema,
  portfolioAssetDetailSchema,
  portfolioTokenSummariesResponseSchema,
  portfolioSnapshotSchema,
  positionsResponseSchema,
  reportsResponseSchema,
  settingsSchema,
  stepUpResponseSchema,
  taskImageSchema,
  taskSchema,
  tasksResponseSchema,
  swapBuildResponseSchema,
  swapConfigResponseSchema,
  swapOrderDetailSchema,
  swapPreviewSchema,
  tokenApprovalSchema,
  tradeGroupDetailSchema,
  tradeGroupsResponseSchema,
  transactionsPageResponseSchema,
  vaultConfigSchema,
  vaultItemSchema,
  vaultResponseSchema,
  watchlistChartResponseSchema,
  watchlistEntrySchema,
  watchlistGroupSchema,
  watchlistGroupsResponseSchema,
  watchlistResponseSchema,
  watchlistTokenSearchResultSchema,
  type AccountsResponse,
  type ApprovalBuildResponse,
  type AssetsResponse,
  type AuditLogResponse,
  type BotBacktestClearResponse,
  type BotBacktestListQuery,
  type BotBacktestPreviewRequest,
  type BotBacktestPreviewResponse,
  type BotBacktestRequest,
  type BotBacktestRun,
  type BotBacktestsResponse,
  type BotCreateRequest,
  type BotDetailResponse,
  type BotEquityResponse,
  type BotEventsResponse,
  type BotSignalsResponse,
  type BotStrategiesResponse,
  type BotTradesResponse,
  type BotUpdateRequest,
  type TradingBotsResponse,
  type DashboardActivePositions,
  type DashboardAllocation,
  type DashboardDataQuality,
  type DashboardPnl,
  type DashboardRecentTrades,
  type DashboardSummary,
  type EquityCurve,
  type FinanceAccountCreateRequest,
  type FinanceAccountUpdateRequest,
  type FinanceAccountsResponse,
  type FinanceCategoryCreateRequest,
  type FinanceCategoryUpdateRequest,
  type FinanceCategoriesResponse,
  type FinanceCreditDrawdownRequest,
  type FinanceCreditDrawdownResponse,
  type FinanceImport,
  type FinanceImportRequest,
  type FinanceImportsResponse,
  type FinanceJournalResponse,
  type FinanceListQuery,
  type FinanceSummary,
  type FinanceTransaction,
  type FinanceTransactionCreateRequest,
  type FinanceTransactionUpdateRequest,
  type FinanceTransactionsResponse,
  type FinanceTransferCreateRequest,
  type FinanceTransfersResponse,
  type FinanceTransferUpdateRequest,
  type Habit,
  type HabitCreateRequest,
  type HabitUpdateRequest,
  type HabitsResponse,
  type HealthResponse,
  type ImportResponse,
  type ImportsResponse,
  type ManualTransactionRequest,
  type ManualTransactionResponse,
  type Note,
  type NoteCreateRequest,
  type NoteImage,
  type NotificationUnreadCount,
  type NotificationsResponse,
  type NotificationsClearResponse,
  type NotificationsReadAllResponse,
  type NoteImageCreateRequest,
  type NoteListQuery,
  type NoteUpdateRequest,
  type NotesResponse,
  type PortfolioAssetDetail,
  type PortfolioTokenSummariesResponse,
  type PortfolioSnapshot,
  type PositionsResponse,
  type ReportsResponse,
  type Settings,
  type StepUpResponse,
  type Task,
  type TaskCreateRequest,
  type TaskImage,
  type TaskImageCreateRequest,
  type TaskListQuery,
  type TaskUpdateRequest,
  type TasksResponse,
  type SwapChainCode,
  type SwapBuildResponse,
  type SwapConfigResponse,
  type SwapOrderDetail,
  type SwapPreview,
  type TokenApproval,
  type TradeGroupDetail,
  type VaultConfig,
  type VaultInitializeRequest,
  type VaultItem,
  type VaultItemCreateRequest,
  type VaultItemUpdateRequest,
  type VaultResponse,
  type TradeGroupListQuery,
  type TradeGroupSellRequest,
  type TradeGroupsResponse,
  type TransactionsListQuery,
  type TransactionsPageResponse,
  type UpdateSettingsRequest,
  type WatchlistChartResponse,
  type WatchlistCreateRequest,
  type WatchlistEntry,
  type WatchlistFromContractRequest,
  type WatchlistGroup,
  type WatchlistGroupCreateRequest,
  type WatchlistGroupUpdateRequest,
  type WatchlistGroupsResponse,
  type WatchlistResponse,
  type WatchlistTokenSearchQuery,
  type WatchlistTokenSearchResult,
  type WatchlistUpdateRequest,
} from '@nexter/contracts';

export { healthResponseSchema };
export type {
  AccountsResponse,
  ApprovalBuildResponse,
  AssetsResponse,
  AuditLogResponse,
  DashboardActivePositions,
  DashboardAllocation,
  DashboardDataQuality,
  DashboardPnl,
  DashboardRecentTrades,
  DashboardSummary,
  EquityCurve,
  HealthResponse,
  ImportResponse,
  ImportsResponse,
  PortfolioAssetDetail,
  PortfolioSnapshot,
  PositionsResponse,
  Settings,
  StepUpResponse,
  SwapBuildResponse,
  SwapConfigResponse,
  TokenApproval,
  SwapOrderDetail,
  TradeGroupDetail,
  TradeGroupsResponse,
  TransactionsPageResponse,
  WatchlistEntry,
  WatchlistFromContractRequest,
  WatchlistGroup,
  WatchlistGroupCreateRequest,
  WatchlistGroupUpdateRequest,
  WatchlistGroupsResponse,
  WatchlistResponse,
  WatchlistTokenSearchQuery,
  WatchlistTokenSearchResult,
};

export interface NotionImportRawPayload {
  fileName: string;
  source: string;
  orders: string;
  transactions: string;
}

export class ApiError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly requestId?: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

function readCookie(name: string): string | undefined {
  if (typeof document === 'undefined') return undefined;

  return document.cookie
    .split('; ')
    .find((entry) => entry.startsWith(`${name}=`))
    ?.slice(name.length + 1);
}

export async function apiFetch<T>(
  path: string,
  init: RequestInit = {},
  schema?: { parse: (value: unknown) => T },
): Promise<T> {
  const method = (init.method ?? 'GET').toUpperCase();
  const csrfToken = readCookie('nexter_csrf');
  const headers: Record<string, string> = {
    Accept: 'application/json',
    ...(init.headers as Record<string, string> | undefined),
  };

  if (csrfToken && !['GET', 'HEAD', 'OPTIONS'].includes(method)) {
    headers['x-csrf-token'] = csrfToken;
  }

  const response = await fetch(path, {
    credentials: 'include',
    ...init,
    method,
    headers,
  });

  const text = await response.text();
  let payload: unknown;

  if (text.length > 0) {
    try {
      payload = JSON.parse(text);
    } catch {
      throw new ApiError('INVALID_RESPONSE', 'Сервер вернул некорректный ответ');
    }
  }

  if (!response.ok) {
    const parsed = errorEnvelopeSchema.safeParse(payload);

    if (parsed.success) {
      throw new ApiError(
        parsed.data.error.code,
        parsed.data.error.message,
        parsed.data.error.requestId,
        parsed.data.error.details,
      );
    }

    throw new ApiError('HTTP_ERROR', `Ошибка запроса (${response.status})`);
  }

  if (schema) {
    return schema.parse(payload);
  }

  return payload as T;
}

export async function apiPost<T>(
  path: string,
  body: unknown,
  schema?: { parse: (value: unknown) => T },
): Promise<T> {
  return apiFetch<T>(
    path,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    },
    schema,
  );
}

export async function apiPatch<T>(
  path: string,
  body: unknown,
  schema?: { parse: (value: unknown) => T },
): Promise<T> {
  return apiFetch<T>(
    path,
    {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    },
    schema,
  );
}

export async function apiDelete<T>(
  path: string,
  schema?: { parse: (value: unknown) => T },
): Promise<T> {
  return apiFetch<T>(path, { method: 'DELETE' }, schema);
}

function queryString(params: Record<string, string | number | boolean | undefined>): string {
  const search = new URLSearchParams();

  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') search.set(key, String(value));
  }

  const query = search.toString();
  return query ? `?${query}` : '';
}

export async function fetchMe() {
  return apiFetch('/api/v1/auth/me', {}, authMeResponseSchema);
}

export async function fetchPortfolioTokenSummaries(): Promise<PortfolioTokenSummariesResponse> {
  return apiFetch('/api/v1/portfolio/token-summaries', {}, portfolioTokenSummariesResponseSchema);
}

export async function fetchPositions(): Promise<PositionsResponse> {
  return apiFetch('/api/v1/positions', {}, positionsResponseSchema);
}

export async function fetchAccounts(): Promise<AccountsResponse> {
  return apiFetch('/api/v1/accounts', {}, accountsResponseSchema);
}

export async function fetchAssets(): Promise<AssetsResponse> {
  return apiFetch('/api/v1/assets', {}, assetsResponseSchema);
}

export async function fetchImports(): Promise<ImportsResponse> {
  return apiFetch('/api/v1/imports', {}, importsResponseSchema);
}

export async function fetchImport(importId: string): Promise<ImportResponse> {
  return apiFetch(`/api/v1/imports/${importId}`, {}, importResponseSchema);
}

export async function previewNotionImport(
  payload: NotionImportRawPayload,
): Promise<ImportResponse> {
  const body = `{"fileName":${JSON.stringify(payload.fileName)},"source":${payload.source},"orders":${payload.orders},"transactions":${payload.transactions}}`;

  return apiFetch(
    '/api/v1/imports/notion/preview',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-notion-import+json',
      },
      body,
    },
    importResponseSchema,
  );
}

export async function commitImport(importId: string): Promise<ImportResponse> {
  return apiPost(`/api/v1/imports/${importId}/commit`, {}, importResponseSchema);
}

export async function rollbackImport(importId: string): Promise<ImportResponse> {
  return apiPost(`/api/v1/imports/${importId}/rollback`, {}, importResponseSchema);
}

export async function fetchDashboardSummary(): Promise<DashboardSummary> {
  return apiFetch('/api/v1/dashboard/summary', {}, dashboardSummarySchema);
}

export async function fetchDashboardAllocation(): Promise<DashboardAllocation> {
  return apiFetch('/api/v1/dashboard/allocation', {}, dashboardAllocationSchema);
}

export async function fetchDashboardPnl(): Promise<DashboardPnl> {
  return apiFetch('/api/v1/dashboard/pnl', {}, dashboardPnlSchema);
}

export async function fetchDashboardActivePositions(): Promise<DashboardActivePositions> {
  return apiFetch('/api/v1/dashboard/active-positions', {}, dashboardActivePositionsSchema);
}

export async function fetchDashboardRecentTrades(): Promise<DashboardRecentTrades> {
  return apiFetch('/api/v1/dashboard/recent-trades', {}, dashboardRecentTradesSchema);
}

export async function fetchDashboardDataQuality(): Promise<DashboardDataQuality> {
  return apiFetch('/api/v1/dashboard/data-quality', {}, dashboardDataQualitySchema);
}

export async function fetchEquityCurve(): Promise<EquityCurve> {
  return apiFetch('/api/v1/dashboard/equity-curve', {}, equityCurveSchema);
}

export async function capturePortfolioSnapshot(): Promise<PortfolioSnapshot> {
  return apiPost('/api/v1/dashboard/snapshot', {}, portfolioSnapshotSchema);
}

export async function fetchReports(from?: string, to?: string): Promise<ReportsResponse> {
  return apiFetch(`/api/v1/reports${queryString({ from, to })}`, {}, reportsResponseSchema);
}

export async function fetchTradeGroups(
  params: Partial<TradeGroupListQuery> = {},
): Promise<TradeGroupsResponse> {
  return apiFetch(`/api/v1/trade-groups${queryString(params)}`, {}, tradeGroupsResponseSchema);
}

export async function fetchTradeGroup(id: string): Promise<TradeGroupDetail> {
  return apiFetch(`/api/v1/trade-groups/${id}`, {}, tradeGroupDetailSchema);
}

export async function updateTradeGroupNotes(
  id: string,
  notes: string | null,
): Promise<TradeGroupDetail> {
  return apiPatch(`/api/v1/trade-groups/${id}`, { notes }, tradeGroupDetailSchema);
}

export async function sellTradeGroup(
  id: string,
  body: TradeGroupSellRequest,
  idempotencyKey?: string,
): Promise<TradeGroupDetail> {
  return apiFetch(
    `/api/v1/trade-groups/${id}/sells`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
      },
      body: JSON.stringify(body),
    },
    tradeGroupDetailSchema,
  );
}

export async function fetchPortfolioAsset(id: string): Promise<PortfolioAssetDetail> {
  return apiFetch(`/api/v1/portfolio/assets/${id}`, {}, portfolioAssetDetailSchema);
}

export async function setPrice(assetId: string, priceUsd: string): Promise<void> {
  await apiPost(`/api/v1/prices/${assetId}`, { priceUsd });
}

export async function createManualTransaction(
  body: ManualTransactionRequest,
  idempotencyKey: string = crypto.randomUUID(),
): Promise<ManualTransactionResponse> {
  return apiFetch(
    '/api/v1/transactions',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': idempotencyKey,
      },
      body: JSON.stringify(body),
    },
    manualTransactionResponseSchema,
  );
}

export async function fetchTransactions(
  params: Partial<TransactionsListQuery> = {},
): Promise<TransactionsPageResponse> {
  return apiFetch(`/api/v1/transactions${queryString(params)}`, {}, transactionsPageResponseSchema);
}

export async function fetchWatchlist(
  includeArchived = false,
  cursor?: string,
  groupId?: string,
  limit = 50,
): Promise<WatchlistResponse> {
  return apiFetch(
    `/api/v1/watchlist${queryString({ includeArchived, cursor, groupId, limit })}`,
    {},
    watchlistResponseSchema,
  );
}

export async function fetchWatchlistChart(
  id: string,
  days: number,
): Promise<WatchlistChartResponse> {
  return apiFetch(
    `/api/v1/watchlist/${id}/chart${queryString({ days })}`,
    {},
    watchlistChartResponseSchema,
  );
}

export async function createWatchlist(body: WatchlistCreateRequest): Promise<WatchlistEntry> {
  return apiPost('/api/v1/watchlist', body, watchlistEntrySchema);
}

export async function updateWatchlist(
  id: string,
  body: WatchlistUpdateRequest,
): Promise<WatchlistEntry> {
  return apiPatch(`/api/v1/watchlist/${id}`, body, watchlistEntrySchema);
}

export async function archiveWatchlist(id: string): Promise<void> {
  await apiDelete(`/api/v1/watchlist/${id}`);
}

export async function fetchWatchlistGroups(): Promise<WatchlistGroupsResponse> {
  return apiFetch('/api/v1/watchlist/groups', {}, watchlistGroupsResponseSchema);
}

export async function createWatchlistGroup(
  body: WatchlistGroupCreateRequest,
): Promise<WatchlistGroup> {
  return apiPost('/api/v1/watchlist/groups', body, watchlistGroupSchema);
}

export async function updateWatchlistGroup(
  id: string,
  body: WatchlistGroupUpdateRequest,
): Promise<WatchlistGroup> {
  return apiPatch(`/api/v1/watchlist/groups/${id}`, body, watchlistGroupSchema);
}

export async function deleteWatchlistGroup(id: string): Promise<void> {
  await apiDelete(`/api/v1/watchlist/groups/${id}`);
}

export async function searchWatchlistToken(
  query: WatchlistTokenSearchQuery,
): Promise<WatchlistTokenSearchResult> {
  return apiFetch(
    `/api/v1/watchlist/search${queryString(query)}`,
    {},
    watchlistTokenSearchResultSchema,
  );
}

export async function createWatchlistFromContract(
  body: WatchlistFromContractRequest,
): Promise<WatchlistEntry> {
  return apiPost('/api/v1/watchlist/from-contract', body, watchlistEntrySchema);
}

export async function fetchSettings(): Promise<Settings> {
  return apiFetch('/api/v1/settings', {}, settingsSchema);
}

export async function updateSettings(body: UpdateSettingsRequest): Promise<Settings> {
  return apiPatch('/api/v1/settings', body, settingsSchema);
}

export async function fetchAuditLog(
  params: {
    limit?: number;
    cursor?: string;
    action?: string;
    entityType?: string;
    from?: string;
    to?: string;
  } = {},
): Promise<AuditLogResponse> {
  return apiFetch(`/api/v1/audit-log${queryString(params)}`, {}, auditLogResponseSchema);
}

export async function fetchSwapConfig(): Promise<SwapConfigResponse> {
  return apiFetch('/api/v1/swap/config', {}, swapConfigResponseSchema);
}

export async function quoteSwap(body: {
  chain: SwapChainCode;
  tokenIn: string;
  tokenOut: string;
  amountIn: string;
  slippageBps?: number;
  walletAddress?: string;
  closeGroupIds?: string[];
}): Promise<SwapOrderDetail> {
  return apiPost('/api/v1/swap/quote', body, swapOrderDetailSchema);
}

export async function previewSwap(body: {
  chain: SwapChainCode;
  tokenIn: string;
  tokenOut: string;
  amountIn: string;
  slippageBps?: number;
  walletAddress?: string;
}): Promise<SwapPreview> {
  return apiPost('/api/v1/swap/preview', body, swapPreviewSchema);
}

export async function buildSwap(
  orderId: string,
  walletAddress: string,
): Promise<SwapBuildResponse> {
  return apiPost('/api/v1/swap/build', { orderId, walletAddress }, swapBuildResponseSchema);
}

export async function readySwap(orderId: string): Promise<SwapBuildResponse> {
  return apiPost(`/api/v1/swap/orders/${orderId}/ready`, {}, swapBuildResponseSchema);
}

export async function markSwapSigning(orderId: string): Promise<SwapOrderDetail> {
  return apiPost(`/api/v1/swap/orders/${orderId}/signing`, {}, swapOrderDetailSchema);
}

export async function cancelSwapSigning(orderId: string): Promise<SwapOrderDetail> {
  return apiPost(`/api/v1/swap/orders/${orderId}/signing/cancel`, {}, swapOrderDetailSchema);
}

export async function cancelSwap(orderId: string): Promise<SwapOrderDetail> {
  return apiPost(`/api/v1/swap/orders/${orderId}/cancel`, {}, swapOrderDetailSchema);
}

export async function submitSwap(orderId: string, txHash: string): Promise<SwapOrderDetail> {
  return apiPost(`/api/v1/swap/orders/${orderId}/submitted`, { txHash }, swapOrderDetailSchema);
}

export async function fetchSwapOrder(orderId: string): Promise<SwapOrderDetail> {
  return apiFetch(`/api/v1/swap/orders/${orderId}`, {}, swapOrderDetailSchema);
}

export async function buildSwapApproval(orderId: string): Promise<ApprovalBuildResponse> {
  return apiPost('/api/v1/swap/approvals/build', { orderId }, approvalBuildResponseSchema);
}

export async function submitSwapApproval(
  approvalId: string,
  txHash: string,
): Promise<TokenApproval> {
  return apiPost(`/api/v1/swap/approvals/${approvalId}/submitted`, { txHash }, tokenApprovalSchema);
}

export async function stepUp(code: string): Promise<StepUpResponse> {
  return apiPost('/api/v1/auth/step-up', { code }, stepUpResponseSchema);
}

export async function downloadExport(
  dataset: 'transactions' | 'positions' | 'trade-groups',
  format: 'csv' | 'json',
  period: { from?: string; to?: string } = {},
): Promise<void> {
  const response = await fetch(
    `/api/v1/export/${dataset}.${format}${queryString({ from: period.from, to: period.to })}`,
    {
      credentials: 'include',
      headers: { Accept: '*/*' },
    },
  );

  if (!response.ok) {
    throw new ApiError('EXPORT_FAILED', 'Не удалось скачать экспорт');
  }

  const blob = await response.blob();
  const disposition = response.headers.get('content-disposition') ?? '';
  const fileName = disposition.match(/filename="([^"]+)"/)?.[1] ?? `nexter-${dataset}.${format}`;
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export async function fetchVault(includeArchived = false): Promise<VaultResponse> {
  return apiFetch(`/api/v1/vault${queryString({ includeArchived })}`, {}, vaultResponseSchema);
}

export async function initializeVault(body: VaultInitializeRequest): Promise<VaultConfig> {
  return apiPost('/api/v1/vault/initialize', body, vaultConfigSchema);
}

export async function createVaultItem(body: VaultItemCreateRequest): Promise<VaultItem> {
  return apiPost('/api/v1/vault/items', body, vaultItemSchema);
}

export async function updateVaultItem(
  id: string,
  body: VaultItemUpdateRequest,
): Promise<VaultItem> {
  return apiPatch(`/api/v1/vault/items/${id}`, body, vaultItemSchema);
}

export async function fetchTasks(params: Partial<TaskListQuery> = {}): Promise<TasksResponse> {
  return apiFetch(`/api/v1/tasks${queryString(params)}`, {}, tasksResponseSchema);
}

export async function createTask(body: TaskCreateRequest): Promise<Task> {
  return apiPost('/api/v1/tasks', body, taskSchema);
}

export async function updateTask(id: string, body: TaskUpdateRequest): Promise<Task> {
  return apiPatch(`/api/v1/tasks/${id}`, body, taskSchema);
}

export async function fetchHabits(includeArchived = false): Promise<HabitsResponse> {
  return apiFetch(`/api/v1/habits${queryString({ includeArchived })}`, {}, habitsResponseSchema);
}

export async function createHabit(body: HabitCreateRequest): Promise<Habit> {
  return apiPost('/api/v1/habits', body, habitSchema);
}

export async function updateHabit(id: string, body: HabitUpdateRequest): Promise<Habit> {
  return apiPatch(`/api/v1/habits/${id}`, body, habitSchema);
}

export async function addTaskImage(
  taskId: string,
  body: TaskImageCreateRequest,
): Promise<TaskImage> {
  return apiPost(`/api/v1/tasks/${taskId}/images`, body, taskImageSchema);
}

export async function removeTaskImage(taskId: string, imageId: string): Promise<void> {
  await apiDelete(`/api/v1/tasks/${taskId}/images/${imageId}`);
}

export async function fetchNotes(params: Partial<NoteListQuery> = {}): Promise<NotesResponse> {
  return apiFetch(`/api/v1/notes${queryString(params)}`, {}, notesResponseSchema);
}

export async function fetchNote(id: string): Promise<Note> {
  return apiFetch(`/api/v1/notes/${id}`, {}, noteSchema);
}

export async function createNote(body: NoteCreateRequest): Promise<Note> {
  return apiPost('/api/v1/notes', body, noteSchema);
}

export async function updateNote(id: string, body: NoteUpdateRequest): Promise<Note> {
  return apiPatch(`/api/v1/notes/${id}`, body, noteSchema);
}

export async function fetchFinanceSummary(
  params: {
    month?: string;
    months?: number;
    from?: string;
    to?: string;
    all?: boolean;
  } = {},
): Promise<FinanceSummary> {
  return apiFetch(`/api/v1/finance/summary${queryString(params)}`, {}, financeSummarySchema);
}

export async function fetchFinanceAccounts(): Promise<FinanceAccountsResponse> {
  return apiFetch('/api/v1/finance/accounts', {}, financeAccountsResponseSchema);
}

export async function createFinanceAccount(
  body: FinanceAccountCreateRequest,
): Promise<FinanceAccountsResponse['accounts'][number]> {
  return apiPost(
    '/api/v1/finance/accounts',
    body,
    financeAccountsResponseSchema.shape.accounts.element,
  );
}

export async function updateFinanceAccount(
  id: string,
  body: FinanceAccountUpdateRequest,
): Promise<FinanceAccountsResponse['accounts'][number]> {
  return apiPatch(
    `/api/v1/finance/accounts/${id}`,
    body,
    financeAccountsResponseSchema.shape.accounts.element,
  );
}

export async function fetchFinanceCategories(): Promise<FinanceCategoriesResponse> {
  return apiFetch('/api/v1/finance/categories', {}, financeCategoriesResponseSchema);
}

export async function createFinanceCategory(
  body: FinanceCategoryCreateRequest,
): Promise<FinanceCategoriesResponse['categories'][number]> {
  return apiPost(
    '/api/v1/finance/categories',
    body,
    financeCategoriesResponseSchema.shape.categories.element,
  );
}

export async function updateFinanceCategory(
  id: string,
  body: FinanceCategoryUpdateRequest,
): Promise<FinanceCategoriesResponse['categories'][number]> {
  return apiPatch(
    `/api/v1/finance/categories/${id}`,
    body,
    financeCategoriesResponseSchema.shape.categories.element,
  );
}

export async function fetchFinanceTransactions(
  params: Partial<FinanceListQuery> = {},
): Promise<FinanceTransactionsResponse> {
  return apiFetch(
    `/api/v1/finance/transactions${queryString(params)}`,
    {},
    financeTransactionsResponseSchema,
  );
}

export async function createFinanceTransaction(
  body: FinanceTransactionCreateRequest,
): Promise<FinanceTransaction> {
  return apiPost('/api/v1/finance/transactions', body, financeTransactionSchema);
}

export async function updateFinanceTransaction(
  id: string,
  body: FinanceTransactionUpdateRequest,
): Promise<FinanceTransaction> {
  return apiPatch(`/api/v1/finance/transactions/${id}`, body, financeTransactionSchema);
}

export async function fetchFinanceTransfers(
  params: Partial<FinanceListQuery> = {},
): Promise<FinanceTransfersResponse> {
  return apiFetch(
    `/api/v1/finance/transfers${queryString(params)}`,
    {},
    financeTransfersResponseSchema,
  );
}

export async function createFinanceTransfer(
  body: FinanceTransferCreateRequest,
): Promise<FinanceTransfersResponse['transfers'][number]> {
  return apiPost(
    '/api/v1/finance/transfers',
    body,
    financeTransfersResponseSchema.shape.transfers.element,
  );
}

export async function updateFinanceTransfer(
  id: string,
  body: FinanceTransferUpdateRequest,
): Promise<FinanceTransfersResponse['transfers'][number]> {
  return apiPatch(
    `/api/v1/finance/transfers/${id}`,
    body,
    financeTransfersResponseSchema.shape.transfers.element,
  );
}

export async function fetchFinanceJournal(
  params: Partial<FinanceListQuery> = {},
): Promise<FinanceJournalResponse> {
  return apiFetch(
    `/api/v1/finance/journal${queryString(params)}`,
    {},
    financeJournalResponseSchema,
  );
}

export async function previewFinanceImport(body: FinanceImportRequest): Promise<FinanceImport> {
  return apiPost('/api/v1/finance/import/preview', body, financeImportSchema);
}

export async function commitFinanceImport(id: string): Promise<FinanceImport> {
  return apiPost(`/api/v1/finance/import/${id}/commit`, {}, financeImportSchema);
}

export async function rollbackFinanceImport(id: string): Promise<FinanceImport> {
  return apiPost(`/api/v1/finance/import/${id}/rollback`, {}, financeImportSchema);
}

export async function fetchFinanceImports(): Promise<FinanceImportsResponse> {
  return apiFetch('/api/v1/finance/imports', {}, financeImportsResponseSchema);
}

export async function createFinanceCreditDrawdown(
  body: FinanceCreditDrawdownRequest,
): Promise<FinanceCreditDrawdownResponse> {
  return apiPost('/api/v1/finance/credits/drawdown', body, financeCreditDrawdownResponseSchema);
}

export async function addNoteImage(
  noteId: string,
  body: NoteImageCreateRequest,
): Promise<NoteImage> {
  return apiPost(`/api/v1/notes/${noteId}/images`, body, noteImageSchema);
}

export async function removeNoteImage(noteId: string, imageId: string): Promise<void> {
  await apiDelete(`/api/v1/notes/${noteId}/images/${imageId}`);
}

export async function fetchBotStrategies(): Promise<BotStrategiesResponse> {
  return apiFetch('/api/v1/trading-bots/strategies', {}, botStrategiesResponseSchema);
}

export async function fetchTradingBots(includeArchived = false): Promise<TradingBotsResponse> {
  return apiFetch(
    `/api/v1/trading-bots/bots?includeArchived=${includeArchived ? 'true' : 'false'}`,
    {},
    tradingBotsResponseSchema,
  );
}

export async function fetchTradingBot(id: string): Promise<BotDetailResponse> {
  return apiFetch(`/api/v1/trading-bots/bots/${id}`, {}, botDetailResponseSchema);
}

export async function createTradingBot(body: BotCreateRequest): Promise<BotDetailResponse> {
  return apiPost('/api/v1/trading-bots/bots', body, botDetailResponseSchema);
}

export async function updateTradingBot(
  id: string,
  body: BotUpdateRequest,
): Promise<BotDetailResponse> {
  return apiPatch(`/api/v1/trading-bots/bots/${id}`, body, botDetailResponseSchema);
}

export async function startTradingBot(id: string): Promise<BotDetailResponse> {
  return apiPost(`/api/v1/trading-bots/bots/${id}/start`, {}, botDetailResponseSchema);
}

export async function stopTradingBot(id: string): Promise<BotDetailResponse> {
  return apiPost(`/api/v1/trading-bots/bots/${id}/stop`, {}, botDetailResponseSchema);
}

export async function resetTradingBot(id: string): Promise<BotDetailResponse> {
  return apiPost(`/api/v1/trading-bots/bots/${id}/reset`, {}, botDetailResponseSchema);
}

export async function closeTradingBotPositions(id: string): Promise<BotDetailResponse> {
  return apiPost(`/api/v1/trading-bots/bots/${id}/close-positions`, {}, botDetailResponseSchema);
}

export async function archiveTradingBot(id: string): Promise<void> {
  await apiDelete(`/api/v1/trading-bots/bots/${id}`);
}

export async function fetchBotTrades(
  id: string,
  limit = 100,
  offset = 0,
): Promise<BotTradesResponse> {
  return apiFetch(
    `/api/v1/trading-bots/bots/${id}/trades${queryString({ limit, offset })}`,
    {},
    botTradesResponseSchema,
  );
}

export async function fetchBotEvents(
  id: string,
  limit = 100,
  offset = 0,
): Promise<BotEventsResponse> {
  return apiFetch(
    `/api/v1/trading-bots/bots/${id}/events${queryString({ limit, offset })}`,
    {},
    botEventsResponseSchema,
  );
}

export async function fetchBotEquity(
  id: string,
  limit = 500,
  offset = 0,
): Promise<BotEquityResponse> {
  return apiFetch(
    `/api/v1/trading-bots/bots/${id}/equity${queryString({ limit, offset })}`,
    {},
    botEquityResponseSchema,
  );
}

export async function fetchBotSignals(id: string): Promise<BotSignalsResponse> {
  return apiFetch(`/api/v1/trading-bots/bots/${id}/signals`, {}, botSignalsResponseSchema);
}

export async function previewBotBacktest(
  body: BotBacktestPreviewRequest,
): Promise<BotBacktestPreviewResponse> {
  return apiPost('/api/v1/trading-bots/backtests/preview', body, botBacktestPreviewResponseSchema);
}

export async function runBotBacktest(body: BotBacktestRequest): Promise<BotBacktestRun> {
  return apiPost('/api/v1/trading-bots/backtests', body, botBacktestRunSchema);
}

export async function fetchBotBacktests(
  query: Partial<BotBacktestListQuery> = {},
): Promise<BotBacktestsResponse> {
  return apiFetch(
    `/api/v1/trading-bots/backtests${queryString({
      strategyKey: query.strategyKey,
      assetId: query.assetId,
      limit: query.limit,
    })}`,
    {},
    botBacktestsResponseSchema,
  );
}

export async function fetchBotBacktest(id: string): Promise<BotBacktestRun> {
  return apiFetch(`/api/v1/trading-bots/backtests/${id}`, {}, botBacktestRunSchema);
}

export function botBacktestReportUrl(id: string): string {
  return `/api/v1/trading-bots/backtests/${id}/report.pdf`;
}

export async function deleteBotBacktest(id: string): Promise<BotBacktestClearResponse> {
  return apiDelete(`/api/v1/trading-bots/backtests/${id}`, botBacktestClearResponseSchema);
}

export async function clearBotBacktests(strategyKey?: string): Promise<BotBacktestClearResponse> {
  return apiDelete(
    `/api/v1/trading-bots/backtests${queryString({ strategyKey })}`,
    botBacktestClearResponseSchema,
  );
}

export async function fetchNotifications(limit = 100): Promise<NotificationsResponse> {
  return apiFetch(`/api/v1/notifications?limit=${limit}`, {}, notificationsResponseSchema);
}

export async function fetchNotificationUnreadCount(): Promise<NotificationUnreadCount> {
  return apiFetch('/api/v1/notifications/unread-count', {}, notificationUnreadCountSchema);
}

export async function markAllNotificationsRead(): Promise<NotificationsReadAllResponse> {
  return apiPost('/api/v1/notifications/read-all', {}, notificationsReadAllResponseSchema);
}

export async function clearNotifications(): Promise<NotificationsClearResponse> {
  return apiPost('/api/v1/notifications/clear', {}, notificationsClearResponseSchema);
}

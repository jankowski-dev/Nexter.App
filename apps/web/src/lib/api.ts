import {
  accountsResponseSchema,
  approvalBuildResponseSchema,
  assetsResponseSchema,
  auditLogResponseSchema,
  authMeResponseSchema,
  dashboardActivePositionsSchema,
  dashboardAllocationSchema,
  dashboardDataQualitySchema,
  dashboardPnlSchema,
  dashboardRecentTradesSchema,
  dashboardSummarySchema,
  equityCurveSchema,
  errorEnvelopeSchema,
  healthResponseSchema,
  importResponseSchema,
  importsResponseSchema,
  portfolioAssetDetailSchema,
  portfolioSnapshotSchema,
  positionsResponseSchema,
  reportsResponseSchema,
  settingsSchema,
  stepUpResponseSchema,
  swapBuildResponseSchema,
  swapConfigResponseSchema,
  swapOrderDetailSchema,
  tokenApprovalSchema,
  tradeGroupDetailSchema,
  tradeGroupsResponseSchema,
  transactionsPageResponseSchema,
  watchlistEntrySchema,
  watchlistGroupSchema,
  watchlistGroupsResponseSchema,
  watchlistResponseSchema,
  watchlistTokenSearchResultSchema,
  type AccountsResponse,
  type ApprovalBuildResponse,
  type AssetsResponse,
  type AuditLogResponse,
  type DashboardActivePositions,
  type DashboardAllocation,
  type DashboardDataQuality,
  type DashboardPnl,
  type DashboardRecentTrades,
  type DashboardSummary,
  type EquityCurve,
  type HealthResponse,
  type ImportResponse,
  type ImportsResponse,
  type PortfolioAssetDetail,
  type PortfolioSnapshot,
  type PositionsResponse,
  type ReportsResponse,
  type Settings,
  type StepUpResponse,
  type SwapChainCode,
  type SwapBuildResponse,
  type SwapConfigResponse,
  type SwapOrderDetail,
  type TokenApproval,
  type TradeGroupDetail,
  type TradeGroupListQuery,
  type TradeGroupSellRequest,
  type TradeGroupsResponse,
  type TransactionsListQuery,
  type TransactionsPageResponse,
  type UpdateSettingsRequest,
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

export async function fetchTransactions(
  params: Partial<TransactionsListQuery> = {},
): Promise<TransactionsPageResponse> {
  return apiFetch(`/api/v1/transactions${queryString(params)}`, {}, transactionsPageResponseSchema);
}

export async function fetchWatchlist(
  includeArchived = false,
  cursor?: string,
  groupId?: string,
): Promise<WatchlistResponse> {
  return apiFetch(
    `/api/v1/watchlist${queryString({ includeArchived, cursor, groupId })}`,
    {},
    watchlistResponseSchema,
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
}): Promise<SwapOrderDetail> {
  return apiPost('/api/v1/swap/quote', body, swapOrderDetailSchema);
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

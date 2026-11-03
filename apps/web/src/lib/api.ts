import {
  authMeResponseSchema,
  dashboardSummarySchema,
  errorEnvelopeSchema,
  healthResponseSchema,
  importResponseSchema,
  importsResponseSchema,
  type DashboardSummary,
  type HealthResponse,
  type ImportResponse,
  type ImportsResponse,
} from '@nexter/contracts';

export { healthResponseSchema };
export type { DashboardSummary, HealthResponse, ImportResponse, ImportsResponse };

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

export async function apiDelete<T>(
  path: string,
  schema?: { parse: (value: unknown) => T },
): Promise<T> {
  return apiFetch<T>(path, { method: 'DELETE' }, schema);
}

export async function fetchMe() {
  return apiFetch('/api/v1/auth/me', {}, authMeResponseSchema);
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

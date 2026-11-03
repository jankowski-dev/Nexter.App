import {
  authMeResponseSchema,
  errorEnvelopeSchema,
  healthResponseSchema,
  type HealthResponse,
} from '@nexter/contracts';

export { healthResponseSchema };
export type { HealthResponse };

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

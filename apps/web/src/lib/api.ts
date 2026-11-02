import { errorEnvelopeSchema, healthResponseSchema, type HealthResponse } from '@nexter/contracts';

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

export async function apiFetch<T>(
  path: string,
  init: RequestInit = {},
  schema?: { parse: (value: unknown) => T },
): Promise<T> {
  const response = await fetch(path, {
    credentials: 'include',
    ...init,
    headers: {
      Accept: 'application/json',
      ...init.headers,
    },
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

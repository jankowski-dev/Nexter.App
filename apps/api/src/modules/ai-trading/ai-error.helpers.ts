import { HttpException } from '@nestjs/common';

const TRANSIENT_CODES = new Set([
  'ECONNRESET',
  'ECONNREFUSED',
  'EPIPE',
  'ETIMEDOUT',
  'EHOSTUNREACH',
  'ENETUNREACH',
  '57P01',
  '57P02',
  '57P03',
  '53300',
  '08000',
  '08001',
  '08003',
  '08006',
]);

const TRANSIENT_PATTERN =
  /connection terminated|connection timeout|timeout exceeded when trying to connect|too many connections|server closed the connection|socket hang up|client has encountered a connection error/i;

const RAW_QUERY_PATTERN = /failed query|^params:/i;

export const DB_UNAVAILABLE_MESSAGE = 'База данных временно недоступна. Повторите запуск цикла.';

export const STALE_CYCLE_MESSAGE = 'Цикл прерван: превышено время ожидания. Запустите новый цикл.';

export function isTransientDbError(error: unknown, depth = 0): boolean {
  if (!error || depth > 5) return false;
  const value = error as { code?: unknown; message?: unknown; cause?: unknown };
  if (typeof value.code === 'string' && TRANSIENT_CODES.has(value.code)) return true;
  if (typeof value.message === 'string' && TRANSIENT_PATTERN.test(value.message)) return true;
  return isTransientDbError(value.cause, depth + 1);
}

export function sanitizeStoredError(message: string | null | undefined): string | null {
  if (!message) return null;
  if (RAW_QUERY_PATTERN.test(message) || TRANSIENT_PATTERN.test(message)) {
    return DB_UNAVAILABLE_MESSAGE;
  }
  return message.slice(0, 500);
}

export function humanizeCycleError(error: unknown): string {
  if (isTransientDbError(error)) return DB_UNAVAILABLE_MESSAGE;
  if (error instanceof HttpException) {
    const response = error.getResponse();
    if (typeof response === 'string' && response.trim().length > 0) {
      return response.slice(0, 500);
    }
    if (response && typeof response === 'object') {
      const message = (response as { message?: unknown }).message;
      if (typeof message === 'string' && message.trim().length > 0) {
        return message.slice(0, 500);
      }
    }
  }
  const raw =
    error instanceof Error ? error.message : typeof error === 'string' ? error : undefined;
  return sanitizeStoredError(raw) ?? 'Неизвестная ошибка цикла';
}

export async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

export async function withDbRetry<T>(
  operation: () => Promise<T>,
  options: { attempts?: number; delayMs?: number } = {},
): Promise<T> {
  const attempts = options.attempts ?? 3;
  const delayMs = options.delayMs ?? 250;
  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (!isTransientDbError(error) || attempt === attempts) throw error;
      await sleep(delayMs * attempt);
    }
  }

  throw lastError;
}

/**
 * Drizzle wraps database failures in an error whose message includes the SQL
 * and whose `params` array contains bound values (emails, notes, amounts,
 * idempotency keys). Those values must never reach logs or Sentry. Replace
 * database errors with a short, value-free error before telemetry.
 */

interface DatabaseErrorLike {
  message?: unknown;
  query?: unknown;
  params?: unknown;
  code?: unknown;
  cause?: { code?: unknown; message?: unknown };
}

function isDatabaseError(error: unknown): error is DatabaseErrorLike {
  if (typeof error !== 'object' || error === null) return false;

  const candidate = error as DatabaseErrorLike;
  const message = typeof candidate.message === 'string' ? candidate.message : '';

  return (
    candidate.query !== undefined ||
    candidate.params !== undefined ||
    message.startsWith('Failed query:') ||
    message.startsWith('DrizzleQueryError')
  );
}

function databaseCode(error: DatabaseErrorLike): string {
  const code =
    (typeof error.cause?.code === 'string' && error.cause.code) ||
    (typeof error.code === 'string' && error.code) ||
    'DATABASE_ERROR';

  return /^[A-Z0-9_]{3,32}$/.test(code) ? code : 'DATABASE_ERROR';
}

export function safeErrorForTelemetry(error: unknown): Error {
  if (!(error instanceof Error)) {
    return new Error('Unknown error');
  }

  if (isDatabaseError(error)) {
    return new Error(`Database query failed (${databaseCode(error)})`);
  }

  const safe = new Error(error.message.slice(0, 500));
  safe.name = error.name;
  safe.stack = error.stack?.split('\n').slice(0, 20).join('\n');

  return safe;
}

export function safeErrorMessage(error: unknown): string {
  return safeErrorForTelemetry(error).message;
}

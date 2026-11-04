import { describe, expect, it } from 'vitest';
import { safeErrorForTelemetry } from './safe-error';

describe('safeErrorForTelemetry', () => {
  it('removes SQL and bound parameters from database errors', () => {
    const error = new Error(
      'Failed query: insert into "users" ("email") values ($1)\nparams: owner@example.com,secret-token',
    );
    Object.assign(error, {
      query: 'insert into "users" ("email") values ($1)',
      params: ['owner@example.com', 'secret-token'],
      cause: { code: '23505' },
    });

    const safe = safeErrorForTelemetry(error);

    expect(safe.message).toBe('Database query failed (23505)');
    expect(safe.message).not.toContain('owner@example.com');
    expect(safe.stack ?? '').not.toContain('owner@example.com');
  });

  it('keeps a bounded message for ordinary errors', () => {
    const safe = safeErrorForTelemetry(new Error('x'.repeat(2000)));

    expect(safe.message).toHaveLength(500);
  });

  it('handles non-Error values', () => {
    expect(safeErrorForTelemetry('boom').message).toBe('Unknown error');
  });
});

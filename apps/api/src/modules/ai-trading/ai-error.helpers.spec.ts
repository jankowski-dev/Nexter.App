import { ServiceUnavailableException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import {
  DB_UNAVAILABLE_MESSAGE,
  humanizeCycleError,
  isTransientDbError,
  sanitizeStoredError,
  withDbRetry,
} from './ai-error.helpers';

describe('ai error helpers', () => {
  it('detects transient database errors through nested causes', () => {
    const error = new Error('Failed query: select 1', {
      cause: Object.assign(new Error('Connection terminated due to connection timeout'), {
        code: 'ECONNRESET',
      }),
    });
    expect(isTransientDbError(error)).toBe(true);
  });

  it('does not treat validation errors as transient', () => {
    expect(isTransientDbError(new Error('Timeframe is not configured'))).toBe(false);
  });

  it('never stores raw SQL in a user-visible message', () => {
    expect(sanitizeStoredError('Failed query: select * from ai_profiles\nparams: 1')).toBe(
      DB_UNAVAILABLE_MESSAGE,
    );
    expect(sanitizeStoredError('Недостаточно истории')).toBe('Недостаточно истории');
  });

  it('keeps the message of HTTP exceptions', () => {
    const error = new ServiceUnavailableException({
      code: 'AI_DATA_INSUFFICIENT',
      message: 'Недостаточно истории: 10 из 100 свечей',
    });
    expect(humanizeCycleError(error)).toBe('Недостаточно истории: 10 из 100 свечей');
  });

  it('retries transient errors and returns the successful result', async () => {
    const operation = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new Error('Connection terminated unexpectedly'))
      .mockResolvedValue('ok');
    await expect(withDbRetry(operation, { attempts: 2, delayMs: 1 })).resolves.toBe('ok');
    expect(operation).toHaveBeenCalledTimes(2);
  });

  it('does not retry non-transient errors', async () => {
    const operation = vi.fn<() => Promise<string>>().mockRejectedValue(new Error('bad input'));
    await expect(withDbRetry(operation, { attempts: 3, delayMs: 1 })).rejects.toThrow('bad input');
    expect(operation).toHaveBeenCalledTimes(1);
  });
});

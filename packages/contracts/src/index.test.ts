import { describe, expect, it } from 'vitest';
import { errorEnvelopeSchema, healthResponseSchema, moneySchema } from './index';

describe('contracts', () => {
  it('accepts decimal money strings', () => {
    expect(moneySchema.parse('123.45')).toBe('123.45');
    expect(moneySchema.parse('-0.01')).toBe('-0.01');
    expect(moneySchema.parse('0')).toBe('0');
  });

  it('rejects non-decimal money strings', () => {
    expect(moneySchema.safeParse('1e3').success).toBe(false);
    expect(moneySchema.safeParse('12,34').success).toBe(false);
  });

  it('validates a health response', () => {
    const parsed = healthResponseSchema.parse({
      status: 'ok',
      uptime: 12.5,
      timestamp: '2026-11-03T00:00:00.000Z',
      version: '0.1.0',
    });

    expect(parsed.status).toBe('ok');
  });

  it('validates an error envelope', () => {
    const parsed = errorEnvelopeSchema.parse({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Invalid request',
        requestId: 'req_1',
      },
    });

    expect(parsed.error.code).toBe('VALIDATION_ERROR');
  });
});

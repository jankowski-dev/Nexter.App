import { describe, expect, it } from 'vitest';
import { env } from '../../shared/config/env';
import { sessionExpiry } from './session.service';

describe('sessionExpiry', () => {
  const now = new Date('2026-11-17T12:00:00.000Z');

  it('uses the configured pending TTL before TOTP verification', () => {
    const expiresAt = sessionExpiry(false, now);
    const minutes = (expiresAt.getTime() - now.getTime()) / 60_000;

    expect(minutes).toBe(env.SESSION_PENDING_TTL_MINUTES);
    expect(minutes).toBeLessThanOrEqual(60);
  });

  it('uses the full session TTL after TOTP verification', () => {
    const expiresAt = sessionExpiry(true, now);
    const days = (expiresAt.getTime() - now.getTime()) / 86_400_000;

    expect(days).toBe(env.SESSION_TTL_DAYS);
  });
});

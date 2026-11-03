import { describe, expect, it } from 'vitest';
import { authCookieOptions } from './auth.cookies';

describe('authCookieOptions', () => {
  it('marks cookies secure only in staging and production', () => {
    expect(authCookieOptions('production', 30).secure).toBe(true);
    expect(authCookieOptions('staging', 30).secure).toBe(true);
    expect(authCookieOptions('test', 30).secure).toBe(false);
    expect(authCookieOptions('development', 30).secure).toBe(false);
  });

  it('uses a root path, lax same-site policy, and the configured TTL', () => {
    const options = authCookieOptions('production', 7);

    expect(options.path).toBe('/');
    expect(options.sameSite).toBe('lax');
    expect(options.maxAge).toBe(7 * 86_400);
  });
});

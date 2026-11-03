import { describe, expect, it } from 'vitest';
import { parseEnv } from './env';

describe('parseEnv', () => {
  it('treats empty values as undefined in development', () => {
    const parsed = parseEnv({
      NODE_ENV: 'development',
      DATABASE_URL: '',
      SETUP_TOKEN: '',
      APP_URL: '',
    });

    expect(parsed.DATABASE_URL).toBe('postgres://postgres:postgres@localhost:5432/nexter');
    expect(parsed.SETUP_TOKEN).toBeUndefined();
    expect(parsed.APP_URL).toBe('http://localhost:5173');
  });

  it('requires production secrets', () => {
    expect(() =>
      parseEnv({
        NODE_ENV: 'production',
        DATABASE_URL: 'postgres://db',
      }),
    ).toThrow(/SETUP_TOKEN/);

    expect(() =>
      parseEnv({
        NODE_ENV: 'production',
        DATABASE_URL: 'postgres://db',
        SETUP_TOKEN: 'setup',
      }),
    ).toThrow(/AUTH_ENCRYPTION_KEY/);

    expect(() =>
      parseEnv({
        NODE_ENV: 'production',
        DATABASE_URL: 'postgres://db',
        SETUP_TOKEN: 'setup',
        AUTH_ENCRYPTION_KEY: 'test-key',
      }),
    ).toThrow(/APP_URL/);

    expect(
      parseEnv({
        NODE_ENV: 'production',
        DATABASE_URL: 'postgres://db',
        SETUP_TOKEN: 'setup',
        AUTH_ENCRYPTION_KEY: 'test-key',
        APP_URL: 'https://example.com',
      }).DATABASE_URL,
    ).toBe('postgres://db');
  });
});

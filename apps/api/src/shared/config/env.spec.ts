import { describe, expect, it } from 'vitest';
import { parseEnv } from './env';

const validKey = Array.from({ length: 32 }, (_, index) => index.toString(16).padStart(2, '0')).join(
  '',
);
const setupToken = 'setup-token-0123456789abcdef0123456789abcdef';

function productionEnv(overrides: Record<string, string | undefined> = {}) {
  return {
    NODE_ENV: 'production',
    DATABASE_URL: 'postgres://db',
    SETUP_TOKEN: setupToken,
    AUTH_ENCRYPTION_KEY: validKey,
    APP_URL: 'https://example.com',
    ...overrides,
  };
}

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
        SETUP_TOKEN: setupToken,
      }),
    ).toThrow(/AUTH_ENCRYPTION_KEY/);

    expect(() =>
      parseEnv({
        NODE_ENV: 'production',
        DATABASE_URL: 'postgres://db',
        SETUP_TOKEN: setupToken,
        AUTH_ENCRYPTION_KEY: validKey,
      }),
    ).toThrow(/APP_URL/);

    expect(parseEnv(productionEnv()).DATABASE_URL).toBe('postgres://db');
  });

  it('parses per-chain swap settings and empty confirmation overrides', () => {
    const parsed = parseEnv({
      NODE_ENV: 'test',
      ETHEREUM_RPC_URL: 'https://ethereum.example',
      SWAP_ETHEREUM_EXECUTION_ENABLED: 'true',
      SWAP_ETHEREUM_CONFIRMATIONS: '',
      SWAP_BSC_CONFIRMATIONS: '',
    });

    expect(parsed.ETHEREUM_RPC_URL).toBe('https://ethereum.example');
    expect(parsed.SWAP_ETHEREUM_EXECUTION_ENABLED).toBe(true);
    expect(parsed.SWAP_ETHEREUM_CONFIRMATIONS).toBe(12);
    expect(parsed.SWAP_BSC_CONFIRMATIONS).toBeUndefined();
  });

  it('rejects malformed encryption keys', () => {
    expect(() => parseEnv(productionEnv({ AUTH_ENCRYPTION_KEY: 'test-key' }))).toThrow(
      /AUTH_ENCRYPTION_KEY/,
    );
  });

  it('rejects weak production secrets and insecure URLs', () => {
    expect(() => parseEnv(productionEnv({ SETUP_TOKEN: 'short' }))).toThrow(/SETUP_TOKEN/);
    expect(() => parseEnv(productionEnv({ SETUP_TOKEN: 'test-setup-token' }))).toThrow(
      /SETUP_TOKEN/,
    );
    expect(() => parseEnv(productionEnv({ AUTH_ENCRYPTION_KEY: 'A'.repeat(64) }))).toThrow(
      /AUTH_ENCRYPTION_KEY/,
    );
    expect(() => parseEnv(productionEnv({ APP_URL: 'http://example.com' }))).toThrow(/HTTPS/);
    expect(() => parseEnv(productionEnv({ TRUST_PROXY: 'true' }))).toThrow(/TRUST_PROXY/);
  });
});

import { describe, expect, it } from 'vitest';
import { parseEnv } from './config.js';

describe('worker parseEnv', () => {
  it('treats empty DATABASE_URL as undefined in development', () => {
    const parsed = parseEnv({
      NODE_ENV: 'development',
      DATABASE_URL: '',
    });

    expect(parsed.DATABASE_URL).toBe('postgres://postgres:postgres@localhost:5432/nexter');
  });

  it('requires DATABASE_URL in production', () => {
    expect(() => parseEnv({ NODE_ENV: 'production' })).toThrow(/DATABASE_URL/);
  });
});

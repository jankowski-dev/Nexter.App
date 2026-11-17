import { describe, expect, it } from 'vitest';
import { assertDisposableTestDatabase, isDisposableTestDatabase } from './test-database';

describe('disposable test database guard', () => {
  it('allows local databases', () => {
    expect(isDisposableTestDatabase('postgres://u:p@localhost:5432/nexter')).toBe(true);
    expect(isDisposableTestDatabase('postgres://u:p@127.0.0.1:5432/nexter')).toBe(true);
  });

  it('allows remote databases with a test name', () => {
    expect(isDisposableTestDatabase('postgres://u:p@db.example.com:5432/nexter_test')).toBe(true);
    expect(isDisposableTestDatabase('postgres://u:p@db.example.com:5432/test-nexter')).toBe(true);
  });

  it('rejects production and malformed URLs', () => {
    expect(isDisposableTestDatabase('postgres://u:p@postgres.railway.internal:5432/railway')).toBe(
      false,
    );
    expect(isDisposableTestDatabase('not-a-url')).toBe(false);
    expect(() => assertDisposableTestDatabase(undefined)).toThrow();
    expect(() =>
      assertDisposableTestDatabase('postgres://u:p@postgres.railway.internal:5432/railway'),
    ).toThrow(/Refusing/);
  });
});

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

function isDisposableTestDatabase(raw: string): boolean {
  let url: URL;

  try {
    url = new URL(raw);
  } catch {
    return false;
  }

  if (url.protocol !== 'postgres:' && url.protocol !== 'postgresql:') return false;

  const host = url.hostname.toLowerCase();
  const database = decodeURIComponent(url.pathname.replace(/^\//, '')).toLowerCase();
  const nonProductionName =
    /(^|[-_])test($|[-_])/.test(database) ||
    database.startsWith('test_') ||
    database.endsWith('_test') ||
    database.endsWith('-test');

  return LOCAL_HOSTS.has(host) || nonProductionName;
}

function assertDisposableTestDatabase(raw: string | undefined): void {
  if (!raw) {
    throw new Error(
      'Refusing to run Playwright tests: DATABASE_URL is missing. Set a disposable local/test database.',
    );
  }

  if (!isDisposableTestDatabase(raw)) {
    let host = 'unknown';
    let database = 'unknown';

    try {
      const url = new URL(raw);
      host = url.hostname;
      database = url.pathname.replace(/^\//, '') || 'unknown';
    } catch {
      // Keep redacted placeholders.
    }

    throw new Error(
      `Refusing to run Playwright tests against ${host}/${database}: only localhost or a database whose name contains "test" is allowed.`,
    );
  }
}

export default function globalSetup(): void {
  if (process.env.NEXTER_TEST_DB !== '1') return;

  assertDisposableTestDatabase(process.env.DATABASE_URL);
}

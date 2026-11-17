import { assertDisposableTestDatabase } from './helpers/test-database';

export default function setup(): void {
  if (process.env.NEXTER_TEST_DB !== '1') return;
  assertDisposableTestDatabase(process.env.DATABASE_URL);
}

import { dropAll, runMigrations } from '../src/migrate';
import { testDatabaseUrl } from '../src/testing';

/** Rebuilds the test database from migrations once per test run. */
export default async function setup(): Promise<void> {
  const url = testDatabaseUrl();
  await dropAll(url);
  await runMigrations(url);
}

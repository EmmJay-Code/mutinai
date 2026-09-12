/**
 * Test helpers for integration tests. Never import from application code.
 */
import { sql } from 'drizzle-orm';
import { createDatabase, type Database, type DatabaseHandle } from './client';
import { requireEnv } from './env';
import { seedDatabase } from './seed';

export function testDatabaseUrl(): string {
  const url = requireEnv('TEST_DATABASE_URL');
  if (!/test/.test(new URL(url).pathname)) throw new Error(`TEST_DATABASE_URL must point at a test database (got ${url})`);
  return url;
}

export function createTestDatabase(): DatabaseHandle {
  return createDatabase(testDatabaseUrl(), { max: 5 });
}

export async function truncateAll(db: Database): Promise<void> {
  const tables = await db.execute<{ fq: string }>(sql`
    select format('%I.%I', table_schema, table_name) as fq from information_schema.tables
    where table_schema in ('ecosystem', 'ingest', 'identity', 'community', 'jobs') and table_type = 'BASE TABLE'`);
  if (!tables.length) return;
  await db.execute(sql.raw(`truncate ${tables.map((t) => t.fq).join(', ')} restart identity cascade`));
}

export async function resetAndSeed(db: Database, opts: { community?: boolean } = {}): Promise<void> {
  await truncateAll(db);
  await seedDatabase(db, opts);
}

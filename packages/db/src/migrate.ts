import { resolve } from 'node:path';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { createDatabase } from './client';
import { REPO_ROOT } from './env';

export const MIGRATIONS_DIR = resolve(REPO_ROOT, 'packages/db/migrations');

export async function runMigrations(url: string): Promise<void> {
  const { db, close } = createDatabase(url, { max: 1 });
  try {
    await migrate(db, { migrationsFolder: MIGRATIONS_DIR, migrationsSchema: 'drizzle' });
  } finally {
    await close();
  }
}

/** Drops every Mutinai schema (development/test only). */
export async function dropAll(url: string): Promise<void> {
  const { db, close } = createDatabase(url, { max: 1 });
  try {
    await db.execute(
      'drop schema if exists community, identity, ecosystem, ingest, jobs, drizzle cascade' as unknown as Parameters<typeof db.execute>[0],
    );
  } finally {
    await close();
  }
}

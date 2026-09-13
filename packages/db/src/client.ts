import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { sql } from 'drizzle-orm';
import postgres from 'postgres';
import { requireEnv } from './env';
import * as schema from './schema';

export type Database = PostgresJsDatabase<typeof schema>;
/** A database handle or an open transaction; query and mutation functions accept either. */
export type Executor = Database | Parameters<Parameters<Database['transaction']>[0]>[0];

export interface DatabaseHandle {
  db: Database;
  close: () => Promise<void>;
}

export function createDatabase(url: string, opts: { max?: number } = {}): DatabaseHandle {
  const sql = postgres(url, { max: opts.max ?? 10, onnotice: () => {} });
  const db = drizzle(sql, { schema, casing: 'snake_case' });
  return { db, close: () => sql.end({ timeout: 5 }) };
}

const globalForDb = globalThis as unknown as { __mutinaiDb?: DatabaseHandle };

/** Process-wide shared handle (survives Next.js dev hot reloads). */
export function getDb(): Database {
  if (!globalForDb.__mutinaiDb) globalForDb.__mutinaiDb = createDatabase(requireEnv('DATABASE_URL'));
  return globalForDb.__mutinaiDb.db;
}

/** Cheap connectivity check for health endpoints. */
export async function pingDatabase(db: Executor): Promise<void> {
  await db.execute(sql`select 1`);
}

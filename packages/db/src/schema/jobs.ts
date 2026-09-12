/**
 * Background job queue. See docs/adr/0003-postgres-job-queue.md.
 */
import { sql } from 'drizzle-orm';
import { index, integer, jsonb, pgSchema, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

export const jobs = pgSchema('jobs');

export const jobStatus = jobs.enum('job_status', ['pending', 'running', 'succeeded', 'failed', 'dead']);

export const job = jobs.table(
  'job',
  {
    id: uuid().primaryKey().defaultRandom(),
    queue: text().notNull().default('default'),
    kind: text().notNull(),
    payload: jsonb().$type<Record<string, unknown>>().notNull().default({}),
    status: jobStatus().notNull().default('pending'),
    /** Collapses duplicate pending/running work (e.g. repeated "entity changed" signals). */
    dedupeKey: text(),
    attempts: integer().notNull().default(0),
    maxAttempts: integer().notNull().default(5),
    runAfter: timestamp({ withTimezone: true }).notNull().defaultNow(),
    lockedAt: timestamp({ withTimezone: true }),
    lockedBy: text(),
    lastError: text(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp({ withTimezone: true }),
  },
  (t) => [
    uniqueIndex('job_active_dedupe_key').on(t.dedupeKey).where(sql`status in ('pending', 'running')`),
    index('job_claim_idx').on(t.queue, t.status, t.runAfter),
  ],
);

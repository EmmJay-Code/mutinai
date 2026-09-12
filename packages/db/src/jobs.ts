/**
 * Postgres job queue (docs/adr/0003-postgres-job-queue.md).
 * Enqueue inside the caller's transaction so emitted work commits atomically with the data change.
 */
import { sql } from 'drizzle-orm';
import type { Executor } from './client';

export interface EnqueueInput {
  kind: string;
  payload?: Record<string, unknown>;
  dedupeKey?: string;
  queue?: string;
  runAfter?: Date;
  maxAttempts?: number;
}

export interface ClaimedJob {
  id: string;
  kind: string;
  queue: string;
  payload: Record<string, unknown>;
  attempts: number;
  maxAttempts: number;
}

/** Returns true if a new job was created, false if an equivalent pending/running job already exists. */
export async function enqueueJob(db: Executor, input: EnqueueInput): Promise<boolean> {
  const rows = await db.execute<{ id: string }>(sql`
    insert into jobs.job (queue, kind, payload, dedupe_key, run_after, max_attempts)
    values (${input.queue ?? 'default'}, ${input.kind}, ${JSON.stringify(input.payload ?? {})}::jsonb,
            ${input.dedupeKey ?? null}, ${(input.runAfter ?? new Date()).toISOString()}, ${input.maxAttempts ?? 5})
    on conflict (dedupe_key) where status in ('pending', 'running') do nothing
    returning id`);
  return rows.length > 0;
}

export async function claimJobs(db: Executor, opts: { workerId: string; queue?: string; limit?: number }): Promise<ClaimedJob[]> {
  const rows = await db.execute<{ id: string; kind: string; queue: string; payload: Record<string, unknown>; attempts: number; max_attempts: number }>(sql`
    update jobs.job set status = 'running', locked_at = now(), locked_by = ${opts.workerId}, attempts = attempts + 1
    where id in (
      select id from jobs.job
      where queue = ${opts.queue ?? 'default'} and status = 'pending' and run_after <= now()
      order by run_after, created_at
      limit ${opts.limit ?? 10}
      for update skip locked
    )
    returning id, kind, queue, payload, attempts, max_attempts`);
  return rows.map((r) => ({ id: r.id, kind: r.kind, queue: r.queue, payload: r.payload, attempts: r.attempts, maxAttempts: r.max_attempts }));
}

export async function completeJob(db: Executor, id: string): Promise<void> {
  await db.execute(sql`update jobs.job set status = 'succeeded', finished_at = now(), locked_at = null where id = ${id}`);
}

/** Retries with exponential backoff until max attempts, then marks the job dead. */
export async function failJob(db: Executor, job: Pick<ClaimedJob, 'id' | 'attempts' | 'maxAttempts'>, error: unknown): Promise<void> {
  const message = error instanceof Error ? `${error.message}\n${error.stack ?? ''}`.slice(0, 4000) : String(error);
  const dead = job.attempts >= job.maxAttempts;
  const backoffSeconds = Math.min(3600, 2 ** job.attempts * 5);
  await db.execute(sql`
    update jobs.job set
      status = ${dead ? 'dead' : 'pending'}::jobs.job_status,
      last_error = ${message},
      locked_at = null, locked_by = null,
      run_after = now() + make_interval(secs => ${backoffSeconds}),
      finished_at = ${dead ? sql`now()` : sql`null`}
    where id = ${job.id}`);
}

/** Returns jobs stuck in `running` (crashed worker) to `pending`. */
export async function releaseStaleJobs(db: Executor, olderThanSeconds = 900): Promise<number> {
  const rows = await db.execute(sql`
    update jobs.job set status = 'pending', locked_at = null, locked_by = null
    where status = 'running' and locked_at < now() - make_interval(secs => ${olderThanSeconds})
    returning id`);
  return rows.length;
}

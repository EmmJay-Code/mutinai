import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { createTestDatabase, truncateAll } from '../src/testing';
import { claimJobs, completeJob, enqueueJob, failJob, releaseStaleJobs } from '../src/jobs';
import type { DatabaseHandle } from '../src/client';

let h: DatabaseHandle;
beforeAll(() => {
  h = createTestDatabase();
});
beforeEach(() => truncateAll(h.db));
afterAll(() => h.close());

describe('job queue', () => {
  it('deduplicates pending work but allows re-enqueue after completion', async () => {
    expect(await enqueueJob(h.db, { kind: 'search.reindex_entity', dedupeKey: 'search:1' })).toBe(true);
    expect(await enqueueJob(h.db, { kind: 'search.reindex_entity', dedupeKey: 'search:1' })).toBe(false);
    const [job] = await claimJobs(h.db, { workerId: 'w1' });
    expect(await enqueueJob(h.db, { kind: 'search.reindex_entity', dedupeKey: 'search:1' })).toBe(false); // still running
    await completeJob(h.db, job!.id);
    expect(await enqueueJob(h.db, { kind: 'search.reindex_entity', dedupeKey: 'search:1' })).toBe(true);
  });

  it('concurrent claims never hand out the same job', async () => {
    for (let i = 0; i < 20; i++) await enqueueJob(h.db, { kind: 'noop', payload: { i } });
    const [a, b] = await Promise.all([claimJobs(h.db, { workerId: 'a', limit: 15 }), claimJobs(h.db, { workerId: 'b', limit: 15 })]);
    const ids = [...a!, ...b!].map((j) => j.id);
    expect(ids).toHaveLength(20);
    expect(new Set(ids).size).toBe(20);
  });

  it('retries with backoff, then marks dead after max attempts', async () => {
    await enqueueJob(h.db, { kind: 'flaky', maxAttempts: 2 });
    let [job] = await claimJobs(h.db, { workerId: 'w' });
    await failJob(h.db, job!, new Error('boom'));
    expect(await claimJobs(h.db, { workerId: 'w' })).toHaveLength(0); // backoff
    await h.db.execute(sql`update jobs.job set run_after = now()`);
    [job] = await claimJobs(h.db, { workerId: 'w' });
    expect(job!.attempts).toBe(2);
    await failJob(h.db, job!, new Error('boom again'));
    const [row] = await h.db.execute<{ status: string; last_error: string }>(sql`select status, last_error from jobs.job`);
    expect(row!.status).toBe('dead');
    expect(row!.last_error).toContain('boom again');
  });

  it('releases jobs held by crashed workers', async () => {
    await enqueueJob(h.db, { kind: 'x' });
    await claimJobs(h.db, { workerId: 'crashed' });
    await h.db.execute(sql`update jobs.job set locked_at = now() - interval '1 hour'`);
    expect(await releaseStaleJobs(h.db, 60)).toBe(1);
    expect(await claimJobs(h.db, { workerId: 'w' })).toHaveLength(1);
  });
});

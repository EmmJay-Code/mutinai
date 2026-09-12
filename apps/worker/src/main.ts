/**
 * Mutinai worker: ingestion runs and background jobs. Scales independently of the web tier.
 *
 *   npm run worker -- ingest <adapter|all>
 *   npm run worker -- work [--once]
 *   npm run worker -- status
 */
import { hostname } from 'node:os';
import { resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { createDatabase, jobs, REPO_ROOT, requireEnv } from '@mutinai/db';
import { ADAPTERS, FileSystemObjectStore, runAdapter } from '@mutinai/ingestion';
import { sql } from 'drizzle-orm';
import { handlers } from './handlers';

const log = (msg: string) => console.log(`${new Date().toISOString()} ${msg}`);
const { db, close } = createDatabase(requireEnv('DATABASE_URL'), { max: 4 });
const store = new FileSystemObjectStore(resolve(REPO_ROOT, process.env.OBJECT_STORE_DIR ?? '.data/objects'));

async function ingest(name: string) {
  const names = name === 'all' ? Object.keys(ADAPTERS) : [name];
  for (const n of names) {
    const factory = ADAPTERS[n];
    if (!factory) throw new Error(`unknown adapter "${n}". Available: ${Object.keys(ADAPTERS).join(', ')}`);
    const { runId, stats } = await runAdapter({ db, store, log }, factory());
    log(`run ${runId} ${n}: ${JSON.stringify(stats)}`);
  }
}

async function work(once: boolean) {
  const workerId = `${hostname()}:${process.pid}`;
  let stopping = false;
  process.on('SIGINT', () => (stopping = true));
  process.on('SIGTERM', () => (stopping = true));
  log(`worker ${workerId} started`);
  while (!stopping) {
    await jobs.releaseStaleJobs(db);
    const claimed = await jobs.claimJobs(db, { workerId, limit: 20 });
    for (const job of claimed) {
      const handler = handlers[job.kind];
      try {
        if (!handler) throw new Error(`no handler for job kind ${job.kind}`);
        await handler(db, job.payload, log);
        await jobs.completeJob(db, job.id);
      } catch (error) {
        log(`job ${job.id} (${job.kind}) failed: ${String(error)}`);
        await jobs.failJob(db, job, error);
      }
    }
    if (claimed.length) log(`processed ${claimed.length} job(s)`);
    else if (once) break;
    else await sleep(2000);
  }
}

async function status() {
  const rows = await db.execute<{ kind: string; status: string; n: number }>(sql`select kind, status::text, count(*)::int as n from jobs.job group by 1, 2 order by 1, 2`);
  const runs = await db.execute(sql`
    select s.key, r.status, r.started_at, r.stats from ingest.ingestion_run r join ingest.source s on s.id = r.source_id order by r.started_at desc limit 10`);
  console.table(rows);
  console.table(runs);
}

const [command, arg] = process.argv.slice(2);
try {
  if (command === 'ingest') await ingest(arg ?? 'all');
  else if (command === 'work') await work(process.argv.includes('--once'));
  else if (command === 'status') await status();
  else {
    console.log('usage: worker ingest <adapter|all> | work [--once] | status');
    process.exitCode = 1;
  }
} finally {
  await close();
}

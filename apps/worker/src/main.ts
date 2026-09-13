/**
 * Mutinai worker: ingestion runs and background jobs. Scales independently of the web tier.
 *
 *   npm run worker -- ingest <adapter|all>
 *   npm run worker -- work [--once]
 *   npm run worker -- status
 *   npm run worker -- bootstrap      (deploy step: migrate, seed once, ingest fixtures, drain jobs)
 */
import { hostname } from 'node:os';
import { resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { createDatabase, FIXTURE_SOURCE_KEY, jobs, REPO_ROOT, requireEnv, runMigrations, schema, seedDatabase } from '@mutinai/db';
import { ADAPTERS, FileSystemObjectStore, runAdapter } from '@mutinai/ingestion';
import { eq, sql } from 'drizzle-orm';
import { handlers } from './handlers';

const log = (msg: string) => console.log(`${new Date().toISOString()} ${msg}`);
const databaseUrl = requireEnv('DATABASE_URL');
const { db, close } = createDatabase(databaseUrl, { max: 4 });
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

/**
 * Brings a database to the demo dataset and is safe to repeat on every deploy: migrations are tracked, the seed
 * runs only when the fixture source is absent, and fixture ingestion is content-addressed so unchanged items are
 * no-ops. Raw snapshots go to OBJECT_STORE_DIR, which may be ephemeral: fixtures are reproducible from the repo.
 */
async function bootstrap() {
  await runMigrations(databaseUrl);
  log('migrations applied');
  const [seeded] = await db.select({ id: schema.source.id }).from(schema.source).where(eq(schema.source.key, FIXTURE_SOURCE_KEY));
  if (seeded) log('fixture catalog already seeded; skipping seed');
  else {
    await seedDatabase(db);
    log('seeded fixture catalog and demo community');
  }
  await ingest('all');
  await work(true);
  log('bootstrap complete');
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
  else if (command === 'bootstrap') await bootstrap();
  else {
    console.log('usage: worker ingest <adapter|all> | work [--once] | status | bootstrap');
    process.exitCode = 1;
  }
} finally {
  await close();
}

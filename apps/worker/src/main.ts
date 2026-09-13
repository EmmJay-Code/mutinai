/**
 * Mutinai worker: ingestion runs, background jobs and the editorial review queue. Scales independently of the web tier.
 *
 *   npm run worker -- ingest <source|fixtures> [--limit N] [--since 7d|36h|ISO|last-run] [--dry-run]
 *                    [--repos org/a,org/b] [--authors org,…] [--known] [--derivatives] [--recheck-unresolved] [--feeds key,…]
 *   npm run worker -- scheduled                  (cron entrypoint: enabled live sources since last run, then jobs)
 *   npm run worker -- work [--once]
 *   npm run worker -- review list [--source key] [--reason code] [--status open|all] [--limit N]
 *   npm run worker -- review show <id>
 *   npm run worker -- review dismiss <id> [--note text]
 *   npm run worker -- review link <id> <kind>:<slug>
 *   npm run worker -- status
 *   npm run worker -- bootstrap                  (deploy step: migrate, seed once, ingest fixtures, drain jobs)
 *
 * Sources: fixture-huggingface, fixture-github, fixture-rss (offline fixtures); huggingface, github, feeds (live).
 * See docs/live-ingestion.md.
 */
import { readFileSync } from 'node:fs';
import { hostname } from 'node:os';
import { resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { createDatabase, FIXTURE_SOURCE_KEY, jobs, linkExternalId, REPO_ROOT, requireEnv, runMigrations, schema, seedDatabase } from '@mutinai/db';
import {
  ADAPTERS,
  createFeedAdapter,
  createGitHubAdapter,
  createHuggingFaceAdapter,
  DEFAULT_USER_AGENT,
  dryRunAdapter,
  FileSystemObjectStore,
  GITHUB_API_HEADERS,
  HttpClient,
  IngestionBusyError,
  RateLimitError,
  REVIEW_REASONS,
  type FeedConfig,
  runAdapter,
  type SourceAdapter,
} from '@mutinai/ingestion';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { lastRunSince, linkTarget, namespaceForSource, parseCommand, parseSince, type IngestFlags } from './cli';
import { handlers } from './handlers';

const log = (msg: string) => console.log(`${new Date().toISOString()} ${msg}`);
const databaseUrl = requireEnv('DATABASE_URL');
const { db, close } = createDatabase(databaseUrl, { max: 4 });
const store = new FileSystemObjectStore(resolve(REPO_ROOT, process.env.OBJECT_STORE_DIR ?? '.data/objects'));

const LIVE_SOURCES = ['huggingface', 'github', 'feeds'] as const;
type LiveSource = (typeof LIVE_SOURCES)[number];
const hfWatchlist = JSON.parse(readFileSync(new URL('../sources/huggingface.json', import.meta.url), 'utf8')) as {
  authors: string[];
  derivatives: { relations: string[]; perVariant: number };
};

const feedWatchlist = JSON.parse(readFileSync(new URL('../sources/feeds.json', import.meta.url), 'utf8')) as { feeds: FeedConfig[] };

const NO_FLAGS: IngestFlags = { dryRun: false, known: false, derivatives: false, recheckUnresolved: false };

// ─── Sources ─────────────────────────────────────────────────────────────────

async function knownVariantRepos(): Promise<string[]> {
  const rows = await db.execute<{ value: string }>(sql`
    select x.value from ingest.external_identifier x join ecosystem.entity e on e.id = x.entity_id
    where x.namespace = 'huggingface' and e.kind = 'model_variant' order by x.value`);
  return rows.map((r) => r.value);
}

async function knownProjectRepos(): Promise<string[]> {
  const rows = await db.execute<{ value: string }>(sql`
    select x.value from ingest.external_identifier x join ecosystem.entity e on e.id = x.entity_id
    where x.namespace = 'github' and e.kind = 'project' order by x.value`);
  return rows.map((r) => r.value);
}

/** External ids whose most recently seen snapshot is still unresolved (re-fetched so blocked items can apply). */
async function unresolvedExternalIds(sourceKey: string): Promise<string[]> {
  const rows = await db.execute<{ external_id: string }>(sql`
    select external_id from (
      select distinct on (sr.external_id) sr.external_id, sr.status from ingest.source_record sr
      join ingest.source s on s.id = sr.source_id where s.key = ${sourceKey}
      order by sr.external_id, sr.last_seen_at desc
    ) latest where status = 'unresolved' order by external_id`);
  return rows.map((r) => r.external_id);
}

async function buildAdapter(name: string, flags: IngestFlags): Promise<SourceAdapter> {
  const selecting = Boolean(flags.repos || flags.authors || flags.known || flags.derivatives || flags.recheckUnresolved || flags.feeds);
  const fixture = ADAPTERS[name];
  if (fixture) {
    if (selecting) throw new Error(`${name} is a fixture source; selection flags apply to live sources only`);
    return fixture();
  }
  if (name === 'huggingface') {
    const token = process.env.HUGGINGFACE_TOKEN || process.env.HF_TOKEN || undefined;
    const client = new HttpClient({ token, log, userAgent: process.env.MUTINAI_USER_AGENT || DEFAULT_USER_AGENT });
    const repos = new Set(flags.repos ?? []);
    if (flags.known) for (const id of await knownVariantRepos()) repos.add(id);
    if (flags.recheckUnresolved) for (const id of await unresolvedExternalIds('huggingface')) repos.add(id);
    log(`huggingface: ${token ? 'authenticated' : 'anonymous (500 requests / 5 min)'}; ${repos.size} explicit repo(s)`);
    return createHuggingFaceAdapter({
      client,
      repos: [...repos],
      // With no explicit selection, the curated watchlist applies: first-party authors plus derivatives of known variants.
      authors: flags.authors ?? (selecting ? [] : hfWatchlist.authors),
      derivatives: flags.derivatives || !selecting ? { bases: await knownVariantRepos(), relations: hfWatchlist.derivatives.relations, perBase: hfWatchlist.derivatives.perVariant } : undefined,
    });
  }
  if (name === 'github') {
    if (flags.authors || flags.derivatives) throw new Error('--authors and --derivatives apply to huggingface only');
    const token = process.env.GITHUB_TOKEN || undefined;
    const client = new HttpClient({ token, log, userAgent: process.env.MUTINAI_USER_AGENT || DEFAULT_USER_AGENT, headers: GITHUB_API_HEADERS });
    const repos = new Set((flags.repos ?? []).map((r) => r.toLowerCase()));
    // Known projects are the default selection: GitHub is never crawled for discovery.
    if (flags.known || !flags.repos) for (const id of await knownProjectRepos()) repos.add(id);
    if (flags.recheckUnresolved) for (const id of await unresolvedExternalIds('github')) repos.add(id);
    log(`github: ${token ? 'authenticated (5,000 requests/hour)' : 'anonymous (60 requests/hour)'}; ${repos.size} repositories`);
    return createGitHubAdapter({ client, repos: [...repos] });
  }
  if (name === 'feeds') {
    if (flags.repos || flags.authors || flags.derivatives || flags.known) throw new Error('feeds accepts --feeds key,… to select feeds');
    const unknown = (flags.feeds ?? []).filter((k) => !feedWatchlist.feeds.some((f) => f.key === k));
    if (unknown.length) throw new Error(`unknown feeds: ${unknown.join(', ')} (configured: ${feedWatchlist.feeds.map((f) => f.key).join(', ')})`);
    const feeds = flags.feeds ? feedWatchlist.feeds.filter((f) => flags.feeds!.includes(f.key)) : feedWatchlist.feeds;
    const client = new HttpClient({ log, userAgent: process.env.MUTINAI_USER_AGENT || DEFAULT_USER_AGENT });
    log(`feeds: ${feeds.length} configured feed(s), conditional requests`);
    return createFeedAdapter({ client, feeds });
  }
  throw new Error(`unknown source "${name}". Fixture: ${Object.keys(ADAPTERS).join(', ')}. Live: ${LIVE_SOURCES.join(', ')}`);
}

async function resolveSince(sourceKey: string, value: string | undefined): Promise<Date | undefined> {
  if (!value) return undefined;
  const parsed = parseSince(value);
  if (parsed) return parsed;
  const [row] = await db.execute<{ started_at: Date | null }>(sql`
    select max(r.started_at) as started_at from ingest.ingestion_run r join ingest.source s on s.id = r.source_id
    where s.key = ${sourceKey} and r.status = 'succeeded'`);
  const last = row?.started_at ? new Date(row.started_at) : null;
  const since = lastRunSince(last);
  log(`${sourceKey}: since ${since.toISOString()} (${last ? 'last successful run, minus overlap' : 'no previous run; first-run window'})`);
  return since;
}

// ─── Commands ────────────────────────────────────────────────────────────────

async function ingest(name: string, flags: IngestFlags) {
  const names = name === 'all' || name === 'fixtures' ? Object.keys(ADAPTERS) : [name];
  for (const n of names) {
    const adapter = await buildAdapter(n, flags);
    const since = await resolveSince(adapter.source.key, flags.since);
    const ctx = { since, limit: flags.limit };
    const options = { command: 'ingest', source: n, ...flags, since: since?.toISOString() };
    const { runId, stats } = flags.dryRun
      ? await dryRunAdapter({ db, store, log }, adapter, ctx, { options })
      : await runAdapter({ db, store, log }, adapter, ctx, { options });
    log(`${flags.dryRun ? 'DRY RUN (rolled back, nothing stored) ' : ''}run ${runId} ${n}: ${JSON.stringify(stats)}`);
  }
}

/** Cron entrypoint. Each enabled live source runs independently; one failing source does not stop the others. */
async function scheduled() {
  const enabled = (process.env.MUTINAI_LIVE_SOURCES ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  if (!enabled.length) {
    log('MUTINAI_LIVE_SOURCES is empty: no live sources enabled, nothing to ingest');
    return;
  }
  const unknown = enabled.filter((s) => !(LIVE_SOURCES as readonly string[]).includes(s));
  if (unknown.length) throw new Error(`MUTINAI_LIVE_SOURCES contains unknown sources: ${unknown.join(', ')} (live sources: ${LIVE_SOURCES.join(', ')})`);
  const limit = Number(process.env.MUTINAI_INGEST_LIMIT || 300);
  const defaults: Record<LiveSource, Partial<IngestFlags>> = {
    huggingface: { authors: hfWatchlist.authors, derivatives: true, recheckUnresolved: true },
    github: { known: true },
    feeds: {},
  };
  let failures = 0;
  for (const source of enabled) {
    try {
      await ingest(source, { ...NO_FLAGS, since: 'last-run', limit, ...defaults[source as LiveSource] });
    } catch (error) {
      if (error instanceof IngestionBusyError) log(`${source}: skipped (${error.message})`);
      else {
        failures += 1;
        log(`${source}: FAILED ${error instanceof RateLimitError ? '(rate limited) ' : ''}${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }
  await work(true);
  if (failures) process.exitCode = 1;
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

async function review(sub: string | undefined, args: string[], opts: { source?: string; reason?: string; status?: string; note?: string; limit?: number }) {
  const r = schema.reviewItem;
  if (sub === 'list' || !sub) {
    const where = [];
    if (opts.status !== 'all') where.push(inArray(r.status, [(opts.status ?? 'open') as 'open']));
    if (opts.reason) where.push(eq(r.reason, opts.reason));
    if (opts.source) where.push(eq(schema.source.key, opts.source));
    const rows = await db
      .select({ id: r.id, source: schema.source.key, item: r.externalId, reason: r.reason, subject: r.subject, blocking: r.blocking, status: r.status, updated: r.updatedAt, candidates: r.candidates })
      .from(r)
      .innerJoin(schema.source, eq(schema.source.id, r.sourceId))
      .where(and(...where))
      .orderBy(desc(r.blocking), r.reason, r.externalId)
      .limit(opts.limit ?? 50);
    console.table(rows.map((x) => ({ ...x, blocking: x.blocking === 1, candidates: x.candidates.map((c) => c.slug).join(', '), updated: x.updated.toISOString().slice(0, 16) })));
    const totals = await db.execute<{ reason: string; open: number }>(sql`select reason, count(*)::int as open from ingest.review_item where status = 'open' group by reason order by 2 desc`);
    console.log('open by reason:', Object.fromEntries(totals.map((t) => [t.reason, t.open])));
    return;
  }
  const id = args[0];
  if (!id) throw new Error(`review ${sub} needs a review item id`);
  const [item] = await db.select().from(r).where(eq(r.id, id));
  if (!item) throw new Error(`no review item ${id}`);
  const [source] = await db.select().from(schema.source).where(eq(schema.source.id, item.sourceId));
  if (sub === 'show') {
    console.log(JSON.stringify({ ...item, source: source!.key, reasonMeaning: REVIEW_REASONS[item.reason as keyof typeof REVIEW_REASONS] }, null, 2));
  } else if (sub === 'dismiss') {
    await db.update(r).set({ status: 'dismissed', resolution: opts.note ?? 'dismissed by editor', resolvedAt: new Date(), updatedAt: new Date() }).where(eq(r.id, id));
    log(`dismissed ${id}`);
  } else if (sub === 'link') {
    const [kind, slug] = (args[1] ?? '').split(':');
    const target = linkTarget(item);
    const namespace = namespaceForSource(source!);
    if (!target || !namespace) throw new Error(`review items with reason ${item.reason} from ${source!.key} cannot be resolved by linking`);
    if (!kind || !slug) throw new Error('usage: review link <id> <kind>:<slug>');
    if (!target.kinds.includes(kind)) throw new Error(`${item.reason} links to ${target.kinds.join(' or ')}, not ${kind}`);
    const [entity] = await db.select({ id: schema.entity.id }).from(schema.entity).where(and(eq(schema.entity.kind, kind as 'model_variant'), eq(schema.entity.slug, slug)));
    if (!entity) throw new Error(`no ${kind} with slug ${slug}`);
    const [mapped] = await db.select({ entityId: schema.externalIdentifier.entityId }).from(schema.externalIdentifier).where(and(eq(schema.externalIdentifier.namespace, namespace), eq(schema.externalIdentifier.value, target.value)));
    if (mapped && mapped.entityId !== entity.id) throw new Error(`${namespace}:${target.value} is already mapped to another entity`);
    await linkExternalId(db, { namespace, value: target.value, entityId: entity.id });
    await db.update(r).set({ status: 'resolved', resolution: `linked ${namespace}:${target.value} → ${kind}:${slug}`, resolvedAt: new Date(), updatedAt: new Date() }).where(eq(r.id, id));
    log(`linked ${namespace}:${target.value} → ${kind}:${slug}. Blocked snapshots apply on the next run with --recheck-unresolved (or the scheduled run).`);
  } else {
    throw new Error(`unknown review subcommand "${sub}" (list, show, dismiss, link)`);
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
  await ingest('fixtures', NO_FLAGS);
  await work(true);
  log('bootstrap complete');
}

async function status() {
  const rows = await db.execute<{ kind: string; status: string; n: number }>(sql`select kind, status::text, count(*)::int as n from jobs.job group by 1, 2 order by 1, 2`);
  const runs = await db.execute(sql`
    select s.key, r.status, r.started_at, r.finished_at, r.stats->>'seen' as seen, r.stats->>'new' as new, r.stats->>'unresolved' as unresolved, r.error
    from ingest.ingestion_run r join ingest.source s on s.id = r.source_id order by r.started_at desc limit 10`);
  const reviews = await db.execute(sql`select reason, status::text, count(*)::int as n from ingest.review_item group by 1, 2 order by 1, 2`);
  console.table(rows);
  console.table(runs);
  console.table(reviews);
}

const parsed = parseCommand(process.argv.slice(2));
const [command, ...rest] = parsed.positionals;
try {
  if (command === 'ingest') await ingest(rest[0] ?? 'fixtures', parsed.ingest);
  else if (command === 'scheduled') await scheduled();
  else if (command === 'work') await work(parsed.once);
  else if (command === 'review') await review(rest[0], rest.slice(1), { source: parsed.source, reason: parsed.reason, status: parsed.status, note: parsed.note, limit: parsed.ingest.limit });
  else if (command === 'status') await status();
  else if (command === 'bootstrap') await bootstrap();
  else {
    console.log('usage: worker ingest <source> [options] | scheduled | work [--once] | review list|show|dismiss|link | status | bootstrap');
    process.exitCode = 1;
  }
} catch (error) {
  if (error instanceof IngestionBusyError || error instanceof RateLimitError) {
    log(error.message);
    process.exitCode = 2;
  } else throw error;
} finally {
  await close();
}

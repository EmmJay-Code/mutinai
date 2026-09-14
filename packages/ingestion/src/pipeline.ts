/**
 * Ingestion pipeline: fetch → snapshot → dedupe → normalize → resolve → upsert → provenance → review → emit.
 * Each raw item is processed in its own transaction and is idempotent. See docs/adr/0005 and docs/adr/0008.
 */
import { releaseTitle, slugify, type Capability, type RelationPredicate, type VariantKind } from '@mutinai/domain';
import {
  addAliases,
  createArtifact,
  createEntity,
  createVariant,
  developerOfModel,
  ensureSource,
  jobs,
  linkExternalId,
  normalizeAlias,
  OntologyError,
  schema as s,
  type Database,
  type Executor,
} from '@mutinai/db';
import type { ReviewCandidate } from '@mutinai/db/schema';
import { and, eq, inArray, notInArray, sql } from 'drizzle-orm';
import type {
  ArtifactSetRecord,
  EventRecord,
  FetchContext,
  HardwareDeviceRecord,
  Identifier,
  NormalizedRecord,
  OrganizationRef,
  ProjectRecord,
  RawItem,
  ReleaseInfo,
  SourceAdapter,
  UnsupportedRecord,
  ValidatorCache,
  VariantRecord,
} from './adapter';
import { canonicalJson, sha256 } from './hash';
import { MemoryObjectStore, type ObjectStore } from './object-store';
import { planFirstPartyRelease } from './promotion';

export interface PipelineDeps {
  db: Database;
  store: ObjectStore;
  log?: (message: string) => void;
}

export interface RunStats {
  seen: number;
  new: number;
  unchanged: number;
  /** Previously unresolved snapshots evaluated again because they were seen again. */
  rechecked: number;
  /** Rechecked snapshots that now apply cleanly. */
  resolved: number;
  /** New or rechecked items still blocked on review after this run. */
  unresolved: number;
  failed: number;
  entitiesCreated: number;
  fieldsUpdated: number;
  eventsCreated: number;
  eventsUpdated: number;
  jobsEnqueued: number;
  reviewItems: number;
  metrics: number;
}

/** Why an item needs an editor. Stable codes: they key review items and appear in tooling. */
export const REVIEW_REASONS = {
  new_first_party_model: 'New model with no declared parent weights that could not be added automatically; the detail lists the unmet rules',
  first_party_variant_kind: 'First-party weights whose variant kind (base, instruct, reasoning, …) is not stated; needs confirming',
  possible_reupload: 'Repeats the name of a known variant or of its declared base under another account; a re-upload, not a new variant',
  unknown_base: 'Declared parent weights are not a known variant',
  base_not_variant: 'Declared parent resolves to something other than a variant',
  merge_across_models: 'Merge of parents from different models',
  unknown_quantization: 'Quantized files with a scheme Mutinai does not know',
  unknown_project: 'Repository is not a known project; needs categorisation',
  unmapped_license: 'License identifier has no Mutinai license record',
  new_organization: 'Publisher account recorded from a source; not a recognized organization unless an editor promotes it',
  fact_conflict: 'Source-reported fact differs from the canonical value',
  unclassified_device: 'Hardware specifications for a device Mutinai does not track; needs its kind, memory kind and backends before it can be created',
  unsupported_repo: 'Published item Mutinai does not model (e.g. a LoRA adapter)',
  source_unavailable: 'Source no longer serves an item that was previously ingested',
  ontology_rejected: 'Rejected by ontology validation',
} as const;
export type ReviewReason = keyof typeof REVIEW_REASONS;

export interface ReviewRequest {
  reason: ReviewReason;
  subject?: string;
  detail: string;
  /** Blocking reviews leave the snapshot unresolved (re-evaluated when seen again). Default true. */
  blocking?: boolean;
  candidates?: ReviewCandidate[];
  suggestion?: Record<string, unknown>;
}

export interface ItemOutcome {
  status: 'processed' | 'unresolved' | 'unchanged' | 'failed' | 'rechecked' | 'resolved';
  details: string[];
  reviews: ReviewRequest[];
}

export class IngestionBusyError extends Error {}

interface ApplyContext {
  tx: Executor;
  sourceId: string;
  sourceKey: string;
  sourceRecordId: string;
  priority: number;
  touched: Map<string, 'variant' | 'artifact' | 'other'>;
  details: string[];
  unresolved: boolean;
  /** Shared across a snapshot's records (keyed by reason + subject). */
  reviews: Map<string, ReviewRequest>;
  stats: RunStats;
}

export const emptyStats = (): RunStats => ({
  seen: 0, new: 0, unchanged: 0, rechecked: 0, resolved: 0, unresolved: 0, failed: 0,
  entitiesCreated: 0, fieldsUpdated: 0, eventsCreated: 0, eventsUpdated: 0, jobsEnqueued: 0, reviewItems: 0, metrics: 0,
});

/** Licence identifiers used by sources (HF card metadata, SPDX) → Mutinai licence keys. Unmapped keys are reviewed, not guessed. */
const LICENSE_ALIASES: Record<string, string> = {
  'apache-2.0': 'apache-2.0',
  mit: 'mit',
  llama3: 'llama-3.1-community',
  'llama3.1': 'llama-3.1-community',
  'llama3.3': 'llama-3.3-community',
  gemma: 'gemma-terms',
};

/** Runs whose process died stay `running`; after this long they are marked abandoned so the source can run again. */
const ABANDON_AFTER_HOURS = 6;

export interface RunOptions {
  /** Recorded on the ingestion run for audit (CLI flags, selection). */
  options?: Record<string, unknown>;
}

export async function runAdapter(deps: PipelineDeps, adapter: SourceAdapter, ctx: FetchContext = {}, opts: RunOptions = {}): Promise<{ runId: string; stats: RunStats }> {
  const sourceId = await ensureSource(deps.db, {
    key: adapter.source.key,
    name: adapter.source.name,
    kind: adapter.source.kind,
    baseUrl: adapter.source.baseUrl,
    priority: adapter.source.priority,
  });
  await deps.db.execute(sql`
    update ingest.ingestion_run set status = 'abandoned', finished_at = now(), error = 'abandoned: still running after ${sql.raw(String(ABANDON_AFTER_HOURS))}h'
    where source_id = ${sourceId} and status = 'running' and started_at < now() - make_interval(hours => ${ABANDON_AFTER_HOURS})`);
  let runId: string;
  try {
    const [run] = await deps.db.insert(s.ingestionRun).values({ sourceId, options: opts.options ?? {} }).returning({ id: s.ingestionRun.id });
    runId = run!.id;
  } catch (error) {
    if (isUniqueViolation(error, 'ingestion_run_one_running')) throw new IngestionBusyError(`another ${adapter.source.key} ingestion is already running`);
    throw error;
  }

  const stats = emptyStats();
  const fetchCtx: FetchContext = { log: deps.log, validators: dbValidatorCache(deps.db, sourceId), ...ctx };
  try {
    for await (const item of adapter.fetch(fetchCtx)) {
      if (ctx.limit != null && stats.seen >= ctx.limit) break;
      stats.seen += 1;
      const outcome = await processItem(deps, adapter, sourceId, runId, item, stats);
      if (outcome.status === 'unchanged') stats.unchanged += 1;
      else if (outcome.status === 'failed') stats.failed += 1;
      else if (outcome.status === 'rechecked' || outcome.status === 'resolved') {
        stats.rechecked += 1;
        if (outcome.status === 'resolved') stats.resolved += 1;
        else stats.unresolved += 1;
      } else {
        stats.new += 1;
        if (outcome.status === 'unresolved') stats.unresolved += 1;
      }
      await recordMetrics(deps.db, sourceId, item, stats);
      deps.log?.(`[${adapter.source.key}] ${item.externalId}: ${outcome.status}${outcome.details.length ? ` — ${outcome.details.join('; ')}` : ''}`);
    }
    await deps.db.update(s.ingestionRun).set({ status: 'succeeded', finishedAt: new Date(), stats: { ...stats } }).where(eq(s.ingestionRun.id, runId));
  } catch (error) {
    await deps.db
      .update(s.ingestionRun)
      .set({ status: 'failed', finishedAt: new Date(), stats: { ...stats }, error: String(error).slice(0, 4000) })
      .where(eq(s.ingestionRun.id, runId));
    throw error;
  }
  return { runId, stats };
}

class DryRunRollback extends Error {
  constructor(readonly result: { runId: string; stats: RunStats }) {
    super('dry run');
  }
}

/**
 * Runs the full pipeline (resolution, review, jobs) inside one transaction and rolls it back, so the result shows
 * exactly what a real run would do without persisting anything. Raw snapshots go to a throwaway memory store.
 */
export async function dryRunAdapter(deps: PipelineDeps, adapter: SourceAdapter, ctx: FetchContext = {}, opts: RunOptions = {}) {
  try {
    await deps.db.transaction(async (tx) => {
      const result = await runAdapter({ ...deps, db: tx as unknown as Database, store: new MemoryObjectStore() }, adapter, ctx, { options: { ...opts.options, dryRun: true } });
      throw new DryRunRollback(result);
    });
  } catch (error) {
    if (error instanceof DryRunRollback) return error.result;
    throw error;
  }
  throw new Error('unreachable');
}

export async function processItem(deps: PipelineDeps, adapter: SourceAdapter, sourceId: string, runId: string | null, item: RawItem, stats = emptyStats()): Promise<ItemOutcome> {
  const body = canonicalJson(item.payload);
  const contentHash = sha256(body);
  const objectKey = `sources/${adapter.source.key}/${contentHash.slice(0, 2)}/${contentHash}.json`;
  // Content-addressed and idempotent, so it is safe outside the transaction.
  await deps.store.put(objectKey, new TextEncoder().encode(body), item.contentType);
  const snapshot = { sourceId, externalId: item.externalId, contentHash, objectKey, contentType: item.contentType, url: item.url, fetchedAt: item.fetchedAt, runId };

  let records: NormalizedRecord[];
  try {
    records = adapter.normalize(item);
  } catch (error) {
    const inserted = await deps.db
      .insert(s.sourceRecord)
      .values({ ...snapshot, status: 'failed', statusDetail: `normalize: ${String(error)}`.slice(0, 4000) })
      .onConflictDoNothing()
      .returning({ id: s.sourceRecord.id });
    if (!inserted.length) await touchSnapshot(deps.db, sourceId, item.externalId, contentHash);
    return inserted.length ? { status: 'failed', details: [String(error)], reviews: [] } : { status: 'unchanged', details: [], reviews: [] };
  }

  return deps.db.transaction(async (tx) => {
    let recordId: string;
    let recheck = false;
    const inserted = await tx.insert(s.sourceRecord).values({ ...snapshot, status: 'processed' }).onConflictDoNothing().returning({ id: s.sourceRecord.id });
    if (inserted.length) recordId = inserted[0]!.id;
    else {
      const existing = await touchSnapshot(tx, sourceId, item.externalId, contentHash);
      // Unchanged snapshots are skipped, except unresolved ones: what blocked them (an unknown base, a missing
      // scheme) may exist now, and re-evaluation is idempotent.
      if (existing?.status !== 'unresolved') return { status: 'unchanged' as const, details: [], reviews: [] };
      recordId = existing.id;
      recheck = true;
    }

    const ctx: ApplyContext = {
      tx,
      sourceId,
      sourceKey: adapter.source.key,
      sourceRecordId: recordId,
      priority: adapter.source.priority,
      touched: new Map(),
      details: [],
      unresolved: false,
      reviews: new Map(),
      stats,
    };

    for (const record of records) {
      // Each record runs in a savepoint with its own `touched` set, merged only if the savepoint commits,
      // so rolled-back work never emits downstream jobs.
      const recordCtx: ApplyContext = { ...ctx, touched: new Map(), unresolved: false };
      try {
        await tx.transaction(async (sp) => {
          recordCtx.tx = sp;
          await applyRecord(recordCtx, record);
        });
        for (const [id, kind] of recordCtx.touched) ctx.touched.set(id, kind);
        if (recordCtx.unresolved) ctx.unresolved = true;
      } catch (error) {
        if (!(error instanceof OntologyError)) throw error;
        raise(ctx, { reason: 'ontology_rejected', subject: 'identifier' in record ? record.identifier.value : '', detail: `rejected by ontology validation: ${error.message}` });
      }
    }

    for (const [entityId, kind] of ctx.touched) {
      const enqueue = async (kind_: string, key: string) => {
        if (await jobs.enqueueJob(tx, { kind: kind_, payload: { entityId }, dedupeKey: `${key}:${entityId}` })) stats.jobsEnqueued += 1;
      };
      await enqueue('search.reindex_entity', 'search.reindex');
      await enqueue('enrich.entity', 'enrich');
      if (kind !== 'other') await enqueue('compat.invalidate', 'compat.invalidate');
    }

    const status = ctx.unresolved ? 'unresolved' : 'processed';
    await tx
      .update(s.sourceRecord)
      .set({ status, statusDetail: ctx.details.length ? ctx.details.join('\n').slice(0, 4000) : null })
      .where(eq(s.sourceRecord.id, recordId));
    await syncReviewItems(tx, sourceId, item.externalId, recordId, [...ctx.reviews.values()], stats);
    const outcome: ItemOutcome['status'] = recheck ? (status === 'processed' ? 'resolved' : 'rechecked') : status;
    return { status: outcome, details: ctx.details, reviews: [...ctx.reviews.values()] };
  });
}

async function touchSnapshot(db: Executor, sourceId: string, externalId: string, contentHash: string) {
  const [row] = await db
    .update(s.sourceRecord)
    .set({ lastSeenAt: new Date() })
    .where(and(eq(s.sourceRecord.sourceId, sourceId), eq(s.sourceRecord.externalId, externalId), eq(s.sourceRecord.contentHash, contentHash)))
    .returning({ id: s.sourceRecord.id, status: s.sourceRecord.status });
  return row;
}

function raise(ctx: ApplyContext, review: ReviewRequest): void {
  const key = `${review.reason}|${review.subject ?? ''}`;
  ctx.reviews.set(key, review);
  ctx.details.push(review.detail);
  if (review.blocking ?? true) ctx.unresolved = true;
}

/**
 * Upserts the review items raised by the latest evaluation of an item and closes open ones it no longer raises.
 * Dismissed/resolved items stay closed when raised again (editors decided); superseded ones reopen.
 */
async function syncReviewItems(tx: Executor, sourceId: string, externalId: string, recordId: string, reviews: ReviewRequest[], stats: RunStats) {
  for (const r of reviews) {
    const values = {
      sourceId,
      externalId,
      reason: r.reason,
      subject: r.subject ?? '',
      detail: r.detail.slice(0, 4000),
      blocking: (r.blocking ?? true) ? 1 : 0,
      candidates: r.candidates ?? [],
      suggestion: r.suggestion ?? {},
      firstSourceRecordId: recordId,
      lastSourceRecordId: recordId,
    };
    await tx
      .insert(s.reviewItem)
      .values(values)
      .onConflictDoUpdate({
        target: [s.reviewItem.sourceId, s.reviewItem.externalId, s.reviewItem.reason, s.reviewItem.subject],
        set: {
          detail: values.detail,
          blocking: values.blocking,
          candidates: values.candidates,
          suggestion: values.suggestion,
          lastSourceRecordId: recordId,
          updatedAt: new Date(),
          status: sql`case when ${s.reviewItem.status} = 'superseded' then 'open'::ingest.review_status else ${s.reviewItem.status} end`,
          resolvedAt: sql`case when ${s.reviewItem.status} = 'superseded' then null else ${s.reviewItem.resolvedAt} end`,
        },
      });
    stats.reviewItems += 1;
  }
  const raisedKeys = reviews.map((r) => `${r.reason}|${r.subject ?? ''}`);
  await tx
    .update(s.reviewItem)
    .set({ status: 'superseded', resolution: 'no longer raised by the latest snapshot', resolvedAt: new Date(), updatedAt: new Date() })
    .where(
      and(
        eq(s.reviewItem.sourceId, sourceId),
        eq(s.reviewItem.externalId, externalId),
        eq(s.reviewItem.status, 'open'),
        raisedKeys.length ? notInArray(sql<string>`${s.reviewItem.reason} || '|' || ${s.reviewItem.subject}`, raisedKeys) : sql`true`,
      ),
    );
}

async function recordMetrics(db: Executor, sourceId: string, item: RawItem, stats: RunStats) {
  for (const m of item.metrics ?? []) {
    const entityId = await resolveIdentifier(db, m.identifier);
    if (!entityId) continue;
    const observedOn = item.fetchedAt.toISOString().slice(0, 10);
    for (const [metric, value] of Object.entries(m.values)) {
      if (!Number.isFinite(value)) continue;
      await db
        .insert(s.entityMetric)
        .values({ entityId, metric, sourceId, observedOn, value, observedAt: item.fetchedAt })
        .onConflictDoUpdate({ target: [s.entityMetric.entityId, s.entityMetric.metric, s.entityMetric.sourceId, s.entityMetric.observedOn], set: { value, observedAt: item.fetchedAt } });
      stats.metrics += 1;
    }
  }
}

function dbValidatorCache(db: Executor, sourceId: string): ValidatorCache {
  return {
    async get(url) {
      const [row] = await db.select({ etag: s.httpValidator.etag, lastModified: s.httpValidator.lastModified }).from(s.httpValidator).where(and(eq(s.httpValidator.sourceId, sourceId), eq(s.httpValidator.url, url)));
      return row ? { etag: row.etag ?? undefined, lastModified: row.lastModified ?? undefined } : null;
    },
    async set(url, v) {
      const values = { sourceId, url, etag: v.etag ?? null, lastModified: v.lastModified ?? null, updatedAt: new Date() };
      await db.insert(s.httpValidator).values(values).onConflictDoUpdate({ target: [s.httpValidator.sourceId, s.httpValidator.url], set: { etag: values.etag, lastModified: values.lastModified, updatedAt: values.updatedAt } });
    },
  };
}

function isUniqueViolation(error: unknown, constraint: string): boolean {
  const e = error as { code?: string; constraint_name?: string; cause?: { code?: string; constraint_name?: string } };
  const pg = e?.code ? e : e?.cause;
  return pg?.code === '23505' && (!pg.constraint_name || pg.constraint_name === constraint);
}

async function applyRecord(ctx: ApplyContext, record: NormalizedRecord): Promise<void> {
  switch (record.type) {
    case 'variant':
      return applyVariant(ctx, record);
    case 'artifact_set':
      return applyArtifactSet(ctx, record);
    case 'project':
      return applyProject(ctx, record);
    case 'event':
      return applyEvent(ctx, record);
    case 'hardware_device':
      return applyHardwareDevice(ctx, record);
    case 'unsupported':
      return applyUnsupported(ctx, record);
  }
}

// ─── Resolution ──────────────────────────────────────────────────────────────

async function resolveIdentifier(tx: Executor, id: Identifier): Promise<string | null> {
  const [row] = await tx
    .select({ entityId: s.externalIdentifier.entityId })
    .from(s.externalIdentifier)
    .where(and(eq(s.externalIdentifier.namespace, id.namespace), eq(s.externalIdentifier.value, id.value)));
  return row?.entityId ?? null;
}

/** Exact alias match restricted to kinds; returns null when absent or ambiguous. */
async function resolveAlias(tx: Executor, name: string, kinds: string[]): Promise<{ id: string; kind: string } | null> {
  const rows = await tx.execute<{ id: string; kind: string }>(sql`
    select distinct e.id, e.kind::text from ecosystem.entity_alias a join ecosystem.entity e on e.id = a.entity_id
    where a.normalized = ${normalizeAlias(name)} and e.kind::text in (${sql.join(kinds.map((k) => sql`${k}`), sql`, `)})`);
  return rows.length === 1 ? rows[0]! : null;
}

/** Plausible existing entities for an editor to consider: exact alias matches first, then name similarity. Never applied. */
async function findCandidates(tx: Executor, name: string, kinds: string[], limit = 5): Promise<ReviewCandidate[]> {
  const normalized = normalizeAlias(name);
  if (!normalized) return [];
  const rows = await tx.execute<{ id: string; kind: string; slug: string; name: string; exact: boolean; sim: number }>(sql`
    select e.id, e.kind::text as kind, e.slug, e.name,
      exists (select 1 from ecosystem.entity_alias a where a.entity_id = e.id and a.normalized = ${normalized}) as exact,
      similarity(e.name, ${name})::float8 as sim
    from ecosystem.entity e
    where e.kind::text in (${sql.join(kinds.map((k) => sql`${k}`), sql`, `)})
      and (e.name % ${name} or exists (select 1 from ecosystem.entity_alias a where a.entity_id = e.id and a.normalized = ${normalized}))
    order by exact desc, sim desc limit ${limit}`);
  return rows.map((r) => ({ entityId: r.id, kind: r.kind, slug: r.slug, name: r.name, basis: r.exact ? 'exact alias match' : `name similarity ${r.sim.toFixed(2)}` }));
}

const repoName = (id: Identifier) => id.value.split('/').pop() ?? id.value;
const repoOwner = (id: Identifier) => (id.value.includes('/') ? id.value.split('/')[0]!.toLowerCase() : '');

async function findOrganization(tx: Executor, ref: OrganizationRef): Promise<string | null> {
  if (ref.identifier) {
    const found = await resolveIdentifier(tx, ref.identifier);
    if (found) return found;
  }
  return (await resolveAlias(tx, ref.name, ['organization']))?.id ?? null;
}

async function resolveOrCreateOrganization(ctx: ApplyContext, ref: OrganizationRef): Promise<string> {
  let orgId = await findOrganization(ctx.tx, ref);
  if (!orgId) {
    let slug = slugify(ref.name);
    const [clash] = await ctx.tx.select({ id: s.entity.id }).from(s.entity).where(and(eq(s.entity.kind, 'organization'), eq(s.entity.slug, slug)));
    if (clash) slug = `${slug}-${ctx.sourceRecordId.slice(0, 6)}`;
    // A publisher account, kept for provenance. Not `recognized`: it stays off public organization surfaces.
    orgId = await createEntity(ctx.tx, { kind: 'organization', slug, name: ref.name });
    await ctx.tx.insert(s.organization).values({ id: orgId, orgKind: 'community', recognized: false });
    ctx.stats.entitiesCreated += 1;
    ctx.touched.set(orgId, 'other');
    raise(ctx, { reason: 'new_organization', subject: ref.name, blocking: false, detail: `recorded publisher account ${ref.name} (not a recognized organization)`, suggestion: { identifier: ref.identifier?.value } });
  }
  if (ref.identifier) await linkExternalId(ctx.tx, { ...ref.identifier, entityId: orgId, firstSeenRecordId: ctx.sourceRecordId });
  return orgId;
}

async function uniqueSlug(tx: Executor, kind: (typeof s.entityKind.enumValues)[number], base: string): Promise<string> {
  for (let i = 0; ; i++) {
    const slug = i === 0 ? base : `${base}-${i + 1}`;
    const [clash] = await tx.select({ id: s.entity.id }).from(s.entity).where(and(eq(s.entity.kind, kind), eq(s.entity.slug, slug)));
    if (!clash) return slug;
  }
}

// ─── Field assertions (provenance + source priority) ─────────────────────────

/**
 * Records that this source asserted `field = value` and applies it to the canonical row when no
 * higher-priority source currently owns the field. `apply` returns true if the canonical value changed.
 */
async function assertField(ctx: ApplyContext, entityId: string, field: string, value: unknown, apply: () => Promise<boolean>): Promise<void> {
  const [current] = await ctx.tx.execute<{ priority: number; value: unknown }>(sql`
    select src.priority, fa.value from ingest.field_assertion fa
    join ingest.source_record sr on sr.id = fa.source_record_id join ingest.source src on src.id = sr.source_id
    where fa.entity_id = ${entityId} and fa.field = ${field} and fa.applied = 1
    order by src.priority desc limit 1`);
  const wins = !current || current.priority <= ctx.priority;
  await ctx.tx
    .insert(s.fieldAssertion)
    // JSON null must be stored as a jsonb null, not SQL NULL.
    .values({ entityId, field, value: sql`${JSON.stringify(value ?? null)}::jsonb`, sourceRecordId: ctx.sourceRecordId, applied: 0, assertedAt: new Date() })
    .onConflictDoNothing();
  if (!wins) {
    ctx.details.push(`${field}: kept value from higher-priority source`);
    return;
  }
  await ctx.tx.execute(sql`update ingest.field_assertion set applied = 0 where entity_id = ${entityId} and field = ${field} and applied = 1`);
  await ctx.tx.execute(sql`update ingest.field_assertion set applied = 1 where entity_id = ${entityId} and field = ${field} and source_record_id = ${ctx.sourceRecordId}`);
  if (await apply()) {
    ctx.stats.fieldsUpdated += 1;
    await ctx.tx.update(s.entity).set({ updatedAt: new Date() }).where(eq(s.entity.id, entityId));
  }
}

/** Maps a source licence key. Absent → null; present but unmapped → null plus an advisory review (never guessed). */
async function licenseIdFor(ctx: ApplyContext, key: string | undefined): Promise<string | null> {
  if (!key) return null;
  const mapped = LICENSE_ALIASES[key.toLowerCase()];
  const [row] = mapped ? await ctx.tx.select({ id: s.license.id }).from(s.license).where(eq(s.license.key, mapped)) : [];
  if (!row) {
    raise(ctx, { reason: 'unmapped_license', subject: key.toLowerCase(), blocking: false, detail: `license "${key}" has no Mutinai license record` });
    return null;
  }
  return row.id;
}

// ─── Record handlers ─────────────────────────────────────────────────────────

const LINEAGE: Record<NonNullable<VariantRecord['derivation']>, RelationPredicate> = {
  fine_tune: 'fine_tuned_from',
  merge: 'merged_from',
  distill: 'distilled_from',
};

/** Relative difference above which a source-reported architecture fact is flagged against the canonical model. */
const FACT_TOLERANCE = 0.03;

async function checkObservedFacts(ctx: ApplyContext, variantId: string, r: VariantRecord) {
  const o = r.observed;
  if (!o) return;
  const [m] = await ctx.tx
    .select({ paramsTotal: s.model.paramsTotal, contextLength: s.model.contextLength, layers: s.model.layers, kvHeads: s.model.kvHeads })
    .from(s.modelVariant)
    .innerJoin(s.model, eq(s.model.id, s.modelVariant.modelId))
    .where(eq(s.modelVariant.id, variantId));
  if (!m) return;
  const conflicts: Record<string, { canonical: number; observed: number }> = {};
  if (o.paramsTotal && Math.abs(o.paramsTotal - m.paramsTotal) / m.paramsTotal > FACT_TOLERANCE) conflicts.paramsTotal = { canonical: m.paramsTotal, observed: o.paramsTotal };
  if (o.layers && o.layers !== m.layers) conflicts.layers = { canonical: m.layers, observed: o.layers };
  if (o.kvHeads && o.kvHeads !== m.kvHeads) conflicts.kvHeads = { canonical: m.kvHeads, observed: o.kvHeads };
  if (!Object.keys(conflicts).length) return;
  raise(ctx, {
    reason: 'fact_conflict',
    subject: Object.keys(conflicts).sort().join(','),
    blocking: false,
    detail: `source-reported ${Object.entries(conflicts).map(([k, v]) => `${k}=${v.observed} (canonical ${v.canonical})`).join(', ')}`,
    suggestion: { conflicts, note: 'Parameter totals from safetensors metadata include vision encoders and MTP layers; confirm before changing canonical data.' },
  });
}

async function applyVariant(ctx: ApplyContext, r: VariantRecord): Promise<void> {
  const existing = await resolveIdentifier(ctx.tx, r.identifier);
  if (existing) {
    const licenseId = await licenseIdFor(ctx, r.licenseKey);
    if (licenseId) {
      await assertField(ctx, existing, 'license', r.licenseKey, async () =>
        (await ctx.tx.update(s.modelVariant).set({ licenseId }).where(sql`${s.modelVariant.id} = ${existing} and ${s.modelVariant.licenseId} is distinct from ${licenseId}`).returning({ id: s.modelVariant.id })).length > 0,
      );
    }
    if (r.summary) {
      await assertField(ctx, existing, 'summary', r.summary, async () =>
        (await ctx.tx.update(s.entity).set({ summary: r.summary }).where(sql`${s.entity.id} = ${existing} and ${s.entity.summary} is distinct from ${r.summary}`).returning({ id: s.entity.id })).length > 0,
      );
    }
    await checkObservedFacts(ctx, existing, r);
    ctx.touched.set(existing, 'variant');
    return;
  }

  const bases = r.bases ?? [];
  const suggestion = { suggestedKind: r.suggestedKind, licenseKey: r.licenseKey, releasedOn: r.releasedOn, observed: r.observed, publisher: r.publisher.identifier?.value ?? r.publisher.name };
  if (!bases.length || !r.derivation) {
    const candidates = await findCandidates(ctx.tx, repoName(r.identifier), ['model_variant']);
    const exact = candidates.filter((c) => c.basis === 'exact alias match');
    const publisherId = await findOrganization(ctx.tx, r.publisher);
    if (exact.length) {
      const [pub] = await ctx.tx.select({ publisherOrgId: s.modelVariant.publisherOrgId }).from(s.modelVariant).where(eq(s.modelVariant.id, exact[0]!.entityId));
      if (pub && pub.publisherOrgId !== publisherId) {
        raise(ctx, { reason: 'possible_reupload', blocking: false, detail: `${r.identifier.value}: same name as known variant ${exact[0]!.slug} from another publisher; not created`, candidates: exact, suggestion });
        return;
      }
      // Same publisher, same name as a known variant under another repo id (e.g. a renamed repo): link it, never duplicate.
      raise(ctx, { reason: 'new_first_party_model', detail: `${r.identifier.value}: same name as known variant ${exact[0]!.slug} from the same publisher; link it instead of adding a model`, candidates: exact, suggestion });
      return;
    }
    await promoteFirstPartyRoot(ctx, r, candidates, suggestion);
    return;
  }

  // A derivative that repeats its base's repository name under another account re-uploads the base; it is not new weights.
  if (bases.length === 1 && normalizeAlias(repoName(r.identifier)) === normalizeAlias(repoName(bases[0]!)) && repoOwner(r.identifier) !== repoOwner(bases[0]!)) {
    raise(ctx, { reason: 'possible_reupload', subject: bases[0]!.value, blocking: false, detail: `${r.identifier.value}: repeats the name of its declared base ${bases[0]!.value}; a re-upload, not a new variant`, suggestion });
    return;
  }

  const parents: { identifier: Identifier; id: string; modelId: string; capabilities: Capability[] }[] = [];
  for (const base of bases) {
    const baseId = await resolveIdentifier(ctx.tx, base);
    if (!baseId) {
      raise(ctx, { reason: 'unknown_base', subject: base.value, detail: `${r.identifier.value}: base ${base.value} is not a known variant`, candidates: await findCandidates(ctx.tx, repoName(base), ['model_variant']), suggestion });
      continue;
    }
    const [row] = await ctx.tx.select({ modelId: s.modelVariant.modelId, capabilities: s.modelVariant.capabilities }).from(s.modelVariant).where(eq(s.modelVariant.id, baseId));
    if (!row) {
      raise(ctx, { reason: 'base_not_variant', subject: base.value, detail: `${r.identifier.value}: base ${base.value} resolves to a non-variant entity` });
      continue;
    }
    parents.push({ identifier: base, id: baseId, modelId: row.modelId, capabilities: row.capabilities });
  }
  if (parents.length !== bases.length) return;
  const modelIds = new Set(parents.map((p) => p.modelId));
  if (modelIds.size > 1) {
    raise(ctx, { reason: 'merge_across_models', detail: `${r.identifier.value}: parents belong to ${modelIds.size} different models`, suggestion: { parents: bases.map((b) => b.value) } });
    return;
  }
  const modelId = parents[0]!.modelId;

  // Post-trained weights published by the model's own developer are first-party variants (instruct, reasoning, …),
  // not community fine-tunes. Their kind cannot be read reliably from source metadata, so an editor confirms it.
  const existingPublisher = await findOrganization(ctx.tx, r.publisher);
  if (existingPublisher && existingPublisher === (await developerOfModel(ctx.tx, modelId))) {
    raise(ctx, {
      reason: 'first_party_variant_kind',
      detail: `${r.identifier.value}: first-party ${r.derivation} of ${bases[0]!.value}; variant kind needs confirming${r.suggestedKind ? ` (suggested: ${r.suggestedKind})` : ''}`,
      candidates: await findCandidates(ctx.tx, repoName(r.identifier), ['model_variant']),
      suggestion,
    });
    return;
  }

  const publisherOrgId = await resolveOrCreateOrganization(ctx, r.publisher);
  const id = await createVariant(ctx.tx, {
    slug: await uniqueSlug(ctx.tx, 'model_variant', slugify(r.name)),
    name: r.name,
    summary: r.summary ?? null,
    modelId,
    kind: r.derivation,
    publisherOrgId,
    licenseId: await licenseIdFor(ctx, r.licenseKey),
    capabilities: (r.capabilities as Capability[] | undefined) ?? parents[0]!.capabilities,
    releasedOn: r.releasedOn ?? null,
    lineage: parents.map((p) => ({ predicate: LINEAGE[r.derivation!], objectVariantId: p.id })),
    aliases: [r.identifier.value],
    sourceRecordId: ctx.sourceRecordId,
  });
  await linkExternalId(ctx.tx, { ...r.identifier, entityId: id, firstSeenRecordId: ctx.sourceRecordId });
  for (const [field, value] of Object.entries({ name: r.name, derivation: r.derivation, base: bases.map((b) => b.value).join(', '), license: r.licenseKey ?? null })) {
    await assertField(ctx, id, field, value, async () => false);
  }
  ctx.stats.entitiesCreated += 1;
  ctx.touched.set(id, 'variant');
}

/** Entities of `kind` named `name` (by alias) within `scope`. More than one means the catalog itself is ambiguous. */
async function findNamed(tx: Executor, kind: string, name: string, scope: ReturnType<typeof sql>): Promise<string[]> {
  const rows = await tx.execute<{ id: string }>(sql`
    select distinct e.id from ecosystem.entity e join ecosystem.entity_alias a on a.entity_id = e.id
    where e.kind::text = ${kind} and a.normalized = ${normalizeAlias(name)} and ${scope}`);
  return rows.map((row) => row.id);
}

/**
 * New first-party root weights (no declared parent). Adds release, model and variant when every promotion rule holds
 * (see promotion.ts), recording the evidence as field assertions on what it creates; otherwise raises a review with
 * the unmet rules. Re-evaluation is idempotent: existing releases and models are matched by name within their parent.
 */
async function promoteFirstPartyRoot(ctx: ApplyContext, r: VariantRecord, candidates: ReviewCandidate[], suggestion: Record<string, unknown>): Promise<void> {
  const developerId = r.publisher.identifier ? await resolveIdentifier(ctx.tx, r.publisher.identifier) : null;
  const families = developerId
    ? [...(await ctx.tx.execute<{ id: string; name: string }>(sql`
        select e.id, e.name from ecosystem.model_family f join ecosystem.entity e on e.id = f.id where f.developer_org_id = ${developerId} order by e.name`))]
    : [];
  const [developer] = developerId && families.length ? await ctx.tx.select({ name: s.entity.name }).from(s.entity).where(eq(s.entity.id, developerId)) : [];
  const { plan, failures, evidence } = planFirstPartyRelease({ repo: r.identifier.value, developerName: developer?.name ?? null, families, observed: r.observed, releasedOn: r.releasedOn });
  if (!plan || !developerId) {
    raise(ctx, {
      reason: 'new_first_party_model',
      detail: `${r.identifier.value}: not added automatically: ${failures.map((f) => f.detail).join('; ')}`,
      candidates,
      suggestion: { ...suggestion, promotion: { failed: failures, evidence } },
    });
    return;
  }
  const promotion = { rule: 'first_party_release', repo: r.identifier.value, evidence: plan.evidence };

  const releases = await findNamed(ctx.tx, 'model_release', plan.releaseName, sql`exists (select 1 from ecosystem.model_release x where x.id = e.id and x.family_id = ${plan.family.id})`);
  if (releases.length > 1) {
    raise(ctx, { reason: 'new_first_party_model', detail: `${r.identifier.value}: ${releases.length} releases named ${plan.releaseName} in ${plan.family.name}`, candidates, suggestion });
    return;
  }
  let releaseId = releases[0];
  if (!releaseId) {
    const slug = await uniqueSlug(ctx.tx, 'model_release', slugify(plan.releaseName));
    releaseId = await createEntity(ctx.tx, { kind: 'model_release', slug, name: plan.releaseName });
    await ctx.tx.insert(s.modelRelease).values({ id: releaseId, familyId: plan.family.id, releasedOn: plan.releasedOn, defaultLicenseId: await licenseIdFor(ctx, r.licenseKey) });
    await assertField(ctx, releaseId, 'auto_promotion', promotion, async () => false);
    ctx.stats.entitiesCreated += 1;
    ctx.touched.set(releaseId, 'other');
    // Dated by publication, never by ingestion.
    await createEvent(ctx, {
      dedupeKey: `${ctx.sourceKey}:release:${slug}`,
      kind: 'model_release',
      title: `${plan.releaseName} released`,
      summary: `${plan.modelName} weights published on Hugging Face by ${developer!.name}.`,
      occurredAt: `${plan.releasedOn}T00:00:00.000Z`,
      url: r.identifier.url,
      entityIds: [releaseId, developerId],
    });
    ctx.details.push(`added release ${plan.releaseName} to ${plan.family.name}`);
  }

  const models = await findNamed(ctx.tx, 'model', plan.modelName, sql`exists (select 1 from ecosystem.model x where x.id = e.id and x.release_id = ${releaseId})`);
  if (models.length > 1) {
    raise(ctx, { reason: 'new_first_party_model', detail: `${r.identifier.value}: ${models.length} models named ${plan.modelName} in ${plan.releaseName}`, candidates, suggestion });
    return;
  }
  let modelId = models[0];
  if (!modelId) {
    modelId = await createEntity(ctx.tx, { kind: 'model', slug: await uniqueSlug(ctx.tx, 'model', slugify(plan.modelName)), name: plan.modelName });
    await ctx.tx.insert(s.model).values({ id: modelId, releaseId, ...plan.model });
    await assertField(ctx, modelId, 'auto_promotion', promotion, async () => false);
    ctx.stats.entitiesCreated += 1;
    ctx.touched.set(modelId, 'other');
    ctx.details.push(`added model ${plan.modelName}`);
  }

  if (!plan.variantKind) {
    raise(ctx, {
      reason: 'first_party_variant_kind',
      detail: `${r.identifier.value}: ${plan.modelName} added from source facts; the repo name states no variant kind${r.suggestedKind ? ` (suggested: ${r.suggestedKind})` : ''}`,
      candidates,
      suggestion: { ...suggestion, model: plan.modelName, promotion: { evidence: plan.evidence } },
    });
    return;
  }
  const variantId = await createVariant(ctx.tx, {
    slug: await uniqueSlug(ctx.tx, 'model_variant', slugify(r.name)),
    name: r.name,
    summary: r.summary ?? null,
    modelId,
    kind: plan.variantKind,
    publisherOrgId: developerId,
    licenseId: await licenseIdFor(ctx, r.licenseKey),
    capabilities: plan.variantKind === 'base' ? [] : ((r.capabilities as Capability[] | undefined) ?? ['chat']),
    releasedOn: plan.releasedOn,
    aliases: [r.identifier.value],
    sourceRecordId: ctx.sourceRecordId,
  });
  await linkExternalId(ctx.tx, { ...r.identifier, entityId: variantId, firstSeenRecordId: ctx.sourceRecordId });
  await assertField(ctx, variantId, 'auto_promotion', promotion, async () => false);
  ctx.stats.entitiesCreated += 1;
  ctx.touched.set(variantId, 'variant');
  ctx.details.push(`added ${plan.variantKind} variant ${r.name}: ${plan.evidence.join('; ')}`);
}

async function applyArtifactSet(ctx: ApplyContext, r: ArtifactSetRecord): Promise<void> {
  const variantId = await resolveIdentifier(ctx.tx, r.base);
  if (!variantId) {
    raise(ctx, { reason: 'unknown_base', subject: r.base.value, detail: `${r.identifier.value}: base ${r.base.value} is not a known variant`, candidates: await findCandidates(ctx.tx, repoName(r.base), ['model_variant']) });
    return;
  }
  const [variant] = await ctx.tx
    .select({ name: s.entity.name, slug: s.entity.slug })
    .from(s.entity)
    .where(and(eq(s.entity.id, variantId), eq(s.entity.kind, 'model_variant')));
  if (!variant) {
    raise(ctx, { reason: 'base_not_variant', subject: r.base.value, detail: `${r.identifier.value}: base is not a variant` });
    return;
  }
  if (!r.files.length) {
    raise(ctx, { reason: 'unknown_quantization', detail: `${r.identifier.value}: no recognised quantized weight files` });
    return;
  }
  const publisherOrgId = await resolveOrCreateOrganization(ctx, r.publisher);
  const [publisher] = await ctx.tx.select({ name: s.entity.name, slug: s.entity.slug }).from(s.entity).where(eq(s.entity.id, publisherOrgId));

  for (const file of r.files) {
    const scheme = await resolveAlias(ctx.tx, file.schemeName, ['quantization_scheme']);
    if (!scheme) {
      raise(ctx, { reason: 'unknown_quantization', subject: file.schemeName, detail: `${file.fileName}: unknown quantization scheme ${file.schemeName}`, suggestion: { sizeBytes: file.sizeBytes } });
      continue;
    }
    const artifactIdentifier: Identifier = { namespace: 'huggingface-artifact', value: `${r.identifier.value}:${file.schemeName}`, url: r.identifier.url };
    let artifactId = await resolveIdentifier(ctx.tx, artifactIdentifier);
    if (!artifactId) {
      const [same] = await ctx.tx
        .select({ id: s.modelArtifact.id })
        .from(s.modelArtifact)
        .where(and(eq(s.modelArtifact.variantId, variantId), eq(s.modelArtifact.schemeId, scheme.id), eq(s.modelArtifact.publisherOrgId, publisherOrgId)));
      artifactId = same?.id ?? null;
    }
    if (!artifactId) {
      const [schemeEntity] = await ctx.tx.select({ slug: s.entity.slug, name: s.entity.name }).from(s.entity).where(eq(s.entity.id, scheme.id));
      try {
        artifactId = await ctx.tx.transaction(async (sp) =>
          createArtifact(sp, {
            slug: await uniqueSlug(sp, 'model_artifact', `${variant.slug}--${schemeEntity!.slug}--${publisher!.slug}`),
            name: `${variant.name} ${schemeEntity!.name} (${publisher!.name})`,
            variantId,
            schemeId: scheme.id,
            publisherOrgId,
            sizeBytes: file.sizeBytes,
            sourceRepo: r.identifier.value,
            aliases: [`${r.identifier.value}:${file.schemeName}`],
          }),
        );
      } catch (error) {
        if (!(error instanceof OntologyError)) throw error;
        raise(ctx, { reason: 'ontology_rejected', subject: file.fileName, detail: `${file.fileName}: ${error.message}` });
        continue;
      }
      ctx.stats.entitiesCreated += 1;
    }
    await linkExternalId(ctx.tx, { ...artifactIdentifier, entityId: artifactId, firstSeenRecordId: ctx.sourceRecordId });
    if (file.sizeBytes != null) {
      const id = artifactId;
      await assertField(ctx, id, 'sizeBytes', file.sizeBytes, async () =>
        (await ctx.tx.update(s.modelArtifact).set({ sizeBytes: file.sizeBytes }).where(sql`${s.modelArtifact.id} = ${id} and ${s.modelArtifact.sizeBytes} is distinct from ${file.sizeBytes}`).returning({ id: s.modelArtifact.id })).length > 0,
      );
    }
    ctx.touched.set(artifactId, 'artifact');
  }
}

async function applyProject(ctx: ApplyContext, r: ProjectRecord): Promise<void> {
  const projectId = await resolveIdentifier(ctx.tx, r.identifier);
  if (!projectId) {
    raise(ctx, { reason: 'unknown_project', detail: `${r.identifier.value}: unknown project; requires categorisation before import`, candidates: await findCandidates(ctx.tx, repoName(r.identifier), ['project']), suggestion: { ...r.fields } });
    return;
  }
  const updates: [string, unknown, () => Promise<boolean>][] = [];
  if (r.fields.summary !== undefined) {
    updates.push(['summary', r.fields.summary, async () =>
      (await ctx.tx.update(s.entity).set({ summary: r.fields.summary }).where(sql`${s.entity.id} = ${projectId} and ${s.entity.summary} is distinct from ${r.fields.summary}`).returning({ id: s.entity.id })).length > 0]);
  }
  if (r.fields.homepageUrl !== undefined) {
    updates.push(['homepageUrl', r.fields.homepageUrl, async () =>
      (await ctx.tx.update(s.project).set({ homepageUrl: r.fields.homepageUrl }).where(sql`${s.project.id} = ${projectId} and ${s.project.homepageUrl} is distinct from ${r.fields.homepageUrl ?? null}`).returning({ id: s.project.id })).length > 0]);
  }
  if (r.fields.primaryLanguage !== undefined) {
    updates.push(['primaryLanguage', r.fields.primaryLanguage, async () =>
      (await ctx.tx.update(s.project).set({ primaryLanguage: r.fields.primaryLanguage }).where(sql`${s.project.id} = ${projectId} and ${s.project.primaryLanguage} is distinct from ${r.fields.primaryLanguage ?? null}`).returning({ id: s.project.id })).length > 0]);
  }
  for (const [field, value, apply] of updates) await assertField(ctx, projectId, field, value, apply);
  ctx.touched.set(projectId, 'other');

  const releases = new Map<string, ReleaseInfo>();
  for (const release of [...(r.releases ?? []), ...(r.release ? [r.release] : [])]) if (!release.prerelease) releases.set(release.tag, release);
  if (!releases.size) return;
  const [project] = await ctx.tx.select({ name: s.entity.name }).from(s.entity).where(eq(s.entity.id, projectId));
  for (const release of releases.values()) {
    await createEvent(ctx, {
      dedupeKey: releaseDedupeKey(r.identifier, release.tag),
      kind: 'runtime_release',
      title: releaseTitle(project!.name, release.tag, release.title),
      summary: release.body?.split('\n').find((line) => line.trim())?.trim().slice(0, 280),
      occurredAt: release.publishedAt,
      url: release.url,
      entityIds: [projectId],
    });
  }
}

/** Shared by the GitHub API and GitHub release-feed adapters, so a release is one event whichever source saw it. */
export const releaseDedupeKey = (repo: Identifier, tag: string) => `${repo.namespace}:${repo.value}:release:${tag}`;

async function applyEvent(ctx: ApplyContext, r: EventRecord): Promise<void> {
  const entityIds: string[] = [];
  for (const id of r.identifiers ?? []) {
    const found = await resolveIdentifier(ctx.tx, id);
    if (found) entityIds.push(found);
  }
  for (const mention of r.mentions ?? []) {
    const found = await resolveAlias(ctx.tx, mention, ['model_release', 'model_family', 'model', 'model_variant', 'hardware_device', 'project', 'organization']);
    if (found) entityIds.push(found.id);
    else ctx.details.push(`mention "${mention}" not linked`);
  }
  let title = r.title;
  if (r.releaseTag && entityIds.length) {
    // Same title rule as the GitHub API adapter, so a release reads the same whichever source created it.
    const [project] = await ctx.tx.select({ name: s.entity.name }).from(s.entity).where(and(inArray(s.entity.id, entityIds), eq(s.entity.kind, 'project'))).limit(1);
    if (project) title = releaseTitle(project.name, r.releaseTag, r.title);
  }
  await createEvent(ctx, {
    dedupeKey: r.dedupeKey ?? `${ctx.sourceKey}:${r.url ?? r.title}`,
    kind: r.kind,
    title,
    summary: r.summary,
    occurredAt: r.occurredAt,
    url: r.url,
    entityIds: [...new Set(entityIds)],
  });
}

/**
 * Specifications a person read off a manufacturer's page.
 *
 * Only the fields the record carries are touched, each asserted separately so its provenance is the page this row
 * cites. Creating a device needs the editor's classification (what kind it is, how its memory works, what runs on
 * it) because no spec page states those in Mutinai's terms; without it the row waits in review rather than being
 * guessed into existence.
 */
async function applyHardwareDevice(ctx: ApplyContext, r: HardwareDeviceRecord): Promise<void> {
  let deviceId = await resolveIdentifier(ctx.tx, r.identifier);
  if (!deviceId) deviceId = (await resolveAlias(ctx.tx, r.name, ['hardware_device']))?.id ?? null;

  if (!deviceId) {
    if (!r.classification) {
      raise(ctx, {
        reason: 'unclassified_device',
        subject: r.name,
        detail: `${r.name}: not a tracked device; add device kind, memory kind and backends to create it`,
        candidates: await findCandidates(ctx.tx, r.name, ['hardware_device']),
        suggestion: { name: r.name, vendor: r.vendor.name, facts: Object.fromEntries(r.facts.map((f) => [f.field, f.value])) },
      });
      return;
    }
    const vendorId = await resolveOrCreateOrganization(ctx, r.vendor);
    const slug = await uniqueSlug(ctx.tx, 'hardware_device', r.identifier.value);
    deviceId = await createEntity(ctx.tx, { kind: 'hardware_device', slug, name: r.name });
    // The stated facts go in with the row: a dedicated-memory device is invalid without its memory size, so the
    // insert cannot be an empty shell filled in afterwards.
    const stated = Object.fromEntries(r.facts.map((f) => [f.field, f.value]));
    await ctx.tx.insert(s.hardwareDevice).values({
      id: deviceId,
      vendorOrgId: vendorId,
      deviceKind: r.classification.deviceKind,
      memoryKind: r.classification.memoryKind,
      backends: r.classification.backends,
      memoryGb: stated.memoryGb == null ? null : Number(stated.memoryGb),
      memoryType: stated.memoryType == null ? null : String(stated.memoryType),
      memoryBandwidthGbps: stated.memoryBandwidthGbps == null ? null : Number(stated.memoryBandwidthGbps),
      tdpWatts: stated.tdpWatts == null ? null : Number(stated.tdpWatts),
      releasedOn: stated.releasedOn == null ? null : String(stated.releasedOn),
      launchPriceUsd: stated.launchPriceUsd == null ? null : Number(stated.launchPriceUsd),
    });
    ctx.stats.entitiesCreated += 1;
  }

  // An existing device keeps its own memory model: a size asserted against a unified or RAM-only device would
  // describe the machine, not the chip, and the ontology rejects it.
  const [existing] = await ctx.tx.select({ memoryKind: s.hardwareDevice.memoryKind }).from(s.hardwareDevice).where(eq(s.hardwareDevice.id, deviceId));
  let facts = r.facts;
  if (existing && existing.memoryKind !== 'dedicated' && facts.some((f) => f.field === 'memoryGb')) {
    raise(ctx, { reason: 'fact_conflict', subject: r.name, blocking: false, detail: `${r.name}: memory size not applied — this device has ${existing.memoryKind} memory, which is sized by the system` });
    facts = facts.filter((f) => f.field !== 'memoryGb');
  }

  await linkExternalId(ctx.tx, { ...r.identifier, entityId: deviceId, firstSeenRecordId: ctx.sourceRecordId });

  const columns: Record<string, (value: string | number) => Promise<boolean>> = {
    memoryGb: async (v) => changed(await ctx.tx.update(s.hardwareDevice).set({ memoryGb: Number(v) }).where(sql`${s.hardwareDevice.id} = ${deviceId} and ${s.hardwareDevice.memoryGb} is distinct from ${Number(v)}`).returning({ id: s.hardwareDevice.id })),
    memoryType: async (v) => changed(await ctx.tx.update(s.hardwareDevice).set({ memoryType: String(v) }).where(sql`${s.hardwareDevice.id} = ${deviceId} and ${s.hardwareDevice.memoryType} is distinct from ${String(v)}`).returning({ id: s.hardwareDevice.id })),
    memoryBandwidthGbps: async (v) => changed(await ctx.tx.update(s.hardwareDevice).set({ memoryBandwidthGbps: Number(v) }).where(sql`${s.hardwareDevice.id} = ${deviceId} and ${s.hardwareDevice.memoryBandwidthGbps} is distinct from ${Number(v)}`).returning({ id: s.hardwareDevice.id })),
    tdpWatts: async (v) => changed(await ctx.tx.update(s.hardwareDevice).set({ tdpWatts: Number(v) }).where(sql`${s.hardwareDevice.id} = ${deviceId} and ${s.hardwareDevice.tdpWatts} is distinct from ${Number(v)}`).returning({ id: s.hardwareDevice.id })),
    releasedOn: async (v) => changed(await ctx.tx.update(s.hardwareDevice).set({ releasedOn: String(v) }).where(sql`${s.hardwareDevice.id} = ${deviceId} and ${s.hardwareDevice.releasedOn} is distinct from ${String(v)}::date`).returning({ id: s.hardwareDevice.id })),
    launchPriceUsd: async (v) => changed(await ctx.tx.update(s.hardwareDevice).set({ launchPriceUsd: Number(v) }).where(sql`${s.hardwareDevice.id} = ${deviceId} and ${s.hardwareDevice.launchPriceUsd} is distinct from ${Number(v)}`).returning({ id: s.hardwareDevice.id })),
  };
  for (const fact of facts) await assertField(ctx, deviceId, fact.field, fact.value, () => columns[fact.field]!(fact.value));
  ctx.touched.set(deviceId, 'other');
}

const changed = (rows: { id: string }[]) => rows.length > 0;

async function applyUnsupported(ctx: ApplyContext, r: UnsupportedRecord): Promise<void> {
  const entityId = await resolveIdentifier(ctx.tx, r.identifier);
  const [known] = entityId ? await ctx.tx.select({ id: s.entity.id, kind: s.entity.kind, slug: s.entity.slug, name: s.entity.name }).from(s.entity).where(eq(s.entity.id, entityId)) : [];
  if (r.reason === 'source_unavailable' && !known) return; // never ingested: nothing to review
  raise(ctx, {
    reason: r.reason,
    blocking: false,
    detail: `${r.identifier.value}: ${r.detail}${known ? '; existing entity retained' : ''}`,
    candidates: known ? [{ entityId: known.id, kind: known.kind, slug: known.slug, name: known.name, basis: 'external identifier' }] : [],
  });
}

async function createEvent(ctx: ApplyContext, e: { dedupeKey: string; kind: EventRecord['kind']; title: string; summary?: string; occurredAt: string; url?: string; entityIds: string[] }) {
  const [row] = await ctx.tx
    .insert(s.event)
    .values({ eventKind: e.kind, title: e.title, summary: e.summary ?? null, occurredAt: new Date(e.occurredAt), url: e.url ?? null, dedupeKey: e.dedupeKey, sourceRecordId: ctx.sourceRecordId })
    .onConflictDoNothing()
    .returning({ id: s.event.id });
  let eventId = row?.id;
  if (row) ctx.stats.eventsCreated += 1;
  else {
    // Same event seen again. The source that created it owns its text (an edited entry refreshes it); other sources
    // reporting the same identity (e.g. a release via both the GitHub API and its Atom feed) only add entity links.
    const [updated] = await ctx.tx
      .update(s.event)
      .set({ title: e.title, summary: e.summary ?? null, url: e.url ?? null })
      .where(sql`${s.event.dedupeKey} = ${e.dedupeKey} and ${s.event.sourceRecordId} in (select id from ingest.source_record where source_id = ${ctx.sourceId}) and (${s.event.title} is distinct from ${e.title} or ${s.event.summary} is distinct from ${e.summary ?? null} or ${s.event.url} is distinct from ${e.url ?? null})`)
      .returning({ id: s.event.id });
    if (updated) ctx.stats.eventsUpdated += 1;
    eventId = updated?.id ?? (await ctx.tx.select({ id: s.event.id }).from(s.event).where(eq(s.event.dedupeKey, e.dedupeKey)))[0]?.id;
  }
  if (eventId && e.entityIds.length) {
    const [{ n } = { n: 0 }] = await ctx.tx.execute<{ n: number }>(sql`select count(*)::int as n from ecosystem.event_entity where event_id = ${eventId}`);
    await ctx.tx
      .insert(s.eventEntity)
      .values(e.entityIds.map((entityId, i) => ({ eventId: eventId!, entityId, role: n === 0 && i === 0 ? ('subject' as const) : ('related' as const) })))
      .onConflictDoNothing();
  }
}

export type { VariantKind };
export { addAliases };

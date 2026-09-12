/**
 * Ingestion pipeline: fetch → snapshot → dedupe → normalize → resolve → upsert → provenance → emit.
 * Each raw item is processed in its own transaction and is idempotent.
 */
import { slugify, type Capability, type RelationPredicate } from '@mutinai/domain';
import {
  addAliases,
  createArtifact,
  createEntity,
  createVariant,
  ensureSource,
  jobs,
  linkExternalId,
  normalizeAlias,
  OntologyError,
  schema as s,
  type Database,
  type Executor,
} from '@mutinai/db';
import { and, eq, sql } from 'drizzle-orm';
import type { ArtifactSetRecord, EventRecord, FetchContext, Identifier, NormalizedRecord, OrganizationRef, ProjectRecord, RawItem, SourceAdapter, VariantRecord } from './adapter';
import { canonicalJson, sha256 } from './hash';
import type { ObjectStore } from './object-store';

export interface PipelineDeps {
  db: Database;
  store: ObjectStore;
  log?: (message: string) => void;
}

export interface RunStats {
  seen: number;
  new: number;
  unchanged: number;
  unresolved: number;
  failed: number;
  entitiesCreated: number;
  fieldsUpdated: number;
  eventsCreated: number;
  jobsEnqueued: number;
}

export interface ItemOutcome {
  status: 'processed' | 'unresolved' | 'unchanged' | 'failed';
  details: string[];
}

interface ApplyContext {
  tx: Executor;
  sourceKey: string;
  sourceRecordId: string;
  priority: number;
  touched: Map<string, 'variant' | 'artifact' | 'other'>;
  details: string[];
  unresolved: boolean;
  stats: RunStats;
}

const emptyStats = (): RunStats => ({ seen: 0, new: 0, unchanged: 0, unresolved: 0, failed: 0, entitiesCreated: 0, fieldsUpdated: 0, eventsCreated: 0, jobsEnqueued: 0 });

/** Licence identifiers used by sources (HF card metadata, SPDX) → Mutinai licence keys. */
const LICENSE_ALIASES: Record<string, string> = {
  'apache-2.0': 'apache-2.0',
  mit: 'mit',
  llama3: 'llama-3.1-community',
  'llama3.1': 'llama-3.1-community',
  'llama3.3': 'llama-3.3-community',
  gemma: 'gemma-terms',
};

export async function runAdapter(deps: PipelineDeps, adapter: SourceAdapter, ctx: FetchContext = {}): Promise<{ runId: string; stats: RunStats }> {
  const sourceId = await ensureSource(deps.db, {
    key: adapter.source.key,
    name: adapter.source.name,
    kind: adapter.source.kind,
    baseUrl: adapter.source.baseUrl,
    priority: adapter.source.priority,
  });
  const [run] = await deps.db.insert(s.ingestionRun).values({ sourceId }).returning({ id: s.ingestionRun.id });
  const stats = emptyStats();
  try {
    for await (const item of adapter.fetch(ctx)) {
      stats.seen += 1;
      const outcome = await processItem(deps, adapter, sourceId, run!.id, item, stats);
      if (outcome.status === 'unchanged') stats.unchanged += 1;
      else if (outcome.status === 'failed') stats.failed += 1;
      else {
        stats.new += 1;
        if (outcome.status === 'unresolved') stats.unresolved += 1;
      }
      deps.log?.(`[${adapter.source.key}] ${item.externalId}: ${outcome.status}${outcome.details.length ? ` — ${outcome.details.join('; ')}` : ''}`);
    }
    await deps.db.update(s.ingestionRun).set({ status: 'succeeded', finishedAt: new Date(), stats: { ...stats } }).where(eq(s.ingestionRun.id, run!.id));
  } catch (error) {
    await deps.db
      .update(s.ingestionRun)
      .set({ status: 'failed', finishedAt: new Date(), stats: { ...stats }, error: String(error) })
      .where(eq(s.ingestionRun.id, run!.id));
    throw error;
  }
  return { runId: run!.id, stats };
}

export async function processItem(deps: PipelineDeps, adapter: SourceAdapter, sourceId: string, runId: string | null, item: RawItem, stats = emptyStats()): Promise<ItemOutcome> {
  const body = canonicalJson(item.payload);
  const contentHash = sha256(body);
  const objectKey = `sources/${adapter.source.key}/${contentHash.slice(0, 2)}/${contentHash}.json`;
  // Content-addressed and idempotent, so it is safe outside the transaction.
  await deps.store.put(objectKey, new TextEncoder().encode(body), item.contentType);

  let records: NormalizedRecord[];
  try {
    records = adapter.normalize(item);
  } catch (error) {
    const inserted = await deps.db
      .insert(s.sourceRecord)
      .values({ sourceId, externalId: item.externalId, contentHash, objectKey, contentType: item.contentType, url: item.url, fetchedAt: item.fetchedAt, status: 'failed', statusDetail: `normalize: ${String(error)}`, runId })
      .onConflictDoNothing()
      .returning({ id: s.sourceRecord.id });
    return inserted.length ? { status: 'failed', details: [String(error)] } : { status: 'unchanged', details: [] };
  }

  return deps.db.transaction(async (tx) => {
    const inserted = await tx
      .insert(s.sourceRecord)
      .values({ sourceId, externalId: item.externalId, contentHash, objectKey, contentType: item.contentType, url: item.url, fetchedAt: item.fetchedAt, status: 'processed', runId })
      .onConflictDoNothing()
      .returning({ id: s.sourceRecord.id });
    if (!inserted.length) return { status: 'unchanged' as const, details: [] };

    const ctx: ApplyContext = {
      tx,
      sourceKey: adapter.source.key,
      sourceRecordId: inserted[0]!.id,
      priority: adapter.source.priority,
      touched: new Map(),
      details: [],
      unresolved: false,
      stats,
    };

    for (const record of records) {
      // Each record runs in a savepoint with its own `touched` set, merged only if the savepoint commits,
      // so rolled-back work never emits downstream jobs.
      const recordCtx: ApplyContext = { ...ctx, touched: new Map() };
      try {
        await tx.transaction(async (sp) => {
          recordCtx.tx = sp;
          await applyRecord(recordCtx, record);
        });
        for (const [id, kind] of recordCtx.touched) ctx.touched.set(id, kind);
        if (recordCtx.unresolved) ctx.unresolved = true;
      } catch (error) {
        if (!(error instanceof OntologyError)) throw error;
        ctx.unresolved = true;
        ctx.details.push(`rejected by ontology validation: ${error.message}`);
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
      .where(eq(s.sourceRecord.id, ctx.sourceRecordId));
    return { status, details: ctx.details } as ItemOutcome;
  });
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

async function resolveOrCreateOrganization(ctx: ApplyContext, ref: OrganizationRef): Promise<string> {
  if (ref.identifier) {
    const found = await resolveIdentifier(ctx.tx, ref.identifier);
    if (found) return found;
  }
  const byAlias = await resolveAlias(ctx.tx, ref.name, ['organization']);
  let orgId = byAlias?.id;
  if (!orgId) {
    let slug = slugify(ref.name);
    const [clash] = await ctx.tx.select({ id: s.entity.id }).from(s.entity).where(and(eq(s.entity.kind, 'organization'), eq(s.entity.slug, slug)));
    if (clash) slug = `${slug}-${ctx.sourceRecordId.slice(0, 6)}`;
    orgId = await createEntity(ctx.tx, { kind: 'organization', slug, name: ref.name });
    await ctx.tx.insert(s.organization).values({ id: orgId, orgKind: 'community' });
    ctx.stats.entitiesCreated += 1;
    ctx.touched.set(orgId, 'other');
    ctx.details.push(`created organization ${ref.name} (kind needs editorial review)`);
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

async function licenseIdFor(tx: Executor, key: string | undefined): Promise<string | null> {
  if (!key) return null;
  const mapped = LICENSE_ALIASES[key.toLowerCase()];
  if (!mapped) return null;
  const [row] = await tx.select({ id: s.license.id }).from(s.license).where(eq(s.license.key, mapped));
  return row?.id ?? null;
}

// ─── Record handlers ─────────────────────────────────────────────────────────

const LINEAGE: Record<NonNullable<VariantRecord['derivation']>, RelationPredicate> = {
  fine_tune: 'fine_tuned_from',
  merge: 'merged_from',
  distill: 'distilled_from',
};

async function applyVariant(ctx: ApplyContext, r: VariantRecord): Promise<void> {
  const existing = await resolveIdentifier(ctx.tx, r.identifier);
  if (existing) {
    const licenseId = await licenseIdFor(ctx.tx, r.licenseKey);
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
    ctx.touched.set(existing, 'variant');
    return;
  }

  if (!r.base || !r.derivation) {
    ctx.unresolved = true;
    ctx.details.push(`${r.identifier.value}: new first-party model; requires editorial architecture data`);
    return;
  }
  const baseId = await resolveIdentifier(ctx.tx, r.base);
  if (!baseId) {
    ctx.unresolved = true;
    ctx.details.push(`${r.identifier.value}: base ${r.base.value} is not a known variant`);
    return;
  }
  const [base] = await ctx.tx
    .select({ modelId: s.modelVariant.modelId, capabilities: s.modelVariant.capabilities, licenseId: s.modelVariant.licenseId })
    .from(s.modelVariant)
    .where(eq(s.modelVariant.id, baseId));
  if (!base) {
    ctx.unresolved = true;
    ctx.details.push(`${r.identifier.value}: base ${r.base.value} resolves to a non-variant entity`);
    return;
  }

  const publisherOrgId = await resolveOrCreateOrganization(ctx, r.publisher);
  const id = await createVariant(ctx.tx, {
    slug: await uniqueSlug(ctx.tx, 'model_variant', slugify(r.name)),
    name: r.name,
    summary: r.summary ?? null,
    modelId: base.modelId,
    kind: r.derivation,
    publisherOrgId,
    licenseId: (await licenseIdFor(ctx.tx, r.licenseKey)) ?? base.licenseId,
    capabilities: (r.capabilities as Capability[] | undefined) ?? base.capabilities,
    releasedOn: r.releasedOn ?? null,
    lineage: [{ predicate: LINEAGE[r.derivation], objectVariantId: baseId }],
    aliases: [r.identifier.value],
    sourceRecordId: ctx.sourceRecordId,
  });
  await linkExternalId(ctx.tx, { ...r.identifier, entityId: id, firstSeenRecordId: ctx.sourceRecordId });
  for (const [field, value] of Object.entries({ name: r.name, derivation: r.derivation, base: r.base.value, license: r.licenseKey ?? null })) {
    await assertField(ctx, id, field, value, async () => false);
  }
  ctx.stats.entitiesCreated += 1;
  ctx.touched.set(id, 'variant');
}

async function applyArtifactSet(ctx: ApplyContext, r: ArtifactSetRecord): Promise<void> {
  const variantId = await resolveIdentifier(ctx.tx, r.base);
  if (!variantId) {
    ctx.unresolved = true;
    ctx.details.push(`${r.identifier.value}: base ${r.base.value} is not a known variant`);
    return;
  }
  const [variant] = await ctx.tx
    .select({ name: s.entity.name, slug: s.entity.slug })
    .from(s.entity)
    .where(and(eq(s.entity.id, variantId), eq(s.entity.kind, 'model_variant')));
  if (!variant) {
    ctx.unresolved = true;
    ctx.details.push(`${r.identifier.value}: base is not a variant`);
    return;
  }
  const publisherOrgId = await resolveOrCreateOrganization(ctx, r.publisher);
  const [publisher] = await ctx.tx.select({ name: s.entity.name, slug: s.entity.slug }).from(s.entity).where(eq(s.entity.id, publisherOrgId));

  for (const file of r.files) {
    const scheme = await resolveAlias(ctx.tx, file.schemeName, ['quantization_scheme']);
    if (!scheme) {
      ctx.unresolved = true;
      ctx.details.push(`${file.fileName}: unknown quantization scheme ${file.schemeName}`);
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
        ctx.unresolved = true;
        ctx.details.push(`${file.fileName}: ${error.message}`);
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
    ctx.unresolved = true;
    ctx.details.push(`${r.identifier.value}: unknown project; requires categorisation before import`);
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

  if (r.release) {
    const [project] = await ctx.tx.select({ name: s.entity.name }).from(s.entity).where(eq(s.entity.id, projectId));
    await createEvent(ctx, {
      dedupeKey: `${r.identifier.namespace}:${r.identifier.value}:release:${r.release.tag}`,
      kind: 'runtime_release',
      title: `${project!.name} ${r.release.title || r.release.tag}`,
      summary: r.release.body?.split('\n')[0]?.slice(0, 280),
      occurredAt: r.release.publishedAt,
      url: r.release.url,
      entityIds: [projectId],
    });
  }
}

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
  await createEvent(ctx, {
    dedupeKey: `${ctx.sourceKey}:${r.url ?? r.title}`,
    kind: r.kind,
    title: r.title,
    summary: r.summary,
    occurredAt: r.occurredAt,
    url: r.url,
    entityIds: [...new Set(entityIds)],
  });
}

async function createEvent(ctx: ApplyContext, e: { dedupeKey: string; kind: EventRecord['kind']; title: string; summary?: string; occurredAt: string; url?: string; entityIds: string[] }) {
  const [row] = await ctx.tx
    .insert(s.event)
    .values({ eventKind: e.kind, title: e.title, summary: e.summary ?? null, occurredAt: new Date(e.occurredAt), url: e.url ?? null, dedupeKey: e.dedupeKey, sourceRecordId: ctx.sourceRecordId })
    .onConflictDoNothing()
    .returning({ id: s.event.id });
  if (!row) return;
  ctx.stats.eventsCreated += 1;
  if (e.entityIds.length) {
    await ctx.tx.insert(s.eventEntity).values(e.entityIds.map((entityId, i) => ({ eventId: row.id, entityId, role: i === 0 ? ('subject' as const) : ('related' as const) }))).onConflictDoNothing();
  }
}

export { addAliases };

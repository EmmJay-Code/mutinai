/**
 * PUBLIC catalog queries. No viewer parameter, no identity or community-private data.
 * Every query selects explicit columns into DTOs.
 */
import { capabilityProfiles, compat, frontier, type CapabilityProfile, type DatedScore } from '@mutinai/domain';
import { sql, type SQL } from 'drizzle-orm';
import type { Executor } from '../client';

const rows = async <T>(db: Executor, query: SQL): Promise<T[]> => (await db.execute(query)) as unknown as T[];
const one = async <T>(db: Executor, query: SQL): Promise<T | null> => (await rows<T>(db, query))[0] ?? null;
const like = (q: string) => `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

export interface MetricValue {
  key: string;
  label: string;
  unit: string;
  higherIsBetter: boolean;
  value: number;
}

// ─── Overview ────────────────────────────────────────────────────────────────

export interface EventDTO {
  id: string;
  kind: string;
  title: string;
  summary: string | null;
  /** When the event happened. Every time-sensitive surface uses this, never `discoveredAt`. */
  occurredAt: Date;
  /** When Mutinai first recorded the event (ingest time). Never presented as the event's date. */
  discoveredAt: Date;
  url: string | null;
  /** Source that reported the event; null for events without a source record. */
  sourceName: string | null;
  sourceKind: string | null;
  /** Subject first. `category` is set for projects. */
  entities: { kind: string; slug: string; name: string; role: string; category: string | null }[];
}

export async function listEvents(db: Executor, opts: { limit?: number; entityId?: string; since?: Date } = {}): Promise<EventDTO[]> {
  const where: SQL[] = [];
  if (opts.entityId) where.push(sql`exists (select 1 from ecosystem.event_entity x where x.event_id = ev.id and x.entity_id = ${opts.entityId})`);
  if (opts.since) where.push(sql`ev.occurred_at >= ${opts.since.toISOString()}::timestamptz`);
  return rows<EventDTO>(db, sql`
    select ev.id, ev.event_kind as kind, ev.title, ev.summary, ev.occurred_at as "occurredAt", ev.created_at as "discoveredAt", ev.url,
      src.name as "sourceName", src.kind::text as "sourceKind",
      coalesce((select jsonb_agg(jsonb_build_object('kind', e.kind, 'slug', e.slug, 'name', e.name, 'role', ee.role, 'category', p.category) order by ee.role, e.name)
        from ecosystem.event_entity ee join ecosystem.entity e on e.id = ee.entity_id left join ecosystem.project p on p.id = e.id
        where ee.event_id = ev.id), '[]') as entities
    from ecosystem.event ev
    left join ingest.source_record sr on sr.id = ev.source_record_id
    left join ingest.source src on src.id = sr.source_id
    ${where.length ? sql`where ${sql.join(where, sql` and `)}` : sql``}
    order by ev.occurred_at desc, ev.id
    limit ${opts.limit ?? 20}`);
}

export async function getCatalogCounts(db: Executor): Promise<Record<string, number>> {
  const r = await rows<{ kind: string; count: number }>(db, sql`select kind::text, count(*)::int as count from ecosystem.entity group by kind`);
  const counts = Object.fromEntries(r.map((x) => [x.kind, x.count]));
  const [extra] = await rows<{ results: number; events: number }>(db, sql`
    select (select count(*)::int from ecosystem.benchmark_result) as results, (select count(*)::int from ecosystem.event) as events`);
  return { ...counts, benchmark_result: extra!.results, event: extra!.events };
}

export interface ReleaseSummaryDTO {
  slug: string;
  name: string;
  summary: string | null;
  releasedOn: string | null;
  familyName: string;
  familySlug: string;
  developerName: string;
  developerSlug: string;
  licenseName: string | null;
  models: { slug: string; name: string; paramsTotal: number; paramsActive: number | null }[];
}

export async function listRecentReleases(db: Executor, limit = 8): Promise<ReleaseSummaryDTO[]> {
  return rows<ReleaseSummaryDTO>(db, sql`
    select re.slug, re.name, re.summary, r.released_on::text as "releasedOn", fe.name as "familyName", fe.slug as "familySlug",
      oe.name as "developerName", oe.slug as "developerSlug", l.name as "licenseName",
      coalesce((select jsonb_agg(jsonb_build_object('slug', me.slug, 'name', me.name, 'paramsTotal', m.params_total, 'paramsActive', m.params_active) order by m.params_total)
        from ecosystem.model m join ecosystem.entity me on me.id = m.id where m.release_id = r.id), '[]') as models
    from ecosystem.model_release r
    join ecosystem.entity re on re.id = r.id
    join ecosystem.model_family f on f.id = r.family_id
    join ecosystem.entity fe on fe.id = f.id
    join ecosystem.entity oe on oe.id = f.developer_org_id
    left join ecosystem.license l on l.id = r.default_license_id
    order by r.released_on desc nulls last
    limit ${limit}`);
}

// ─── Models ──────────────────────────────────────────────────────────────────

export interface ModelListFilters {
  q?: string;
  family?: string;
  developer?: string;
  architecture?: 'dense' | 'moe';
  capability?: string;
  commercialUse?: 'allowed' | 'restricted';
  minParamsB?: number;
  maxParamsB?: number;
  /** Only models with at least one artifact whose estimated memory at 8K context fits in this many GiB. */
  fitsInGb?: number;
  sort?: 'released' | 'params_asc' | 'params_desc' | 'name' | 'activity';
}

export interface ModelListItemDTO {
  slug: string;
  name: string;
  summary: string | null;
  architecture: 'dense' | 'moe';
  paramsTotal: number;
  paramsActive: number | null;
  contextLength: number;
  releaseName: string;
  releaseSlug: string;
  releasedOn: string | null;
  familyName: string;
  familySlug: string;
  developerName: string;
  developerSlug: string;
  variantCount: number;
  artifactCount: number;
  smallestArtifactBytes: number | null;
  capabilities: string[];
  licenses: { name: string; commercialUse: string }[];
  resultCount: number;
  /** Public, published community reviews on the model's variants and artifacts. */
  reviewCount: number;
  /** Public, published community benchmark runs on the model's artifacts. */
  runCount: number;
  /** Estimated memory (GiB) of the smallest artifact at 8K context, using the compatibility engine's formula. */
  minMemoryGb: number | null;
}

export const MEMORY_REFERENCE_CONTEXT = 8192;

export async function listModels(db: Executor, f: ModelListFilters = {}): Promise<ModelListItemDTO[]> {
  const where: SQL[] = [];
  if (f.q) {
    where.push(sql`(me.name ilike ${like(f.q)} or me.search_vector @@ websearch_to_tsquery('simple', ${f.q}) or exists (
      select 1 from ecosystem.model_variant v join ecosystem.entity ve on ve.id = v.id
      where v.model_id = m.id and (ve.name ilike ${like(f.q)} or ve.search_vector @@ websearch_to_tsquery('simple', ${f.q}))))`);
  }
  if (f.family) where.push(sql`(fe.slug = ${f.family} or pfe.slug = ${f.family})`);
  if (f.developer) where.push(sql`oe.slug = ${f.developer}`);
  if (f.architecture) where.push(sql`m.architecture = ${f.architecture}`);
  if (f.capability) where.push(sql`exists (select 1 from ecosystem.model_variant v where v.model_id = m.id and ${f.capability} = any(v.capabilities::text[]))`);
  if (f.commercialUse) where.push(sql`exists (select 1 from ecosystem.model_variant v join ecosystem.license l on l.id = v.license_id where v.model_id = m.id and l.commercial_use = ${f.commercialUse})`);
  if (f.minParamsB != null) where.push(sql`m.params_total >= ${f.minParamsB * 1e9}`);
  if (f.maxParamsB != null) where.push(sql`m.params_total <= ${f.maxParamsB * 1e9}`);
  const order = {
    released: sql`r.released_on desc nulls last, m.params_total`,
    params_asc: sql`m.params_total asc`,
    params_desc: sql`m.params_total desc`,
    name: sql`me.name asc`,
    activity: sql`r.released_on desc nulls last`,
  }[f.sort ?? 'released'];

  const result = await rows<ModelListItemDTO & { layers: number; kvHeads: number; headDim: number; kvBytesPerTokenOverride: number | null }>(db, sql`
    select me.slug, me.name, coalesce(re.summary, me.summary) as summary, m.architecture,
      m.layers, m.kv_heads as "kvHeads", m.head_dim as "headDim", m.kv_bytes_per_token_override as "kvBytesPerTokenOverride", m.params_total::float8 as "paramsTotal", m.params_active::float8 as "paramsActive",
      m.context_length as "contextLength", re.name as "releaseName", re.slug as "releaseSlug", r.released_on::text as "releasedOn",
      fe.name as "familyName", fe.slug as "familySlug", oe.name as "developerName", oe.slug as "developerSlug",
      (select count(*)::int from ecosystem.model_variant v where v.model_id = m.id) as "variantCount",
      (select count(*)::int from ecosystem.model_artifact a join ecosystem.model_variant v on v.id = a.variant_id where v.model_id = m.id) as "artifactCount",
      (select min(a.size_bytes)::float8 from ecosystem.model_artifact a join ecosystem.model_variant v on v.id = a.variant_id where v.model_id = m.id) as "smallestArtifactBytes",
      (select coalesce(array_agg(distinct c order by c), '{}') from ecosystem.model_variant v, unnest(v.capabilities::text[]) c where v.model_id = m.id) as capabilities,
      (select coalesce(jsonb_agg(distinct jsonb_build_object('name', l.name, 'commercialUse', l.commercial_use)), '[]')
        from ecosystem.model_variant v join ecosystem.license l on l.id = v.license_id where v.model_id = m.id) as licenses,
      (select count(*)::int from ecosystem.benchmark_result br
        left join ecosystem.model_artifact a on a.id = br.artifact_id
        join ecosystem.model_variant v on v.id = coalesce(br.variant_id, a.variant_id) where v.model_id = m.id) as "resultCount",
      (select count(*)::int from community.review rv
        left join ecosystem.model_artifact a on a.id = rv.entity_id
        join ecosystem.model_variant v on v.id = coalesce(a.variant_id, rv.entity_id)
        where v.model_id = m.id and rv.visibility = 'public' and rv.status = 'published') as "reviewCount",
      (select count(*)::int from community.benchmark_submission bs
        join ecosystem.model_artifact a on a.id = bs.artifact_id join ecosystem.model_variant v on v.id = a.variant_id
        where v.model_id = m.id and bs.visibility = 'public' and bs.status = 'published') as "runCount"
    from ecosystem.model m
    join ecosystem.entity me on me.id = m.id
    join ecosystem.model_release r on r.id = m.release_id
    join ecosystem.entity re on re.id = r.id
    join ecosystem.model_family f on f.id = r.family_id
    join ecosystem.entity fe on fe.id = f.id
    left join ecosystem.entity pfe on pfe.id = f.parent_family_id
    join ecosystem.entity oe on oe.id = f.developer_org_id
    ${where.length ? sql`where ${sql.join(where, sql` and `)}` : sql``}
    order by ${order}`);

  let models: ModelListItemDTO[] = result.map(({ layers, kvHeads, headDim, kvBytesPerTokenOverride, ...m }) => {
    if (m.smallestArtifactBytes == null) return { ...m, minMemoryGb: null };
    const spec = { paramsTotal: m.paramsTotal, paramsActive: m.paramsActive, layers, kvHeads, headDim, kvBytesPerTokenOverride, contextLength: m.contextLength };
    const weights = compat.weightsGb({ id: m.slug, format: 'gguf', bitsPerWeight: 0, sizeBytes: m.smallestArtifactBytes, model: spec });
    const total = weights + compat.kvCacheGb(spec, Math.min(MEMORY_REFERENCE_CONTEXT, m.contextLength)) + compat.COMPAT_CONSTANTS.baseOverheadGb + weights * compat.COMPAT_CONSTANTS.overheadPerWeightGb;
    return { ...m, minMemoryGb: Math.round(total * 10) / 10 };
  });
  if (f.fitsInGb != null) models = models.filter((m) => m.minMemoryGb != null && m.minMemoryGb <= f.fitsInGb!);
  if (f.sort === 'activity') models = [...models].sort((a, b) => b.reviewCount + b.runCount - (a.reviewCount + a.runCount));
  return models;
}

export async function listModelFacets(db: Executor) {
  const families = await rows<{ slug: string; name: string; parentSlug: string | null }>(db, sql`
    select fe.slug, fe.name, pfe.slug as "parentSlug" from ecosystem.model_family f
    join ecosystem.entity fe on fe.id = f.id left join ecosystem.entity pfe on pfe.id = f.parent_family_id order by fe.name`);
  const developers = await rows<{ slug: string; name: string }>(db, sql`
    select distinct oe.slug, oe.name from ecosystem.model_family f join ecosystem.entity oe on oe.id = f.developer_org_id order by oe.name`);
  return { families, developers };
}

export interface VariantDTO {
  id: string;
  slug: string;
  name: string;
  kind: string;
  capabilities: string[];
  releasedOn: string | null;
  publisher: { slug: string; name: string };
  license: { name: string; commercialUse: string; url: string | null } | null;
  externalIds: { namespace: string; value: string; url: string | null }[];
  lineage: { direction: 'outgoing' | 'incoming'; predicate: string; slug: string; name: string; modelSlug: string | null }[];
  artifacts: ArtifactDTO[];
}

export interface ArtifactDTO {
  id: string;
  slug: string;
  name: string;
  schemeSlug: string;
  schemeName: string;
  method: string;
  format: string;
  bitsPerWeight: number;
  sizeBytes: number | null;
  sourceRepo: string | null;
  publisher: { slug: string; name: string };
}

export interface CapabilityResultDTO {
  variantSlug: string;
  benchmarkSlug: string;
  benchmarkName: string;
  metric: MetricValue;
  evaluationSetting: string | null;
  origin: string;
  sourceName: string | null;
  sourceKind: string | null;
  citationUrl: string | null;
}

export interface PerformanceResultDTO {
  environmentId: string;
  artifactSlug: string;
  artifactName: string;
  modelSlug: string;
  configuration: { slug: string; name: string };
  runtime: { slug: string; name: string };
  runtimeVersion: string | null;
  backend: string;
  contextLength: number | null;
  benchmarkName: string;
  origin: string;
  sourceName: string | null;
  metrics: MetricValue[];
}

export interface ModelDetailDTO {
  id: string;
  slug: string;
  name: string;
  summary: string | null;
  architecture: 'dense' | 'moe';
  paramsTotal: number;
  paramsActive: number | null;
  layers: number;
  attentionHeads: number;
  kvHeads: number;
  headDim: number;
  kvBytesPerTokenOverride: number | null;
  contextLength: number;
  release: { slug: string; name: string; summary: string | null; releasedOn: string | null; announcementUrl: string | null };
  family: { slug: string; name: string; parent: { slug: string; name: string } | null };
  developer: { slug: string; name: string };
  siblings: { slug: string; name: string; paramsTotal: number }[];
  variants: VariantDTO[];
  capabilityResults: CapabilityResultDTO[];
  performanceResults: PerformanceResultDTO[];
}

export async function getModelDetail(db: Executor, slug: string): Promise<ModelDetailDTO | null> {
  const base = await one<Omit<ModelDetailDTO, 'siblings' | 'variants' | 'capabilityResults' | 'performanceResults'> & { releaseId: string }>(db, sql`
    select m.id, me.slug, me.name, me.summary, m.architecture, m.params_total::float8 as "paramsTotal", m.params_active::float8 as "paramsActive",
      m.layers, m.attention_heads as "attentionHeads", m.kv_heads as "kvHeads", m.head_dim as "headDim",
      m.kv_bytes_per_token_override as "kvBytesPerTokenOverride", m.context_length as "contextLength", r.id as "releaseId",
      jsonb_build_object('slug', re.slug, 'name', re.name, 'summary', re.summary, 'releasedOn', r.released_on, 'announcementUrl', r.announcement_url) as release,
      jsonb_build_object('slug', fe.slug, 'name', fe.name, 'parent', case when pfe.id is null then null else jsonb_build_object('slug', pfe.slug, 'name', pfe.name) end) as family,
      jsonb_build_object('slug', oe.slug, 'name', oe.name) as developer
    from ecosystem.model m
    join ecosystem.entity me on me.id = m.id
    join ecosystem.model_release r on r.id = m.release_id
    join ecosystem.entity re on re.id = r.id
    join ecosystem.model_family f on f.id = r.family_id
    join ecosystem.entity fe on fe.id = f.id
    left join ecosystem.entity pfe on pfe.id = f.parent_family_id
    join ecosystem.entity oe on oe.id = f.developer_org_id
    where me.kind = 'model' and me.slug = ${slug}`);
  if (!base) return null;

  const siblings = await rows<ModelDetailDTO['siblings'][number]>(db, sql`
    select me.slug, me.name, m.params_total::float8 as "paramsTotal" from ecosystem.model m join ecosystem.entity me on me.id = m.id
    where m.release_id = ${base.releaseId} and m.id <> ${base.id} order by m.params_total`);

  const variants = await rows<Omit<VariantDTO, 'artifacts'>>(db, sql`
    select v.id, ve.slug, ve.name, v.variant_kind as kind, v.capabilities::text[] as capabilities, v.released_on::text as "releasedOn",
      jsonb_build_object('slug', pe.slug, 'name', pe.name) as publisher,
      case when l.id is null then null else jsonb_build_object('name', l.name, 'commercialUse', l.commercial_use, 'url', l.url) end as license,
      coalesce((select jsonb_agg(jsonb_build_object('namespace', x.namespace, 'value', x.value, 'url', x.url) order by x.namespace)
        from ingest.external_identifier x where x.entity_id = v.id), '[]') as "externalIds",
      coalesce((select jsonb_agg(l2 order by l2->>'direction' desc, l2->>'predicate') from (
        select jsonb_build_object('direction', 'outgoing', 'predicate', rel.predicate, 'slug', oe2.slug, 'name', oe2.name, 'modelSlug', mo.slug) as l2
        from ecosystem.entity_relation rel join ecosystem.entity oe2 on oe2.id = rel.object_id
        left join ecosystem.model_variant ov on ov.id = rel.object_id left join ecosystem.entity mo on mo.id = ov.model_id
        where rel.subject_id = v.id and rel.predicate in ('fine_tuned_from', 'distilled_from', 'merged_from')
        union all
        select jsonb_build_object('direction', 'incoming', 'predicate', rel.predicate, 'slug', se.slug, 'name', se.name, 'modelSlug', ms.slug)
        from ecosystem.entity_relation rel join ecosystem.entity se on se.id = rel.subject_id
        left join ecosystem.model_variant sv on sv.id = rel.subject_id left join ecosystem.entity ms on ms.id = sv.model_id
        where rel.object_id = v.id and rel.predicate in ('fine_tuned_from', 'distilled_from', 'merged_from')
      ) lineage), '[]') as lineage
    from ecosystem.model_variant v
    join ecosystem.entity ve on ve.id = v.id
    join ecosystem.entity pe on pe.id = v.publisher_org_id
    left join ecosystem.license l on l.id = v.license_id
    where v.model_id = ${base.id}
    order by case v.variant_kind when 'base' then 0 when 'instruct' then 1 else 2 end, ve.name`);

  const artifacts = await rows<ArtifactDTO & { variantId: string }>(db, sql`
    select a.id, a.variant_id as "variantId", ae.slug, ae.name, se.slug as "schemeSlug", se.name as "schemeName", q.method, a.format,
      q.bits_per_weight as "bitsPerWeight", a.size_bytes::float8 as "sizeBytes", a.source_repo as "sourceRepo",
      jsonb_build_object('slug', pe.slug, 'name', pe.name) as publisher
    from ecosystem.model_artifact a
    join ecosystem.entity ae on ae.id = a.id
    join ecosystem.quantization_scheme q on q.id = a.scheme_id
    join ecosystem.entity se on se.id = q.id
    join ecosystem.entity pe on pe.id = a.publisher_org_id
    join ecosystem.model_variant v on v.id = a.variant_id
    where v.model_id = ${base.id}
    order by q.bits_per_weight desc, pe.slug`);

  const capabilityResults = await rows<CapabilityResultDTO>(db, sql`
    select ve.slug as "variantSlug", be.slug as "benchmarkSlug", be.name as "benchmarkName",
      jsonb_build_object('key', bm.key, 'label', bm.label, 'unit', bm.unit, 'higherIsBetter', bm.higher_is_better, 'value', br.value) as metric,
      br.evaluation_setting as "evaluationSetting", br.origin, src.name as "sourceName", src.kind as "sourceKind", br.citation_url as "citationUrl"
    from ecosystem.benchmark_result br
    join ecosystem.model_variant v on v.id = br.variant_id
    join ecosystem.entity ve on ve.id = v.id
    join ecosystem.entity be on be.id = br.benchmark_id
    join ecosystem.benchmark_metric bm on bm.id = br.metric_id
    left join ingest.source_record sr on sr.id = br.source_record_id
    left join ingest.source src on src.id = sr.source_id
    where v.model_id = ${base.id}
    order by be.name, ve.name`);

  const performanceResults = await listPerformanceResults(db, sql`v.model_id = ${base.id}`);

  return {
    ...base,
    siblings,
    variants: variants.map((v) => ({ ...v, artifacts: artifacts.filter((a) => a.variantId === v.id) })),
    capabilityResults,
    performanceResults,
  };
}

async function listPerformanceResults(db: Executor, filter: SQL): Promise<PerformanceResultDTO[]> {
  return rows<PerformanceResultDTO>(db, sql`
    select env.id as "environmentId", ae.slug as "artifactSlug", ae.name as "artifactName", me.slug as "modelSlug",
      jsonb_build_object('slug', ce.slug, 'name', ce.name) as configuration,
      jsonb_build_object('slug', rte.slug, 'name', rte.name) as runtime,
      env.runtime_version as "runtimeVersion", env.backend, env.context_length as "contextLength",
      min(be.name) as "benchmarkName", min(br.origin::text) as origin, min(src.name) as "sourceName",
      jsonb_agg(jsonb_build_object('key', bm.key, 'label', bm.label, 'unit', bm.unit, 'higherIsBetter', bm.higher_is_better, 'value', br.value) order by bm.key) as metrics
    from ecosystem.benchmark_result br
    join ecosystem.run_environment env on env.id = br.environment_id
    join ecosystem.model_artifact a on a.id = br.artifact_id
    join ecosystem.entity ae on ae.id = a.id
    join ecosystem.model_variant v on v.id = a.variant_id
    join ecosystem.entity me on me.id = v.model_id
    join ecosystem.entity ce on ce.id = env.hardware_configuration_id
    join ecosystem.entity rte on rte.id = env.runtime_id
    join ecosystem.entity be on be.id = br.benchmark_id
    join ecosystem.benchmark_metric bm on bm.id = br.metric_id
    left join ingest.source_record sr on sr.id = br.source_record_id
    left join ingest.source src on src.id = sr.source_id
    where ${filter}
    group by env.id, ae.slug, ae.name, me.slug, ce.slug, ce.name, rte.slug, rte.name
    order by ce.name, ae.name`);
}

// ─── Hardware ────────────────────────────────────────────────────────────────

export interface DeviceListFilters {
  q?: string;
  kind?: string;
  vendor?: string;
  backend?: string;
  memoryKind?: string;
  sort?: 'memory' | 'bandwidth' | 'released' | 'name';
}

export interface DeviceDTO {
  id: string;
  slug: string;
  name: string;
  summary: string | null;
  vendor: { slug: string; name: string };
  deviceKind: string;
  memoryKind: string;
  memoryGb: number | null;
  memoryType: string | null;
  memoryBandwidthGbps: number | null;
  unifiedUsableFraction: number | null;
  backends: string[];
  tdpWatts: number | null;
  releasedOn: string | null;
  /** Manufacturer launch price (MSRP) in USD. Not a current price. */
  launchPriceUsd: number | null;
  imageUrl: string | null;
  imageCredit: string | null;
  configurationCount: number;
  resultCount: number;
}

const deviceSelect = sql`
  select d.id, de.slug, de.name, de.summary, jsonb_build_object('slug', ve.slug, 'name', ve.name) as vendor,
    d.device_kind as "deviceKind", d.memory_kind as "memoryKind", d.memory_gb as "memoryGb", d.memory_type as "memoryType",
    d.memory_bandwidth_gbps as "memoryBandwidthGbps", d.unified_usable_fraction as "unifiedUsableFraction", d.backends::text[] as backends,
    d.tdp_watts as "tdpWatts", d.released_on::text as "releasedOn", d.launch_price_usd as "launchPriceUsd", d.image_url as "imageUrl", d.image_credit as "imageCredit",
    (select count(*)::int from ecosystem.hardware_configuration_component c where c.device_id = d.id) as "configurationCount",
    (select count(distinct br.id)::int from ecosystem.hardware_configuration_component c
      join ecosystem.run_environment env on env.hardware_configuration_id = c.configuration_id
      join ecosystem.benchmark_result br on br.environment_id = env.id where c.device_id = d.id) as "resultCount"
  from ecosystem.hardware_device d
  join ecosystem.entity de on de.id = d.id
  join ecosystem.entity ve on ve.id = d.vendor_org_id`;

export async function listDevices(db: Executor, f: DeviceListFilters = {}): Promise<DeviceDTO[]> {
  const where: SQL[] = [];
  if (f.q) where.push(sql`(de.name ilike ${like(f.q)} or de.search_vector @@ websearch_to_tsquery('simple', ${f.q}))`);
  if (f.kind) where.push(sql`d.device_kind = ${f.kind}`);
  if (f.vendor) where.push(sql`ve.slug = ${f.vendor}`);
  if (f.backend) where.push(sql`${f.backend} = any(d.backends::text[])`);
  if (f.memoryKind) where.push(sql`d.memory_kind = ${f.memoryKind}`);
  const order = {
    memory: sql`d.memory_gb desc nulls last, d.memory_bandwidth_gbps desc nulls last`,
    bandwidth: sql`d.memory_bandwidth_gbps desc nulls last`,
    released: sql`d.released_on desc nulls last`,
    name: sql`de.name`,
  }[f.sort ?? 'bandwidth'];
  return rows<DeviceDTO>(db, sql`${deviceSelect} ${where.length ? sql`where ${sql.join(where, sql` and `)}` : sql``} order by ${order}`);
}

export interface ConfigurationDTO {
  id: string;
  slug: string;
  name: string;
  summary: string | null;
  formFactor: string;
  systemRamGb: number;
  systemRamBandwidthGbps: number | null;
  unifiedMemoryGb: number | null;
  /** Editorial estimate of the cost to buy or build, in USD. Not a quoted price. */
  approxPriceUsd: number | null;
  imageUrl: string | null;
  imageCredit: string | null;
  acceleratorMemoryGb: number;
  components: { slug: string; name: string; count: number; deviceKind: string; memoryKind: string; memoryGb: number | null }[];
  resultCount: number;
}

const configurationSelect = sql`
  select hc.id, ce.slug, ce.name, ce.summary, hc.form_factor as "formFactor", hc.system_ram_gb as "systemRamGb",
    hc.system_ram_bandwidth_gbps as "systemRamBandwidthGbps", hc.unified_memory_gb as "unifiedMemoryGb", hc.approx_price_usd as "approxPriceUsd", hc.image_url as "imageUrl", hc.image_credit as "imageCredit",
    coalesce(hc.unified_memory_gb, 0) + coalesce((select sum(d.memory_gb * c.count) from ecosystem.hardware_configuration_component c
      join ecosystem.hardware_device d on d.id = c.device_id where c.configuration_id = hc.id and d.memory_kind = 'dedicated'), 0) as "acceleratorMemoryGb",
    (select jsonb_agg(jsonb_build_object('slug', de.slug, 'name', de.name, 'count', c.count, 'deviceKind', d.device_kind, 'memoryKind', d.memory_kind, 'memoryGb', d.memory_gb) order by d.memory_kind, de.name)
      from ecosystem.hardware_configuration_component c join ecosystem.hardware_device d on d.id = c.device_id join ecosystem.entity de on de.id = d.id
      where c.configuration_id = hc.id) as components,
    (select count(*)::int from ecosystem.run_environment env join ecosystem.benchmark_result br on br.environment_id = env.id where env.hardware_configuration_id = hc.id) as "resultCount"
  from ecosystem.hardware_configuration hc
  join ecosystem.entity ce on ce.id = hc.id`;

export async function listConfigurations(db: Executor, opts: { deviceId?: string } = {}): Promise<ConfigurationDTO[]> {
  return rows<ConfigurationDTO>(db, sql`${configurationSelect}
    ${opts.deviceId ? sql`where exists (select 1 from ecosystem.hardware_configuration_component c where c.configuration_id = hc.id and c.device_id = ${opts.deviceId})` : sql``}
    order by "acceleratorMemoryGb" desc, ce.name`);
}

export interface DeviceDetailDTO extends DeviceDTO {
  configurations: ConfigurationDTO[];
  successors: { direction: 'newer' | 'older'; slug: string; name: string }[];
  performanceResults: PerformanceResultDTO[];
}

export async function getDeviceDetail(db: Executor, slug: string): Promise<DeviceDetailDTO | null> {
  const device = await one<DeviceDTO>(db, sql`${deviceSelect} where de.slug = ${slug}`);
  if (!device) return null;
  const [configurations, successors, performanceResults] = await Promise.all([
    listConfigurations(db, { deviceId: device.id }),
    relatedSuccessors(db, device.id),
    listPerformanceResults(db, sql`exists (select 1 from ecosystem.hardware_configuration_component c where c.configuration_id = env.hardware_configuration_id and c.device_id = ${device.id})`),
  ]);
  return { ...device, configurations, successors, performanceResults };
}

export async function getConfigurationDetail(db: Executor, slug: string): Promise<(ConfigurationDTO & { performanceResults: PerformanceResultDTO[] }) | null> {
  const config = await one<ConfigurationDTO>(db, sql`${configurationSelect} where ce.slug = ${slug}`);
  if (!config) return null;
  const performanceResults = await listPerformanceResults(db, sql`env.hardware_configuration_id = ${config.id}`);
  return { ...config, performanceResults };
}

async function relatedSuccessors(db: Executor, entityId: string) {
  return rows<{ direction: 'newer' | 'older'; slug: string; name: string }>(db, sql`
    select 'older' as direction, e.slug, e.name from ecosystem.entity_relation r join ecosystem.entity e on e.id = r.object_id
    where r.subject_id = ${entityId} and r.predicate = 'successor_of'
    union all
    select 'newer', e.slug, e.name from ecosystem.entity_relation r join ecosystem.entity e on e.id = r.subject_id
    where r.object_id = ${entityId} and r.predicate = 'successor_of'`);
}

export async function listHardwareVendors(db: Executor) {
  return rows<{ slug: string; name: string }>(db, sql`
    select distinct ve.slug, ve.name from ecosystem.hardware_device d join ecosystem.entity ve on ve.id = d.vendor_org_id order by ve.name`);
}

// ─── Projects / tools ────────────────────────────────────────────────────────

export interface ProjectDTO {
  id: string;
  slug: string;
  name: string;
  summary: string | null;
  category: string;
  repoUrl: string | null;
  homepageUrl: string | null;
  primaryLanguage: string | null;
  maintainer: { slug: string; name: string } | null;
  license: { name: string; commercialUse: string; osiApproved: boolean } | null;
  runtime: { formats: string[]; backends: string[]; supportsOffload: boolean; supportsMultiGpu: boolean; openaiCompatibleApi: boolean } | null;
  resultCount: number;
}

const projectSelect = sql`
  select p.id, pe.slug, pe.name, pe.summary, p.category, p.repo_url as "repoUrl", p.homepage_url as "homepageUrl", p.primary_language as "primaryLanguage",
    case when me.id is null then null else jsonb_build_object('slug', me.slug, 'name', me.name) end as maintainer,
    case when l.id is null then null else jsonb_build_object('name', l.name, 'commercialUse', l.commercial_use, 'osiApproved', l.osi_approved) end as license,
    case when rt.project_id is null then null else jsonb_build_object('formats', rt.formats, 'backends', rt.backends, 'supportsOffload', rt.supports_offload,
      'supportsMultiGpu', rt.supports_multi_gpu, 'openaiCompatibleApi', rt.openai_compatible_api) end as runtime,
    (select count(*)::int from ecosystem.run_environment env join ecosystem.benchmark_result br on br.environment_id = env.id where env.runtime_id = p.id) as "resultCount"
  from ecosystem.project p
  join ecosystem.entity pe on pe.id = p.id
  left join ecosystem.entity me on me.id = p.maintainer_org_id
  left join ecosystem.license l on l.id = p.license_id
  left join ecosystem.runtime rt on rt.project_id = p.id`;

export async function listProjects(db: Executor, f: { q?: string; category?: string } = {}): Promise<ProjectDTO[]> {
  const where: SQL[] = [];
  if (f.q) where.push(sql`(pe.name ilike ${like(f.q)} or pe.search_vector @@ websearch_to_tsquery('simple', ${f.q}))`);
  if (f.category) where.push(sql`p.category = ${f.category}`);
  return rows<ProjectDTO>(db, sql`${projectSelect} ${where.length ? sql`where ${sql.join(where, sql` and `)}` : sql``}
    order by case p.category when 'runtime' then 0 else 1 end, p.category, pe.name`);
}

export interface ProjectDetailDTO extends ProjectDTO {
  relations: { direction: 'outgoing' | 'incoming'; predicate: string; kind: string; slug: string; name: string }[];
  externalIds: { namespace: string; value: string; url: string | null }[];
  performanceResults: PerformanceResultDTO[];
}

export async function getProjectDetail(db: Executor, slug: string): Promise<ProjectDetailDTO | null> {
  const project = await one<ProjectDTO>(db, sql`${projectSelect} where pe.slug = ${slug}`);
  if (!project) return null;
  const relations = await rows<ProjectDetailDTO['relations'][number]>(db, sql`
    select 'outgoing' as direction, r.predicate, e.kind, e.slug, e.name from ecosystem.entity_relation r join ecosystem.entity e on e.id = r.object_id where r.subject_id = ${project.id}
    union all
    select 'incoming', r.predicate, e.kind, e.slug, e.name from ecosystem.entity_relation r join ecosystem.entity e on e.id = r.subject_id where r.object_id = ${project.id}
    order by 1 desc, 2, 5`);
  const externalIds = await rows<ProjectDetailDTO['externalIds'][number]>(db, sql`
    select namespace, value, url from ingest.external_identifier where entity_id = ${project.id} order by namespace`);
  const performanceResults = project.runtime ? await listPerformanceResults(db, sql`env.runtime_id = ${project.id}`) : [];
  return { ...project, relations, externalIds, performanceResults };
}

// ─── Search ──────────────────────────────────────────────────────────────────

export interface SearchHitDTO {
  kind: string;
  slug: string;
  name: string;
  summary: string | null;
  /** Owning model for variants/artifacts (they render on the model page). */
  modelSlug: string | null;
  score: number;
}

export async function searchEntities(db: Executor, q: string, opts: { kinds?: string[]; limit?: number } = {}): Promise<SearchHitDTO[]> {
  const query = q.trim();
  if (!query) return [];
  return rows<SearchHitDTO>(db, sql`
    with hits as (
      select e.id, e.kind, e.slug, e.name, e.summary,
        greatest(ts_rank(e.search_vector, websearch_to_tsquery('simple', ${query})) * 2, similarity(e.name, ${query}),
          case when e.name ilike ${like(query)} then 0.6 else 0 end) as score
      from ecosystem.entity e
      where (e.search_vector @@ websearch_to_tsquery('simple', ${query}) or e.name % ${query} or e.name ilike ${like(query)})
        -- Publisher accounts recorded by ingestion are provenance, not organizations readers should find.
        and (e.kind <> 'organization' or exists (select 1 from ecosystem.organization o where o.id = e.id and o.recognized))
        ${opts.kinds?.length ? sql`and e.kind::text in (${sql.join(opts.kinds.map((k) => sql`${k}`), sql`, `)})` : sql``}
    )
    select h.kind, h.slug, h.name, h.summary, h.score::float8 as score,
      coalesce(vm.slug, am.slug) as "modelSlug"
    from hits h
    left join ecosystem.model_variant v on v.id = h.id
    left join ecosystem.entity vm on vm.id = v.model_id
    left join ecosystem.model_artifact a on a.id = h.id
    left join ecosystem.model_variant av on av.id = a.variant_id
    left join ecosystem.entity am on am.id = av.model_id
    order by h.score desc, case h.kind when 'model' then 0 when 'hardware_device' then 1 when 'project' then 2 when 'model_variant' then 3 else 4 end, h.name
    limit ${opts.limit ?? 30}`);
}

// ─── Provenance ──────────────────────────────────────────────────────────────

export interface ProvenanceDTO {
  externalIds: { namespace: string; value: string; url: string | null }[];
  sources: { key: string; name: string; kind: string; records: number; lastFetchedAt: Date | null }[];
  assertions: { field: string; value: unknown; sourceName: string; assertedAt: Date; applied: boolean }[];
}

export async function getProvenance(db: Executor, entityId: string): Promise<ProvenanceDTO> {
  const externalIds = await rows<ProvenanceDTO['externalIds'][number]>(db, sql`
    select namespace, value, url from ingest.external_identifier where entity_id = ${entityId} order by namespace`);
  const sources = await rows<ProvenanceDTO['sources'][number]>(db, sql`
    with records as (
      select source_record_id as id from ingest.field_assertion where entity_id = ${entityId}
      union select source_record_id from ecosystem.benchmark_result br
        left join ecosystem.model_artifact a on a.id = br.artifact_id
        where br.variant_id = ${entityId} or br.artifact_id = ${entityId} or a.variant_id = ${entityId}
      union select source_record_id from ecosystem.entity_relation where subject_id = ${entityId} or object_id = ${entityId}
      union select first_seen_record_id from ingest.external_identifier where entity_id = ${entityId}
    )
    select src.key, src.name, src.kind, count(distinct sr.id)::int as records, max(sr.fetched_at) as "lastFetchedAt"
    from records r join ingest.source_record sr on sr.id = r.id join ingest.source src on src.id = sr.source_id
    group by src.key, src.name, src.kind order by src.name`);
  const assertions = await rows<ProvenanceDTO['assertions'][number]>(db, sql`
    select fa.field, fa.value, src.name as "sourceName", fa.asserted_at as "assertedAt", fa.applied = 1 as applied
    from ingest.field_assertion fa join ingest.source_record sr on sr.id = fa.source_record_id join ingest.source src on src.id = sr.source_id
    where fa.entity_id = ${entityId} order by fa.field, fa.asserted_at desc limit 50`);
  return { externalIds, sources, assertions };
}

export async function getEntityRef(db: Executor, kind: string, slug: string) {
  return one<{ id: string; kind: string; slug: string; name: string }>(db, sql`
    select id, kind, slug, name from ecosystem.entity where kind::text = ${kind} and slug = ${slug}`);
}

export async function getEntityById(db: Executor, id: string) {
  return one<{ id: string; kind: string; slug: string; name: string; modelSlug: string | null }>(db, sql`
    select e.id, e.kind, e.slug, e.name, coalesce(vm.slug, am.slug) as "modelSlug"
    from ecosystem.entity e
    left join ecosystem.model_variant v on v.id = e.id left join ecosystem.entity vm on vm.id = v.model_id
    left join ecosystem.model_artifact a on a.id = e.id left join ecosystem.model_variant av on av.id = a.variant_id
    left join ecosystem.entity am on am.id = av.model_id
    where e.id = ${id}`);
}

export interface BenchmarkDTO {
  id: string;
  slug: string;
  name: string;
  /** What the benchmark tests, as recorded on the entity. */
  summary: string | null;
  kind: string;
  metrics: { id: string; key: string; label: string; unit: string; higherIsBetter: boolean }[];
  resultCount: number;
}

export async function listBenchmarks(db: Executor, kind?: 'capability' | 'performance'): Promise<BenchmarkDTO[]> {
  return rows<BenchmarkDTO>(db, sql`
    select b.id, be.slug, be.name, be.summary, b.benchmark_kind as kind,
      (select jsonb_agg(jsonb_build_object('id', m.id, 'key', m.key, 'label', m.label, 'unit', m.unit, 'higherIsBetter', m.higher_is_better) order by m.key)
        from ecosystem.benchmark_metric m where m.benchmark_id = b.id) as metrics,
      (select count(*)::int from ecosystem.benchmark_result r where r.benchmark_id = b.id) as "resultCount"
    from ecosystem.benchmark b join ecosystem.entity be on be.id = b.id
    ${kind ? sql`where b.benchmark_kind = ${kind}` : sql``}
    order by be.name`);
}

// ─── Visual summaries ────────────────────────────────────────────────────────

export interface BestScoreDTO {
  modelSlug: string;
  modelName: string;
  benchmarkSlug: string;
  benchmarkName: string;
  value: number;
  releasedOn: string | null;
}

/** Best capability-benchmark result per model (across its variants). */
export async function listBestBenchmarkScores(db: Executor): Promise<BestScoreDTO[]> {
  return rows<BestScoreDTO>(db, sql`
    select me.slug as "modelSlug", me.name as "modelName", be.slug as "benchmarkSlug", be.name as "benchmarkName",
      max(br.value)::float8 as value, max(r.released_on)::text as "releasedOn"
    from ecosystem.benchmark_result br
    join ecosystem.benchmark b on b.id = br.benchmark_id and b.benchmark_kind = 'capability'
    join ecosystem.entity be on be.id = b.id
    join ecosystem.model_variant v on v.id = br.variant_id
    join ecosystem.model m on m.id = v.model_id
    join ecosystem.entity me on me.id = m.id
    join ecosystem.model_release r on r.id = m.release_id
    group by me.slug, me.name, be.slug, be.name`);
}

/** Capability profile per model slug, relative to the best result in the catalog for each benchmark. */
export async function listCapabilityProfiles(db: Executor): Promise<Record<string, CapabilityProfile>> {
  const scores = await listBestBenchmarkScores(db);
  return Object.fromEntries(capabilityProfiles(scores.map((s) => ({ subject: s.modelSlug, benchmark: s.benchmarkSlug, value: s.value }))));
}

export interface FrontierDTO {
  benchmarkSlug: string;
  benchmarkName: string;
  points: (DatedScore & { name: string; modelSlug: string })[];
}

/**
 * How the best open score on a benchmark has moved over time. Uses each variant's own release date,
 * so a distill released later is not back-dated to its base model's release.
 */
export async function benchmarkFrontier(db: Executor, benchmarkSlug: string): Promise<FrontierDTO | null> {
  const scores = await rows<{ slug: string; name: string; modelSlug: string; benchmarkName: string; value: number; date: string }>(db, sql`
    select ve.slug, ve.name, me.slug as "modelSlug", be.name as "benchmarkName", max(br.value)::float8 as value,
      coalesce(v.released_on, r.released_on)::text as date
    from ecosystem.benchmark_result br
    join ecosystem.entity be on be.id = br.benchmark_id
    join ecosystem.model_variant v on v.id = br.variant_id
    join ecosystem.entity ve on ve.id = v.id
    join ecosystem.model m on m.id = v.model_id
    join ecosystem.entity me on me.id = m.id
    join ecosystem.model_release r on r.id = m.release_id
    where be.slug = ${benchmarkSlug} and coalesce(v.released_on, r.released_on) is not null
    group by ve.slug, ve.name, me.slug, be.name, v.released_on, r.released_on`);
  if (!scores.length) return null;
  const meta = new Map(scores.map((s) => [s.slug, s]));
  return {
    benchmarkSlug,
    benchmarkName: scores[0]!.benchmarkName,
    points: frontier(scores.map((s) => ({ subject: s.slug, date: s.date, value: s.value }))).map((p) => ({ ...p, name: meta.get(p.subject)!.name, modelSlug: meta.get(p.subject)!.modelSlug })),
  };
}

export interface MetricObservationDTO {
  entityId: string;
  entity: { kind: string; slug: string; name: string; modelSlug: string | null };
  metric: string;
  observedOn: string;
  value: number;
  observedAt: Date;
}

/** Daily source counters (GitHub stars, Hugging Face likes, …) observed since a date, for trend computation. */
export async function listMetricObservations(db: Executor, opts: { since: Date; metrics: readonly string[] }): Promise<MetricObservationDTO[]> {
  if (!opts.metrics.length) return [];
  return rows<MetricObservationDTO>(db, sql`
    select m.entity_id as "entityId", m.metric, m.observed_on::text as "observedOn", m.value, m.observed_at as "observedAt",
      jsonb_build_object('kind', e.kind, 'slug', e.slug, 'name', e.name, 'modelSlug', coalesce(vm.slug, am.slug)) as entity
    from ecosystem.entity_metric m
    join ecosystem.entity e on e.id = m.entity_id
    left join ecosystem.model_variant v on v.id = e.id left join ecosystem.entity vm on vm.id = v.model_id
    left join ecosystem.model_artifact a on a.id = e.id left join ecosystem.model_variant av on av.id = a.variant_id
    left join ecosystem.entity am on am.id = av.model_id
    where m.observed_at >= ${opts.since.toISOString()}::timestamptz and e.kind <> 'organization'
      and m.metric in (${sql.join(opts.metrics.map((x) => sql`${x}`), sql`, `)})
    order by m.observed_at`);
}

/** When live sources were first and most recently checked successfully. Timestamps only; no run details. */
export async function liveSourceStatus(db: Executor): Promise<{ firstCheckedAt: Date | null; lastCheckedAt: Date | null }> {
  const row = await one<{ firstCheckedAt: Date | null; lastCheckedAt: Date | null }>(db, sql`
    select min(r.started_at) as "firstCheckedAt", max(r.finished_at) as "lastCheckedAt"
    from ingest.ingestion_run r join ingest.source s on s.id = r.source_id
    where r.status = 'succeeded' and s.kind not in ('fixture', 'editorial')`);
  return { firstCheckedAt: row?.firstCheckedAt ?? null, lastCheckedAt: row?.lastCheckedAt ?? null };
}

// ─── Prices ──────────────────────────────────────────────────────────────────

export interface PriceObservationDTO {
  priceKind: string;
  amount: number;
  currency: string;
  region: string | null;
  observedAt: Date;
  sourceName: string;
  sourceUrl: string | null;
}

/**
 * Latest market price observation (retail or used) per hardware entity. Launch MSRPs live on the device row and are
 * historical facts, so they are not returned here. Empty until market prices are actually contracted and recorded;
 * callers must still check `priceFreshness` before showing one as current (docs/hardware-data.md).
 */
export async function listLatestDevicePrices(db: Executor): Promise<Record<string, PriceObservationDTO>> {
  const observations = await rows<PriceObservationDTO & { slug: string }>(db, sql`
    select distinct on (e.slug) e.slug,
      p.price_kind::text as "priceKind", p.amount, p.currency, p.region, p.observed_at as "observedAt", p.source_name as "sourceName", p.source_url as "sourceUrl"
    from ecosystem.price_observation p
    join ecosystem.entity e on e.id = p.entity_id
    where p.price_kind in ('retail_new', 'used')
    order by e.slug, p.observed_at desc`);
  return Object.fromEntries(observations.map(({ slug, ...price }) => [slug, price]));
}

/** Latest observation per price kind, currency and region for a hardware entity. */
export async function listLatestPrices(db: Executor, entityId: string): Promise<PriceObservationDTO[]> {
  return rows<PriceObservationDTO>(db, sql`
    select distinct on (price_kind, currency, coalesce(region, ''))
      price_kind::text as "priceKind", amount, currency, region, observed_at as "observedAt", source_name as "sourceName", source_url as "sourceUrl"
    from ecosystem.price_observation where entity_id = ${entityId}
    order by price_kind, currency, coalesce(region, ''), observed_at desc`);
}

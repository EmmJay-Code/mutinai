/**
 * Loads compatibility-engine inputs from the database and runs "What can I run?".
 * Measurements only come from canonical results and public, published, verified community submissions.
 */
import {
  canView,
  compat,
  type ArtifactSpec,
  type CompatResult,
  type HardwareSpec,
  type Measurement,
  type RuntimeSpec,
  type Viewer,
} from '@mutinai/domain';
import { sql, type SQL } from 'drizzle-orm';
import type { Executor } from '../client';

const rows = async <T>(db: Executor, query: SQL): Promise<T[]> => (await db.execute(query)) as unknown as T[];

const GEN_KEYS = ['tg128', 'gen_tps'];
const PROMPT_KEYS = ['pp512', 'prompt_tps'];

interface ComponentRow {
  device: { id: string; slug: string; name: string; deviceKind: string; memoryKind: string; memoryGb: number | null; memoryBandwidthGbps: number | null; unifiedUsableFraction: number | null; backends: string[] };
  count: number;
}

function toHardwareSpec(id: string, components: ComponentRow[], systemRamGb: number, systemRamBandwidthGbps: number | null, unifiedMemoryGb: number | null): HardwareSpec {
  return {
    id,
    components: components.map((c) => ({
      count: c.count,
      device: {
        id: c.device.id,
        name: c.device.name,
        kind: c.device.deviceKind as HardwareSpec['components'][number]['device']['kind'],
        memoryKind: c.device.memoryKind as HardwareSpec['components'][number]['device']['memoryKind'],
        memoryGb: c.device.memoryGb,
        memoryBandwidthGbps: c.device.memoryBandwidthGbps,
        unifiedUsableFraction: c.device.unifiedUsableFraction,
        backends: c.device.backends as HardwareSpec['components'][number]['device']['backends'],
      },
    })),
    systemRamGb,
    systemRamBandwidthGbps,
    unifiedMemoryGb,
  };
}

const componentJson = (table: SQL, fk: SQL, id: SQL) => sql`
  (select coalesce(jsonb_agg(jsonb_build_object('count', c.count, 'device', jsonb_build_object(
      'id', d.id, 'slug', de.slug, 'name', de.name, 'deviceKind', d.device_kind, 'memoryKind', d.memory_kind, 'memoryGb', d.memory_gb,
      'memoryBandwidthGbps', d.memory_bandwidth_gbps, 'unifiedUsableFraction', d.unified_usable_fraction, 'backends', d.backends))), '[]')
    from ${table} c join ecosystem.hardware_device d on d.id = c.device_id join ecosystem.entity de on de.id = d.id where ${fk} = ${id})`;

export interface HardwareSelection {
  label: string;
  source: 'reference' | 'user' | 'custom';
  slug?: string;
  spec: HardwareSpec;
  components: { slug: string; name: string; count: number }[];
}

export async function loadReferenceHardware(db: Executor, slug: string): Promise<HardwareSelection | null> {
  const [row] = await rows<{ id: string; name: string; systemRamGb: number; systemRamBandwidthGbps: number | null; unifiedMemoryGb: number | null; components: ComponentRow[] }>(db, sql`
    select hc.id, ce.name, hc.system_ram_gb as "systemRamGb", hc.system_ram_bandwidth_gbps as "systemRamBandwidthGbps", hc.unified_memory_gb as "unifiedMemoryGb",
      ${componentJson(sql`ecosystem.hardware_configuration_component`, sql`c.configuration_id`, sql`hc.id`)} as components
    from ecosystem.hardware_configuration hc join ecosystem.entity ce on ce.id = hc.id where ce.slug = ${slug}`);
  if (!row) return null;
  return {
    label: row.name,
    source: 'reference',
    slug,
    spec: toHardwareSpec(row.id, row.components, row.systemRamGb, row.systemRamBandwidthGbps, row.unifiedMemoryGb),
    components: row.components.map((c) => ({ slug: c.device.slug, name: c.device.name, count: c.count })),
  };
}

/** A user's saved configuration, subject to visibility policy. */
export async function loadUserHardware(db: Executor, viewer: Viewer, id: string): Promise<HardwareSelection | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const [row] = await rows<{ id: string; name: string; ownerProfileId: string; visibility: 'public' | 'unlisted' | 'private'; status: 'published'; systemRamGb: number; systemRamBandwidthGbps: number | null; unifiedMemoryGb: number | null; components: ComponentRow[] }>(db, sql`
    select u.id, u.name, u.owner_profile_id as "ownerProfileId", u.visibility, u.status, u.system_ram_gb as "systemRamGb",
      u.system_ram_bandwidth_gbps as "systemRamBandwidthGbps", u.unified_memory_gb as "unifiedMemoryGb",
      ${componentJson(sql`community.user_hardware_config_component`, sql`c.config_id`, sql`u.id`)} as components
    from community.user_hardware_config u where u.id = ${id}`);
  if (!row || !canView(viewer, { visibility: row.visibility, status: row.status, ownerProfileId: row.ownerProfileId }, 'direct')) return null;
  return {
    label: row.name,
    source: 'user',
    spec: toHardwareSpec(row.id, row.components, row.systemRamGb, row.systemRamBandwidthGbps, row.unifiedMemoryGb),
    components: row.components.map((c) => ({ slug: c.device.slug, name: c.device.name, count: c.count })),
  };
}

export interface CustomHardwareInput {
  components: { deviceSlug: string; count: number }[];
  systemRamGb: number;
  unifiedMemoryGb?: number | null;
  systemRamBandwidthGbps?: number | null;
}

export async function buildCustomHardware(db: Executor, input: CustomHardwareInput): Promise<HardwareSelection | null> {
  const slugs = input.components.map((c) => c.deviceSlug);
  if (!slugs.length) return null;
  const devices = await rows<ComponentRow['device']>(db, sql`
    select d.id, de.slug, de.name, d.device_kind as "deviceKind", d.memory_kind as "memoryKind", d.memory_gb as "memoryGb",
      d.memory_bandwidth_gbps as "memoryBandwidthGbps", d.unified_usable_fraction as "unifiedUsableFraction", d.backends::text[] as backends
    from ecosystem.hardware_device d join ecosystem.entity de on de.id = d.id
    where de.slug in (${sql.join(slugs.map((x) => sql`${x}`), sql`, `)})`);
  const components = input.components.flatMap((c) => {
    const device = devices.find((d) => d.slug === c.deviceSlug);
    return device ? [{ device, count: Math.max(1, Math.min(16, Math.floor(c.count))) }] : [];
  });
  if (!components.length) return null;
  const hasUnified = components.some((c) => c.device.memoryKind === 'unified');
  const unified = hasUnified ? (input.unifiedMemoryGb ?? 32) : null;
  const hasCpu = components.some((c) => c.device.deviceKind === 'cpu');
  const spec = toHardwareSpec(
    'custom',
    hasCpu || hasUnified ? components : [...components, { device: { id: 'generic-cpu', slug: 'generic-cpu', name: 'Host CPU', deviceKind: 'cpu', memoryKind: 'none', memoryGb: null, memoryBandwidthGbps: null, unifiedUsableFraction: null, backends: ['cpu'] }, count: 1 }],
    hasUnified ? 0 : input.systemRamGb,
    hasUnified ? null : (input.systemRamBandwidthGbps ?? 80),
    unified,
  );
  const label = components.map((c) => `${c.count > 1 ? `${c.count}× ` : ''}${c.device.name}`).join(' + ') + (hasUnified ? ` · ${unified} GB unified` : ` · ${input.systemRamGb} GB RAM`);
  return { label, source: 'custom', spec, components: components.map((c) => ({ slug: c.device.slug, name: c.device.name, count: c.count })) };
}

export interface CompatArtifactRow {
  artifactId: string;
  artifactSlug: string;
  schemeName: string;
  format: string;
  bitsPerWeight: number;
  sizeBytes: number | null;
  publisherName: string;
  variantId: string;
  variantSlug: string;
  variantName: string;
  variantKind: string;
  capabilities: string[];
  commercialUse: string | null;
  licenseName: string | null;
  modelSlug: string;
  modelName: string;
  familyName: string;
  developerName: string;
  architecture: 'dense' | 'moe';
  paramsTotal: number;
  paramsActive: number | null;
  layers: number;
  kvHeads: number;
  headDim: number;
  kvBytesPerTokenOverride: number | null;
  contextLength: number;
}

export async function loadCompatCatalog(db: Executor) {
  const artifacts = await rows<CompatArtifactRow>(db, sql`
    select a.id as "artifactId", ae.slug as "artifactSlug", se.name as "schemeName", a.format, q.bits_per_weight as "bitsPerWeight",
      a.size_bytes::float8 as "sizeBytes", pe.name as "publisherName", v.id as "variantId", ve.slug as "variantSlug", ve.name as "variantName",
      v.variant_kind as "variantKind", v.capabilities::text[] as capabilities, l.commercial_use as "commercialUse", l.name as "licenseName",
      me.slug as "modelSlug", me.name as "modelName", fe.name as "familyName", oe.name as "developerName", m.architecture,
      m.params_total::float8 as "paramsTotal", m.params_active::float8 as "paramsActive", m.layers, m.kv_heads as "kvHeads", m.head_dim as "headDim",
      m.kv_bytes_per_token_override as "kvBytesPerTokenOverride", m.context_length as "contextLength"
    from ecosystem.model_artifact a
    join ecosystem.entity ae on ae.id = a.id
    join ecosystem.quantization_scheme q on q.id = a.scheme_id
    join ecosystem.entity se on se.id = q.id
    join ecosystem.entity pe on pe.id = a.publisher_org_id
    join ecosystem.model_variant v on v.id = a.variant_id
    join ecosystem.entity ve on ve.id = v.id
    left join ecosystem.license l on l.id = v.license_id
    join ecosystem.model m on m.id = v.model_id
    join ecosystem.entity me on me.id = m.id
    join ecosystem.model_release r on r.id = m.release_id
    join ecosystem.model_family f on f.id = r.family_id
    join ecosystem.entity fe on fe.id = f.id
    join ecosystem.entity oe on oe.id = f.developer_org_id
    where v.variant_kind <> 'base'`);

  const runtimes = await rows<RuntimeSpec & { slug: string }>(db, sql`
    select rt.project_id as id, pe.slug, pe.name, rt.formats::text[] as formats, rt.backends::text[] as backends,
      rt.supports_offload as "supportsOffload", rt.supports_multi_gpu as "supportsMultiGpu"
    from ecosystem.runtime rt join ecosystem.entity pe on pe.id = rt.project_id order by lower(pe.name)`);

  const measurements = await loadMeasurements(db);
  return { artifacts, runtimes, measurements };
}

export async function loadMeasurements(db: Executor): Promise<Measurement[]> {
  const gen = sql.join(GEN_KEYS.map((k) => sql`${k}`), sql`, `);
  const prompt = sql.join(PROMPT_KEYS.map((k) => sql`${k}`), sql`, `);
  return rows<Measurement>(db, sql`
    select env.hardware_configuration_id as "hardwareConfigurationId", br.artifact_id as "artifactId", env.runtime_id as "runtimeId",
      env.context_length as "contextLength",
      max(case when bm.key in (${gen}) then br.value end) as "genTps",
      max(case when bm.key in (${prompt}) then br.value end) as "promptTps",
      'canonical' as origin
    from ecosystem.benchmark_result br
    join ecosystem.run_environment env on env.id = br.environment_id
    join ecosystem.benchmark_metric bm on bm.id = br.metric_id
    where br.artifact_id is not null and env.hardware_configuration_id is not null
    group by env.id, br.artifact_id
    union all
    select coalesce(env.hardware_configuration_id, env.user_hardware_config_id), s.artifact_id, env.runtime_id, env.context_length,
      max(case when bm.key in (${gen}) then sm.value end),
      max(case when bm.key in (${prompt}) then sm.value end),
      'community_verified'
    from community.benchmark_submission s
    join ecosystem.run_environment env on env.id = s.environment_id
    join community.submission_measurement sm on sm.submission_id = s.id
    join ecosystem.benchmark_metric bm on bm.id = sm.metric_id
    where s.visibility = 'public' and s.status = 'published' and s.verification = 'verified'
    group by s.id, env.id`);
}

export interface CompatRecommendation {
  row: CompatArtifactRow;
  runtime: { id: string; slug: string; name: string };
  result: CompatResult;
}

export interface CompatVariantResult {
  variantSlug: string;
  variantName: string;
  variantKind: string;
  modelSlug: string;
  modelName: string;
  familyName: string;
  developerName: string;
  architecture: 'dense' | 'moe';
  paramsTotal: number;
  paramsActive: number | null;
  capabilities: string[];
  licenseName: string | null;
  commercialUse: string | null;
  recommended: CompatRecommendation | null;
  alternatives: CompatRecommendation[];
  artifactsConsidered: number;
}

export interface RunCompatOptions {
  contextLength: number;
  capability?: string;
  runtimeSlugs?: string[];
  commercialOnly?: boolean;
}

type RuntimeRow = RuntimeSpec & { slug: string };

/** Evaluates every artifact of one variant on one system and picks the recommendation. */
function evaluateVariant(spec: HardwareSpec, group: CompatArtifactRow[], runtimes: RuntimeRow[], measurements: Measurement[], contextLength: number): CompatVariantResult {
  const candidates = group
    .map((row) => {
      const artifact: ArtifactSpec = {
        id: row.artifactId,
        format: row.format as ArtifactSpec['format'],
        bitsPerWeight: row.bitsPerWeight,
        sizeBytes: row.sizeBytes,
        model: { paramsTotal: row.paramsTotal, paramsActive: row.paramsActive, layers: row.layers, kvHeads: row.kvHeads, headDim: row.headDim, kvBytesPerTokenOverride: row.kvBytesPerTokenOverride, contextLength: row.contextLength },
      };
      const best = compat.evaluateAcrossRuntimes(spec, artifact, runtimes, { contextLength, measurements })[0];
      const runtime = runtimes.find((r) => r.id === best?.runtimeId);
      return { payload: { row, runtime: runtime ? { id: runtime.id, slug: runtime.slug, name: runtime.name } : null }, bitsPerWeight: row.bitsPerWeight, result: best! };
    })
    .filter((c) => c.result && c.payload.runtime);

  const pick = compat.pickRecommended(candidates);
  const first = group[0]!;
  const toRec = (c: (typeof candidates)[number]): CompatRecommendation => ({ row: c.payload.row, runtime: c.payload.runtime!, result: c.result });
  return {
    variantSlug: first.variantSlug,
    variantName: first.variantName,
    variantKind: first.variantKind,
    modelSlug: first.modelSlug,
    modelName: first.modelName,
    familyName: first.familyName,
    developerName: first.developerName,
    architecture: first.architecture,
    paramsTotal: first.paramsTotal,
    paramsActive: first.paramsActive,
    capabilities: first.capabilities,
    licenseName: first.licenseName,
    commercialUse: first.commercialUse,
    recommended: pick ? toRec(pick) : null,
    alternatives: candidates.filter((c) => c !== pick && c.result.fit !== 'none').sort((a, b) => compat.compareResults(a.result, b.result)).map(toRec),
    artifactsConsidered: group.length,
  };
}

function groupByVariant(rows: CompatArtifactRow[]): CompatArtifactRow[][] {
  const byVariant = new Map<string, CompatArtifactRow[]>();
  for (const a of rows) byVariant.set(a.variantId, [...(byVariant.get(a.variantId) ?? []), a]);
  return [...byVariant.values()];
}

export async function runCompatibility(db: Executor, hardware: HardwareSelection, opts: RunCompatOptions): Promise<CompatVariantResult[]> {
  const { artifacts, runtimes, measurements } = await loadCompatCatalog(db);
  const usableRuntimes = opts.runtimeSlugs?.length ? runtimes.filter((r) => opts.runtimeSlugs!.includes(r.slug)) : runtimes;
  const filtered = artifacts.filter(
    (a) => (!opts.capability || a.capabilities.includes(opts.capability)) && (!opts.commercialOnly || a.commercialUse === 'allowed'),
  );
  const results = groupByVariant(filtered).map((group) => evaluateVariant(hardware.spec, group, usableRuntimes, measurements, opts.contextLength));

  const rank = { full: 0, tight: 1, offload: 2, none: 3 } as const;
  return results.sort(
    (a, b) =>
      rank[a.recommended?.result.fit ?? 'none'] - rank[b.recommended?.result.fit ?? 'none'] ||
      b.paramsTotal - a.paramsTotal,
  );
}

export interface ModelSystemCompat {
  system: { slug: string; name: string; formFactor: string };
  best: (CompatRecommendation & { variantSlug: string; variantName: string }) | null;
}

/** For one model, the best recommendation (across its non-base variants) on every reference system. */
export interface ModelCompatSummary {
  /** Reference systems where the best option fits in accelerator memory. */
  runsWell: number;
  /** Systems where it only runs on CPU or with offload. */
  slow: number;
  tooLarge: number;
  of: number;
}

/** For every model, how many reference systems run it well, slowly, or not at all. One catalog load for all models. */
export async function compatSummaryByModel(db: Executor, opts: { contextLength: number }): Promise<Record<string, ModelCompatSummary>> {
  const { artifacts, runtimes, measurements } = await loadCompatCatalog(db);
  const systems = await rows<{ slug: string }>(db, sql`
    select ce.slug from ecosystem.hardware_configuration hc join ecosystem.entity ce on ce.id = hc.id`);
  const hardware = (await Promise.all(systems.map((s) => loadReferenceHardware(db, s.slug)))).filter((h): h is HardwareSelection => h != null);
  const byModel = new Map<string, CompatArtifactRow[][]>();
  for (const group of groupByVariant(artifacts)) {
    const slug = group[0]!.modelSlug;
    byModel.set(slug, [...(byModel.get(slug) ?? []), group]);
  }
  const out: Record<string, ModelCompatSummary> = {};
  for (const [slug, groups] of byModel) {
    const summary: ModelCompatSummary = { runsWell: 0, slow: 0, tooLarge: 0, of: hardware.length };
    for (const hw of hardware) {
      const placements = groups.map((g) => evaluateVariant(hw.spec, g, runtimes, measurements, opts.contextLength).recommended?.result.placement);
      if (placements.includes('accelerator')) summary.runsWell += 1;
      else if (placements.some((p) => p === 'cpu' || p === 'hybrid')) summary.slow += 1;
      else summary.tooLarge += 1;
    }
    out[slug] = summary;
  }
  return out;
}

export async function compatForModelAcrossSystems(db: Executor, modelSlug: string, opts: { contextLength: number }): Promise<ModelSystemCompat[]> {
  const { artifacts, runtimes, measurements } = await loadCompatCatalog(db);
  const groups = groupByVariant(artifacts.filter((a) => a.modelSlug === modelSlug));
  if (!groups.length) return [];
  const systems = await rows<{ slug: string; name: string; formFactor: string }>(db, sql`
    select ce.slug, ce.name, hc.form_factor as "formFactor" from ecosystem.hardware_configuration hc join ecosystem.entity ce on ce.id = hc.id order by ce.name`);
  const out: ModelSystemCompat[] = [];
  for (const system of systems) {
    const hardware = await loadReferenceHardware(db, system.slug);
    if (!hardware) continue;
    const recs = groups
      .map((g) => evaluateVariant(hardware.spec, g, runtimes, measurements, opts.contextLength))
      .flatMap((r) => (r.recommended ? [{ payload: { ...r.recommended, variantSlug: r.variantSlug, variantName: r.variantName }, bitsPerWeight: r.recommended.row.bitsPerWeight, result: r.recommended.result }] : []));
    out.push({ system, best: compat.pickRecommended(recs)?.payload ?? null });
  }
  return out;
}

export async function listHardwarePickerOptions(db: Executor) {
  const configurations = await rows<{ slug: string; name: string; formFactor: string }>(db, sql`
    select ce.slug, ce.name, hc.form_factor as "formFactor" from ecosystem.hardware_configuration hc join ecosystem.entity ce on ce.id = hc.id order by hc.form_factor, ce.name`);
  const devices = await rows<{ slug: string; name: string; deviceKind: string; memoryKind: string; memoryGb: number | null }>(db, sql`
    select de.slug, de.name, d.device_kind as "deviceKind", d.memory_kind as "memoryKind", d.memory_gb as "memoryGb"
    from ecosystem.hardware_device d join ecosystem.entity de on de.id = d.id order by d.device_kind, de.name`);
  const runtimes = await rows<{ slug: string; name: string }>(db, sql`
    select pe.slug, pe.name from ecosystem.runtime rt join ecosystem.entity pe on pe.id = rt.project_id order by pe.name`);
  return { configurations, devices, runtimes };
}

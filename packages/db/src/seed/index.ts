import { createHash } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import type { Database, Executor } from '../client';
import { createAccountWithProfile } from '../identity';
import * as s from '../schema';
import { refreshSearchText } from '../search-text';
import { createArtifact, createEntity, createRelation, createVariant, ensureSource, linkExternalId } from '../writers';
import * as catalog from './catalog';
import * as community from './community';

export const FIXTURE_SOURCE_KEY = 'mutinai-fixtures';

type Kind = (typeof s.entityKind.enumValues)[number];

class Registry {
  private ids = new Map<string, string>();
  set(kind: Kind | 'metric' | 'license' | 'user' | 'profile' | 'user_config' | 'submission' | 'review', key: string, id: string) {
    this.ids.set(`${kind}:${key}`, id);
  }
  get(kind: Parameters<Registry['set']>[0], key: string): string {
    const id = this.ids.get(`${kind}:${key}`);
    if (!id) throw new Error(`seed: unknown ${kind} "${key}"`);
    return id;
  }
}

const hfBase = (repo: string) => repo.split('/')[1]!;

function artifactRepo(variantRepo: string, scheme: string, publisher: string, firstParty: string): string {
  if (scheme === 'bf16') return variantRepo;
  const base = hfBase(variantRepo);
  const owner = { qwen: 'Qwen', unsloth: 'unsloth', 'lmstudio-community': 'lmstudio-community', 'mlx-community': 'mlx-community', deepseek: 'deepseek-ai' }[publisher] ?? publisher;
  if (scheme.startsWith('mlx')) return `${owner}/${base}-${scheme.replace('mlx-', '')}`;
  if (scheme === 'awq-4bit') return `${owner}/${base}-AWQ`;
  if (scheme === 'fp8') return publisher === firstParty ? variantRepo : `${owner}/${base}-FP8`;
  return `${owner}/${base}-GGUF`;
}

export async function seedCatalog(db: Executor): Promise<Registry> {
  const reg = new Registry();
  const sourceId = await ensureSource(db, { key: FIXTURE_SOURCE_KEY, name: 'Mutinai illustrative fixtures', kind: 'fixture', priority: 10 });
  const payload = JSON.stringify(catalog);
  const [record] = await db
    .insert(s.sourceRecord)
    .values({
      sourceId,
      externalId: 'catalog',
      contentHash: createHash('sha256').update(payload).digest('hex'),
      objectKey: 'repo:packages/db/src/seed/catalog.ts',
      contentType: 'application/typescript',
      fetchedAt: new Date(),
      status: 'processed',
      statusDetail: 'Seed catalog. Values are illustrative.',
    })
    .returning({ id: s.sourceRecord.id });
  const sourceRecordId = record!.id;

  for (const l of catalog.licenses) {
    const [row] = await db.insert(s.license).values({ ...l }).returning({ id: s.license.id });
    reg.set('license', l.key, row!.id);
  }

  for (const o of catalog.organizations) {
    const id = await createEntity(db, { kind: 'organization', slug: o.slug, name: o.name, summary: o.summary });
    await db.insert(s.organization).values({ id, orgKind: o.orgKind, websiteUrl: o.websiteUrl, country: o.country });
    reg.set('organization', o.slug, id);
  }
  for (const [namespace, value, slug] of catalog.organizationIdentifiers) {
    await linkExternalId(db, { namespace, value, entityId: reg.get('organization', slug), url: namespace === 'huggingface-org' ? `https://huggingface.co/${value}` : `https://github.com/${value}`, firstSeenRecordId: sourceRecordId });
  }

  for (const f of catalog.families) {
    const id = await createEntity(db, { kind: 'model_family', slug: f.slug, name: f.name, summary: f.summary });
    await db.insert(s.modelFamily).values({ id, developerOrgId: reg.get('organization', f.developer), parentFamilyId: f.parent ? reg.get('model_family', f.parent) : null });
    reg.set('model_family', f.slug, id);
  }

  for (const r of catalog.releases) {
    const id = await createEntity(db, { kind: 'model_release', slug: r.slug, name: r.name, summary: r.summary });
    await db.insert(s.modelRelease).values({ id, familyId: reg.get('model_family', r.family), releasedOn: r.releasedOn, defaultLicenseId: reg.get('license', r.license), announcementUrl: r.announcementUrl });
    reg.set('model_release', r.slug, id);
  }

  for (const m of catalog.models) {
    const id = await createEntity(db, { kind: 'model', slug: m.slug, name: m.name, summary: m.summary });
    await db.insert(s.model).values({
      id, releaseId: reg.get('model_release', m.release), architecture: m.architecture, paramsTotal: m.paramsTotal, paramsActive: m.paramsActive ?? null,
      layers: m.layers, attentionHeads: m.attentionHeads, kvHeads: m.kvHeads, headDim: m.headDim, kvBytesPerTokenOverride: m.kvBytesPerTokenOverride ?? null, contextLength: m.contextLength,
    });
    reg.set('model', m.slug, id);
  }

  for (const sc of catalog.schemes) {
    const id = await createEntity(db, { kind: 'quantization_scheme', slug: sc.slug, name: sc.name, summary: sc.summary });
    await db.insert(s.quantizationScheme).values({ id, method: sc.method, format: sc.format, bitsPerWeight: sc.bitsPerWeight });
    reg.set('quantization_scheme', sc.slug, id);
  }

  const modelBySlug = new Map(catalog.models.map((m) => [m.slug, m]));
  const releaseBySlug = new Map(catalog.releases.map((r) => [r.slug, r]));
  const familyBySlug = new Map(catalog.families.map((f) => [f.slug, f]));
  const schemeBySlug = new Map(catalog.schemes.map((x) => [x.slug, x]));
  const orgBySlug = new Map(catalog.organizations.map((o) => [o.slug, o]));

  for (const v of catalog.variants) {
    const model = modelBySlug.get(v.model)!;
    const release = releaseBySlug.get(model.release)!;
    const developer = familyBySlug.get(release.family)!.developer;
    const id = await createVariant(db, {
      slug: v.slug, name: v.name, modelId: reg.get('model', v.model), kind: v.kind, publisherOrgId: reg.get('organization', v.publisher),
      licenseId: reg.get('license', v.license ?? release.license), capabilities: v.capabilities, releasedOn: v.releasedOn ?? release.releasedOn,
      lineage: (v.lineage ?? []).map((l) => ({ predicate: l.predicate, objectVariantId: reg.get('model_variant', l.object) })),
      aliases: [v.hf, hfBase(v.hf)], sourceRecordId,
    });
    reg.set('model_variant', v.slug, id);
    await linkExternalId(db, { namespace: 'huggingface', value: v.hf, entityId: id, url: `https://huggingface.co/${v.hf}`, firstSeenRecordId: sourceRecordId });

    for (const a of v.artifacts) {
      const spec = typeof a === 'string' ? { scheme: a, publisher: undefined as string | undefined, repo: undefined as string | undefined } : a;
      const scheme = schemeBySlug.get(spec.scheme)!;
      const publisher = spec.publisher ?? (spec.scheme === 'bf16' ? v.publisher : ({ 'q8-0': 'lmstudio-community', 'q6-k': 'lmstudio-community', 'q5-k-m': 'lmstudio-community', 'q4-k-m': 'lmstudio-community', 'q3-k-m': 'unsloth', 'iq2-xxs': 'unsloth', 'mlx-4bit': 'mlx-community', 'mlx-8bit': 'mlx-community' } as Record<string, string>)[spec.scheme] ?? v.publisher);
      const repo = spec.repo ?? artifactRepo(v.hf, spec.scheme, publisher, developer);
      const slug = `${v.slug}--${spec.scheme}`;
      const thirdParty = publisher !== v.publisher;
      const artifactId = await createArtifact(db, {
        slug,
        name: `${v.name} ${scheme.name}${thirdParty ? ` (${orgBySlug.get(publisher)!.name})` : ''}`,
        variantId: id, schemeId: reg.get('quantization_scheme', spec.scheme), publisherOrgId: reg.get('organization', publisher),
        sizeBytes: Math.round((model.paramsTotal * scheme.bitsPerWeight) / 8), sourceRepo: repo,
      });
      reg.set('model_artifact', slug, artifactId);
      await linkExternalId(db, { namespace: 'huggingface-artifact', value: `${repo}:${scheme.name}`, entityId: artifactId, url: `https://huggingface.co/${repo}`, firstSeenRecordId: sourceRecordId });
    }
  }

  for (const d of catalog.devices) {
    const shortName = d.name.replace(/^(NVIDIA|AMD|Apple)\s+(GeForce\s+|Radeon\s+)?/, '');
    const id = await createEntity(db, { kind: 'hardware_device', slug: d.slug, name: d.name, summary: d.summary, aliases: [shortName] });
    await db.insert(s.hardwareDevice).values({
      id, vendorOrgId: reg.get('organization', d.vendor), deviceKind: d.deviceKind, memoryKind: d.memoryKind, memoryGb: d.memoryGb ?? null, memoryType: d.memoryType,
      memoryBandwidthGbps: d.memoryBandwidthGbps ?? null, unifiedUsableFraction: d.unifiedUsableFraction ?? null, backends: d.backends, tdpWatts: d.tdpWatts, releasedOn: d.releasedOn, launchPriceUsd: d.launchPriceUsd,
    });
    reg.set('hardware_device', d.slug, id);
  }

  for (const c of catalog.configurations) {
    const id = await createEntity(db, { kind: 'hardware_configuration', slug: c.slug, name: c.name, summary: c.summary });
    await db.insert(s.hardwareConfiguration).values({ id, formFactor: c.formFactor, systemRamGb: c.systemRamGb, systemRamBandwidthGbps: c.systemRamBandwidthGbps ?? null, unifiedMemoryGb: c.unifiedMemoryGb ?? null, approxPriceUsd: c.approxPriceUsd });
    await db.insert(s.hardwareConfigurationComponent).values(c.components.map((x) => ({ configurationId: id, deviceId: reg.get('hardware_device', x.device), count: x.count })));
    reg.set('hardware_configuration', c.slug, id);
  }

  for (const p of catalog.projects) {
    const id = await createEntity(db, { kind: 'project', slug: p.slug, name: p.name, summary: p.summary, aliases: [p.repo] });
    await db.insert(s.project).values({
      id, category: p.category, maintainerOrgId: p.maintainer ? reg.get('organization', p.maintainer) : null, licenseId: p.license ? reg.get('license', p.license) : null,
      repoUrl: `https://github.com/${p.repo}`, homepageUrl: p.homepage, primaryLanguage: p.language,
    });
    if (p.runtime) await db.insert(s.runtime).values({ projectId: id, ...p.runtime });
    await linkExternalId(db, { namespace: 'github', value: p.repo.toLowerCase(), entityId: id, url: `https://github.com/${p.repo}`, firstSeenRecordId: sourceRecordId });
    reg.set('project', p.slug, id);
  }

  for (const b of catalog.benchmarks) {
    const id = await createEntity(db, { kind: 'benchmark', slug: b.slug, name: b.name, summary: b.summary });
    await db.insert(s.benchmark).values({ id, benchmarkKind: b.kind, homepageUrl: b.homepage, methodology: b.methodology });
    reg.set('benchmark', b.slug, id);
    for (const m of b.metrics) {
      const [row] = await db.insert(s.benchmarkMetric).values({ benchmarkId: id, key: m.key, label: m.label, unit: m.unit, higherIsBetter: m.higherIsBetter ?? true }).returning({ id: s.benchmarkMetric.id });
      reg.set('metric', `${b.slug}.${m.key}`, row!.id);
    }
  }

  for (const r of catalog.capabilityResults) {
    await db.insert(s.benchmarkResult).values({
      benchmarkId: reg.get('benchmark', r.benchmark), metricId: reg.get('metric', `${r.benchmark}.${r.metric}`), variantId: reg.get('model_variant', r.variant),
      value: r.value, evaluationSetting: r.setting, origin: 'developer_reported', sourceRecordId,
    });
  }

  for (const r of catalog.performanceResults) {
    const [env] = await db
      .insert(s.runEnvironment)
      .values({ hardwareConfigurationId: reg.get('hardware_configuration', r.config), runtimeId: reg.get('project', r.runtime), runtimeVersion: r.runtimeVersion, backend: r.backend, contextLength: r.contextLength, batchSize: 1 })
      .returning({ id: s.runEnvironment.id });
    for (const [key, value] of Object.entries(r.values)) {
      await db.insert(s.benchmarkResult).values({
        benchmarkId: reg.get('benchmark', r.benchmark), metricId: reg.get('metric', `${r.benchmark}.${key}`), artifactId: reg.get('model_artifact', r.artifact),
        environmentId: env!.id, value, origin: 'editorial', sourceRecordId,
      });
    }
  }

  for (const r of catalog.relations) {
    await createRelation(db, { subjectId: reg.get(r.subjectKind, r.subject), predicate: r.predicate, objectId: reg.get(r.objectKind, r.object), sourceRecordId });
  }
  for (const r of catalog.successors) {
    await createRelation(db, { subjectId: reg.get(r.kind, r.subject), predicate: 'successor_of', objectId: reg.get(r.kind, r.object), sourceRecordId });
  }

  for (const e of catalog.events) {
    const [row] = await db
      .insert(s.event)
      .values({ eventKind: e.kind, title: e.title, summary: e.summary, occurredAt: new Date(`${e.occurredAt}T12:00:00Z`), url: e.url, sourceRecordId, dedupeKey: `${FIXTURE_SOURCE_KEY}:${e.occurredAt}:${e.title}` })
      .returning({ id: s.event.id });
    await db.insert(s.eventEntity).values(e.entities.map((x, i) => ({ eventId: row!.id, entityId: reg.get(x.kind, x.slug), role: i === 0 ? ('subject' as const) : ('related' as const) })));
  }

  await refreshSearchText(db);
  return reg;
}

export async function seedCommunity(db: Executor, reg: Registry): Promise<void> {
  for (const u of community.users) {
    const { accountId, profileId } = await createAccountWithProfile(db, { authProvider: 'dev', authSubject: u.handle, email: u.email, handle: u.handle, displayName: u.displayName, bio: u.bio, roles: u.roles });
    reg.set('user', u.handle, accountId);
    reg.set('profile', u.handle, profileId);
  }

  for (const c of community.userConfigs) {
    const [row] = await db
      .insert(s.userHardwareConfig)
      .values({ ownerProfileId: reg.get('profile', c.owner), name: c.name, visibility: c.visibility, systemRamGb: c.systemRamGb, systemRamBandwidthGbps: c.systemRamBandwidthGbps ?? null, unifiedMemoryGb: c.unifiedMemoryGb ?? null })
      .returning({ id: s.userHardwareConfig.id });
    await db.insert(s.userHardwareConfigComponent).values(c.components.map((x) => ({ configId: row!.id, deviceId: reg.get('hardware_device', x.device), count: x.count })));
    reg.set('user_config', c.key, row!.id);
  }

  for (const r of community.reviews) {
    const [row] = await db
      .insert(s.review)
      .values({
        authorProfileId: reg.get('profile', r.author), entityId: reg.get(r.subject.kind, r.subject.slug), title: r.title, body: r.body,
        hardwareConfigurationId: r.hardware ? reg.get('hardware_configuration', r.hardware) : null, visibility: r.visibility ?? 'public', status: r.status ?? 'published',
      })
      .returning({ id: s.review.id });
    await db.insert(s.reviewRating).values(Object.entries(r.ratings).map(([dimension, score]) => ({ reviewId: row!.id, dimension: dimension as never, score })));
    reg.set('review', `${r.author}:${r.subject.slug}`, row!.id);
  }

  for (const x of community.submissions) {
    const [env] = await db
      .insert(s.runEnvironment)
      .values({
        hardwareConfigurationId: 'reference' in x.hardware ? reg.get('hardware_configuration', x.hardware.reference) : null,
        userHardwareConfigId: 'user' in x.hardware ? reg.get('user_config', x.hardware.user) : null,
        runtimeId: reg.get('project', x.runtime), runtimeVersion: x.runtimeVersion, backend: x.backend, contextLength: x.contextLength, batchSize: x.batchSize,
        gpuLayers: x.gpuLayers ?? null, kvCacheType: x.kvCacheType, flashAttention: x.flashAttention, os: x.os, driverVersion: x.driverVersion, parameters: x.parameters ?? {},
      })
      .returning({ id: s.runEnvironment.id });
    const [sub] = await db
      .insert(s.benchmarkSubmission)
      .values({
        submitterProfileId: reg.get('profile', x.submitter), artifactId: reg.get('model_artifact', x.artifact), benchmarkId: reg.get('benchmark', x.benchmark), environmentId: env!.id,
        notes: x.notes, visibility: x.visibility ?? 'public', status: x.status ?? 'published', verification: x.verification ?? 'unverified', createdAt: new Date(x.createdAt),
      })
      .returning({ id: s.benchmarkSubmission.id });
    await db.insert(s.submissionMeasurement).values(Object.entries(x.values).map(([key, value]) => ({ submissionId: sub!.id, metricId: reg.get('metric', `${x.benchmark}.${key}`), value })));
    reg.set('submission', x.key, sub!.id);
  }

  for (const v of community.votes) {
    await db.insert(s.vote).values({
      voterProfileId: reg.get('profile', v.voter),
      reviewId: 'review' in v ? reg.get('review', `${v.review.author}:${v.review.subjectSlug}`) : null,
      submissionId: 'submission' in v ? reg.get('submission', v.submission) : null,
      value: v.value,
    });
  }
}

export async function seedDatabase(db: Database, opts: { community?: boolean } = {}): Promise<void> {
  await db.transaction(async (tx) => {
    const [existing] = await tx.select({ id: s.source.id }).from(s.source).where(and(eq(s.source.key, FIXTURE_SOURCE_KEY)));
    if (existing) throw new Error('database already seeded; run `npm run db:reset` first');
    const reg = await seedCatalog(tx);
    if (opts.community ?? true) await seedCommunity(tx, reg);
  });
}

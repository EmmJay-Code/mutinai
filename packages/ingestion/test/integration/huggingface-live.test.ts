import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { catalog, linkExternalId, type DatabaseHandle } from '@mutinai/db';
import { createTestDatabase, resetAndSeed } from '@mutinai/db/testing';
import { createHuggingFaceAdapter, type HfModel } from '../../src/adapters/huggingface';
import { MemoryObjectStore } from '../../src/object-store';
import { dryRunAdapter, IngestionBusyError, runAdapter } from '../../src/pipeline';
import { offlineHub, recordedHf } from '../support/recorded';

let h: DatabaseHandle;
const store = new MemoryObjectStore();
const REPOS = ['Qwen/Qwen3-30B-A3B', 'NousResearch/Hermes-3-Llama-3.1-8B', 'Qwen/Qwen3-8B', 'Qwen/Qwen3-8B-GGUF', 'mlx-community/Qwen3-8B-4bit', 'unsloth/Qwen3-235B-A22B-GGUF', 'Missing/never-existed'];

const live = (opts: Parameters<typeof offlineHub>[0] = {}, repos = REPOS) => createHuggingFaceAdapter({ client: offlineHub(opts).client, repos });

async function counts() {
  const [row] = await h.db.execute<{ entities: number; relations: number; records: number; assertions: number; identifiers: number; reviews: number; metrics: number; jobs: number }>(sql`
    select (select count(*)::int from ecosystem.entity) as entities,
      (select count(*)::int from ecosystem.entity_relation) as relations,
      (select count(*)::int from ingest.source_record) as records,
      (select count(*)::int from ingest.field_assertion) as assertions,
      (select count(*)::int from ingest.external_identifier) as identifiers,
      (select count(*)::int from ingest.review_item) as reviews,
      (select count(*)::int from ecosystem.entity_metric) as metrics,
      (select count(*)::int from jobs.job) as jobs`);
  return row!;
}

async function reviews(externalId: string) {
  return h.db.execute<{ reason: string; subject: string; status: string; blocking: number; candidates: { slug: string; basis: string }[]; suggestion: Record<string, unknown> }>(sql`
    select reason, subject, status::text, blocking, candidates, suggestion from ingest.review_item r join ingest.source s on s.id = r.source_id
    where s.key = 'huggingface' and r.external_id = ${externalId} order by reason, subject`);
}

async function recordStatus(externalId: string) {
  const rows = await h.db.execute<{ status: string }>(sql`
    select sr.status::text from ingest.source_record sr join ingest.source s on s.id = sr.source_id
    where s.key = 'huggingface' and sr.external_id = ${externalId} order by sr.created_at desc limit 1`);
  return rows[0]?.status;
}

beforeAll(async () => {
  h = createTestDatabase();
  await resetAndSeed(h.db, { community: false });
});
afterAll(() => h.close());

describe('live Hugging Face ingestion (recorded Hub responses)', () => {
  it('resolves known variants, creates real derivatives, and queues what it cannot place', async () => {
    const before = await counts();
    const { stats } = await runAdapter({ db: h.db, store }, live());
    expect(stats).toMatchObject({ seen: 7, new: 7, failed: 0, rechecked: 0, unresolved: 4 });

    // Existing seeded variant, matched by Hugging Face repo id: license asserted by the live source.
    const qwen = await catalog.getModelDetail(h.db, 'qwen3-30b-a3b');
    const instruct = qwen!.variants.find((v) => v.externalIds.some((x) => x.value === 'Qwen/Qwen3-30B-A3B'))!;
    const provenance = await catalog.getProvenance(h.db, instruct.id);
    expect(provenance.sources.map((s) => s.kind)).toContain('huggingface');
    expect(provenance.assertions.find((a) => a.field === 'license' && a.sourceName === 'Hugging Face Hub')).toMatchObject({ value: 'apache-2.0' });

    // Community fine-tune of a known base: created with lineage and a reviewed (not guessed) organization kind.
    const llama = await catalog.getModelDetail(h.db, 'llama-3-1-8b');
    const hermes = llama!.variants.find((v) => v.externalIds.some((x) => x.value === 'NousResearch/Hermes-3-Llama-3.1-8B'))!;
    expect(hermes).toMatchObject({ kind: 'fine_tune', publisher: { name: 'NousResearch' }, license: { name: 'Llama 3.1 Community License' } });
    expect(hermes.lineage).toEqual([expect.objectContaining({ predicate: 'fine_tuned_from', slug: 'llama-3-1-8b-base' })]);
    expect(await reviews('NousResearch/Hermes-3-Llama-3.1-8B')).toEqual([expect.objectContaining({ reason: 'new_organization', blocking: 0, status: 'open' })]);

    // Unknown parents block, with candidates and source facts for the editor.
    expect(await recordStatus('Qwen/Qwen3-8B')).toBe('unresolved');
    const [unknownBase] = await reviews('Qwen/Qwen3-8B');
    expect(unknownBase).toMatchObject({ reason: 'unknown_base', subject: 'Qwen/Qwen3-8B-Base', blocking: 1, suggestion: expect.objectContaining({ observed: expect.objectContaining({ paramsTotal: 8190735360 }) }) });
    expect(await reviews('unsloth/Qwen3-235B-A22B-GGUF')).toEqual([expect.objectContaining({ reason: 'unknown_base', subject: 'Qwen/Qwen3-235B-A22B' })]);

    // A repo that never existed and was never ingested produces nothing to review.
    expect(await recordStatus('Missing/never-existed')).toBe('processed');
    expect(await reviews('Missing/never-existed')).toEqual([]);

    // Popularity counters are metrics for resolved entities, never part of the retained snapshot.
    const metrics = await h.db.execute<{ metric: string }>(sql`select metric from ecosystem.entity_metric where entity_id = ${instruct.id} order by metric`);
    expect(metrics.map((m) => m.metric)).toEqual(['downloads', 'likes']);
    for (const { body } of store.objects.values()) expect(new TextDecoder().decode(body)).not.toMatch(/"downloads"|"likes"/);

    const after = await counts();
    expect(after.entities - before.entities).toBe(2); // Hermes variant + NousResearch organization
  });

  it('re-running is idempotent: unchanged snapshots are skipped and unresolved ones re-checked without duplication', async () => {
    const before = await counts();
    const { stats } = await runAdapter({ db: h.db, store }, live());
    expect(stats).toMatchObject({ seen: 7, new: 0, unchanged: 3, rechecked: 4, resolved: 0, entitiesCreated: 0, eventsCreated: 0 });
    expect(await counts()).toEqual(before);
  });

  it('an editorial identifier mapping lets blocked artifacts apply on the next re-check', async () => {
    // Stand-in for an editor mapping Qwen/Qwen3-8B to a catalog variant (a similar-sized seeded variant is used here).
    const [target] = await h.db.execute<{ id: string }>(sql`select id from ecosystem.entity where kind = 'model_variant' and slug = 'qwen2-5-7b-instruct'`);
    await linkExternalId(h.db, { namespace: 'huggingface', value: 'Qwen/Qwen3-8B', entityId: target!.id });

    const { stats } = await runAdapter({ db: h.db, store }, live());
    expect(stats.resolved).toBe(3); // Qwen/Qwen3-8B now resolves by identifier; the MLX and GGUF repos apply completely
    expect(await recordStatus('mlx-community/Qwen3-8B-4bit')).toBe('processed');
    expect(await reviews('mlx-community/Qwen3-8B-4bit')).toEqual([expect.objectContaining({ reason: 'unknown_base', status: 'superseded' })]);

    // Every scheme in the GGUF repo is a llama.cpp type the catalog defines (Q5_0 included), so nothing stays blocked.
    const ggufReviews = await reviews('Qwen/Qwen3-8B-GGUF');
    expect(ggufReviews.filter((r) => r.status === 'open')).toEqual([]);
    // Identified by the artifact identifiers this source attached: an artifact that already existed for the same
    // variant, scheme and publisher is reused (and its size corrected by the higher-priority live source), not duplicated.
    const artifacts = await h.db.execute<{ scheme: string; size_bytes: number; publisher: string }>(sql`
      select se.name as scheme, a.size_bytes, pe.slug as publisher from ecosystem.model_artifact a
      join ingest.external_identifier x on x.entity_id = a.id and x.namespace = 'huggingface-artifact'
      join ecosystem.entity se on se.id = a.scheme_id join ecosystem.entity pe on pe.id = a.publisher_org_id
      where x.value like 'Qwen/Qwen3-8B-GGUF:%' or x.value like 'mlx-community/Qwen3-8B-4bit:%' order by se.name`);
    expect(artifacts.map((a) => [a.scheme, Number(a.size_bytes), a.publisher])).toEqual([
      ['MLX 4-bit', 4607835174, 'mlx-community'],
      ['Q4_K_M', 5027783488, 'qwen'],
      ['Q5_0', expect.any(Number), 'qwen'],
      ['Q5_K_M', expect.any(Number), 'qwen'],
      ['Q6_K', expect.any(Number), 'qwen'],
      ['Q8_0', expect.any(Number), 'qwen'],
    ]);

    // The mapped first-party variant itself resolves by identifier now (no duplicate variant created).
    expect(await recordStatus('Qwen/Qwen3-8B')).toBe('processed');
    const before = await counts();
    await runAdapter({ db: h.db, store }, live());
    expect(await counts()).toEqual(before);
  });

  it('changed upstream data creates a new snapshot and updates canonical fields; counter-only changes do not', async () => {
    const hermes = recordedHf('hermes-3-llama-3.1-8b');
    const countersOnly: HfModel = { ...hermes, downloads: (hermes.downloads ?? 0) + 1000, likes: (hermes.likes ?? 0) + 5, lastModified: '2030-01-01T00:00:00.000Z' };
    const quiet = await runAdapter({ db: h.db, store }, live({ overrides: { 'NousResearch/Hermes-3-Llama-3.1-8B': countersOnly } }, ['NousResearch/Hermes-3-Llama-3.1-8B']));
    expect(quiet.stats).toMatchObject({ new: 0, unchanged: 1, metrics: 2 });

    const relicensed: HfModel = { ...hermes, cardData: { ...hermes.cardData, license: 'mit' } };
    const changed = await runAdapter({ db: h.db, store }, live({ overrides: { 'NousResearch/Hermes-3-Llama-3.1-8B': relicensed } }, ['NousResearch/Hermes-3-Llama-3.1-8B']));
    expect(changed.stats).toMatchObject({ new: 1, fieldsUpdated: 1 });
    const [variant] = await h.db.execute<{ id: string }>(sql`select entity_id as id from ingest.external_identifier where namespace = 'huggingface' and value = 'NousResearch/Hermes-3-Llama-3.1-8B'`);
    const provenance = await catalog.getProvenance(h.db, variant!.id);
    expect(provenance.assertions.filter((a) => a.field === 'license').map((a) => [a.value, a.applied])).toEqual(expect.arrayContaining([['mit', true]]));
  });

  it('a previously ingested repo that disappears is reported for review and its entity retained', async () => {
    const { stats } = await runAdapter({ db: h.db, store }, live({ overrides: { 'NousResearch/Hermes-3-Llama-3.1-8B': { status: 401 } } }, ['NousResearch/Hermes-3-Llama-3.1-8B']));
    expect(stats).toMatchObject({ new: 1, failed: 0 });
    expect(await reviews('NousResearch/Hermes-3-Llama-3.1-8B')).toEqual(expect.arrayContaining([expect.objectContaining({ reason: 'source_unavailable', blocking: 0, candidates: [expect.objectContaining({ basis: 'external identifier' })] })]));
    const [still] = await h.db.execute<{ n: number }>(sql`select count(*)::int as n from ingest.external_identifier where value = 'NousResearch/Hermes-3-Llama-3.1-8B'`);
    expect(still!.n).toBe(1);
  });

  it('dry runs report what would happen and persist nothing', async () => {
    const tune: HfModel = { id: 'Example/Llama-3.1-8B-Tune', pipeline_tag: 'text-generation', baseModels: { relation: 'finetune', models: [{ id: 'meta-llama/Llama-3.1-8B' }] }, cardData: { license: 'llama3.1' } };
    const before = await counts();
    const result = await dryRunAdapter({ db: h.db, store }, live({ overrides: { 'Example/Llama-3.1-8B-Tune': tune } }, ['Example/Llama-3.1-8B-Tune']));
    expect(result.stats).toMatchObject({ new: 1, entitiesCreated: 2 });
    expect(await counts()).toEqual(before);
    const [runs] = await h.db.execute<{ n: number }>(sql`select count(*)::int as n from ingest.ingestion_run where options->>'dryRun' = 'true'`);
    expect(runs!.n).toBe(0);
  });

  it('refuses to start while another run of the same source is in progress', async () => {
    const [src] = await h.db.execute<{ id: string }>(sql`select id from ingest.source where key = 'huggingface'`);
    await h.db.execute(sql`insert into ingest.ingestion_run (source_id, status) values (${src!.id}, 'running')`);
    try {
      await expect(runAdapter({ db: h.db, store }, live())).rejects.toBeInstanceOf(IngestionBusyError);
    } finally {
      await h.db.execute(sql`delete from ingest.ingestion_run where source_id = ${src!.id} and status = 'running'`);
    }
  });
});

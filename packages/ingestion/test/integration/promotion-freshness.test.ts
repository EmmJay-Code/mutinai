import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { catalog, type DatabaseHandle } from '@mutinai/db';
import { createTestDatabase, resetAndSeed } from '@mutinai/db/testing';
import { selectDiscover } from '@mutinai/domain';
import type { SourceDescriptor } from '../../src/adapter';
import { createFixtureGitHubAdapter, type GitHubRepo } from '../../src/adapters/github';
import { createFixtureHuggingFaceAdapter, type HfModel } from '../../src/adapters/huggingface';
import { MemoryObjectStore } from '../../src/object-store';
import { runAdapter } from '../../src/pipeline';

// Live-kind sources fed with fixed payloads, so the data counts as live (not fixture) without network access.
const HF: SourceDescriptor = { key: 'test-huggingface', name: 'Hugging Face (test)', kind: 'huggingface', baseUrl: 'https://huggingface.co', priority: 60 };
const GH: SourceDescriptor = { key: 'test-github', name: 'GitHub (test)', kind: 'github', baseUrl: 'https://github.com', priority: 60 };
const NOW = new Date('2026-09-13T12:00:00Z');

let h: DatabaseHandle;
const store = new MemoryObjectStore();

const facts = { layers: 40, attentionHeads: 40, kvHeads: 8, headDim: 128, contextLength: 131072 };
const root = (id: string, over: Partial<HfModel> = {}): HfModel => ({
  id,
  author: id.split('/')[0],
  createdAt: '2026-09-01T10:00:00.000Z',
  pipeline_tag: 'text-generation',
  library_name: 'transformers',
  tags: ['conversational', 'license:apache-2.0'],
  cardData: { license: 'apache-2.0' },
  safetensors: { total: 14_770_033_664 },
  architecture: facts,
  siblings: [{ rfilename: 'model.safetensors', size: 1 }],
  ...over,
});
const derivative = (id: string, base: string): HfModel => ({
  id,
  createdAt: '2026-08-20T10:00:00.000Z',
  pipeline_tag: 'text-generation',
  tags: ['license:llama3.1'],
  cardData: { license: 'llama3.1' },
  baseModels: { relation: 'finetune', models: [{ id: base }] },
  siblings: [{ rfilename: 'model.safetensors', size: 1 }],
});

const models: HfModel[] = [
  root('Qwen/Qwen4-14B-Instruct'),
  root('Qwen/Qwen4-32B', { safetensors: { total: 32_763_876_352 }, architecture: { ...facts, layers: 64 } }),
  root('Qwen/Qwen4-Flash'),
  root('Qwen/Qwen4-235B', { safetensors: { total: 235_093_634_560 }, architecture: { ...facts, experts: 128, expertsPerToken: 8 } }),
  root('someone/Nova2-14B-Instruct'),
  root('someone/Qwen4-14B-Instruct'),
  derivative('communitylab/Llama-3.1-8B-Instruct-Pirate', 'meta-llama/Llama-3.1-8B-Instruct'),
  derivative('mirroracct/Llama-3.1-8B-Instruct', 'meta-llama/Llama-3.1-8B-Instruct'),
];

async function reviews() {
  return h.db.execute<{ external_id: string; reason: string; status: string; blocking: number; suggestion: { promotion?: { failed?: { rule: string }[] } } }>(sql`
    select ri.external_id, ri.reason, ri.status::text as status, ri.blocking, ri.suggestion
    from ingest.review_item ri join ingest.source s on s.id = ri.source_id where s.key = ${HF.key} order by 1, 2`);
}

async function recordStatus(externalId: string) {
  const [row] = await h.db.execute<{ status: string }>(sql`
    select sr.status::text as status from ingest.source_record sr join ingest.source s on s.id = sr.source_id where s.key = ${HF.key} and sr.external_id = ${externalId}`);
  return row?.status;
}

beforeAll(async () => {
  h = createTestDatabase();
  await resetAndSeed(h.db, { community: false });
});
afterAll(() => h.close());

describe('first-party release promotion', () => {
  it('adds a high-confidence first-party release, model and variant with their evidence, dated by publication', async () => {
    const { stats } = await runAdapter({ db: h.db, store }, createFixtureHuggingFaceAdapter({ models, source: HF }));
    expect(stats).toMatchObject({ seen: 8, failed: 0 });

    const model = await catalog.getModelDetail(h.db, 'qwen4-14b');
    expect(model).toMatchObject({
      name: 'Qwen4 14B',
      architecture: 'dense',
      paramsTotal: 14_770_033_664,
      layers: 40,
      kvHeads: 8,
      contextLength: 131072,
      release: { slug: 'qwen4', name: 'Qwen4', releasedOn: '2026-09-01' },
      family: { slug: 'qwen' },
      developer: { slug: 'qwen' },
    });
    expect(model!.variants).toEqual([
      expect.objectContaining({ slug: 'qwen4-14b-instruct', kind: 'instruct', publisher: expect.objectContaining({ slug: 'qwen' }), releasedOn: '2026-09-01', externalIds: [expect.objectContaining({ namespace: 'huggingface', value: 'Qwen/Qwen4-14B-Instruct' })] }),
    ]);
    const provenance = await catalog.getProvenance(h.db, model!.variants[0]!.id);
    const promotion = provenance.assertions.find((a) => a.field === 'auto_promotion')!.value as { evidence: string[] };
    expect(promotion.evidence.join('\n')).toMatch(/config\.json: 40 layers/);
    expect(await recordStatus('Qwen/Qwen4-14B-Instruct')).toBe('processed');

    const releaseEvents = (await catalog.listEvents(h.db, { limit: 500 })).filter((e) => e.title === 'Qwen4 released');
    expect(releaseEvents).toHaveLength(1);
    expect(releaseEvents[0]).toMatchObject({ kind: 'model_release', sourceKind: 'huggingface', entities: [expect.objectContaining({ slug: 'qwen4', role: 'subject' }), expect.objectContaining({ slug: 'qwen' })] });
    expect(new Date(releaseEvents[0]!.occurredAt).toISOString()).toBe('2026-09-01T00:00:00.000Z');
  });

  it('adds structure but withholds the variant when the name does not state its kind', async () => {
    const model = await catalog.getModelDetail(h.db, 'qwen4-32b');
    expect(model).toMatchObject({ name: 'Qwen4 32B', layers: 64, release: { slug: 'qwen4' }, variants: [] });
    expect((await reviews()).filter((r) => r.external_id === 'Qwen/Qwen4-32B')).toEqual([expect.objectContaining({ reason: 'first_party_variant_kind', status: 'open', blocking: 1 })]);
    expect(await recordStatus('Qwen/Qwen4-32B')).toBe('unresolved');
  });

  it('keeps ambiguous models unresolved and creates nothing for them', async () => {
    const all = await reviews();
    const failed = (repo: string) => all.find((r) => r.external_id === repo && r.reason === 'new_first_party_model')!.suggestion.promotion!.failed!.map((f) => f.rule);
    expect(failed('Qwen/Qwen4-Flash')).toEqual(['name_not_parsed']);
    expect(failed('Qwen/Qwen4-235B')).toEqual(['moe_active_params_unknown']);
    expect(failed('someone/Nova2-14B-Instruct')).toEqual(['publisher_not_known_developer']);
    for (const repo of ['Qwen/Qwen4-Flash', 'Qwen/Qwen4-235B', 'someone/Nova2-14B-Instruct']) expect(await recordStatus(repo)).toBe('unresolved');
    // Another account publishing under the name of Qwen's new variant is a re-upload, not a second model.
    expect(all.filter((r) => r.external_id === 'someone/Qwen4-14B-Instruct')).toEqual([expect.objectContaining({ reason: 'possible_reupload', blocking: 0 })]);

    const [counts] = await h.db.execute<{ models: number; someone: number }>(sql`
      select (select count(*)::int from ecosystem.entity where kind = 'model' and slug like 'qwen4%') as models,
        (select count(*)::int from ecosystem.entity where kind = 'organization' and name = 'someone') as someone`);
    expect(counts).toEqual({ models: 2, someone: 0 });
  });

  it('records community publishers as accounts, not trusted ecosystem organizations', async () => {
    const llama = await catalog.getModelDetail(h.db, 'llama-3-1-8b');
    const pirate = llama!.variants.find((v) => v.externalIds.some((x) => x.value === 'communitylab/Llama-3.1-8B-Instruct-Pirate'))!;
    expect(pirate).toMatchObject({ kind: 'fine_tune', publisher: { name: 'communitylab' } });

    const [org] = await h.db.execute<{ recognized: boolean }>(sql`select o.recognized from ecosystem.organization o join ecosystem.entity e on e.id = o.id where e.name = 'communitylab'`);
    expect(org).toEqual({ recognized: false });
    expect((await catalog.searchEntities(h.db, 'communitylab')).filter((hit) => hit.kind === 'organization' && hit.name === 'communitylab')).toEqual([]);
    expect((await catalog.searchEntities(h.db, 'Qwen Team')).some((hit) => hit.kind === 'organization' && hit.slug === 'qwen')).toBe(true);
    expect((await catalog.listModelFacets(h.db)).developers.map((d) => d.slug)).not.toContain(pirate.publisher.slug);
  });

  it('does not create a variant for a re-upload that repeats its base’s name', async () => {
    expect((await reviews()).filter((r) => r.external_id === 'mirroracct/Llama-3.1-8B-Instruct')).toEqual([expect.objectContaining({ reason: 'possible_reupload', blocking: 0 })]);
    const [row] = await h.db.execute<{ n: number }>(sql`
      select (select count(*)::int from ingest.external_identifier where value = 'mirroracct/Llama-3.1-8B-Instruct')
        + (select count(*)::int from ecosystem.entity where kind = 'organization' and name = 'mirroracct') as n`);
    expect(row!.n).toBe(0);
    expect(await recordStatus('mirroracct/Llama-3.1-8B-Instruct')).toBe('processed');
  });

  it('re-evaluating the same snapshots creates nothing new', async () => {
    const before = (await catalog.listEvents(h.db, { limit: 500 })).length;
    const { stats } = await runAdapter({ db: h.db, store }, createFixtureHuggingFaceAdapter({ models, source: HF }));
    expect(stats).toMatchObject({ new: 0, entitiesCreated: 0, eventsCreated: 0 });
    expect((await catalog.listEvents(h.db, { limit: 500 })).length).toBe(before);
  });
});

describe('time-sensitive surfaces over ingested data', () => {
  const vllm: GitHubRepo = {
    full_name: 'vllm-project/vllm',
    html_url: 'https://github.com/vllm-project/vllm',
    description: 'A high-throughput and memory-efficient inference and serving engine for LLMs',
    homepage: null,
    language: 'Python',
    license: null,
    releases: [
      { tag_name: 'v0.29.1', name: 'v0.29.1', published_at: '2026-09-12T08:00:00Z', html_url: 'https://github.com/vllm-project/vllm/releases/tag/v0.29.1', prerelease: false, body: 'A patch release on top of v0.29.0.' },
      { tag_name: 'v0.29.0', name: 'v0.29.0', published_at: '2026-09-09T08:54:49Z', html_url: 'https://github.com/vllm-project/vllm/releases/tag/v0.29.0', prerelease: false, body: null },
      // An old release first ingested now: its event time is 2025, whatever the ingest time.
      { tag_name: 'v0.10.0', name: 'v0.10.0', published_at: '2025-01-15T08:00:00Z', html_url: 'https://github.com/vllm-project/vllm/releases/tag/v0.10.0', prerelease: false, body: null },
    ],
  };

  it('Top story, Latest and recent counts follow event time, and fixtures never compete with live data', async () => {
    await runAdapter({ db: h.db, store }, createFixtureGitHubAdapter({ repos: [vllm], source: GH }));
    const events = await catalog.listEvents(h.db, { limit: 1000 });
    const backfilled = events.find((e) => e.title === 'vLLM v0.10.0')!;
    expect(new Date(backfilled.discoveredAt).getTime()).toBeGreaterThan(new Date('2026-01-01T00:00:00Z').getTime());

    const { mode, topStory, latest, recentReleaseCount } = selectDiscover(events, NOW);
    expect(mode).toBe('live');
    expect(topStory?.title).toBe('Qwen4 released');
    expect(latest.map((e) => e.title)).toEqual(['vLLM v0.29.0', 'vLLM v0.10.0']);
    expect(latest.some((e) => e.sourceKind === 'fixture')).toBe(false);
    expect(recentReleaseCount).toBe(2);
  });

  it('new releases are ordered by their release date, not by when they were added', async () => {
    const releases = await catalog.listRecentReleases(h.db, 2);
    expect(releases.map((r) => [r.slug, r.releasedOn])).toEqual([['qwen4', '2026-09-01'], ['qwen3', '2025-04-29']]);
  });
});

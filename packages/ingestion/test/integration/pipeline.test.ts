import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { catalog, type DatabaseHandle } from '@mutinai/db';
import { createTestDatabase, resetAndSeed } from '@mutinai/db/testing';
import { createFixtureGitHubAdapter, type GitHubRepo } from '../../src/adapters/github';
import { createFixtureHuggingFaceAdapter } from '../../src/adapters/huggingface';
import { createFixtureRssAdapter } from '../../src/adapters/rss';
import { MemoryObjectStore } from '../../src/object-store';
import { runAdapter } from '../../src/pipeline';
import githubFixture from '../../fixtures/github-repos.json';

let h: DatabaseHandle;
const store = new MemoryObjectStore();

async function snapshot() {
  const [row] = await h.db.execute<{ entities: number; relations: number; events: number; event_links: number; records: number; assertions: number; identifiers: number; jobs: number }>(sql`
    select (select count(*)::int from ecosystem.entity) as entities,
      (select count(*)::int from ecosystem.entity_relation) as relations,
      (select count(*)::int from ecosystem.event) as events,
      (select count(*)::int from ecosystem.event_entity) as event_links,
      (select count(*)::int from ingest.source_record) as records,
      (select count(*)::int from ingest.field_assertion) as assertions,
      (select count(*)::int from ingest.external_identifier) as identifiers,
      (select count(*)::int from jobs.job) as jobs`);
  return row!;
}

const all = () => [createFixtureHuggingFaceAdapter(), createFixtureGitHubAdapter(), createFixtureRssAdapter()];

beforeAll(async () => {
  h = createTestDatabase();
  await resetAndSeed(h.db, { community: false });
});
afterAll(() => h.close());

describe('fixture ingestion', () => {
  it('first run creates new entities, links provenance, and records unresolved items', async () => {
    const before = await snapshot();
    const hf = await runAdapter({ db: h.db, store }, createFixtureHuggingFaceAdapter());
    expect(hf.stats).toMatchObject({ seen: 5, new: 5, unchanged: 0, failed: 0 });
    expect(hf.stats.unresolved).toBe(2); // unknown GGUF scheme in Hermes repo + mystery merge
    expect(hf.stats.entitiesCreated).toBe(7); // Hermes variant + NousResearch org + 3 Hermes GGUF + 2 Qwen GGUF

    const hermes = await catalog.getModelDetail(h.db, 'llama-3-1-8b');
    const variant = hermes!.variants.find((v) => v.externalIds.some((x) => x.value === 'NousResearch/Hermes-3-Llama-3.1-8B'))!;
    expect(variant).toMatchObject({ kind: 'fine_tune', publisher: { name: 'NousResearch' }, license: { name: 'Llama 3.1 Community License' } });
    expect(variant.lineage).toEqual([expect.objectContaining({ direction: 'outgoing', predicate: 'fine_tuned_from', slug: 'llama-3-1-8b-base' })]);
    expect(variant.artifacts.map((a) => a.schemeName).sort()).toEqual(['Q4_K_M', 'Q6_K', 'Q8_0']);
    expect(variant.capabilities).toEqual(['chat', 'tool_use']);

    const qwen = await catalog.getModelDetail(h.db, 'qwen3-30b-a3b');
    const q4 = qwen!.variants.find((v) => v.slug === 'qwen3-30b-a3b')!.artifacts.filter((a) => a.schemeName === 'Q4_K_M');
    expect(q4.map((a) => a.publisher.slug).sort()).toEqual(['qwen', 'unsloth']); // first-party GGUF resolves the publisher via huggingface-org id

    const records = await h.db.execute<{ external_id: string; status: string; status_detail: string | null }>(sql`
      select external_id, status, status_detail from ingest.source_record sr join ingest.source s on s.id = sr.source_id where s.key = 'fixture-huggingface' order by external_id`);
    expect(records.find((r) => r.external_id === 'someone/mystery-merge-7B')).toMatchObject({ status: 'unresolved', status_detail: expect.stringContaining('not a known variant') });
    expect(records.find((r) => r.external_id === 'NousResearch/Hermes-3-Llama-3.1-8B-GGUF')?.status_detail).toContain('Q9_EXPERIMENTAL');
    expect(store.objects.size).toBe(5);

    const gh = await runAdapter({ db: h.db, store }, createFixtureGitHubAdapter());
    expect(gh.stats).toMatchObject({ seen: 4, new: 4, unresolved: 1, eventsCreated: 2 });
    const rss = await runAdapter({ db: h.db, store }, createFixtureRssAdapter());
    expect(rss.stats).toMatchObject({ seen: 3, new: 3, eventsCreated: 3 });

    const events = await catalog.listEvents(h.db, { limit: 100 });
    const hermesEvent = events.find((e) => e.title.startsWith('Hermes 3'))!;
    expect(hermesEvent.entities.map((e) => e.slug).sort()).toEqual(['hermes-3-llama-3-1-8b', 'llama-3-1']);
    expect(events.find((e) => e.title === 'Ollama v0.7.0')?.entities.map((e) => e.slug)).toEqual(['ollama']);

    const after = await snapshot();
    expect(after.entities - before.entities).toBe(7);
    const [jobKinds] = await h.db.execute<{ kinds: string[] }>(sql`select array_agg(distinct kind order by kind) as kinds from jobs.job`);
    expect(jobKinds!.kinds).toEqual(['compat.invalidate', 'enrich.entity', 'search.reindex_entity']);
  });

  it('re-running the same sources is a no-op', async () => {
    const before = await snapshot();
    for (const adapter of all()) {
      const { stats } = await runAdapter({ db: h.db, store }, adapter);
      expect(stats.new).toBe(0);
      expect(stats.unchanged).toBe(stats.seen);
    }
    expect(await snapshot()).toEqual(before);
  });

  it('a changed payload creates a new snapshot, updates canonical fields and keeps history', async () => {
    const repos = (githubFixture as GitHubRepo[]).map((r) => (r.full_name === 'vllm-project/vllm' ? { ...r, description: 'Fast LLM serving (updated)' } : r));
    const before = await snapshot();
    const { stats } = await runAdapter({ db: h.db, store }, createFixtureGitHubAdapter({ repos }));
    expect(stats).toMatchObject({ new: 1, unchanged: 3, fieldsUpdated: 1 });

    const vllm = await catalog.getProjectDetail(h.db, 'vllm');
    expect(vllm!.summary).toBe('Fast LLM serving (updated)');
    const provenance = await catalog.getProvenance(h.db, vllm!.id);
    const summaries = provenance.assertions.filter((a) => a.field === 'summary');
    expect(summaries.map((a) => [a.value, a.applied])).toEqual(
      expect.arrayContaining([['Fast LLM serving (updated)', true], ['A high-throughput and memory-efficient inference and serving engine for LLMs', false]]),
    );
    const after = await snapshot();
    expect(after.records - before.records).toBe(1);
    expect(after.entities).toBe(before.entities);
    expect(after.jobs).toBe(before.jobs); // search/enrich jobs for vllm were still pending → deduplicated
  });

  it('lower-priority sources add assertions without overwriting higher-priority values', async () => {
    const low = createFixtureGitHubAdapter({
      source: { key: 'fixture-github-mirror', name: 'GitHub mirror (fixture)', kind: 'fixture', priority: 5 },
      repos: (githubFixture as GitHubRepo[]).filter((r) => r.full_name === 'vllm-project/vllm').map((r) => ({ ...r, description: 'Stale mirror description' })),
    });
    const { stats } = await runAdapter({ db: h.db, store }, low);
    expect(stats).toMatchObject({ new: 1, fieldsUpdated: 0 });
    const vllm = await catalog.getProjectDetail(h.db, 'vllm');
    expect(vllm!.summary).toBe('Fast LLM serving (updated)');
    // Same identifier from a different source resolved to the same entity.
    const [row] = await h.db.execute<{ n: number }>(sql`select count(*)::int as n from ecosystem.entity where kind = 'project' and slug like 'vllm%'`);
    expect(row!.n).toBe(1);
  });
});

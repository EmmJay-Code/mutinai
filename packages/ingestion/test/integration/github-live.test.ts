import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { catalog, type DatabaseHandle } from '@mutinai/db';
import { createTestDatabase, resetAndSeed } from '@mutinai/db/testing';
import { createGitHubAdapter } from '../../src/adapters/github';
import { MemoryObjectStore } from '../../src/object-store';
import { runAdapter } from '../../src/pipeline';
import { offlineGitHub, recordedGitHub } from '../support/github';

let h: DatabaseHandle;
const store = new MemoryObjectStore();

const llamaRepo = recordedGitHub('llama-cpp-repo') as Record<string, unknown>;
const stable = { tag_name: 'v1.0.0', name: 'llama.cpp 1.0', published_at: '2026-09-10T12:00:00Z', html_url: 'https://github.com/ggml-org/llama.cpp/releases/tag/v1.0.0', prerelease: false, draft: false, body: '\n## Highlights\nMuch faster.\n' };
const draft = { ...stable, tag_name: 'v1.1.0-draft', draft: true };
const releases = [...(recordedGitHub('llama-cpp-releases') as unknown[]), stable, draft];

const adapter = (repos: Record<string, { repo: unknown; releases: unknown }>, names: string[]) => createGitHubAdapter({ client: offlineGitHub({ repos }).client, repos: names });

async function events() {
  return h.db.execute<{ title: string; summary: string | null; dedupe_key: string }>(sql`
    select e.title, e.summary, e.dedupe_key from ecosystem.event e join ingest.source_record sr on sr.id = e.source_record_id
    join ingest.source s on s.id = sr.source_id where s.key = 'github' order by e.occurred_at`);
}

beforeAll(async () => {
  h = createTestDatabase();
  await resetAndSeed(h.db, { community: false });
});
afterAll(() => h.close());

describe('live GitHub ingestion (recorded API responses)', () => {
  it('updates known projects, creates stable-release events only, and records metrics', async () => {
    const { stats } = await runAdapter({ db: h.db, store }, adapter({ 'ggml-org/llama.cpp': { repo: llamaRepo, releases } }, ['ggml-org/llama.cpp', 'ggml-org/unknown-repo']));
    expect(stats).toMatchObject({ seen: 2, new: 2, failed: 0, eventsCreated: 1, metrics: 3 });

    const project = await catalog.getProjectDetail(h.db, 'llama-cpp');
    expect(project!.homepageUrl).toBe('https://llama.app');
    expect(await events()).toEqual([{ title: 'llama.cpp llama.cpp 1.0', summary: '## Highlights', dedupe_key: 'github:ggml-org/llama.cpp:release:v1.0.0' }]);
    const provenance = await catalog.getProvenance(h.db, project!.id);
    expect(provenance.sources.map((s) => s.name)).toContain('GitHub');
  });

  it('is idempotent when run again, including through conditional requests', async () => {
    const [before] = await h.db.execute(sql`select (select count(*)::int from ecosystem.event) as e, (select count(*)::int from ingest.source_record) as r, (select count(*)::int from ecosystem.entity_metric) as m`);
    const again = await runAdapter({ db: h.db, store }, adapter({ 'ggml-org/llama.cpp': { repo: llamaRepo, releases } }, ['ggml-org/llama.cpp']));
    expect(again.stats).toMatchObject({ new: 0, eventsCreated: 0 });
    const [after] = await h.db.execute(sql`select (select count(*)::int from ecosystem.event) as e, (select count(*)::int from ingest.source_record) as r, (select count(*)::int from ecosystem.entity_metric) as m`);
    expect(after).toEqual(before);
  });

  it('a release seen by another source with the same identity is one event', async () => {
    const edited = releases.map((r) => ((r as { tag_name: string }).tag_name === 'v1.0.0' ? { ...(r as object), name: 'llama.cpp 1.0 (edited)' } : r));
    const { stats } = await runAdapter({ db: h.db, store }, adapter({ 'ggml-org/llama.cpp': { repo: llamaRepo, releases: edited } }, ['ggml-org/llama.cpp']));
    expect(stats).toMatchObject({ new: 1, eventsCreated: 0, eventsUpdated: 1 });
    expect((await events()).map((e) => e.title)).toEqual(['llama.cpp llama.cpp 1.0 (edited)']);
  });
});

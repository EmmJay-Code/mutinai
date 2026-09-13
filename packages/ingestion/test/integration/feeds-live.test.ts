import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { type DatabaseHandle } from '@mutinai/db';
import { createTestDatabase, resetAndSeed } from '@mutinai/db/testing';
import { createFeedAdapter, type FeedConfig } from '../../src/adapters/feed';
import { createGitHubAdapter } from '../../src/adapters/github';
import { MemoryObjectStore } from '../../src/object-store';
import { runAdapter } from '../../src/pipeline';
import { offlineFeeds, recordedFeed } from '../support/feeds';
import { offlineGitHub, recordedGitHub } from '../support/github';

let h: DatabaseHandle;
const store = new MemoryObjectStore();
const feeds: FeedConfig[] = [
  { key: 'ollama-releases', name: 'Ollama releases', url: 'https://github.com/ollama/ollama/releases.atom', kind: 'runtime_release', githubReleasesOf: 'ollama/ollama' },
  { key: 'qwen-blog', name: 'Qwen blog', url: 'https://qwenlm.github.io/blog/index.xml', identifiers: [{ namespace: 'huggingface-org', value: 'Qwen' }] },
];
const documents = () => ({ [feeds[0]!.url]: { body: recordedFeed('ollama-releases') }, [feeds[1]!.url]: { body: recordedFeed('qwen-blog') } });

async function eventsFor(dedupePrefix: string) {
  return h.db.execute<{ title: string; kind: string; links: string[]; source: string }>(sql`
    select e.title, e.event_kind::text as kind, s.key as source,
      coalesce((select array_agg(en.slug order by en.slug) from ecosystem.event_entity ee join ecosystem.entity en on en.id = ee.entity_id where ee.event_id = e.id), '{}') as links
    from ecosystem.event e join ingest.source_record sr on sr.id = e.source_record_id join ingest.source s on s.id = sr.source_id
    where e.dedupe_key like ${`${dedupePrefix}%`} order by e.occurred_at desc`);
}

beforeAll(async () => {
  h = createTestDatabase();
  await resetAndSeed(h.db, { community: false });
});
afterAll(() => h.close());

describe('live feed ingestion (recorded documents)', () => {
  it('creates linked events from official feeds', async () => {
    const { stats } = await runAdapter({ db: h.db, store }, createFeedAdapter({ client: offlineFeeds(documents()).client, feeds }));
    expect(stats).toMatchObject({ seen: 4, new: 4, failed: 0, eventsCreated: 4 });
    expect(await eventsFor('github:ollama/ollama:release:')).toEqual([{ title: 'Ollama v0.34.0', kind: 'runtime_release', links: ['ollama'], source: 'feeds' }]);
    const qwen = await eventsFor('feeds:qwen-blog:');
    expect(qwen).toHaveLength(3);
    expect(qwen[0]).toMatchObject({ title: 'Qwen3Guard: Real-time Safety for Your Token Stream', kind: 'announcement', links: ['qwen'] });
  });

  it('is idempotent across runs (unchanged documents and conditional requests)', async () => {
    const [before] = await h.db.execute(sql`select (select count(*)::int from ecosystem.event) as e, (select count(*)::int from ecosystem.event_entity) as l, (select count(*)::int from ingest.source_record) as r`);
    const hosts = offlineFeeds(documents());
    await runAdapter({ db: h.db, store }, createFeedAdapter({ client: hosts.client, feeds })); // validators from the first run → 304
    const [after] = await h.db.execute(sql`select (select count(*)::int from ecosystem.event) as e, (select count(*)::int from ecosystem.event_entity) as l, (select count(*)::int from ingest.source_record) as r`);
    expect(after).toEqual(before);
  });

  it('the same release from the GitHub API is one event whose text stays owned by the source that created it', async () => {
    const release = { tag_name: 'v0.34.0', name: 'v0.34.0', published_at: '2026-09-09T21:51:50Z', html_url: 'https://github.com/ollama/ollama/releases/tag/v0.34.0', prerelease: false, draft: false, body: 'New models' };
    const { client } = offlineGitHub({ repos: { 'ollama/ollama': { repo: recordedGitHub('ollama-repo'), releases: [release] } } });
    const { stats } = await runAdapter({ db: h.db, store }, createGitHubAdapter({ client, repos: ['ollama/ollama'] }));
    expect(stats).toMatchObject({ eventsCreated: 0, eventsUpdated: 0 });
    expect(await eventsFor('github:ollama/ollama:release:v0.34.0')).toEqual([expect.objectContaining({ title: 'Ollama v0.34.0', source: 'feeds', links: ['ollama'] })]);
  });
});

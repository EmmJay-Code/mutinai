import { describe, expect, it } from 'vitest';
import type { EventRecord, RawItem } from '../../src/adapter';
import { canonicalUrl, createFeedAdapter, excerpt, normalizeFeedEntry, parseFeed, PRERELEASE_TAG, type FeedConfig, type FeedEntrySnapshot } from '../../src/adapters/feed';
import { memoryValidators } from '../support/github';
import { offlineFeeds, recordedFeed } from '../support/feeds';

async function collect(iterable: AsyncIterable<RawItem>) {
  const items: RawItem[] = [];
  for await (const item of iterable) items.push(item);
  return items;
}

describe('feed parsing (recorded documents)', () => {
  it('parses RSS 2.0 with RFC 822 dates', () => {
    const { entries } = parseFeed(recordedFeed('huggingface-blog'));
    expect(entries).toHaveLength(3);
    expect(entries[0]).toMatchObject({ id: 'https://huggingface.co/blog/gradio-workflow-1111', title: 'Rebuilding AUTOMATIC1111 with Gradio Workflow', published: '2026-09-10T00:00:00.000Z' });
  });

  it('normalizes timezone offsets', () => {
    const { entries } = parseFeed(recordedFeed('qwen-blog'));
    expect(entries[0]).toMatchObject({ title: 'Qwen3Guard: Real-time Safety for Your Token Stream', url: 'https://qwenlm.github.io/blog/qwen3guard/', published: '2025-09-22T20:00:00.000Z' });
  });

  it('parses Atom with alternate links and updated times', () => {
    const { entries } = parseFeed(recordedFeed('ollama-releases'));
    expect(entries.map((e) => e.title)).toEqual(['v0.34.0', 'v0.34.0-rc5', 'v0.34.0-rc4']);
    expect(entries[0]!.url).toBe('https://github.com/ollama/ollama/releases/tag/v0.34.0');
    expect(entries[0]!.updated).toBe('2026-09-10T06:18:35.000Z');
  });

  it('rejects documents that are not feeds', () => {
    expect(() => parseFeed('<html><body>maintenance</body></html>')).toThrow(/not an RSS or Atom document/);
    expect(() => parseFeed('<rss><channel><item><title>unterminated')).toThrow();
  });

  it('keeps short plain-text excerpts only', () => {
    expect(excerpt('<p>Hello <b>world</b></p><script>x()</script>')).toBe('Hello world');
    const long = excerpt(`<p>${'word '.repeat(200)}</p>`)!;
    expect(long.length).toBeLessThanOrEqual(280);
    expect(long.endsWith('…')).toBe(true);
    expect(excerpt('   ')).toBeNull();
  });

  it('canonicalizes article URLs', () => {
    expect(canonicalUrl('https://example.org/post?utm_source=rss&utm_medium=feed&id=7#comments')).toBe('https://example.org/post?id=7');
    expect(canonicalUrl('not a url')).toBeNull();
  });
});

describe('feed normalization', () => {
  const entry = (feed: FeedEntrySnapshot['feed'], e: Partial<FeedEntrySnapshot['entry']>): RawItem => ({
    externalId: 'x',
    fetchedAt: new Date(),
    contentType: 'application/json',
    payload: { feed, entry: { id: 'id', title: 't', url: null, published: '2026-09-01T00:00:00.000Z', updated: null, author: null, excerpt: null, categories: [], ...e } },
  });

  it('gives GitHub release entries the same identity as the GitHub API adapter', () => {
    const [rec] = normalizeFeedEntry(entry({ key: 'ollama-releases', name: 'Ollama', kind: 'runtime_release', githubReleasesOf: 'ollama/ollama' }, { url: 'https://github.com/ollama/ollama/releases/tag/v0.34.0', title: 'v0.34.0' })) as EventRecord[];
    expect(rec).toMatchObject({ kind: 'runtime_release', dedupeKey: 'github:ollama/ollama:release:v0.34.0', identifiers: [{ namespace: 'github', value: 'ollama/ollama' }] });
  });

  it('links blog entries to configured identifiers and exact category mentions', () => {
    const [rec] = normalizeFeedEntry(entry({ key: 'qwen-blog', name: 'Qwen', identifiers: [{ namespace: 'huggingface-org', value: 'Qwen' }] }, { id: 'https://qwenlm.github.io/blog/qwen3/', categories: ['Qwen3'] })) as EventRecord[];
    expect(rec).toMatchObject({ kind: 'announcement', dedupeKey: 'feeds:qwen-blog:https://qwenlm.github.io/blog/qwen3/', identifiers: [{ value: 'Qwen' }], mentions: ['Qwen3'] });
  });

  it('fails clearly on entries without dates', () => {
    expect(() => normalizeFeedEntry(entry({ key: 'k', name: 'n' }, { published: null, updated: null }))).toThrow(/no publication date/);
  });
});

describe('live feed adapter', () => {
  const feeds: FeedConfig[] = [
    { key: 'ollama-releases', name: 'Ollama releases', url: 'https://github.com/ollama/ollama/releases.atom', kind: 'runtime_release', githubReleasesOf: 'ollama/ollama' },
    { key: 'qwen-blog', name: 'Qwen blog', url: 'https://qwenlm.github.io/blog/index.xml', identifiers: [{ namespace: 'huggingface-org', value: 'Qwen' }] },
  ];
  const hosts = () => offlineFeeds({ [feeds[0]!.url]: { body: recordedFeed('ollama-releases'), contentType: 'application/atom+xml' }, [feeds[1]!.url]: { body: recordedFeed('qwen-blog'), contentType: 'text/plain' } });

  it('yields entries newest first, skipping release-candidate tags, with bounded excerpts', async () => {
    const items = await collect(createFeedAdapter({ client: hosts().client, feeds }).fetch({}));
    expect(items.map((i) => i.externalId)).toEqual([
      'ollama-releases:tag:github.com,2008:Repository/658928958/v0.34.0',
      'qwen-blog:https://qwenlm.github.io/blog/qwen3guard/',
      'qwen-blog:https://qwenlm.github.io/blog/qwen-image-edit/',
      'qwen-blog:https://qwenlm.github.io/blog/qwen-image/',
    ]);
    for (const item of items) expect(((item.payload as FeedEntrySnapshot).entry.excerpt ?? '').length).toBeLessThanOrEqual(280);
  });

  it('applies since and per-feed caps', async () => {
    const items = await collect(createFeedAdapter({ client: hosts().client, feeds: [{ ...feeds[1]!, maxItems: 2 }] }).fetch({ since: new Date('2025-08-10T00:00:00Z') }));
    expect(items.map((i) => (i.payload as FeedEntrySnapshot).entry.title)).toEqual(['Qwen3Guard: Real-time Safety for Your Token Stream', 'Qwen-Image-Edit: Image Editing with Higher Quality and Efficiency']);
  });

  it('skips unchanged feeds through conditional requests', async () => {
    const { client } = hosts();
    const validators = memoryValidators();
    const adapter = createFeedAdapter({ client, feeds });
    expect(await collect(adapter.fetch({ validators }))).toHaveLength(4);
    expect(await collect(adapter.fetch({ validators }))).toHaveLength(0);
  });

  it('processes healthy feeds before failing the run for a broken one', async () => {
    const { client } = offlineFeeds({ [feeds[0]!.url]: { status: 404 }, [feeds[1]!.url]: { body: recordedFeed('qwen-blog') } });
    const items: RawItem[] = [];
    const run = (async () => {
      for await (const item of createFeedAdapter({ client, feeds }).fetch({})) items.push(item);
    })();
    await expect(run).rejects.toThrow(/1 feed\(s\) failed: ollama-releases: GET .* HTTP 404/);
    expect(items).toHaveLength(3);
  });

  it('recognises pre-release tag styles used by runtime projects', () => {
    for (const tag of ['v0.34.0-rc5', 'v0.29.1rc0', 'v0.29.0rc6', '1.2.0.dev3', '2.0.0-beta.1', 'v1.0.0-alpha']) expect(PRERELEASE_TAG.test(tag), tag).toBe(true);
    for (const tag of ['v0.34.0', 'v0.29.0', 'proto-v0.1.0', 'b5450', 'release-2026']) expect(PRERELEASE_TAG.test(tag), tag).toBe(false);
  });

  it('rejects duplicate feed keys', () => {
    expect(() => createFeedAdapter({ client: hosts().client, feeds: [feeds[0]!, feeds[0]!] })).toThrow(/duplicate feed key/);
  });
});
